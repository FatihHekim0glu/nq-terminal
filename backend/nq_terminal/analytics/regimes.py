"""RG1 volatility regimes (ANALYTICS_CATALOG section 10). Descriptive, [POST HOC], a fixed split (not user picked).

The variable is NQ's 22-session RTH realised variance from `nq_lab.sizing_rv`, as the sizing screen recorded it
(`results/screens/volmanaged_v0_daily.csv` column `sigma2`, dated by session; the caller reads it). For a session t:
- `x_t` is the last value dated strictly before t, so it was known at t-1 (never the same session's value);
- the thresholds are the 1/3 and 2/3 quantiles (numpy linear) of every value dated strictly before t, once at least
  252 such values exist (an expanding window: no look-ahead);
- the regime is "low" when `x_t <= q_low`, "high" when `x_t > q_high`, else "mid"; sessions without enough history
  have none.
Per regime: n, mean, annualised Sharpe (sd ddof 1), hit rate over the non-zero sessions; and Welch's t (scipy
`ttest_ind(equal_var=False)`) of the high against the low regime. No p-value is shown.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_terminal.analytics._inputs import PERIODS_DAILY, check_periods, returns_series

MIN_HISTORY = 252
REGIMES = ("low", "mid", "high")
TAG = "[POST HOC]"
LABEL = ("volatility regimes: NQ 22-session RTH realised variance known the session before, against the terciles of "
         "its own earlier values (at least 252); descriptive, in-sample, not a registered test")


def _clean_rv(rv: pd.Series) -> pd.Series:
    series = pd.Series(rv, dtype=float).dropna()
    if not isinstance(series.index, pd.DatetimeIndex):
        raise ValueError("the realised variance needs a DatetimeIndex of session dates")
    return series.sort_index()


def regime_frame(rv: pd.Series, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Per session of `index`: the lagged variable x, the two thresholds and the regime (None without history)."""
    series = _clean_rv(rv)
    values, dates = series.to_numpy(), series.index
    known = np.searchsorted(dates.to_numpy(), pd.DatetimeIndex(index).to_numpy(), side="left")  # values before t
    rows = []
    for count in known:
        if count < MIN_HISTORY:
            rows.append((values[count - 1] if count else math.nan, math.nan, math.nan, None))
            continue
        history = values[:count]
        lo, hi = float(np.quantile(history, 1 / 3)), float(np.quantile(history, 2 / 3))
        x = float(history[-1])
        rows.append((x, lo, hi, "low" if x <= lo else "high" if x > hi else "mid"))
    frame = pd.DataFrame(rows, index=index, columns=["x", "q_low", "q_high", "regime"])
    frame["regime"] = frame["regime"].astype(object)
    return frame


def _stats(part: np.ndarray, periods: int) -> dict:
    n = len(part)
    sd = float(part.std(ddof=1)) if n > 1 else math.nan
    nonzero = int((part != 0).sum())
    return {"n": n, "mean": float(part.mean()) if n else math.nan,
            "sharpe": float(part.mean() / sd * math.sqrt(periods)) if sd > 0 else math.nan,
            "hit_rate": float((part > 0).sum() / nonzero) if nonzero else math.nan}


def regime_stats(r, rv: pd.Series, periods: int = PERIODS_DAILY) -> dict:
    """RG1 for a daily series: per-regime statistics, Welch's t (high against low) and the regime of every session."""
    if check_periods(periods) != PERIODS_DAILY:
        raise ValueError("volatility regimes are defined on daily sessions only")
    series = returns_series(r)
    frame = regime_frame(rv, series.index)
    labels = frame["regime"].to_numpy()
    values = series.to_numpy()
    rows = [{"regime": name, **_stats(values[labels == name], periods)} for name in REGIMES]
    high, low = values[labels == "high"], values[labels == "low"]
    welch = sps.ttest_ind(high, low, equal_var=False) if len(high) > 1 and len(low) > 1 else None
    return {"rows": rows, "welch_t": float(welch.statistic) if welch is not None else math.nan,
            "welch_df": float(welch.df) if welch is not None else math.nan,
            "unlabelled": int(pd.isna(frame["regime"]).sum()), "min_history": MIN_HISTORY, "frame": frame,
            "tag": TAG, "label": LABEL}
