"""Performance (ANALYTICS_CATALOG.md section 1: PF1 to PF6 and the PF10 stats table).

Conventions (section 0):
- C1 basis: "A" (screen) equity `K * (1 + cumsum r)`; "B" (account) equity `K * prod(1 + r)`.
- C2: trading sessions only; P = 252 daily or 12 monthly (anything else is refused); sd with ddof = 1;
  risk-free rate 0.

PF2  total return `E_T / E_0 - 1`; CAGR `(E_T / E_0)^(P / n) - 1`, n sessions (Nautilus `CAGR`).
PF3  volatility `sd(r, ddof=1) * sqrt(P)`.
PF4  Sharpe `mean / sd(ddof=1) * sqrt(P)` (`nq_lab.sizing_stats.sharpe`; tested to agree). 95% CI
     `SR +/- 1.96 * SE_d * sqrt(P)` with the Mertens (2002) standard error of the per-period Sharpe,
     `SE_d = sqrt((1 - g3 * SR_d + (g4 - 1) / 4 * SR_d^2) / (n - 1))`, where SR_d uses ddof = 1 and g3, g4 are
     the sample skewness and raw (non-excess, normal = 3) kurtosis with the plain moment estimator
     (`scipy.stats.skew` / `kurtosis(fisher=False)`, bias=True), as in Bailey and Lopez de Prado's PSR code.
     `sharpe_moments` exposes (SR_d, g3, g4) so the PSR (SV1) can use the same moments.
PF5  Sortino `mean / sqrt(mean(min(r, 0)^2)) * sqrt(P)`: target 0, denominator over all n sessions
     (Nautilus `SortinoRatio`).
PF6  Calmar `CAGR / abs(MaxDD)` over the full sample (not the 36-month classic), MaxDD from DD1 on the same basis.
PF7  Omega(0), PF8 tail ratio and PF9 gain to pain (P1) are at the end of the module.
PF10 stats table: hit rate (positive over non-zero sessions, as quantstats `win_rate`), best and worst session
     and month, share of positive months, skew `scipy.stats.skew(bias=False)`, excess kurtosis
     `kurtosis(fisher=True, bias=False)` (as the screens), n and years = n / P.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_terminal.analytics import validity
from nq_terminal.analytics._inputs import (
    PERIODS_DAILY,
    PERIODS_MONTHLY,
    check_basis,
    check_periods,
    returns_array,
    returns_series,
)
from nq_terminal.analytics.distribution import monthly_returns
from nq_terminal.analytics.drawdown import max_drawdown

CI_Z = 1.96


def equity_curve(r, basis: str, capital: float = 1.0) -> pd.Series:
    """PF1 equity after each session (E_0 = capital is not a row), on the caller's index."""
    check_basis(basis)
    series = returns_series(r)
    values = series.to_numpy()
    level = 1.0 + np.cumsum(values) if basis == "A" else np.cumprod(1.0 + values)
    return pd.Series(capital * level, index=series.index, dtype=float)


def _growth(values: np.ndarray, basis: str) -> float:
    """E_T / E_0."""
    return float(1.0 + values.sum()) if basis == "A" else float(np.prod(1.0 + values))


def total_return(r, basis: str) -> float:
    """PF2 total return E_T / E_0 - 1."""
    check_basis(basis)
    return _growth(returns_array(r), basis) - 1.0


def cagr(r, basis: str, periods: int = PERIODS_DAILY) -> float:
    """PF2 CAGR over n sessions; -1 for a book wiped out exactly, NaN below zero equity or on no data."""
    check_basis(basis)
    check_periods(periods)
    values = returns_array(r)
    if not len(values):
        return math.nan
    growth = _growth(values, basis)
    if growth < 0:
        return math.nan
    return -1.0 if growth == 0 else growth ** (periods / len(values)) - 1.0


def annual_return(r, periods: int = PERIODS_DAILY) -> float:
    """Arithmetic annualised mean, mean * P."""
    check_periods(periods)
    values = returns_array(r)
    return float(values.mean() * periods) if len(values) else math.nan


def annual_volatility(r, periods: int = PERIODS_DAILY) -> float:
    """PF3 sd(r, ddof=1) * sqrt(P); NaN with fewer than two sessions."""
    check_periods(periods)
    values = returns_array(r)
    return float(values.std(ddof=1) * math.sqrt(periods)) if len(values) > 1 else math.nan


def sharpe(r, periods: int = PERIODS_DAILY) -> float:
    """PF4 point estimate; NaN with fewer than two sessions or no spread."""
    check_periods(periods)
    values = returns_array(r)
    if len(values) < 2:
        return math.nan
    sd = values.std(ddof=1)
    return float(values.mean() / sd * math.sqrt(periods)) if sd > 0 else math.nan


def sharpe_moments(r) -> tuple[float, float, float]:
    """(SR_d per period with ddof = 1, skewness g3, raw kurtosis g4): `validity.moments` after refusing NaN."""
    values = returns_array(r)
    if len(values) < 3 or not values.std(ddof=1) > 0:
        return math.nan, math.nan, math.nan
    m = validity.moments(values)
    return m["sr"], m["skew"], m["kurt"]


def sharpe_standard_error(r) -> float:
    """Mertens (2002) standard error of the per-period Sharpe (`validity.mertens_se`); NaN when undefined."""
    sr, g3, g4 = sharpe_moments(r)
    if math.isnan(sr):
        return math.nan
    return validity.mertens_se(sr, len(returns_array(r)), g3, g4)


def sharpe_ci(r, periods: int = PERIODS_DAILY, z: float = CI_Z) -> tuple[float, float]:
    """PF4 95% CI (default z 1.96): annualised Sharpe +/- z * SE_d * sqrt(P), through `validity.sharpe_ci` (one
    implementation of the interval; this path refuses NaN where validity drops it)."""
    check_periods(periods)
    values = returns_array(r)
    if len(values) < 2:
        return math.nan, math.nan
    found = validity.sharpe_ci(values, periods, z)
    return found["lo"], found["hi"]


def sortino(r, periods: int = PERIODS_DAILY) -> float:
    """PF5, target 0, downside deviation over all n sessions; NaN without any losing session."""
    check_periods(periods)
    values = returns_array(r)
    if not len(values):
        return math.nan
    downside = math.sqrt(float(np.mean(np.minimum(values, 0.0) ** 2)))
    return float(values.mean() / downside * math.sqrt(periods)) if downside > 0 else math.nan


def calmar(r, basis: str, periods: int = PERIODS_DAILY) -> float:
    """PF6 full-sample Calmar; NaN without a drawdown."""
    depth = max_drawdown(r, basis)
    return cagr(r, basis, periods) / abs(depth) if depth < 0 else math.nan


def _month_values(series: pd.Series, basis: str, periods: int) -> np.ndarray | None:
    if periods == PERIODS_MONTHLY:
        return series.to_numpy()
    if not isinstance(series.index, pd.DatetimeIndex):
        return None
    return monthly_returns(series, basis).to_numpy()


def _month_stats(months: np.ndarray | None) -> dict:
    if months is None or not len(months):
        return {"best_month": None, "worst_month": None, "pct_positive_months": None}
    return {"best_month": float(months.max()), "worst_month": float(months.min()),
            "pct_positive_months": float((months > 0).mean())}


def _session_stats(values: np.ndarray, periods: int) -> dict:
    nonzero = int((values != 0).sum())
    daily = periods == PERIODS_DAILY and len(values) > 0
    return {"hit_rate": float((values > 0).sum() / nonzero) if nonzero else math.nan,
            "best_day": float(values.max()) if daily else None, "worst_day": float(values.min()) if daily else None,
            "skew": float(sps.skew(values, bias=False)) if len(values) > 2 else math.nan,
            "excess_kurtosis": float(sps.kurtosis(values, fisher=True, bias=False)) if len(values) > 3 else math.nan}


def stats_table(r, basis: str, periods: int = PERIODS_DAILY) -> dict:
    """PF10. Months need a DatetimeIndex on a daily series (else None); a monthly book's rows are its months."""
    check_basis(basis)
    check_periods(periods)
    series = returns_series(r)
    values = series.to_numpy()
    return {"n": int(len(values)), "years": len(values) / periods, **_session_stats(values, periods),
            **_month_stats(_month_values(series, basis, periods))}


def performance_difference(r, bench, basis: str) -> pd.Series:
    """EQ's lower pane: the strategy's cumulative return minus its benchmark's, in fractions of K (Basis A: running
    sums, `cumsum r - cumsum b`; Basis B: `prod(1 + r) - prod(1 + b)`), on the strategy's index. The benchmark
    accumulates over the sessions where it has a value (as its own equity curve does) and the difference is NaN
    elsewhere. Times K it is the gap between the two equity curves."""
    check_basis(basis)
    series = returns_series(r)
    bench = pd.Series(bench, dtype=float).reindex(series.index)
    present = bench.dropna()
    if basis == "A":
        mine, theirs = series.cumsum(), present.cumsum()
    else:
        mine, theirs = (1.0 + series).cumprod() - 1.0, (1.0 + present).cumprod() - 1.0
    return (mine - theirs.reindex(series.index)).astype(float)


# ---------------------------------------------------------------- P1: PF7, PF8, PF9


def omega(r) -> float:
    """PF7 Omega(0): sum of gains over sum of losses, `sum max(r, 0) / sum max(-r, 0)` (empyrical `omega_ratio` at a
    zero threshold); NaN below two sessions or without a losing session."""
    values = returns_array(r)
    losses = float(np.maximum(-values, 0.0).sum())
    if len(values) < 2 or not losses > 0:
        return math.nan
    return float(np.maximum(values, 0.0).sum()) / losses


def tail_ratio(r) -> float:
    """PF8 `abs(Q95 / Q5)` with numpy's linear quantiles; NaN when Q5 is 0 or there is no data."""
    values = returns_array(r)
    if not len(values):
        return math.nan
    low = float(np.quantile(values, 0.05))
    return abs(float(np.quantile(values, 0.95)) / low) if low != 0 else math.nan


def gain_to_pain(r, basis: str, periods: int = PERIODS_DAILY) -> float:
    """PF9 on months: `sum r_m / abs(sum min(r_m, 0))`; Basis A month sums, Basis B compounded months (RD2); a monthly
    book's rows are its months. NaN without a losing month or without dates on a daily series."""
    check_basis(basis)
    check_periods(periods)
    months = _month_values(returns_series(r), basis, periods)
    if months is None or not len(months):
        return math.nan
    pain = abs(float(np.minimum(months, 0.0).sum()))
    return float(months.sum()) / pain if pain > 0 else math.nan
