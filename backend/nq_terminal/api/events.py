"""Event study endpoints (GET only, EVT, Phase 11): /api/events/calendar and /api/events/study.

- /api/events/calendar: the fixed event lists (`services/events.py`), their counts, and the instruments the study
  accepts: daily, the 27 universe futures with a processed 1d series; intraday, the symbols with a repaired 1m
  series (where 1m data is validated). No price is read.
- /api/events/study: the mean cumulative return path around the chosen event type, its cross-event band and every
  event's row. Intraday drops the sessions SEAS drops (`api.seasonality.session_exclusions`: NQ from qa.day_gate,
  other symbols from their futures repair provenance) and refuses a symbol with no such record (422). Prices come only through the data services' `BarService` (the OOS gate, caller `terminal`); in
  fixture mode without an injected serve it answers 503. The calendar files are read from the data root (the fixture
  root in fixture mode) through a confined `FileCache`.

`create_app` includes `router` before the web mount (prefix /api/events).
"""
from __future__ import annotations

import threading
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.api.data import SYMBOL_PATTERN, DataServices, gate_info, get_services, iso_utc
from nq_terminal.api.seasonality import session_exclusions
from nq_terminal.models.common import error_responses
from nq_terminal.models.events import EndStats, EventCalendar, EventCalendarEntry, EventRow, EventStudy
from nq_terminal.services.bars import BarService, GateRefusal, UnknownSeries
from nq_terminal.services.events import (
    BAND_LEVEL,
    BAND_NOTE,
    BAND_Z,
    DAILY_BASIS,
    DAILY_DEFAULT,
    DAILY_LIMITS,
    DAILY_TF,
    DAILY_VARIANT,
    EVENT_TYPES,
    INTRADAY_BASIS,
    INTRADAY_DEFAULT,
    INTRADAY_LIMITS,
    INTRADAY_TF,
    INTRADAY_VARIANT,
    GATED_REASON,
    LABEL,
    SELECTIONS,
    UNREPAIRED_REASON,
    Calendar,
    CalendarError,
    StudyResult,
    daily_study,
    intraday_study,
    load_calendar,
    pick_events,
    unit_for,
)
from nq_terminal.services.files import FileCache
from nq_terminal.services.sessions import Exclusions

router = APIRouter(prefix="/api/events", tags=["events"], responses=error_responses(404, 422, 403, 502, 503))

FILES_STATE = "events_files"
NO_PRICE_SOURCE = "no gated price source in fixture mode (inject app.state.serve_fn)"
MAX_OFFSET = max(DAILY_LIMITS[1], INTRADAY_LIMITS[1])
EventType = Literal["CPI", "PPI", "NFP", "FOMC", "ALL"]
Mode = Literal["daily", "intraday"]
_FILES_LOCK = threading.Lock()


def _calendar(request: Request) -> Calendar:
    state = request.app.state
    with _FILES_LOCK:
        files = getattr(state, FILES_STATE, None)
        if files is None:
            files = FileCache(roots=[state.settings.data_root])
            setattr(state, FILES_STATE, files)
    try:
        return load_calendar(files, state.settings.data_root)
    except CalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def daily_symbols(services: DataServices) -> list[str]:
    return [f"{c.root}.V.0" for c in TABLE if services.catalog.has(f"{c.root}.V.0", DAILY_TF, DAILY_VARIANT)]


def intraday_symbols(services: DataServices) -> list[str]:
    series = services.catalog.listing().series
    return sorted(s.symbol for s in series if s.timeframe == INTRADAY_TF and s.variant == INTRADAY_VARIANT)


def _window(mode: str, pre: int | None, post: int | None) -> tuple[int, int]:
    default, (low, high) = (DAILY_DEFAULT, DAILY_LIMITS) if mode == "daily" else (INTRADAY_DEFAULT, INTRADAY_LIMITS)
    pre, post = (default[0] if pre is None else pre), (default[1] if post is None else post)
    unit = "sessions" if mode == "daily" else "minutes"
    for name, value in (("pre", pre), ("post", post)):
        if not low <= value <= high:
            raise HTTPException(status_code=422, detail=f"{name} must be {low} to {high} {unit} in {mode} mode")
    return pre, post


def _bar_service(services: DataServices) -> BarService:
    if services.bars is None:
        raise HTTPException(status_code=503, detail=NO_PRICE_SOURCE)
    return services.bars


def _check_symbol(services: DataServices, symbol: str, mode: str) -> None:
    if mode == "daily" and symbol not in daily_symbols(services):
        raise HTTPException(status_code=404, detail=f"no daily universe series {symbol} 1d vendor")
    if mode == "intraday" and not services.catalog.has(symbol, INTRADAY_TF, INTRADAY_VARIANT):
        raise HTTPException(status_code=422, detail=(f"{symbol} has no repaired 1m series, so its 1m data is not "
                                                     "validated for intraday work; use the daily mode"))


def _intraday_exclusions(request: Request, services: DataServices, symbol: str, mode: str) -> Exclusions | None:
    """The sessions intraday work must drop (the rule SEAS applies); 422 when the symbol has no session record."""
    if mode != "intraday":
        return None
    excl = session_exclusions(request, services)(symbol, INTRADAY_VARIANT)
    if not excl.assessed:
        raise HTTPException(status_code=422, detail=(f"{symbol} has no session quality record, so its 1m sessions "
                                                     "are not assessed; use the daily mode"))
    return excl


def _run(services: DataServices, service: BarService, symbol: str, picks: list, pre: int, post: int,
         excl: Exclusions | None) -> StudyResult:
    if excl is None:
        return daily_study(service, symbol, picks, pre=pre, post=post,
                           version=services.catalog.version(symbol, DAILY_TF, DAILY_VARIANT))
    version = services.catalog.version(symbol, INTRADAY_TF, INTRADAY_VARIANT)

    def fetch(lo: pd.Timestamp, hi: pd.Timestamp):
        served = service.frame(symbol, INTRADAY_TF, INTRADAY_VARIANT, lo, hi, version=version)
        return served.frame, served.years, served.cached

    gated = frozenset(str(d) for d in excl.days if IS_START.date() <= d < IS_END.date())
    return intraday_study(fetch, picks, pre=pre, post=post, gated=gated,
                          gated_reason=GATED_REASON if excl.day_gate else UNREPAIRED_REASON)


def _rows(result: StudyResult) -> list[EventRow]:
    return [EventRow(n=i + 1, date=str(r.pick.date), types=list(r.pick.types), time_et=r.pick.time_et,
                     t0_utc=None if r.t0_utc is None else iso_utc(r.t0_utc), used=r.reason is None, reason=r.reason,
                     first=r.path[0] if r.path else None, end=r.path[-1] if r.path else None, path=list(r.path))
            for i, r in enumerate(result.rows)]


@router.get("/calendar", response_model=EventCalendar)
def event_calendar(request: Request, services: DataServices = Depends(get_services)) -> EventCalendar:
    """The fixed CPI, PPI, NFP and FOMC lists, their counts and the instruments each mode accepts; no price read."""
    cal = _calendar(request)
    entries = [EventCalendarEntry(date=str(d.date), types=list(d.types), times_et=[r.time_et for r in d.releases])
               for d in cal.days if not d.excluded]
    return EventCalendar(label=LABEL, source=cal.source, spec_sha256=cal.spec_sha256, fomc_check=cal.fomc_check,
                         types=list(SELECTIONS), counts=cal.counts, excluded=[str(d.date) for d in cal.days if d.excluded],
                         events=entries, daily_symbols=daily_symbols(services),
                         intraday_symbols=intraday_symbols(services), daily_default=list(DAILY_DEFAULT),
                         intraday_default=list(INTRADAY_DEFAULT))


@router.get("/study", response_model=EventStudy)
def event_study(
    request: Request,
    symbol: str = Query("NQ.V.0", pattern=SYMBOL_PATTERN, description="continuous symbol, e.g. NQ.V.0"),
    event: EventType = Query("FOMC", description=f"one of {', '.join(EVENT_TYPES)}, or ALL (each date once)"),
    mode: Mode = Query("daily"),
    pre: int | None = Query(None, ge=1, le=MAX_OFFSET, description="sessions (daily) or minutes (intraday) before"),
    post: int | None = Query(None, ge=1, le=MAX_OFFSET, description="sessions (daily) or minutes (intraday) after"),
    services: DataServices = Depends(get_services),
) -> EventStudy:
    """Mean cumulative return path around the chosen events with its cross-event band ([POST HOC], no p-value)."""
    pre, post = _window(mode, pre, post)
    _check_symbol(services, symbol, mode)
    excl = _intraday_exclusions(request, services, symbol, mode)
    service = _bar_service(services)
    calendar = _calendar(request)
    picks = pick_events(calendar, event)
    try:
        result = _run(services, service, symbol, picks, pre, post, excl)
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except UnknownSeries as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    daily = mode == "daily"
    used = sum(r.reason is None for r in result.rows)
    return EventStudy(
        symbol=symbol, event_type=event, mode=mode, variant=DAILY_VARIANT if daily else INTRADAY_VARIANT,
        timeframe=DAILY_TF if daily else INTRADAY_TF, label=LABEL, basis=DAILY_BASIS if daily else INTRADAY_BASIS,
        band_note=BAND_NOTE, source=calendar.source, unit=unit_for(mode),
        offset_unit="session" if daily else "minute", pre=pre, post=post, offsets=result.offsets,
        mean=result.agg.mean, se=result.agg.se, lower=result.agg.lower, upper=result.agg.upper, band_z=BAND_Z,
        band_level=BAND_LEVEL, n_listed=len(result.rows), n_used=used, n_void=len(result.rows) - used,
        end=EndStats(**result.end), events=_rows(result), gate=gate_info(service, result.years, result.cached))
