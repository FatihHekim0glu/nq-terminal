"""P2 risk extras (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5): the pure functions in
`nq_terminal.analytics.risk_extras`.

RK4, modified expected shortfall (Boudt, Peterson and Croux 2008), as PerformanceAnalytics `ES(method="modified")`
with its default `operational = TRUE` (`operES.CornishFisher` in R/PortfolioRisk.R, GitHub braverock master
c079aea, read 2026-09-27): population moments m2, m3, m4 (as RK3), `h` the Cornish-Fisher quantile, the expected value
of z below h under the second order Edgeworth density,
`E_G = -phi(h) (1 + h^3 S/6 + (h^6 - 9h^4 + 9h^2 + 3) S^2/72 + (h^4 - 2h^2 - 1) K/24) / alpha`, and
`mES = -mu - sigma min(E_G, h)` (the operational floor: never below the modified VaR). R is not installed, so the
PerformanceAnalytics case below was done by hand: the sixteen returns of `test_p1_metrics.py` with exact rational
moments, `z = qnorm(alpha)` from scipy, and 50-digit decimals for the rest (mean 3/8000, skewness 0.28489068974384,
excess kurtosis 4.19772131072920; h -1.47763377912455 at 95%, -3.06769440643803 at 99%; E_G -1.95725034589661 and
-4.25585148451540).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import integrate
from scipy import stats as sps

from nq_terminal.analytics import perf, relative, risk
from nq_terminal.analytics.risk_extras import (
    ES_INSIDE,
    ES_INVERSE,
    ES_NONPOSITIVE,
    ES_OUTSIDE,
    edgeworth_density_nonnegative,
    gaussian_es,
    mes_from_moments,
    modified_es,
    modified_es_table,
    recovery_factor,
    treynor,
    ulcer_index,
)

PA_CASE = np.array([10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6]) / 1000
PA_MES = {"95": 0.040574792447599579352, "99": 0.088666361185136973576}
PA_GAUSSIAN_ES_95 = 0.042781288884312396609
PA_H = {"95": -1.4776337791245536137, "99": -3.0676944064380280147}
TAILS = {"95": 0.05, "99": 0.01}
TOL = 1e-12


def _edgeworth_mean_below(h: float, skew: float, exkurt: float, tail: float) -> float:
    """E_G by numerical integration of z times the second order Edgeworth density, a path apart from the closed form."""
    def density(z: float) -> float:
        he3, he4, he6 = z ** 3 - 3 * z, z ** 4 - 6 * z ** 2 + 3, z ** 6 - 15 * z ** 4 + 45 * z ** 2 - 15
        return sps.norm.pdf(z) * (1 + skew / 6 * he3 + exkurt / 24 * he4 + skew ** 2 / 72 * he6)
    value, _ = integrate.quad(lambda z: z * density(z), -np.inf, h, epsabs=0, epsrel=1e-13, limit=200)
    return value / tail


def _t_returns(n: int = 3000, df: int = 12, seed: int = 7, scale: float = 0.01, drift: float = 0.0004) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return drift + scale * rng.standard_t(df, n)


# ---------------------------------------------------------------- RK4


def test_performance_analytics_case_by_hand_99():
    row = modified_es(PA_CASE, TAILS["99"])
    assert row["in_domain"] is True
    assert row["modified"] == pytest.approx(PA_MES["99"], rel=TOL)
    assert row["value"] == row["modified"]
    assert row["cf_quantile"] == pytest.approx(PA_H["99"], rel=TOL)
    assert row["method"] == ES_INSIDE and row["floored"] is False


def test_performance_analytics_case_by_hand_95_formula_kept_but_not_served():
    # the PerformanceAnalytics formula is unchanged (the raw expansion still equals the hand value), but the Edgeworth
    # density is negative below h at 95% (minimum -0.004), so the terminal serves the historical CVaR there
    row = modified_es(PA_CASE, TAILS["95"])
    assert row["raw_expansion"] == pytest.approx(PA_MES["95"], rel=TOL)
    assert row["cf_quantile"] == pytest.approx(PA_H["95"], rel=TOL)
    assert row["in_domain"] is False and row["modified"] is None and row["method"] == ES_NONPOSITIVE
    assert row["value"] == pytest.approx(risk.historical_cvar(PA_CASE, 0.05), rel=TOL)


def test_gaussian_es_is_the_normal_tail_mean():
    assert gaussian_es(PA_CASE, 0.05) == pytest.approx(PA_GAUSSIAN_ES_95, rel=TOL)
    mu, sigma = 0.001, 0.02
    expected = -mu + sigma * sps.norm.pdf(sps.norm.ppf(0.05)) / 0.05
    assert mes_from_moments(mu, sigma, 0.0, 0.0, 0.05)["mes"] == pytest.approx(expected, rel=TOL)


@pytest.mark.parametrize(("skew", "exkurt"), [(0.0, 0.0), (0.3, 1.0), (-0.4, 2.5), (0.2, 6.0)])
@pytest.mark.parametrize("tail", [0.05, 0.01, 0.025])
def test_closed_form_equals_the_integral_of_the_edgeworth_density(skew, exkurt, tail):
    found = mes_from_moments(0.0, 1.0, skew, exkurt, tail)
    assert found["edgeworth_mean"] == pytest.approx(_edgeworth_mean_below(found["h"], skew, exkurt, tail), rel=1e-10)


def test_outside_the_domain_the_value_is_the_historical_cvar():
    r = _t_returns(df=3, seed=11)  # heavy tails: excess kurtosis far above 8
    row = modified_es(r, 0.05)
    assert row["in_domain"] is False and row["modified"] is None
    assert row["value"] == pytest.approx(risk.historical_cvar(r, 0.05), rel=TOL)
    assert row["historical"] == row["value"] and row["method"] == ES_OUTSIDE
    assert math.isfinite(row["raw_expansion"])
    assert row["gaussian"] == pytest.approx(gaussian_es(r, 0.05), rel=TOL)


def test_the_domain_is_rk3s():
    # the monotone domain is necessary: outside it RK4 is never inside (inside it the density rule may still refuse)
    for r in (_t_returns(df=12), _t_returns(df=3, seed=11), PA_CASE):
        cf = risk.cornish_fisher_var(r, 0.05)
        assert modified_es(r, 0.05)["in_domain"] <= cf["in_domain"]
    assert modified_es(_t_returns(df=12), 0.05)["in_domain"] is True


def test_inside_the_domain_the_es_is_at_least_the_modified_var():
    r = _t_returns(df=12)
    for tail in TAILS.values():
        row = modified_es(r, tail)
        assert row["in_domain"] is True
        assert row["value"] >= risk.cornish_fisher_var(r, tail)["value"] - 1e-15


def test_operational_floor_takes_the_quantile_when_the_tail_mean_lies_above_it():
    # inside the monotone domain, yet the Edgeworth density goes negative far in the tail: the floor matters there
    assert risk.cf_monotone(0.5, 7.0)
    found = mes_from_moments(0.0, 1.0, 0.5, 7.0, 0.05)
    assert found["edgeworth_mean"] > found["h"] and found["floored"] is True
    assert found["mes"] == pytest.approx(-found["h"], rel=TOL)


def test_an_es_below_zero_is_inverse_risk_and_not_defined():
    r = 1.0 + _t_returns(df=12)  # every return a large gain: the "loss" would be negative
    row = modified_es(r, 0.05)
    assert row["in_domain"] is True and row["raw_expansion"] < 0
    assert row["modified"] is None and row["method"] == ES_INVERSE
    assert row["value"] == pytest.approx(risk.historical_cvar(r, 0.05), rel=TOL)


def test_the_table_carries_both_levels():
    table = modified_es_table(PA_CASE)
    assert list(table) == ["95", "99"]
    assert table["99"]["value"] == pytest.approx(PA_MES["99"], rel=TOL)


def test_too_short_or_bad_tail_is_refused():
    with pytest.raises(ValueError):
        modified_es([0.01, -0.02, 0.0], 0.05)
    with pytest.raises(ValueError):
        modified_es(PA_CASE, 0.95)


def test_born_failing_sample_moments_or_no_floor_or_a_flipped_term_disagree():
    values = PA_CASE
    sample_skew = float(sps.skew(values, bias=False))
    sample_kurt = float(sps.kurtosis(values, fisher=True, bias=False))
    sample = mes_from_moments(values.mean(), values.std(ddof=1), sample_skew, sample_kurt, 0.05)["mes"]
    assert abs(sample - PA_MES["95"]) > 1e-4
    mu, sigma = values.mean(), values.std(ddof=0)
    found = mes_from_moments(mu, sigma, 0.28489068974384, 4.1977213107292, 0.05)
    h = found["h"]
    flipped = sps.norm.pdf(h) * (1 + h ** 3 * 0.2849 / 6 - (h ** 4 - 2 * h ** 2 - 1) * 4.1977 / 24) / 0.05
    assert abs((-mu + sigma * flipped) - PA_MES["95"]) > 1e-4



# ------------------------------------------- RK4 positivity of the Edgeworth density on (-inf, h]


def _grid_min_density(h: float, skew: float, exkurt: float) -> float:
    """The smallest value of the second order Edgeworth density on (-inf, h], on a dense grid (a path apart)."""
    z = np.linspace(-14.0, h, 200001)
    he3, he4, he6 = z ** 3 - 3 * z, z ** 4 - 6 * z ** 2 + 3, z ** 6 - 15 * z ** 4 + 45 * z ** 2 - 15
    return float(np.min(sps.norm.pdf(z) * (1 + skew / 6 * he3 + exkurt / 24 * he4 + skew ** 2 / 72 * he6)))


def _symmetric_k6_returns() -> np.ndarray:
    """90 returns with mean 0, skewness 0 and excess kurtosis exactly 6: five at +1, five at -1, eighty at 0."""
    return np.array([1.0] * 5 + [-1.0] * 5 + [0.0] * 80)


@pytest.mark.parametrize(("skew", "exkurt", "minimum"), [(0.0, 6.0, -0.0501), (-1.0, 6.0, -0.0255)])
def test_born_failing_density_goes_negative_below_h_at_k6(skew, exkurt, minimum):
    # the issue's cases: inside RK3's monotone domain, yet the Edgeworth density is negative below h at 5%
    assert risk.cf_monotone(skew, exkurt)
    found = mes_from_moments(0.0, 1.0, skew, exkurt, 0.05)
    assert _grid_min_density(found["h"], skew, exkurt) == pytest.approx(minimum, abs=1e-4)
    assert edgeworth_density_nonnegative(found["h"], skew, exkurt) is False


def test_the_positivity_rule_agrees_with_a_dense_grid_over_the_moment_plane():
    for skew in (-1.2, -0.6, 0.0, 0.3, 0.9):
        for exkurt in (0.0, 0.5, 1.5, 3.0, 4.2, 5.0, 6.0, 8.0):
            for tail in (0.05, 0.025, 0.01):
                if not risk.cf_monotone(skew, exkurt):
                    continue
                h = mes_from_moments(0.0, 1.0, skew, exkurt, tail)["h"]
                grid_ok = _grid_min_density(h, skew, exkurt) >= -1e-12
                assert edgeworth_density_nonnegative(h, skew, exkurt) is grid_ok, (skew, exkurt, tail)


def test_gaussian_and_mild_tails_pass_the_positivity_rule():
    assert edgeworth_density_nonnegative(-1.6448536269514729, 0.0, 0.0) is True
    assert edgeworth_density_nonnegative(-1.5843, 0.0, 3.0) is True
    assert edgeworth_density_nonnegative(-3.7290742445643925, 0.0, 6.0) is True  # 1% tail: the dip lies above h


def test_modified_es_serves_the_historical_cvar_where_the_density_is_negative_at_s0_k6():
    r = _symmetric_k6_returns()
    mu, sigma, skew, exkurt = risk._population_moments(r)
    assert (mu, skew, exkurt) == pytest.approx((0.0, 0.0, 6.0), abs=1e-12) and risk.cf_monotone(skew, exkurt)
    row = modified_es(r, 0.05)
    assert row["in_domain"] is False and row["modified"] is None and row["method"] == ES_NONPOSITIVE
    assert row["value"] == row["historical"] == pytest.approx(risk.historical_cvar(r, 0.05), rel=TOL)
    assert math.isfinite(row["raw_expansion"])  # the raw expansion stays on the record
    assert modified_es(r, 0.01)["in_domain"] is True  # at 1% the negative dip lies above h, so the ES is served


def test_a_fatter_tail_never_reports_a_smaller_served_es_at_s0_over_the_old_domain():
    # the issue: the 5% mES falls from 2.384 (K 4) to 2.161 (K 8) because the density is negative below h. Served
    # values may now switch to the historical CVaR, but the formula value is never served where it falls with K.
    served = []
    for exkurt in (0.0, 1.0, 2.0, 3.0, 4.0):
        found = mes_from_moments(0.0, 1.0, 0.0, exkurt, 0.05)
        assert edgeworth_density_nonnegative(found["h"], 0.0, exkurt) is True
        served.append(found["mes"])
    assert served == sorted(served)
    for exkurt in (5.0, 6.0, 7.0, 8.0):
        found = mes_from_moments(0.0, 1.0, 0.0, exkurt, 0.05)
        assert edgeworth_density_nonnegative(found["h"], 0.0, exkurt) is False


# ---------------------------------------------------------------- PF11


def test_ulcer_index_basis_a_by_hand():
    r = [0.1, -0.05, -0.05, 0.02, 0.1]  # cumsum 0.10 0.05 0.00 0.02 0.12; under water 0 -0.05 -0.10 -0.08 0
    assert ulcer_index(r, "A") == pytest.approx(math.sqrt((0.05 ** 2 + 0.10 ** 2 + 0.08 ** 2) / 5), rel=TOL)
    assert recovery_factor(r, "A") == pytest.approx(0.12 / 0.10, rel=TOL)


def test_ulcer_index_basis_b_by_hand_from_the_baseline():
    r = [-0.1, 0.05, 0.1]  # equity 0.9 0.945 1.0395 from E_0 = 1: under water -0.1 -0.055 0
    assert ulcer_index(r, "B") == pytest.approx(math.sqrt((0.1 ** 2 + 0.055 ** 2) / 3), rel=TOL)
    assert recovery_factor(r, "B") == pytest.approx(0.0395 / 0.1, rel=TOL)


def test_born_failing_quantstats_divisor_or_no_baseline_disagree():
    r = [-0.1, 0.05, 0.1]
    ours = ulcer_index(r, "B")
    assert abs(ours - math.sqrt((0.1 ** 2 + 0.055 ** 2) / 2)) > 1e-3  # n - 1, as quantstats
    level = np.cumprod(1 + np.array(r))
    no_baseline = level / np.maximum.accumulate(level) - 1  # the first session counted as a high
    assert abs(ours - math.sqrt(np.mean(no_baseline ** 2))) > 1e-3


def test_no_drawdown_gives_zero_ulcer_and_no_recovery_factor():
    assert ulcer_index([0.01, 0.02, 0.0], "B") == 0.0
    assert math.isnan(recovery_factor([0.01, 0.02, 0.0], "B"))
    assert math.isnan(ulcer_index([], "A"))


def test_recovery_factor_is_scale_free_on_a_summed_series():
    usd = [500.0, -300.0, -400.0, 900.0]  # one-contract P&L in USD: net 700 over the deepest drawdown 700
    assert recovery_factor(usd, "A") == pytest.approx(1.0, rel=TOL)
    assert recovery_factor(np.array(usd) / 1e6, "A") == pytest.approx(1.0, rel=TOL)


# ---------------------------------------------------------------- BR5


def _pair(n: int = 1200, seed: int = 5, beta: float = 0.4) -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2012-01-02", periods=n)
    b = 0.0004 + 0.012 * rng.standard_normal(n)
    r = 0.0002 + beta * b + 0.007 * rng.standard_normal(n)
    return pd.Series(r, index=idx), pd.Series(b, index=idx)


def _nautilus_treynor(r: pd.Series, b: pd.Series, period: int = 252) -> float:
    from nautilus_trader.analysis import TreynorRatio
    stamps = pd.DatetimeIndex(r.index).tz_localize("UTC").as_unit("ns").asi8.tolist()
    return TreynorRatio(period).calculate_from_returns_with_benchmark(dict(zip(stamps, r.tolist())),
                                                                      dict(zip(stamps, b.tolist())))


def test_treynor_is_cagr_over_the_br1_beta():
    r, b = _pair()
    expected = perf.cagr(r, "B") / relative.alpha_beta(r, b)["b"]
    assert treynor(r, b, "B") == pytest.approx(expected, rel=TOL)


def test_treynor_on_basis_b_equals_nautilus():
    r, b = _pair()
    assert treynor(r, b, "B") == pytest.approx(_nautilus_treynor(r, b), rel=1e-9)


def test_treynor_on_monthly_books_equals_nautilus_at_twelve():
    r, b = _pair(n=120, seed=9)
    assert treynor(r, b, "B", periods=12) == pytest.approx(_nautilus_treynor(r, b, 12), rel=1e-9)


def test_born_failing_nautilus_compounds_so_basis_a_differs():
    r, b = _pair()
    ours = treynor(r, b, "A")
    assert ours == pytest.approx(perf.cagr(r, "A") / relative.alpha_beta(r, b)["b"], rel=TOL)
    assert abs(ours - _nautilus_treynor(r, b)) > 1e-3


def test_treynor_beta_uses_the_aligned_rows_and_cagr_the_whole_series():
    r, b = _pair()
    gappy = b.copy()
    gappy.iloc[::7] = np.nan
    expected = perf.cagr(r, "B") / relative.alpha_beta(r, gappy)["b"]
    assert treynor(r, gappy, "B") == pytest.approx(expected, rel=TOL)


def test_treynor_without_beta_is_not_defined():
    r, _ = _pair()
    flat = pd.Series(0.0, index=r.index)
    assert math.isnan(treynor(r, flat, "B"))
    assert math.isnan(treynor(r.iloc[:2], r.iloc[:2], "B"))
