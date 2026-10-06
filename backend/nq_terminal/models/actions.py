"""Models of the actions route family (vnext product-1 and product-3): launch presets, the two actions and the
comparison of an anchor re-run with its base.

An action names a preset (a ledger row) or a base run, plus named parameters and a window; it never carries a config,
a path or a command. `extra="forbid"` refuses any other field, so a client cannot set the runner's config itself. The
server derives the config and hands it to the JOBS queue as a `JobSpec`, which re-checks everything on enqueue.

Responses derive from `ResponseModel`, so every field is required in the schema.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal, Union

from pydantic import ConfigDict, Field, field_validator

from nq_terminal.models.common import ResponseModel
from nq_terminal.models.jobs import ISO_DATE, RUN_ID_PATTERN, Job

SOURCE_RUN_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}$"  # services/runs.RUN_ID_RE: a run folder or a ledger row id
MAX_ACTION_PARAMS = 16
ParamKind = Literal["int", "float", "str", "month", "date"]
Verdict = Literal["MATCH", "MISMATCH", "PENDING", "NOT COMPARABLE"]
COMPARISON_NOTE = ("an exact comparison of the re-run with its base (trades, PnL, fees, Sharpe); it is not the formal "
                   "regress_check sidecar, which only the lab's own scripts write")


class ParamField(ResponseModel):
    """One named parameter of a registered strategy: its type, default and allowed range or choices."""

    name: str
    kind: ParamKind
    default: Any
    required: bool
    minimum: float | None
    maximum: float | None
    exclusive_minimum: bool
    choices: list[Any] | None
    feed_key: bool  # read by the runner's data feed, not a field of the strategy's config


class StrategyParams(ResponseModel):
    strategy: str
    params: list[ParamField]


class LaunchPreset(ResponseModel):
    """A ledger row offered as a starting point. `launchable` is false (with the reasons) when the job spec would
    refuse its params as they stand. `spec_sha256` is the sha256 of `experiments/<exp_id>.json` when that file
    exists (read only), else None: a run started from a preset without it cannot be tied to a spec."""

    preset_id: str
    exp_id: str | None
    spec_sha256: str | None
    ts_utc: str | None
    strategy: str
    variant: str
    start: str
    end: str
    params: dict[str, Any]
    runtime_s: float | None
    run_found: bool
    launchable: bool
    reasons: list[str]


class PresetList(ResponseModel):
    """Newest first; `strategies` holds the parameter schema of every strategy offered."""

    ledger_found: bool
    presets: list[LaunchPreset]
    strategies: list[StrategyParams]


def _plain_iso_date(value: Any) -> Any:
    if value is None or (isinstance(value, date) and type(value) is date):
        return value
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        raise ValueError("a date is written YYYY-MM-DD")
    return value


class BacktestAction(ResponseModel):
    """Start a backtest from a preset: its config with the named parameters changed and, optionally, a narrower
    window and a chosen run id (the server suggests a free one when it is left out)."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    kind: Literal["backtest"]
    preset_id: str = Field(pattern=SOURCE_RUN_PATTERN)
    params: dict[str, Any] = Field(default_factory=dict, max_length=MAX_ACTION_PARAMS)
    start: date | None = None
    end: date | None = None
    run_id: str | None = Field(default=None, pattern=RUN_ID_PATTERN)

    @field_validator("start", "end", mode="before")
    @classmethod
    def _dates(cls, value: Any) -> Any:
        return _plain_iso_date(value)


class AnchorAction(ResponseModel):
    """Re-run a finished run as a regression anchor: its own config, a fresh run id chosen by the server."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    kind: Literal["anchor"]
    base_run_id: str = Field(pattern=SOURCE_RUN_PATTERN)


Action = Annotated[Union[BacktestAction, AnchorAction], Field(discriminator="kind")]


class ActionResult(ResponseModel):
    """The queued job and the action as the server resolved it (the params, window and run id it used)."""

    kind: Literal["backtest", "anchor"]
    job: Job
    action: Action
    preset_id: str | None
    base_run_id: str | None
    changed_params: list[str]  # names whose value differs from the preset: an off-spec warning, not a block


class FieldCheck(ResponseModel):
    """One compared field. `equal` is None when a value is missing on either side (never a match)."""

    field: str
    equal: bool | None
    anchor: Any
    base: Any


class AnchorCheck(ResponseModel):
    """Rule 3 for a re-run started here: every field equal is MATCH; the first field that differs decides MISMATCH,
    the first that is missing NOT COMPARABLE; PENDING while the re-run's job has not left a result yet."""

    anchor: str
    base: str | None
    base_found: bool
    verdict: Verdict
    first_difference: str | None
    checks: list[FieldCheck]
    job_state: str | None
    note: str
