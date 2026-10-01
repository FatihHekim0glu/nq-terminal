"""SV8 endpoint (ANALYTICS_CATALOG SV8; TASKS Phase 12). GET only.

- `/api/analytics/spa`: White's Reality Check, Hansen's SPA (lower, consistent and upper p-values) and Romano-Wolf
  StepM over the registered NQ hypotheses on one contract with a daily series, against NQ buy and hold on one
  contract (`services/spa_family.py`). The family is fixed by a rule on the registry, so no parameter picks it.

Prices only through the data router's `BarService` (every serve is `nq_lab.data.serve` with caller "terminal"). Errors:
no price source, a member that cannot be built or a missing registry is 503; a window the gate refuses is 403. No
detail carries a path.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from nq_terminal.api.analytics import NQ_SYMBOL, _http_errors
from nq_terminal.api.data import DAILY_TF, DAILY_VARIANT, get_services
from nq_terminal.models.common import error_responses
from nq_terminal.models.spa import SpaView
from nq_terminal.services import spa_family
from nq_terminal.services.research import service_for_root

router = APIRouter(prefix="/api/analytics", tags=["analytics"], responses=error_responses(403, 503))


@router.get("/spa", response_model=SpaView)
def family_spa(request: Request) -> SpaView:
    """SV8 family test over the pre-registered NQ one-contract hypotheses; [POST HOC], an extra view only."""
    with _http_errors():
        data = get_services(request)
        version = data.catalog.version(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT) if data.bars is not None else None
        research = service_for_root(request.app.state.settings.data_root)
        try:
            return spa_family.family_view(research, data.bars, version)
        except spa_family.FamilyError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
