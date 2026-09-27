"""Benchmark-relative analytics (ANALYTICS_CATALOG section 6: BR1 and BR2).

Conventions (catalogue section 0):
- C2: daily series, P = 252 unless the caller passes the monthly 12; sd with ddof = 1; risk-free rate 0.
- C6: the benchmark comes from the run's spec; this module takes whatever series the caller passes.
- C8: BR1 is nq-lab's own `sizing_stats.spanning_alpha` (and `block_alphas` for the 2010-13, 2014-17, 2018-21
  blocks), imported, not reimplemented: `r = a + b*r_b + e`, alpha_annual = P*a (arithmetic), Newey-West t at
  lags 5 and 21, gating t = the minimum.

Inputs are aligned first: two Series join on their index, two arrays must have equal length, and any row where
either side is NaN is dropped (the screens drop their first session this way: 2,687 rows, n_eval 2,686).

BR3 (P1): up and down capture as Nautilus `UpCaptureRatio` and `DownCaptureRatio` (empyrical's convention): over the
sessions where the benchmark is above (below) zero, the ratio of the two geometric annualised returns
`prod(1 + x)^(P / m) - 1`, m the number of those sessions. Labelled "annualised geometric"; NaN without such sessions.
BR4 (P1): the scatter of r against r_b on the aligned rows, with BR1's OLS line (`a` and `b` of the same fit).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from nq_lab.sizing_stats import block_alphas, spanning_alpha
from nq_terminal.analytics._inputs import check_periods

PERIODS_PER_YEAR = 252
NW_LAGS = (5, 21)


def align_pair(r, b) -> tuple[np.ndarray, np.ndarray, pd.Index | None]:
    """Strategy and benchmark returns as float arrays on common, finite-for-both rows.

    Two Series are inner-joined on their index; otherwise the inputs must have the same length. Returns the
    aligned index (None for plain arrays) so callers can keep session dates.
    """
    if isinstance(r, pd.Series) and isinstance(b, pd.Series):
        both = pd.concat({"r": r, "b": b}, axis=1, join="inner").astype(float).dropna()
        return both["r"].to_numpy(), both["b"].to_numpy(), both.index
    x, y = np.asarray(r, dtype=float), np.asarray(b, dtype=float)
    if x.shape != y.shape or x.ndim != 1:
        raise ValueError(f"r and b must be 1-D with the same length, got {x.shape} and {y.shape}")
    keep = ~(np.isnan(x) | np.isnan(y))
    return x[keep], y[keep], None


def active_returns(r, b) -> np.ndarray:
    """r - b on the aligned rows."""
    x, y, _ = align_pair(r, b)
    return x - y


def tracking_error(r, b, periods: int = PERIODS_PER_YEAR) -> float:
    """BR2: TE = sd(r - b, ddof=1) * sqrt(P); NaN with fewer than two rows."""
    check_periods(periods)
    a = active_returns(r, b)
    if len(a) < 2:
        return math.nan
    return float(a.std(ddof=1) * math.sqrt(periods))


def information_ratio(r, b, periods: int = PERIODS_PER_YEAR) -> float:
    """BR2: IR = mean(r - b) / sd(r - b, ddof=1) * sqrt(P); NaN when the active return has no spread."""
    check_periods(periods)
    a = active_returns(r, b)
    if len(a) < 2:
        return math.nan
    sd = float(a.std(ddof=1))
    if not sd > 0:
        return math.nan
    return float(a.mean() / sd * math.sqrt(periods))


def alpha_beta(r, b, lags: tuple = NW_LAGS, periods: int = PERIODS_PER_YEAR) -> dict:
    """BR1: `sizing_stats.spanning_alpha` on the aligned rows (keys n, a, b, alpha_annual_pct, t, t_b, t_min)."""
    check_periods(periods)
    x, y, _ = align_pair(r, b)
    return spanning_alpha(x, y, lags, periods)


def alpha_by_block(r: pd.Series, b: pd.Series, lags: tuple = NW_LAGS, periods: int = PERIODS_PER_YEAR) -> dict:
    """BR1 per block (`sizing_stats.block_alphas`, blocks from `calendar_report.BLOCKS`).

    Needs two Series on a DatetimeIndex, because a block is chosen by the session's calendar year.
    """
    if not (isinstance(r, pd.Series) and isinstance(b, pd.Series)
            and isinstance(r.index, pd.DatetimeIndex) and isinstance(b.index, pd.DatetimeIndex)):
        raise TypeError("alpha_by_block needs two pandas Series on a DatetimeIndex")
    check_periods(periods)
    x, y, index = align_pair(r, b)
    return block_alphas(list(index), x, y, lags, periods)


def relative_summary(r: pd.Series, b: pd.Series, lags: tuple = NW_LAGS,
                     periods: int = PERIODS_PER_YEAR) -> dict:
    """BR1 and BR2 together for one strategy and its spec benchmark (descriptive, [POST HOC] when computed)."""
    x, _, _ = align_pair(r, b)
    return {
        "n": int(len(x)),
        "periods_per_year": periods,
        "information_ratio": information_ratio(r, b, periods),
        "tracking_error": tracking_error(r, b, periods),
        "alpha": alpha_beta(r, b, lags, periods),
        "blocks": alpha_by_block(r, b, lags, periods),
    }


def _annual_geometric(x: np.ndarray, periods: int) -> float:
    return float(np.prod(1.0 + x) ** (periods / len(x)) - 1.0) if len(x) else math.nan


def _capture(r, b, periods: int, up: bool) -> float:
    check_periods(periods)
    x, y, _ = align_pair(r, b)
    keep = y > 0 if up else y < 0
    theirs = _annual_geometric(y[keep], periods)
    if not keep.any() or theirs == 0 or math.isnan(theirs):
        return math.nan
    return _annual_geometric(x[keep], periods) / theirs


def up_capture(r, b, periods: int = PERIODS_PER_YEAR) -> float:
    """BR3 over the sessions where the benchmark rose."""
    return _capture(r, b, periods, up=True)


def down_capture(r, b, periods: int = PERIODS_PER_YEAR) -> float:
    """BR3 over the sessions where the benchmark fell."""
    return _capture(r, b, periods, up=False)


def scatter(r, b, periods: int = PERIODS_PER_YEAR) -> dict:
    """BR4: the aligned points (x the benchmark, y the strategy) and BR1's line y = intercept + slope x."""
    mine, theirs, index = align_pair(r, b)
    fit = spanning_alpha(mine, theirs, NW_LAGS, check_periods(periods))
    return {"x": theirs, "y": mine, "index": index, "slope": fit["b"], "intercept": fit["a"], "n": int(len(mine))}
