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
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from nq_terminal.analytics._inputs import check_basis, returns_series

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
