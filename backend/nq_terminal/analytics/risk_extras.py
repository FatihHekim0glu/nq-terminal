"""P2 risk extras (ANALYTICS_CATALOG RK4 in section 5, PF11 in section 1, BR5 in section 6). Pure functions.

RK4, modified expected shortfall (Boudt, Peterson and Croux 2008), as PerformanceAnalytics `ES(method="modified")`
with its default `operational = TRUE` (`operES.CornishFisher`, R/PortfolioRisk.R). Moments as RK3: mu the mean, sigma
and the skewness S and excess kurtosis K from the population central moments. `h` is the Cornish-Fisher quantile of
the tail (RK3's expansion of z = Phi^-1(tail)), and the expected value of z at or below h under the second order
Edgeworth density `phi(z) (1 + S/6 He3 + K/24 He4 + S^2/72 He6)`, divided by the tail probability, is
`E_G = -phi(h) (1 + h^3 S/6 + (h^6 - 9h^4 + 9h^2 + 3) S^2/72 + (h^4 - 2h^2 - 1) K/24) / tail`
(the closed form of the paper's I^q integrals). `mES = -(mu + sigma min(E_G, h))`, a positive loss: the minimum is the
operational floor, so the ES is never below the modified VaR. At S = K = 0 it is the Gaussian ES
`-mu + sigma phi(z) / tail`.

Domain and fallback: the expansion is a quantile only inside RK3's monotone domain (`risk.cf_monotone`), so outside
it the modified ES is not defined and the shown value is RK1's historical CVaR at the same tail; the Gaussian ES is
only reported (greyed) and the raw expansion kept for the record. A second condition, a deliberate deviation from
PerformanceAnalytics: the Edgeworth density must be non-negative on (-inf, h]. Where it is not (at S = 0 from K = 4,
its minimum near |z| = sqrt(3)), the "tail mean" averages over negative mass, the tail probability it integrates is
not the tail's, and the modified ES falls as the kurtosis rises (5% tail, S = 0: 2.384 at K = 4, 2.161 at K = 8, in
units of sigma). There the value is not defined either and the historical CVaR is shown, with its own reason.
Inside the domain an ES below zero (the tail mean a gain) is "inverse risk": PerformanceAnalytics returns NA there,
and here the value is not defined either and the historical CVaR is shown. PerformanceAnalytics also caps an ES above 1 at 1 (a loss over 100%); that cap belongs to
fractional returns only and is not applied (a one-contract series is in USD), so an ES above 1 is served as computed.

PF11: ulcer index `sqrt(mean(DD^2))` over the n sessions of DD1 (the underwater series on the series' basis, with the
baseline E_0 = K as DD1), and recovery factor `total return / abs(MaxDD)`. quantstats `ulcer_index` divides by n - 1
and starts its peak at the first session (both documented differences). On a summed series (Basis A, or one-contract
USD P&L) the recovery factor is the summed return over the deepest drawdown of the summed curve, so it does not depend
on K: for a one-contract series it is net P&L over the deepest P&L drawdown.

BR5: Treynor `CAGR / beta`: CAGR is PF2 over the whole series on its basis (arithmetic on A, compounded on B) and beta
is BR1's OLS slope (`relative.alpha_beta`) on the rows where both sides have a value. Nautilus `TreynorRatio` is the
same ratio with the compounded CAGR, so it agrees on Basis B and differs on A (it compounds a series that Basis A
sums).
"""
from __future__ import annotations

import math
from types import ModuleType

import numpy as np

from nq_terminal.analytics import relative
from nq_terminal.analytics._inputs import PERIODS_DAILY, check_basis, returns_array
from nq_terminal.analytics.drawdown import max_drawdown, underwater
from nq_terminal.analytics.risk import (
    VAR_TAILS,
    _check_tail,
    _population_moments,
    cf_monotone,
    cf_quantile,
    historical_cvar,
)


def _sps() -> ModuleType:
    """`scipy.stats`, imported on first use so the start path does not pay for it (D1.1, 04)."""
    from scipy import stats

    return stats


MIN_RETURNS = 4
MIN_PAIRS = 3

ES_INSIDE = "modified ES (Cornish-Fisher quantile, Edgeworth tail mean; inside the monotone domain)"
ES_OUTSIDE = ("not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the "
              "historical CVaR (RK1) is shown beside it, the Gaussian ES only greyed")
ES_NONPOSITIVE = ("not defined: the Edgeworth density is negative somewhere below the quantile (high kurtosis), so the "
                  "modified ES would fall as the tail grows fatter; the historical CVaR (RK1) is shown beside it, the "
                  "Gaussian ES only greyed")
ES_INVERSE = ("not defined: the modified ES is below zero (inverse risk, where PerformanceAnalytics returns NA); the "
              "historical CVaR (RK1) is shown beside it")


DENSITY_TOLERANCE = 1e-12


def edgeworth_density_nonnegative(h: float, skew: float, exkurt: float) -> bool:
    """Whether the Edgeworth density `phi(z) g(z)`, `g = 1 + S/6 He3 + K/24 He4 + S^2/72 He6`, is non-negative for every
    z at or below h. `g` is a polynomial, so its minimum on (-inf, h] is at h or at a real root of `g'` below h; the
    far tail is positive when the leading coefficient is (S != 0, or S = 0 and K > 0)."""
    if not all(math.isfinite(x) for x in (h, skew, exkurt)):
        return False
    if skew == 0 and exkurt < 0:
        return False
    he3, he4, he6 = (np.polynomial.Polynomial(c) for c in ((0, -3, 0, 1), (3, 0, -6, 0, 1), (-15, 0, 45, 0, -15, 0, 1)))
    g = 1 + skew / 6 * he3 + exkurt / 24 * he4 + skew ** 2 / 72 * he6
    roots = g.deriv().roots()
    real = [float(x.real) for x in roots if abs(x.imag) <= 1e-9 * max(1.0, abs(x.real)) and x.real <= h]
    return bool(min(float(g(x)) for x in [h, *real]) >= -DENSITY_TOLERANCE)


def mes_from_moments(mu: float, sigma: float, skew: float, exkurt: float, tail: float) -> dict:
    """The modified ES from the four moments: h, the Edgeworth tail mean E_G, the ES with the operational floor and
    whether the floor was taken (E_G above h)."""
    _check_tail(tail)
    z = float(_sps().norm.ppf(tail))
    h = float(cf_quantile(z, skew, exkurt))
    shape = (1 + h ** 3 * skew / 6 + (h ** 6 - 9 * h ** 4 + 9 * h ** 2 + 3) * skew ** 2 / 72
             + (h ** 4 - 2 * h ** 2 - 1) * exkurt / 24)
    mean_below = float(-_sps().norm.pdf(h) * shape / tail)
    return {"z": z, "h": h, "edgeworth_mean": mean_below, "floored": bool(mean_below > h),
            "mes": float(-(mu + sigma * min(mean_below, h)))}


def gaussian_es(r, tail: float = 0.05) -> float:
    """Gaussian ES with the population sigma: `-mu + sigma phi(z) / tail`; NaN on an empty series."""
    _check_tail(tail)
    values = returns_array(r)
    if not len(values):
        return math.nan
    mu, sigma, _, _ = _population_moments(values)
    return float(-mu + sigma * _sps().norm.pdf(_sps().norm.ppf(tail)) / tail)


def _shown(raw: float, inside: bool, positive: bool, historical: float) -> tuple[float | None, float, str]:
    """(modified or None, the shown value, the method) under the domain, density and inverse-risk rules."""
    if not inside:
        return None, historical, ES_OUTSIDE
    if not positive:
        return None, historical, ES_NONPOSITIVE
    if not raw >= 0:
        return None, historical, ES_INVERSE
    return raw, raw, ES_INSIDE


def modified_es(r, tail: float = 0.05) -> dict:
    """RK4 at one tail: the modified ES inside RK3's monotone domain and where the Edgeworth density is non-negative
    below h, else the historical CVaR (RK1) with the reason; the Gaussian ES and the raw expansion are returned beside
    it either way. `in_domain` is both conditions."""
    _check_tail(tail)
    values = returns_array(r)
    if len(values) < MIN_RETURNS:
        raise ValueError(f"modified ES needs at least {MIN_RETURNS} returns, got {len(values)}")
    mu, sigma, skew, exkurt = _population_moments(values)
    found = mes_from_moments(mu, sigma, skew, exkurt, tail) if math.isfinite(skew) else None
    raw = found["mes"] if found else math.nan
    monotone = cf_monotone(skew, exkurt)
    positive = bool(found) and edgeworth_density_nonnegative(found["h"], skew, exkurt)
    inside = monotone and positive
    historical = historical_cvar(values, tail)
    modified, value, method = _shown(raw, monotone, positive, historical)
    return {"tail": tail, "z": float(_sps().norm.ppf(tail)), "mean": mu, "sigma": sigma, "skew": skew,
            "excess_kurtosis": exkurt, "cf_quantile": found["h"] if found else math.nan,
            "edgeworth_mean": found["edgeworth_mean"] if found else math.nan,
            "floored": bool(found["floored"]) if found else False, "gaussian": gaussian_es(values, tail),
            "historical": historical, "raw_expansion": raw, "modified": modified, "value": value,
            "in_domain": inside, "method": method}


def modified_es_table(r) -> dict[str, dict]:
    """RK4 at 95% and 99%, one period."""
    return {level: modified_es(r, tail) for level, tail in VAR_TAILS.items()}


def ulcer_index(r, basis: str) -> float:
    """PF11 `sqrt(mean(DD^2))` over the n sessions of DD1; 0 without a drawdown, NaN on no data."""
    uw = underwater(r, basis).to_numpy()
    return float(math.sqrt(np.mean(uw ** 2))) if len(uw) else math.nan


def recovery_factor(r, basis: str) -> float:
    """PF11 total return over abs(MaxDD) on the same basis; NaN without a drawdown."""
    from nq_terminal.analytics import perf  # lazy: the start path does not load perf (D1.1)

    check_basis(basis)
    depth = max_drawdown(r, basis)
    return perf.total_return(r, basis) / abs(depth) if depth < 0 else math.nan


def treynor_parts(r, bench, basis: str, periods: int = PERIODS_DAILY) -> dict:
    """BR5 with its parts: `cagr` (PF2, whole series), `beta` (BR1 on the aligned rows; NaN with fewer than three
    pairs or a benchmark without spread), `n_pairs` and `value` = cagr / beta (NaN when either is not defined or the
    beta is 0)."""
    from nq_terminal.analytics import perf  # lazy: the start path does not load perf (D1.1)

    x, y, _ = relative.align_pair(r, bench)
    growth = perf.cagr(r, basis, periods)
    beta = math.nan
    if len(x) >= MIN_PAIRS and float(np.var(y)) > 0:
        beta = float(relative.alpha_beta(r, bench, periods=periods)["b"])
    defined = math.isfinite(beta) and beta != 0 and math.isfinite(growth)
    return {"cagr": growth, "beta": beta, "n_pairs": int(len(x)), "value": growth / beta if defined else math.nan}


def treynor(r, bench, basis: str, periods: int = PERIODS_DAILY) -> float:
    """BR5 `CAGR / beta`: PF2's CAGR of the whole series over BR1's beta on the aligned rows (see `treynor_parts`)."""
    return treynor_parts(r, bench, basis, periods)["value"]
