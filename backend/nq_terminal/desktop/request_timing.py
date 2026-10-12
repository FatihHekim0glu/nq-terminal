"""Per-request timing in the HOME window (startup.md 11.3): one line per request while the HOME tasks stage runs.

A pure ASGI middleware, registered by `app.create_app` through `install`. While its `TimingWindow` is active it writes
one INFO line per HTTP request to the `nq_terminal.request_timing` logger, which the prewarm's `ensure_log_lines` points
at stderr, that is, into backend.log:

    request timing: GET /api/runs status=200 start=812.401233 end=812.652011 wall_ms=250.8 event_loop_cpu_ms=3.1
    process_cpu_ms=204.7

- the path only: never the query string (it carries launch codes, symbols and session values) and, for a hostile path,
  never a raw control character (`ascii()` escapes it) or more than `MAX_PATH_CHARS` characters;
- `start` and `end` on the monotonic clock, in seconds, so they line up with the prewarm's own monotonic lines. On
  Windows Python 3.12 that clock ticks every 15.6 ms, so a fast request can read start == end;
- `wall_ms` comes from `time.perf_counter()` (QueryPerformanceCounter, 100 ns), taken at the same two points, so it is
  not quantised and is the figure to read for a duration;
- `event_loop_cpu_ms`: CPU the event-loop thread spent while the request was open. It is NOT the request's own CPU: a
  synchronous (`def`) route and its serialisation run on a worker thread and never show here, while every other
  coroutine and request the loop ran meanwhile does. `process_cpu_ms` is the whole process's CPU over the request, which
  includes whatever else ran at the same time (the prewarm thread, other requests). Both are load figures; neither
  places the GIL time of one request, so read neither as per-request CPU. On Windows both CPU
  clocks advance in scheduler ticks of about 15.6 ms, so a value below that is 0.0 or one tick, never a fine reading.

The window is open from `install` when the process prewarms (a desktop or launcher process, `prewarm_enabled`), and
closes at the first of: `close_window(app)` (the prewarm's stage hook calls it when the HOME tasks stage ends), the
prewarm thread having run and ended, and `WINDOW_MAX_S` after it opened. A closed window never reopens. An app that
does not prewarm (pytest, the fixture backend, uvicorn started directly) never opens it and does not even get the
middleware, so its stack (`tests/test_route_refusal_walk.py` pins the order) and its requests are untouched.
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, MutableMapping
from typing import Any

from nq_terminal.services.prewarm import ensure_log_lines, prewarm_enabled, prewarm_running

LOGGER_NAME = "nq_terminal.request_timing"
LOG = logging.getLogger(LOGGER_NAME)
STATE_KEY = "request_timing"  # app.state attribute: the TimingWindow
WINDOW_MAX_S = 60.0  # the window ends by itself this long after it opened
MAX_PATH_CHARS = 200
MS = 1000.0

Scope = MutableMapping[str, Any]


class TimingWindow:
    """When requests are timed: open from creation (when `enabled`) until `close`, the prewarm thread's end, or `max_s`.

    Thread safe for its use: one writer flips a flag, requests read it."""

    def __init__(self, *, enabled: bool, max_s: float = WINDOW_MAX_S, clock: Callable[[], float] = time.monotonic,
                 prewarm_running: Callable[[], bool] = prewarm_running) -> None:
        self._clock, self._prewarm_running, self._max_s = clock, prewarm_running, max_s
        self._lock = threading.Lock()
        self._open = bool(enabled)
        self._closed = not enabled
        self._opened_at = clock()
        self._saw_prewarm = False

    def open(self) -> None:
        """Open the window if it has never been closed (a closed window stays closed)."""
        with self._lock:
            if not self._closed:
                self._open, self._opened_at = True, self._clock()

    def close(self) -> None:
        with self._lock:
            self._open, self._closed = False, True

    def active(self) -> bool:
        """True while a request should be timed; closes the window when it has run out."""
        if not self._open:
            return False
        with self._lock:
            if not self._open:
                return False
            if self._clock() - self._opened_at > self._max_s or self._prewarm_ended():
                self._open, self._closed = False, True
            return self._open

    def _prewarm_ended(self) -> bool:
        running = bool(self._prewarm_running())
        if running:
            self._saw_prewarm = True
        return self._saw_prewarm and not running


def _printable(path: str) -> str:
    """The path on one line: escapes control characters, keeps at most MAX_PATH_CHARS characters."""
    return ascii(path[:MAX_PATH_CHARS])[1:-1]


def _line(scope: Scope, status: int, began: float, ended: float, wall_s: float, event_loop_cpu_s: float,
          process_cpu_s: float) -> str:
    return (f"request timing: {scope.get('method', '-')} {_printable(str(scope.get('path', '')))} status={status} "
            f"start={began:.6f} end={ended:.6f} wall_ms={wall_s * MS:.1f} "
            f"event_loop_cpu_ms={event_loop_cpu_s * MS:.1f} process_cpu_ms={process_cpu_s * MS:.1f}")


class RequestTimingMiddleware:
    def __init__(self, app: Any, window: TimingWindow) -> None:
        self.app, self.window = app, window

    async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or not self.window.active():
            await self.app(scope, receive, send)
            return
        status = [0]

        async def watching_send(message: Any) -> None:
            if message["type"] == "http.response.start":
                status[0] = int(message["status"])
            await send(message)

        began, fine_began = time.monotonic(), time.perf_counter()
        thread_began, process_began = time.thread_time(), time.process_time()
        try:
            await self.app(scope, receive, watching_send)
        finally:
            self._write(scope, status[0], began, fine_began, thread_began, process_began)

    @staticmethod
    def _write(scope: Scope, status: int, began: float, fine_began: float, thread_began: float,
               process_began: float) -> None:
        try:
            LOG.info(_line(scope, status, began, time.monotonic(), time.perf_counter() - fine_began,
                           time.thread_time() - thread_began, time.process_time() - process_began))
        except Exception:  # noqa: BLE001 - a log line is never worth an error in a request
            pass


def install(app: Any, enabled: bool | None = None) -> TimingWindow:
    """Add the middleware to `app` when the window is enabled, and keep the window at `app.state.request_timing`.
    `enabled` None follows the prewarm switch (NQT_DESKTOP or NQT_PREWARM is "1"). Call it from `create_app`, once."""
    window = TimingWindow(enabled=prewarm_enabled() if enabled is None else enabled)
    if window.active():  # an app that never times (pytest, the fixture backend) keeps its middleware stack as it was
        ensure_log_lines(LOG)
        app.add_middleware(RequestTimingMiddleware, window=window)
    setattr(app.state, STATE_KEY, window)
    return window


def close_window(app: Any) -> None:
    """End the HOME-window timing for `app` (the prewarm's stage hook calls this when the HOME tasks stage ends)."""
    window = getattr(getattr(app, "state", None), STATE_KEY, None)
    if window is not None:
        window.close()
