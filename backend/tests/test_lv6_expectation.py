"""LV6 served (ANALYTICS_CATALOG LV6 and LV6b): the paper book placed on its hypothesis's SV6 cone, and the
live-start cone. [POST HOC], descriptive.

`analytics/expectation.py` mirrors what the browser computed in its client phase (`pathOnCone`, `coneBand`,
`expectationView`, `capitalRun`, `paperBookHypothesis` and `defaultCost` in web/src/screens/live/expectationModel.ts):
every case of `qa/golden/p12_expectation.json`, the file the browser port was pinned to, must come out equal (1e-12
relative for each fraction; the bands, the first index and the beyond count exactly). The live-start cone is SV6's
own machinery (`analytics/bootstrap.py`) on the paper book's daily P&L as a fraction of K; its numpy reference is
`terminal/qa/crosscheck/lv6_live_cone.py`, compared through the `lv6` dump bundle.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import bootstrap, expectation

GOLDEN = Path(__file__).resolve().parents[2] / "qa" / "golden" / "p12_expectation.json"
REL = 1e-12
LEVELS = {"5": -0.1, "25": -0.02, "50": 0.0, "75": 0.03, "95": 0.05}
K = 1000.0


def flat(steps: int) -> dict:
    return {key: [level] * steps for key, level in LEVELS.items()}


def golden_cases() -> list[dict]:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))["cases"]


def same_fraction(got: list, want: list) -> bool:
    if len(got) != len(want):
        return False
    for a, b in zip(got, want):
        if b is None:
            if a is not None:
                return False
        elif a is None or abs(a - b) > REL * max(abs(a), abs(b)):
            return False
    return True


# ---------------------------------------------------------------- the mirror of pathOnCone (golden, case by case)


def test_the_golden_file_holds_the_cases_the_browser_was_pinned_to():
    names = [c["name"] for c in golden_cases()]
    assert len(names) >= 7
    for wanted in ("fixture paper", "fixture model", "tie on p25 and p95", "gap", "long path", "missing quantile",
                   "below p5"):
        assert any(wanted in n for n in names), wanted


@pytest.mark.parametrize("case", golden_cases(), ids=lambda c: c["name"])
def test_path_on_cone_equals_the_golden_case(case):
    got = expectation.path_on_cone(**case["input"])
    want = case["expected"]
    assert got["first_index"] == want["first_index"]
    assert got["bands"] == want["bands"]
    assert got["beyond"] == want["beyond"]
    assert same_fraction(got["fraction"], want["fraction"]), (got["fraction"], want["fraction"])


def test_a_value_on_a_percentile_sits_in_the_band_above_it():
    assert expectation.path_on_cone([-20.0, 50.0], K, flat(2), 2)["bands"] == ["p25to50", "above95"]
    q = [-0.1, -0.02, 0.0, 0.03, 0.05]
    assert [expectation.cone_band(p, q) for p in q] == ["p5to25", "p25to50", "p50to75", "p75to95", "above95"]


def test_cone_band_gives_none_for_a_missing_or_crossing_percentile_and_a_non_finite_value():
    q = [-0.1, -0.02, 0.0, 0.03, 0.05]
    assert expectation.cone_band(math.nan, q) is None
    assert expectation.cone_band(math.inf, q) is None
    assert expectation.cone_band(0.0, [-0.1, math.nan, 0.0, 0.03, 0.05]) is None
    assert expectation.cone_band(0.0, [-0.1, 0.02, 0.0, 0.03, 0.05]) is None
    assert expectation.cone_band(0.0, [-1.0, 0.0, 0.0, 0.0, 1.0]) == "p75to95"


def test_a_bool_is_not_a_number_as_in_the_browser():
    out = expectation.path_on_cone([True, 10.0], K, flat(2), 2)
    assert out["first_index"] == 1 and out["fraction"] == [0.01, None]


def test_an_absent_percentile_line_places_nothing():
    q = flat(2)
    del q["75"]
    assert expectation.path_on_cone([10.0, 10.0], K, q, 2)["bands"] == [None, None]


def test_a_zero_horizon_and_an_empty_path():
    assert expectation.path_on_cone([], K, flat(0), 0) == {"first_index": None, "fraction": [], "bands": [],
                                                           "beyond": 0}
    assert expectation.path_on_cone([5.0], K, flat(0), 0) == {"first_index": 0, "fraction": [], "bands": [],
                                                              "beyond": 1}


@pytest.mark.parametrize("capital", [0.0, -1.0, math.nan, math.inf, -math.inf])
def test_born_failing_a_capital_that_is_not_positive_and_finite_is_refused(capital):
    with pytest.raises(ValueError, match="capital"):
        expectation.path_on_cone([1.0], capital, flat(1), 1)


@pytest.mark.parametrize("horizon", [-1, 1.5, math.nan, True])
def test_born_failing_a_horizon_that_is_not_a_whole_number_is_refused(horizon):
    with pytest.raises(ValueError, match="horizon"):
        expectation.path_on_cone([1.0], K, flat(1), horizon)


# ---------------------------------------------------------------- the book, the cost and the run (the browser's rules)


def test_the_paper_book_mapping_matches_from_the_start_up_to_a_word_boundary():
    assert expectation.paper_book_hypothesis("volmanaged_paper_journal.jsonl") == "volmanaged_v0"
    assert expectation.paper_book_hypothesis("volmanaged_paper_journal") == "volmanaged_v0"
    assert expectation.paper_book_hypothesis("volmanaged_paper_journal.PLUMBING_DELAYED.jsonl") == "volmanaged_v0"
    for other in ("volmanaged_paper_journal_v2.jsonl", "old_volmanaged_paper_journal.jsonl", "other.jsonl", "", None):
        assert expectation.paper_book_hypothesis(other) is None


def test_the_default_cost_is_one_tick_when_recorded_else_the_first():
    assert expectation.default_cost([0, 1, 2]) == 1
    assert expectation.default_cost([2, 0]) == 2
    assert expectation.default_cost([]) is None


def run(run_id: str, **extra) -> dict:
    return {"run_id": run_id, "balance_ok": True, "is_probe": False, "readable": True, **extra}


def test_capital_run_is_the_first_card_run_that_is_usable():
    runs = [run("a", is_probe=True), run("b", balance_ok=False), run("c"), run("d")]
    assert expectation.capital_run(["a", "b", "c", "d"], runs) == "c"
    assert expectation.capital_run(["b", "a"], [run("a"), run("b")]) == "b"
    assert expectation.capital_run(["a"], [run("a", balance_ok=None)]) == "a"
    assert expectation.capital_run(["a", "ghost", "c"], [run("a", readable=False), run("c")]) == "c"
    assert expectation.capital_run(["a"], [run("a", is_probe=True)]) is None
    assert expectation.capital_run([], [run("a")]) is None
    assert expectation.capital_run(["a"], []) is None


# ---------------------------------------------------------------- the placement on one cone (expectationView's numbers)

FIXTURE_CONE = {  # the first five steps of HYP_BOOTSTRAP.cone (web/src/screens/tear/tearP1.fixtures.ts)
    "unit": "fraction of K", "how": "summed", "steps": [1, 2, 3, 4, 5],
    "quantiles": {c: v for c, v in next(c for c in golden_cases() if c["name"] == "fixture paper")["input"][
        "quantiles"].items()},
}
TRACKING = {"present": True, "date": ["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09"],
            "paper": [None, None, None, None, -6.0], "model": [None, None, None, None, -5.0],
            "paper_cumulative": [None, None, None, 12.0, 6.0], "model_cumulative": [None, None, None, 12.0, 7.0]}


def test_the_placement_on_the_fixture_cone_is_what_the_browser_drew():
    placed = expectation.placement(TRACKING, 1_000_000.0, FIXTURE_CONE)
    assert placed["horizon"] == 5 and placed["first_index"] == 3 and placed["anchor_date"] == "2026-12-08"
    assert placed["paper"]["fraction"][:2] == [12 / 1_000_000, 6 / 1_000_000]
    assert placed["model"]["fraction"][:2] == [12 / 1_000_000, 7 / 1_000_000]
    assert placed["paper"]["bands"][:2] == ["p50to75", "p50to75"]
    assert placed["latest_step"] == 2 and placed["latest_date"] == "2026-12-09" and placed["beyond"] == 0


def test_the_latest_step_is_the_last_with_a_value_on_either_path():
    tr = {"present": True, "date": [f"d{i}" for i in range(6)], "paper_cumulative": [None, 10.0, 20.0, None, 30.0, None],
          "model_cumulative": [None, 10.0, 20.0, None, 30.0, None]}
    placed = expectation.placement(tr, K, {**FIXTURE_CONE, "steps": [1, 2, 3, 4, 5],
                                          "quantiles": flat(5)})
    assert placed["first_index"] == 1 and placed["anchor_date"] == "d1"
    assert placed["latest_step"] == 4 and placed["latest_date"] == "d4"


def test_the_model_alone_is_placed_from_its_own_first_session():
    tr = {"present": True, "date": ["d0", "d1", "d2"], "paper_cumulative": [None, None, None],
          "model_cumulative": [None, 5.0, 8.0]}
    placed = expectation.placement(tr, K, {**FIXTURE_CONE, "steps": [1, 2, 3], "quantiles": flat(3)})
    assert placed["first_index"] == 1 and placed["paper"]["first_index"] is None and placed["latest_step"] == 2


def test_beyond_is_the_larger_count_of_the_two_paths():
    long = [float(i + 1) for i in range(9)]
    tr = {"present": True, "date": [f"d{i}" for i in range(9)], "paper_cumulative": long,
          "model_cumulative": long[:5]}
    placed = expectation.placement(tr, K, {**FIXTURE_CONE, "steps": [1, 2, 3], "quantiles": flat(3)})
    assert placed["beyond"] == 6 and placed["paper"]["beyond"] == 6 and placed["model"]["beyond"] == 2


# ---------------------------------------------------------------- the gate (expectationGate's order)


def gate(**over):
    given = {"tracking": TRACKING, "hypothesis": "volmanaged_v0", "cost": 1, "run_id": "r", "capital": 1e6} | over
    return expectation.gate(**given)


def test_the_gate_checks_value_then_book_then_cost_then_run_then_capital():
    assert gate() is None
    assert gate(tracking={**TRACKING, "present": False}) == {"code": "empty", "params": {}}
    assert gate(tracking={**TRACKING, "paper_cumulative": [None], "model_cumulative": [math.nan]})["code"] == "empty"
    assert gate(hypothesis=None, cost=None, run_id=None) == {"code": "no_book", "params": {}}
    assert gate(cost=None, run_id=None) == {"code": "no_cost", "params": {"hypothesis": "volmanaged_v0"}}
    assert gate(run_id=None, capital=None) == {"code": "no_run", "params": {}}
    for capital in (None, 0.0, -1.0, math.nan, math.inf):
        assert gate(capital=capital) == {"code": "no_capital", "params": {"run": "r"}}


def test_a_cone_that_is_not_a_summed_fraction_of_k_is_refused_in_words():
    assert expectation.cone_refusal({"unit": "fraction of K", "how": "summed"}) is None
    assert expectation.cone_refusal({"unit": "USD", "how": "summed"}) == {
        "code": "unit", "params": {"unit": "USD", "how": "summed"}}
    assert expectation.cone_refusal({"unit": "fraction of K", "how": "compounded"})["code"] == "unit"
    assert expectation.cone_refusal({"unit": "fraction of K x", "how": "summed"})["code"] == "unit"


# ---------------------------------------------------------------- LV6b: the live-start cone


def paper_days(n: int, seed: int = 7, gaps: tuple[int, ...] = ()) -> tuple[list[str], list[float | None]]:
    rng = np.random.default_rng(seed)
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-01-05", periods=n)]
    values: list[float | None] = [float(v) for v in rng.normal(40.0, 900.0, n).round(2)]
    for i in gaps:
        values[i] = None
    return dates, values


def test_the_live_series_starts_at_the_first_value_drops_gaps_and_is_a_fraction_of_k():
    dates, values = paper_days(40, gaps=(5, 9))
    values[:3] = [None, None, None]
    s = expectation.live_series(dates, values, 1_000_000.0)
    assert s.index[0] == pd.Timestamp(dates[3]) and len(s) == 40 - 3 - 2
    assert s.iloc[0] == values[3] / 1_000_000.0
    assert pd.Timestamp(dates[5]) not in s.index


def test_the_live_start_cone_is_sv6_on_the_paper_series():
    dates, values = paper_days(60)
    out = expectation.live_start_cone(dates, values, 1_000_000.0)
    r = expectation.live_series(dates, values, 1_000_000.0)
    block = bootstrap.optimal_block_length(r)["stationary"]
    want = bootstrap.cone(r, "A", 252, block=block)
    assert out["refusal"] is None
    assert out["n"] == 60 and out["start_date"] == dates[0] and out["end_date"] == dates[-1]
    assert out["block"] == block and out["reps"] == bootstrap.REPS and out["seed"] == bootstrap.SEED
    assert out["horizon"] == 60 == len(out["steps"])  # never more than n (SV6)
    assert out["how"] == "summed"
    for q in bootstrap.CONE_PERCENTILES:
        assert np.array_equal(np.asarray(out["quantiles"][str(q)]), want["quantiles"][str(q)])


def test_the_live_start_cone_horizon_stops_at_one_year():
    dates, values = paper_days(300)
    assert expectation.live_start_cone(dates, values, 1e6, reps=50)["horizon"] == 252


def test_born_failing_fewer_than_thirty_paper_sessions_get_no_live_cone():
    dates, values = paper_days(40, gaps=tuple(range(11)))
    out = expectation.live_start_cone(dates, values, 1e6)
    assert out["quantiles"] is None and out["refusal"] == {"code": "live_short",
                                                             "params": {"n": "29", "min": "30"}}


def test_born_failing_a_paper_series_without_spread_gets_no_live_cone():
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-01-05", periods=40)]
    out = expectation.live_start_cone(dates, [0.0] * 40, 1e6)  # a book that held nothing
    assert out["quantiles"] is None and out["refusal"]["code"] == "live_flat"


def test_the_live_cone_does_not_change_what_it_is_given():
    dates, values = paper_days(35)
    before = (list(dates), list(values))
    expectation.live_start_cone(dates, values, 1e6, reps=20)
    assert (dates, values) == before


# ---------------------------------------------------------------- LV6b: the paths placed by finite session


def paper_tracking(dates: list[str], values: list[float | None]) -> dict:
    """LV5 rows as the route reads them: the daily paper P&L and the paper and model running totals (a gap in both)."""
    def running(vs):
        out, acc = [], 0.0
        for v in vs:
            out.append(None if v is None else (acc := acc + v))
        return out
    return {"present": True, "date": dates, "paper": values, "model": list(values),
            "paper_cumulative": running(values), "model_cumulative": running(values)}


def test_born_failing_the_live_placement_counts_finite_sessions_not_rows():
    dates, values = paper_days(40, gaps=(5,))  # 39 finite sessions: the cone has 39 steps, the rows are 40
    tracking = paper_tracking(dates, values)
    cone = expectation.live_start_cone(dates, values, 1_000_000.0, reps=50)
    placed = expectation.live_placement(tracking, 1_000_000.0, cone)
    finite = [v for v in values if v is not None]
    assert cone["horizon"] == 39 and placed["horizon"] == 39
    assert placed["beyond"] == 0 and placed["latest_step"] == 39 and placed["latest_date"] == dates[-1]
    for path in (placed["paper"], placed["model"]):
        assert path["beyond"] == 0 and None not in path["fraction"]
        for k in range(39):  # step k + 1 is the sum of the first k + 1 finite sessions
            assert path["fraction"][k] == pytest.approx(sum(finite[:k + 1]) / 1_000_000.0, rel=REL)
            cut = [cone["quantiles"][key][k] for key in ("5", "25", "50", "75", "95")]
            assert path["bands"][k] == expectation.cone_band(path["fraction"][k], cut)


def test_the_live_placement_keeps_the_row_of_the_anchor_and_names_the_dates_of_the_sessions():
    dates, values = paper_days(40, gaps=(5,))
    values[:3] = [None, None, None]  # three leading rows without a value, then a gap at row 5
    tracking = paper_tracking(dates, values)
    cone = expectation.live_start_cone(dates, values, 1e6, reps=50)
    placed = expectation.live_placement(tracking, 1e6, cone)
    assert placed["first_index"] == 3 and placed["paper"]["first_index"] == 3 == placed["model"]["first_index"]
    assert placed["anchor_date"] == dates[3] and placed["horizon"] == 36 and placed["latest_step"] == 36
    assert placed["latest_date"] == dates[-1] and placed["beyond"] == 0
    assert placed["paper"]["fraction"][1] == pytest.approx(sum(v for v in values[3:5] if v is not None) / 1e6)
    assert placed["paper"]["fraction"][2] == pytest.approx(sum(v for v in values[3:7] if v is not None) / 1e6)


def test_the_live_placement_without_a_gap_is_the_row_placement():
    dates, values = paper_days(35)
    tracking = paper_tracking(dates, values)
    cone = expectation.live_start_cone(dates, values, 1e6, reps=50)
    assert expectation.live_placement(tracking, 1e6, cone) == expectation.placement(tracking, 1e6, cone)
