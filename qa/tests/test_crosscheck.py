"""Tests for the reference cross-check (TASKS 3.4). Everything is built in memory: no file writes here."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from crosscheck import compare, dumps, reference
from crosscheck.compare import FAIL, INFO, PASS, SKIP

HAND = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, 0.015, -0.005]
DATES = ["2020-01-02", "2020-01-03", "2020-01-06", "2020-01-07", "2020-02-03", "2020-02-04", "2020-03-02",
         "2020-03-03"]


def session_dates(n: int) -> list[str]:
    if n <= len(DATES):
        return DATES[:n]
    return [str(d.date()) for d in pd.bdate_range("2015-01-01", periods=n)]


def doc(basis: str = "B", r=None, bench=None, ours=None, **extra) -> dict:
    r = HAND if r is None else r
    return {"schema": dumps.SCHEMA, "case": f"hand_{basis}", "kind": "series", "source": "hand-built",
            "basis": basis, "periods": 252, "dates": session_dates(len(r)), "r": r, "bench": bench,
            "values": {"ours": ours or {}, **extra.get("values", {})}, "missing": extra.get("missing", {})}


def refs_for(document: dict) -> dict:
    return reference.series_references(dumps.parse_case(document))


# ---------- reference adapters equal the catalogue formulas on hand-computed inputs ----------

def test_sharpe_vol_sortino_follow_the_catalogue():
    r = np.array(HAND)
    refs = refs_for(doc())
    assert refs["sharpe"].value == pytest.approx(r.mean() / r.std(ddof=1) * math.sqrt(252), rel=1e-12)
    assert refs["vol"].value == pytest.approx(r.std(ddof=1) * math.sqrt(252), rel=1e-12)
    downside = math.sqrt(np.mean(np.minimum(r, 0) ** 2))  # denominator over all n, target 0
    assert refs["sortino"].value == pytest.approx(r.mean() / downside * math.sqrt(252), rel=1e-12)


def test_cagr_and_total_return_by_basis():
    r = np.array(HAND)
    a, b = refs_for(doc("A")), refs_for(doc("B"))
    assert a["total_return"].value == pytest.approx(r.sum(), rel=1e-12)
    assert a["cagr"].value == pytest.approx((1 + r.sum()) ** (252 / len(r)) - 1, rel=1e-12)
    assert b["total_return"].value == pytest.approx(np.prod(1 + r) - 1, rel=1e-12)
    assert b["cagr"].value == pytest.approx(np.prod(1 + r) ** (252 / len(r)) - 1, rel=1e-12)


def test_max_drawdown_basis_a_floors_the_peak_at_zero_and_basis_b_starts_at_k():
    r = [0.1, -0.05, -0.1, 0.2]
    a, b = refs_for(doc("A", r=r)), refs_for(doc("B", r=r))
    assert a["max_drawdown"].value == pytest.approx(0.15, rel=1e-12)  # cumsum .1 .05 -.05: 0.1 - (-0.05)
    assert b["max_drawdown"].value == pytest.approx(1 - 1.1 * 0.95 * 0.9 / 1.1, rel=1e-12)
    losing_start = refs_for(doc("A", r=[-0.1, 0.05, 0.0]))
    assert losing_start["max_drawdown"].value == pytest.approx(0.1, rel=1e-12)  # peak is the floor at 0


def test_var_and_cvar_are_historical_with_linear_quantiles():
    r = np.array(HAND)
    refs = refs_for(doc())
    q05 = np.quantile(r, 0.05)  # numpy default is linear
    assert refs["var_95"].value == pytest.approx(-q05, rel=1e-12)
    assert refs["cvar_95"].value == pytest.approx(-r[r <= q05].mean(), rel=1e-12)


def test_skew_and_kurtosis_use_the_bias_corrected_estimators():
    from scipy import stats
    r = np.array(HAND)
    refs = refs_for(doc())
    assert refs["skew"].value == pytest.approx(stats.skew(r, bias=False), rel=1e-12)
    assert refs["excess_kurtosis"].value == pytest.approx(stats.kurtosis(r, fisher=True, bias=False), rel=1e-12)


def test_psr_matches_the_dsr_paper_golden_fixture():
    # Bailey and Lopez de Prado, DSR paper: SR per period 2.5/sqrt(250), T 1250, skew -3, kurtosis 10.
    # SR0 from the paper's N = 100 trials and V = 1/(2 x 250); the rounded 0.1132 would give 0.90026.
    from scipy.stats import norm
    gamma = 0.5772156649015329
    sr0 = math.sqrt(1 / 500) * ((1 - gamma) * norm.ppf(1 - 1 / 100) + gamma * norm.ppf(1 - 1 / (100 * math.e)))
    assert sr0 == pytest.approx(0.1132, abs=5e-5)
    assert reference.psr(2.5 / math.sqrt(250), sr0, 1250, -3.0, 10.0) == pytest.approx(0.9004, abs=5e-5)


def test_spanning_alpha_reference_is_newey_west_without_small_sample_correction():
    rng = np.random.default_rng(7)
    b = rng.normal(0, 0.01, 300)
    r = 0.0002 + 0.6 * b + rng.normal(0, 0.005, 300)
    refs = refs_for(doc(r=r.tolist(), bench=b.tolist()))
    X = np.column_stack([np.ones_like(b), b])
    beta = np.linalg.lstsq(X, r, rcond=None)[0]
    assert refs["alpha_annual_pct"].value == pytest.approx(252 * beta[0] * 100, rel=1e-10)
    assert refs["beta"].value == pytest.approx(beta[1], rel=1e-10)
    u = X * (r - X @ beta)[:, None]
    meat = u.T @ u
    for k in range(1, 6):
        g = u[k:].T @ u[:-k]
        meat += (1 - k / 6) * (g + g.T)
    inv = np.linalg.inv(X.T @ X)
    t5 = beta[0] / math.sqrt((inv @ meat @ inv)[0, 0])
    assert refs["alpha_t_5"].value == pytest.approx(t5, rel=1e-9)


def test_multiple_testing_reference_on_hand_values():
    p = [0.01, 0.04, 0.03, 0.5]
    refs = reference.registry_references(p)
    assert refs["bonferroni_p"].value == pytest.approx([0.04, 0.16, 0.12, 1.0])
    assert refs["holm_p"].value == pytest.approx([0.04, 0.09, 0.09, 0.5])
    assert refs["bh_q"].value == pytest.approx([0.04, 0.0533333333333, 0.0533333333333, 0.5])


# ---------- comparison statuses ----------

def test_equal_value_passes_and_the_row_carries_our_value_the_reference_and_the_difference():
    value = refs_for(doc())["sharpe"].value
    rows = [row for row in compare.compare_case(dumps.parse_case(doc(ours={"sharpe": value})))
            if row.metric == "sharpe" and row.side == "ours"]
    assert [row.status for row in rows] == [PASS]
    assert rows[0].value == value and rows[0].ref == value and rows[0].diff == 0.0


def test_born_failing_a_value_off_by_1e_minus_6_fails_and_sets_exit_code_1():
    value = refs_for(doc())["sharpe"].value
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe": value * (1 + 1e-6)})))
    bad = [row for row in rows if row.metric == "sharpe" and row.side == "ours"]
    assert bad[0].status == FAIL
    assert compare.exit_code(rows) == 1


def test_born_failing_wrong_annualisation_sqrt_365_fails():
    r = np.array(HAND)
    wrong = r.mean() / r.std(ddof=1) * math.sqrt(365)
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe": wrong})))
    assert compare.exit_code(rows) == 1


def test_value_within_tolerance_passes():
    value = refs_for(doc())["vol"].value
    rows = compare.compare_case(dumps.parse_case(doc(ours={"vol": value * (1 + 1e-12)})))
    assert compare.exit_code(rows) == 0


def test_missing_ours_is_a_skip_with_its_reason_and_strict_mode_fails_it():
    rows = compare.compare_case(dumps.parse_case(doc(missing={"sharpe": "nq_terminal.analytics.perf not found"})))
    skipped = [row for row in rows if row.metric == "sharpe" and row.side == "ours"]
    assert skipped[0].status == SKIP and "perf not found" in skipped[0].note
    assert compare.exit_code(rows) == 0
    assert compare.exit_code(rows, strict=True) == 1


def test_documented_difference_is_info_and_never_fails():
    rows = compare.compare_case(dumps.parse_case(doc()))
    info = [row for row in rows if row.status == INFO]
    assert info, "the parametric quantstats VaR must be shown as a documented difference"
    assert all(row.note for row in info)


def test_nan_on_one_side_only_fails():
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe": None, "vol": float("nan")})))
    statuses = {row.metric: row.status for row in rows if row.side == "ours"}
    assert statuses["vol"] == FAIL


def test_vector_metric_compares_the_worst_difference():
    refs = refs_for(doc(r=np.linspace(-0.01, 0.012, 80).tolist(), ours=None))
    assert "rolling_sharpe_63" in refs
    good = list(refs["rolling_sharpe_63"].value)
    document = doc(r=np.linspace(-0.01, 0.012, 80).tolist(), ours={"rolling_sharpe_63": good})
    assert compare.exit_code(compare.compare_case(dumps.parse_case(document))) == 0
    shifted = [None if v is None else v + 1e-3 for v in good]
    document["values"]["ours"]["rolling_sharpe_63"] = shifted
    assert compare.exit_code(compare.compare_case(dumps.parse_case(document))) == 1


# ---------- dump validation ----------

def test_schema_errors_are_refused():
    bad = doc()
    del bad["r"]
    with pytest.raises(dumps.DumpError):
        dumps.parse_case(bad)
    wrong = doc()
    wrong["schema"] = "something-else/9"
    with pytest.raises(dumps.DumpError):
        dumps.parse_case(wrong)
    short = doc()
    short["dates"] = short["dates"][:-1]
    with pytest.raises(dumps.DumpError):
        dumps.parse_case(short)


# ---------- command line ----------

def test_report_lines_show_value_reference_and_difference():
    from crosscheck import report
    value = refs_for(doc())["sharpe"].value
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe": value * (1 + 1e-6)})))
    text = "\n".join(report.lines(rows))
    line = next(item for item in text.splitlines() if " sharpe " in f" {item} " and "ours" in item)
    assert "FAIL" in line and f"{value:.12g}"[:10] in line and "e-" in line
    assert "FAIL 1" in text.replace(":", "")


def test_main_without_dumps_exits_2(tmp_path_factory):
    from crosscheck.__main__ import main
    missing = tmp_path_factory.getbasetemp() / "no_such_dump_folder"
    assert main(["--dir", str(missing)]) == 2


def test_dump_dir_prefers_the_argument_then_the_environment(monkeypatch):
    from pathlib import Path

    from crosscheck import paths
    monkeypatch.setenv(paths.ENV, "C:/from/env")
    assert paths.dump_dir("C:/from/arg") == Path("C:/from/arg")
    assert paths.dump_dir(None) == Path("C:/from/env")
    monkeypatch.delenv(paths.ENV)
    assert paths.dump_dir(None) == paths.DEFAULT_DUMP_DIR


def test_a_second_implementation_of_the_same_metric_is_compared_under_its_own_label():
    value = refs_for(doc())["sharpe_ci_lo"].value
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe_ci_lo": value,
                                                           "sharpe_ci_lo@perf": value * (1 + 1e-6)})))
    sides = {row.side: row.status for row in rows if row.metric == "sharpe_ci_lo"}
    assert sides == {"ours": PASS, "ours@perf": FAIL}


def test_daily_only_items_are_not_referenced_for_a_monthly_book():
    monthly = doc(r=np.linspace(-0.02, 0.03, 30).tolist())
    monthly["periods"] = 12
    refs = refs_for(monthly)
    assert not {"best_day", "shortfall21_1pct", "rolling_sharpe_63"} & set(refs)


def test_monthly_reference_groups_by_year_and_month_summing_a_and_compounding_b():
    # quantstats aggregate_returns('M') returns the daily series unchanged; 'ME' is the year-month grouping.
    a, b = refs_for(doc("A")), refs_for(doc("B"))
    jan, feb, mar = HAND[:4], HAND[4:6], HAND[6:]
    assert a["monthly_returns"].value == pytest.approx({"2020-01": sum(jan), "2020-02": sum(feb), "2020-03": sum(mar)})
    assert b["monthly_returns"].value == pytest.approx({"2020-01": np.prod(1 + np.array(jan)) - 1,
                                                        "2020-02": np.prod(1 + np.array(feb)) - 1,
                                                        "2020-03": np.prod(1 + np.array(mar)) - 1})
    assert a["best_month"].value == pytest.approx(max(sum(jan), sum(feb), sum(mar)))


def test_a_metric_absent_from_the_dump_is_a_skip_even_when_missing_does_not_name_it():
    """Born failing: a dump that silently drops a metric used to produce no row, so --strict passed."""
    value = refs_for(doc())["sharpe"].value
    rows = compare.compare_case(dumps.parse_case(doc(ours={"sharpe": value})))
    vol = [row for row in rows if row.metric == "vol" and row.side == "ours"]
    assert vol and vol[0].status == SKIP and "no terminal value" in vol[0].note
    assert compare.exit_code(rows, strict=True) == 1


@pytest.mark.parametrize("part", ["results", "results/x", "data", "live", "backtests/output", ".", ".."])
def test_protected_project_folders_are_refused(monkeypatch, part):
    from crosscheck import paths
    folder = paths.PROJECT_ROOT / part
    with pytest.raises(ValueError, match="refused dump folder"):
        paths.dump_dir(str(folder))
    monkeypatch.setenv(paths.ENV, str(folder))
    with pytest.raises(ValueError, match="refused dump folder"):
        paths.dump_dir(None)
