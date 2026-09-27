"""VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised).

For one universe symbol, on the universe's own daily returns (`r = dB / (N - dB)` with B = `c_back` and N =
`c_none`, nq-lab's `dtsmom_panel` builder on the NYSE master calendar to 2021-12-31), the log return is
`log(1 + r)`, the log of the close over the implied previous close; `1 + r <= 0` (a non-positive price) leaves
that return undefined and is counted. Realised volatility over h sessions is `sd(log returns, ddof 1) * sqrt(252)`
on every window of h consecutive sessions whose h returns are all defined (overlapping windows). For each h in
`HORIZONS` the cone gives the min, the `PERCENTILES` (numpy linear interpolation) and the max of those values over
the in-sample history, the latest value (the window that ends on the last in-sample session) and its rank: the
share of the history at or below it, in percent. The rank is descriptive, not a p-value.

The small multiples view (`universe_cone`) gives the same statistics for every contract of the frozen universe at
one horizon. The service takes frames already served through the gate (`BarService.frame`); it reads nothing
itself, and rows after 2021-12-31 in a frame are ignored by the master calendar. `LABEL` marks it post hoc.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd

from nq_lab.config import IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.dtsmom_universe import Contract
from nq_terminal.services.market import LABEL, SESSIONS_PER_YEAR, last_in_sample_day

HORIZONS: tuple[int, ...] = (5, 10, 21, 63, 126, 252)
PERCENTILES: tuple[int, ...] = (10, 25, 50, 75, 90)
DEFAULT_HORIZON = 21
MIN_WINDOWS = 20  # fewer full windows than this: no cone for that horizon
UNIT = "fraction per year, annualised (0.18 is 18%)"
BASIS = ("sd of log(1 + r) over each window of h sessions (ddof 1, every return defined) x sqrt(252), with "
         "r = dB / (N - dB) as in the universe table (the dtsmom_panel convention), overlapping windows; "
         "percentiles by linear interpolation over every full window from 2010 to 2021-12-31; rank = share of "
         "windows at or below the latest, in percent (descriptive, not a p-value)")
STAT_KEYS = ("min", *(f"p{p}" for p in PERCENTILES), "max", "latest", "latest_rank")

__all__ = ["BASIS", "DEFAULT_HORIZON", "HORIZONS", "LABEL", "MIN_WINDOWS", "PERCENTILES", "UNIT", "ConeRow",
           "UniverseCone", "UniverseConeRow", "VolCone", "rolling_vol", "summarise", "to_log", "universe_cone",
           "volatility_cone"]


@dataclass(frozen=True)
class ConeRow:
    sessions: int
    n: int
    first_date: str | None
    last_date: str | None
    min: float | None
    p10: float | None
    p25: float | None
    p50: float | None
    p75: float | None
    p90: float | None
    max: float | None
    latest: float | None
    latest_rank: float | None


@dataclass(frozen=True)
class VolCone:
    symbol: str
    as_of: str
    undefined_returns: int
    horizons: tuple[ConeRow, ...]


@dataclass(frozen=True)
class UniverseConeRow:
    symbol: str
    root: str
    sector: str
    stats: ConeRow


@dataclass(frozen=True)
class UniverseCone:
    sessions: int
    as_of: str
    rows: tuple[UniverseConeRow, ...]
    missing: tuple[str, ...]


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(x) else None


def _check_horizons(horizons: Sequence[int]) -> None:
    bad = [h for h in horizons if h not in HORIZONS]
    if bad:
        raise ValueError(f"horizon must be one of {HORIZONS} sessions, got {bad}")


def to_log(r: np.ndarray) -> tuple[np.ndarray, int]:
    """`log(1 + r)`, NaN where r is missing or `1 + r <= 0`; the count of the latter (undefined returns)."""
    r = np.asarray(r, dtype=float)
    finite = np.isfinite(r)
    ok = finite & (r > -1.0)
    logs = np.full(r.shape, np.nan)
    logs[ok] = np.log1p(r[ok])
    return logs, int(np.sum(finite & ~ok))


def rolling_vol(logs: np.ndarray, sessions: int) -> np.ndarray:
    """Annualised sd (ddof 1) of each window of `sessions` log returns; NaN unless all of them are defined."""
    if sessions < 2:
        raise ValueError(f"horizon must be at least 2 sessions, got {sessions}")
    line = pd.Series(logs, dtype=float).rolling(sessions, min_periods=sessions).std(ddof=1)
    return line.to_numpy() * math.sqrt(SESSIONS_PER_YEAR)


def summarise(values: np.ndarray, latest: float | None, min_windows: int = MIN_WINDOWS) -> dict[str, float | None]:
    """Min, percentiles, max and the latest value's rank over `values` (finite only); empty below `min_windows`."""
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < min_windows:
        return {k: None for k in STAT_KEYS} | {"latest": latest}
    cuts = np.percentile(values, PERCENTILES)
    stats: dict[str, float | None] = {"min": float(values.min()), "max": float(values.max()), "latest": latest}
    stats |= {f"p{p}": float(c) for p, c in zip(PERCENTILES, cuts)}
    stats["latest_rank"] = None if latest is None else 100.0 * float(np.sum(values <= latest)) / len(values)
    return stats


def _cone_row(days: Sequence, logs: np.ndarray, sessions: int) -> ConeRow:
    line = rolling_vol(logs, sessions)
    full = np.flatnonzero(np.isfinite(line))
    latest = _finite(line[-1]) if len(line) else None
    stats = summarise(line[full], latest)
    first = str(days[full[0]]) if len(full) else None
    last = str(days[full[-1]]) if len(full) else None
    return ConeRow(sessions=sessions, n=int(len(full)), first_date=first, last_date=last, **stats)


def _logs_for(frame: pd.DataFrame, symbol: str) -> tuple[list, np.ndarray, int]:
    panel = build_panel({symbol: frame}, master_days(IS_START.date(), last_in_sample_day()))
    logs, undefined = to_log(panel.r[:, 0])
    return list(panel.days), logs, undefined


def volatility_cone(frame: pd.DataFrame, symbol: str, horizons: Sequence[int] = HORIZONS) -> VolCone:
    """The cone of one served 1d frame (keyed `<ROOT>.V.0`) over `horizons`, to 2021-12-31."""
    _check_horizons(horizons)
    days, logs, undefined = _logs_for(frame, symbol)
    rows = tuple(_cone_row(days, logs, h) for h in horizons)
    return VolCone(symbol=symbol, as_of=str(days[-1]), undefined_returns=undefined, horizons=rows)


def universe_cone(frames: dict[str, pd.DataFrame], *, contracts: Sequence[Contract], sessions: int) -> UniverseCone:
    """Each contract's cone statistics at one horizon (the small multiples), in the frozen table's order."""
    _check_horizons((sessions,))
    rows, missing, as_of = [], [], str(last_in_sample_day())
    for contract in contracts:
        symbol = f"{contract.root}.V.0"
        frame = frames.get(symbol)
        if frame is None or frame.empty:
            missing.append(symbol)
            continue
        days, logs, _ = _logs_for(frame, symbol)
        rows.append(UniverseConeRow(symbol=symbol, root=contract.root, sector=contract.sector,
                                    stats=_cone_row(days, logs, sessions)))
        as_of = str(days[-1])
    return UniverseCone(sessions=sessions, as_of=as_of, rows=tuple(rows), missing=tuple(missing))
