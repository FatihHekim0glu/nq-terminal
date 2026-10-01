"""GET /api/live/stream: the LIVE and JRNL data as Server-Sent Events (TASKS 9.2), strictly read only.

The stream replaces polling on LIVE and JRNL. It reads the same files through the app's one `LiveMonitor` (shared
with /api/live/*), never writes, and has no order path. Events (`event:` name = the payload's `kind`, schema in
`models.live`):

- `hello` first, with the `retry` hint; then `kill_switch` and `status` (the /api/live/status body);
- `journal_reset` (drop what is held for a file; reasons sync, new, changed, backlog, removed) and `journal_row`
  (one journal row, labelled plumbing or not by its own fields, with the exact banner on plumbing rows);
- `kill_switch` and `status` again whenever they change (status also re-checked every `status_every_s`);
- `heartbeat` every `heartbeat_s`, and `bye` when the stream's lifetime ends (the browser then reconnects).

Every event's `id:` is the journal cursor after it (`journals.encode_cursor`). A browser reconnecting after a
network drop or a server restart sends it back as `Last-Event-ID`; the new stream continues after the last row it
names only while the file still holds that row (digest check), otherwise it resets that journal. Nothing but the
id survives a restart, and nothing else is needed. An id the server did not write is not used: the stream starts
afresh and `hello.resume_note` says why.

Bounds: at most `max_streams` open streams (503 beyond, from a dependency so the refusal is a plain JSON error);
per tick at most `max_rows_per_tick` rows (the rest follow on the next tick without waiting); a journal with more
than `backlog_rows` waiting is reset with the oldest skipped; each stream ends after `lifetime_s`, so a stream
never holds a server shutdown for longer than that. A session holds only its cursor, the names it announced and
the last status it sent. File reads run in a worker thread. Same origin, loopback and security headers come from
the app's middlewares like every other route; `app.state.live_stream_limits` overrides the limits (tests).
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any

import anyio
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent

from nq_lab import paper_plumbing
from nq_terminal.api import live
from nq_terminal.models.common import ErrorDetail, error_responses
from nq_terminal.models.live import (
    STREAM_SCHEMA_VERSION,
    LiveStatus,
    LiveStreamEvent,
    ResetReason,
    StreamBye,
    StreamHeartbeat,
    StreamHello,
    StreamJournalReset,
    StreamJournalRow,
    StreamKillSwitch,
    StreamStatus,
)
from nq_terminal.services import journals

KILL_PATH = "live/KILL*"
STREAM_BASIS = ("journal rows as written, each labelled plumbing or not by its own fields; plumbing rows are never "
                "performance; status is the body of /api/live/status")
RESUME_REFUSED = "Last-Event-ID not recognised ({reason}); every journal is sent again"
BYE_REASON = "stream lifetime reached; reconnect with Last-Event-ID"
TOO_MANY = "too many live streams are open (at most {limit}); close one and retry"
STREAM_ERRORS: dict[int | str, dict[str, Any]] = {
    **error_responses(422),
    503: {"model": ErrorDetail, "description": "too many live streams are open"},
}

router = APIRouter(prefix="/api/live", tags=["live"])
_STATE_LOCK = threading.Lock()


@dataclass(frozen=True)
class StreamLimits:
    poll_s: float = 1.0
    heartbeat_s: float = 10.0
    status_every_s: float = 5.0
    lifetime_s: float = 120.0
    retry_ms: int = 2000
    max_streams: int = 8
    backlog_rows: int = 1000
    max_rows_per_tick: int = 200

    def __post_init__(self) -> None:
        low = {f.name: getattr(self, f.name) for f in fields(self) if getattr(self, f.name) <= 0}
        if low:
            raise ValueError(f"stream limits must be positive: {low}")


class StreamSlots:
    """A counter of open streams, capped at `limit` (thread safe)."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.open = 0
        self._lock = threading.Lock()

    def acquire(self) -> bool:
        with self._lock:
            if self.open >= self.limit:
                return False
            self.open += 1
            return True

    def release(self) -> None:
        with self._lock:
            self.open = max(self.open - 1, 0)


def stream_limits(app: FastAPI) -> StreamLimits:
    return getattr(app.state, "live_stream_limits", None) or StreamLimits()


def stream_slots(app: FastAPI) -> StreamSlots:
    with _STATE_LOCK:
        slots = getattr(app.state, "live_stream_slots", None)
        if slots is None:
            slots = app.state.live_stream_slots = StreamSlots(stream_limits(app).max_streams)
        return slots


def read_last_event_id(text: str | None) -> tuple[dict[str, journals.CursorEntry] | None, str | None]:
    """(cursor, None) for an id this server wrote, (None, note) for any other, (None, None) without one."""
    if text is None:
        return None, None
    try:
        return journals.parse_cursor(text), None
    except journals.CursorError as exc:
        return None, RESUME_REFUSED.format(reason=exc)


def _utc_now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class StreamSession:
    """One connection's state: what it has sent, driven by `opening` then `tick` (see the module docstring)."""

    def __init__(self, *, monitor: journals.LiveMonitor, data_root: Path, status: Callable[[], LiveStatus],
                 limits: StreamLimits, cursor: Mapping[str, journals.CursorEntry] | None = None,
                 resume_note: str | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.monitor, self.data_root, self.limits = monitor, Path(data_root), limits
        self._status, self._clock = status, clock
        self.resumed, self.resume_note = cursor is not None, resume_note
        self.cursor: dict[str, journals.CursorEntry] = dict(cursor or {})
        self.known: set[str] = set(self.cursor)  # journals the client has been told about
        self._initial = not self.resumed  # unknown journals are "sync" until the first full pass
        self._kill: bool | None = None
        self._fingerprint: tuple | None = None
        self._status_json: str | None = None
        now = clock()
        self._next_heartbeat, self._next_status = now + limits.heartbeat_s, now + limits.status_every_s

    @property
    def cursor_id(self) -> str:
        return journals.encode_cursor(self.cursor)

    def _event(self, payload: Any, retry: int | None = None) -> ServerSentEvent:
        return ServerSentEvent(event=payload.kind, id=self.cursor_id, data=payload, retry=retry)

    def opening(self) -> list[ServerSentEvent]:
        hello = StreamHello(schema_version=STREAM_SCHEMA_VERSION, resumed=self.resumed, resume_note=self.resume_note,
                            poll_s=self.limits.poll_s, heartbeat_s=self.limits.heartbeat_s,
                            lifetime_s=self.limits.lifetime_s, retry_ms=self.limits.retry_ms,
                            banner=paper_plumbing.BANNER, basis=STREAM_BASIS, read_only=True, order_path="none")
        out = [self._event(hello, retry=self.limits.retry_ms), *self._kill_events()]
        return out + self._status_events(self.monitor.journals(), force=True)

    def tick(self) -> tuple[list[ServerSentEvent], bool]:
        """The events since the last tick, and whether rows are still waiting (tick again without sleeping)."""
        found = self.monitor.journals()
        out = self._kill_events()
        rows, more = self._journal_events(found)
        out += rows + self._status_events(found) + self._heartbeat_events()
        return out, more

    def bye(self) -> ServerSentEvent:
        return self._event(StreamBye(reason=BYE_REASON, retry_ms=self.limits.retry_ms), retry=self.limits.retry_ms)

    # ------------------------------------------------------------ kill switch, status, heartbeat

    def _kill_events(self) -> list[ServerSentEvent]:
        on = journals.kill_switch_on(self.data_root)
        if on == self._kill:
            return []
        self._kill = on
        return [self._event(StreamKillSwitch(on=on, path=KILL_PATH))]

    def _fingerprint_of(self, found: Sequence[tuple[Path, journals.TailState]]) -> tuple:
        tails = tuple((p.name, len(t.rows), t.resets, len(t.bad_lines), t.partial_pending, t.mtime_ns)
                      for p, t in found)
        logs = tuple((f.name, f.size_bytes, f.mtime_ns) for f in journals.log_files(self.data_root))
        return self._kill, tails, logs, journals.today_et().isoformat()

    def _status_events(self, found: Sequence[tuple[Path, journals.TailState]],
                       force: bool = False) -> list[ServerSentEvent]:
        now, fingerprint = self._clock(), self._fingerprint_of(found)
        if not force and fingerprint == self._fingerprint and now < self._next_status:
            return []
        self._fingerprint, self._next_status = fingerprint, now + self.limits.status_every_s
        status = self._status()
        text = status.model_dump_json()
        if text == self._status_json:
            return []
        self._status_json = text
        return [self._event(StreamStatus(status=status))]

    def _heartbeat_events(self) -> list[ServerSentEvent]:
        now = self._clock()
        if now < self._next_heartbeat:
            return []
        self._next_heartbeat = now + self.limits.heartbeat_s
        return [self._event(StreamHeartbeat(utc=_utc_now(), interval_s=self.limits.heartbeat_s))]

    # ------------------------------------------------------------ journals

    def _journal_events(self, found: Sequence[tuple[Path, journals.TailState]]) -> tuple[list[ServerSentEvent], bool]:
        names = {p.name for p, _ in found}
        out = [self._removed(name) for name in sorted(self.known - names)]
        budget = self.limits.max_rows_per_tick
        for path, tail in found:
            if budget <= 0:
                return out, True
            events, sent, waiting = self._journal(path.name, tail.rows, budget)
            out += events
            budget -= sent
            if waiting:
                return out, True
        self._initial = False
        return out, False

    def _journal(self, name: str, rows: Sequence[journals.JournalRow],
                 budget: int) -> tuple[list[ServerSentEvent], int, bool]:
        """(events, rows sent, rows still waiting) for one journal."""
        start, reason = self._start(name, rows)
        if len(rows) - start > self.limits.backlog_rows:
            start, reason = len(rows) - self.limits.backlog_rows, reason or "backlog"
        out = [] if reason is None else [self._reset(name, reason, start, rows)]
        end = min(len(rows), start + budget)
        for row in rows[start:end]:
            journals.check_row_label(row)
            self.cursor[name] = journals.CursorEntry(row.line_no, journals.row_digest(row))
            out.append(self._event(StreamJournalRow(row=live._row_out(row))))
        return out, end - start, end < len(rows)

    def _start(self, name: str, rows: Sequence[journals.JournalRow]) -> tuple[int, ResetReason | None]:
        if name not in self.known:
            return 0, "sync" if self._initial else "new"
        point = journals.resume_point(rows, self.cursor.get(name))
        return (0, "changed") if point is None else (point, None)

    def _reset(self, name: str, reason: ResetReason, start: int,
               rows: Sequence[journals.JournalRow]) -> ServerSentEvent:
        self.known.add(name)
        self.cursor.pop(name, None)
        first = rows[start].line_no if start < len(rows) else None
        return self._event(StreamJournalReset(file=name, path=journals.relative_name(name), reason=reason,
                                              skipped_rows=start, first_line_no=first))

    def _removed(self, name: str) -> ServerSentEvent:
        self.known.discard(name)
        self.cursor.pop(name, None)
        return self._event(StreamJournalReset(file=name, path=journals.relative_name(name), reason="removed",
                                              skipped_rows=0, first_line_no=None))


async def run_stream(session: StreamSession, limits: StreamLimits,
                     clock: Callable[[], float] = time.monotonic) -> AsyncIterator[ServerSentEvent]:
    """The session's events until its lifetime ends, then `bye`; file reads run in a worker thread."""
    ends = clock() + limits.lifetime_s
    for event in await anyio.to_thread.run_sync(session.opening):
        yield event
    while True:  # one tick at least, so a slow opening cannot leave a stream of hello and bye alone
        events, more = await anyio.to_thread.run_sync(session.tick)
        for event in events:
            yield event
        if clock() >= ends:
            break
        if not more:
            await anyio.sleep(limits.poll_s)
    yield session.bye()


def _stream_slot(request: Request) -> Iterator[None]:
    """Holds one of the app's stream slots for the life of the response; 503 when none is free."""
    slots = stream_slots(request.app)
    if not slots.acquire():
        raise HTTPException(status_code=503, detail=TOO_MANY.format(limit=slots.limit))
    try:
        yield
    finally:
        slots.release()


@router.get("/stream", response_class=EventSourceResponse, responses=STREAM_ERRORS)
async def stream(
    request: Request,
    _slot: None = Depends(_stream_slot),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID",
                                       description="the id of the last event received; the browser sends it on "
                                                   "reconnection"),
) -> AsyncIterator[LiveStreamEvent]:
    """LIVE and JRNL as Server-Sent Events: journal rows, status and kill switch changes, heartbeats; read only."""
    limits = stream_limits(request.app)
    cursor, note = read_last_event_id(last_event_id)
    session = StreamSession(monitor=live.live_monitor(request), data_root=request.app.state.settings.data_root,
                            status=lambda: live.status(request), limits=limits, cursor=cursor, resume_note=note)
    async for event in run_stream(session, limits):
        yield event
