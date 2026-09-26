"""Trade, cost and exposure views of a Nautilus run (ANALYTICS_CATALOG TA1, TA3, TA6, EX1 to EX4; ARCHITECTURE s4).

With `analytics/series.py`, this is where analytics inputs are read through the injected services (C8); the
functions in `analytics/trades.py` and `analytics/exposure.py` stay pure:
- `load_book` reads one run (trades, fills, snapshots, closes) through the runs service, read only;
- `gated_raw_prices` reads the raw 1d closes (`c_none`) of a book's instruments through the bar service, whose
  every serve is `nq_lab.data.serve` with caller "terminal" over the fixed in-sample window; an instrument whose
  root is not a plain futures root (`ROOT_SYMBOL`) is refused before any serve, so a crafted result file cannot
  steer the gate's file path;
- `quote_check` reads `results/quote_check_v1.json` through the research file cache (read only);
- the live slippage comes from the book journal's performance rows (`journals.performance_series`): plumbing rows
  are dropped and counted, never read as performance (LV1).

The view builders turn the analytics dicts into the typed responses. TA3 groups by entry hour only for intraday
runs: a daily or sized book enters at the session close by rule (the 00:00 UTC stamps of daily books map back to
the session date in New York time, which is what makes the weekday and month groupings right), so an hour table
would show only the daylight saving offset.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab import paper_plumbing
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel
from nq_terminal.analytics import exposure, trades
from nq_terminal.analytics.exposure import BookUnusable, CostError, RunBook
from nq_terminal.models.common import MAX_LIMIT
from nq_terminal.models.run_views import (
    CostSensitivity,
    CostWaterfall,
    EntryGroups,
    ExposureView,
    RunCosts,
    RunExposure,
    RunTrades,
    SlippageView,
    TurnoverView,
)
from nq_terminal.services import journals
from nq_terminal.services.files import FileAccessError, FileDecodeError
from nq_terminal.services.stored_alpha import clean_json

if TYPE_CHECKING:
    from nq_terminal.services.bars import BarService
    from nq_terminal.services.research import ResearchService
    from nq_terminal.services.runs import RunService

PAGE = MAX_LIMIT  # the runs service's largest page
ROOT_SYMBOL = re.compile(r"[A-Z0-9]{1,6}")
DAILY_TF, DAILY_VARIANT = "1d", "vendor"
QUOTE_CHECK = "quote_check_v1.json"
POST_HOC = "[POST HOC]"
INTRADAY = "intraday"
HOUR_NOTE = "not shown: this book enters at the session close by rule, so the entry hour carries no information"
NO_SNAPSHOTS = "this run has no mark to market snapshots (an intraday run), so it has no exposure or turnover"
UNUSABLE = "balance check failed: the run is unusable (rule 4)"


class ViewError(ValueError):
    """A source a view needs could not be read (the message never carries a path)."""


# ---------------------------------------------------------------- reading through the services


def _every_row(fetch: Callable[[int, int], Any], total: int) -> list[Any]:
    """All rows of a paged runs-service section, `PAGE` at a time (the service caps one page)."""
    rows: list[Any] = []
    while len(rows) < total:
        page = fetch(len(rows), PAGE).items
        if not page:
            raise CostError(f"the runs service served {len(rows)} of {total} rows")
        rows.extend(page)
    return rows


def _usable_detail(runs: RunService, run_id: str) -> Any:
    detail = runs.detail(run_id, anchor=False)
    if detail.summary.usable is not True:
        raise BookUnusable(f"{run_id}: {UNUSABLE}")
    return detail


def load_book(runs: RunService, run_id: str) -> RunBook:
    """Read one run through the runs service (read only); `BookUnusable` for an unbalanced run (rule 4)."""
    detail = _usable_detail(runs, run_id)
    rows = _every_row(lambda offset, limit: runs.trades(run_id, offset, limit), detail.counts.trades)
    fills = _every_row(lambda offset, limit: runs.fills(run_id, offset, limit), detail.counts.fills)
    sections = detail.log_sections
    snapshots = _every_row(lambda offset, limit: runs.log(run_id, "snapshots", offset, limit),
                           sections.get("snapshots", 0))
    closes = _every_row(lambda offset, limit: runs.log(run_id, "closes", offset, limit), sections.get("closes", 0))
    return exposure.run_book(detail, rows, fills, snapshots, closes)


def serve_symbol(instrument: str) -> str:
    """The continuous 1d series of an instrument (`ES.XCME` -> `ES.V.0`); anything but a plain root is refused."""
    root = str(instrument).split(".")[0]
    if not ROOT_SYMBOL.fullmatch(root):
        raise CostError(f"instrument {instrument!r} is not a futures root the gate serves")
    return f"{root}.V.0"


def gated_raw_prices(bars: BarService, book: RunBook, *,
                     versions: Mapping[str, tuple[int, int] | None] | None = None) -> np.ndarray:
    """Raw closes (1d vendor `c_none`, as of each snapshot session) through the gate, one column per instrument."""
    symbols = [serve_symbol(inst.name) for inst in book.instruments]  # every name checked before any serve
    frames = {symbol: bars.frame(symbol, DAILY_TF, DAILY_VARIANT, IS_START, IS_END,
                                 version=(versions or {}).get(symbol)).frame for symbol in symbols}
    days = [pd.Timestamp(str(s.get("date"))).date() for s in book.snapshots]
    return np.asarray(build_panel(frames, days).N, dtype=float)


def quote_check(research: ResearchService) -> Mapping[str, Any] | None:
    """`results/quote_check_v1.json` (the 96-trade real-quote sample), or None where the root has none."""
    try:
        doc = research.cache.read_json(research.results / QUOTE_CHECK)
    except FileNotFoundError:
        return None
    except (FileDecodeError, FileAccessError) as exc:
        raise ViewError(f"{QUOTE_CHECK} could not be read ({type(exc).__name__})") from exc
    return doc if isinstance(doc, Mapping) else None


def live_slippage(monitor: journals.LiveMonitor) -> dict:
    """The book journal's close-row slippage in ticks, performance rows only (plumbing rows dropped, counted)."""
    state = monitor.journal(journals.BOOK_JOURNAL)
    if state is None:
        return {"found": False, "ticks": [], "plumbing_rows_skipped": 0}
    found = journals.performance_series(state.rows)
    return {"found": True, "ticks": found["slippage_ticks"], "plumbing_rows_skipped": found["plumbing_rows_skipped"]}


# ---------------------------------------------------------------- TA1, TA3, TA6


def _groups(rows: Sequence[Mapping[str, Any]], grouping: str) -> EntryGroups:
    return EntryGroups.model_validate(clean_json(trades.by_entry(rows, grouping)))


def trades_view(runs: RunService, run_id: str, quote: Mapping[str, Any] | None, live: Mapping[str, Any]) -> RunTrades:
    """TA1 tiles, TA3 groups and the TA6 real-fill slippage reference for one run."""
    detail = _usable_detail(runs, run_id)
    rows = [row.model_dump() for row in _every_row(lambda offset, limit: runs.trades(run_id, offset, limit),
                                                   detail.counts.trades)]
    tiles = clean_json(trades.trade_tiles(rows, detail.summary_stats))
    intraday = detail.summary.kind == INTRADAY
    slip = clean_json(trades.slippage_distribution(quote or {}, live["ticks"]))
    return RunTrades(
        run_id=run_id, kind=detail.summary.kind, tag=POST_HOC, unit=tiles["unit"], stats=tiles["stats"],
        summary=tiles["summary"], hit_rate_matches=tiles["hit_rate_matches"],
        by_hour=_groups(rows, "hour") if intraday else None, hour_note=None if intraday else HOUR_NOTE,
        by_weekday=_groups(rows, "weekday"), by_month=_groups(rows, "month"),
        slippage=SlippageView(**slip, quote_check_found=quote is not None, live_journal=journals.BOOK_JOURNAL,
                              live_journal_found=live["found"],
                              live_plumbing_rows_skipped=live["plumbing_rows_skipped"],
                              plumbing_banner=paper_plumbing.BANNER))


# ---------------------------------------------------------------- EX1 to EX4


def costs_view(book: RunBook) -> RunCosts:
    """EX3 waterfall and EX4 sensitivity of one run, checked against its own totals."""
    fall = clean_json(exposure.cost_waterfall(book))
    ladder = clean_json(exposure.cost_sensitivity(book))
    return RunCosts(run_id=book.run_id, tag=POST_HOC, waterfall=CostWaterfall.model_validate(fall),
                    sensitivity=CostSensitivity.model_validate(ladder))


def exposure_view(book: RunBook, raw_px: np.ndarray | None = None) -> RunExposure:
    """EX1 exposure and EX2 turnover per session, or an explained absence for a run without snapshots."""
    found = exposure.exposure(book, raw_px)
    if found is None:
        return RunExposure(run_id=book.run_id, tag=POST_HOC, available=False, note=NO_SNAPSHOTS, exposure=None,
                           turnover=None)
    return RunExposure(run_id=book.run_id, tag=POST_HOC, available=True, note=None,
                       exposure=ExposureView.model_validate(clean_json(found)),
                       turnover=TurnoverView.model_validate(clean_json(exposure.turnover(book, "fills", raw_px))))
