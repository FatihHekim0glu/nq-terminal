"""Analytics endpoints (ARCHITECTURE s4 Analytics; TASKS 3.3; UI_SPEC s7 tear sheet and HOME [B]). GET only.

- `/api/analytics/hypothesis/{name}?cost=` and `/api/analytics/run/{run_id}?freq=D|M`: the tear sheet (EQ, DD, RET,
  RR, MRET tabs; the KPI row; the relative and validity blocks).
- `.../panel`: the HOME [B] panel (equity against the benchmark; underwater; rolling Sharpe, long window).
- `/api/analytics/run/{run_id}/trades`, `/costs` and `/exposure`: TA1, TA3 and TA6; EX3 and EX4; EX1 and EX2 of a
  Nautilus run, apart from the tear sheet so it stays light (`services/run_books.py`). Raw prices for a book's
  exposure only through the bar service (caller "terminal", the in-sample window); TA6 from
  `results/quote_check_v1.json` (read only) and the paper book journal's performance rows (plumbing rows dropped).

P1 (TASKS Phase 10), all GET and all descriptive "[POST HOC]":
- `.../extended` (hypothesis or run): PF7 to PF9 tiles, RK3, RL3, RL4, BR3, BR4, RD4, RK5 (frozen windows; the spent
  2022 row only for the volmanaged_v0 hypothesis, from the sealed allowlist) and RG1 (the realised variance
  `sigma2` of `results/screens/volmanaged_v0_daily.csv`, read only);
- `.../bootstrap` (hypothesis or run): SV5 intervals and the SV6 cone (fixed seed, 10,000 replications);
- `/api/analytics/deflated`: SV3 over every registered hypothesis at 1 tick (SV3a; no bar service, no gate read);
  one trial that cannot be built refuses the whole view (503 naming it);
- `/api/analytics/run/{run_id}/excursions`: TA2 over the run's own 1-minute bars through the gate (intraday runs);
- `/api/analytics/run/{run_id}/trade-paths`: TA4 holding times and TA5 streaks over the whole trade list;
- `/api/analytics/paper-tracking?file=`: LV5 over a journal's performance rows (plumbing rows never reach it).

Series come from `analytics/series.py` (stage A) over the shared runs and research services; prices only through
the data router's `BarService`, whose every serve is `nq_lab.data.serve` with caller "terminal". In fixture mode
without an injected serve there is no price source, so series that need NQ as a benchmark simply have none.

Errors: an unknown name, run or unrecorded cost is 404; a run that failed its balance check is 422 (rule 4: it is
unusable and gets no analytics), and so is an account whose equity reaches zero or below (it cannot compound; the
detail names the first such session); a window the gate refuses is 403; a missing or inconsistent source is 503.
No detail carries a path.

Result cache (D1.3): the two bootstrap routes and `/api/analytics/deflated` answer from `services/result_cache.py`
through `cached_hypothesis_bootstrap`, `cached_run_bootstrap` and `cached_deflated`, which the HOME prewarm calls too.
`sources_for(state)` builds the shared services from `app.state`. Every other route here is computed on each request.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator, Mapping

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi import Path as PathParam
from fastapi.responses import Response

from nq_terminal import constants
from nq_terminal.analytics import deflated, series, validity
from nq_terminal.analytics.exposure import BookUnusable, CostError, ExposureError, RunBook
from nq_terminal.analytics.series import SeriesError, SeriesNotCompoundable, SeriesUnusable, SessionSeries
from nq_terminal.analytics.tracking import TrackingError
from nq_terminal.analytics.trades import TradeError
from nq_terminal.api.data import DAILY_TF, DAILY_VARIANT, get_result_cache, get_services, json_response, services_for
from nq_terminal.api.live import live_monitor
from nq_terminal.api.research import MAX_COST, MAX_NAME, NAME_PATTERN
from nq_terminal.api.runs import run_service_for
from nq_terminal.models.analytics import Analytics, Context, Freq, HomePanel
from nq_terminal.models.analytics_p1 import BootstrapView, DeflatedView, ExtendedAnalytics, PaperTracking, RunExcursions
from nq_terminal.models.common import error_responses
from nq_terminal.models.run_views import RunCosts, RunExposure, RunTradePaths, RunTrades
from nq_terminal.services import (
    journals,
    result_cache,
    run_books,
    stored_alpha,
    tearsheet,
    tearsheet_extended,
    tearsheet_trades,
)
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


def sources_for(state: Any) -> Sources:
    """The shared services of an app (the prewarm calls this with `app.state`; a route with `request.app.state`)."""
    data = services_for(state)
    version = data.catalog.version(NQ_SYMBOL, DAILY_TF, DAILY_VARIANT) if data.bars is not None else None
    return Sources(runs=run_service_for(state), research=service_for_root(state.settings.data_root),
                   bars=data.bars, version=version)


def _sources(request: Request) -> Sources:
    return sources_for(request.app.state)


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
            run_books.ViewError, tearsheet_trades.ExcursionSourceError, TrackingError,
            journals.PlumbingLeakError) as exc:
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
        screen = src.research.detail(name).screen
        return tearsheet.home_panel(s, Context(kind="hypothesis", name=name, cost=cost, freq="D"),
                                    stored=stored_alpha.stored_fit(name, cost, screen))


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


# ---------------------------------------------------------------- P1 (TASKS Phase 10)

RV_FILE, RV_COLUMN = "volmanaged_v0_daily.csv", "sigma2"
MAX_JOURNAL_NAME = 160


def _realised_variance(research: ResearchService) -> pd.Series | None:
    """RG1's variable as the sizing screen recorded it (read only); None when the file or column is missing."""
    try:
        frame = research.cache.read_csv(research.screens / RV_FILE)
    except (FileNotFoundError, ValueError, OSError):
        return None
    if frame is None or RV_COLUMN not in frame.columns or "date" not in frame.columns:
        return None
    rv = pd.Series(pd.to_numeric(frame[RV_COLUMN], errors="coerce").to_numpy(),
                   index=pd.DatetimeIndex(pd.to_datetime(frame["date"])), dtype=float).dropna()
    return rv if len(rv) else None


Spent = tuple[pd.Series, pd.Series | None]


def _spent(research: ResearchService, name: str, cost: int) -> tuple[Spent | None, str | None]:
    """RK5's 2022 row for the parent hypothesis: the sealed daily file through the research allowlist.

    Returns the series (or None) and, when the parent's file is not there, the note that says so: the spent row is
    one optional row of the stress table, so a missing file drops that row and never the rest of the P1 view."""
    if name != constants.STRESS_SPENT_PARENT:
        return None, None
    try:
        values = research.sealed(constants.STRESS_SPENT_FILE).values or {}
    except UnknownNameError:
        return None, tearsheet_extended.SPENT_MISSING.format(file=constants.STRESS_SPENT_FILE)
    r_col, b_col = f"r_m_{cost}", f"r_bh_{cost}"
    if r_col not in values or "date" not in values or "variant" not in values:
        return None, None
    frame = pd.DataFrame({"date": values["date"], "variant": values["variant"], "r": values[r_col],
                          "b": values.get(b_col, [None] * len(values["date"]))})
    frame = frame[(frame["variant"] == constants.STRESS_SPENT_VARIANT) & frame["r"].notna()]
    index = pd.DatetimeIndex(pd.to_datetime(frame["date"]))
    return (pd.Series(pd.to_numeric(frame["r"]).to_numpy(dtype=float), index=index),
            pd.Series(pd.to_numeric(frame["b"], errors="coerce").to_numpy(dtype=float), index=index)), None


@router.get("/hypothesis/{name}/extended", response_model=ExtendedAnalytics)
def hypothesis_extended(request: Request, name: str = _name(), cost: int = _cost()) -> ExtendedAnalytics:
    """P1 views of a hypothesis's screen series: PF7 to PF9, RK3, RL3, RL4, BR3, BR4, RD4, RK5 and RG1."""
    with _http_errors():
        src = _sources(request)
        s = _hypothesis(src, name, cost)
        spent, spent_note = _spent(src.research, name, cost)
        return tearsheet_extended.extended(s, Context(kind="hypothesis", name=name, cost=cost, freq="D"),
                                           rv=_realised_variance(src.research), spent=spent, spent_note=spent_note)


@router.get("/run/{run_id}/extended", response_model=ExtendedAnalytics)
def run_extended(request: Request, run_id: str = _run_id(), freq: Freq = _freq()) -> ExtendedAnalytics:
    """P1 views of a Nautilus run's account series (no spent row: the sealed file belongs to a hypothesis)."""
    with _http_errors():
        src = _sources(request)
        s = _run(src, run_id, freq)
        return tearsheet_extended.extended(s, Context(kind="run", name=run_id, cost=None, freq=freq),
                                           rv=_realised_variance(src.research))


def _bootstrap(s: SessionSeries, context: Context) -> BootstrapView:
    try:
        return tearsheet_extended.bootstrap_view(s, context)
    except ValueError as exc:  # too few sessions or no spread: the series has no bootstrap
        raise HTTPException(status_code=422, detail=f"no bootstrap for this series: {exc}") from exc


def cached_hypothesis_bootstrap(state: Any, query: Mapping[str, Any]) -> bytes:
    """The serialised SV5 and SV6 body of a hypothesis (`name`, `cost`, default 1) through the result cache; the
    route and the prewarm both call it. In memory only: a hypothesis without a recorded benchmark is benchmarked
    against NQ prices from the gate."""
    name, cost = query["name"], int(query.get("cost", 1))

    def compute() -> bytes:
        with _http_errors():
            s = _hypothesis(sources_for(state), name, cost)
        return result_cache.json_body(_bootstrap(s, Context(kind="hypothesis", name=name, cost=cost, freq="D")))

    return get_result_cache(state).get(result_cache.ROUTE_HYPOTHESIS_BOOTSTRAP, {"name": name, "cost": cost}, compute)


@router.get("/hypothesis/{name}/bootstrap", response_model=BootstrapView)
def hypothesis_bootstrap(request: Request, name: str = _name(), cost: int = _cost()) -> Response:
    """SV5 bootstrap intervals (Sharpe, CAGR, max drawdown) and the SV6 cone of a hypothesis's series."""
    return json_response(cached_hypothesis_bootstrap(request.app.state, {"name": name, "cost": cost}))


def cached_run_bootstrap(state: Any, query: Mapping[str, Any]) -> bytes:
    """The serialised SV5 and SV6 body of a run (`run_id`, `freq`, default D) through the result cache; the route and
    the prewarm both call it."""
    run_id, freq = query["run_id"], query.get("freq", "D")

    def compute() -> bytes:
        with _http_errors():
            s = _run(sources_for(state), run_id, freq)
        return result_cache.json_body(_bootstrap(s, Context(kind="run", name=run_id, cost=None, freq=freq)))

    return get_result_cache(state).get(result_cache.ROUTE_RUN_BOOTSTRAP, {"run_id": run_id, "freq": freq}, compute)


@router.get("/run/{run_id}/bootstrap", response_model=BootstrapView)
def run_bootstrap(request: Request, run_id: str = _run_id(), freq: Freq = _freq()) -> Response:
    """SV5 bootstrap intervals and the SV6 cone of a Nautilus run's account series."""
    return json_response(cached_run_bootstrap(request.app.state, {"run_id": run_id, "freq": freq}))


def registry_trials(research: ResearchService) -> list[deflated.Trial]:
    """SV3a steps 1 and 2: every registered hypothesis's Basis A series at 1 tick, no bar service (no gate read)."""
    trials = []
    for row in research.registry_rows():
        if not row.registered:
            continue
        try:
            s = series.hypothesis_series(research, row.name, deflated.COST)
        except (SeriesError, ResearchDataError, UnknownNameError) as exc:
            raise HTTPException(status_code=503, detail=f"the Deflated Sharpe needs every registered trial; "
                                                        f"{row.name} could not be built: {exc}") from exc
        trials.append(deflated.Trial(name=row.name, kind=s.kind, periods=s.periods, r=s.r))
    return trials


def cached_deflated(state: Any, query: Mapping[str, Any] | None = None) -> bytes:
    """The serialised SV3 body through the result cache (disk too: no bar service, no gate read); the route and the
    prewarm both call it."""

    def compute() -> bytes:
        with _http_errors():
            trials = registry_trials(service_for_root(state.settings.data_root))
            try:
                return result_cache.json_body(tearsheet_extended.deflated_view(trials))
            except ValueError as exc:
                detail = f"the Deflated Sharpe could not be computed: {exc}"
                raise HTTPException(status_code=503, detail=detail) from exc

    return get_result_cache(state).get(result_cache.ROUTE_DEFLATED, {}, compute, price_free=True)


@router.get("/deflated", response_model=DeflatedView)
def deflated_sharpe(request: Request) -> Response:
    """SV3 Deflated Sharpe over the registered hypotheses on the common Basis A daily construction (SV3a); an extra
    view only, never a verdict."""
    return json_response(cached_deflated(request.app.state))


@router.get("/run/{run_id}/trade-paths", response_model=RunTradePaths)
def run_trade_paths(request: Request, run_id: str = _run_id()) -> RunTradePaths:
    """TA4 holding times (log histogram) and TA5 streaks with the runs test over the whole trade list."""
    with _http_errors():
        return run_books.trade_paths_view(_sources(request).runs, run_id)


@router.get("/run/{run_id}/excursions", response_model=RunExcursions)
def run_excursions(request: Request, run_id: str = _run_id()) -> RunExcursions:
    """TA2 MAE and MFE per trade over the run's own 1-minute bars (intraday runs), read through the gate."""
    with _http_errors():
        src = _sources(request)
        catalog = get_services(request).catalog

        def version(symbol: str, variant: str) -> tuple[int, int] | None:
            return catalog.version(symbol, tearsheet_trades.MINUTE_TF, variant)

        return tearsheet_trades.excursions_view(src.runs, src.bars, run_id, version=version)


@router.get("/paper-tracking", response_model=PaperTracking)
def paper_tracking(
    request: Request,
    file: str = Query(default=journals.BOOK_JOURNAL, max_length=MAX_JOURNAL_NAME),
) -> PaperTracking:
    """LV5: daily paper P&L against the rule's target on the same closes; plumbing rows never reach it."""
    monitor = live_monitor(request)
    if monitor.journal(file) is None and file not in journals.EXPECTED_JOURNALS:
        raise HTTPException(status_code=404, detail=journals.NO_JOURNAL)
    with _http_errors():
        return tearsheet_trades.paper_tracking_view(monitor, file)
