"""The launch parameter schema (vnext product-1): the named parameters a backtest started from the terminal may set,
with their types and ranges, and the in-sample window check. Pure functions; nothing here reads prices or writes.

The names are exactly `models.jobs.allowed_param_names(strategy)` (the strategy config's own fields less the ones the
runner sets, plus the keys its data feed reads). Every name needs a rule below (type, range or choices); a name
without one is refused, so a new config field cannot be launched unchecked (`tests/test_actions_params.py` fails on
such a field). The ranges are the launcher's sanity bounds, wider than any registered spec; they are not research
bounds and decide nothing about a result. The job spec repeats its own checks on enqueue.

The window must lie inside `[2010-01-01, 2022-01-01)` (end exclusive, as `run_base.py` reads it), so no window touches
2022-01-01 or later, and it must pass `nq_lab.oos_gate.check_window`, the gate's own window check (it reads no data
and writes no log line); the child process then serves its prices through the gate as every run does.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any, Mapping

from nq_terminal.models.actions import MAX_ACTION_PARAMS, ParamField
from nq_terminal.models.jobs import (
    FEED_PARAM_KEYS,
    IN_SAMPLE_END,
    IN_SAMPLE_START,
    ISO_DATE,
    TICK_LEVELS,
    TICKS_REQUIRED,
    allowed_param_names,
)

Problem = tuple[tuple[str, ...], str]
FIRST_MONTH = (IN_SAMPLE_START.year, IN_SAMPLE_START.month)
LAST_MONTH = (IN_SAMPLE_END.year - 1, 12)
GATE_CALLER = "terminal"
GATE_REASON = "terminal launch: window check before a backtest job is queued (no data read)"
MAX_NAME_ECHO = 64


@dataclass(frozen=True)
class Rule:
    kind: str  # int, float, str, month, date
    minimum: float | None = None
    maximum: float | None = None
    exclusive_minimum: bool = False
    choices: tuple[Any, ...] | None = None


COMMON_RULES: Mapping[str, Rule] = {
    "ticks": Rule("int", choices=TICK_LEVELS),
    "trade_size": Rule("int", 1, 100),
    "K": Rule("float", 1e4, 1e10),
    "first_month": Rule("month"),
    "last_month": Rule("month"),
    "end_date": Rule("date"),
    "t0": Rule("date"),
}
STRATEGY_RULES: Mapping[tuple[str, str], Rule] = {
    ("za_orb", "or_minutes"): Rule("int", 1, 120),
    ("za_orb", "target_r"): Rule("float", 0.1, 100.0),
    ("overnight", "exit_at"): Rule("str", choices=("bar_close", "open_tick")),
    ("volmanaged", "band"): Rule("float", 0.0, 1.0),
    ("volmanaged", "cap"): Rule("float", 0.1, 10.0),
    ("volmanaged", "min_hist"): Rule("int", 1, 5000),
    ("volmanaged", "min_valid"): Rule("int", 1, 252),
    ("volmanaged", "window"): Rule("int", 2, 252),
    ("volmanaged_bh", "k"): Rule("float", 0.0, 10.0, exclusive_minimum=True),
    ("tsmom", "L"): Rule("float", 0.0, 10.0),
    ("tsmom", "book"): Rule("str", choices=("managed", "vs", "bh")),
    ("tsmom", "com"): Rule("int", 1, 1000),
    ("tsmom", "lcap"): Rule("float", 0.1, 10.0),
    ("tsmom", "sigma_target"): Rule("float", 0.01, 2.0),
    ("dtsmom", "book"): Rule("str", choices=("tsmom", "lo")),
    ("eomtsy", "lev_cap"): Rule("float", 0.1, 100.0),
}


def rule_for(strategy: str, name: str) -> Rule | None:
    return STRATEGY_RULES.get((strategy, name)) or COMMON_RULES.get(name)


# ---------------------------------------------------------------- schema


def _json_default(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_json_default(item) for item in value]
    return value if isinstance(value, (bool, int, float, str)) or value is None else None


@lru_cache(maxsize=None)
def _struct_defaults(strategy: str) -> tuple[tuple[str, ...], dict[str, Any]]:
    """The config struct's field order and its JSON-ready defaults (imports Nautilus on first use, never at import)."""
    from nq_lab.strategies.registry import STRATEGIES

    config = STRATEGIES[strategy][1]
    fields, defaults = tuple(config.__struct_fields__), tuple(config.__struct_defaults__)
    tail = fields[len(fields) - len(defaults):]
    return fields, {name: _json_default(value) for name, value in zip(tail, defaults)}


def _field(strategy: str, name: str, defaults: Mapping[str, Any], rule: Rule) -> ParamField:
    feed_keys = FEED_PARAM_KEYS.get(strategy, ())
    return ParamField(name=name, kind=rule.kind, default=defaults.get(name), feed_key=name in feed_keys,
                      required=name == "ticks" and strategy in TICKS_REQUIRED, minimum=rule.minimum,
                      maximum=rule.maximum, exclusive_minimum=rule.exclusive_minimum,
                      choices=list(rule.choices) if rule.choices is not None else None)


def schema(strategy: str) -> list[ParamField]:
    """The named parameters of a registered strategy, in config order, then the feed keys."""
    allowed = allowed_param_names(strategy)
    fields, defaults = _struct_defaults(strategy)
    names = [n for n in fields if n in allowed] + [n for n in FEED_PARAM_KEYS.get(strategy, ()) if n not in fields]
    return [_field(strategy, name, defaults, rule) for name in names if (rule := rule_for(strategy, name))]


# ---------------------------------------------------------------- checks


def _range_text(rule: Rule) -> str:
    low = "above" if rule.exclusive_minimum else "between"
    joiner = "and at most" if rule.exclusive_minimum else "and"
    return f"{low} {rule.minimum:g} {joiner} {rule.maximum:g}"


def _in_range(value: float, rule: Rule) -> bool:
    if rule.minimum is not None and (value <= rule.minimum if rule.exclusive_minimum else value < rule.minimum):
        return False
    return rule.maximum is None or value <= rule.maximum


def _number_problem(value: Any, rule: Rule) -> str | None:
    whole = rule.kind == "int"
    if isinstance(value, bool) or not isinstance(value, int if whole else (int, float)):
        return "must be a whole number" if whole else "must be a number"
    if not math.isfinite(value):
        return "must be a number"
    if rule.choices is not None and value not in rule.choices:
        return f"must be one of {list(rule.choices)}"
    if not _in_range(value, rule):
        return f"must be {_range_text(rule)}"
    return None


def _month_problem(value: Any) -> str | None:
    pair = isinstance(value, (list, tuple)) and len(value) == 2 and all(type(item) is int for item in value)
    if not pair or not 1 <= value[1] <= 12 or not FIRST_MONTH <= (value[0], value[1]) <= LAST_MONTH:
        return "must be a [year, month] pair from 2010-01 to 2021-12"
    return None


def _date_problem(value: Any) -> str | None:
    text = "must be written YYYY-MM-DD inside the in-sample window (2010-01-01 to 2021-12-31)"
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        return text
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return text
    return None if IN_SAMPLE_START <= day < IN_SAMPLE_END else text


def value_problem(rule: Rule, value: Any) -> str | None:
    """Why `value` breaks `rule`, or None."""
    if rule.kind in ("int", "float"):
        return _number_problem(value, rule)
    if rule.kind == "str":
        ok = isinstance(value, str) and rule.choices is not None and value in rule.choices
        return None if ok else f"must be one of {list(rule.choices or ())}"
    if rule.kind == "month":
        return _month_problem(value)
    if rule.kind == "date":
        return _date_problem(value)
    return "has no launch rule"


def param_problems(strategy: str, params: Mapping[str, Any]) -> list[Problem]:
    """Every reason the named parameters cannot be launched: too many, unknown names, wrong types, out of range."""
    if len(params) > MAX_ACTION_PARAMS:
        return [(("params",), f"at most {MAX_ACTION_PARAMS} parameters")]
    allowed = allowed_param_names(strategy)
    problems: list[Problem] = []
    for name, value in params.items():
        shown = str(name)[:MAX_NAME_ECHO]
        rule = rule_for(strategy, name) if name in allowed else None
        if name not in allowed:
            problems.append((("params", shown), f"{shown} is not a parameter of {strategy}"))
        elif rule is None:
            problems.append((("params", shown), f"{shown} has no launch rule, so it cannot be set here"))
        elif (problem := value_problem(rule, value)) is not None:
            problems.append((("params", shown), f"{shown} {problem}"))
    if strategy in TICKS_REQUIRED and "ticks" not in params:
        problems.append((("params", "ticks"), f"{strategy} needs ticks, one of {list(TICK_LEVELS)}"))
    return problems


def normalised(strategy: str, params: Mapping[str, Any]) -> dict[str, Any]:
    """A copy with whole numbers given for float parameters written as floats (3 becomes 3.0)."""
    def one(name: str, value: Any) -> Any:
        rule = rule_for(strategy, name)
        is_whole = isinstance(value, int) and not isinstance(value, bool)
        return float(value) if rule is not None and rule.kind == "float" and is_whole else value

    return {name: one(name, value) for name, value in params.items()}


def _gate_problem(start: date, end: date) -> Problem | None:
    """The OOS gate's own window check (lazy: the gate is not on the start path)."""
    import pandas as pd

    from nq_lab import oos_gate

    try:
        oos_gate.check_window(pd.Timestamp(start.isoformat(), tz="UTC"), pd.Timestamp(end.isoformat(), tz="UTC"),
                              GATE_CALLER, GATE_REASON)
    except oos_gate.OOSAccessError as exc:
        return ("window",), f"the OOS gate refused the window: {exc}"
    return None


def window_problems(start: date, end: date) -> list[Problem]:
    """Why `[start, end)` cannot be launched: outside the in-sample fence, empty, or refused by the gate."""
    problems: list[Problem] = []
    if start < IN_SAMPLE_START:
        problems.append((("start",), f"start must be {IN_SAMPLE_START.isoformat()} or later (the in-sample window)"))
    if end > IN_SAMPLE_END:
        problems.append((("end",), f"end must be {IN_SAMPLE_END.isoformat()} or earlier (end is exclusive, so the "
                                   "window holds no day of 2022 or later)"))
    if start >= end:
        problems.append((("window",), "start must be before end"))
    if problems:
        return problems
    gate = _gate_problem(start, end)
    return [gate] if gate is not None else []
