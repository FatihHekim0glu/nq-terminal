"""The P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12; ANALYTICS_CATALOG
sections 9, 10 and 11): where their inputs are read through the injected services (C8). The functions in
`analytics/trend_regime.py`, `analytics/capacity.py` and `analytics/term_structure.py` stay pure.

- RG2: NQ's back-adjusted close as of every NYSE session (the 1d vendor `c_back` through the bar service, caller
  "terminal", the in-sample window; the `dtsmom_panel` as-of rule, so a session without a bar carries the last
  close), against the daily return series the tear sheet uses (`analytics.series`). A monthly book has no view. The 1d
  bar is a UTC day (19:00 or 20:00 ET close), so a trade book labelled by exit date whose return opens at the 16:00 ET
  close of the entry session takes the regime from the session before that entry (`ENTRY_LAG_BOOKS`), and a book that
  holds several sessions has none (`MULTI_SESSION_BOOKS`).
- EX5: a run's fills (or, for the intraday runs without fills, its trades) through the runs service, read only; the
  1d volume of each traded root's continuous series through the bar service. Only roots of the frozen futures
  universe are ever served, so a crafted result file cannot steer the gate's file path. An unbalanced run is
  refused (rule 4).
- MV6: the root's calendar chain `<ROOT>.C.k` (k = 0 to 5, the ranks the carry round built) through the bar
  service, one whole in-sample serve per rank; a rank the project does not hold is skipped, and a root without
  C.0 and C.1 has no view. The chain files are not in the catalogue (it lists the continuous series), so their
  cache key has no file version.

RG2 and EX5 return the response without `gate` and the years served; the router adds the gate's bookkeeping.
MV6 takes it, since the router serves the chain before the view is built.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel
from nq_lab.dtsmom_universe import TABLE, Contract
from nq_terminal.analytics import capacity, term_structure, trend_regime
from nq_terminal.analytics._inputs import PERIODS_DAILY
from nq_terminal.analytics.exposure import BookUnusable
from nq_terminal.analytics.series import SessionSeries, session_index
from nq_terminal.models.analytics import Context
from nq_terminal.models.data import GateInfo
from nq_terminal.models.regimes_capacity_term import (
    CapacityInstrument,
    CapacityRow,
    CapacitySession,
    RunCapacity,
    TermCurve,
    TermPoint,
    TermStructure,
    TermSummary,
    TermVoid,
    TrendRegimeRow,
    TrendRegimeView,
)
from nq_terminal.services.bars import UnknownSeries
from nq_terminal.services.run_books import UNUSABLE, _every_row
from nq_terminal.services.tearsheet import POST_HOC, axis, num, units

if TYPE_CHECKING:
    from nq_terminal.services.bars import BarService
    from nq_terminal.services.runs import RunService

NQ_SYMBOL = "NQ.V.0"
DAILY_TF, DAILY_VARIANT = "1d", "vendor"
CHAIN_RANKS = (0, 1, 2, 3, 4, 5)
UNIVERSE = {c.root: c for c in TABLE}
FULL_MULTIPLIERS = {c.root: float(c.mult) for c in TABLE}
ROOTS = frozenset(UNIVERSE)
Version = Callable[[str], "tuple[int, int] | None"]

TREND_BASIS = ("NQ 1d vendor c_back through the OOS gate, as of each NYSE session (dtsmom_panel rule); the close and "
               "its 200-session simple mean at the session before each return")
TREND_SOURCE = "NQ.V.0 1d vendor, back-adjusted close, through the gate (caller terminal)"
TREND_MONTHLY = "trend regimes are a daily view; a monthly book has none"
# Hypothesis books labelled by exit date whose return opens at or before the 16:00 ET close of the session before it
# (every trade of the first four is entered at that close, or at 12:59 ET on that session, and held for one session;
# checked against the trade files). Their regime comes from the session before the entry date, so no 1d close that
# holds the evening of the entry session labels the return it belongs to.
ENTRY_LAG_BOOKS = frozenset({"overnight_v0", "mac5rev_v0", "preholiday_v0", "prefomc_v0"})
ENTRY_LAG = 1
# Exit-labelled books that hold four to seven sessions: the session before the entry is not known from the daily
# series, and every close inside the hold holds part of the return, so they have no trend view.
MULTI_SESSION_BOOKS = frozenset({"tom_v0", "rebal_v0"})
TREND_MULTI = ("trend regimes need a return that opens after the regime is known; this book is labelled by exit date "
               "and holds several sessions, so its return opens before the closes the regime would use")
TREND_ENTRY_LABEL = ("trend regime: NQ's back-adjusted close at the session before the entry, above or below the mean "
                     "of its last 200 session closes; the book enters at the 16:00 ET close, which is before the 1d "
                     "bar closes, so the regime is taken one session earlier; descriptive, in-sample, not a "
                     "registered test")
CAPACITY_BASIS = ("contracts per session (every fill side; one contract at each trade's entry and exit when a run has "
                  "no fills) over the vendor 1d volume of the continuous series on that session, New York dates")
CAPACITY_UNIT = "fraction of the session's volume (0.01 is 1%)"
TERM_BASIS = ("C.0 and C.1 closes on the same session (unadjusted, 1d, through the OOS gate); carry = (F1 - F2) / "
              "(F2 x tau), tau = days between the pinned CME expiries / 365.25 (nq_lab.carry_signal.carry_value)")
TERM_UNIT = "carry: fraction per year (0.01 is 1% a year), positive in backwardation; spread in the root's units"
EXPIRY_SOURCE = "nq_lab.carry_expiry.last_trading_day (the pinned CME last trading day table)"


class ChainMissing(LookupError):
    """The project holds no C.0 and C.1 calendar chain for a root."""


@dataclass(frozen=True)
class Served:
    years: tuple[int, ...]
    cached: bool


# ---------------------------------------------------------------- RG2


def nq_trend_close(bars: BarService, version: tuple[int, int] | None) -> tuple[pd.Series, Served]:
    """NQ's back-adjusted close on every NYSE session of the in-sample window (NaN before the first bar)."""
    served = bars.frame(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT, IS_START, IS_END, version=version)
    days = session_index(IS_START, IS_END)
    panel = build_panel({NQ_SYMBOL: served.frame}, [d.date() for d in days])
    return pd.Series(panel.B[:, 0], index=days, dtype=float), Served(served.years, served.cached)


def _nums(values: Any) -> list[float | None]:
    return [num(v) for v in np.asarray(values, dtype=float)]


def trend_unavailable(s: SessionSeries, context: Context, note: str = TREND_MONTHLY) -> TrendRegimeView:
    return TrendRegimeView(context=context, tag=POST_HOC, label=trend_regime.LABEL, basis=TREND_BASIS,
                           source=TREND_SOURCE, unit=units(s).level, window=trend_regime.WINDOW, available=False,
                           note=note, rows=[], welch_t=None, welch_df=None, unlabelled=0, t=[], date=[],
                           regime=[], close=[], mean_close=[], gate=None)


def entry_lag(s: SessionSeries) -> int:
    """How many closes further back the regime must be taken (see `ENTRY_LAG_BOOKS`); runs are never lagged."""
    return ENTRY_LAG if s.basis == "A" and s.name in ENTRY_LAG_BOOKS else 0


def trend_view(s: SessionSeries, context: Context, close: pd.Series) -> TrendRegimeView:
    """RG2 over a daily series (the caller checks `s.periods`)."""
    lag = entry_lag(s)
    found = trend_regime.trend_stats(s.r, close, s.periods, lag=lag)
    frame = found["frame"]
    t, dates = axis(s.r.index)
    rows = [TrendRegimeRow(regime=row["regime"], n=row["n"], mean=num(row["mean"]), sharpe=num(row["sharpe"]),
                           hit_rate=num(row["hit_rate"])) for row in found["rows"]]
    labels = [None if pd.isna(v) else str(v) for v in frame["regime"].to_numpy()]
    label = TREND_ENTRY_LABEL if lag else found["label"]
    return TrendRegimeView(context=context, tag=POST_HOC, label=label, basis=TREND_BASIS, source=TREND_SOURCE,
                           unit=units(s).level, window=found["window"], available=True, note=None, rows=rows,
                           welch_t=num(found["welch_t"]), welch_df=num(found["welch_df"]),
                           unlabelled=found["unlabelled"], t=t, date=dates, regime=labels,
                           close=_nums(frame["x"]), mean_close=_nums(frame["mean"]), gate=None)


def trend_for(s: SessionSeries, context: Context, bars: BarService | None,
              version: tuple[int, int] | None) -> tuple[TrendRegimeView, Served | None]:
    """The view, or the explained absence for a monthly book (no serve then); `bars` is required otherwise."""
    if s.periods != PERIODS_DAILY:
        return trend_unavailable(s, context), None
    if s.basis == "A" and s.name in MULTI_SESSION_BOOKS:
        return trend_unavailable(s, context, TREND_MULTI), None
    if bars is None:
        raise UnknownSeries("no gated price source for NQ")
    close, served = nq_trend_close(bars, version)
    return trend_view(s, context, close), served


# ---------------------------------------------------------------- EX5


def _instruments(detail: Any) -> list[tuple[str, float | None]]:
    """(name, multiplier) of each instrument the run lists (the intraday runs: one NQ contract per trade)."""
    venue = detail.venue or {}
    if isinstance(venue.get("instruments"), (list, tuple)):
        return [(str(row.get("instrument")), row.get("multiplier")) for row in venue["instruments"]]
    if venue.get("instrument"):
        return [(str(venue["instrument"]), venue.get("multiplier"))]
    return [(capacity.ONE_NQ, None)]


def _multiplier(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def daily_volume(frame: pd.DataFrame) -> pd.Series:
    """The 1d volume by the bar's UTC date, before the fence."""
    if frame.empty:
        return pd.Series(dtype=float)
    stamps = pd.to_datetime(frame["ts"], utc=True)
    keep = (stamps >= IS_START) & (stamps < IS_END)
    dates = stamps[keep].dt.strftime("%Y-%m-%d").to_numpy()
    return pd.Series(frame.loc[keep, "v"].to_numpy(dtype=float), index=dates).groupby(level=0).sum()


def _legs(runs: RunService, run_id: str, detail: Any, names: Sequence[str]) -> tuple[list[capacity.Leg], str]:
    if detail.counts.fills:
        rows = _every_row(lambda offset, limit: runs.fills(run_id, offset, limit), detail.counts.fills)
        default = names[0] if len(names) == 1 else ""
        return capacity.fill_legs([r.model_dump() for r in rows], default), "fills"
    rows = _every_row(lambda offset, limit: runs.trades(run_id, offset, limit), detail.counts.trades)
    return capacity.trade_legs([r.model_dump() for r in rows], names[0]), "trades"


def capacity_view(runs: RunService, bars: BarService, run_id: str, version: Version) -> tuple[RunCapacity, Served]:
    """EX5 of one run (read only); `BookUnusable` for a run that failed its balance check."""
    detail = runs.detail(run_id, anchor=False)
    if detail.summary.usable is not True:
        raise BookUnusable(f"{run_id}: {UNUSABLE}")
    listed = _instruments(detail)
    sources = {name: capacity.volume_source(name, _multiplier(mult), FULL_MULTIPLIERS, ROOTS) for name, mult in listed}
    legs, source = _legs(runs, run_id, detail, [name for name, _ in listed])
    table = capacity.contracts_by_session(legs, sources)
    roots = sorted(set(table["root"])) if not table.empty else []
    volumes, years, cached = {}, [], True
    for root in roots:
        symbol = f"{root}.V.0"
        served = bars.frame(symbol, DAILY_TF, DAILY_VARIANT, IS_START, IS_END, version=version(symbol))
        volumes[root] = daily_volume(served.frame)
        years.extend(served.years)
        cached = cached and served.cached
    found = capacity.capacity_table(table, volumes)
    return _capacity_model(run_id, source, sources, found), Served(tuple(years), cached)


def _capacity_model(run_id: str, source: str, sources: Mapping[str, capacity.VolumeSource], found: dict) -> RunCapacity:
    instruments = [CapacityInstrument(instrument=s.instrument, symbol=f"{s.root}.V.0" if s.root else None,
                                      factor=s.factor, note=s.note) for s in sources.values()]
    rows = [CapacityRow(symbol=f"{r['root']}.V.0", sessions=r["sessions"],
                        sessions_with_volume=r["sessions_with_volume"], void=r["void"],
                        contracts_total=r["contracts_total"], contracts_mean=r["contracts_mean"],
                        ratio_mean=num(r["ratio_mean"]), ratio_median=num(r["ratio_median"]),
                        ratio_p95=num(r["ratio_p95"]), ratio_max=num(r["ratio_max"]),
                        ratio_max_date=r["ratio_max_session"], volume_median=num(r["volume_median"]))
            for r in found["rows"]]
    worst = [CapacitySession(date=w["session"], symbol=f"{w['root']}.V.0", contracts=w["contracts"],
                             volume=w["volume"], ratio=w["ratio"]) for w in found["worst"]]
    return RunCapacity(run_id=run_id, tag=POST_HOC, label=found["label"], basis=CAPACITY_BASIS, unit=CAPACITY_UNIT,
                       source=source, instruments=instruments, rows=rows, worst=worst,
                       max_ratio=num(found["max_ratio"]),
                       max_symbol=f"{found['max_root']}.V.0" if found["max_root"] else None, gate=None)


# ---------------------------------------------------------------- MV6


def chain_frames(bars: BarService, root: str) -> tuple[dict[int, pd.DataFrame], Served]:
    """Every calendar-chain rank the project holds for `root` (a universe root; checked by the caller)."""
    if root not in UNIVERSE:
        raise ChainMissing(f"not in the futures universe: {root}")
    frames, years, cached = {}, [], True
    for rank in CHAIN_RANKS:
        try:
            served = bars.frame(f"{root}.C.{rank}", DAILY_TF, DAILY_VARIANT, IS_START, IS_END)
        except UnknownSeries:
            continue
        frames[rank] = served.frame
        years.extend(served.years)
        cached = cached and served.cached
    if 0 not in frames or 1 not in frames:
        raise ChainMissing(f"no calendar chain C.0 and C.1 for {root}")
    return frames, Served(tuple(years), cached)


def _column(rows: Sequence[Mapping[str, Any]], key: str) -> list[Any]:
    return [row[key] for row in rows]


def term_view(frames: Mapping[int, pd.DataFrame], contract: Contract, gate: GateInfo) -> TermStructure:
    """MV6 from the served chain frames of one root."""
    root = contract.root
    found = term_structure.front_next(frames[0], frames[1], root)
    rows = found["rows"]
    curve = term_structure.latest_curve(frames, root)
    points = [TermPoint(rank=p["rank"], contract=p["contract"], expiry=p["expiry"],
                        days_to_expiry=p["days_to_expiry"], close=p["close"], volume=p["volume"], thin=p["thin"])
              for p in curve["rows"]]
    stats = term_structure.summary(rows)
    return TermStructure(
        root=root, symbol=f"{root}.V.0", sector=contract.sector, units=contract.units, tag=POST_HOC,
        label=found["label"], basis=TERM_BASIS, unit=TERM_UNIT, expiry_source=EXPIRY_SOURCE, ranks=sorted(frames),
        sessions=found["sessions"], fenced=found["fenced"], void=TermVoid(**found["void"]),
        summary=TermSummary(**{k: (num(v) if isinstance(v, float) else v) for k, v in stats.items()}),
        t=_column(rows, "t"), date=_column(rows, "date"), front=_column(rows, "front"), next=_column(rows, "next"),
        f1=_column(rows, "f1"), f2=_column(rows, "f2"), expiry_front=_column(rows, "expiry_front"),
        expiry_next=_column(rows, "expiry_next"), spread=_column(rows, "spread"), carry=_column(rows, "carry"),
        curve=TermCurve(date=curve["date"], points=points, missing_ranks=curve["missing"]), gate=gate)
