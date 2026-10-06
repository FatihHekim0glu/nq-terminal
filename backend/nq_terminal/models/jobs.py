"""JOBS models (ARCHITECTURE section 8): the backtest request, a job and the queue listing.

`JobSpec` is the request body of `POST /api/jobs` and the config that `backtests/run_base.py --config` receives. It
refuses everything the runner or the research rules would refuse, before a process is started:

- `strategy` is one of the `run_base.FEEDS` keys (`tests/test_p2_jobs_models.py` parses run_base.py and asserts the
  two sets are equal) and `variant` one of the data layer's variants;
- `params` names must belong to that strategy's config (`strategies.registry.STRATEGIES`, read lazily because the
  import pulls in Nautilus) or be one of the keys its feed consumes (`ticks` and the calendar keys); the probe key
  and the instrument keys the runner assigns itself are refused; values are small finite JSON scalars or short
  lists, and strings carry no character a shell, a path or a quote could use;
- `start >= 2010-01-01` and `end <= 2022-01-01` (the in-sample fence, end exclusive) with `start < end`;
- `run_id` matches `^t_[A-Za-z0-9_.-]{1,80}$`, so it is one path segment under `backtests/output/`.

Responses derive from `ResponseModel`, so every field is required in the schema.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date
from functools import lru_cache
from typing import Any, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from nq_terminal.models.common import ResponseModel

STRATEGY_NAMES = ("za_orb", "overnight", "volmanaged", "volmanaged_bh", "tsmom", "dtsmom", "eomtsy", "tsydemfx")
VARIANTS = ("repaired", "vendor")
IN_SAMPLE_START = date(2010, 1, 1)
IN_SAMPLE_END = date(2022, 1, 1)  # exclusive: data through 2021-12-31
RUN_ID_PATTERN = r"^t_[A-Za-z0-9_.-]{1,80}$"
JOB_ID_PATTERN = r"^j_[0-9a-f]{12}$"
# The keys a feed consumes before the strategy sees the rest (sizing_nt, dtsmom_nt, eomtsy_nt): not struct fields.
FEED_PARAM_KEYS: dict[str, tuple[str, ...]] = {
    "volmanaged": ("ticks",), "volmanaged_bh": ("ticks", "t0"),
    "tsmom": ("ticks", "first_month", "last_month", "end_date"),
    "dtsmom": ("ticks", "first_month", "last_month", "end_date", "book"),
    "eomtsy": ("ticks", "first_month", "last_month"),
    "tsydemfx": ("ticks",),
}
# Strategies whose feed runs only on one frozen span (run_base.load_tsydemfx raises on any other): (variant, start, end).
FROZEN_SPANS: dict[str, tuple[str, date, date]] = {"tsydemfx": ("repaired", date(2010, 1, 1), date(2022, 1, 1))}
TICKS_REQUIRED = frozenset(name for name, keys in FEED_PARAM_KEYS.items() if "ticks" in keys)
TICK_LEVELS = (0, 1, 2)  # the specs' cost levels (sizing_nt.TICK_LEVELS)
# run_base fills these in from the data it loads, so a request may not set them.
# They are strategy config fields, but the feeds derive them from the served data, so a request may not set them.
RUNNER_SET_PARAMS = ("instrument_id", "bar_type", "instrument_ids", "bar_types", "sessions", "end_ns", "t0_ns",
                     "formations", "days", "mult", "roots", "tsy_days", "tsy_events")
MONTH_KEYS = ("first_month", "last_month")
DATE_KEYS = ("end_date", "t0")  # ISO dates a feed reads (tsmom and dtsmom end_date, volmanaged_bh t0)
FIRST_MONTH = (IN_SAMPLE_START.year, IN_SAMPLE_START.month)
LAST_MONTH = (IN_SAMPLE_END.year - 1, 12)  # data through 2021-12-31
MAX_PARAMS = 16
MAX_LIST_ITEMS = 64
MAX_LIST_DEPTH = 2
MAX_STRING = 64
MAX_INT = 2**63 - 1
MAX_FLOAT = 1e15
MAX_CONFIG_JSON_CHARS = 4096
SAFE_STRING = re.compile(r"[A-Za-z0-9_.:+-]{1,%d}" % MAX_STRING)
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
RUN_ID = re.compile(RUN_ID_PATTERN)
JOB_ID = re.compile(JOB_ID_PATTERN)

JobStrategy = Literal["za_orb", "overnight", "volmanaged", "volmanaged_bh", "tsmom", "dtsmom", "eomtsy", "tsydemfx"]
JobVariant = Literal["repaired", "vendor"]
JobState = Literal["queued", "running", "ok", "failed", "error", "stopped"]
FINISHED_STATES = frozenset({"ok", "failed", "error", "stopped"})


@lru_cache(maxsize=None)
def _struct_fields(strategy: str) -> frozenset[str]:
    """The config fields of a registered strategy (imports Nautilus on first use, so it is never done at import)."""
    from nq_lab.strategies.registry import STRATEGIES

    return frozenset(STRATEGIES[strategy][1].__struct_fields__)


@lru_cache(maxsize=None)
def engine_base_fields() -> frozenset[str]:
    """The Nautilus `StrategyConfig` base fields (strategy_id, order_id_tag, oms_type, manage_*, log_* ...)."""
    from nautilus_trader.trading.config import StrategyConfig

    return frozenset(StrategyConfig.__struct_fields__)


def allowed_param_names(strategy: str) -> frozenset[str]:
    own = _struct_fields(strategy) - frozenset(RUNNER_SET_PARAMS) - engine_base_fields()
    return own | frozenset(FEED_PARAM_KEYS.get(strategy, ()))


def _check_scalar(value: Any) -> None:
    if isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > MAX_INT:
            raise ValueError("an integer parameter is out of range")
    elif isinstance(value, float):
        if not math.isfinite(value) or abs(value) > MAX_FLOAT:
            raise ValueError("a numeric parameter must be finite and below 1e15")
    elif isinstance(value, str):
        if not SAFE_STRING.fullmatch(value):
            raise ValueError("a text parameter may hold letters, digits and _ . : + - only (1 to 64 characters)")
    else:
        raise ValueError("a parameter must be a number, a boolean, a short text or a short list of those")


def _check_value(value: Any, depth: int = 0) -> None:
    if isinstance(value, (list, tuple)):
        if depth >= MAX_LIST_DEPTH or len(value) > MAX_LIST_ITEMS:
            raise ValueError("a list parameter has at most 64 items and 2 levels")
        for item in value:
            _check_value(item, depth + 1)
        return
    _check_scalar(value)


def _check_ticks(strategy: str, params: dict[str, Any]) -> None:
    if strategy not in TICKS_REQUIRED:
        return
    ticks = params.get("ticks")
    if isinstance(ticks, bool) or not isinstance(ticks, int) or ticks not in TICK_LEVELS:
        raise ValueError(f"{strategy} needs params.ticks, one of {TICK_LEVELS}")


def _check_date(key: str, value: Any) -> None:
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        raise ValueError(f"{key} is written YYYY-MM-DD")
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{key} is not a calendar date") from None
    if not IN_SAMPLE_START <= day < IN_SAMPLE_END:
        raise ValueError(f"{key} must lie in the in-sample window ({IN_SAMPLE_START.isoformat()} to 2021-12-31)")


def _check_month(key: str, value: Any) -> None:
    ok = isinstance(value, (list, tuple)) and len(value) == 2 and all(type(item) is int for item in value)
    if not ok or not FIRST_MONTH <= (value[0], value[1]) <= LAST_MONTH or not 1 <= value[1] <= 12:
        raise ValueError(f"{key} is a [year, month] pair from 2010-01 to 2021-12")


def _check_frozen_span(spec: "JobSpec") -> None:
    frozen = FROZEN_SPANS.get(spec.strategy)
    if frozen is not None and (spec.variant, spec.start, spec.end) != frozen:
        variant, start, end = frozen
        raise ValueError(f"{spec.strategy} runs only on variant {variant} from {start.isoformat()} to "
                         f"{end.isoformat()} (end exclusive)")


def _check_calendar(params: dict[str, Any]) -> None:
    """The calendar keys a feed reads are inside the in-sample fence, so no child is started that the OOS gate would stop."""
    for key in DATE_KEYS:
        if key in params:
            _check_date(key, params[key])
    for key in MONTH_KEYS:
        if key in params:
            _check_month(key, params[key])


class JobSpec(ResponseModel):
    """One backtest request; the same fields, in this order, go to `run_base.py --config` (see `run_config`)."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    strategy: JobStrategy
    params: dict[str, Any] = Field(default_factory=dict)
    variant: JobVariant
    start: date
    end: date
    run_id: str = Field(pattern=RUN_ID_PATTERN)

    @field_validator("start", "end", mode="before")
    @classmethod
    def _plain_iso_date(cls, value: Any) -> Any:
        if isinstance(value, date) and type(value) is date:
            return value
        if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
            raise ValueError("a date is written YYYY-MM-DD")
        return value

    @field_validator("start")
    @classmethod
    def _start_in_sample(cls, value: date) -> date:
        if value < IN_SAMPLE_START:
            raise ValueError(f"start must be {IN_SAMPLE_START.isoformat()} or later (the in-sample window)")
        return value

    @field_validator("end")
    @classmethod
    def _end_inside_the_fence(cls, value: date) -> date:
        if value > IN_SAMPLE_END:
            raise ValueError(f"end must be {IN_SAMPLE_END.isoformat()} or earlier (the in-sample fence)")
        return value

    @field_validator("params")
    @classmethod
    def _params_are_small_json(cls, params: dict[str, Any]) -> dict[str, Any]:
        if len(params) > MAX_PARAMS:
            raise ValueError(f"at most {MAX_PARAMS} parameters")
        for name, value in params.items():
            if not SAFE_STRING.fullmatch(name):
                raise ValueError("a parameter name may hold letters, digits and _ . : + - only")
            _check_value(value)
        return params

    @model_validator(mode="after")
    def _cross_checks(self) -> "JobSpec":
        if self.start >= self.end:
            raise ValueError("start must be before end")
        allowed = allowed_param_names(self.strategy)
        unknown = sorted(set(self.params) - allowed)
        if unknown:
            raise ValueError(f"parameters {unknown} do not belong to {self.strategy}")
        _check_ticks(self.strategy, self.params)
        _check_calendar(self.params)
        _check_frozen_span(self)
        if len(config_json(self)) > MAX_CONFIG_JSON_CHARS:
            raise ValueError("the config is too long")
        return self


def run_config(spec: JobSpec) -> dict[str, Any]:
    """The `--config` object of `run_base.py`: its CONFIG_KEYS in order, dates as ISO text."""
    return {"strategy": spec.strategy, "params": dict(spec.params), "variant": spec.variant,
            "start": spec.start.isoformat(), "end": spec.end.isoformat(), "run_id": spec.run_id}


def config_json(spec: JobSpec) -> str:
    return json.dumps(run_config(spec))


class Job(ResponseModel):
    """A queued, running or finished backtest. `message` is a short fixed text; no path is ever served."""

    id: str = Field(pattern=JOB_ID_PATTERN)
    run_id: str
    state: JobState
    spec: JobSpec
    created: str
    started: str | None
    finished: str | None
    exit_code: int | None
    message: str
    log_tail: list[str]


class JobList(ResponseModel):
    """Newest first. `enabled` is false when no runner is configured (fixture mode)."""

    jobs: list[Job]
    queued: int
    running: int
    queue_cap: int
    enabled: bool
