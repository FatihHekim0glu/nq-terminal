"""SV3b and SV8 effective numbers served by the backend (ANALYTICS_CATALOG SV3b, SV8 step 8; C8 mirror).

`analytics/neff.py` replaces the browser's `web/src/quant` estimators and `effectiveNModel.ts`, so each value must equal
the value the browser gave: the golden vectors of `terminal/qa/golden/p12_neff.json` (numpy and scipy, to which the
browser port is pinned at 1e-12) are the shared reference, read here. Born-failing cases (the variants that must stay
wrong) sit beside them.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import deflated, neff

GOLDEN = Path(__file__).resolve().parents[2] / "qa" / "golden" / "p12_neff.json"
REL = 1e-12


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def close(a, b, rel=REL) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return a == pytest.approx(b, rel=rel, abs=1e-15)


# ---------------------------------------------------------------- the estimators against the golden vectors


def test_pearson_equals_numpy_corrcoef_on_the_golden_panel(golden):
    columns = np.array(golden["panel"]["columns"]).T
    got = neff.pearson(columns)
    want = np.array(golden["correlation"])
    assert got.shape == want.shape
    np.testing.assert_allclose(got, want, rtol=0, atol=1e-13)
    assert np.array_equal(got, got.T) and np.all(np.diag(got) == 1.0)


def test_eigenvalues_are_largest_first_and_equal_the_golden(golden):
    got = neff.eigenvalues(np.array(golden["correlation"]))
    np.testing.assert_allclose(got, golden["eigenvalues"], rtol=REL, atol=1e-14)
    assert list(got) == sorted(got, reverse=True)


def test_participation_and_li_ji_equal_the_golden_on_the_panel_and_on_every_hand_case(golden):
    assert close(neff.participation_ratio(np.array(golden["eigenvalues"])), golden["participation_ratio"])
    assert close(neff.li_ji_count(np.array(golden["eigenvalues"])), golden["li_ji"])
    for case in golden["eigen_cases"]:
        eig = np.array(case["eigenvalues"])
        assert close(neff.participation_ratio(eig), case["participation_ratio"]), case["name"]
        assert close(neff.li_ji_count(eig), case["li_ji"]), case["name"]


def test_born_failing_li_ji_jumps_at_an_integer_eigenvalue_of_two():
    # 2 counts 1 (1 + 0), just under 2 counts almost 2 (1 + 0.999...): the edge the catalogue states
    assert neff.li_ji_count(np.array([2.0, 1.0, 0.0])) == 2.0
    assert neff.li_ji_count(np.array([1.999999, 1.0, 0.000001])) == pytest.approx(3.0, abs=1e-9)


def test_born_failing_li_ji_snaps_an_eigenvalue_a_few_ulps_off_an_integer_to_it():
    # numpy eigvalsh gives 2.9999999999999996 for a matrix of ones: exactly 3, so 1 + (3 - 3), never 1 + 0.9999999999999996
    ones = np.linalg.eigvalsh(np.ones((3, 3)))[::-1]
    assert ones[0] != 3.0 and abs(ones[0] - 3.0) < 1e-15
    assert neff.li_ji_count(ones) == pytest.approx(1.0, abs=1e-12)  # the noise eigenvalues add about 6e-16
    assert neff.li_ji_count(np.array([3.0000000000000004, 0.0, 0.0])) == 1.0
    assert neff.li_ji_count(np.array([1.9999999999999998, 1.0, 1.0e-16])) == pytest.approx(2.0, abs=1e-12)
    # a real fraction is never snapped
    assert neff.li_ji_count(np.array([2.999999, 0.000001, 0.0])) == pytest.approx(2.0, abs=1e-9)


def test_the_members_view_of_identical_members_counts_one_li_ji():
    got = neff.effective_members(np.ones((3, 3)), ["x", "y", "z"])
    assert got["li_ji"] == pytest.approx(1.0, abs=1e-12) and got["participation"] == pytest.approx(1.0, abs=1e-12)


def test_participation_is_m_for_equal_eigenvalues_and_one_for_one():
    assert neff.participation_ratio(np.array([1.0, 1.0, 1.0, 1.0])) == pytest.approx(4.0, rel=1e-15)
    assert neff.participation_ratio(np.array([4.0, 0.0, 0.0, 0.0])) == pytest.approx(1.0, rel=1e-15)


def test_clusters_equal_scipy_at_the_cut_and_at_every_cut_between_the_heights(golden):
    corr = np.array(golden["correlation"])
    assert neff.flat_clusters(corr) == golden["clusters"]
    for entry in golden["cluster_sweep"]:
        assert neff.flat_clusters(corr, entry["cut"]) == entry["clusters"], entry["cut"]


def test_the_cluster_cut_is_the_preregistered_half_on_one_minus_rho():
    assert neff.CLUSTER_CUT == 0.5 and neff.MIN_COMMON_SESSIONS == 252 and neff.DAILY_PERIODS == 252


def test_rank_clusters_puts_the_largest_first_then_the_first_member():
    assert neff.rank_clusters([[0], [1, 2], [3], [4, 5]]) == [[1, 2], [4, 5], [0], [3]]


def test_expected_max_sr0_equals_the_golden_cases_and_is_none_where_the_browser_gave_null(golden):
    for case in golden["sr0_cases"]:
        got = neff.expected_max_sr0(case["variance"], case["n_trials"], case["gamma"])
        assert close(got, case["value"]), case
    assert neff.expected_max_sr0(0.01, 1.0, 0.5772156649015329) is None
    assert neff.expected_max_sr0(-1e-9, 21, 0.5772156649015329) is None
    assert neff.expected_max_sr0(float("nan"), 21, 0.5772156649015329) is None


def test_expected_max_sr0_takes_a_fractional_n_and_the_integer_one_equals_deflated(golden):
    v0 = golden["sv3_anchor"]["variance_null"]
    assert neff.expected_max_sr0(v0, 21, golden["sv3_anchor"]["euler_gamma"]) == pytest.approx(
        deflated.expected_max_sharpe(21, v0), rel=1e-15)
    assert neff.expected_max_sr0(v0, 12.3, 0.5772156649015329) < neff.expected_max_sr0(v0, 21, 0.5772156649015329)


def test_probabilistic_sharpe_equals_the_golden_cases_including_the_nulls(golden):
    for case in golden["psr_cases"]:
        got = neff.probabilistic_sharpe(case["sr"], case["sr0"], case["n"], case["skew"], case["kurt"])
        assert close(got, case["value"]), case
    paper = golden["paper_example"]
    sr0 = neff.expected_max_sr0(paper["variance"], paper["n_trials"], paper["gamma"])
    assert round(sr0, 4) == 0.1132
    dsr = neff.probabilistic_sharpe(paper["sr"], sr0, paper["sessions"], paper["skew"], paper["kurt"])
    assert round(dsr, 4) == 0.9004


def test_the_served_sv3_view_at_n_21_is_reproduced_as_the_browser_reproduced_it(golden):
    """The anchor of the old browser formula (trials.test.ts): SR0 to 1e-12 and every dsr_null to 1e-9."""
    anchor = golden["sv3_anchor"]
    sr0 = neff.expected_max_sr0(anchor["variance_null"], anchor["n_trials"], anchor["euler_gamma"])
    assert abs(sr0 - anchor["sr0_null_session"]) <= 1e-12
    for row in anchor["rows"]:
        scaled = sr0 * math.sqrt(252 / row["periods"])
        assert abs(scaled - row["sr0_null_own_period"]) <= 1e-12
        dsr = neff.probabilistic_sharpe(row["sr"], row["sr0_null_own_period"], row["n"], row["skew"], row["kurt"])
        assert abs(dsr - row["dsr_null"]) <= 1e-9, row["name"]


# ---------------------------------------------------------------- SV3b over trials


def trial(name: str, r: pd.Series, periods: int = 252) -> deflated.Trial:
    return deflated.Trial(name=name, kind="daily" if periods == 252 else "monthly", periods=periods, r=r)


def panel_trials(golden, monthly: int = 2) -> list[deflated.Trial]:
    dates = pd.DatetimeIndex(golden["panel"]["dates"], name="session")
    columns = zip(golden["panel"]["names"], golden["panel"]["columns"])
    out = [trial(n, pd.Series(col, index=dates)) for n, col in columns]
    rng = np.random.default_rng(5)
    months = pd.date_range("2020-01-31", periods=48, freq="ME")
    out += [trial(f"m{i}", pd.Series(rng.standard_normal(48) * 0.03 + 0.004, index=months), periods=12)
            for i in range(monthly)]
    return out


@pytest.fixture(scope="module")
def served(golden) -> tuple[list[deflated.Trial], dict, dict]:
    trials = panel_trials(golden)
    found = deflated.registry_dsr(trials)
    return trials, found, neff.effective_trials(trials, found)


def test_the_view_has_no_refusal_and_the_golden_matrix_eigenvalues_clusters(served, golden):
    _, _, got = served
    assert got["refusal"] is None
    assert got["daily"] == golden["panel"]["names"] and got["monthly"] == ["m0", "m1"]
    np.testing.assert_allclose(got["correlation"], golden["correlation"], rtol=0, atol=1e-13)
    np.testing.assert_allclose(got["eigenvalues"], golden["eigenvalues"], rtol=REL, atol=1e-14)
    assert got["clusters"] == golden["clusters"]
    assert got["window"] == {"first": golden["panel"]["dates"][0], "last": golden["panel"]["dates"][-1],
                             "sessions": 400}
    assert sorted(got["sequence"]) == list(range(9))


def test_the_sequence_lists_the_clusters_largest_first(served):
    _, _, got = served
    assert got["sequence"] == [i for group in neff.rank_clusters(got["clusters"]) for i in group]


def test_the_estimates_are_registered_participation_li_ji_and_clusters_with_the_monthly_books_added(served, golden):
    _, found, got = served
    by = {e["id"]: e for e in got["estimates"]}
    assert [e["id"] for e in got["estimates"]] == ["registered", "participation", "li_ji", "clusters"]
    assert by["registered"] == {"id": "registered", "n_daily": 9.0, "n_total": 11.0,
                                "sr0_session": found["sr0_null_session"],
                                "sr0_annual": found["sr0_null_session"] * math.sqrt(252), "served": True}
    assert close(by["participation"]["n_daily"], golden["participation_ratio"])
    assert close(by["li_ji"]["n_daily"], golden["li_ji"])
    assert by["clusters"]["n_daily"] == len(golden["clusters"])
    for key in ("participation", "li_ji", "clusters"):
        e = by[key]
        assert e["served"] is False and e["n_total"] == pytest.approx(e["n_daily"] + 2, rel=1e-15)
        sr0 = neff.expected_max_sr0(found["variance_null"], e["n_total"], found["euler_gamma"])
        assert close(e["sr0_session"], sr0) and close(e["sr0_annual"], sr0 * math.sqrt(252))


def test_born_failing_the_variance_is_v0_not_v(served):
    _, found, got = served
    wrong = neff.expected_max_sr0(found["variance"], got["estimates"][1]["n_total"], found["euler_gamma"])
    assert not close(got["estimates"][1]["sr0_session"], wrong)


def test_the_registered_sr0_is_the_one_the_view_serves_and_the_formula_reproduces_it(served):
    _, found, _ = served
    again = neff.expected_max_sr0(found["variance_null"], found["n_trials"], found["euler_gamma"])
    assert abs(again - found["sr0_null_session"]) <= 1e-12


def test_every_row_has_its_dsr_under_each_n_in_its_own_period(served):
    _, found, got = served
    assert [d["name"] for d in got["dsr"]] == [r["name"] for r in found["rows"]]
    by = {e["id"]: e for e in got["estimates"]}
    for row, d in zip(found["rows"], got["dsr"]):
        assert d["periods"] == row["periods"] and close(d["served"], row["dsr_null"])
        for key in ("participation", "li_ji", "clusters"):
            sr0 = neff.expected_max_sr0(found["variance_null"], by[key]["n_total"], found["euler_gamma"])
            want = neff.probabilistic_sharpe(row["sr"], sr0 * math.sqrt(252 / row["periods"]), row["n"],
                                             row["skew"], row["kurt"])
            assert close(d[key], want), (row["name"], key)


def test_a_smaller_n_raises_every_dsr_it_changes(served):
    _, _, got = served
    for d in got["dsr"]:
        for key in ("participation", "li_ji", "clusters"):
            if d[key] is not None and d["served"] is not None:
                assert d[key] >= d["served"] - 1e-12


def test_no_daily_trial_is_a_refusal_with_nothing_drawn(golden):
    months = pd.date_range("2020-01-31", periods=48, freq="ME")
    rng = np.random.default_rng(1)
    trials = [trial(f"m{i}", pd.Series(rng.standard_normal(48) * 0.03 + 0.004, index=months), 12) for i in range(3)]
    got = neff.effective_trials(trials, deflated.registry_dsr(trials))
    assert got["refusal"] == {"kind": "no_daily", "name": None, "sessions": None}
    assert got["correlation"] == [] and got["estimates"] == [] and got["dsr"] == [] and got["window"] is None


def test_born_failing_251_common_sessions_refuse_and_252_do_not(golden):
    trials = panel_trials(golden)
    for keep, ok in ((251, False), (252, True)):
        cut = [trial(t.name, t.r.iloc[:keep], t.periods) if t.periods == 252 else t for t in trials]
        got = neff.effective_trials(cut, deflated.registry_dsr(cut))
        assert (got["refusal"] is None) is ok
        if not ok:
            assert got["refusal"] == {"kind": "too_few", "name": None, "sessions": 251}


def test_the_common_window_is_the_sessions_every_daily_trial_has(golden):
    trials = panel_trials(golden)
    first = trials[0]
    short = trial(first.name, first.r.iloc[10:], first.periods)
    cut = [short, *trials[1:]]
    got = neff.effective_trials(cut, deflated.registry_dsr(cut))
    assert got["window"]["sessions"] == 390 and got["window"]["first"] == golden["panel"]["dates"][10]


def test_a_trial_that_does_not_vary_on_the_common_window_is_refused_by_name(golden):
    trials = panel_trials(golden)
    flat = trials[0]
    # varies over its whole series but is constant on the common window (the others start 300 sessions later)
    values = np.zeros(len(flat.r))
    values[:100] = np.linspace(-0.01, 0.01, 100)
    own = trial(flat.name, pd.Series(values, index=flat.r.index))
    late = [trial(t.name, t.r.iloc[100:], t.periods) if t.periods == 252 and t.name != flat.name else t
            for t in trials[1:]]
    cut = [own, *late]
    got = neff.effective_trials(cut, deflated.registry_dsr(cut))
    assert got["refusal"] == {"kind": "degenerate", "name": flat.name, "sessions": None}


def test_a_view_over_trials_with_a_plain_integer_index_still_serves_its_window():
    rng = np.random.default_rng(3)
    trials = [trial(f"t{i}", pd.Series(rng.standard_normal(300) * 0.01 + 0.0005)) for i in range(4)]
    got = neff.effective_trials(trials, deflated.registry_dsr(trials))
    assert got["refusal"] is None and got["window"] == {"first": "0", "last": "299", "sessions": 300}


# ---------------------------------------------------------------- SV8: effective members


NAMES = ["a_v0", "b_v0", "c_v0", "d_v0"]
FOUR = np.array([[1, 0.9, 0.85, 0.1], [0.9, 1, 0.8, 0.05], [0.85, 0.8, 1, 0], [0.1, 0.05, 0, 1]], dtype=float)


def test_four_members_give_numpys_participation_li_ji_and_scipys_clusters():
    got = neff.effective_members(FOUR, NAMES)
    assert got["refusal"] is None and got["k"] == 4 and got["cut"] == 0.5
    assert close(got["participation"], 1.9115890083632017) and close(got["li_ji"], 2.9999999999999987)
    assert got["clusters"] == [["a_v0", "b_v0", "c_v0"], ["d_v0"]]
    assert got["strongest"] == {"a": "a_v0", "b": "b_v0", "rho": 0.9}


def test_identical_members_are_one_and_uncorrelated_members_are_k():
    ones = neff.effective_members(np.ones((3, 3)), ["x", "y", "z"])
    assert ones["participation"] == pytest.approx(1.0, rel=1e-12) and ones["clusters"] == [["x", "y", "z"]]
    eye = neff.effective_members(np.eye(3), ["x", "y", "z"])
    assert eye["participation"] == pytest.approx(3.0, rel=1e-12) and eye["clusters"] == [["x"], ["y"], ["z"]]


def test_the_strongest_pair_is_the_largest_absolute_correlation_and_the_first_on_a_tie():
    m = np.array([[1, -0.7, 0.7], [-0.7, 1, 0.1], [0.7, 0.1, 1]])
    assert neff.effective_members(m, ["x", "y", "z"])["strongest"] == {"a": "x", "b": "y", "rho": -0.7}


def test_one_member_draws_nothing_and_says_why():
    got = neff.effective_members(np.array([[1.0]]), ["only"])
    assert got["refusal"] == {"kind": "single", "name": None}
    assert got["participation"] is None and got["li_ji"] is None and got["clusters"] == [] and got["strongest"] is None


def test_born_failing_a_member_that_does_not_vary_refuses_the_whole_estimate_and_names_it():
    m = np.array([[1.0, np.nan, 0.2], [np.nan, np.nan, np.nan], [0.2, np.nan, 1.0]])
    got = neff.effective_members(m, ["x", "y", "z"])
    assert got["refusal"] == {"kind": "undefined", "name": "y"}
    assert got["participation"] is None and got["clusters"] == []


def test_the_clusters_are_ranked_largest_first_then_by_first_member():
    m = np.eye(5)
    m[3, 4] = m[4, 3] = 0.95
    got = neff.effective_members(m, list("vwxyz"))
    assert got["clusters"] == [["y", "z"], ["v"], ["w"], ["x"]]


def test_the_served_correlation_of_spa_is_the_input_the_estimators_read():
    from nq_terminal.analytics import spa

    rng = np.random.default_rng(2)
    d = rng.standard_normal((400, 4))
    d[:, 1] = d[:, 0] * 0.9 + d[:, 1] * 0.2
    got = neff.effective_members(spa.member_correlation(d), NAMES)
    eig = np.linalg.eigvalsh(np.corrcoef(d, rowvar=False))
    assert close(got["participation"], float(eig.sum() ** 2 / (eig ** 2).sum()))
