"""RD1 and RD2 (ANALYTICS_CATALOG.md section 4): Freedman-Diaconis histogram with a fitted normal and VaR
lines; monthly and yearly returns summed (Basis A) or compounded (Basis B)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal.analytics import distribution, risk


def _random(n: int = 1500, seed: int = 9) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.standard_t(4, n) * 0.008, index=pd.bdate_range("2014-01-02", periods=n))


def test_histogram_uses_fd_edges_and_counts_every_return():
    r = _random()
    h = distribution.histogram(r)
    edges = np.histogram_bin_edges(r.to_numpy(), bins="fd")
    assert np.array_equal(h["edges"], edges)
    assert np.array_equal(h["counts"], np.histogram(r.to_numpy(), bins=edges)[0])
    assert h["counts"].sum() == len(r)


def test_histogram_normal_overlay_is_expected_count_per_bin():
    r = _random()
    h = distribution.histogram(r)
    mu, sd = r.mean(), r.std(ddof=1)
    centres = (h["edges"][:-1] + h["edges"][1:]) / 2
    widths = np.diff(h["edges"])
    want = len(r) * widths * sps.norm.pdf(centres, mu, sd)
    assert np.allclose(h["normal"], want, rtol=1e-12)
    assert np.allclose(h["centres"], centres)


def test_histogram_carries_the_var_lines():
    r = _random()
    h = distribution.histogram(r)
    assert h["var_95"] == risk.historical_var(r, 0.05)
    assert h["var_99"] == risk.historical_var(r, 0.01)


def test_histogram_of_a_constant_series_has_one_bin():
    h = distribution.histogram([0.01] * 20)
    assert h["counts"].sum() == 20 and len(h["counts"]) == 1


def test_monthly_basis_a_sums_and_basis_b_compounds():
    idx = pd.to_datetime(["2020-01-02", "2020-01-31", "2020-02-03", "2021-01-04"])
    r = pd.Series([0.1, 0.1, -0.05, 0.02], index=idx)
    a = distribution.monthly_returns(r, "A")
    b = distribution.monthly_returns(r, "B")
    assert list(a.index) == [(2020, 1), (2020, 2), (2021, 1)]
    assert a.loc[(2020, 1)] == pytest.approx(0.2, rel=1e-15)
    assert b.loc[(2020, 1)] == pytest.approx(0.21, rel=1e-15)
    assert b.loc[(2020, 2)] == pytest.approx(-0.05, rel=1e-15)


def test_monthly_matches_a_pandas_resample_second_path():
    r = _random()
    b = distribution.monthly_returns(r, "B")
    ref = (1 + r).resample("ME").prod() - 1
    ref = ref[r.resample("ME").size() > 0]
    assert np.allclose(b.to_numpy(), ref.to_numpy(), rtol=1e-13, atol=1e-16)
    a = distribution.monthly_returns(r, "A")
    assert np.allclose(a.to_numpy(), r.resample("ME").sum().to_numpy(), rtol=1e-13, atol=1e-16)


def test_monthly_heatmap_is_year_by_month_with_gaps_as_nan():
    idx = pd.to_datetime(["2020-01-02", "2020-03-02", "2021-12-01"])
    grid = distribution.monthly_heatmap(pd.Series([0.01, 0.02, 0.03], index=idx), "A")
    assert list(grid.index) == [2020, 2021] and list(grid.columns) == list(range(1, 13))
    assert grid.loc[2020, 3] == 0.02 and math.isnan(grid.loc[2020, 2]) and grid.loc[2021, 12] == 0.03


def test_yearly_returns_per_basis():
    idx = pd.to_datetime(["2020-01-02", "2020-06-01", "2021-01-04"])
    r = pd.Series([0.1, 0.1, 0.05], index=idx)
    assert distribution.yearly_returns(r, "A").loc[2020] == pytest.approx(0.2, rel=1e-15)
    assert distribution.yearly_returns(r, "B").loc[2020] == pytest.approx(0.21, rel=1e-15)


def test_timezone_aware_index_groups_on_its_own_dates():
    idx = pd.to_datetime(["2020-01-31", "2020-02-03"]).tz_localize("UTC")
    got = distribution.monthly_returns(pd.Series([0.01, 0.02], index=idx), "A")
    assert list(got.index) == [(2020, 1), (2020, 2)]


def test_period_returns_need_a_date_index():
    with pytest.raises(ValueError, match="DatetimeIndex"):
        distribution.monthly_returns([0.01, 0.02], "A")
