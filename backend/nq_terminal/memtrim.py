"""The idle working-set trim (vnext perf-1; 02 section 4.1: the idle target at HOME).

Windows counts a process by its working set, the pages it has touched recently. Once the HOME prewarm has run, most of
the backend's heap sits untouched until the next screen asks for it. `trim_working_set` hands those pages back to the
system (K32EmptyWorkingSet on the current process; SetProcessWorkingSetSize(-1, -1) where that name is missing): they
move to the standby list, the counted working set drops, and a later touch costs a soft fault, not a disk read. The
committed memory (private bytes) does not change, so a trim never hides a leak: the harness reads private bytes beside
the working set for that.

When it runs (`MemTrim`):
- after the later prewarm tasks, which start only once the process is quiet, so after HOME is served
  (`api/home_prewarm.py` hands the prewarm the stage hook and `TRIM_STAGES` names that stage; the HOME tasks stage does
  not trim, since HOME's own requests arrive then and a trim would page out what the prewarm just warmed), unless a
  request is being served at that moment;
- once per quiet period: after `QUIET_S` seconds in which the backend served no foreground request, never while a
  request is in flight, a job is queued or running, or the prewarm thread is working. The page's background polls
  (`BACKGROUND_PATHS`: health every 2 s, commands, the event tape) are cheap and constant, so they neither start nor end
  a quiet period, but a poll in flight still holds the trim off. A request that streams (the live stream) is in flight
  for as long as it is open, so a live screen is never trimmed under.

Off Windows every call is a no-op. `NQT_MEMTRIM=0` switches all of it off. The quiet thread starts only in a desktop or
launcher process (`NQT_DESKTOP=1` or `NQT_PREWARM=1`) or with `NQT_MEMTRIM=1`, so pytest and the plain fixture backend
never run it. Errors are logged, never raised. Nothing here reads prices, touches a file or starts a process.
"""
from __future__ import annotations

import gc
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from typing import Any, AsyncIterator, Callable, Iterable, Iterator, Mapping

LOG = logging.getLogger(__name__)

ENV_MEMTRIM = "NQT_MEMTRIM"
OFF_VALUE = "0"
ON_VALUE = "1"
PLATFORM = sys.platform  # read at call time; tests set it
QUIET_S = 60.0  # seconds with no foreground request before the quiet trim
POLL_S = 5.0  # how often the quiet thread looks
THREAD_NAME = "nqt-memtrim"
STATE_KEY = "memtrim"  # app.state attribute holding the app's MemTrim
JOBS_STATE_KEY = "jobs"  # api/jobs.py STATE_KEY: the app's one JobService, created on first use
# Polls the page sends on every screen, HOME included; they keep the backend from ever being "quiet" otherwise.
BACKGROUND_PATHS = frozenset({"/api/health", "/api/commands", "/api/audit/oos-log"})

BusyCheck = Callable[[], bool]


def memtrim_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """False only when NQT_MEMTRIM is exactly "0"."""
    env = os.environ if environ is None else environ
    return env.get(ENV_MEMTRIM) != OFF_VALUE


def quiet_trim_wanted(environ: Mapping[str, str] | None = None) -> bool:
    """Whether the quiet thread should run: NQT_MEMTRIM=1, or a desktop or launcher process with the trim not off."""
    env = os.environ if environ is None else environ
    if env.get(ENV_MEMTRIM) == ON_VALUE:
        return True
    if not memtrim_enabled(env):
        return False
    from nq_terminal.services.prewarm import prewarm_enabled
    return prewarm_enabled(env)


def trim_available(environ: Mapping[str, str] | None = None) -> bool:
    """On Windows and not switched off."""
    return PLATFORM == "win32" and memtrim_enabled(environ)


def _trim_current_process() -> bool:
    """The native call on this process; True when Windows reports success. May raise (the caller logs)."""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    process = kernel32.GetCurrentProcess()
    empty = getattr(kernel32, "K32EmptyWorkingSet", None)
    if empty is not None:
        empty.argtypes = [wintypes.HANDLE]
        empty.restype = wintypes.BOOL
        ok = bool(empty(process))
    else:
        size = kernel32.SetProcessWorkingSetSize
        size.argtypes = [wintypes.HANDLE, ctypes.c_size_t, ctypes.c_size_t]
        size.restype = wintypes.BOOL
        ok = bool(size(process, ctypes.c_size_t(-1), ctypes.c_size_t(-1)))
    if not ok:
        LOG.warning("the working set trim was refused by Windows (error %d)", ctypes.get_last_error())
    return ok


def trim_working_set(reason: str = "", *, collect: bool = True) -> bool:
    """Trim this process's working set; True when it was trimmed. A no-op off Windows or with NQT_MEMTRIM=0. With
    `collect`, a full garbage collection first, so freed objects are not paged back in later. Never raises."""
    if not trim_available():
        return False
    try:
        if collect:
            gc.collect()
        began = time.perf_counter()
        ok = bool(_trim_current_process())
    except Exception:  # noqa: BLE001 - a trim problem must never reach the app
        LOG.warning("the working set trim failed (%s)", reason or "no reason given", exc_info=True)
        return False
    if not ok:
        LOG.warning("the working set trim did not trim (%s)", reason or "no reason given")
        return False
    LOG.info("working set trimmed (%s) in %.1f ms", reason or "no reason given", (time.perf_counter() - began) * 1e3)
    return True


class Activity:
    """Requests in flight and when the last foreground request ended. Thread safe; the middleware calls `begin` and
    `end` on the event loop, the trim reads it from its own thread."""

    def __init__(self, clock: Callable[[], float] = time.monotonic,
                 background: Iterable[str] = BACKGROUND_PATHS) -> None:
        self._clock = clock
        self._background = frozenset(background)
        self._lock = threading.Lock()
        self._in_flight = 0
        self._generation = 0  # counts foreground requests begun and ended: a new value is a new quiet period
        self._last = clock()

    def _foreground(self, path: str) -> bool:
        return path not in self._background

    def begin(self, path: str = "") -> None:
        with self._lock:
            self._in_flight += 1
            if self._foreground(path):
                self._generation += 1

    def end(self, path: str = "") -> None:
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            if self._foreground(path):
                self._generation += 1
                self._last = self._clock()

    @property
    def in_flight(self) -> int:
        with self._lock:
            return self._in_flight

    @property
    def generation(self) -> int:
        with self._lock:
            return self._generation

    @contextmanager
    def held(self) -> Iterator[tuple[bool, int, float]]:
        """Hold off every new request while the caller trims: yields (idle, generation, seconds quiet)."""
        with self._lock:
            idle = self._in_flight == 0
            yield idle, self._generation, (self._clock() - self._last) if idle else 0.0


class ActivityMiddleware:
    """Pure ASGI: every HTTP request counts as in flight from its start to the end of its handling, errors included."""

    def __init__(self, app: Any, activity: Activity) -> None:
        self.app = app
        self.activity = activity

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        self.activity.begin(path)
        try:
            await self.app(scope, receive, send)
        finally:
            self.activity.end(path)


class MemTrim:
    """The app's trim: after a prewarm stage, and once per quiet period from its own daemon thread."""

    def __init__(self, *, activity: Activity | None = None, busy: Iterable[BusyCheck] = (), quiet_s: float = QUIET_S,
                 poll_s: float = POLL_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.activity = activity if activity is not None else Activity(clock=clock)
        self._busy = tuple(busy)
        self._quiet_s, self._poll_s = quiet_s, poll_s
        self._trimmed_generation = -1
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _trim(self, reason: str, require_quiet: bool) -> bool:
        if not trim_available():
            return False
        gc.collect()  # outside the hold: a request arriving meanwhile is not kept waiting for it
        with self.activity.held() as (idle, generation, quiet_for):
            if not idle:
                LOG.info("working set trim skipped (%s): a request is in flight", reason)
                return False
            if require_quiet and (generation == self._trimmed_generation or quiet_for < self._quiet_s):
                return False
            trimmed = trim_working_set(reason, collect=False)
            self._trimmed_generation = generation
            return trimmed

    def after_stage(self, stage: str) -> bool:
        """The prewarm finished a stage: trim now unless a request is in flight. Never raises."""
        try:
            return self._trim(f"after the prewarm {stage}", require_quiet=False)
        except Exception:  # noqa: BLE001
            LOG.exception("the post-prewarm trim failed")
            return False

    def _busy_now(self) -> bool:
        for check in self._busy:
            try:
                if check():
                    return True
            except Exception:  # noqa: BLE001 - an unknown state is treated as busy
                LOG.warning("a memtrim busy check failed; no trim this time", exc_info=True)
                return True
        return False

    def quiet_check(self) -> bool:
        """One look: trim when the backend has been quiet for `quiet_s` and has not been trimmed in this quiet period.
        Never raises."""
        try:
            if not trim_available():
                return False
            with self.activity.held() as (idle, generation, quiet_for):
                due = idle and generation != self._trimmed_generation and quiet_for >= self._quiet_s
            if not due or self._busy_now():
                return False
            return self._trim("quiet period", require_quiet=True)
        except Exception:  # noqa: BLE001
            LOG.exception("the quiet-period trim failed")
            return False

    def start(self) -> threading.Thread | None:
        """Start the quiet thread (once); None when it is already running or could not start."""
        if self._thread is not None and self._thread.is_alive():
            return None
        self._stop.clear()
        thread = threading.Thread(target=self._loop, name=THREAD_NAME, daemon=True)
        try:
            thread.start()
        except RuntimeError:
            LOG.exception("the memtrim thread could not start")
            return None
        self._thread = thread
        return thread

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self._poll_s):
            self.quiet_check()


def app_busy(app: Any) -> bool:
    """A job queued or running in the app's job service (if it has one yet), or the prewarm thread at work."""
    from nq_terminal.services.prewarm import prewarm_running

    if prewarm_running():
        return True
    jobs = getattr(app.state, JOBS_STATE_KEY, None)
    if jobs is None:
        return False
    listing = jobs.list_jobs()
    return bool(listing.running or listing.queued)


def stage_hook(app: Any) -> Callable[[str], None]:
    """What the prewarm calls after each stage: the app's MemTrim when installed, else a plain trim."""
    def hook(stage: str) -> None:
        trimmer = getattr(app.state, STATE_KEY, None)
        if trimmer is not None:
            trimmer.after_stage(stage)
        else:
            trim_working_set(f"after the prewarm {stage}")
    return hook


def _wrap(original: Callable[[Any], Any], trimmer: MemTrim) -> Callable[[Any], Any]:
    @asynccontextmanager
    async def lifespan(app: Any) -> AsyncIterator[Any]:
        if quiet_trim_wanted():
            trimmer.start()
        try:
            async with original(app) as state:
                yield state
        finally:
            trimmer.stop()

    return lifespan


def install(app: Any) -> MemTrim:
    """Count the app's requests (outermost middleware at the time of the call) and run the quiet thread in its
    lifespan. Call it in `create_app` before the app starts. Idempotent: returns the app's MemTrim."""
    existing = getattr(app.state, STATE_KEY, None)
    if existing is not None:
        return existing
    trimmer = MemTrim(busy=[lambda: app_busy(app)])
    app.add_middleware(ActivityMiddleware, activity=trimmer.activity)
    app.router.lifespan_context = _wrap(app.router.lifespan_context, trimmer)
    setattr(app.state, STATE_KEY, trimmer)
    return trimmer
