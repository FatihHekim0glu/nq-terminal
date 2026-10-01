"""RG2 trend regime (ANALYTICS_CATALOG section 10). Descriptive, [POST HOC], a fixed split (not user picked).

The variable is NQ's back-adjusted close (the 1d vendor `c_back`, served through the gate and taken as of every NYSE
session by the `dtsmom_panel` rule; the caller builds it) against its own simple mean over `WINDOW` sessions. For a
session t of a daily return series:
- s is the last NYSE session strictly before t, so the close and the mean were known at t-1 (never t's own close).
  The vendor 1d bar is a UTC day, so the close of s is the last trade before 00:00 UTC, 19:00 or 20:00 ET. That is
  after the 16:00 ET close, so it is known before t's return only when the return opens after it (a session that opens
  at 09:30 on t). A series labelled by exit date whose return opens at the 16:00 ET close of the entry session needs
  `lag` = 1: s is then the session before the entry date, whose close precedes the entry;
- `x_t = close_s` and `m_t = mean(close over the WINDOW sessions ending at s)`, defined only when every one of those
  closes exists (a missing close leaves the sessions whose window holds it without a regime);
- the regime is "above" when `x_t > m_t`, else "below" (a tie counts as below); sessions without a full window have
  none. A back-adjusted level keeps price differences across rolls, so a roll gap never moves the close across its
  mean; its level is never divided by.
Per regime: n, mean, annualised Sharpe (sd ddof 1) and hit rate over the non-zero sessions, computed exactly as RG1
computes them; Welch's t (scipy `ttest_ind(equal_var=False)`) of above against below, with its degrees of freedom.
No p-value is shown: the split is fixed, but the view is still [POST HOC] (C7).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_terminal.analytics._inputs import PERIODS_DAILY, check_periods, returns_series
from nq_terminal.analytics.regimes import _stats as regime_row  # one per-regime statistic for RG1 and RG2

WINDOW = 200
ABOVE, BELOW = "above", "below"
REGIMES = (ABOVE, BELOW)
TAG = "[POST HOC]"
LABEL = ("trend regime: NQ's back-adjusted close at the session before, above or below the mean of its last 200 "
         "session closes; descriptive, in-sample, not a registered test")


def _clean_close(close: pd.Series) -> pd.Series:
    series = pd.Series(close, dtype=float)
    if not isinstance(series.index, pd.DatetimeIndex):
        raise ValueError("the NQ close needs a DatetimeIndex of session dates")
    return series.sort_index()


def trend_frame(close: pd.Series, index: pd.DatetimeIndex, window: int = WINDOW, lag: int = 0) -> pd.DataFrame:
    """Per session of `index`: the close and its `window`-session mean at the session before, and the regime.

    `lag` counts further closes back: 1 takes the session before that one (see the module docstring).
    """
    if lag < 0:
        raise ValueError("lag cannot be negative: the regime would use a later close")
    series = _clean_close(close)
    mean = series.rolling(window, min_periods=window).mean().to_numpy()
    values = series.to_numpy()
    known = np.searchsorted(series.index.to_numpy(), pd.DatetimeIndex(index).to_numpy(), side="left") - 1 - lag
    rows = []
    for at in known:
        if at < 0:
            rows.append((math.nan, math.nan, None))
            continue
        x, m = float(values[at]), float(mean[at])
        regime = None if not (math.isfinite(x) and math.isfinite(m)) else ABOVE if x > m else BELOW
        rows.append((x, m, regime))
    frame = pd.DataFrame(rows, index=index, columns=["x", "mean", "regime"])
    frame["regime"] = frame["regime"].astype(object)
    return frame


def trend_stats(r, close: pd.Series, periods: int = PERIODS_DAILY, window: int = WINDOW, lag: int = 0) -> dict:
    """RG2 for a daily series: per-regime statistics, Welch's t (above against below) and every session's regime."""
    if check_periods(periods) != PERIODS_DAILY:
        raise ValueError("trend regimes are defined on daily sessions only")
    series = returns_series(r)
    frame = trend_frame(close, series.index, window, lag)
    labels = frame["regime"].to_numpy()
    values = series.to_numpy()
    rows = [{"regime": name, **regime_row(values[labels == name], periods)} for name in REGIMES]
    above, below = values[labels == ABOVE], values[labels == BELOW]
    welch = sps.ttest_ind(above, below, equal_var=False) if len(above) > 1 and len(below) > 1 else None
    return {"rows": rows, "welch_t": float(welch.statistic) if welch is not None else math.nan,
            "welch_df": float(welch.df) if welch is not None else math.nan,
            "unlabelled": int(pd.isna(frame["regime"]).sum()), "window": window, "frame": frame, "tag": TAG,
            "label": LABEL}
