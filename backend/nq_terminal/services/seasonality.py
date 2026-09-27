"""SEAS, seasonality (TASKS Phase 11): an instrument's or a registered hypothesis's returns grouped by calendar
month, weekday, week of month and (instruments with assessed 1m sessions) 30-minute bucket of the NYSE session,
plus the monthly values as years by months. Descriptive and [POST HOC]; no test statistic, no p-value.

Sources, all read only:
- Instruments (the 27 universe roots): daily r from the served 1d frame on the NYSE master calendar, through
  nq-lab's own builder (`dtsmom_panel.build_panel`, r = dB / (N - dB) with B = c_back, N = c_none), as the universe
  view does; months compounded. Intraday: the served 1m frames (vendor or repaired), one calendar year per call,
  cut into 30-minute buckets of the NYSE session (`analytics.seasonality`). Every price comes from the injected
  `BarService`, whose every serve is `nq_lab.data.serve` with caller "terminal", inside [2010-01-01, 2022-01-01).
- Session exclusions for the 1m buckets (`services.sessions.Exclusions`, shared with EVT): NQ.V.0 from the
  `qa.day_gate` files of the za_v0 screens (vendor, the rejected days; repaired, the days still rejected after the
  repair); every other symbol from its futures repair provenance (`nq_lab.data.excluded_sessions`, which also checks
  the merged file's sha256; memoised per symbol and variant). A symbol with neither is not assessed and gets no
  intraday panel. A kept session with no 1m bar, or whose bars have no raw close, counts as left out too, and the
  panel names each reason with its own count (and the first 1m bar's session when the series starts inside the
  years picked, as NQ's does on 2010-09-29). Sessions rebuilt from trades keep their buckets: the bar service
  derives their raw close (`bars.derive_raw_close`). The daily panels use the vendor 1d files, which the 1m repair
  does not touch, so they keep every in-sample session.
- Hypotheses: the Basis A session series of `analytics.series.hypothesis_series` (the screen's own sessions, gated
  sessions already dropped for trade books), summed within a month (C1). A monthly book has only the month panel.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics import seasonality as seas
from nq_terminal.analytics._inputs import PERIODS_MONTHLY
from nq_terminal.analytics.series import CAPITAL_UNIT, SessionSeries
from nq_terminal.services.bars import BarService
from nq_terminal.services.market import LABEL, last_in_sample_day
from nq_terminal.services.sessions import (
    NOT_ASSESSED,
    PROVENANCE_SOURCE,
    ExclusionFn,
    Exclusions,
    default_exclusions,
)

FIRST_YEAR = IS_START.year
LAST_YEAR = (IS_END - pd.Timedelta(days=1)).year
MINUTE_TF, DAILY_TF, DAILY_VARIANT = "1m", "1d", "vendor"
FRACTION_UNIT = "fraction of the previous price (0.01 is 1%)"
ERROR_BAR = ("one standard error of the mean, sd (ddof 1) / sqrt(n), drawn as mean plus and minus one; "
             "descriptive, no p-value on a picked slice")
INSTRUMENT_BASIS = ("daily r = dB / (N - dB) with B = c_back and N = c_none (the dtsmom_panel convention) on NYSE "
                    "sessions from the vendor 1d file, compounded within a month; 30-minute buckets of the NYSE "
                    "session from the {variant} 1m bars, r = dB / (N - dB) with dB the back-adjusted change from "
                    "the bucket's first open to its last close and N that bar's raw close (on a bar rebuilt from "
                    "trades, its close less the contract's offset)")
HYPOTHESIS_BASIS = "the screen's recorded {kind} series ({label}); Basis A, summed within a month"
OBSERVATIONS = {"month": "one value per month and year", "weekday": "one value per session",
                "week_of_month": "one value per session", "intraday": "one value per 30-minute bucket of a session"}
NOTE_MONTHLY_BOOK = "a monthly book has no session returns"
NOTE_NOT_INSTRUMENT = "a hypothesis series has no 1m bars"
NOTE_NO_MINUTES = "no {variant} 1m series for this symbol"
NOTE_NO_BAR = "{n} more with no 1m bar"
NOTE_NO_RAW_CLOSE = "{n} more whose bars have no raw close"
NOTE_FIRST_BAR = "the first 1m bar in the years picked is on {day}"
NOTE_NOT_ASSESSED = "no session quality record for this symbol, so its 1m sessions are not assessed"


@dataclass(frozen=True)
class Panel:
    id: str
    available: bool
    note: str | None
    buckets: tuple[seas.Bucket, ...]
    excluded_sessions: int | None = None
    source: str | None = None

    @property
    def observation(self) -> str:
        return OBSERVATIONS[self.id]


@dataclass(frozen=True)
class Result:
    subject: str
    kind: str
    basis: str
    unit: str
    fraction: bool
    aggregation: str
    first: str | None
    last: str | None
    sessions: int
    start_year: int
    end_year: int
    variant: str | None
    cost: int | None
    panels: tuple[Panel, ...]
    heat_years: list[int]
    heat_values: list[list[float | None]]
    heat_sessions: list[list[int]]
    served_years: tuple[int, ...] = ()
    cached: bool = True


# ---------------------------------------------------------------- shared pieces


def check_years(start_year: int, end_year: int) -> None:
    if not FIRST_YEAR <= start_year <= end_year <= LAST_YEAR:
        raise ValueError(f"years must satisfy {FIRST_YEAR} <= start_year <= end_year <= {LAST_YEAR}")


def _in_years(r: pd.Series, start_year: int, end_year: int) -> pd.Series:
    years = r.index.year
    return r[(years >= start_year) & (years <= end_year)]


def _unavailable(pid: str, note: str) -> Panel:
    return Panel(id=pid, available=False, note=note, buckets=())


def _session_panels(r: pd.Series, how: str, monthly_book: bool) -> list[Panel]:
    months = Panel(id="month", available=True, note=None, buckets=seas.by_month(r, how))
    if monthly_book:
        return [months, _unavailable("weekday", NOTE_MONTHLY_BOOK), _unavailable("week_of_month", NOTE_MONTHLY_BOOK)]
    return [months, Panel(id="weekday", available=True, note=None, buckets=seas.by_weekday(r)),
            Panel(id="week_of_month", available=True, note=None, buckets=seas.by_week_of_month(r))]


def _span(r: pd.Series) -> tuple[str | None, str | None]:
    if r.empty:
        return None, None
    return r.index[0].date().isoformat(), r.index[-1].date().isoformat()


# ---------------------------------------------------------------- instruments


def daily_returns(frame: pd.DataFrame, symbol: str) -> pd.Series:
    """The universe convention's daily r on the NYSE master calendar, finite values only, tz-naive dates."""
    panel = build_panel({symbol: frame}, master_days(IS_START.date(), last_in_sample_day()))
    r = pd.Series(panel.r[:, 0], index=pd.DatetimeIndex([pd.Timestamp(d) for d in panel.days]), dtype=float)
    return r[np.isfinite(r.to_numpy())]


def _year_window(year: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    lo = max(IS_START, pd.Timestamp(year=year, month=1, day=1, tz="UTC"))
    hi = min(IS_END, pd.Timestamp(year=year + 1, month=1, day=1, tz="UTC"))
    return lo, hi


@dataclass(frozen=True)
class MinuteSource:
    bars: BarService
    symbol: str
    variant: str
    version: tuple[int, int] | None


def left_out_source(source: str | None, no_bar: int, no_raw: int, first_bar: str | None) -> str | None:
    """The session record, then each further reason a kept session was not used, with its own count."""
    notes = [n for n in (source,
                         NOTE_NO_BAR.format(n=no_bar) if no_bar else None,
                         NOTE_FIRST_BAR.format(day=first_bar) if first_bar else None,
                         NOTE_NO_RAW_CLOSE.format(n=no_raw) if no_raw else None) if n]
    return "; ".join(notes) if notes else None


def intraday_panel(src: MinuteSource, exclusions: Exclusions, start_year: int, end_year: int
                   ) -> tuple[Panel, list[int], bool]:
    """The 30-minute bucket panel, one gated 1m serve per calendar year; (panel, served years, all cached).
    `excluded_sessions` is every eligible session not used: the excluded ones, kept sessions with no 1m bar and kept
    sessions whose bars have no raw close (no finite bucket return); the source names each count."""
    parts, years, cached, excluded, no_bar, no_raw = [], [], True, 0, 0, 0
    first_kept, first_bar = None, None
    for year in range(start_year, end_year + 1):
        lo, hi = _year_window(year)
        served = src.bars.frame(src.symbol, MINUTE_TF, src.variant, lo, hi, version=src.version)
        years.extend(served.years)
        cached = cached and served.cached
        table = nyse_sessions(lo.date(), (hi - pd.Timedelta(days=1)).date())
        dropped = exclusions.days & set(table.index)
        excluded += len(dropped)
        keep = set(table.index) - dropped
        part = seas.intraday_bucket_returns(served.frame, table, keep)
        with_bars = seas.sessions_with_bars(part)
        no_bar += len(keep) - with_bars
        no_raw += with_bars - seas.sessions_used(part)
        first_kept = first_kept or (min(keep) if keep else None)
        first_bar = first_bar or (min(part["session"]) if not part.empty else None)
        parts.append(part)
    returns = pd.concat(parts, ignore_index=True) if parts else seas.intraday_bucket_returns(
        pd.DataFrame(), pd.DataFrame(), None)
    late_start = first_bar.isoformat() if first_bar is not None and first_bar != first_kept else None
    panel = Panel(id="intraday", available=True, note=None, buckets=seas.by_bucket(returns),
                  excluded_sessions=excluded + no_bar + no_raw,
                  source=left_out_source(exclusions.source, no_bar, no_raw, late_start))
    return panel, years, cached


def instrument_seasonality(daily: pd.DataFrame, symbol: str, *, minutes: MinuteSource | None,
                           exclusions: Exclusions, start_year: int, end_year: int) -> Result:
    """`daily` is the served 1d frame; `minutes` None means the symbol has no 1m series in the chosen variant."""
    check_years(start_year, end_year)
    r = _in_years(daily_returns(daily, symbol), start_year, end_year)
    panels = _session_panels(r, seas.COMPOUND, monthly_book=False)
    served_years: list[int] = []
    cached = True
    variant = minutes.variant if minutes is not None else DAILY_VARIANT
    if minutes is None:
        panels.append(_unavailable("intraday", NOTE_NO_MINUTES.format(variant=variant)))
    elif not exclusions.assessed:
        panels.append(_unavailable("intraday", NOTE_NOT_ASSESSED))
    else:
        panel, served_years, cached = intraday_panel(minutes, exclusions, start_year, end_year)
        panels.append(panel)
    years, values, sessions = seas.heatmap(r, seas.COMPOUND)
    first, last = _span(r)
    return Result(subject=symbol, kind="instrument", basis=INSTRUMENT_BASIS.format(variant=variant),
                  unit=FRACTION_UNIT, fraction=True, aggregation=seas.COMPOUND, first=first, last=last,
                  sessions=int(len(r)), start_year=start_year, end_year=end_year, variant=variant, cost=None,
                  panels=tuple(panels), heat_years=years, heat_values=values, heat_sessions=sessions,
                  served_years=tuple(served_years), cached=cached)


# ---------------------------------------------------------------- hypotheses


def hypothesis_seasonality(s: SessionSeries, *, cost: int, start_year: int, end_year: int) -> Result:
    check_years(start_year, end_year)
    r = _in_years(s.r.astype(float), start_year, end_year)
    monthly_book = s.periods == PERIODS_MONTHLY
    panels = _session_panels(r, seas.SUM, monthly_book=monthly_book)
    panels.append(_unavailable("intraday", NOTE_NOT_INSTRUMENT))
    years, values, sessions = seas.heatmap(r, seas.SUM)
    first, last = _span(r)
    return Result(subject=s.name, kind="hypothesis", basis=HYPOTHESIS_BASIS.format(kind=s.kind, label=s.label),
                  unit=s.unit, fraction=s.unit.startswith(CAPITAL_UNIT), aggregation=seas.SUM, first=first,
                  last=last, sessions=int(len(r)), start_year=start_year, end_year=end_year, variant=None, cost=cost,
                  panels=tuple(panels), heat_years=years, heat_values=values, heat_sessions=sessions)


__all__ = ["ERROR_BAR", "LABEL", "NOT_ASSESSED", "PROVENANCE_SOURCE", "Exclusions", "ExclusionFn", "MinuteSource",
           "Result", "default_exclusions", "hypothesis_seasonality", "instrument_seasonality"]
