"""SEAS endpoints (TASKS Phase 11), GET only, all descriptive and [POST HOC] with no p-value:

- `/api/seasonality/instrument/{root}?variant=&start_year=&end_year=`: a universe root's daily returns (vendor 1d
  file) by calendar month, weekday and week of month, its 30-minute NYSE buckets from the 1m bars (repaired when the
  symbol has a repaired series, else vendor; gated and excluded sessions dropped), and the monthly heatmap;
- `/api/seasonality/hypothesis/{name}?cost=&start_year=&end_year=`: the same calendar panels over a registered
  hypothesis's Basis A series (no price read).

`create_app` includes `router` before the web mount. Prices come only through the data router's `BarService` (caller
"terminal", the in-sample window; 503 in fixture mode without an injected serve). Session exclusions come from
`app.state.seasonality_exclusions` when a harness injected one, else from `services.seasonality.default_exclusions`.
Errors: an unknown root, hypothesis or series is 404; bad input (a year outside 2010 to 2021, start after end) is
422 before any serve; a gate refusal is 403; a missing or inconsistent source is 503. No detail carries a path.

Result cache (D1.3): `/api/seasonality/instrument/{root}` answers from `services/result_cache.py` through
`cached_instrument_seasonality`, which the HOME prewarm calls too (the hypothesis route is not cached).
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal, Mapping

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi import Path as PathParam
from fastapi.responses import Response

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.analytics import series
from nq_terminal.analytics.seasonality import MONTHS
from nq_terminal.analytics.series import SeriesError
from nq_terminal.api.data import (
    DAILY_TF,
    DAILY_VARIANT,
    DataServices,
    gate_info,
    get_with_current_gate,
    json_response,
    services_for,
)
from nq_terminal.api.research import MAX_COST, MAX_NAME, NAME_PATTERN
from nq_terminal.models.common import error_responses
from nq_terminal.models.seasonality import SeasonBucket, SeasonHeatmap, SeasonPanel, Seasonality
from nq_terminal.services import result_cache
from nq_terminal.services import seasonality as seas
from nq_terminal.services.bars import BarService, GateRefusal, UnknownSeries
from nq_terminal.services.research import ResearchDataError, UnknownNameError, service_for_root

router = APIRouter(prefix="/api/seasonality", tags=["seasonality"], responses=error_responses(403, 404, 422, 503))

EXCLUSIONS_STATE = "seasonality_exclusions"
ROOT_PATTERN = r"^[A-Z0-9]{1,5}$"
MINUTE_TF = "1m"
NO_PRICE_SOURCE = "no gated price source in fixture mode (inject app.state.serve_fn)"
Variant = Literal["vendor", "repaired"]
UNIVERSE_ROOTS = frozenset(c.root for c in TABLE)


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except UnknownNameError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnknownSeries as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (SeriesError, ResearchDataError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OSError as exc:  # the OS text would name a path
        raise HTTPException(status_code=503, detail=f"a source could not be read ({type(exc).__name__})") from exc


def _years(start_year: int, end_year: int) -> None:
    if start_year > end_year:
        raise HTTPException(status_code=422, detail="start_year must not be after end_year")


def _start_year() -> int:
    return Query(IS_START.year, ge=IS_START.year, le=seas.LAST_YEAR, description="first calendar year")


def _end_year() -> int:
    return Query(seas.LAST_YEAR, ge=IS_START.year, le=seas.LAST_YEAR, description="last calendar year (to 2021)")


def exclusions_for(state: Any, services: DataServices) -> seas.ExclusionFn:
    """The injected exclusion function (a harness), else the default one."""
    injected = getattr(state, EXCLUSIONS_STATE, None)
    if injected is not None:
        return injected
    settings = services.settings
    return seas.default_exclusions(services.files, settings.results_dir, fixture_mode=settings.fixture_mode)


def session_exclusions(request: Request, services: DataServices) -> seas.ExclusionFn:
    """The injected exclusion function (a harness), else the default one; EVT's intraday mode uses it too."""
    return exclusions_for(request.app.state, services)


def _bar_service(services: DataServices) -> BarService:
    if services.bars is None:
        raise HTTPException(status_code=503, detail=NO_PRICE_SOURCE)
    return services.bars


def _variant(services: DataServices, symbol: str, asked: str | None) -> str:
    if asked is not None:
        if not services.catalog.has(symbol, MINUTE_TF, asked):
            raise HTTPException(status_code=404, detail=f"no processed series {symbol} {MINUTE_TF} {asked}")
        return asked
    return "repaired" if services.catalog.has(symbol, MINUTE_TF, "repaired") else "vendor"


def to_model(result: seas.Result, gate) -> Seasonality:
    panels = [SeasonPanel(id=p.id, observation=p.observation, available=p.available, note=p.note,
                          buckets=[SeasonBucket(key=b.key, label=b.label, n=b.n, mean=b.mean, se=b.se,
                                                hit_rate=b.hit_rate) for b in p.buckets],
                          excluded_sessions=p.excluded_sessions, source=p.source) for p in result.panels]
    heat = SeasonHeatmap(years=result.heat_years, months=list(MONTHS), values=result.heat_values,
                         sessions=result.heat_sessions)
    return Seasonality(subject=result.subject, kind=result.kind, label=seas.LABEL, basis=result.basis,
                       unit=result.unit, fraction=result.fraction, aggregation=result.aggregation,
                       error_bar=seas.ERROR_BAR, first=result.first, last=result.last, sessions=result.sessions,
                       start_year=result.start_year, end_year=result.end_year, variant=result.variant,
                       cost=result.cost, panels=panels, heatmap=heat, gate=gate)


def _instrument(state: Any, services: DataServices, service: BarService, symbol: str, chosen: str,
                start_year: int, end_year: int) -> Seasonality:
    with _http_errors():
        daily = service.frame(symbol, DAILY_TF, DAILY_VARIANT, IS_START, IS_END,
                              version=services.catalog.version(symbol, DAILY_TF, DAILY_VARIANT))
        minutes = (seas.MinuteSource(service, symbol, chosen, services.catalog.version(symbol, MINUTE_TF, chosen))
                   if services.catalog.has(symbol, MINUTE_TF, chosen) else None)
        exclusions = exclusions_for(state, services)(symbol, chosen)
        result = seas.instrument_seasonality(daily.frame, symbol, minutes=minutes, exclusions=exclusions,
                                             start_year=start_year, end_year=end_year)
    years = tuple(daily.years) + result.served_years
    return to_model(result, gate_info(service, years, daily.cached and result.cached))


def cached_instrument_seasonality(state: Any, query: Mapping[str, Any]) -> bytes:
    """The serialised SEAS body of one instrument through the result cache (`root`, `variant` or None,
    `start_year`, `end_year`); the route and the prewarm both call it. In memory only (it reads prices).

    The input checks and the lookup of the series come first, outside the cache, so a refused request is never
    stored; the key holds the variant that was resolved (the default is the repaired series when it exists), so a
    repaired file that appears later is not answered from an entry made without it. An exclusion function injected
    by a harness is not part of the key, so with one the cache is bypassed."""
    root, asked = query["root"], query.get("variant")
    start_year, end_year = int(query.get("start_year", IS_START.year)), int(query.get("end_year", seas.LAST_YEAR))
    _years(start_year, end_year)
    if root not in UNIVERSE_ROOTS:
        raise HTTPException(status_code=404, detail=f"not in the futures universe: {root}")
    symbol = f"{root}.V.0"
    services = services_for(state)
    if not services.catalog.has(symbol, DAILY_TF, DAILY_VARIANT):
        raise HTTPException(status_code=404, detail=f"no processed daily series for {symbol}")
    chosen = _variant(services, symbol, asked)
    service = _bar_service(services)
    key = {"root": root, "variant": chosen, "start_year": start_year, "end_year": end_year}

    def compute() -> bytes:
        return result_cache.json_body(_instrument(state, services, service, symbol, chosen, start_year, end_year))

    return get_with_current_gate(state, result_cache.ROUTE_SEASONALITY, key, compute, service,
                                 clock_dependent=getattr(state, EXCLUSIONS_STATE, None) is not None)


@router.get("/instrument/{root}", response_model=Seasonality)
def instrument_seasonality(
    request: Request,
    root: str = PathParam(..., pattern=ROOT_PATTERN, description="a universe root, e.g. NQ"),
    variant: Variant | None = Query(None, description="1m series for the buckets; default repaired when it exists"),
    start_year: int = _start_year(),
    end_year: int = _end_year(),
) -> Response:
    """SEAS for one instrument: calendar panels from the 1d file and 30-minute buckets from the 1m bars."""
    query = {"root": root, "variant": variant, "start_year": start_year, "end_year": end_year}
    return json_response(cached_instrument_seasonality(request.app.state, query))


@router.get("/hypothesis/{name}", response_model=Seasonality)
def hypothesis_seasonality(
    request: Request,
    name: str = PathParam(..., pattern=NAME_PATTERN, max_length=MAX_NAME),
    cost: int = Query(1, ge=0, le=MAX_COST, description="ticks per side: 0, 1 or 2 (as the screen recorded them)"),
    start_year: int = _start_year(),
    end_year: int = _end_year(),
) -> Seasonality:
    """SEAS for a registered hypothesis: its recorded Basis A series by calendar period; no price is read."""
    _years(start_year, end_year)
    research = service_for_root(request.app.state.settings.data_root)
    with _http_errors():
        built = series.hypothesis_series(research, name, cost, bars=None)
        result = seas.hypothesis_seasonality(built, cost=cost, start_year=start_year, end_year=end_year)
    return to_model(result, None)
