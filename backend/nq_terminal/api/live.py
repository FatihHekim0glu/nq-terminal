"""Live endpoints, strictly read only (GET): paper book status, journals, Nautilus logs and the performance path.

There is no IB client and no order path: every value comes from files the paper book writes under
`<data root>/live/` and from this process's environment (reported as set or unset, the account masked). The kill
switch is read with `live_guards.kill_switch_on` and never touched.

- `/api/live/status`: journals discovered under `live/logs/*.jsonl` with row counts by class, the Nautilus logs
  (`live/logs/*.log`, the names `/api/live/log` accepts), the expected journals with their empty-state text, kill
  switch, `exposure_summary` of the book journal, the last performance close and the book's `halted` flag (from
  that close row only, so a plumbing or preflight journal cannot mark the book halted), env, and the next decision
  and order times with the MNQ roll date.
- `/api/live/journal?file=&type=&limit=&offset=`: rows with `plumbing` (by row, `paper_plumbing.is_plumbing`) and
  the exact `BANNER` on plumbing rows; without `file`, every journal merged.
- `/api/live/log?file=&tail=`: parsed Nautilus log lines, account ids masked.
- `/api/live/performance?file=`: target against actual over performance rows only (plumbing rows dropped).
- `/api/live/routes?file=`: LIVE's routes (one per close row) and fills (the close rows' `fills`), every row
  labelled plumbing or not, the totals over performance rows only (`services.live_routes`).

`file` is matched against the discovered listing by name; a name that was not discovered gives 404.
"""
from __future__ import annotations

import datetime as dt
import os
import threading
from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Query, Request

from nq_lab import paper_plumbing
from nq_lab.live_guards import MNQ_POINT_VALUE
from nq_terminal.models.common import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    Page,
    error_responses,
    paginate,
)
from nq_terminal.models.live import (
    ExpectedJournal,
    ExposureSummary,
    JournalInfo,
    JournalRowOut,
    LastClose,
    LiveEnv,
    LiveRoutes,
    LiveStatus,
    LogFileInfo,
    LogLineOut,
    LogTail,
    NextTimes,
    Performance,
)
from nq_terminal.services import journals, live_routes
from nq_terminal.services.files import FileAccessError, FileCache, thaw
from nq_terminal.settings import Settings

router = APIRouter(prefix="/api/live", tags=["live"], responses=error_responses(404, 413, 422))

_LOCK = threading.Lock()
MAX_NAME_CHARS = 160
MAX_TYPE_CHARS = 40
DEFAULT_TAIL = 500
LOG_NOTE = "IB account ids are masked"
PERFORMANCE_BASIS = "performance rows only (plumbing rows dropped)"
ROUTES_BASIS = ("journal close rows: one route per row, fills as the book counted them; every row labelled, totals "
                "over performance rows only")


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _state(request: Request, key: str, build):
    state = request.app.state
    with _LOCK:
        value = getattr(state, key, None)
        if value is None:
            value = build()
            setattr(state, key, value)
    return value


def _monitor(request: Request) -> journals.LiveMonitor:
    return _state(request, "live_monitor", lambda: journals.LiveMonitor(_settings(request).data_root))


def live_monitor(request: Request) -> journals.LiveMonitor:
    """The app's one journal monitor (shared with the analytics trade view's live slippage rows)."""
    return _monitor(request)


def _files(request: Request) -> FileCache:
    return _state(request, "live_files", lambda: FileCache(roots=(_settings(request).data_root,)))


def _utc(mtime_ns: int | None) -> str | None:
    if mtime_ns is None:
        return None
    stamp = dt.datetime.fromtimestamp(mtime_ns / 1e9, tz=dt.timezone.utc)
    return stamp.isoformat(timespec="seconds").replace("+00:00", "Z")


def _info(name: str, tail: journals.TailState) -> JournalInfo:
    plumbing = sum(1 for r in tail.rows if r.plumbing)
    last = tail.rows[-1].data if tail.rows else {}
    halted = last.get("halted")
    return JournalInfo(
        name=name, path=journals.relative_name(name), rows=len(tail.rows), plumbing_rows=plumbing,
        performance_rows=len(tail.rows) - plumbing, plumbing=bool(tail.rows) and plumbing == len(tail.rows),
        bad_lines=len(tail.bad_lines), partial_line_pending=tail.partial_pending,
        last_type=last.get("type"), last_date=last.get("date"), last_row_utc=_utc(tail.mtime_ns),
        last_halted=halted if isinstance(halted, bool) else None,
    )


def _expected(present: set[str]) -> list[ExpectedJournal]:
    return [ExpectedJournal(name=n, path=journals.relative_name(n), present=n in present,
                            empty_state=None if n in present else journals.empty_state(n))
            for n in journals.EXPECTED_JOURNALS]


def _last_close(row: Mapping[str, Any]) -> LastClose:
    fields = journals.close_fields(row, {**journals.CLOSE_FIELDS, **journals.LAST_CLOSE_EXTRA})
    return LastClose(**fields, data=thaw(row))


def _exposure(monitor: journals.LiveMonitor) -> ExposureSummary | None:
    path = journals.find(monitor.folder, journals.JOURNAL_SUFFIX, journals.BOOK_JOURNAL)
    summary = journals.exposure(path) if path is not None else None
    return None if summary is None else ExposureSummary(journal=journals.BOOK_JOURNAL, **summary)


@router.get("/status", response_model=LiveStatus)
def status(request: Request) -> LiveStatus:
    """Journal counts, the kill switch, book exposure and last close; env; the next session's times and roll date."""
    monitor = _monitor(request)
    found = monitor.journals()
    tails = {p.name: t for p, t in found}
    book = tails.get(journals.BOOK_JOURNAL)
    close = journals.last_close(book.rows) if book is not None else None
    halted = close.get("halted") if close is not None else None
    return LiveStatus(
        journals=[_info(p.name, t) for p, t in found],
        logs=[LogFileInfo(name=f.name, path=journals.relative_name(f.name), size_bytes=f.size_bytes,
                          modified_utc=_utc(f.mtime_ns), plumbing=f.plumbing)
              for f in journals.log_files(_settings(request).data_root)],
        expected=_expected(set(tails)),
        kill_switch_on=journals.kill_switch_on(_settings(request).data_root),
        kill_switch_path="live/KILL*",
        exposure_summary=_exposure(monitor),
        last_close=None if close is None else _last_close(close),
        halted=halted if isinstance(halted, bool) else None,
        env=LiveEnv(**journals.live_env(os.environ)),
        next=NextTimes(**journals.next_times(journals.today_et())),
        banner=paper_plumbing.BANNER,
        read_only=True,
        order_path="none",
        tws="not monitored",
    )


def _row_out(row: journals.JournalRow) -> JournalRowOut:
    return JournalRowOut(file=row.file, line_no=row.line_no, plumbing=row.plumbing,
                         banner=paper_plumbing.BANNER if row.plumbing else None, data=thaw(row.data))


def _rows(monitor: journals.LiveMonitor, file: str | None) -> list[journals.JournalRow]:
    if file is None:
        return [r for _, t in monitor.journals() for r in t.rows]
    tail = monitor.journal(file)
    if tail is None:
        raise HTTPException(status_code=404, detail=journals.NO_JOURNAL)
    return list(tail.rows)


@router.get("/journal", response_model=Page[JournalRowOut])
def journal(
    request: Request,
    file: str | None = Query(default=None, max_length=MAX_NAME_CHARS),
    row_type: str | None = Query(default=None, alias="type", max_length=MAX_TYPE_CHARS),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> Page[JournalRowOut]:
    """Journal rows, oldest first, each with its plumbing class and the banner on plumbing rows."""
    rows = [r for r in _rows(_monitor(request), file) if row_type is None or r.data.get("type") == row_type]
    return paginate([_row_out(r) for r in rows], offset, limit)


@router.get("/log", response_model=LogTail)
def log(
    request: Request,
    file: str = Query(max_length=MAX_NAME_CHARS),
    tail: int = Query(default=DEFAULT_TAIL, ge=1, le=MAX_LIMIT),
) -> LogTail:
    """The last `tail` lines of a Nautilus log from live/logs, parsed, with IB account ids masked."""
    path = _monitor(request).log_path(file)
    if path is None:
        raise HTTPException(status_code=404, detail=journals.NO_LOG)
    try:
        text = _files(request).read_text(path, errors="replace")
    except FileAccessError as exc:
        raise HTTPException(status_code=413, detail=f"{path.name} is too large to show") from exc
    lines = journals.parse_log_text(text, tail, known=(os.environ.get("IB_ACCOUNT_ID"),))
    total = sum(1 for line in text.split("\n") if line.strip())
    return LogTail(file=path.name, path=journals.relative_name(path.name), total_lines=total,
                   lines=[LogLineOut(**vars(x)) for x in lines], note=LOG_NOTE)


@router.get("/performance", response_model=Performance)
def performance(
    request: Request,
    file: str = Query(default=journals.BOOK_JOURNAL, max_length=MAX_NAME_CHARS),
) -> Performance:
    """Target against actual from one journal's performance rows; plumbing rows never reach it."""
    tail = _monitor(request).journal(file)
    present = tail is not None
    if not present and file not in journals.EXPECTED_JOURNALS:
        raise HTTPException(status_code=404, detail=journals.NO_JOURNAL)
    series = journals.performance_series(tail.rows if present else ())
    return Performance(journal=file, present=present, empty_state=None if present else journals.empty_state(file),
                       basis=PERFORMANCE_BASIS, banner=paper_plumbing.BANNER, **series)


@router.get("/routes", response_model=LiveRoutes)
def routes(
    request: Request,
    file: str = Query(default=journals.BOOK_JOURNAL, max_length=MAX_NAME_CHARS),
) -> LiveRoutes:
    """Routes and fills from one journal's close rows, read only; plumbing rows labelled and out of the totals."""
    tail = _monitor(request).journal(file)
    present = tail is not None
    if not present and file not in journals.EXPECTED_JOURNALS:
        raise HTTPException(status_code=404, detail=journals.NO_JOURNAL)
    found = live_routes.routes_and_fills(tail.rows if present else ())
    return LiveRoutes(journal=file, present=present, empty_state=None if present else journals.empty_state(file),
                      banner=paper_plumbing.BANNER, basis=ROUTES_BASIS, order_time_rule=live_routes.ORDER_TIME_RULE,
                      point_value_usd=MNQ_POINT_VALUE, **found)
