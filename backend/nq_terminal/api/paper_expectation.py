"""LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13): `GET /api/analytics/paper-expectation?file=`. GET only.

The paper book's and the rule's cumulative P&L as a fraction of K, placed on the backtest-start cone (the SV6 cone of
the hypothesis that owns the journal) and on the live-start cone (SV6's resampling of the paper book's own sessions),
served by `services/paper_expectation.py` over `analytics/expectation.py`. [POST HOC], descriptive.

A journal the monitor does not know and that is not an expected one is 404, as on `/paper-tracking`, and the detail
never echoes the name asked for. A refusal that is part of the reading (no value yet, no linked run, a short paper
book) is a 200 with its code; a source that cannot be read is 503 (the shared analytics error map). No price is read:
the hypothesis's series and the run's capital are built without the bar service (a bar service only adds a
benchmark, which neither cone uses), so the route makes no gate read and writes nothing.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from nq_terminal.analytics import series
from nq_terminal.api.analytics import MAX_JOURNAL_NAME, _http_errors
from nq_terminal.api.live import live_monitor
from nq_terminal.api.runs import get_run_service
from nq_terminal.models.common import error_responses
from nq_terminal.models.expectation import PaperExpectation
from nq_terminal.services import journals, paper_expectation
from nq_terminal.services.research import service_for_root

PATH = "/paper-expectation"
router = APIRouter(prefix="/api/analytics", tags=["analytics"], responses=error_responses(404, 503))


@router.get(PATH, response_model=PaperExpectation)
def paper_expectation_view(
    request: Request,
    file: str = Query(default=journals.BOOK_JOURNAL, max_length=MAX_JOURNAL_NAME),
) -> PaperExpectation:
    """LV6 and LV6b: the paper and model paths on the backtest-start and the live-start cones, [POST HOC]."""
    monitor = live_monitor(request)
    if monitor.journal(file) is None and file not in journals.EXPECTED_JOURNALS:
        raise HTTPException(status_code=404, detail=journals.NO_JOURNAL)
    with _http_errors():
        research = service_for_root(request.app.state.settings.data_root)
        runs = get_run_service(request)

        def hypothesis_series(name: str, cost: int) -> series.SessionSeries:
            return series.hypothesis_series(research, name, cost)  # no bar service: the benchmark is unused

        def run_series(run_id: str) -> series.SessionSeries:
            return series.run_series(runs, research, run_id)  # K is the starting balance: no price needed

        return paper_expectation.expectation_view(
            monitor, file, card=research.card, run_summaries=runs.summaries,
            run_capital=paper_expectation.run_capital(run_series), hypothesis_series=hypothesis_series)
