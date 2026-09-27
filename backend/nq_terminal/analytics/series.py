"""Series builders (TASKS 3.1; ANALYTICS_CATALOG C1, C2, C6; ARCHITECTURE section 4, item (g)).

The one bridge between the Phase 2 services and the pure analytics functions: it turns a registered
hypothesis or a Nautilus run into a `SessionSeries`, a session-indexed return series that carries its basis
and its annualisation, plus its unit and its benchmark. It reads no file itself (the research and runs services do, read only)
and reads prices only through an injected `BarService`, whose every serve is `nq_lab.data.serve` with caller
"terminal" (the OOS gate). Everything built here is descriptive.

Session index. NYSE sessions from `nq_lab.sessions.nyse_sessions` (a calendar, not a price read), as a tz-naive
DatetimeIndex of session dates, end exclusive. A stamp maps to the UTC date it falls on.

Basis A, "screen" (C1: `r = PnL / K`), through `ResearchService.series`:
- `return on capital` series (the volmanaged and mim sessions; the tsmom and dtsmom months) are used as recorded; P is 252
  for a daily series and 12 for a monthly book (C2), so the section 14 anchors hold exactly.
- `nights` and one-contract `daily` series (eurodrift, fomccycle) keep their recorded rows; eurodrift's void
  nights are rows worth 0 (the screen's own unconditional book, `constants.SeriesSource.void_as_zero`).
- `trades` series (one NQ contract, USD) are summed per exit session and put on every NYSE session of the window
  the screen served (`serve.start` to `serve.end`, or `serve.nq`; else the NQ data start 2010-09-28 to the fence),
  0 on sessions without a trade (as `metrics.daily_pnl`); for `za_v0` the sessions `qa.day_gate` rejected are
  dropped (its repaired rejected-days file). A trade outside the window is an error. There is no K: `on_capital`
  is False, the unit is USD per session, and CAGR or total return are not defined on them.
- Where the screen records how many sessions it evaluated (`RECORDED_COUNTS`), the built series must have exactly
  that many rows, else `SeriesError`.
- Benchmark (C6): the screen's own column (`r_bh_k` same-exposure buy and hold, `r_lo_k` long-only book); for a
  one-contract NQ series, when a `BarService` is given, NQ buy and hold close to close in USD per contract.

Basis B, "account" (C1: `r_t = E_t / E_{t-1} - 1`, compounding from `E_0 = K`), through `RunService.equity`:
- runs with snapshots use them as they are (the run's own sessions);
- runs without snapshots use realised P&L on every gated session (item (g), the catalogue's rule "one row for
  every gated session"): za_orb drops the sessions `qa.day_gate` rejected for the run's variant (the za_v0
  screens' `*_rejected_days.json`); overnight keeps its nights (sessions that start a night inside the window,
  minus `data.skipped`). The kept count must equal the run's own `data` block (`gated_days`, `rejected_days`,
  `nights`), and a dropped session must carry no P&L; either failure raises `SeriesError`.
- Benchmark (C6): sized books and dtsmom use their paired Nautilus run (volmanaged against volmanaged_bh, tsmom
  against its `bh` book, dtsmom against its `lo` book, at the same ticks over the same window and variant; the
  longest shared run name wins); intraday runs use NQ buy and hold close to close, `r = dB / (N - dB)` (the dtsmom_panel
  convention), from the 1d vendor series through the gate. Benchmark runs themselves carry none.
- An account whose equity reaches zero or below cannot compound (`SeriesNotCompoundable`, naming the first such
  session): its returns are undefined from there. The three lookahead probe runs are such accounts.

Errors: every inconsistency is a `SeriesError` (an empty series, repeated or unsorted sessions, a NaN return, a
count that disagrees with the source), so the API can answer it with a declared status, never a 500.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab.calendar_effects import ECONOMICS
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel
from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics._inputs import PERIODS_DAILY, PERIODS_MONTHLY, check_basis, check_periods, returns_array
from nq_terminal.constants import SERIES_SOURCES
from nq_terminal.services.sessions import session_flags

if TYPE_CHECKING:
    from nq_terminal.services.bars import BarService
    from nq_terminal.services.research import ResearchService
    from nq_terminal.services.runs import RunService

__all__ = ["IS_END", "IS_START", "NQ_BH_LABEL", "NQ_BH_USD_LABEL", "SeriesError", "SeriesNotCompoundable",
           "SeriesUnusable", "SessionSeries", "closest_name", "hypothesis_series", "nq_buy_and_hold",
           "returns_from_equity", "run_returns", "run_series", "screen_window", "session_index"]

NQ_SYMBOL = "NQ.V.0"
DAILY_TF, DAILY_VARIANT = "1d", "vendor"
NQ_POINT_VALUE = ECONOMICS["nq"][0]  # USD per point, one NQ contract
NQ_BH_LABEL = "NQ buy and hold, close to close, dB / (N - dB) on the 1d vendor series (through the gate)"
NQ_BH_USD_LABEL = "NQ buy and hold, close to close, one contract, USD per session, no costs (through the gate)"
REALISED_LABEL = "realised, no MTM"
SNAPSHOT_LABEL = "mark to market snapshots"
CAPITAL_UNIT = "return on capital"
ONE_NQ = "one NQ contract"
PERIODS_BY_KIND = {"daily": PERIODS_DAILY, "nights": PERIODS_DAILY, "trades": PERIODS_DAILY,
                   "monthly": PERIODS_MONTHLY}
GATED_HYPOTHESES: Mapping[str, tuple[str, str]] = {"za_v0": (NQ_SYMBOL, "repaired")}
DATA_START = "2010-09-28"  # the first NQ session every NQ screen served (za_v0 `sessions` 2836 from here)
# Screens that record how many sessions they evaluated: the dotted path of that count in the screen JSON.
RECORDED_COUNTS: Mapping[str, tuple[str, ...]] = {"za_v0": ("gated_days",), "mac5rev_v0": ("counts", "sessions"),
                                                  "eurodrift_v0": ("counts", "candidates"),
                                                  "vt_har_v0": ("headline", "n"), "vrp_eq_v0": ("headline", "n")}
INTRADAY = ("za_orb", "overnight")
# (strategy, book) -> (benchmark strategy, benchmark book, label); a book missing from params is None.
PAIRS: Mapping[tuple[str, str | None], tuple[str, str | None, str]] = {
    ("volmanaged", None): ("volmanaged_bh", None, "same-exposure buy and hold"),
    ("tsmom", None): ("tsmom", "bh", "same-exposure buy and hold"),
    ("tsmom", "vs"): ("tsmom", "bh", "same-exposure buy and hold"),
    ("dtsmom", "tsmom"): ("dtsmom", "lo", "long-only equal-risk book"),
}
LOOKBACK = pd.Timedelta(days=7)  # calendar days before a series' first session, so its first change is defined


class SeriesError(ValueError):
    """The inputs of a series disagree with each other (counts, gated sessions, equity)."""


class SeriesUnusable(SeriesError):
    """The run failed its balance check: it is unusable (rule 4) and gets no series."""


class SeriesNotCompoundable(SeriesError):
    """The account's equity reached zero or below, so `E_t / E_{t-1} - 1` is undefined from there (item (b))."""


@dataclass(frozen=True)
class SessionSeries:
    """A session-indexed return series (the fields are described in the module docstring).

    `r` holds finite floats on a strictly increasing, tz-naive DatetimeIndex of session dates. `capital` is K in
    USD for Basis B (the run's starting balance); Basis A returns are already fractions of K (or USD P&L when
    `on_capital` is False) and K itself lives in the spec, so it is None there. `bench`, when
    present, is on the same index and may hold NaN where the benchmark has no value (callers align pairs).
    `dropped` lists the sessions (YYYY-MM-DD) removed from the session index, gate-rejected or outside the nights.
    """

    name: str
    basis: str
    periods: int
    r: pd.Series
    unit: str
    on_capital: bool
    capital: float | None
    source: str
    kind: str
    label: str
    bench: pd.Series | None = None
    bench_label: str | None = None
    dropped: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        try:
            check_basis(self.basis)
            check_periods(self.periods)
            returns_array(self.r)
            _check_index(self.r.index)
        except SeriesError:
            raise
        except ValueError as exc:
            raise SeriesError(f"{self.name}: {exc}") from exc
        if not len(self.r):
            raise SeriesError(f"{self.name}: the series is empty")
        if self.bench is not None and not self.bench.index.equals(self.r.index):
            raise SeriesError("the benchmark must share the series' session index")

    @property
    def n(self) -> int:
        return int(len(self.r))


def _check_index(index: pd.Index) -> None:
    if not isinstance(index, pd.DatetimeIndex) or index.tz is not None:
        raise ValueError("a session series needs a tz-naive DatetimeIndex of session dates")
    if len(index) > 1 and not (index.is_monotonic_increasing and index.is_unique):
        raise ValueError("session dates must be strictly increasing")


# ---------------------------------------------------------------- calendar


def _day(value: Any) -> dt.date:
    return pd.Timestamp(value).date()


def session_index(start: Any, end: Any) -> pd.DatetimeIndex:
    """NYSE sessions in [start, end) as tz-naive session dates (a calendar; no price is read)."""
    first, stop = _day(start), _day(end)
    if stop <= first:
        raise ValueError(f"empty or reversed window [{first}, {stop})")
    table = nyse_sessions(first, stop - dt.timedelta(days=1))
    return pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in table.index]), name="session")


def _dates(epochs: Sequence[int]) -> pd.DatetimeIndex:
    """Epoch seconds to the UTC session date they fall on."""
    return pd.DatetimeIndex(pd.to_datetime(np.asarray(epochs, dtype="int64"), unit="s").normalize(), name="session")


def _iso(index: pd.Index) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in index]


def _utc(day: pd.Timestamp) -> pd.Timestamp:
    return pd.Timestamp(day).tz_localize("UTC") if pd.Timestamp(day).tz is None else pd.Timestamp(day)


# ---------------------------------------------------------------- NQ benchmark (through the gate)


def _nq_panel(bars: BarService, days: pd.DatetimeIndex, version: tuple[int, int] | None):
    served = bars.frame(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT, IS_START, IS_END, version=version)
    return build_panel({NQ_SYMBOL: served.frame}, [d.date() for d in days])


def nq_buy_and_hold(bars: BarService, index: pd.DatetimeIndex, *, usd: bool = False,
                    version: tuple[int, int] | None = None) -> pd.Series:
    """NQ close to close on `index`: `dB / (N - dB)` (a return), or `dB * point value` (USD, one contract).

    Changes are taken on the full NYSE calendar from a week before the first session, then read at `index`, so a
    session left out of `index` never folds its move into the next one.
    """
    days = session_index(index[0] - LOOKBACK, index[-1] + pd.Timedelta(days=1))
    panel = _nq_panel(bars, days, version)
    values = panel.dB[:, 0] * NQ_POINT_VALUE if usd else panel.r[:, 0]
    return pd.Series(values, index=days, dtype=float).reindex(index)


# ---------------------------------------------------------------- Basis A


def _recorded(dates: pd.DatetimeIndex, values: Sequence[float]) -> pd.Series:
    return pd.Series(np.asarray(values, dtype=float), index=dates, dtype=float)


def _gate_rejected(research: ResearchService, name: str, first: pd.Timestamp, stop: pd.Timestamp) -> set[str]:
    gate = GATED_HYPOTHESES.get(name)
    if gate is None:
        return set()
    flags = session_flags(research.cache, research.results, gate[0], gate[1], _utc(first), _utc(stop))
    if not flags["assessed"]:
        raise SeriesError(f"{name}: the {gate[1]} rejected-days file is missing, so the gated sessions are unknown")
    return set(flags["gated"])


def screen_window(screen: Mapping[str, Any] | None) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) the screen served (`serve`, or `serve.nq`); else the NQ data start to the fence."""
    serve = screen.get("serve") if isinstance(screen, Mapping) else None
    for node in (serve, serve.get("nq") if isinstance(serve, Mapping) else None):
        if isinstance(node, Mapping) and node.get("start") and node.get("end"):
            return pd.Timestamp(node["start"]), pd.Timestamp(node["end"])
    return pd.Timestamp(DATA_START), pd.Timestamp(IS_END)


def _check_recorded(name: str, screen: Mapping[str, Any] | None, built: int) -> None:
    path = RECORDED_COUNTS.get(name)
    if path is None:
        return
    node: Any = screen
    for key in path:
        node = node.get(key) if isinstance(node, Mapping) else None
    if isinstance(node, bool) or not isinstance(node, int):
        raise SeriesError(f"{name}: the screen no longer records its session count ({'.'.join(path)})")
    if node != built:
        raise SeriesError(f"{name}: {built} sessions built, the screen records {node} ({'.'.join(path)})")


def _trade_sessions(research: ResearchService, name: str, screen: Mapping[str, Any] | None,
                    dates: pd.DatetimeIndex, values: Sequence[float]) -> tuple[pd.Series, tuple[str, ...]]:
    """Trades summed per exit session, zero-filled on every gated session of the screen's served window."""
    by_day = _recorded(dates, values).groupby(level=0).sum()
    start, end = screen_window(screen)
    sessions = session_index(start, end)
    stop = sessions[-1] + pd.Timedelta(days=1)
    outside = by_day.index.difference(sessions)
    if len(outside):
        raise SeriesError(f"{name}: trades on days that are not sessions of the screen window "
                          f"[{_day(start)}, {_day(end)}): {', '.join(_iso(outside[:5]))}")
    rejected = _gate_rejected(research, name, sessions[0], stop)
    traded = sorted(set(_iso(by_day.index[by_day != 0])) & rejected)
    if traded:
        raise SeriesError(f"{name}: gate-rejected sessions carry trades: {', '.join(traded[:5])}")
    keep = sessions[[d not in rejected for d in _iso(sessions)]]
    return by_day.reindex(keep, fill_value=0.0), tuple(sorted(rejected))


def _hypothesis_bench(name: str, cost: int, hs: Any, r: pd.Series, bars: BarService | None,
                      version: tuple[int, int] | None) -> tuple[pd.Series | None, str | None]:
    source = SERIES_SOURCES[name]
    column = source.bench.get(cost)
    if column is not None and hs.r_bench is not None:
        values = [math.nan if v is None else v for v in hs.r_bench]
        return _recorded(r.index, values), f"{source.bench_label} ({column})"
    if bars is not None and ONE_NQ in source.unit:
        return nq_buy_and_hold(bars, r.index, usd=True, version=version), NQ_BH_USD_LABEL
    return None, None


def hypothesis_series(research: ResearchService, name: str, cost: int, *, bars: BarService | None = None,
                      version: tuple[int, int] | None = None) -> SessionSeries:
    """Basis A series of a registered hypothesis at `cost` ticks per side (see the module docstring)."""
    hs = research.series(name, cost)
    periods = PERIODS_BY_KIND.get(hs.kind)
    if periods is None:
        raise SeriesError(f"{name}: unknown series kind {hs.kind!r}")
    if not hs.r:
        raise SeriesError(f"{name}: the series file {hs.source} has no rows at cost {cost}")
    screen = research.screen(name)
    dates = _dates(hs.t)
    dropped: tuple[str, ...] = ()
    if hs.kind == "trades":
        r, dropped = _trade_sessions(research, name, screen, dates, hs.r)
        unit = hs.unit.replace("per trade", "per session")
    else:
        r, unit = _recorded(dates, hs.r), hs.unit
    _check_recorded(name, screen, len(r))
    bench, bench_label = _hypothesis_bench(name, cost, hs, r, bars, version)
    return SessionSeries(name=name, basis="A", periods=periods, r=r, unit=unit,
                         on_capital=unit.startswith(CAPITAL_UNIT), capital=None, source=hs.source, kind=hs.kind,
                         label=f"{name} at {cost} tick(s) per side, screen basis", bench=bench,
                         bench_label=bench_label, dropped=dropped)


# ---------------------------------------------------------------- Basis B


def returns_from_equity(equity: Sequence[float], dates: Sequence[str], starting: float) -> pd.Series:
    """`E_t / E_{t-1} - 1` compounding from `E_0 = starting`, on the session dates."""
    values = np.asarray([starting, *equity], dtype=float)
    if len(values) != len(dates) + 1:
        raise SeriesError("equity and dates differ in length")
    if not np.all(np.isfinite(values)):
        raise SeriesError("equity must be finite to compound")
    if not values[0] > 0:
        raise SeriesError("no positive starting balance K")
    bad = np.flatnonzero(values[1:] <= 0)
    if len(bad):
        first = str(list(dates)[bad[0]])[:10]
        plural = "s" if len(bad) != 1 else ""
        raise SeriesNotCompoundable(
            f"not compoundable: equity <= 0 on {len(bad)} session{plural} (first {first}, "
            f"{values[1 + bad[0]]:.2f} USD); account returns are undefined once the account is at or below zero")
    index = pd.DatetimeIndex(pd.to_datetime(list(dates)).normalize(), name="session")
    return pd.Series(values[1:] / values[:-1] - 1.0, index=index, dtype=float)


def _check_count(run_id: str, what: str, recorded: Any, counted: int) -> None:
    if isinstance(recorded, int) and not isinstance(recorded, bool) and recorded != counted:
        raise SeriesError(f"{run_id}: the gated sessions disagree with the run: {counted} {what} counted, "
                          f"the run records {recorded}")


def _za_sessions(run_id: str, cfg: Mapping[str, Any], data: Mapping[str, Any],
                 research: ResearchService) -> set[str]:
    sessions = session_index(cfg["start"], cfg["end"])
    variant = str(cfg.get("variant") or data.get("variant") or "vendor")
    flags = session_flags(research.cache, research.results, NQ_SYMBOL, variant, _utc(sessions[0]),
                          _utc(pd.Timestamp(cfg["end"])))
    if not flags["assessed"]:
        raise SeriesError(f"{run_id}: the {variant} rejected-days file is missing, so the gated sessions are unknown")
    rejected = set(flags["gated"])
    kept = set(_iso(sessions)) - rejected
    _check_count(run_id, "sessions", data.get("sessions"), len(sessions))
    _check_count(run_id, "rejected sessions", data.get("rejected_days"), len(rejected))
    _check_count(run_id, "gated sessions", data.get("gated_days"), len(kept))
    return kept


def _overnight_sessions(run_id: str, cfg: Mapping[str, Any], data: Mapping[str, Any]) -> set[str]:
    sessions = _iso(session_index(cfg["start"], cfg["end"]))
    skipped = {str(row.get("entry_date"))[:10] for row in data.get("skipped") or () if isinstance(row, Mapping)}
    kept = set(sessions[:-1]) - skipped  # the last session's night ends after the window
    _check_count(run_id, "sessions", data.get("sessions"), len(sessions))
    _check_count(run_id, "nights", data.get("nights"), len(kept))
    return kept


def _gated_sessions(run_id: str, detail: Any, research: ResearchService) -> set[str]:
    strategy = detail.summary.strategy
    if strategy == "za_orb":
        return _za_sessions(run_id, detail.config, detail.data, research)
    if strategy == "overnight":
        return _overnight_sessions(run_id, detail.config, detail.data)
    raise SeriesError(f"{run_id}: no gated-session rule for strategy {strategy!r} without snapshots")


def _gated_curve(run_id: str, curve: Any, kept: set[str]) -> tuple[list[str], list[float], tuple[str, ...]]:
    """Keep the gated sessions of a realised curve; a dropped session must carry no P&L."""
    dates, equity, dropped, previous = [], [], [], curve.starting_usd
    for day, value in zip(curve.date, curve.equity):
        if day in kept:
            dates.append(day)
            equity.append(value)
        elif value != previous:
            raise SeriesError(f"{run_id}: session {day} is not a gated session but carries realised P&L")
        else:
            dropped.append(day)
        previous = value
    if len(dates) != len(kept):
        raise SeriesError(f"{run_id}: {len(kept) - len(dates)} gated sessions are missing from the equity curve")
    return dates, equity, tuple(dropped)


def _basis_b(runs: RunService, research: ResearchService, run_id: str) -> tuple[pd.Series, Any, Any, tuple]:
    curve = runs.equity(run_id)
    if not curve.usable:
        raise SeriesUnusable(f"{run_id}: {curve.unusable_reason}")
    if not curve.starting_usd or curve.starting_usd <= 0:
        raise SeriesError(f"{run_id}: no positive starting balance K")
    detail = runs.detail(run_id, anchor=False)
    if curve.source == "mtm_snapshots":
        return returns_from_equity(curve.equity, curve.date, curve.starting_usd), curve, detail, ()
    kept = _gated_sessions(run_id, detail, research)
    dates, equity, dropped = _gated_curve(run_id, curve, kept)
    return returns_from_equity(equity, dates, curve.starting_usd), curve, detail, dropped


def closest_name(name: str, candidates: Sequence[str]) -> str | None:
    """The candidate sharing the longest leading run of characters with `name`; ties go to the shorter, then
    alphabetically first, name."""
    def shared(other: str) -> int:
        n = 0
        while n < min(len(name), len(other)) and name[n] == other[n]:
            n += 1
        return n

    return min(candidates, key=lambda c: (-shared(c), len(c), c)) if candidates else None


def _pair_run(runs: RunService, run_id: str, detail: Any) -> tuple[str, str] | None:
    params = detail.config.get("params") or {}
    target = PAIRS.get((detail.summary.strategy, params.get("book")))
    if target is None:
        return None
    strategy, book, label = target
    me = detail.summary
    names = [s.run_id for s in runs.summaries()
             if s.usable and not s.is_probe and not s.is_anchor and s.run_id != run_id and s.strategy == strategy
             and (s.params or {}).get("book") == book and (s.params or {}).get("ticks") == params.get("ticks")
             and (s.start, s.end, s.variant) == (me.start, me.end, me.variant)]
    chosen = closest_name(run_id, names)
    return (chosen, f"paired run {chosen} ({label})") if chosen else None


def _run_bench(runs: RunService, research: ResearchService, run_id: str, detail: Any, index: pd.DatetimeIndex,
               bars: BarService | None, version: tuple[int, int] | None) -> tuple[pd.Series | None, str | None]:
    if detail.summary.strategy in INTRADAY:
        return (nq_buy_and_hold(bars, index, version=version), NQ_BH_LABEL) if bars is not None else (None, None)
    pair = _pair_run(runs, run_id, detail)
    if pair is None:
        return None, None
    bench, _, _, _ = _basis_b(runs, research, pair[0])
    return bench.reindex(index), pair[1]


def run_returns(runs: RunService, research: ResearchService, run_id: str) -> pd.Series:
    """The Basis B returns of a run exactly as `run_series` builds them, without a benchmark: the one definition the
    RUNS compare view and the anchor check share with the tear sheet (item (c))."""
    return _basis_b(runs, research, run_id)[0]


def run_series(runs: RunService, research: ResearchService, run_id: str, *, bars: BarService | None = None,
               version: tuple[int, int] | None = None) -> SessionSeries:
    """Basis B series of a Nautilus run (see the module docstring); `SeriesUnusable` for an unbalanced run."""
    r, curve, detail, dropped = _basis_b(runs, research, run_id)
    bench, bench_label = _run_bench(runs, research, run_id, detail, r.index, bars, version)
    snapshots = curve.source == "mtm_snapshots"
    return SessionSeries(name=run_id, basis="B", periods=PERIODS_DAILY, r=r, unit="return on the account per session",
                         on_capital=True, capital=float(curve.starting_usd), source=curve.source,
                         kind=curve.source, label=SNAPSHOT_LABEL if snapshots else REALISED_LABEL, bench=bench,
                         bench_label=bench_label, dropped=dropped)
