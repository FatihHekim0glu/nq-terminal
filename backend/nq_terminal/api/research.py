"""Research endpoints (ARCHITECTURE s4 Research), GET only.

Errors: an unknown name or an unrecorded cost is 404; a sealed allowlist that no longer fits its file is
500 (nothing is served); any other missing or inconsistent research file is 503. Messages name files, never
full paths. One `ResearchService` (and its FileCache) is kept per data root.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, TypeVar

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi import Path as PathParam

from nq_terminal.models.common import error_responses
from nq_terminal.models.research import (
    Confirmation,
    HypothesisCard,
    HypothesisDetail,
    HypothesisSeries,
    MultipleTesting,
    RegistryView,
    SealedItem,
    SealedView,
)
from nq_terminal.services.research import (
    ResearchDataError,
    ResearchService,
    SealedAllowlistError,
    UnknownNameError,
    service_for_root,
)

router = APIRouter(prefix="/api", tags=["research"], responses=error_responses(404, 422, 500, 503))
T = TypeVar("T")
NAME_PATTERN = r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$"
MAX_NAME = 80
MAX_COST = 2


def service_for(data_root: Path) -> ResearchService:
    return service_for_root(data_root)


def _service(request: Request) -> ResearchService:
    return service_for(request.app.state.settings.data_root)


def _answer(call: Callable[[], T]) -> T:
    try:
        return call()
    except UnknownNameError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SealedAllowlistError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ResearchDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _name() -> str:
    return PathParam(pattern=NAME_PATTERN, max_length=MAX_NAME)


@router.get("/registry", response_model=RegistryView)
def registry(request: Request) -> RegistryView:
    """Every row of results/registry.csv, with counts taken from the file, and whether a screen or spec is newer than
    results/registry.md (read from modification times only)."""
    return _answer(_service(request).registry)


@router.get("/hypotheses", response_model=list[HypothesisCard])
def hypotheses(request: Request) -> list[HypothesisCard]:
    """One card per registry row, joined to its screen and spec, with the live spec re-hash."""
    return _answer(_service(request).cards)


@router.get("/hypotheses/{name}", response_model=HypothesisDetail)
def hypothesis(request: Request, name: str = _name()) -> HypothesisDetail:
    """Card, screen JSON, spec, auxiliary files, history names and the round summary."""
    service = _service(request)
    return _answer(lambda: service.detail(name))


@router.get("/hypotheses/{name}/series", response_model=HypothesisSeries)
def hypothesis_series(request: Request, name: str = _name(),
                      cost: int = Query(1, ge=0, le=MAX_COST)) -> HypothesisSeries:
    """The Basis A series at 0, 1 or 2 ticks per side, from the screen CSV."""
    service = _service(request)
    return _answer(lambda: service.series(name, cost))


@router.get("/multiple-testing", response_model=MultipleTesting)
def multiple_testing(request: Request) -> MultipleTesting:
    """Registry p values with Bonferroni and Holm adjustments plus BH q values, recomputed and compared with the
    stored columns."""
    return _answer(_service(request).multiple_testing)


@router.get("/confirmations", response_model=list[Confirmation])
def confirmations(request: Request) -> list[Confirmation]:
    """Sealed-window confirmations, each with its own alpha and the spent label."""
    return _answer(_service(request).confirmations)


@router.get("/sealed", response_model=list[SealedItem])
def sealed_index(request: Request) -> list[SealedItem]:
    """Sealed files that can be served: JSON and markdown files, plus the allowlisted CSVs."""
    return _answer(_service(request).sealed_index)


@router.get("/sealed/{name}", response_model=SealedView)
def sealed(request: Request, name: str = _name()) -> SealedView:
    """One sealed file: allowlisted CSV columns, JSON without price keys, or the markdown."""
    service = _service(request)
    return _answer(lambda: service.sealed(name))
