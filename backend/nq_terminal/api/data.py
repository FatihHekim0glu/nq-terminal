"""Data endpoints (GET only): /api/bars, /api/data/catalog, /api/market/universe, /api/market/pair-corr, /api/qa
and /api/qa/{name}.

Services are built lazily, once per app, on the first data request (`get_services`):
- `BarService` over `app.state.serve_fn` when a test or fixture harness injected one, else over
  `nq_lab.data.serve` (the OOS gate). In fixture mode without an injected serve there is no price source and the
  price endpoints answer 503, so fixture runs can never add lines to the real audit log. The E2E harness
  (`tests/fixture_app.py`) injects the fake serve, and refuses to start outside fixture mode.
- The service's counters are published to /api/health through `app.state.gate_stats`.
- `Catalog` over the processed folder (metadata only), or `app.state.catalog` when a harness injected one. In
  fixture mode the default catalog lists `<fixture root>/data/processed` (the same relative path), never the real
  folder, so fixture runs stay deterministic while other workflows write processed files.
- A `FileCache` confined to the results folder for the QA and repair reports (fenced before serving) and the
  session QA files.

Input rules: `symbol` must match `^[A-Z0-9]{1,5}\\.V\\.0$` and name a series the catalog lists (else 422 or 404,
before any serve); times are ISO 8601, naive values are UTC. A window outside the fence gives 403 with the gate's
own message and the loader is never called (see `services/bars.py`).
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Path as PathParam

from nq_lab import data as nq_data
from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.models.common import error_responses
from nq_terminal.models.data import (
    Bars,
    CatalogColumn,
    CatalogSeries,
    Correlation,
    DataCatalog,
    GateInfo,
    PairCorrelationSeries,
    QaIndex,
    QaReport,
    QaReportInfo,
    RollMarker,
    SessionFlags,
    Universe,
    UniverseRow,
)
from nq_terminal.services.bars import (
    CALLER,
    DEFAULT_MAX_POINTS,
    TS_CONVENTION,
    BarService,
    BarsResult,
    GateRefusal,
    ServeFn,
    SpanTooLong,
    UnknownSeries,
    source_timeframe,
)
from nq_terminal.services.catalog import (
    Catalog,
    SeriesMeta,
    list_qa_reports,
    processed_dir,
)
from nq_terminal.services.fence import fence_filter
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError, redact_local_paths, thaw
from nq_terminal.services.market import (
    BASIS,
    HORIZONS,
    LABEL,
    MIN_CORR_OBS,
    CorrelationBlock,
    UniverseResult,
    pair_correlation,
    universe,
)
from nq_terminal.services.sessions import session_flags
from nq_terminal.settings import Settings

router = APIRouter(prefix="/api", tags=["data"], responses=error_responses(403, 404, 422, 502, 503))

SERVICES_STATE = "data_services"
SYMBOL_PATTERN = r"^[A-Z0-9]{1,5}\.V\.0$"
MIN_POINTS, MAX_POINTS = 10, 20_000
MAX_WINDOW = 2520
MAX_TIME_CHARS = 40
MAX_NAME_CHARS = 80
DAILY_TF, DAILY_VARIANT = "1d", "vendor"
BARS_LABEL = "back-adjusted prices served through the OOS gate; descriptive, in-sample"
CATALOG_SOURCE = "processed price files, described from parquet footers only (no rows read)"
NO_PRICE_SOURCE = "no gated price source in fixture mode (inject app.state.serve_fn)"
Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d"]
Variant = Literal["vendor", "repaired"]
_BUILD_LOCK = threading.Lock()


@dataclass(frozen=True)
class DataServices:
    bars: BarService | None
    catalog: Catalog  # or a harness's stand-in with the same four methods
    files: FileCache
    settings: Settings


def default_catalog(settings: Settings) -> Catalog:
    """The real processed folder, or in fixture mode the same relative folder under the fixture root."""
    if not settings.fixture_mode:
        return Catalog()
    return Catalog(folder=settings.data_root / processed_dir().relative_to(ROOT))


def build_services(settings: Settings, serve_fn: ServeFn | None, catalog: Catalog | None = None) -> DataServices:
    serve = serve_fn if serve_fn is not None else (None if settings.fixture_mode else nq_data.serve)
    bars = BarService(serve, cache_bytes=settings.cache_bytes) if serve is not None else None
    return DataServices(bars=bars, catalog=catalog if catalog is not None else default_catalog(settings),
                        files=FileCache(roots=[settings.results_dir]), settings=settings)


def get_services(request: Request) -> DataServices:
    state = request.app.state
    services = getattr(state, SERVICES_STATE, None)
    if services is not None:
        return services
    with _BUILD_LOCK:
        services = getattr(state, SERVICES_STATE, None)
        if services is None:
            services = build_services(state.settings, getattr(state, "serve_fn", None),
                                      getattr(state, "catalog", None))
            setattr(state, SERVICES_STATE, services)
            if services.bars is not None:
                state.gate_stats = services.bars.stats
    return services


def _bar_service(services: DataServices) -> BarService:
    if services.bars is None:
        raise HTTPException(status_code=503, detail=NO_PRICE_SOURCE)
    return services.bars


# ---------------------------------------------------------------- helpers


def iso_utc(stamp: pd.Timestamp) -> str:
    return stamp.tz_convert("UTC").isoformat().replace("+00:00", "Z")


def parse_time(text: str | None, name: str) -> pd.Timestamp | None:
    if text is None:
        return None
    try:
        stamp = pd.Timestamp(text)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"{name} is not an ISO 8601 time: {text!r}") from exc
    if stamp is pd.NaT:
        raise HTTPException(status_code=422, detail=f"{name} is not a time: {text!r}")
    return stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")


def default_window(timeframe: str, start: pd.Timestamp | None, end: pd.Timestamp | None) -> tuple[pd.Timestamp,
                                                                                                    pd.Timestamp]:
    """Missing bounds: the end defaults to the fence; the start to IS_START (1d) or one year before the end."""
    end = end if end is not None else IS_END
    if start is None:
        start = IS_START if timeframe == DAILY_TF else max(IS_START, end - pd.DateOffset(years=1))
    if not start < end:
        raise HTTPException(status_code=422, detail="start must be before end")
    return start, end


def gate_info(service: BarService, years: tuple[int, ...], cached: bool) -> GateInfo:
    return GateInfo(caller=CALLER, served_years=sorted(set(years)), cached=cached,
                    reads_this_process=service.stats()[0])


def bars_model(result: BarsResult, service: BarService, sessions: dict) -> Bars:
    rolls = [RollMarker(t=r.t, from_id=r.from_id, to_id=r.to_id,
                        gap_pts=r.gap_pts if math.isfinite(r.gap_pts) else None, gap_pct=r.gap_pct)
             for r in result.rolls]
    return Bars(symbol=result.symbol, timeframe=result.timeframe, variant=result.variant, bucket=result.bucket,
                ts_convention=TS_CONVENTION, start=iso_utc(result.start), end=iso_utc(result.end), label=BARS_LABEL,
                t=result.t, o=result.o, h=result.h, l=result.l, c=result.c, v=result.v, rolls=rolls,
                sessions=SessionFlags(**sessions), gate=gate_info(service, result.years, result.cached))


def catalog_model(entry: SeriesMeta) -> CatalogSeries:
    sid = entry.series_id
    return CatalogSeries(symbol=sid.symbol, root=sid.root, timeframe=sid.timeframe, variant=sid.variant,
                         file=entry.file, size_bytes=entry.size_bytes, modified_utc=entry.modified_utc,
                         rows=entry.rows, row_groups=entry.row_groups,
                         columns=[CatalogColumn(name=c.name, type=c.type) for c in entry.columns],
                         first_ts=None if entry.first_ts is None else iso_utc(entry.first_ts),
                         extends_past_fence=entry.extends_past_fence, error=entry.error)


def correlation_model(block: CorrelationBlock) -> Correlation:
    return Correlation(sessions=block.sessions, symbols=list(block.symbols), order=list(block.order),
                       matrix=[list(row) for row in block.matrix])


def universe_model(result: UniverseResult, gate: GateInfo) -> Universe:
    rows = [UniverseRow(**{k: getattr(r, k) for k in UniverseRow.model_fields}) for r in result.rows]
    return Universe(as_of=result.as_of, window=result.window, label=LABEL, basis=BASIS,
                    horizons=[label for label, _ in HORIZONS], horizon_sessions=result.horizon_sessions, rows=rows,
                    correlation_window=correlation_model(result.corr_window),
                    correlation_full=correlation_model(result.corr_full), missing=list(result.missing), gate=gate)


def daily_frames(service: BarService, catalog: Catalog, symbols: tuple[str, ...] | None = None
                 ) -> tuple[dict[str, pd.DataFrame], tuple[int, ...], bool]:
    """Universe symbols' 1d frames over the whole in-sample window (one gated serve each, then cached): all 27, or
    the ones named in `symbols`."""
    frames, years, cached = {}, (), True
    for contract in TABLE:
        symbol = f"{contract.root}.V.0"
        if symbols is not None and symbol not in symbols:
            continue
        try:
            served = service.frame(symbol, DAILY_TF, DAILY_VARIANT, IS_START, IS_END,
                                   version=catalog.version(symbol, DAILY_TF, DAILY_VARIANT))
        except UnknownSeries:
            continue
        frames[symbol], years, cached = served.frame, served.years, cached and served.cached
    return frames, years, cached


# ---------------------------------------------------------------- endpoints


@router.get("/bars", response_model=Bars)
def get_bars(
    symbol: str = Query(..., pattern=SYMBOL_PATTERN, description="continuous symbol, e.g. NQ.V.0"),
    timeframe: Timeframe = Query("1d"),
    variant: Variant = Query("vendor"),
    start: str | None = Query(None, max_length=MAX_TIME_CHARS, description="ISO 8601, inclusive; naive is UTC"),
    end: str | None = Query(None, max_length=MAX_TIME_CHARS, description="ISO 8601, exclusive; naive is UTC"),
    max_points: int = Query(DEFAULT_MAX_POINTS, ge=MIN_POINTS, le=MAX_POINTS),
    services: DataServices = Depends(get_services),
) -> Bars:
    """Gated OHLCV buckets (true highs and lows) with roll markers, session flags ([GATED], [REPAIRED]) and the
    gate's bookkeeping; 403 past the fence; 422 for a span longer than the timeframe allows (1m one year, 5m to 4h three
    years)."""
    service = _bar_service(services)
    lo, hi = default_window(timeframe, parse_time(start, "start"), parse_time(end, "end"))
    source_tf = source_timeframe(timeframe)
    if not services.catalog.has(symbol, source_tf, variant):
        raise HTTPException(status_code=404, detail=f"no processed series {symbol} {timeframe} {variant}")
    try:
        result = service.bars(symbol, timeframe, variant, lo, hi, max_points=max_points,
                              version=services.catalog.version(symbol, source_tf, variant))
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except SpanTooLong as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except UnknownSeries as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    flags = session_flags(services.files, services.settings.results_dir, symbol, variant, lo, hi)
    return bars_model(result, service, flags)


@router.get("/data/catalog", response_model=DataCatalog)
def data_catalog(services: DataServices = Depends(get_services)) -> DataCatalog:
    """Processed series listed by file name and described from parquet footers; no price is read."""
    listing = services.catalog.listing()
    return DataCatalog(source=CATALOG_SOURCE, series=[catalog_model(e) for e in services.catalog.entries()],
                       unrecognised=list(listing.unrecognised))


@router.get("/market/universe", response_model=Universe)
def market_universe(
    window: int = Query(252, ge=MIN_CORR_OBS, le=MAX_WINDOW, description="sessions for volatility and correlation"),
    services: DataServices = Depends(get_services),
) -> Universe:
    """Horizon returns (dtsmom_panel convention) and realised volatility, plus the clustered correlation matrix,
    to 2021-12-31."""
    service = _bar_service(services)
    try:
        frames, years, cached = daily_frames(service, services.catalog)
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = universe(frames, window=window, contracts=TABLE)
    return universe_model(result, gate_info(service, years, cached))


@router.get("/market/pair-corr", response_model=PairCorrelationSeries)
def market_pair_corr(
    a: str = Query(..., pattern=SYMBOL_PATTERN, description="a universe symbol, e.g. NQ.V.0"),
    b: str = Query(..., pattern=SYMBOL_PATTERN, description="another universe symbol"),
    window: int = Query(63, ge=MIN_CORR_OBS, le=MAX_WINDOW, description="sessions per correlation"),
    services: DataServices = Depends(get_services),
) -> PairCorrelationSeries:
    """Rolling correlation of two universe symbols' daily returns (the CORR cell click-through), to 2021-12-31."""
    universe_symbols = {f"{c.root}.V.0" for c in TABLE}
    if a == b:
        raise HTTPException(status_code=422, detail="a and b must name two different symbols")
    unknown = [s for s in (a, b) if s not in universe_symbols]
    if unknown:
        raise HTTPException(status_code=404, detail=f"not in the futures universe: {', '.join(unknown)}")
    service = _bar_service(services)
    try:
        frames, years, cached = daily_frames(service, services.catalog, symbols=(a, b))
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if a not in frames or b not in frames:
        raise HTTPException(status_code=404, detail=f"no processed daily series for {a} and {b}")
    result = pair_correlation(frames, a, b, window=window)
    return PairCorrelationSeries(a=a, b=b, window=window, label=LABEL, basis=BASIS, t=list(result.t),
                                 date=list(result.days), corr=list(result.corr),
                                 gate=gate_info(service, years, cached))


@router.get("/qa", response_model=QaIndex)
def qa_index(services: DataServices = Depends(get_services)) -> QaIndex:
    """The QA and repair reports in the results folder."""
    reports = list_qa_reports(services.settings.results_dir)
    return QaIndex(reports=[QaReportInfo(name=r.name, size_bytes=r.size_bytes, modified_utc=r.modified_utc,
                                         history=r.history) for r in reports])


@router.get("/qa/{name}", response_model=QaReport)
def qa_report(name: str = PathParam(..., max_length=MAX_NAME_CHARS),
              services: DataServices = Depends(get_services)) -> QaReport:
    """One report, sanitised (NaN and infinities to null) and fenced (nothing after 2021-12-31); names come only
    from the index."""
    found = {r.name: r for r in list_qa_reports(services.settings.results_dir)}.get(name)
    if found is None:
        raise HTTPException(status_code=404, detail=f"no QA report named {name!r}")
    try:
        content = thaw(services.files.read_json(found.file))
    except (FileNotFoundError, FileAccessError) as exc:
        raise HTTPException(status_code=404, detail=f"QA report {name!r} is not readable") from exc
    except FileDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"QA report {name!r} could not be decoded") from exc
    fenced, dropped = fence_filter(content)
    # The reports record absolute file paths; no response may name a local folder (or the user name in it).
    local = redact_local_paths(fenced, services.settings.data_root)
    return QaReport(name=found.name, modified_utc=found.modified_utc, fence_end=IS_END.date().isoformat(),
                    fenced_out=dropped, content=local)
