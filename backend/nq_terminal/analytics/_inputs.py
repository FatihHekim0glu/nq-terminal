"""Input checks shared by perf, drawdown, rolling, distribution and risk.

Conventions (ANALYTICS_CATALOG.md section 0):
- C1: every function that depends on compounding takes `basis`: "A" (screen, arithmetic on fixed K) or
  "B" (account, compounded).
- C2: P is 252 for daily series or 12 for monthly books, never anything else (a sqrt(365) Sharpe is refused).

Returns must already be clean: a NaN or infinite value is refused rather than dropped, so a gap in a series
builder shows up as an error instead of a silently shorter sample.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

BASES = ("A", "B")
PERIODS_DAILY = 252
PERIODS_MONTHLY = 12
ALLOWED_PERIODS = (PERIODS_DAILY, PERIODS_MONTHLY)


def check_basis(basis: str) -> str:
    if basis not in BASES:
        raise ValueError(f"basis must be 'A' (screen) or 'B' (account), got {basis!r}")
    return basis


def check_periods(periods: int) -> int:
    if periods not in ALLOWED_PERIODS:
        raise ValueError(f"periods must be 252 (daily) or 12 (monthly), got {periods!r}")
    return periods


def returns_array(r) -> np.ndarray:
    """One-dimensional float array of finite returns."""
    values = r.to_numpy(dtype=float) if isinstance(r, pd.Series) else np.asarray(r, dtype=float)
    if values.ndim != 1:
        raise ValueError(f"returns must be one-dimensional, got shape {values.shape}")
    if not np.isfinite(values).all():
        raise ValueError("returns contain NaN or infinite values; build a clean session series first")
    return values


def returns_series(r) -> pd.Series:
    """The returns as a float Series, keeping the caller's index (a RangeIndex for plain arrays)."""
    values = returns_array(r)
    index = r.index if isinstance(r, pd.Series) else pd.RangeIndex(len(values))
    return pd.Series(values, index=index, dtype=float)


def dated_series(r) -> pd.Series:
    """Returns on a DatetimeIndex, needed for month and year grouping."""
    series = returns_series(r)
    if not isinstance(series.index, pd.DatetimeIndex):
        raise ValueError("month and year grouping needs a Series on a DatetimeIndex")
    return series
