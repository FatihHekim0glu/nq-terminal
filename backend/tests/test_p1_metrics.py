"""P1 series metrics (TASKS 10.3): PF7 Omega, PF8 tail ratio, PF9 gain to pain, RK3 normal and Cornish-Fisher VaR with
its monotone domain, RL3 rolling beta, RL4 rolling correlation, BR3 up and down capture, BR4 scatter, RD3 QQ, RD4
Jarque-Bera. The three-way agreement with the reference libraries runs in the cross-check (`crosscheck`, kind `p1`).

The PerformanceAnalytics case (RK3) was checked by hand on 2026-09-27: R is not installed here, so the steps of
PerformanceAnalytics' `VaR.CornishFisher` (R/VaR.CornishFisher.R: `centeredmoment` m2, m3, m4 as population moments,
`skew = m3 / sqrt(m2^3)`, `exkurt = m4 / m2^2 - 3`, `z = qnorm(0.05)`, the expansion `h`, `VaR = mean + h sqrt(m2)`,
reported as a positive loss) were done with exact rational moments and 40-digit decimals. The sixteen returns below
(per mille: 10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6) have mean 3/8000, m2 5603/12800000,
m3 133587/51200000000, m4 5649061213/4096000000000000, skewness 0.284890689743840, excess kurtosis 4.19772131072920,
and give h -1.47763377912455 at 95% and a Cornish-Fisher VaR of 0.0305402054542076 (99%: 0.0638076169552943; the
Gaussian VaR 0.0340387962583874).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal.analytics import distribution, perf, relative, risk, rolling

PA_CASE = np.array([10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6]) / 1000
PA_CF = {"95": 0.03054020545420761997, "99": 0.06380761695529429767}
PA_GAUSS_95 = 0.03403879625838738124
OUT_OF_DOMAIN = np.array([5, -2, 1, -7, 3, 2, -1, 4, -3, 0]) / 100  # excess kurtosis -0.376: q'(z) < 0 in the tails
OUT_RAW_CF_95, OUT_GAUSS_95 = 0.05989670914838637385, 0.05440672922636276281


def daily(n=600, seed=1, loc=0.0004, scale=0.01) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(loc + scale * rng.standard_t(4, n), index=pd.bdate_range("2013-01-01", periods=n))


# ---------------------------------------------------------------- PF7, PF8, PF9


def test_omega_by_hand():
    assert perf.omega([0.02, -0.01, 0.03, -0.02, 0.0]) == pytest.approx(0.05 / 0.03, rel=1e-15)
    assert math.isnan(perf.omega([0.01, 0.02]))


def test_tail_ratio_uses_linear_quantiles():
    r = daily(seed=2)
    expected = abs(np.quantile(r, 0.95) / np.quantile(r, 0.05))
    assert perf.tail_ratio(r) == expected


def test_gain_to_pain_sums_months_on_a_and_compounds_on_b():
    idx = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-02-03", "2020-02-04", "2020-03-02"])
    r = pd.Series([0.01, 0.02, -0.02, 0.01, 0.02], index=idx)
    assert perf.gain_to_pain(r, "A", 252) == pytest.approx((0.03 - 0.01 + 0.02) / 0.01, rel=1e-12)
    months = [1.01 * 1.02 - 1, 0.98 * 1.01 - 1, 0.02]
    assert perf.gain_to_pain(r, "B", 252) == pytest.approx(sum(months) / abs(months[1]), rel=1e-12)
    monthly = pd.Series([0.03, -0.01, 0.02], index=pd.to_datetime(["2020-01-31", "2020-02-28", "2020-03-31"]))
    assert perf.gain_to_pain(monthly, "A", 12) == pytest.approx(4.0, rel=1e-12)
    assert math.isnan(perf.gain_to_pain(pd.Series([0.01], index=idx[:1]), "A", 252))


# ---------------------------------------------------------------- RK3


def test_performance_analytics_case_by_hand():
    for level, tail in (("95", 0.05), ("99", 0.01)):
        found = risk.cornish_fisher_var(PA_CASE, tail)
        assert found["in_domain"] is True
        assert found["value"] == pytest.approx(PA_CF[level], rel=1e-12)
        assert found["cornish_fisher"] == found["value"]
    assert risk.normal_var(PA_CASE, 0.05) == pytest.approx(PA_GAUSS_95, rel=1e-12)


def test_outside_the_domain_the_value_is_not_defined_and_the_historical_var_stands_beside_it():
    found = risk.cornish_fisher_var(OUT_OF_DOMAIN, 0.05)
    assert found["in_domain"] is False and found["cornish_fisher"] is None
    assert found["normal"] == pytest.approx(OUT_GAUSS_95, rel=1e-12)
    assert found["raw_expansion"] == pytest.approx(OUT_RAW_CF_95, rel=1e-12)
    assert found["historical"] == pytest.approx(risk.historical_var(OUT_OF_DOMAIN, 0.05), rel=1e-15)
    # The comparator is RK1's historical VaR, never the normal VaR: fat tails make the normal one misleading.
    assert found["value"] == found["historical"] and found["value"] != found["normal"]
    assert found["method"].startswith("not defined") and "historical" in found["method"]


def test_inside_the_domain_the_historical_var_is_reported_beside_it():
    found = risk.cornish_fisher_var(PA_CASE, 0.05)
    assert found["historical"] == pytest.approx(risk.historical_var(PA_CASE, 0.05), rel=1e-15)
    assert found["value"] == found["cornish_fisher"]


def _numerically_monotone(s: float, k: float) -> bool:
    z = np.linspace(-12, 12, 24001)
    return bool(np.all(np.diff(risk.cf_quantile(z, s, k)) > 0))


def test_domain_at_zero_skew_is_zero_to_eight():
    assert risk.cf_monotone(0.0, 0.0) and risk.cf_monotone(0.0, 8.0) is True
    assert not risk.cf_monotone(0.0, -0.01) and not risk.cf_monotone(0.0, 8.01)


def test_derived_domain_agrees_with_a_dense_numeric_check():
    rng = np.random.default_rng(5)
    checked = 0
    for s, k in zip(rng.uniform(-2.5, 2.5, 400), rng.uniform(-1, 12, 400)):
        a, b, c = risk.cf_derivative_coefficients(s, k)
        if a > 0 and abs(b * b - 4 * a * c) < 1e-3:  # too close to the boundary for a finite grid
            continue
        assert risk.cf_monotone(s, k) == _numerically_monotone(s, k), (s, k)
        checked += 1
    assert checked > 350


def test_born_failing_the_other_sign_of_the_constant_term_disagrees():
    """With c = 1 - K/8 - 5 S^2 / 36 (a sign some write-ups print) the domain misses monotone pairs."""
    s, k = 1.5, 5.0
    a, b = k / 8 - s * s / 6, s / 3
    wrong_c = 1 - k / 8 - 5 * s * s / 36
    assert _numerically_monotone(s, k) and risk.cf_monotone(s, k)
    assert not (a > 0 and b * b - 4 * a * wrong_c <= 0)


def test_var_table_carries_both_levels():
    table = risk.modified_var_table(daily(seed=6))
    assert set(table) == {"95", "99"} and table["95"]["tail"] == 0.05


# ---------------------------------------------------------------- RL3, RL4


def test_rolling_beta_and_correlation_equal_a_window_loop():
    r, b = daily(seed=7), daily(seed=8)
    b.iloc[300] = np.nan
    beta, corr = rolling.rolling_beta(r, b, 126), rolling.rolling_correlation(r, b, 126)
    for end in (125, 200, 299, 425, 426, 599):
        x, y = r.iloc[end - 125:end + 1].to_numpy(), b.iloc[end - 125:end + 1].to_numpy()
        if np.isnan(y).any():
            assert math.isnan(beta.iloc[end]) and math.isnan(corr.iloc[end])
            continue
        assert beta.iloc[end] == pytest.approx(np.cov(x, y, ddof=1)[0, 1] / np.var(y, ddof=1), rel=1e-9)
        assert corr.iloc[end] == pytest.approx(np.corrcoef(x, y)[0, 1], rel=1e-9)
    assert beta.iloc[:125].isna().all()
    assert rolling.relative_window(252) == 126 and rolling.relative_window(12) == 12


# ---------------------------------------------------------------- BR3, BR4


def test_capture_is_the_geometric_annualised_ratio():
    r = np.array([0.02, -0.01, 0.01, 0.03, -0.02])
    b = np.array([0.01, -0.02, 0.02, -0.01, -0.03])

    def annual(x):
        return np.prod(1 + x) ** (252 / len(x)) - 1

    up, down = b > 0, b < 0
    assert relative.up_capture(r, b, 252) == pytest.approx(annual(r[up]) / annual(b[up]), rel=1e-12)
    assert relative.down_capture(r, b, 252) == pytest.approx(annual(r[down]) / annual(b[down]), rel=1e-12)


def test_capture_matches_nautilus():
    from nautilus_trader.analysis import DownCaptureRatio, UpCaptureRatio
    r, b = daily(seed=9), daily(seed=10)
    stamps = pd.DatetimeIndex(r.index).tz_localize("UTC").as_unit("ns").asi8.tolist()
    rs, bs = dict(zip(stamps, r.tolist())), dict(zip(stamps, b.tolist()))
    assert relative.up_capture(r, b, 252) == pytest.approx(
        UpCaptureRatio(252).calculate_from_returns_with_benchmark(rs, bs), rel=1e-9)
    assert relative.down_capture(r, b, 252) == pytest.approx(
        DownCaptureRatio(252).calculate_from_returns_with_benchmark(rs, bs), rel=1e-9)


def test_scatter_line_is_the_br1_fit_on_the_aligned_points():
    r, b = daily(seed=11), daily(seed=12)
    b.iloc[:3] = np.nan
    found = relative.scatter(r, b, 252)
    fit = relative.alpha_beta(r, b)
    assert len(found["x"]) == len(r) - 3 and found["slope"] == fit["b"] and found["intercept"] == fit["a"]
    slope, intercept = np.polyfit(found["x"], found["y"], 1)
    assert found["slope"] == pytest.approx(slope, rel=1e-9) and found["intercept"] == pytest.approx(intercept, rel=1e-7)


# ---------------------------------------------------------------- RD3, RD4


def test_jarque_bera_is_scipys():
    r = daily(seed=13)
    found = distribution.jarque_bera(r)
    stat, p = sps.jarque_bera(r.to_numpy())
    assert found["statistic"] == float(stat) and found["p"] == float(p) and found["n"] == len(r)


def test_qq_plot_is_scipys_probplot():
    r = daily(seed=14)
    found = distribution.qq_plot(r)
    (osm, osr), (slope, intercept, corr) = sps.probplot(r.to_numpy(), dist="norm")
    assert np.array_equal(found["theoretical"], osm) and np.array_equal(found["ordered"], osr)
    assert (found["slope"], found["intercept"], found["r"]) == (slope, intercept, corr)


# ---------------------------------------------------------------- RL1 band: the range of a w-period Sharpe


Z95 = 1.959963984540054


def constant_sharpe(n: int = 2700, seed: int = 31) -> pd.Series:
    """iid daily returns with a constant true Sharpe of 1.0 annualised (0.063 per session)."""
    rng = np.random.default_rng(seed)
    return pd.Series(0.01 * (1 / math.sqrt(252) + rng.standard_normal(n)),
                     index=pd.bdate_range("2011-01-03", periods=n))


def test_the_band_is_the_full_sample_sharpe_plus_minus_the_window_mertens_error():
    r = constant_sharpe()
    x = r.to_numpy()
    sr = x.mean() / x.std(ddof=1)
    g3, g4 = sps.skew(x, bias=True), sps.kurtosis(x, fisher=False, bias=True)
    for w in (63, 252):
        band = rolling.sharpe_band(r, w, 252)
        se = math.sqrt((1 - g3 * sr + (g4 - 1) / 4 * sr ** 2) / (w - 1)) * math.sqrt(252)
        assert band["window"] == w and band["centre"] == pytest.approx(sr * math.sqrt(252), rel=1e-12)
        assert band["se"] == pytest.approx(se, rel=1e-12)
        assert (band["lo"], band["hi"]) == (pytest.approx(band["centre"] - Z95 * se, rel=1e-12),
                                            pytest.approx(band["centre"] + Z95 * se, rel=1e-12))
    assert rolling.sharpe_band(r, 63, 252)["se"] > 1.9 * rolling.sharpe_band(r, 252, 252)["se"]  # widens as w shrinks


def test_born_failing_the_full_sample_interval_is_the_wrong_band_for_rolling_values():
    # the statistics review: SV5's full-sample interval drawn on the 63-session pane left about 76% of the values
    # outside it at a constant true Sharpe; the window's own band leaves about 5% outside
    r = constant_sharpe()
    values = rolling.rolling_sharpe(r, 63, 252).dropna()
    band, full = rolling.sharpe_band(r, 63, 252), rolling.sharpe_band(r, len(r), 252)
    outside = float(((values < band["lo"]) | (values > band["hi"])).mean())
    outside_full = float(((values < full["lo"]) | (values > full["hi"])).mean())
    assert outside < 0.10 and outside_full > 0.5


def test_a_series_without_spread_has_no_band():
    band = rolling.sharpe_band(pd.Series([0.01] * 300), 63, 252)
    assert all(math.isnan(band[k]) for k in ("centre", "lo", "hi", "se"))
