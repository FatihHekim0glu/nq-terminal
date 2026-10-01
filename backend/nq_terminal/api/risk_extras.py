"""P2 risk extras routes (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). GET only.

- `/api/analytics/hypothesis/{name}/risk-extras?cost=`: a registered hypothesis's screen series (Basis A);
- `/api/analytics/run/{run_id}/risk-extras?freq=D|M`: a Nautilus run's account series (Basis B).

Each answers RK4 modified ES at 95% and 99% and the PF11 tiles (ulcer index, recovery factor) for the RET tab, and BR5
Treynor for the RR tab, all "[POST HOC]" (`services/risk_extras.py`). The series are the tear sheet's own, built by
`api/analytics.py`'s helpers (stage A `analytics/series.py` over the shared runs and research services; prices only
through the data router's `BarService`, whose every serve is `nq_lab.data.serve` with caller "terminal"), so the
errors are the tear sheet's: 404 an unknown name, run or unrecorded cost; 422 an unusable run, a bad parameter or
equity at or below zero; 403 a gate refusal; 503 a missing or inconsistent source. A series too short for the moments
(fewer than four observations) is 422. No detail carries a path.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from nq_terminal.analytics.series import SessionSeries
from nq_terminal.api.analytics import _cost, _freq, _http_errors, _hypothesis, _name, _run, _run_id, _sources
from nq_terminal.models.analytics import Context, Freq
from nq_terminal.models.common import error_responses
from nq_terminal.models.risk_extras import RiskExtras
from nq_terminal.services import risk_extras

router = APIRouter(prefix="/api/analytics", tags=["analytics"], responses=error_responses(403, 404, 422, 503))


def _view(s: SessionSeries, context: Context) -> RiskExtras:
    try:
        return risk_extras.risk_extras_view(s, context)
    except ValueError as exc:  # fewer than four observations: no moments
        raise HTTPException(status_code=422, detail=f"no risk extras for this series: {exc}") from exc


@router.get("/hypothesis/{name}/risk-extras", response_model=RiskExtras)
def hypothesis_risk_extras(request: Request, name: str = _name(), cost: int = _cost()) -> RiskExtras:
    """RK4 modified ES, PF11 ulcer index and recovery factor, and BR5 Treynor of a hypothesis's screen series."""
    with _http_errors():
        s = _hypothesis(_sources(request), name, cost)
    return _view(s, Context(kind="hypothesis", name=name, cost=cost, freq="D"))


@router.get("/run/{run_id}/risk-extras", response_model=RiskExtras)
def run_risk_extras(request: Request, run_id: str = _run_id(), freq: Freq = _freq()) -> RiskExtras:
    """RK4 modified ES, PF11 ulcer index and recovery factor, and BR5 Treynor of a Nautilus run's account series."""
    with _http_errors():
        s = _run(_sources(request), run_id, freq)
    return _view(s, Context(kind="run", name=run_id, cost=None, freq=freq))
