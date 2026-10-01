"""P2 endpoints (GET only; TASKS Phase 12): RG2 trend regime, EX5 capacity and MV6 term structure.

- `/api/analytics/hypothesis/{name}/trend-regime?cost=` and `/api/analytics/run/{run_id}/trend-regime`: RG2 on the
  tear sheet's daily series (a monthly book answers `available: false` without a serve);
- `/api/analytics/run/{run_id}/capacity`: EX5 from the run's fills (or trades) and the 1d volume of each traded root;
- `/api/market/term-structure/{root}`: MV6 from the root's calendar chain `<ROOT>.C.k`.

Series come from `analytics/series.py` exactly as the tear sheet builds them (the analytics router's own helpers);
prices only through the data router's `BarService`, whose every serve is `nq_lab.data.serve` with caller "terminal"
over the in-sample window. In fixture mode without an injected serve there is no price source: 503.

Errors, as the analytics router maps them: an unknown name, run or root is 404 (a root outside the frozen futures
universe before any serve; a root without a C.0 and C.1 chain after the serve says so); an unbalanced run is 422
(rule 4); a gate refusal is 403; a missing or inconsistent source, or a fill that cannot be counted, is 503. No
detail carries a path. `app.py` includes `router` before the static mount.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import Path as PathParam

from nq_terminal.analytics._inputs import PERIODS_DAILY
from nq_terminal.analytics.capacity import CapacityError
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.api.analytics import Sources, _cost, _http_errors, _hypothesis, _name, _run, _run_id, _sources
from nq_terminal.api.data import DAILY_TF, DAILY_VARIANT, NO_PRICE_SOURCE, DataServices, gate_info, get_services
from nq_terminal.models.analytics import Context
from nq_terminal.models.common import error_responses
from nq_terminal.models.regimes_capacity_term import RunCapacity, TermStructure, TrendRegimeView
from nq_terminal.services import regimes_capacity_term as rct
from nq_terminal.services.bars import BarService, GateRefusal

router = APIRouter(prefix="/api", responses=error_responses(403, 404, 422, 503))
ROOT_PATTERN = r"^[A-Z0-9]{2}$"
ROOT_CHARS = 2


def _price_source(bars: BarService | None) -> BarService:
    if bars is None:
        raise HTTPException(status_code=503, detail=NO_PRICE_SOURCE)
    return bars


def _trend(src: Sources, s: SessionSeries, context: Context) -> TrendRegimeView:
    bars = src.bars if s.periods != PERIODS_DAILY else _price_source(src.bars)
    view, served = rct.trend_for(s, context, bars, src.version)
    if served is None:
        return view
    return view.model_copy(update={"gate": gate_info(bars, served.years, served.cached)})


@router.get("/analytics/hypothesis/{name}/trend-regime", response_model=TrendRegimeView, tags=["analytics"])
def hypothesis_trend_regime(request: Request, name: str = _name(), cost: int = _cost()) -> TrendRegimeView:
    """RG2 on a hypothesis's screen series: NQ above or below its 200-session mean at the session before; per-regime
    Sharpe, mean, hit rate and n; Welch's t above against below, no p-value."""
    with _http_errors():
        src = _sources(request)
        s = _hypothesis(src, name, cost)
        return _trend(src, s, Context(kind="hypothesis", name=name, cost=cost, freq="D"))


@router.get("/analytics/run/{run_id}/trend-regime", response_model=TrendRegimeView, tags=["analytics"])
def run_trend_regime(request: Request, run_id: str = _run_id()) -> TrendRegimeView:
    """RG2 on a Nautilus run's daily account series (Basis B, one row per gated session)."""
    with _http_errors():
        src = _sources(request)
        s = _run(src, run_id, "D")
        return _trend(src, s, Context(kind="run", name=run_id, cost=None, freq="D"))


@router.get("/analytics/run/{run_id}/capacity", response_model=RunCapacity, tags=["analytics"])
def run_capacity(request: Request, run_id: str = _run_id()) -> RunCapacity:
    """EX5: contracts per session over the session's volume (vendor 1d bar of the continuous series), per traded
    root, with the sessions of largest participation."""
    with _http_errors():
        src = _sources(request)
        bars = _price_source(src.bars)
        catalog = get_services(request).catalog

        def version(symbol: str) -> tuple[int, int] | None:
            return catalog.version(symbol, DAILY_TF, DAILY_VARIANT)

        try:
            view, served = rct.capacity_view(src.runs, bars, run_id, version)
        except CapacityError as exc:
            raise HTTPException(status_code=503, detail=f"the run's fills could not be counted: {exc}") from exc
        return view.model_copy(update={"gate": gate_info(bars, served.years, served.cached)})


@router.get("/market/term-structure/{root}", response_model=TermStructure, tags=["data"])
def market_term_structure(root: str = PathParam(..., pattern=ROOT_PATTERN, max_length=ROOT_CHARS),
                          services: DataServices = Depends(get_services)) -> TermStructure:
    """MV6: the front to next calendar-chain spread per session, annualised by the days between the pinned CME
    expiries, and the latest curve over every chain rank, to 2021-12-31."""
    contract = rct.UNIVERSE.get(root)
    if contract is None:
        raise HTTPException(status_code=404, detail=f"not in the futures universe: {root}")
    bars = _price_source(services.bars)
    try:
        frames, served = rct.chain_frames(bars, root)
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except rct.ChainMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return rct.term_view(frames, contract, gate_info(bars, served.years, served.cached))
