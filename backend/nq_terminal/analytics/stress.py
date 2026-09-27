"""RK5 stress windows table (ANALYTICS_CATALOG section 5). Descriptive, [POST HOC].

The windows are frozen in `constants.STRESS_WINDOWS` (the five deepest NQ buy-and-hold drawdowns, derived through the
gate before this code existed) and `constants.STRESS_WINDOW_SPENT` (2022, sealed files only); this module never names
a date. A daily series' window holds its sessions after the peak up to and including the trough. A monthly book
(P = 12) cannot isolate a window of a few weeks, so its window holds every month the window overlaps: from the month
of the first weekday after the peak through the month of the trough (the 2020 crash is February and March 2020, not
only the February row whose month-end falls between peak and trough). Each row names the first and last row it
covers. Per window: n, the strategy return (Basis A, or a one-contract series: the sum; Basis B: compounded), the
benchmark return over the rows where the benchmark has a value (same rule), and the strategy's maximum drawdown
inside the window, starting from zero at the window's start.
"""
from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd

from nq_terminal.analytics import drawdown
from nq_terminal.analytics._inputs import check_basis, returns_series
from nq_terminal.constants import StressWindow

TAG = "[POST HOC]"


PERIODS_MONTHLY = 12
MONTHLY_NOTE = ("monthly book: each window holds every month it overlaps (from the month after the peak's session "
                "through the trough's month), so the rows cover more than the window itself; monthly data cannot "
                "isolate it")


def _mask(index: pd.DatetimeIndex, window: StressWindow, periods: int) -> np.ndarray:
    peak, trough = pd.Timestamp(window.peak), pd.Timestamp(window.trough)
    if periods != PERIODS_MONTHLY:
        return np.asarray((index > peak) & (index <= trough))
    months = index.to_period("M")
    first = (peak + pd.offsets.BDay(1)).to_period("M")
    return np.asarray((months >= first) & (months <= trough.to_period("M")))


def _day(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%d")


def _total(values: np.ndarray, basis: str) -> float | None:
    if not len(values):
        return None
    return float(values.sum()) if basis == "A" else float(np.prod(1.0 + values) - 1.0)


def _row(series: pd.Series, bench: pd.Series | None, basis: str, window: StressWindow, periods: int) -> dict:
    inside = _mask(series.index, window, periods)
    covered = series.index[inside]
    mine = series.to_numpy()[inside]
    theirs = bench.to_numpy()[inside] if bench is not None else np.array([])
    theirs = theirs[~np.isnan(theirs)]
    return {"label": window.label, "peak": window.peak, "trough": window.trough, "recovery": window.recovery,
            "nq_depth": window.nq_depth, "source": window.source, "n": int(inside.sum()),
            "covered_from": _day(covered[0]) if len(covered) else None,
            "covered_to": _day(covered[-1]) if len(covered) else None,
            "strategy_return": _total(mine, basis), "bench_return": _total(theirs, basis),
            "bench_n": int(len(theirs)),
            "strategy_max_drawdown": drawdown.max_drawdown(mine, basis) if len(mine) else None}


def window_rows(r, bench, basis: str, windows: Sequence[StressWindow], periods: int = 252) -> list[dict]:
    """One row per window (see the module docstring); a window the series never reaches has n 0 and null values.

    `periods` 12 selects the monthly rule (every month the window overlaps); anything else the session rule."""
    check_basis(basis)
    series = returns_series(r)
    if not isinstance(series.index, pd.DatetimeIndex):
        raise ValueError("stress windows need a series on a DatetimeIndex")
    aligned = None if bench is None else pd.Series(bench, dtype=float).reindex(series.index)
    return [_row(series, aligned, basis, window, periods) for window in windows]
