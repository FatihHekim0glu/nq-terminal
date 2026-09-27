"""Rolling statistics (ANALYTICS_CATALOG.md section 3: RL1 rolling Sharpe, RL2 rolling volatility, RL5 blocks).

RL1: rolling mean / rolling sd(ddof=1) * sqrt(P) over 63 and 252 sessions; RL2: rolling sd(ddof=1) * sqrt(P).
NaN until the window fills and wherever the window has no spread, so a chart draws no line across it.
A monthly series (P = 12) uses 12 and 36 months instead (item (e)): 12 months spans the time of the 252-session
line, and a 3-month window (the literal counterpart of 63 sessions) has too few points for a standard deviation;
252 months would exceed every monthly sample (about 120).

RL5: the 2010-13, 2014-17 and 2018-21 block bars are read from the result files (`summary.blocks`, a screen's
`blocks` or `blocks_1tick`) and never recomputed: `block_bars` only picks the values out, in block order.
"""
from __future__ import annotations

import math
import re
from collections.abc import Mapping

import pandas as pd

from nq_terminal.analytics._inputs import PERIODS_DAILY, PERIODS_MONTHLY, check_periods, returns_series

WINDOWS = (63, 252)  # sessions, daily series
MONTH_WINDOWS = (12, 36)  # months, monthly series
WINDOWS_BY_PERIODS = {PERIODS_DAILY: WINDOWS, PERIODS_MONTHLY: MONTH_WINDOWS}
WINDOW_UNIT = {PERIODS_DAILY: "sessions", PERIODS_MONTHLY: "months"}
BLOCK_NAME = re.compile(r"^(\d{4})-(\d{2}|\d{4})$")  # "2010-13" and "2010-2013"


def _check_window(window: int) -> int:
    if not isinstance(window, int) or window < 2:
        raise ValueError(f"window must be an integer of at least 2 sessions, got {window!r}")
    return window


def rolling_sharpe(r, window: int, periods: int = PERIODS_DAILY) -> pd.Series:
    """RL1 on the caller's index."""
    _check_window(window)
    check_periods(periods)
    series = returns_series(r)
    roll = series.rolling(window)
    sd = roll.std(ddof=1)
    out = roll.mean() / sd * math.sqrt(periods)
    return out.where(sd > 0)


def rolling_volatility(r, window: int, periods: int = PERIODS_DAILY) -> pd.Series:
    """RL2 on the caller's index."""
    _check_window(window)
    check_periods(periods)
    return returns_series(r).rolling(window).std(ddof=1) * math.sqrt(periods)


def windows_for(periods: int) -> tuple[int, int]:
    """(short, long) window for P: 63 and 252 sessions, or 12 and 36 months."""
    return WINDOWS_BY_PERIODS[check_periods(periods)]


def rolling_panel(r, periods: int = PERIODS_DAILY) -> dict[str, pd.Series]:
    """The four catalogue lines, keyed by window: sharpe_63, sharpe_252, vol_63, vol_252 for a daily series
    (sharpe_12, sharpe_36, vol_12, vol_36 for a monthly one)."""
    out: dict[str, pd.Series] = {}
    for window in windows_for(periods):
        out[f"sharpe_{window}"] = rolling_sharpe(r, window, periods)
        out[f"vol_{window}"] = rolling_volatility(r, window, periods)
    return out


def block_bars(blocks: Mapping, value_key: str, t_key: str | None = None) -> list[dict]:
    """RL5: one bar per year block (keys like "2010-13" or "2010-2013"), ordered by start year.

    Values are copied as stored (None stays None). Entries that are not year blocks ("all", flags) are skipped.
    """
    rows = []
    for name, body in blocks.items():
        match = BLOCK_NAME.match(str(name))
        if match and isinstance(body, Mapping):
            rows.append((int(match.group(1)), name, body))
    rows.sort(key=lambda row: row[0])
    return [{"block": name, "n": body.get("n"), "value": body.get(value_key),
             "t": body.get(t_key) if t_key else None} for _, name, body in rows]



def extremes(values: pd.Series) -> dict:
    """The highest and lowest finite value of a rolling line and the first session each falls on (RR's Hi and Low
    callouts); all None when the line has no finite value."""
    finite = pd.Series(values, dtype=float)
    finite = finite[finite.map(math.isfinite)]
    if finite.empty:
        return {"hi": None, "hi_at": None, "lo": None, "lo_at": None}
    return {"hi": float(finite.max()), "hi_at": finite.idxmax(), "lo": float(finite.min()), "lo_at": finite.idxmin()}
