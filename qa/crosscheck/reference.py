"""Reference values for every P0 scalar, recomputed with the independent libraries of the QA environment.

Each metric maps to a `Ref`: the value, the library call that produced it, and whether the library's
definition matches the catalogue (`exact`, compared at 1e-9 relative) or legitimately differs
(`documented`, shown for information and never failed). The metric keys and units are the ones
`test_dump_for_qa.py` writes.

Where the reference libraries legitimately differ from the catalogue (ANALYTICS_CATALOG section 14):
- quantstats `value_at_risk` is parametric normal; RK1 is historical, so empyrical `value_at_risk` is the
  reference and the quantstats value is INFO.
- quantstats `calmar(compounded=False)` still divides by the compounded drawdown; a Basis A Calmar is checked as
  `cagr(compounded=False)` over the Basis A drawdown instead (quantstats value INFO).
- quantstats `information_ratio` is not annualised (INFO); empyrical `excess_sharpe` x sqrt(P) is the reference.
- quantstats `probabilistic_sharpe_ratio` uses bias-corrected pandas skew and kurtosis; the terminal uses the
  plain moment estimators of Bailey and Lopez de Prado (differences of order 1/n, INFO).
- empyrical `conditional_value_at_risk` averages the lowest floor((n-1) q) + 1 returns; the catalogue's
  `mean(r | r <= Q_q)` is the same set unless returns tie at the quantile. No tie occurs in the dumped cases.
- quantstats `aggregate_returns(r, "M")` groups by month of year only; "ME" is the year-month grouping.
- Basis A (units of K, summed) has no library equivalent for drawdown: the reference is an independent numpy
  expression, and the dump also carries `sizing_stats.max_drawdown`. The libraries and Nautilus compound, so
  their CAGR, drawdown and Calmar are compared only on Basis B cases.
- RK2, RL1, RL2 and best or worst session are daily items and are not referenced for a monthly book.
- EQ's performance difference and RR's rolling volatility high and low (Phase 8) have no library equivalent: the
  references are independent numpy (running sums or products over the sessions where the benchmark has a value;
  the extremes of empyrical's rolling volatility).
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats as sps

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import empyrical as ep
    import quantstats.stats as qs
    import quantstats.utils as qu
    import statsmodels.api as sm
    from statsmodels.stats.multitest import multipletests

from crosscheck.dumps import Case

EXACT, DOCUMENTED = "exact", "documented"
NW_LAGS = (5, 21)
CONFIDENCE = (0.95, 0.99)
ROLL_WINDOWS = (63, 252)
MINTRL_ALPHA = 0.05
SHORTFALL_WINDOW = 21
DAILY = 252  # RK2, RL1, RL2 and best or worst session are daily-series items; a monthly book has none of them
CI_Z = 1.96  # PF4 as written in the catalogue: SR +/- 1.96 SE (not the exact 1.959964)
# Moments inside the Mertens standard error, PSR and MinTRL: sample (biased) moments, as in Bailey and
# Lopez de Prado's PSR (the catalogue leaves the estimator open). quantstats uses the bias-corrected pandas
# estimators instead, so its PSR differs at order 1/n and is shown as a documented difference.
MOMENT_BIAS = True


@dataclass(frozen=True)
class Ref:
    value: object
    source: str
    kind: str = EXACT
    note: str = ""
    against: str = ""  # the dumped metric this reference is compared with; empty means its own key


def _quiet(fn, *args, **kwargs):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


def moments(r: np.ndarray, bias: bool = MOMENT_BIAS) -> tuple[float, float]:
    """(skewness, raw kurtosis) with scipy; raw kurtosis is 3 for a normal distribution."""
    return float(sps.skew(r, bias=bias)), float(sps.kurtosis(r, fisher=False, bias=bias))


def psr(sr: float, sr_star: float, n: int, skew: float, kurt: float) -> float:
    """Bailey and Lopez de Prado, DSR paper eq. 2; SR per period, kurt raw."""
    return float(sps.norm.cdf((sr - sr_star) * math.sqrt(n - 1) / math.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr**2)))


def _per_period_sharpe(r: np.ndarray) -> float:
    return float(ep.sharpe_ratio(r, annualization=1))


def _core(case: Case) -> dict:
    r, p, s = case.r, case.periods, case.series
    out = {
        "n": Ref(float(len(r)), "len(r)"),
        "years": Ref(len(r) / p, "len(r) / periods"),
        "vol": Ref(float(ep.annual_volatility(r, annualization=p)), "empyrical.annual_volatility"),
        "sharpe": Ref(float(ep.sharpe_ratio(r, annualization=p)), "empyrical.sharpe_ratio"),
        "sortino": Ref(float(ep.sortino_ratio(r, annualization=p)), "empyrical.sortino_ratio"),
        "skew": Ref(float(_quiet(qs.skew, s)), "quantstats.skew (pandas, bias-corrected)"),
        "excess_kurtosis": Ref(float(_quiet(qs.kurtosis, s)), "quantstats.kurtosis (pandas, bias-corrected, Fisher)"),
        "hit_rate": Ref(float(_quiet(qs.win_rate, s)), "quantstats.win_rate (positive over non-zero sessions)"),
    }
    if p == DAILY:
        out["best_day"] = Ref(float(_quiet(qs.best, s)), "quantstats.best")
        out["worst_day"] = Ref(float(_quiet(qs.worst, s)), "quantstats.worst")
    for level in CONFIDENCE:
        pct = round(level * 100)
        cut = 1 - level
        out[f"var_{pct}"] = Ref(-float(ep.value_at_risk(r, cutoff=cut)), "-empyrical.value_at_risk (linear)")
        out[f"cvar_{pct}"] = Ref(-float(ep.conditional_value_at_risk(r, cutoff=cut)),
                                 "-empyrical.conditional_value_at_risk")
        out[f"var_{pct}_parametric"] = Ref(
            -float(_quiet(qs.value_at_risk, s, confidence=level)), "-quantstats.value_at_risk", DOCUMENTED,
            "quantstats VaR is parametric normal (mu + sigma z); the catalogue's RK1 is historical", f"var_{pct}")
    return out


def _by_basis(case: Case) -> dict:
    r, p, s = case.r, case.periods, case.series
    compounded = case.basis == "B"
    months = _quiet(qu.aggregate_returns, s, "ME", compounded)
    out = {
        "cagr": Ref(float(_quiet(qs.cagr, s, compounded=compounded, periods=p)),
                    f"quantstats.cagr(compounded={compounded})"),
        "best_month": Ref(float(months.max()), f"quantstats.utils.aggregate_returns('ME', compounded={compounded})"),
        "worst_month": Ref(float(months.min()), f"quantstats.utils.aggregate_returns('ME', compounded={compounded})"),
        "pct_positive_months": Ref(float((months > 0).mean()), "share of positive aggregate_returns('ME') months"),
        "monthly_returns": Ref({str(k): float(v) for k, v in _month_keys(months).items()},
                               f"quantstats.utils.aggregate_returns('ME', compounded={compounded})"),
    }
    if compounded:
        out["total_return"] = Ref(float(_quiet(qs.comp, s)), "quantstats.comp")
        out["max_drawdown"] = Ref(-float(ep.max_drawdown(r)), "-empyrical.max_drawdown (baseline E_0 = K)")
        out["calmar"] = Ref(float(ep.calmar_ratio(r, annualization=p)), "empyrical.calmar_ratio")
        out["drawdown_series"] = Ref((-_quiet(qs.to_drawdown_series, s)).tolist(), "-quantstats.to_drawdown_series")
        out["cagr_empyrical"] = Ref(float(ep.cagr(r, annualization=p)), "empyrical.cagr", against="cagr")
    else:
        dd = basis_a_drawdown(r)
        out["total_return"] = Ref(float(np.sum(r)), "sum(r) (Basis A, units of K)")
        out["max_drawdown"] = Ref(float(dd.max()), "independent numpy: max(0, cummax(cumsum r)) - cumsum r",
                                  note="no library works in units of K; checked against sizing_stats too")
        cagr = float(_quiet(qs.cagr, s, compounded=False, periods=p))
        out["calmar"] = Ref(cagr / float(dd.max()), "quantstats.cagr(compounded=False) / Basis A MaxDD")
        out["drawdown_series"] = Ref(dd.tolist(), "independent numpy (Basis A)")
        out["calmar_quantstats"] = Ref(float(_quiet(qs.calmar, s, compounded=False, periods=p)),
                                       "quantstats.calmar(compounded=False)", DOCUMENTED,
                                       "quantstats divides by the compounded drawdown even for summed returns",
                                       "calmar")
    return out


def _month_keys(months: pd.Series) -> pd.Series:
    index = months.index
    if isinstance(index, pd.MultiIndex):
        keys = [f"{int(y):04d}-{int(m):02d}" for y, m in index]
    else:
        keys = [pd.Timestamp(t).strftime("%Y-%m") for t in index]
    return pd.Series(months.to_numpy(), index=keys)


def basis_a_drawdown(r: np.ndarray) -> np.ndarray:
    """Drawdown in units of K: peak of cumsum r (floored at 0, the starting capital) minus cumsum r."""
    equity = np.cumsum(r)
    return np.maximum.accumulate(np.maximum(equity, 0.0)) - equity


def _validity(case: Case) -> dict:
    r, p, n = case.r, case.periods, len(case.r)
    sr = _per_period_sharpe(r)
    g3, g4 = moments(r)
    se = math.sqrt((1 - g3 * sr + (g4 - 1) / 4 * sr**2) / (n - 1)) * math.sqrt(p)
    z = sps.norm.ppf(1 - MINTRL_ALPHA)
    label = "scipy moments (bias=%s)" % MOMENT_BIAS
    out = {
        "sharpe_se": Ref(se, f"Mertens (2002) SE, {label}, x sqrt(P)"),
        "sharpe_ci_lo": Ref(sr * math.sqrt(p) - CI_Z * se, "SR - 1.96 SE"),
        "sharpe_ci_hi": Ref(sr * math.sqrt(p) + CI_Z * se, "SR + 1.96 SE"),
        "psr_0": Ref(psr(sr, 0.0, n, g3, g4), f"PSR(0), {label}"),
        "psr_0_quantstats": Ref(float(_quiet(qs.probabilistic_sharpe_ratio, case.series, periods=p)),
                                "quantstats.probabilistic_sharpe_ratio", DOCUMENTED,
                                "quantstats uses bias-corrected pandas skew and kurtosis (order 1/n apart)", "psr_0"),
        "mintrl_sessions": Ref(1 + (1 - g3 * sr + (g4 - 1) / 4 * sr**2) * (z / sr) ** 2 if sr > 0 else math.inf,
                               f"MinTRL at SR* = 0, alpha {MINTRL_ALPHA}, {label}"),
    }
    if case.bench is not None:
        out["psr_bench"] = Ref(psr(sr, _per_period_sharpe(case.bench), n, g3, g4), f"PSR(SR* = benchmark), {label}")
    return out


def _relative(case: Case) -> dict:
    if case.bench is None:
        return {}
    r, b, p = case.r, case.bench, case.periods
    X = sm.add_constant(b)
    fits = {lag: sm.OLS(r, X).fit(cov_type="HAC", cov_kwds={"maxlags": lag, "use_correction": False})
            for lag in NW_LAGS}
    first = fits[NW_LAGS[0]]
    source = "statsmodels OLS, HAC Bartlett, use_correction=False"
    out = {"alpha_annual_pct": Ref(float(p * first.params[0] * 100), source),
           "beta": Ref(float(first.params[1]), source),
           "alpha_t_min": Ref(float(min(f.tvalues[0] for f in fits.values())), source)}
    out.update({f"alpha_t_{lag}": Ref(float(f.tvalues[0]), f"{source}, maxlags={lag}") for lag, f in fits.items()})
    active = r - b
    out["information_ratio"] = Ref(float(ep.excess_sharpe(r, b)) * math.sqrt(p), "empyrical.excess_sharpe x sqrt(P)")
    out["tracking_error"] = Ref(float(np.std(active, ddof=1)) * math.sqrt(p), "numpy std(r - b, ddof=1) x sqrt(P)")
    out["information_ratio_quantstats"] = Ref(
        float(_quiet(qs.information_ratio, case.series, pd.Series(b, index=case.dates))),
        "quantstats.information_ratio", DOCUMENTED, "quantstats does not annualise the information ratio",
        "information_ratio")
    return out


def _tails(case: Case) -> dict:
    if case.periods != DAILY:
        return {}
    sums = np.sort(pd.Series(case.r).rolling(SHORTFALL_WINDOW).sum().dropna().to_numpy())
    out = {}
    if not len(sums):
        return out
    for q, key in ((0.01, "shortfall21_1pct"), (0.05, "shortfall21_5pct")):
        k = max(1, math.ceil(q * len(sums)))
        out[key] = Ref(float(sums[:k].mean() * 100), "pandas overlapping 21-session sums, mean of worst ceil(q n), %")
    return out


def _rolling(case: Case) -> dict:
    out = {}
    for w in ROLL_WINDOWS:
        if case.periods != DAILY or len(case.r) < w:
            continue
        pad = [None] * (w - 1)
        sharpe = ep.roll_sharpe_ratio(case.r, window=w, annualization=case.periods)
        vol = ep.roll_annual_volatility(case.r, window=w, annualization=case.periods)
        out[f"rolling_sharpe_{w}"] = Ref(pad + [float(v) for v in sharpe], "empyrical.roll_sharpe_ratio")
        out[f"rolling_vol_{w}"] = Ref(pad + [float(v) for v in vol], "empyrical.roll_annual_volatility")
    return out


def performance_difference(r: np.ndarray, bench: np.ndarray, basis: str) -> list[float]:
    """Strategy minus benchmark cumulative return; the benchmark accumulates over its own present sessions."""
    present = ~np.isnan(bench)
    theirs = np.full(len(r), np.nan)
    if basis == "A":
        mine, theirs[present] = np.cumsum(r), np.cumsum(bench[present])
    else:
        mine, theirs[present] = np.cumprod(1.0 + r) - 1.0, np.cumprod(1.0 + bench[present]) - 1.0
    return (mine - theirs).tolist()


def _extras(case: Case) -> dict:
    out = {}
    if case.bench is not None:
        out["perf_difference"] = Ref(performance_difference(case.r, case.bench, case.basis),
                                     "independent numpy: cumulative r minus cumulative benchmark (present sessions)")
    for w in ROLL_WINDOWS:
        if case.periods != DAILY or len(case.r) < w:
            continue
        vol = np.asarray(ep.roll_annual_volatility(case.r, window=w, annualization=case.periods), dtype=float)
        vol = vol[np.isfinite(vol)]
        if len(vol):
            out[f"rolling_vol_{w}_hi"] = Ref(float(vol.max()), "max of empyrical.roll_annual_volatility")
            out[f"rolling_vol_{w}_lo"] = Ref(float(vol.min()), "min of empyrical.roll_annual_volatility")
    return out


def series_references(case: Case) -> dict:
    refs = {}
    for part in (_core, _by_basis, _validity, _relative, _tails, _rolling, _extras):
        refs.update(part(case))
    return refs


def registry_references(p) -> dict:
    p = np.asarray(p, dtype=float)
    source = "statsmodels.stats.multitest.multipletests"
    return {key: Ref(multipletests(p, method=method)[1].tolist(), f"{source}(method={method!r})")
            for key, method in (("bonferroni_p", "bonferroni"), ("holm_p", "holm"), ("bh_q", "fdr_bh"))}
