"""P1 trade-path and live tracking views (ANALYTICS_CATALOG TA2 and LV5). No formula lives here.

- TA2: the run's trades through the runs service (`run_books.load_book`, read only; an unbalanced run is refused,
  rule 4) and its own 1-minute bars through the bar service, whose every serve is `nq_lab.data.serve` with caller
  "terminal" over in-sample years only (the gate refuses anything else). Intraday runs only: the series is the run's
  instrument root as a continuous back-adjusted series (`NQ.V.0` for the NQ intraday books) in the variant the run
  was fed (`data.variant`), the same price basis its fills were recorded on. `analytics/excursions.py` computes.
- LV5: the paper book journal's performance rows (`paper_plumbing.performance_rows`, then `check_no_plumbing`, so a
  plumbing row can never reach the series) into `analytics/tracking.py`, at the MNQ multiplier the book uses.
"""
from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING, Any

import pandas as pd

from nq_lab import paper_plumbing
from nq_lab.config import IS_END, IS_START
from nq_lab.live_guards import MNQ_POINT_VALUE
from nq_terminal.analytics import excursions, exposure, tracking
from nq_terminal.models.analytics_p1 import ExcursionRow, PaperTracking, RunExcursions
from nq_terminal.services import journals, run_books
from nq_terminal.services.bars import VARIANTS
from nq_terminal.services.stored_alpha import clean_json

if TYPE_CHECKING:
    from nq_terminal.services.bars import BarService
    from nq_terminal.services.runs import RunService

POST_HOC = "[POST HOC]"
MINUTE_TF = "1m"
INTRADAY = "intraday"
ONE_NQ_ROOT = "NQ"
NOT_INTRADAY = "MAE and MFE are shown for intraday runs only (their trades live inside the 1-minute bars)"
NO_PRICES = "no price source is configured, so the 1-minute bars cannot be read"
BASIS = "performance rows only (plumbing rows dropped)"
OFF_BASIS = ("not shown: {off} of {checked} trades have a fill outside the 1-minute bars it could have happened in "
             "(more than one tick away), so the served bars are on another price basis than the fills")


class ExcursionSourceError(ValueError):
    """The run names a data variant the gate does not serve."""


def _empty(run_id: str, note: str, point_value: float | None = None, **found: Any) -> RunExcursions:
    base = {"symbol": None, "variant": None, "tick": None, "basis_checked": 0, "off_basis": 0}
    return RunExcursions(run_id=run_id, tag=POST_HOC, available=False, note=note, label=excursions.LABEL,
                         unit="points from the entry fill", point_value=point_value, n=0, no_bars=0, in_r=0, rows=[],
                         **{**base, **found})


def off_basis(found: dict) -> bool:
    """Too many fills lie outside their bars for the bars to be on the fills' price basis."""
    return found["off_basis"] > excursions.MAX_OFF_BASIS_SHARE * found["basis_checked"]


def instrument_root(name: str) -> str:
    """The futures root of a book's instrument: `ONE_NQ` (the intraday books' one contract) is NQ; a venue name
    (`NQ.XCME`) keeps its own root, which `run_books.serve_symbol` then checks."""
    return ONE_NQ_ROOT if name == exposure.ONE_NQ else name


def _window(rows: Any) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Whole UTC days from the first entry to the day after the last exit, clamped to the in-sample window."""
    entries = pd.to_datetime([r["entry_ts"] for r in rows], utc=True)
    exits = pd.to_datetime([r["exit_ts"] for r in rows], utc=True)
    start = max(entries.min().floor("D"), IS_START)
    end = min(exits.max().floor("D") + pd.Timedelta(days=1), IS_END)
    return start, end


def excursions_view(runs: RunService, bars: BarService | None, run_id: str, *,
                    version: Any = None) -> RunExcursions:
    """TA2 for one run, or an explained absence (not an intraday run; no price source; no trades)."""
    detail = runs.detail(run_id, anchor=False)
    if detail.summary.kind != INTRADAY:
        return _empty(run_id, NOT_INTRADAY)
    book = run_books.load_book(runs, run_id)
    point_value = float(book.instruments[0].multiplier)
    if bars is None:
        return _empty(run_id, NO_PRICES, point_value)
    if not book.trades:
        return _empty(run_id, "the run has no trades", point_value)
    variant = str((detail.data or {}).get("variant", ""))
    if variant not in VARIANTS:
        raise ExcursionSourceError(f"{run_id} names data variant {variant!r}, which the gate does not serve")
    symbol = run_books.serve_symbol(instrument_root(book.instruments[0].name))
    start, end = _window(book.trades)
    frame = bars.frame(symbol, MINUTE_TF, variant, start, end, version=version(symbol, variant) if version else None)
    tick = float(book.instruments[0].tick_size)
    found = clean_json(excursions.excursions(book.trades, frame.frame, point_value=point_value, tick=tick))
    counts = {"basis_checked": found["basis_checked"], "off_basis": found["off_basis"]}
    if off_basis(found):
        return _empty(run_id, OFF_BASIS.format(off=found["off_basis"], checked=found["basis_checked"]), point_value,
                      symbol=symbol, variant=variant, tick=tick, **counts)
    return RunExcursions(run_id=run_id, tag=POST_HOC, available=True, note=None, label=found["label"],
                         unit=found["unit"], symbol=symbol, variant=variant, point_value=point_value, tick=tick,
                         n=found["n"], no_bars=found["no_bars"], in_r=found["in_r"], **counts,
                         rows=[ExcursionRow.model_validate(row) for row in found["rows"]])


def _midnight_utc(date: str) -> int | None:
    """Epoch seconds at 00:00 UTC of an ISO session date (the charts' axis); None for anything else."""
    try:
        return int(dt.datetime.combine(dt.date.fromisoformat(date[:10]), dt.time(), dt.timezone.utc).timestamp())
    except ValueError:
        return None


def paper_tracking_view(monitor: journals.LiveMonitor, file: str) -> PaperTracking:
    """LV5 over one journal's performance rows; an absent expected journal gives the empty state."""
    tail = monitor.journal(file)
    present = tail is not None
    data = [row.data for row in tail.rows] if present else []
    kept = paper_plumbing.performance_rows(data)
    journals.check_no_plumbing(kept)
    found = clean_json(tracking.paper_tracking(kept, MNQ_POINT_VALUE))
    t = [_midnight_utc(d) for d in found["date"]]
    return PaperTracking(journal=file, present=present, empty_state=None if present else journals.empty_state(file),
                         banner=paper_plumbing.BANNER, basis=BASIS, tag=POST_HOC, label=found["label"],
                         unit=found["unit"], multiplier=found["multiplier"],
                         plumbing_rows_skipped=len(data) - len(kept), t=t, date=found["date"], paper=found["paper"],
                         model=found["model"], difference=found["difference"],
                         paper_cumulative=found["paper_cumulative"], model_cumulative=found["model_cumulative"],
                         n=found["n"], total_difference=found["total_difference"],
                         tracking_sd=found["tracking_sd"])
