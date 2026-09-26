"""RK1 and RK2 (ANALYTICS_CATALOG.md section 5): historical VaR and CVaR with linear quantiles, and the
21-session loss distribution on the `sizing_stats.tails` code path (no square-root-of-time scaling)."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from nq_lab import sizing_stats
from nq_lab.config import RESULTS
from nq_terminal.analytics import risk


def _random(n: int = 2000, seed: int = 21) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.standard_t(3, n) * 0.009, index=pd.bdate_range("2012-01-02", periods=n))


def test_var_is_minus_the_linear_quantile_by_hand():
    r = np.arange(1, 21) / 100 - 0.1  # -0.09 .. 0.10
    # linear quantile at 0.05: position 0.05 * 19 = 0.95 -> -0.09 + 0.95 * 0.01
    assert risk.historical_var(r, 0.05) == pytest.approx(0.09 - 0.0095, abs=1e-15)


def test_cvar_is_minus_mean_at_or_below_the_quantile_by_hand():
    r = np.arange(1, 21) / 100 - 0.1
    assert risk.historical_cvar(r, 0.05) == pytest.approx(0.09, abs=1e-15)  # only -0.09 lies below -0.0805
    assert risk.historical_cvar(r, 0.10) == pytest.approx(-np.mean([-0.09, -0.08]), abs=1e-15)


def test_cvar_includes_a_return_equal_to_the_quantile():
    r = [-0.05, -0.03, 0.0, 0.01, 0.02]  # quantile at 0.25: position 1.0 -> exactly -0.03
    assert risk.historical_var(r, 0.25) == pytest.approx(0.03, abs=1e-15)
    assert risk.historical_cvar(r, 0.25) == pytest.approx(0.04, abs=1e-15)


def test_var_matches_numpy_percentile_and_cvar_is_deeper():
    r = _random()
    for tail in (0.05, 0.01):
        assert risk.historical_var(r, tail) == pytest.approx(-np.percentile(r, 100 * tail), rel=1e-14)
        assert risk.historical_cvar(r, tail) >= risk.historical_var(r, tail)


def test_var_table_has_95_and_99():
    t = risk.var_table(_random())
    assert set(t) == {"var_95", "cvar_95", "var_99", "cvar_99"}
    assert t["var_99"] > t["var_95"]


def test_tail_probability_must_be_inside_zero_one():
    with pytest.raises(ValueError, match="tail"):
        risk.historical_var([0.01, -0.01], 0.95)


def test_rolling_sums_are_overlapping_21_session_sums():
    r = _random(100)
    sums = risk.rolling_sums(r, 21)
    assert len(sums) == 80
    assert sums.iloc[0] == pytest.approx(r.iloc[:21].sum(), rel=1e-12)
    assert sums.iloc[-1] == pytest.approx(r.iloc[-21:].sum(), rel=1e-12)
    assert sums.index[0] == r.index[20]


def test_mean_shortfall_by_hand():
    sums = pd.Series(np.arange(-10, 90) / 100.0)  # 100 sums, worst -0.10
    assert risk.mean_shortfall(sums, 0.01) == pytest.approx(-0.10)
    assert risk.mean_shortfall(sums, 0.05) == pytest.approx(np.mean(np.arange(-10, -5) / 100.0))
    assert np.isnan(risk.mean_shortfall(pd.Series([], dtype=float), 0.05))


def test_loss_distribution_matches_sizing_stats_tails():
    for seed in range(4):
        r = _random(1500, seed)
        got = risk.loss_distribution(r)
        ref = sizing_stats.tails(r)
        assert got["shortfall_1pct"] * 100 == pytest.approx(ref["shortfall_1pct"], rel=1e-12)
        assert got["shortfall_5pct"] * 100 == pytest.approx(ref["shortfall_5pct"], rel=1e-12)
        assert got["window"] == 21 and got["n"] == len(r) - 20


def test_loss_distribution_anchor_volmanaged_r_m_1():
    daily = pd.read_csv(RESULTS / "screens" / "volmanaged_v0_daily.csv", usecols=["date", "r_m_1", "r_bh_1"])
    stored = json.loads((RESULTS / "screens" / "volmanaged_v0.json").read_text(encoding="utf-8"))["tails"]
    for col, key in (("r_m_1", "managed"), ("r_bh_1", "bh")):
        got = risk.loss_distribution(daily[col].dropna())
        assert got["shortfall_1pct"] * 100 == pytest.approx(stored[key]["shortfall_1pct"], rel=1e-12)
        assert got["shortfall_5pct"] * 100 == pytest.approx(stored[key]["shortfall_5pct"], rel=1e-12)


def test_loss_distribution_is_not_square_root_of_time_scaled_var():
    r = _random()
    got = risk.loss_distribution(r)
    assert got["shortfall_5pct"] != pytest.approx(-risk.historical_cvar(r, 0.05) * np.sqrt(21), rel=1e-3)
