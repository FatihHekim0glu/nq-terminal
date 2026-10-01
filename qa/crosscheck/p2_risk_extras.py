"""Reference values for the P2 risk extras (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5), dumped as `p2risk`
bundles by `terminal/backend/tests/test_dump_for_qa_p2_risk_extras.py`.

Inputs: the session dates, the returns r, the benchmark (or None), the basis, P and whether the series is on a
capital K (a one-contract series is summed and has no CAGR, so no Treynor).

- RK4 modified ES: PerformanceAnalytics `ES(method="modified")` with its default `operational = TRUE`
  (`operES.CornishFisher`, R/PortfolioRisk.R, braverock master c079aea, read 2026-09-27), written out with scipy:
  population central moments (`scipy.stats.moment`), h the Cornish-Fisher quantile, E_G the closed form of the
  Edgeworth tail mean, `mES = -mu - sigma min(E_G, h)`. A second exact path integrates z times the Edgeworth density
  numerically (`scipy.integrate.quad`) up to h. The monotone domain is checked on a dense grid of z (as RK3's
  reference). A second condition, a DELIBERATE DEVIATION from PerformanceAnalytics: the Edgeworth density
  `phi(z) sum_k c_k He_k(z)` (scipy `eval_hermitenorm`) must be non-negative on a dense grid of z up to h. Where it
  is not (S = 0, K = 6 at 5%: minimum -0.050; S = -1, K = 6: -0.026) the "tail mean" integrates negative mass and the
  modified ES falls as the kurtosis rises, so the shown value is the historical CVaR and PerformanceAnalytics' own
  value is listed as INFO (`rk4.<level>.pa_density`). Outside the monotone domain, or where the ES is below zero
  (PerformanceAnalytics' "inverse risk", NA), the shown value is the historical CVaR: the mean of the returns at or below the pandas linear quantile. PerformanceAnalytics'
  cap of an ES above 1 at 1 belongs to fractional returns and is not applied (INFO where it would bite).
- PF11 ulcer index `sqrt(sum DD^2 / n)` and recovery factor `total return / abs(MaxDD)`: a plain Python walk of the
  running peak from the baseline (0 of K summed, 1.0 compounded). On a compounded series quantstats `ulcer_index`
  (which also starts from a phantom baseline, divided by n - 1) times sqrt((n - 1) / n) is a second exact reference;
  raw quantstats `ulcer_index` and `recovery_factor` (summed returns over a compounded drawdown) are INFO on a series
  with a capital K (on one-contract USD P&L quantstats' compounding means nothing, so neither is listed).
- BR5 Treynor `CAGR / beta`: CAGR from the growth `1 + sum r` (Basis A) or `prod(1 + r)` (Basis B) over the whole
  series, beta the statsmodels OLS slope on the rows where both sides are finite. Nautilus `TreynorRatio` is dumped
  as the third implementation on Basis B series whose benchmark has no gap.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from scipy import integrate
from scipy import special
from scipy import stats as sps

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import quantstats.stats as qs
    import statsmodels.api as sm

from crosscheck.reference import DOCUMENTED, Ref

TAILS = {"95": 0.05, "99": 0.01}
Z_GRID = np.linspace(-12, 12, 48001)
MIN_PAIRS = 3
SRC_ES = "PerformanceAnalytics operES.CornishFisher written out (scipy population moments, closed-form E_G)"
SRC_QUAD = "scipy.integrate.quad of z times the Edgeworth density up to h"
SRC_GRID = "a dense grid of z (monotone expansion, and a non-negative Edgeworth density up to h)"
DENSITY_TOLERANCE = 1e-12
SRC_CVAR = "pandas linear quantile, mean of the returns at or below it (RK1 CVaR)"
SRC_WALK = "plain Python walk of the running peak from the baseline"
SRC_TREYNOR = "numpy growth to CAGR over statsmodels OLS slope on the aligned rows"


def _floats(values) -> np.ndarray:
    return np.array([math.nan if v is None else float(v) for v in values], dtype=float)


def population_moments(r: np.ndarray) -> tuple[float, float, float, float]:
    """(mean, sigma, skewness, excess kurtosis) from scipy's central moments (divided by n)."""
    m2, m3, m4 = (float(sps.moment(r, k)) for k in (2, 3, 4))
    return float(np.mean(r)), math.sqrt(m2), m3 / m2 ** 1.5, m4 / m2 ** 2 - 3.0


def expansion(z, skew: float, exkurt: float):
    return z + (z ** 2 - 1) * skew / 6 + (z ** 3 - 3 * z) * exkurt / 24 - (2 * z ** 3 - 5 * z) * skew ** 2 / 36


def in_domain(skew: float, exkurt: float) -> bool:
    return bool(np.all(np.diff(expansion(Z_GRID, skew, exkurt)) > 0))


def edgeworth_density_nonnegative(h: float, skew: float, exkurt: float) -> bool:
    """Whether the second order Edgeworth density is non-negative on the grid of z at or below h (probabilists'
    Hermite polynomials from scipy, apart from the terminal's polynomial roots)."""
    z = np.append(Z_GRID[Z_GRID <= h], h)
    he = {k: special.eval_hermitenorm(k, z) for k in (3, 4, 6)}
    shape = 1 + skew / 6 * he[3] + exkurt / 24 * he[4] + skew ** 2 / 72 * he[6]
    return bool(np.all(sps.norm.pdf(z) * shape >= -DENSITY_TOLERANCE))


def edgeworth_mean_closed(h: float, skew: float, exkurt: float, tail: float) -> float:
    """PerformanceAnalytics' MES bracket over the tail, with its sign: the expected z at or below h."""
    bracket = (1 + h ** 3 * skew / 6.0 + (h ** 6 - 9 * h ** 4 + 9 * h ** 2 + 3) * skew ** 2 / 72
               + (h ** 4 - 2 * h ** 2 - 1) * exkurt / 24)
    return -float(sps.norm.pdf(h)) * bracket / tail


def edgeworth_mean_quad(h: float, skew: float, exkurt: float, tail: float) -> float:
    def integrand(z: float) -> float:
        he3, he4, he6 = z ** 3 - 3 * z, z ** 4 - 6 * z ** 2 + 3, z ** 6 - 15 * z ** 4 + 45 * z ** 2 - 15
        return z * sps.norm.pdf(z) * (1 + skew / 6 * he3 + exkurt / 24 * he4 + skew ** 2 / 72 * he6)
    value, _ = integrate.quad(integrand, -np.inf, h, epsabs=0, epsrel=1e-13, limit=200)
    return value / tail


def historical_cvar(r: np.ndarray, tail: float) -> float:
    cut = float(pd.Series(r).quantile(tail))
    return float(-r[r <= cut].mean())


def _rk4_level(r: np.ndarray, level: str, tail: float) -> dict:
    mu, sigma, skew, exkurt = population_moments(r)
    z = float(sps.norm.ppf(tail))
    h = float(expansion(z, skew, exkurt))
    closed = edgeworth_mean_closed(h, skew, exkurt, tail)
    quad = edgeworth_mean_quad(h, skew, exkurt, tail)
    raw, raw_quad = -mu - sigma * min(closed, h), -mu - sigma * min(quad, h)
    monotone = in_domain(skew, exkurt)
    inside = monotone and edgeworth_density_nonnegative(h, skew, exkurt)
    historical = historical_cvar(r, tail)
    modified = raw if inside and raw >= 0 else None
    key = f"rk4.{level}"
    out = {f"{key}.cf_quantile": Ref(h, SRC_ES), f"{key}.raw_expansion": Ref(raw, SRC_ES),
           f"{key}.raw_expansion_quad": Ref(raw_quad, SRC_QUAD, against=f"{key}.raw_expansion"),
           f"{key}.floored": Ref(float(closed > h), SRC_ES), f"{key}.in_domain": Ref(float(inside), SRC_GRID),
           f"{key}.gaussian": Ref(-mu + sigma * float(sps.norm.pdf(z)) / tail, "scipy norm.pdf, Gaussian ES"),
           f"{key}.historical": Ref(historical, SRC_CVAR), f"{key}.modified": Ref(modified, SRC_ES),
           f"{key}.value": Ref(historical if modified is None else modified, SRC_ES + "; else " + SRC_CVAR)}
    if modified is not None and modified > 1:
        out[f"{key}.pa_cap"] = Ref(1.0, "PerformanceAnalytics caps an ES above 1 at 1 (fractional returns only)",
                                   kind=DOCUMENTED, note="not applied: a one-contract series is in USD",
                                   against=f"{key}.value")
    if monotone and not inside and raw >= 0:
        out[f"{key}.pa_density"] = Ref(raw, "PerformanceAnalytics ES(method=\"modified\"), no density rule",
                                       kind=DOCUMENTED, against=f"{key}.value",
                                       note="deliberate deviation: the Edgeworth density is negative below h, so the "
                                            "terminal serves the historical CVaR (the ES would fall as K rises)")
    return out


def underwater_walk(r: np.ndarray, basis: str) -> list[float]:
    level, peak, out = (0.0, 0.0, []) if basis == "A" else (1.0, 1.0, [])
    for x in r:
        level = level + x if basis == "A" else level * (1.0 + x)
        peak = max(peak, level)
        out.append(level - peak if basis == "A" else level / peak - 1.0)
    return out


def _pf11(r: np.ndarray, basis: str, dates: pd.DatetimeIndex, on_capital: bool) -> dict:
    uw = underwater_walk(r, basis)
    ulcer = math.sqrt(sum(d * d for d in uw) / len(uw))
    total = sum(r) if basis == "A" else math.prod(1.0 + x for x in r) - 1.0
    depth = min(0.0, min(uw))
    out = {"pf11.ulcer_index": Ref(ulcer, SRC_WALK),
           "pf11.recovery_factor": Ref(total / abs(depth) if depth < 0 else None, SRC_WALK)}
    if not on_capital:  # quantstats compounds: on USD per contract its values mean nothing, so none is listed
        return out
    s = pd.Series(r, index=dates)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        qs_ulcer = float(qs.ulcer_index(s))
        qs_recovery = float(qs.recovery_factor(s, prepare_returns=False))
    n = len(r)
    if basis == "B":
        out["pf11.ulcer_index_quantstats"] = Ref(qs_ulcer * math.sqrt((n - 1) / n),
                                                 "quantstats.ulcer_index x sqrt((n - 1) / n)",
                                                 against="pf11.ulcer_index")
    out["pf11.ulcer_index_quantstats_raw"] = Ref(qs_ulcer, "quantstats.ulcer_index", kind=DOCUMENTED,
                                                 note="divides by n - 1 and compounds", against="pf11.ulcer_index")
    out["pf11.recovery_factor_quantstats"] = Ref(qs_recovery, "quantstats.recovery_factor", kind=DOCUMENTED,
                                                 note="abs(summed returns) over a compounded drawdown",
                                                 against="pf11.recovery_factor")
    return out


def _br5(r: np.ndarray, bench: np.ndarray, basis: str, periods: int) -> dict:
    keep = np.isfinite(r) & np.isfinite(bench)
    x, y = bench[keep], r[keep]
    growth = 1.0 + float(np.sum(r)) if basis == "A" else float(np.prod(1.0 + r))
    cagr = growth ** (periods / len(r)) - 1.0 if growth > 0 else (-1.0 if growth == 0 else math.nan)
    if len(x) < MIN_PAIRS or not float(np.var(x)) > 0:
        return {"br5.cagr": Ref(cagr, SRC_TREYNOR), "br5.beta": Ref(None, SRC_TREYNOR),
                "br5.treynor": Ref(None, SRC_TREYNOR)}
    beta = float(sm.OLS(y, sm.add_constant(x)).fit().params[1])
    value = cagr / beta if beta != 0 and math.isfinite(cagr) else None
    return {"br5.cagr": Ref(cagr, SRC_TREYNOR), "br5.beta": Ref(beta, "statsmodels OLS slope"),
            "br5.treynor": Ref(value, SRC_TREYNOR)}


def p2risk_references(inputs: dict) -> dict:
    r, basis, periods = _floats(inputs["r"]), inputs["basis"], int(inputs["periods"])
    on_capital = bool(inputs["on_capital"])
    dates = pd.DatetimeIndex(pd.to_datetime(inputs["dates"]))
    summed = basis if on_capital else "A"
    out = {}
    for level, tail in TAILS.items():
        out.update(_rk4_level(r, level, tail))
    out.update(_pf11(r, summed, dates, on_capital))
    if on_capital and inputs.get("bench") is not None:
        out.update(_br5(r, _floats(inputs["bench"]), basis, periods))
    return out


P2_RISK_INPUTS = {"p2risk": ("dates", "r", "bench", "basis", "periods", "on_capital")}
P2_RISK_REFERENCES = {"p2risk": p2risk_references}
