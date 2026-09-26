"""Analytics endpoints (ARCHITECTURE s4 Analytics; TASKS 3.3; UI_SPEC s7 tear sheet and HOME [B]). GET only.

- `/api/analytics/hypothesis/{name}?cost=` and `/api/analytics/run/{run_id}?freq=D|M`: the tear sheet (EQ, DD, RET,
  RR, MRET tabs; the KPI row; the relative and validity blocks).
- `.../panel`: the HOME [B] panel (equity against the benchmark; underwater; rolling Sharpe, long window).
- `/api/analytics/run/{run_id}/trades`, `/costs` and `/exposure`: TA1, TA3 and TA6; EX3 and EX4; EX1 and EX2 of a
  Nautilus run, apart from the tear sheet so it stays light (`services/run_books.py`). Raw prices for a book's
  exposure only through the bar service (caller "terminal", the in-sample window); TA6 from
  `results/quote_check_v1.json` (read only) and the paper book journal's performance rows (plumbing rows dropped).

Series come from `analytics/series.py` (stage A) over the shared runs and research services; prices only through
the data router's `BarService`, whose every serve is `nq_lab.data.serve` with caller "terminal". In fixture mode
without an injected serve there is no price source, so series that need NQ as a benchmark simply have none.

Errors: an unknown name, run or unrecorded cost is 404; a run that failed its balance check is 422 (rule 4: it is
unusable and gets no analytics), and so is an account whose equity reaches zero or below (it cannot compound; the
detail names the first such session); a window the gate refuses is 403; a missing or inconsistent source is 503.
No detail carries a path.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi import Path as PathParam

from nq_terminal.analytics import series, validity
from nq_terminal.analytics.exposure import BookUnusable, CostError, ExposureError, RunBook
from nq_terminal.analytics.series import SeriesError, SeriesNotCompoundable, SeriesUnusable, SessionSeries
from nq_terminal.analytics.trades import TradeError
from nq_terminal.api.data import DAILY_TF, DAILY_VARIANT, get_services
from nq_terminal.api.live import live_monitor
from nq_terminal.api.research import MAX_COST, MAX_NAME, NAME_PATTERN
from nq_terminal.api.runs import get_run_service
from nq_terminal.models.analytics import Analytics, Context, Freq, HomePanel
from nq_terminal.models.common import error_responses
from nq_terminal.models.run_views import RunCosts, RunExposure, RunTrades
from nq_terminal.services import run_books, stored_alpha, tearsheet
from nq_terminal.services.bars import BarService, GateRefusal, UnknownSeries
from nq_terminal.services.research import ResearchDataError, ResearchService, UnknownNameError, service_for_root
from nq_terminal.services.runs import RunNotFound, RunService, RunUnreadable

router = APIRouter(prefix="/api/analytics", tags=["analytics"], responses=error_responses(403, 404, 422, 503))
NQ_SYMBOL = "NQ.V.0"
MAX_RUN_ID = 200


@dataclass(frozen=True)
class Sources:
    runs: RunService
    research: ResearchService
    bars: BarService | None
    version: tuple[int, int] | None


def _sources(request: Request) -> Sources:
    data = get_services(request)
    version = data.catalog.version(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT) if data.bars is not None else None
    return Sources(runs=get_run_service(request), research=service_for_root(request.app.state.settings.data_root),
                   bars=data.bars, version=version)


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except RunNotFound as exc:
        raise HTTPException(status_code=404, detail="unknown run id") from exc
    except UnknownNameError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SeriesUnusable as exc:
        raise HTTPException(status_code=422, detail=f"unusable run: {exc}") from exc
    except SeriesNotCompoundable as exc:
        raise HTTPException(status_code=422, detail=f"{exc}") from exc
    except BookUnusable as exc:
        raise HTTPException(status_code=422, detail=f"unusable run: {exc}") from exc
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except UnknownSeries as exc:
        raise HTTPException(status_code=503, detail=f"benchmark prices are not available: {exc}") from exc
    except (SeriesError, ResearchDataError, RunUnreadable, TradeError, CostError, ExposureError,
            run_books.ViewError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OSError as exc:  # the catalogue's stat of a processed file; the OS text would name the path
        raise HTTPException(status_code=503, detail=f"a source could not be read ({type(exc).__name__})") from exc


def _name() -> str:
    return PathParam(pattern=NAME_PATTERN, max_length=MAX_NAME)


def _run_id() -> str:
    return PathParam(max_length=MAX_RUN_ID)


def _cost() -> int:
    return Query(1, ge=0, le=MAX_COST, description="ticks per side: 0, 1 or 2 (as the screen recorded them)")


def _freq() -> Freq:
    return Query("D", description="D: one row per session; M: sessions compounded into months (P = 12)")


def _hypothesis(src: Sources, name: str, cost: int) -> SessionSeries:
    return series.hypothesis_series(src.research, name, cost, bars=src.bars, version=src.version)


def _run(src: Sources, run_id: str, freq: str) -> SessionSeries:
    built = series.run_series(src.runs, src.research, run_id, bars=src.bars, version=src.version)
    return tearsheet.to_months(built) if freq == "M" else built


@router.get("/hypothesis/{name}", response_model=Analytics)
def hypothesis_analytics(request: Request, name: str = _name(), cost: int = _cost()) -> Analytics:
    """Tear sheet of a registered hypothesis on its screen series (Basis A), with the alpha the screen recorded
    ([PRE-REG]) next to the terminal's own fit and the registry's adjusted p values."""
    with _http_errors():
        src = _sources(request)
        s = _hypothesis(src, name, cost)
        screen = src.research.detail(name).screen
        return tearsheet.build(s, Context(kind="hypothesis", name=name, cost=cost, freq="D"),
                               stored=stored_alpha.stored_fit(name, cost, screen),
                               registry=tearsheet.registry_entry(src.research.registry_rows(), name),
                               sv7=validity.sharpe_difference_tests(screen) if screen else {})


@router.get("/hypothesis/{name}/panel", response_model=HomePanel)
def hypothesis_panel(request: Request, name: str = _name(), cost: int = _cost()) -> HomePanel:
    """HOME [B] panel of a hypothesis: equity against its benchmark, with the underwater curve and the rolling
    252-session Sharpe."""
    with _http_errors():
        src = _sources(request)
        s = _hypothesis(src, name, cost)
        return tearsheet.home_panel(s, Context(kind="hypothesis", name=name, cost=cost, freq="D"))


@router.get("/run/{run_id}", response_model=Analytics)
def run_analytics(request: Request, run_id: str = _run_id(), freq: Freq = _freq()) -> Analytics:
    """Tear sheet of a Nautilus run on its account series (Basis B): snapshots, or realised P&L on every gated
    session; alpha is the terminal's own fit against the paired run or NQ buy and hold."""
    with _http_errors():
        src = _sources(request)
        s = _run(src, run_id, freq)
        return tearsheet.build(s, Context(kind="run", name=run_id, cost=None, freq=freq))


@router.get("/run/{run_id}/panel", response_model=HomePanel)
def run_panel(request: Request, run_id: str = _run_id(), freq: Freq = _freq()) -> HomePanel:
    """HOME [B] panel of a run: equity against its benchmark, with the underwater curve and the rolling
    252-session Sharpe."""
    with _http_errors():
        src = _sources(request)
        s = _run(src, run_id, freq)
        return tearsheet.home_panel(s, Context(kind="run", name=run_id, cost=None, freq=freq))


def _raw_prices(src: Sources, request: Request, book: RunBook) -> Any:
    """Raw closes for a multi-instrument book through the gate; None without a price source (fixture mode) or for a
    single-instrument run, whose own raw closes (or, failing those, the labelled snapshot price) are used."""
    if src.bars is None or len(book.instruments) < 2:
        return None
    catalog = get_services(request).catalog
    versions = {run_books.serve_symbol(i.name): catalog.version(run_books.serve_symbol(i.name), DAILY_TF,
                                                                  DAILY_VARIANT) for i in book.instruments}
    return run_books.gated_raw_prices(src.bars, book, versions=versions)


@router.get("/run/{run_id}/trades", response_model=RunTrades)
def run_trades(request: Request, run_id: str = _run_id()) -> RunTrades:
    """TA1 trade tiles, TA3 P&L by entry hour (intraday runs only), weekday and month, and TA6 real-fill slippage
    (the quote check sample and the paper book's close rows; backtest fills are modelled and get none)."""
    with _http_errors():
        src = _sources(request)
        live = run_books.live_slippage(live_monitor(request))
        return run_books.trades_view(src.runs, run_id, run_books.quote_check(src.research), live)


@router.get("/run/{run_id}/costs", response_model=RunCosts)
def run_costs(request: Request, run_id: str = _run_id()) -> RunCosts:
    """EX3 cost waterfall (net equals the run's pnl_total exactly) and EX4 cost sensitivity with break-even."""
    with _http_errors():
        src = _sources(request)
        return run_books.costs_view(run_books.load_book(src.runs, run_id))


@router.get("/run/{run_id}/exposure", response_model=RunExposure)
def run_exposure(request: Request, run_id: str = _run_id()) -> RunExposure:
    """EX1 gross and net exposure at the raw contract close and EX2 turnover per session (runs with snapshots)."""
    with _http_errors():
        src = _sources(request)
        book = run_books.load_book(src.runs, run_id)
        return run_books.exposure_view(book, _raw_prices(src, request, book))
