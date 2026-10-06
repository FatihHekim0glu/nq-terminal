"""The launch parameter schema (vnext product-1): named parameters with types and ranges, and the in-sample window.

A backtest started from a preset may change only the named parameters of its registered strategy. Each one is
checked against `services/launch_params.RULES` (type and range) before a job spec is built; the job spec then repeats
its own checks on enqueue. The window must lie inside `[2010-01-01, 2022-01-01)` (end exclusive, so no window touches
2022-01-01 or later) and passes `nq_lab.oos_gate.check_window`, the gate's own window check, which reads no data and
writes no log line.
"""
from __future__ import annotations

from datetime import date

import pytest

from nq_terminal.models.jobs import STRATEGY_NAMES, allowed_param_names
from nq_terminal.services import launch_params as lp


def messages(problems) -> str:
    return " | ".join(f"{'.'.join(str(p) for p in loc)}: {msg}" for loc, msg in problems)


@pytest.mark.parametrize("strategy", STRATEGY_NAMES)
def test_every_parameter_a_strategy_accepts_has_a_rule(strategy: str) -> None:
    """Drift guard: a new config field without a type and range is a failing test, not an unchecked parameter."""
    missing = [name for name in sorted(allowed_param_names(strategy)) if lp.rule_for(strategy, name) is None]
    assert missing == []


def test_the_za_orb_schema_names_its_parameters_with_defaults_and_ranges() -> None:
    fields = {f.name: f for f in lp.schema("za_orb")}
    assert set(fields) == {"or_minutes", "target_r", "trade_size"}
    assert (fields["or_minutes"].kind, fields["or_minutes"].default) == ("int", 5)
    assert (fields["or_minutes"].minimum, fields["or_minutes"].maximum) == (1, 120)
    assert (fields["target_r"].kind, fields["target_r"].default) == ("float", 10.0)
    assert fields["trade_size"].required is False and fields["trade_size"].feed_key is False


def test_feed_keys_are_named_and_ticks_is_required_where_the_feed_needs_it() -> None:
    fields = {f.name: f for f in lp.schema("eomtsy")}
    assert fields["ticks"].feed_key is True and fields["ticks"].required is True
    assert fields["ticks"].choices == [0, 1, 2]
    assert fields["first_month"].kind == "month" and fields["first_month"].default == [2011, 1]


def test_the_tsydemfx_schema_is_the_cost_level_alone() -> None:
    fields = {f.name: f for f in lp.schema("tsydemfx")}
    assert list(fields) == ["ticks"] and fields["ticks"].required is True and fields["ticks"].feed_key is True
    assert lp.param_problems("tsydemfx", {"ticks": 1}) == []
    assert [loc for loc, _ in lp.param_problems("tsydemfx", {"ticks": 1, "tsy_days": [1]})] == [("params", "tsy_days")]


def test_choices_come_from_the_strategy_rules() -> None:
    assert {f.name: f.choices for f in lp.schema("overnight")}["exit_at"] == ["bar_close", "open_tick"]
    assert {f.name: f.choices for f in lp.schema("tsmom")}["book"] == ["managed", "vs", "bh"]


def test_valid_parameters_pass() -> None:
    assert lp.param_problems("za_orb", {"or_minutes": 15, "target_r": 2.5}) == []
    assert lp.param_problems("overnight", {"exit_at": "open_tick"}) == []
    assert lp.param_problems("eomtsy", {"ticks": 2, "first_month": [2012, 3]}) == []


def test_an_unknown_parameter_name_is_refused() -> None:
    problems = lp.param_problems("za_orb", {"or_minutes": 5, "stop_r": 1.0})
    assert [loc for loc, _ in problems] == [("params", "stop_r")]
    assert "not a parameter of za_orb" in messages(problems)


@pytest.mark.parametrize("name", ["instrument_id", "bar_type", "sessions", "strategy_id", "lookahead_probe"])
def test_runner_and_engine_keys_are_not_launch_parameters(name: str) -> None:
    assert lp.param_problems("za_orb", {name: "x"}) != []


@pytest.mark.parametrize(("strategy", "params", "word"), [
    ("za_orb", {"or_minutes": "5"}, "whole number"),
    ("za_orb", {"or_minutes": 5.5}, "whole number"),
    ("za_orb", {"or_minutes": True}, "whole number"),
    ("za_orb", {"target_r": "10"}, "number"),
    ("za_orb", {"target_r": float("nan")}, "number"),
    ("overnight", {"exit_at": 1}, "one of"),
    ("overnight", {"exit_at": "close"}, "one of"),
    ("volmanaged", {"ticks": 3}, "one of"),
    ("eomtsy", {"ticks": 1, "first_month": "2012-03"}, "[year, month]"),
    ("tsmom", {"ticks": 1, "end_date": 20200101}, "YYYY-MM-DD"),
])
def test_a_wrong_type_is_refused(strategy: str, params: dict, word: str) -> None:
    problems = lp.param_problems(strategy, params)
    assert problems and word in messages(problems)


@pytest.mark.parametrize(("strategy", "params"), [
    ("za_orb", {"or_minutes": 0}),
    ("za_orb", {"or_minutes": 121}),
    ("za_orb", {"target_r": -1.0}),
    ("za_orb", {"trade_size": 0}),
    ("volmanaged", {"ticks": 1, "band": 1.5}),
    ("volmanaged_bh", {"ticks": 1, "k": 0.0}),
    ("tsmom", {"ticks": 1, "sigma_target": 5.0}),
])
def test_a_value_out_of_range_is_refused(strategy: str, params: dict) -> None:
    problems = lp.param_problems(strategy, params)
    text = messages(problems)
    assert problems and ("between" in text or "above" in text), text


@pytest.mark.parametrize(("strategy", "params"), [
    ("eomtsy", {"ticks": 1, "last_month": [2022, 1]}),
    ("eomtsy", {"ticks": 1, "first_month": [2009, 12]}),
    ("tsmom", {"ticks": 1, "end_date": "2022-01-03"}),
    ("dtsmom", {"ticks": 1, "end_date": "2022-01-01"}),
])
def test_a_calendar_parameter_past_the_fence_is_refused(strategy: str, params: dict) -> None:
    assert lp.param_problems(strategy, params) != []


def test_a_whole_float_given_as_an_integer_is_accepted_and_normalised() -> None:
    assert lp.param_problems("za_orb", {"target_r": 3}) == []
    assert lp.normalised("za_orb", {"target_r": 3, "or_minutes": 5}) == {"target_r": 3.0, "or_minutes": 5}
    assert isinstance(lp.normalised("za_orb", {"target_r": 3})["target_r"], float)


def test_the_in_sample_window_is_accepted() -> None:
    assert lp.window_problems(date(2010, 9, 28), date(2022, 1, 1)) == []
    assert lp.window_problems(date(2010, 1, 1), date(2010, 1, 2)) == []


@pytest.mark.parametrize(("start", "end"), [
    (date(2010, 9, 28), date(2022, 1, 2)),   # touches 2022-01-01
    (date(2022, 1, 1), date(2022, 2, 1)),    # wholly out of sample
    (date(2021, 6, 1), date(2023, 1, 1)),    # straddles the fence
    (date(2009, 12, 31), date(2011, 1, 1)),  # starts before the in-sample window
    (date(2015, 1, 1), date(2015, 1, 1)),    # empty
    (date(2015, 2, 1), date(2015, 1, 1)),    # reversed
])
def test_a_window_outside_the_in_sample_fence_is_refused(start: date, end: date) -> None:
    problems = lp.window_problems(start, end)
    assert problems and all(loc[0] in ("start", "end", "window") for loc, _ in problems)


def test_the_window_goes_through_the_gate_check(monkeypatch) -> None:
    """Born failing: a gate that refuses the window must refuse the launch, even when the local fence passes."""
    from nq_lab import oos_gate

    calls = []

    def refuse(start, end, caller, reason):
        calls.append((start, end, caller, reason))
        raise oos_gate.OOSAccessError("planted refusal")

    monkeypatch.setattr(oos_gate, "check_window", refuse)
    problems = lp.window_problems(date(2012, 1, 3), date(2013, 1, 2))
    assert calls and calls[0][2] == "terminal" and len(calls[0][3]) >= 20
    assert str(calls[0][0].tz) == "UTC" and calls[0][1].isoformat().startswith("2013-01-02")
    assert "planted refusal" in messages(problems)
