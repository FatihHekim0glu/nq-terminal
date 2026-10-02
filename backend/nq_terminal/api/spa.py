"""SV8 endpoint (ANALYTICS_CATALOG SV8; TASKS Phase 12). GET only.

- `/api/analytics/spa`: White's Reality Check, Hansen's SPA (lower, consistent and upper p-values) and Romano-Wolf
  StepM over the registered NQ hypotheses on one contract with a daily series, against NQ buy and hold on one
  contract (`services/spa_family.py`). The family is fixed by a rule on the registry, so no parameter picks it.

Prices only through the data router's `BarService` (every serve is `nq_lab.data.serve` with caller "terminal"). Errors:
no price source, a member that cannot be built or a missing registry is 503; a window the gate refuses is 403. No
detail carries a path.

Result cache (D1.3): the view answers from `services/result_cache.py` through `cached_spa`, which the HOME prewarm
calls too; the seeded procedure is deterministic for its inputs, so a cached body equals a fresh one.
"""
from __future__ import annotations

from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from nq_terminal.api.analytics import NQ_SYMBOL, _http_errors
from nq_terminal.api.data import DAILY_TF, DAILY_VARIANT, get_result_cache, json_response, services_for
from nq_terminal.models.common import error_responses
from nq_terminal.models.spa import SpaView
from nq_terminal.services import result_cache, spa_family
from nq_terminal.services.research import service_for_root

router = APIRouter(prefix="/api/analytics", tags=["analytics"], responses=error_responses(403, 503))


def cached_spa(state: Any, query: Mapping[str, Any] | None = None) -> bytes:
    """The serialised SV8 body through the result cache (in memory: it reads NQ prices through the gate); the route
    and the prewarm both call it. The family has no parameter, so the key is the route alone."""

    def compute() -> bytes:
        with _http_errors():
            data = services_for(state)
            version = data.catalog.version(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT) if data.bars is not None else None
            research = service_for_root(state.settings.data_root)
            try:
                return result_cache.json_body(spa_family.family_view(research, data.bars, version))
            except spa_family.FamilyError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc

    return get_result_cache(state).get(result_cache.ROUTE_SPA, {}, compute)


@router.get("/spa", response_model=SpaView)
def family_spa(request: Request) -> Response:
    """SV8 family test over the pre-registered NQ one-contract hypotheses; [POST HOC], an extra view only."""
    return json_response(cached_spa(request.app.state))
