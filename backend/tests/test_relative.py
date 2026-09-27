"""Benchmark-relative analytics (ANALYTICS_CATALOG BR1 and BR2; TASKS 3.3).

References:
- BR1 goes through `sizing_stats.spanning_alpha` itself (C8); the anchors are the volmanaged_v0 screen's stored
  headline and `blocks_1tick` alphas, rebuilt here from `volmanaged_v0_daily.csv` (`r_m_1` against `r_bh_1`).
- BR2 is checked against the Nautilus pyo3 `InformationRatio` and `TrackingError`, fed `{ts_ns: r}` on a session
  index (C3, DL7), within 1e-12.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import pytest
from nautilus_trader.analysis import InformationRatio, TrackingError

from nq_lab import sizing_stats
from nq_lab.config import RESULTS
from nq_terminal.analytics.relative import (
    active_returns,
    align_pair,
    alpha_beta,
    alpha_by_block,
    information_ratio,
    relative_summary,
    tracking_error,
)

SCREENS = RESULTS / "screens"
TOL = 1e-12


@pytest.fixture(scope="module")
def volmanaged() -> tuple[pd.Series, pd.Series, dict]:
    daily = pd.read_csv(SCREENS / "volmanaged_v0_daily.csv", parse_dates=["date"], encoding="utf-8")
    daily = daily.set_index("date")
    screen = json.loads((SCREENS / "volmanaged_v0.json").read_text(encoding="utf-8"))
    return daily["r_m_1"], daily["r_bh_1"], screen


def _nautilus(stat, r: pd.Series, b: pd.Series) -> float:
    to_ns = lambda s: {int(t.value): float(v) for t, v in s.items()}  # noqa: E731
    return float(stat.calculate_from_returns_with_benchmark(to_ns(r), to_ns(b)))


def _synthetic(n: int = 750, seed: int = 7) -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2012-01-02", periods=n)
    b = rng.normal(0.0004, 0.012, n)
    r = 0.6 * b + rng.normal(0.0002, 0.006, n)
    return pd.Series(r, idx), pd.Series(b, idx)


# ---------- alignment ----------

def test_align_pair_drops_rows_where_either_side_is_nan() -> None:
    idx = pd.bdate_range("2015-01-01", periods=4)
    r = pd.Series([np.nan, 0.01, 0.02, 0.03], idx)
    b = pd.Series([0.01, 0.02, np.nan, 0.04], idx)
    x, y, index = align_pair(r, b)
    assert list(x) == [0.01, 0.03] and list(y) == [0.02, 0.04]
    assert list(index) == [idx[1], idx[3]]


def test_align_pair_joins_series_on_their_index() -> None:
    r = pd.Series([0.01, 0.02, 0.03], pd.bdate_range("2015-01-01", periods=3))
    b = pd.Series([0.5, 0.6], pd.bdate_range("2015-01-02", periods=2))
    x, y, _ = align_pair(r, b)
    assert list(x) == [0.02, 0.03] and list(y) == [0.5, 0.6]


def test_align_pair_refuses_arrays_of_different_length() -> None:
    with pytest.raises(ValueError, match="length"):
        align_pair(np.zeros(3), np.zeros(4))


def test_active_returns_are_r_minus_b() -> None:
    assert list(active_returns([0.03, 0.01], [0.01, 0.02])) == pytest.approx([0.02, -0.01], abs=1e-15)


# ---------- BR2: information ratio and tracking error ----------

def test_information_ratio_and_tracking_error_by_hand() -> None:
    r, b = [0.01, 0.02, -0.01, 0.03], [0.0, 0.01, 0.0, 0.01]
    a = np.array([0.01, 0.01, -0.01, 0.02])
    assert tracking_error(r, b, periods=252) == pytest.approx(a.std(ddof=1) * math.sqrt(252), rel=1e-15)
    assert information_ratio(r, b, periods=252) == pytest.approx(a.mean() / a.std(ddof=1) * math.sqrt(252),
                                                                 rel=1e-15)


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_ir_and_te_equal_nautilus_on_synthetic_sessions(seed: int) -> None:
    r, b = _synthetic(seed=seed)
    assert abs(information_ratio(r, b) - _nautilus(InformationRatio(), r, b)) <= TOL
    assert abs(tracking_error(r, b) - _nautilus(TrackingError(), r, b)) <= TOL


def test_ir_and_te_equal_nautilus_on_the_volmanaged_series(volmanaged) -> None:
    r_m, r_bh, _ = volmanaged
    x, y, index = align_pair(r_m, r_bh)
    r, b = pd.Series(x, index), pd.Series(y, index)
    assert abs(information_ratio(r, b) - _nautilus(InformationRatio(), r, b)) <= TOL
    assert abs(tracking_error(r, b) - _nautilus(TrackingError(), r, b)) <= TOL


def test_wrong_annualisation_fails_the_nautilus_parity() -> None:
    """Born failing: sqrt(365) instead of sqrt(252) would break the 1e-12 agreement, so it is refused (C2)."""
    r, b = _synthetic()
    active = np.asarray(r) - np.asarray(b)
    wrong = active.mean() / active.std(ddof=1) * np.sqrt(365)
    assert abs(wrong - _nautilus(InformationRatio(), r, b)) > 1e-3
    for fn in (information_ratio, tracking_error):
        with pytest.raises(ValueError, match="periods"):
            fn(r, b, periods=365)


def test_ir_is_nan_for_constant_or_short_active_returns() -> None:
    assert math.isnan(information_ratio([0.01, 0.02], [0.0, 0.01]))  # active return constant
    assert math.isnan(information_ratio([0.01], [0.0]))
    assert math.isnan(tracking_error([0.01], [0.0]))


# ---------- BR1: spanning alpha ----------

def test_alpha_beta_is_sizing_stats_spanning_alpha(volmanaged) -> None:
    r_m, r_bh, _ = volmanaged
    x, y, _ = align_pair(r_m, r_bh)
    assert alpha_beta(r_m, r_bh) == sizing_stats.spanning_alpha(x, y, (5, 21), 252)


def test_headline_alpha_equals_the_screen_json(volmanaged) -> None:
    r_m, r_bh, screen = volmanaged
    got, stored = alpha_beta(r_m, r_bh), screen["headline"]["1tick"]["alpha"]
    assert got["n"] == stored["n"] == screen["n_eval"]
    for key in ("a", "b", "alpha_annual_pct", "t_min"):
        assert got[key] == pytest.approx(stored[key], rel=TOL, abs=0), key
    for lag in ("5", "21"):
        assert got["t"][lag] == pytest.approx(stored["t"][lag], rel=TOL, abs=0), lag


def test_block_alphas_equal_the_screen_json(volmanaged) -> None:
    r_m, r_bh, screen = volmanaged
    got = alpha_by_block(r_m, r_bh)
    assert set(got) == set(screen["blocks_1tick"])
    for name, stored in screen["blocks_1tick"].items():
        assert got[name]["n"] == stored["n"], name
        for key in ("a", "b", "alpha_annual_pct", "t_min"):
            assert got[name][key] == pytest.approx(stored[key], rel=TOL, abs=0), (name, key)
        for lag in ("5", "21"):
            assert got[name]["t"][lag] == pytest.approx(stored["t"][lag], rel=TOL, abs=0), (name, lag)


def test_a_one_session_shift_breaks_the_block_anchor(volmanaged) -> None:
    """Born failing: the benchmark lagged by one session must miss the stored block alphas."""
    r_m, r_bh, screen = volmanaged
    got = alpha_by_block(r_m, r_bh.shift(1))
    stored = screen["blocks_1tick"]["2010-13"]["alpha_annual_pct"]
    assert got["2010-13"]["alpha_annual_pct"] != pytest.approx(stored, rel=1e-6)


def test_alpha_by_block_needs_a_date_index() -> None:
    with pytest.raises(TypeError, match="DatetimeIndex"):
        alpha_by_block(np.zeros(5), np.zeros(5))


def test_alpha_beta_on_too_few_points_is_nan() -> None:
    out = alpha_beta([0.01, 0.02], [0.0, 0.01])
    assert out["n"] == 2 and math.isnan(out["alpha_annual_pct"])


# ---------- summary ----------

def test_relative_summary_collects_br1_and_br2() -> None:
    r, b = _synthetic()
    out = relative_summary(r, b)
    assert out["n"] == len(r) and out["periods_per_year"] == 252
    assert out["information_ratio"] == information_ratio(r, b)
    assert out["tracking_error"] == tracking_error(r, b)
    assert out["alpha"] == alpha_beta(r, b)
    assert set(out["blocks"]) == {"2010-13", "2014-17", "2018-21"}
