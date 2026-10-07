"""Runs endpoints (ARCHITECTURE section 4, Runs; TASKS 2.1). GET only; nothing is written.

The service is built once per app on first use from `app.state.settings` (the data root is the fixture
folder in fixture mode) and kept on `app.state.run_service`. Every `run_id` is looked up in the index built
from disk, so an unknown or crafted id is a 404 before any file is opened.

Result cache (D1.3). `/api/runs/compare`, `/api/ledger` and, since DEC1, `/api/runs` (the run index HOME asks for on
every launch) answer from `services/result_cache.py` through `cached_compare`, `cached_ledger` and `cached_runs`, which
the HOME prewarm calls too, so a route and the prewarm share their keys. The ledger and the index also pin the run
index (the folder of runs and each run folder), and build from a fresh scan of it, never from a listing up to
`RESCAN_S` old that the entry would then keep.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from enum import Enum
from typing import Annotated, Any, Iterator, Mapping

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import TypeAdapter

from nq_terminal.api.data import get_result_cache, json_response
from nq_terminal.models.common import DEFAULT_LIMIT, MAX_LIMIT, Page, error_responses
from nq_terminal.models.runs import (
    CompareStats,
    EquitySeries,
    FillRow,
    LedgerView,
    RunComparison,
    RunDetail,
    RunSummary,
    TradeRow,
)
from nq_terminal.services import result_cache
from nq_terminal.services.files import file_cache
from nq_terminal.services.runs import (
    CACHE_BYTES,
    MAX_COMPARE,
    RunNotFound,
    RunService,
    RunUnreadable,
    SectionNotFound,
    SidecarNotFound,
)

router = APIRouter(prefix="/api", tags=["runs"], responses=error_responses(404, 422, 503))
_SERVICE_LOCK = threading.Lock()
MAX_IDS_TEXT = 2000


class LogSection(str, Enum):
    decisions = "decisions"
    closes = "closes"
    notes = "notes"
    rolls = "rolls"
    snapshots = "snapshots"


def run_service_for(state: Any) -> RunService:
    """The run service of an app (built once, on first use); the prewarm calls this with `app.state`."""
    service = getattr(state, "run_service", None)
    if service is None:
        with _SERVICE_LOCK:
            service = getattr(state, "run_service", None)
            if service is None:
                settings = state.settings
                cache = file_cache(settings.file_cache_bytes, roots=[settings.data_root], max_bytes=CACHE_BYTES)
                service = RunService(data_root=settings.data_root, project_root=settings.root, cache=cache,
                                     state_dir=settings.state_dir,  # V031B: the run list's per-run index
                                     # V032: a run found unreadable drops the cached list, so the next list shows it
                                     on_unreadable=lambda: get_result_cache(state).forget(result_cache.ROUTE_RUNS, {}))
                state.run_service = service
    return service


def get_run_service(request: Request) -> RunService:
    return run_service_for(request.app.state)


Service = Annotated[RunService, Depends(get_run_service)]
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except RunNotFound as exc:
        raise HTTPException(status_code=404, detail="unknown run id") from exc
    except (SectionNotFound, SidecarNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RunUnreadable as exc:
        raise HTTPException(status_code=503, detail=f"result file could not be read: {exc}") from exc


def _parse_ids(ids: str) -> list[str]:
    parsed = [part.strip() for part in ids.split(",") if part.strip()]
    if not 2 <= len(parsed) <= MAX_COMPARE or len(set(parsed)) != len(parsed):
        raise HTTPException(status_code=422, detail=f"ids must name 2 to {MAX_COMPARE} distinct runs")
    return parsed


_SUMMARIES = TypeAdapter(list[RunSummary])


def cached_runs(state: Any, query: Mapping[str, Any] | None = None) -> bytes:
    """The serialised /api/runs body through the result cache (disk too: it reads no prices); the route and the
    prewarm both call it."""
    service = run_service_for(state)

    def compute() -> bytes:
        with _http_errors():
            _record_run_index(service)
            return _SUMMARIES.dump_json(service.summaries(), by_alias=True)

    return get_result_cache(state).get(result_cache.ROUTE_RUNS, {}, compute, price_free=True)


@router.get("/runs", response_model=list[RunSummary])
def list_runs(request: Request) -> Response:
    """Every run in backtests/output with its badges (probe, anchor, ledgered, balance, MTM, coverage)."""
    return json_response(cached_runs(request.app.state))


def cached_compare(state: Any, query: Mapping[str, Any]) -> bytes:
    """The serialised /api/runs/compare body through the result cache (`query["ids"]`, a comma list); the route and
    the prewarm both call it. The ids are checked before the cache is asked; the key keeps their order."""
    parsed = _parse_ids(query["ids"])
    service = run_service_for(state)

    def compute() -> bytes:
        with _http_errors():
            return result_cache.json_body(service.compare(parsed))

    return get_result_cache(state).get(result_cache.ROUTE_COMPARE, {"ids": parsed}, compute)


@router.get("/runs/compare", response_model=RunComparison)
def compare_runs(request: Request, ids: Annotated[str, Query(max_length=MAX_IDS_TEXT)]) -> Response:
    """Equity of 2 to 8 runs on one date axis, each rebased to 1.0, with headline numbers (Basis B)."""
    return json_response(cached_compare(request.app.state, {"ids": ids}))


@router.get("/runs/stats", response_model=list[CompareStats])
def run_stats(service: Service, ids: Annotated[str, Query(max_length=MAX_IDS_TEXT)]) -> list[CompareStats]:
    """Headline numbers of one or more runs, in the order asked (Basis B, the tear sheet's own series): the RUNS
    table's Sharpe and max drawdown without the equity curves that /runs/compare carries."""
    parsed = [part.strip() for part in ids.split(",") if part.strip()]
    if not parsed or len(set(parsed)) != len(parsed):
        raise HTTPException(status_code=422, detail="ids must name one or more distinct runs")
    with _http_errors():
        return service.stats(parsed)


@router.get("/runs/{run_id}", response_model=RunDetail)
def run_detail(service: Service, run_id: str) -> RunDetail:
    """One run without its large arrays, with anchor comparison and ledger copy command."""
    with _http_errors():
        return service.detail(run_id)


@router.get("/runs/{run_id}/trades", response_model=Page[TradeRow])
def run_trades(service: Service, run_id: str, offset: Offset = 0, limit: Limit = DEFAULT_LIMIT) -> Page[TradeRow]:
    with _http_errors():
        return service.trades(run_id, offset, limit)


@router.get("/runs/{run_id}/fills", response_model=Page[FillRow])
def run_fills(service: Service, run_id: str, offset: Offset = 0, limit: Limit = DEFAULT_LIMIT) -> Page[FillRow]:
    with _http_errors():
        return service.fills(run_id, offset, limit)


@router.get("/runs/{run_id}/log/{section}", response_model=Page[dict[str, Any]])
def run_log(service: Service, run_id: str, section: LogSection, offset: Offset = 0,
            limit: Limit = DEFAULT_LIMIT) -> Page[dict[str, Any]]:
    """One strategy log section (decisions, closes, notes, rolls or snapshots), nanoseconds as ISO."""
    with _http_errors():
        return service.log(run_id, section.value, offset, limit)


@router.get("/runs/{run_id}/equity", response_model=EquitySeries)
def run_equity(service: Service, run_id: str) -> EquitySeries:
    """Basis B equity: MTM snapshots, or realised daily P&L on every session ("realised, no MTM")."""
    with _http_errors():
        return service.equity(run_id)


@router.get("/runs/{run_id}/sidecar/{name}")
def run_sidecar(service: Service, run_id: str, name: str) -> Any:
    """A JSON sidecar of the run folder (regress_check, compare_screen, ...), sanitised."""
    with _http_errors():
        return service.sidecar(run_id, name)


def _record_run_index(service: RunService) -> None:
    """Pin the folder listing of the run index: the ledger joins its rows to the run folders, so a folder (or a
    sidecar) that appears must end the entry. Each folder is recorded with its mtime and a digest of its entries.

    The listing is recorded first and the index then rescanned, so the body is built from folders at least as new as
    the recorded listing: a folder that appears in between ends the entry at the next request instead of being missed.

    Every subfolder is recorded, not only the indexed ones: a folder without a result.json (a run whose result failed
    to serialise leaves one empty) is skipped by the scan, and a rerun that writes result.json into it changes no
    other recorded input, so its listing is pinned too."""
    output = service.index.output
    result_cache.record_input(output)
    if output.is_dir():
        for folder in output.iterdir():
            if folder.is_dir():
                result_cache.record_input(folder)
    for entry in service.index.rescan().values():
        result_cache.record_input(entry.folder)


def cached_ledger(state: Any, query: Mapping[str, Any] | None = None) -> bytes:
    """The serialised /api/ledger body through the result cache (disk too: it reads no prices); the route and the
    prewarm both call it."""
    service = run_service_for(state)

    def compute() -> bytes:
        with _http_errors():
            _record_run_index(service)
            return result_cache.json_body(service.ledger())

    return get_result_cache(state).get(result_cache.ROUTE_LEDGER, {}, compute, price_free=True)


@router.get("/ledger", response_model=LedgerView)
def ledger(request: Request) -> Response:
    """results/ledger.csv rows, typed and joined to their runs, plus every anchor pair."""
    return json_response(cached_ledger(request.app.state))
