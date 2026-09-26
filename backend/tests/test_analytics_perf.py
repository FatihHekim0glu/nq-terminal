"""PF1 to PF6 and PF10 (ANALYTICS_CATALOG.md section 1): hand-computed values, conventions C1 and C2,
parity with `nq_lab.sizing_stats.sharpe`, and the born-failing annualisation guard."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_lab import sizing_stats
from nq_terminal.analytics import perf

R = [0.01, -0.02, 0.03, 0.0, -0.01, 0.02]


def _random(n: int = 600, seed: int = 7) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2012-01-02", periods=n)
    return pd.Series(rng.normal(0.0004, 0.011, n), index=idx)


# ---------- PF1 equity ----------

def test_equity_basis_a_is_capital_times_one_plus_cumsum():
    eq = perf.equity_curve(R, "A", capital=1000.0)
    assert np.allclose(eq.to_numpy(), 1000.0 * (1 + np.cumsum(R)), rtol=0, atol=1e-12)


def test_equity_basis_b_compounds():
    eq = perf.equity_curve(R, "B", capital=1000.0)
    assert np.allclose(eq.to_numpy(), 1000.0 * np.cumprod(1 + np.asarray(R)), rtol=0, atol=1e-12)


def test_equity_keeps_the_session_index():
    r = _random(10)
    assert perf.equity_curve(r, "B").index.equals(r.index)


def test_unknown_basis_is_refused():
    with pytest.raises(ValueError, match="basis"):
        perf.equity_curve(R, "C")


def test_non_finite_returns_are_refused():
    with pytest.raises(ValueError, match="NaN"):
        perf.sharpe([0.01, math.nan, 0.02])


# ---------- PF2 total return and CAGR ----------

def test_total_return_per_basis():
    assert perf.total_return(R, "A") == pytest.approx(sum(R), abs=1e-15)
    assert perf.total_return(R, "B") == pytest.approx(np.prod(1 + np.asarray(R)) - 1, abs=1e-15)


def test_cagr_uses_sessions_not_calendar_days():
    r = [0.001] * 504  # two years of sessions
    assert perf.cagr(r, "B") == pytest.approx(1.001 ** 252 - 1, rel=1e-12)
    assert perf.cagr(r, "A") == pytest.approx((1 + 0.504) ** 0.5 - 1, rel=1e-12)


def test_cagr_of_a_wiped_out_book_is_minus_one_and_below_zero_is_nan():
    assert perf.cagr([-1.0, 0.0], "B") == -1.0
    assert math.isnan(perf.cagr([-0.8, -0.5], "A"))


# ---------- PF3 volatility, PF4 Sharpe ----------

def test_volatility_ddof_one_times_root_252():
    assert perf.annual_volatility(R) == pytest.approx(np.std(R, ddof=1) * math.sqrt(252), rel=1e-14)


def test_sharpe_matches_hand_value_and_sizing_stats():
    r = _random()
    hand = r.mean() / r.std(ddof=1) * math.sqrt(252)
    assert perf.sharpe(r) == pytest.approx(hand, rel=1e-14)
    assert perf.sharpe(r) == pytest.approx(sizing_stats.sharpe(r, 252), rel=1e-14)
    assert perf.sharpe(r.to_numpy()[:120], 12) == pytest.approx(sizing_stats.sharpe(r.to_numpy()[:120], 12), rel=1e-14)


def test_sharpe_is_nan_on_flat_or_single_returns():
    assert math.isnan(perf.sharpe([0.01]))
    assert math.isnan(perf.sharpe([0.25, 0.25, 0.25]))  # sd exactly 0
    assert math.isnan(perf.sharpe([]))


def test_annualisation_other_than_252_or_12_is_refused():
    """Born failing (QA protocol 4): sqrt(365) would inflate the anchor, so the factor itself is refused."""
    r = _random()
    wrong = r.mean() / r.std(ddof=1) * math.sqrt(365)
    assert wrong != pytest.approx(perf.sharpe(r), rel=1e-3)
    with pytest.raises(ValueError, match="periods"):
        perf.sharpe(r, 365)


def test_sharpe_standard_error_is_mertens():
    r = _random(900, seed=3).to_numpy()
    sr = r.mean() / r.std(ddof=1)
    g3 = sps.skew(r, bias=True)
    g4 = sps.kurtosis(r, fisher=False, bias=True)
    se = math.sqrt((1 - g3 * sr + (g4 - 1) / 4 * sr ** 2) / (len(r) - 1))
    assert perf.sharpe_standard_error(r) == pytest.approx(se, rel=1e-13)


def test_sharpe_ci_is_symmetric_196_se_annualised():
    r = _random(900, seed=3)
    lo, hi = perf.sharpe_ci(r)
    half = 1.96 * perf.sharpe_standard_error(r) * math.sqrt(252)
    assert lo == pytest.approx(perf.sharpe(r) - half, rel=1e-13)
    assert hi == pytest.approx(perf.sharpe(r) + half, rel=1e-13)


def test_sharpe_se_for_normal_returns_is_close_to_textbook():
    """For iid normal returns (gamma3 0, gamma4 3) SE_d is sqrt((1 + SR^2/2)/(n-1))."""
    r = np.random.default_rng(11).normal(0.001, 0.01, 200_000)
    sr = r.mean() / r.std(ddof=1)
    assert perf.sharpe_standard_error(r) == pytest.approx(math.sqrt((1 + sr ** 2 / 2) / (len(r) - 1)), rel=5e-3)


# ---------- PF5 Sortino, PF6 Calmar ----------

def test_sortino_denominator_runs_over_all_n_with_target_zero():
    down = math.sqrt((0.02 ** 2 + 0.01 ** 2) / 6)
    assert perf.sortino(R) == pytest.approx(np.mean(R) / down * math.sqrt(252), rel=1e-14)


def test_sortino_is_nan_without_losses():
    assert math.isnan(perf.sortino([0.01, 0.02, 0.0]))


def test_calmar_is_cagr_over_abs_full_sample_max_drawdown():
    r = [0.02, -0.01, -0.03, 0.01, 0.04, -0.02, -0.03, 0.01, 0.05, -0.01]
    assert perf.calmar(r, "A") == pytest.approx(perf.cagr(r, "A") / 0.05, rel=1e-12)


def test_calmar_is_nan_without_drawdown():
    assert math.isnan(perf.calmar([0.01, 0.02], "B"))


# ---------- PF10 stats table ----------

def test_stats_table_values():
    idx = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-06", "2020-02-03", "2020-02-04", "2020-03-02"])
    r = pd.Series(R, index=idx)
    t = perf.stats_table(r, "A")
    assert t["n"] == 6
    assert t["years"] == pytest.approx(6 / 252)
    assert t["hit_rate"] == pytest.approx(3 / 5)  # positive over non-zero sessions
    assert t["best_day"] == 0.03 and t["worst_day"] == -0.02
    assert t["best_month"] == pytest.approx(0.02) and t["worst_month"] == pytest.approx(-0.01)
    assert t["pct_positive_months"] == pytest.approx(2 / 3)
    assert t["skew"] == pytest.approx(sps.skew(R, bias=False), rel=1e-14)
    assert t["excess_kurtosis"] == pytest.approx(sps.kurtosis(R, fisher=True, bias=False), rel=1e-14)


def test_stats_table_basis_b_months_compound():
    idx = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-02-03"])
    t = perf.stats_table(pd.Series([0.1, 0.1, -0.05], index=idx), "B")
    assert t["best_month"] == pytest.approx(0.21, rel=1e-14)


def test_stats_table_on_a_monthly_book_uses_the_rows_as_months():
    idx = pd.date_range("2012-01-31", periods=4, freq="ME")
    t = perf.stats_table(pd.Series([0.02, -0.01, 0.03, 0.01], index=idx), "A", periods=12)
    assert t["years"] == pytest.approx(4 / 12)
    assert t["best_month"] == 0.03 and t["pct_positive_months"] == pytest.approx(0.75)


def test_stats_table_needs_a_date_index_for_months():
    t = perf.stats_table(R, "A")
    assert t["best_month"] is None and t["pct_positive_months"] is None
