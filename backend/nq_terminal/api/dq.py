"""DQ endpoints (GET only): the data quality calendar (RI4) and the guard fingerprint status (RI5).

- `/api/dq/symbols`: every symbol with a QA or repair record, its day-state counts and repair status;
- `/api/dq/calendar/{symbol}`: one state and reason per session up to 2021-12-31, plus the per-year QA counts;
  `symbol` must match `^[A-Z0-9]{1,5}\\.V\\.0$` (else 422) and have a record (else 404, before any file is read);
- `/api/dq/guards`: OK, MISMATCH or NO RECORD per guard group.
No price is read. Files are read through the data services' confined cache; errors never carry a path.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Path as PathParam

from nq_terminal.api.data import DataServices, get_services
from nq_terminal.models.common import error_responses
from nq_terminal.models.dq import DqCalendar, DqIndex, GuardStatusReport
from nq_terminal.services import dq, dq_guards

router = APIRouter(prefix="/api/dq", tags=["dq"], responses=error_responses(404, 422, 502))
SYMBOL_PATTERN = r"^[A-Z0-9]{1,5}\.V\.0$"


@router.get("/symbols", response_model=DqIndex)
def symbols(services: DataServices = Depends(get_services)) -> DqIndex:
    """The symbols with a QA or repair record and their day-state counts."""
    return dq.symbol_index(services.files, services.settings.results_dir)


@router.get("/calendar/{symbol}", response_model=DqCalendar)
def calendar(symbol: str = PathParam(..., pattern=SYMBOL_PATTERN, max_length=11),
             services: DataServices = Depends(get_services)) -> DqCalendar:
    """One state per session for `symbol`, with the reason where the day is not plain vendor data."""
    try:
        found = dq.calendar(services.files, services.settings.results_dir, symbol)
    except dq.DqRecordError as exc:
        raise HTTPException(status_code=502, detail=f"the repair record of {symbol} could not be classified") from exc
    if found is None:
        raise HTTPException(status_code=404, detail=f"no QA or repair record for {symbol}")
    return found


@router.get("/guards", response_model=GuardStatusReport)
def guard_status(services: DataServices = Depends(get_services)) -> GuardStatusReport:
    """Each guard group's live fingerprint against the lab's record of it."""
    return dq_guards.guard_status(services.files, services.settings.results_dir, services.settings.root)
