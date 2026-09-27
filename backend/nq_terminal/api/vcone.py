"""VCONE endpoints (GET only; TASKS Phase 11): the volatility cone of one universe symbol and the small multiples
across the 27 futures at one horizon (ANALYTICS MV9 over MV3 close to close, annualised; `services/vcone.py`).

Prices are the universe's 1d frames served through the gate by the data router's `BarService` (caller
`terminal`, in-sample only, cached per series), through `api.data.daily_frames`; nothing here reads a file.
`create_app` includes `router` before the static mount.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from nq_lab.dtsmom_universe import TABLE
from nq_terminal.api.data import (
    SYMBOL_PATTERN,
    DataServices,
    _bar_service,
    _universe_symbol,
    daily_frames,
    gate_info,
    get_services,
)
from nq_terminal.models.common import error_responses
from nq_terminal.models.vcone import VolCone, VolConeRow, VolConeUniverse, VolConeUniverseRow
from nq_terminal.services.bars import GateRefusal
from nq_terminal.services.vcone import (
    BASIS,
    DEFAULT_HORIZON,
    HORIZONS,
    LABEL,
    MIN_WINDOWS,
    PERCENTILES,
    UNIT,
    ConeRow,
    universe_cone,
    volatility_cone,
)

router = APIRouter(prefix="/api/market", tags=["data"], responses=error_responses(403, 404, 422, 503))

_CONTRACTS = {f"{c.root}.V.0": c for c in TABLE}


def _row(row: ConeRow) -> VolConeRow:
    return VolConeRow(**{k: getattr(row, k) for k in VolConeRow.model_fields})


def _frames(services: DataServices, symbols: tuple[str, ...] | None):
    service = _bar_service(services)
    try:
        frames, years, cached = daily_frames(service, services.catalog, symbols=symbols)
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return frames, gate_info(service, years, cached)


@router.get("/vcone", response_model=VolCone)
def market_vcone(
    symbol: str = Query(..., pattern=SYMBOL_PATTERN, description="a universe symbol, e.g. NQ.V.0"),
    services: DataServices = Depends(get_services),
) -> VolCone:
    """The volatility cone of one universe symbol: for 5, 10, 21, 63, 126 and 252 sessions, the min, percentiles
    and max of the rolling realised volatility over the in-sample history, with the latest value, to 2021-12-31."""
    _universe_symbol(symbol)
    frames, gate = _frames(services, (symbol,))
    if symbol not in frames:
        raise HTTPException(status_code=404, detail=f"no processed daily series for {symbol}")
    cone = volatility_cone(frames[symbol], symbol)
    contract = _CONTRACTS[symbol]
    return VolCone(symbol=symbol, root=contract.root, sector=contract.sector, as_of=cone.as_of, label=LABEL,
                   basis=BASIS, unit=UNIT, percentiles=list(PERCENTILES), min_windows=MIN_WINDOWS,
                   undefined_returns=cone.undefined_returns, horizons=[_row(r) for r in cone.horizons], gate=gate)


@router.get("/vcone/universe", response_model=VolConeUniverse)
def market_vcone_universe(
    horizon: int = Query(DEFAULT_HORIZON, description=f"sessions per window, one of {HORIZONS}"),
    services: DataServices = Depends(get_services),
) -> VolConeUniverse:
    """VCONE's small multiples: every universe contract's cone statistics at one horizon, to 2021-12-31."""
    if horizon not in HORIZONS:
        raise HTTPException(status_code=422, detail=f"horizon must be one of {list(HORIZONS)} sessions")
    frames, gate = _frames(services, None)
    result = universe_cone(frames, contracts=TABLE, sessions=horizon)
    rows = [VolConeUniverseRow(symbol=r.symbol, root=r.root, sector=r.sector, stats=_row(r.stats))
            for r in result.rows]
    return VolConeUniverse(sessions=result.sessions, horizons=list(HORIZONS), as_of=result.as_of, label=LABEL,
                           basis=BASIS, unit=UNIT, percentiles=list(PERCENTILES), rows=rows,
                           missing=list(result.missing), gate=gate)
