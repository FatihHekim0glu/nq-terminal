"""Drawdowns (ANALYTICS_CATALOG.md section 2: DD1 underwater series and max drawdown, DD2 episode table).

DD1, per basis (C1):
- A (screen): `cumsum r - max(0, cummax(cumsum r))`, in units of K. The running peak is floored at 0, so a loss
  on the first session is already a drawdown from K. `-max_drawdown(r, "A")` equals
  `nq_lab.sizing_stats.max_drawdown(r)` (tested).
- B (account): `E_t / max_{s<=t} E_s - 1` with `E_t = prod(1 + r)` from the baseline `E_0 = 1` (Nautilus
  `MaxDrawdown` convention: compounded, baseline 1.0).
`max_drawdown` is the minimum of the underwater series: 0 or negative (e.g. -0.226 for a 22.6% drawdown).

DD2: an episode is a maximal run of sessions under water. Its peak is the last session at a high before the run
(None when the peak is the baseline E_0, before the first session), its trough the deepest session (first one
on ties), its recovery the first session back at the peak (`E_t >= E_peak`), else None and `open` is True.
Lengths are in sessions: peak to trough, trough to recovery (None when open), and peak to recovery, or peak to
the last session for an open episode. Rows are sorted deepest first.

DD3 (from DD2, no cap): every episode in time order, the time to recovery of each recovered one (sessions from its
trough to its recovery), a histogram of those times in fixed bins and the longest time under water (the longest
`length`, peak to recovery, an open episode measured to the last session). An open episode is never a recovery.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from nq_terminal.analytics._inputs import PERIODS_DAILY, PERIODS_MONTHLY, check_basis, check_periods, returns_series

TOP_EPISODES = 10


def underwater(r, basis: str) -> pd.Series:
    """DD1 underwater series (0 at a high, negative below it), on the caller's index."""
    check_basis(basis)
    series = returns_series(r)
    values = series.to_numpy()
    if basis == "A":
        level = np.cumsum(values)
        peak = np.maximum(0.0, np.maximum.accumulate(level)) if len(values) else level
        uw = level - peak
    else:
        level = np.cumprod(1.0 + values)
        peak = np.maximum(1.0, np.maximum.accumulate(level)) if len(values) else level
        uw = level / peak - 1.0
    return pd.Series(uw, index=series.index, dtype=float)


def max_drawdown(r, basis: str) -> float:
    """Deepest point of the underwater series: 0.0 when there is no drawdown, else negative."""
    uw = underwater(r, basis)
    return float(min(0.0, uw.min())) if len(uw) else 0.0


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) positions of each run of True, end exclusive."""
    edges = np.flatnonzero(np.diff(np.r_[0, mask.astype(np.int8), 0]))
    return [(int(s), int(e)) for s, e in zip(edges[::2], edges[1::2])]


def _episode(values: np.ndarray, start: int, end: int) -> dict:
    trough = start + int(np.argmin(values[start:end]))
    recovery = end if end < len(values) else None
    return {"peak": start - 1, "trough": trough, "recovery": recovery, "depth": float(values[trough])}


def _row(ep: dict, index: pd.Index, n: int) -> dict:
    peak, trough, recovery = ep["peak"], ep["trough"], ep["recovery"]
    last = recovery if recovery is not None else n - 1
    return {"peak": index[peak] if peak >= 0 else None, "trough": index[trough],
            "recovery": index[recovery] if recovery is not None else None, "depth": ep["depth"],
            "peak_to_trough": trough - peak,
            "trough_to_recovery": recovery - trough if recovery is not None else None,
            "length": last - peak, "open": recovery is None}


def drawdown_table(r, basis: str, top: int = TOP_EPISODES) -> list[dict]:
    """DD2: the `top` deepest drawdown episodes, deepest first (ties by earlier peak)."""
    if not isinstance(top, int) or top < 1:
        raise ValueError(f"top must be a positive integer, got {top!r}")
    uw = underwater(r, basis)
    values = uw.to_numpy()
    episodes = [_episode(values, s, e) for s, e in _runs(values < 0)]
    episodes.sort(key=lambda ep: (ep["depth"], ep["peak"]))
    return [_row(ep, uw.index, len(values)) for ep in episodes[:top]]


# ---------------------------------------------------------------- DD3

# Time-to-recovery bins, in sessions (daily) or months (monthly), as inclusive (lo, hi) with hi None for the last
# open-ended bin: 1, 2-5, 6-10, 11-21 (about a month), 22-63 (a quarter), 64-126, 127-252 (a year), 253 and over;
# monthly: 1, 2-3, 4-6, 7-12, 13-24, 25-60, 61-120, 121 and over. Recovery times are heavy tailed, so the bins widen.
BINS = {
    PERIODS_DAILY: ((1, 1), (2, 5), (6, 10), (11, 21), (22, 63), (64, 126), (127, 252), (253, None)),
    PERIODS_MONTHLY: ((1, 1), (2, 3), (4, 6), (7, 12), (13, 24), (25, 60), (61, 120), (121, None)),
}
LENGTH_UNIT = {PERIODS_DAILY: "sessions", PERIODS_MONTHLY: "months"}


def all_episodes(r, basis: str) -> list[dict]:
    """DD3: every drawdown episode in time order (DD2's rows without the top-10 cut), same fields as `drawdown_table`."""
    uw = underwater(r, basis)
    values = uw.to_numpy()
    return [_row(_episode(values, s, e), uw.index, len(values)) for s, e in _runs(values < 0)]


def recovery_histogram(times, periods: int) -> list[dict]:
    """Counts of recovery times (sessions or months from trough to recovery) in the fixed bins of `periods`."""
    check_periods(periods)
    values = list(times)
    return [{"lo": lo, "hi": hi, "count": sum(1 for t in values if t >= lo and (hi is None or t <= hi))}
            for lo, hi in BINS[periods]]


def _longest(rows: list[dict]) -> dict | None:
    """The episode with the most sessions under water (the earliest on a tie); an open one runs to the last session."""
    if not rows:
        return None
    best = max(rows, key=lambda row: row["length"])
    return {"peak": best["peak"], "trough": best["trough"], "recovery": best["recovery"], "depth": best["depth"],
            "length": best["length"], "open": best["open"]}


def episode_summary(r, basis: str, periods: int) -> dict:
    """DD3: all episodes, the recovery times of the recovered ones, their histogram and the longest time under water.

    An open episode (still under water at the last session) is never a recovery: it is left out of the recovery times,
    their median and maximum and the histogram, and counted in `n_open`. It still counts for the longest time under
    water, measured to the last session. Times are in sessions (months for a monthly series), by position, not days.
    """
    check_periods(periods)
    rows = all_episodes(r, basis)
    times = [row["trough_to_recovery"] for row in rows if not row["open"]]
    return {"unit": LENGTH_UNIT[periods], "episodes": rows, "n_episodes": len(rows), "n_recovered": len(times),
            "n_open": len(rows) - len(times), "recovery_times": times,
            "recovery_median": float(np.median(times)) if times else None,
            "recovery_max": max(times) if times else None,
            "histogram": recovery_histogram(times, periods), "longest": _longest(rows)}
