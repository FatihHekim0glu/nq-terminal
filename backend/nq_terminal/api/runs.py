"""Runs endpoints (ARCHITECTURE section 4, Runs; TASKS 2.1). GET only; nothing is written.

The service is built once per app on first use from `app.state.settings` (the data root is the fixture
folder in fixture mode) and kept on `app.state.run_service`. Every `run_id` is looked up in the index built
from disk, so an unknown or crafted id is a 404 before any file is opened.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from enum import Enum
from typing import Annotated, Any, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from nq_terminal.models.common import DEFAULT_LIMIT, MAX_LIMIT, Page, error_responses
from nq_terminal.models.runs import (
    EquitySeries,
    FillRow,
    LedgerView,
    RunComparison,
    RunDetail,
    RunSummary,
    TradeRow,
)
from nq_terminal.services.runs import (
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


def get_run_service(request: Request) -> RunService:
    state = request.app.state
    service = getattr(state, "run_service", None)
    if service is None:
        with _SERVICE_LOCK:
            service = getattr(state, "run_service", None)
            if service is None:
                settings = state.settings
                service = RunService(data_root=settings.data_root, project_root=settings.root)
                state.run_service = service
    return service


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


@router.get("/runs", response_model=list[RunSummary])
def list_runs(service: Service) -> list[RunSummary]:
    """Every run in backtests/output with its badges (probe, anchor, ledgered, balance, MTM, coverage)."""
    return service.summaries()


@router.get("/runs/compare", response_model=RunComparison)
def compare_runs(service: Service, ids: Annotated[str, Query(max_length=MAX_IDS_TEXT)]) -> RunComparison:
    """Equity of 2 to 8 runs on one date axis, each rebased to 1.0, with headline numbers (Basis B)."""
    parsed = _parse_ids(ids)
    with _http_errors():
        return service.compare(parsed)


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


@router.get("/ledger", response_model=LedgerView)
def ledger(service: Service) -> LedgerView:
    """results/ledger.csv rows, typed and joined to their runs, plus every anchor pair."""
    with _http_errors():
        return service.ledger()
