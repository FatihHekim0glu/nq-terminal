"""The futures universe view (ANALYTICS MV4 and MV5): horizon returns, realised volatility, correlation and
cluster order for the frozen dtsmom universe, all to 2021-12-31.

Returns follow the project's convention through nq-lab's own builder (`dtsmom_panel.build_panel` on the NYSE
master calendar): `r_t = dB_t / (N_t - dB_t)` with B = `c_back` and N = `c_none`, never the percent change of the
back-adjusted series. A horizon return compounds the last n daily returns, `prod(1 + r) - 1`, and is None when any
of them is missing. Horizons: 1D, 1W (5 sessions), 1M (21), 3M (63), YTD (sessions in the last year) and 12M (252).

- Realised volatility: `sd(r over the last window sessions, ddof=1) * sqrt(252)`.
- Vol-normalised return: `R_h / (sd_daily * sqrt(n_h))`, the horizon return in units of its own expected spread.
- Correlation: Pearson on the daily returns, pairwise complete with at least `MIN_CORR_OBS` shared sessions, over
  the last `window` sessions and over the full sample. Cluster order: average linkage on `1 - rho` (an undefined
  rho counts as 0), leaves in dendrogram order.

- Pair correlation (CORR click-through): the rolling Pearson correlation of two symbols' daily returns over
  `window` sessions, on the same panel; a value needs a full window of shared returns, else None.

The service takes frames that were already served through the gate (`BarService.frame`); it reads nothing
itself. Everything here is descriptive: `LABEL` marks it as post hoc, in-sample, not a registered test.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import Panel, build_panel, master_days
from nq_lab.dtsmom_universe import Contract

HORIZONS: tuple[tuple[str, int | None], ...] = (("1D", 1), ("1W", 5), ("1M", 21), ("3M", 63), ("YTD", None),
                                               ("12M", 252))
SESSIONS_PER_YEAR = 252
MIN_CORR_OBS = 20
NQ_SYMBOL = "NQ.V.0"
LABEL = "[POST HOC] descriptive, in-sample, not a registered test"
BASIS = ("daily r = dB / (N - dB) with B = c_back and N = c_none (the dtsmom_panel convention), "
         "compounded over each horizon; NYSE sessions to 2021-12-31")
RETURNS_UNIT = "fraction of the implied previous price, compounded over the horizon (0.01 is 1%)"


@dataclass(frozen=True)
class UniverseRow:
    symbol: str
    root: str
    sector: str
    units: str
    tick: float
    tick_usd: float
    last_date: str
    last_close: float | None
    last_close_back: float | None
    stale_last: bool
    returns: dict[str, float | None]
    vol_normalised: dict[str, float | None]
    realised_vol: float | None
    corr_to_nq: float | None
    returns_unit: str = RETURNS_UNIT


@dataclass(frozen=True)
class CorrelationBlock:
    sessions: int | None  # None: the full sample
    symbols: tuple[str, ...]
    order: tuple[int, ...]
    matrix: tuple[tuple[float | None, ...], ...]


@dataclass(frozen=True)
class UniverseResult:
    as_of: str
    window: int
    horizon_sessions: dict[str, int]
    rows: tuple[UniverseRow, ...]
    corr_window: CorrelationBlock
    corr_full: CorrelationBlock
    missing: tuple[str, ...]


def last_in_sample_day() -> dt.date:
    return (IS_END - pd.Timedelta(days=1)).date()


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(x) else None


def compound(r: np.ndarray, n: int) -> float | None:
    seg = r[-n:]
    if len(seg) < n or not np.all(np.isfinite(seg)):
        return None
    return _finite(float(np.prod(1.0 + seg) - 1.0))


def daily_sd(r: np.ndarray, window: int) -> float | None:
    seg = r[-window:]
    seg = seg[np.isfinite(seg)]
    if len(seg) < 2:
        return None
    sd = float(np.std(seg, ddof=1))
    return sd if math.isfinite(sd) and sd > 0 else None


def horizon_sessions(days: Sequence[dt.date]) -> dict[str, int]:
    ytd = sum(1 for d in days if d.year == days[-1].year)
    return {label: (ytd if n is None else n) for label, n in HORIZONS}


def cluster_order(rho: np.ndarray) -> tuple[int, ...]:
    if len(rho) < 2:
        return tuple(range(len(rho)))
    dist = 1.0 - np.nan_to_num(rho, nan=0.0)
    np.fill_diagonal(dist, 0.0)
    return tuple(leaves_list(linkage(squareform(dist, checks=False), method="average")).tolist())


def correlation_block(r: np.ndarray, symbols: Sequence[str], sessions: int | None) -> CorrelationBlock:
    seg = r if sessions is None else r[-sessions:]
    rho = pd.DataFrame(seg, columns=list(symbols)).corr(min_periods=MIN_CORR_OBS).to_numpy()
    matrix = tuple(tuple(_finite(x) for x in row) for row in rho.tolist())
    return CorrelationBlock(sessions=sessions, symbols=tuple(symbols), order=cluster_order(rho), matrix=matrix)


def _row(panel: Panel, a: int, contract: Contract, sessions: dict[str, int], window: int,
         nq_corr: float | None) -> UniverseRow:
    r = panel.r[:, a]
    sd = daily_sd(r, window)
    returns = {label: compound(r, n) for label, n in sessions.items()}
    normalised = {label: (None if value is None or sd is None else _finite(value / (sd * math.sqrt(sessions[label]))))
                  for label, value in returns.items()}
    return UniverseRow(symbol=panel.symbols[a], root=contract.root, sector=contract.sector, units=contract.units,
                       tick=float(contract.tick), tick_usd=float(contract.tick_usd),
                       last_date=str(panel.days[-1]), last_close=_finite(panel.N[-1, a]),
                       last_close_back=_finite(panel.B[-1, a]), stale_last=bool(panel.stale[-1, a]), returns=returns,
                       vol_normalised=normalised,
                       realised_vol=None if sd is None else sd * math.sqrt(SESSIONS_PER_YEAR), corr_to_nq=nq_corr)


@dataclass(frozen=True)
class UniversePanel:
    """The part of the universe that does not depend on the window: the aligned panel, and which contracts it has."""

    panel: Panel
    present: tuple[Contract, ...]
    missing: tuple[str, ...]


def universe_panel(frames: dict[str, pd.DataFrame], contracts: Sequence[Contract]) -> UniversePanel:
    """The NYSE-aligned panel of the served 1d frames (keyed `<ROOT>.V.0`) that the universe table reads."""
    present = tuple(c for c in contracts if not _empty(frames.get(f"{c.root}.V.0")))
    missing = tuple(f"{c.root}.V.0" for c in contracts if c not in present)
    ordered = {f"{c.root}.V.0": frames[f"{c.root}.V.0"] for c in present}
    days = master_days(IS_START.date(), last_in_sample_day())
    return UniversePanel(panel=build_panel(ordered, days), present=present, missing=missing)


def universe(frames: dict[str, pd.DataFrame], *, window: int, contracts: Sequence[Contract],
             prepared: UniversePanel | None = None) -> UniverseResult:
    """The universe table and correlations from served 1d frames keyed by symbol (`<ROOT>.V.0`); `prepared` is
    `universe_panel(frames, contracts)` when the caller already has it (it does not depend on the window)."""
    if window < MIN_CORR_OBS:
        raise ValueError(f"window must be at least {MIN_CORR_OBS} sessions, got {window}")
    built = prepared if prepared is not None else universe_panel(frames, contracts)
    panel, present, missing = built.panel, built.present, built.missing
    sessions = horizon_sessions(panel.days)
    corr_window = correlation_block(panel.r, panel.symbols, window)
    corr_full = correlation_block(panel.r, panel.symbols, None)
    nq = panel.symbols.index(NQ_SYMBOL) if NQ_SYMBOL in panel.symbols else None
    rows = tuple(_row(panel, a, c, sessions, window, None if nq is None else corr_window.matrix[a][nq])
                 for a, c in enumerate(present))
    return UniverseResult(as_of=str(panel.days[-1]), window=window, horizon_sessions=sessions, rows=rows,
                          corr_window=corr_window, corr_full=corr_full, missing=missing)


def _empty(frame: pd.DataFrame | None) -> bool:
    return frame is None or frame.empty


@dataclass(frozen=True)
class PairCorrelation:
    days: tuple[str, ...]
    t: tuple[int, ...]
    corr: tuple[float | None, ...]


def pair_correlation(frames: dict[str, pd.DataFrame], a: str, b: str, *, window: int) -> PairCorrelation:
    """Rolling correlation of two served 1d frames (keyed `<ROOT>.V.0`) on the NYSE master calendar."""
    if window < MIN_CORR_OBS:
        raise ValueError(f"window must be at least {MIN_CORR_OBS} sessions, got {window}")
    panel = build_panel({a: frames[a], b: frames[b]}, master_days(IS_START.date(), last_in_sample_day()))
    r = pd.DataFrame(panel.r, columns=list(panel.symbols))
    rolling = r[a].rolling(window, min_periods=window).corr(r[b]).to_numpy()
    days = tuple(str(d) for d in panel.days)
    epochs = tuple(int(pd.Timestamp(d, tz="UTC").timestamp()) for d in days)
    return PairCorrelation(days=days, t=epochs, corr=tuple(_finite(x) for x in rolling.tolist()))


RV_WINDOW = 22
RV_UNIT = "fraction per year, annualised (0.18 is 18%)"
RV_BASIS = ("sd of the daily r over the last `window` sessions (ddof 1, at least 2 values) x sqrt(252), with "
            "r = dB / (N - dB) as in the universe table, so the last value is the universe's realised volatility at "
            "the same window; NYSE sessions to 2021-12-31")


@dataclass(frozen=True)
class RealisedVolLine:
    days: tuple[str, ...]
    t: tuple[int, ...]
    rv: tuple[float | None, ...]


def realised_vol_series(frame: pd.DataFrame, symbol: str, *, window: int) -> RealisedVolLine:
    """MV3 for GP's indicator pane: the rolling realised volatility of one served 1d frame, on the universe's own
    returns and rule (`daily_sd`: finite values in the last `window` sessions, at least two)."""
    if window < 2:
        raise ValueError(f"window must be at least 2 sessions, got {window}")
    panel = build_panel({symbol: frame}, master_days(IS_START.date(), last_in_sample_day()))
    r = pd.Series(panel.r[:, 0], dtype=float)
    r = r.where(np.isfinite(r.to_numpy()))
    line = r.rolling(window, min_periods=2).std(ddof=1) * math.sqrt(SESSIONS_PER_YEAR)
    days = tuple(str(d) for d in panel.days)
    epochs = tuple(int(pd.Timestamp(d, tz="UTC").timestamp()) for d in days)
    return RealisedVolLine(days=days, t=epochs, rv=tuple(_finite(x) for x in line.tolist()))
