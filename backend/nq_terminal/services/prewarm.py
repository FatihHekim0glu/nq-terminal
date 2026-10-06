"""The HOME prewarm (02 section 4.1 item 2; 03 section 15.2; 04 D1.4).

Once the backend has bound its port, a background thread runs the computations the HOME page asks for first, so they
are under way while the splash and the page load. The tasks are zero-argument callables that the app builds from the
same cached route callables the routes themselves call (two-day and universe for the default universe, bars for the
GP instrument, EQ's bootstrap when it reads bars). They therefore share the result cache's keys and its single-flight:
a page request that races a task for the same key waits for the one computation.

This module makes no price read and imports nothing that could. Every gated read a task makes goes through the bar
service and the one door to prices with `caller="terminal"` and the page's own reason, so the gate log gains no new
kind of line (05 G02), and a cache hit logs nothing, exactly as for a page request.

- Off by default. It is on only when `NQT_DESKTOP=1` or `NQT_PREWARM=1` is set (the desktop shell and the launchers set
  one), so pytest, the Playwright fixture backend and the real-data smoke never prewarm.
- Once per process: the first enabled start with at least one task wins; later starts return None and run nothing.
- A daemon thread, so it never keeps the process alive; tasks run in order, one at a time.
- Errors are logged, never raised: a failing task does not stop the others, the thread or the app.
- `ready` (optional) is polled until it returns true before the first task (the lifespan hook runs before the
  listening socket exists). `python -m nq_terminal` hands it a `StartGate` (V021): the tasks begin only once the
  `NQT-READY` line is printed and the first identity proof has been answered, so the shell's first proof never shares
  the interpreter with the prewarm's imports; in launcher and browser modes, where no proof may come, the gate also
  opens `PROOF_FALLBACK_S` seconds after READY. A check that never turns true, or that raises, delays the start by at
  most `ready_timeout` seconds and the tasks then run anyway.
- `later` (optional) are tasks the first screen never asks for. They run after `tasks`, once the process has been quiet
  for `quiet_windows` readings in a row (`quiet`, by default `process_quiet_probe`: the whole process used at most a
  quarter of one core over a half-second window), or after `quiet_timeout` seconds, whichever comes first. On a first
  launch (02 section 4.1 item 3, decided: the cold-HOME cap holds on the first launch) they would otherwise take the
  interpreter from HOME's own requests while HOME loads; like requestIdleCallback in a page, they wait for idle time.
- `on_stage` (optional) is called with `STAGE_TASKS` once the tasks are done and with `STAGE_LATER` once the later
  tasks are done. The app's hook (`api/home_prewarm.py`) trims the working set after the stages its `TRIM_STAGES`
  names, which is `STAGE_LATER` only (vnext perf-1, `memtrim.py`); after `STAGE_TASKS` it does nothing. A failing hook
  is logged and the thread goes on. `prewarm_running()` is true while the thread works, so the quiet-period trim waits
  for it.
- One line when the thread begins its tasks ("prewarm started") and one when it ends ("prewarm ended"), beside the
  existing per-task and per-stage lines. The desktop shell drains the backend's stderr into `backend.log`, but a process
  that never set logging up drops INFO, so `ensure_log_lines` gives these loggers a stderr handler in that case (and
  only then: a process that configured logging keeps its own). The measurement harness reads the prewarm's span, and
  the memory trim's lines (`memtrim.py`), from that log.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from typing import Callable, Iterable, Mapping

LOG = logging.getLogger(__name__)

ENV_DESKTOP = "NQT_DESKTOP"
ENV_PREWARM = "NQT_PREWARM"
SWITCH_ON = "1"
THREAD_NAME = "nqt-prewarm"
PORT_BOUND_KEY = "port_bound"  # app.state attribute: a zero-argument callable, true once the socket is bound
START_GATE_KEY = "prewarm_gate"  # app.state attribute: the StartGate `python -m nq_terminal` makes (V021)
PROOF_FALLBACK_S = 3.0  # launcher and browser modes: the prewarm starts this long after READY when no proof came
READY_TIMEOUT_S = 15.0
READY_POLL_S = 0.05
QUIET_WINDOW_S = 0.5  # one reading of the process CPU
QUIET_CPU_SHARE = 0.25  # of one core: a process serving HOME's requests runs near one core (the interpreter lock)
QUIET_WINDOWS = 2  # quiet readings in a row before the later tasks start
QUIET_TIMEOUT_S = 20.0  # the later tasks start by then even if the process never goes quiet
STAGE_TASKS = "tasks"  # on_stage argument once the HOME tasks are done
STAGE_LATER = "later"  # on_stage argument once the later tasks are done

Task = Callable[[], object]
StageHook = Callable[[str], object]

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"

_lock = threading.Lock()
_started = False
_running = threading.Event()  # set while the prewarm thread works


def ensure_log_lines(logger: logging.Logger) -> bool:
    """Make `logger`'s INFO lines reach stderr, which is where the desktop shell's `backend.log` comes from, when the
    process has not set logging up: no handler on the root logger or on `logger`, and a stderr to write to. True when a
    handler was added. Asked again, it adds nothing; a configured process is left alone. Never raises."""
    try:
        if logger.handlers or logging.getLogger().handlers or sys.stderr is None:
            return False
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        return True
    except Exception:  # noqa: BLE001 - a log line is never worth an error in the app
        return False


def prewarm_running() -> bool:
    """True while the prewarm thread is running its tasks (or waiting for the port or for quiet between them)."""
    return _running.is_set()


def prewarm_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """True only when NQT_DESKTOP or NQT_PREWARM is exactly "1" in `environ` (default: the process environment)."""
    env = os.environ if environ is None else environ
    return env.get(ENV_DESKTOP) == SWITCH_ON or env.get(ENV_PREWARM) == SWITCH_ON


def process_quiet_probe(window: float = QUIET_WINDOW_S, share: float = QUIET_CPU_SHARE, *,
                        cpu: Callable[[], float] = time.process_time, clock: Callable[[], float] = time.monotonic,
                        sleep: Callable[[float], None] = time.sleep) -> Callable[[], bool]:
    """A check that sleeps one `window` and answers whether the whole process (every thread) used at most `share` of
    one core meanwhile. The prewarm thread sleeps through it, so only the app's own work counts."""
    def process_quiet() -> bool:
        cpu_before, wall_before = cpu(), clock()
        sleep(window)
        return cpu() - cpu_before <= share * (clock() - wall_before)

    return process_quiet


class StartGate:
    """When the prewarm may begin (V021): after the READY line is printed and the first identity proof has been
    answered. With `fallback_s` (launcher and browser modes, where no proof may come) it also opens that many seconds
    after READY; without it (desktop mode) only the proof opens it, and the prewarm's own `ready_timeout` is the net.

    Calling the gate answers whether it is open. Thread safe: the event loop marks it, the prewarm thread asks."""

    def __init__(self, *, fallback_s: float | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self._fallback_s, self._clock = fallback_s, clock
        self._lock = threading.Lock()
        self._ready_at: float | None = None
        self._proved = False

    def mark_ready(self) -> None:
        """The NQT-READY line has been printed (the first call counts)."""
        with self._lock:
            if self._ready_at is None:
                self._ready_at = self._clock()

    def mark_proof(self) -> None:
        """An identity proof has been answered (sent in full)."""
        with self._lock:
            self._proved = True

    @property
    def fallback_s(self) -> float | None:
        """Seconds after READY at which the gate opens without a proof; None: only a proof opens it."""
        return self._fallback_s

    @property
    def proved(self) -> bool:
        with self._lock:
            return self._proved

    def __call__(self) -> bool:
        with self._lock:
            if self._ready_at is None:
                return False
            if self._proved:
                return True
            return self._fallback_s is not None and self._clock() - self._ready_at >= self._fallback_s


class Idle:
    """When the later tasks may start: `windows` quiet readings in a row, or `timeout` seconds."""

    def __init__(self, quiet: Callable[[], bool], windows: int = QUIET_WINDOWS, timeout: float = QUIET_TIMEOUT_S):
        self.quiet, self.windows, self.timeout = quiet, max(1, int(windows)), timeout


def start_prewarm(tasks: Iterable[Task], enabled: bool | None = None, *, ready: Callable[[], bool] | None = None,
                  ready_timeout: float = READY_TIMEOUT_S, later: Iterable[Task] = (),
                  quiet: Callable[[], bool] | None = None, quiet_windows: int = QUIET_WINDOWS,
                  quiet_timeout: float = QUIET_TIMEOUT_S,
                  on_stage: StageHook | None = None) -> threading.Thread | None:
    """Run `tasks` once, in order, on a daemon thread, then `later` once the process is quiet; return the thread, or
    None when nothing was started.

    `enabled` None reads the environment (`prewarm_enabled`); False starts nothing and does not use up the
    once-per-process start. Never raises."""
    global _started
    try:
        if not (prewarm_enabled() if enabled is None else bool(enabled)):
            return None
        snapshot, deferred = tuple(tasks), tuple(later)
        idle = Idle(quiet if quiet is not None else process_quiet_probe(), quiet_windows, quiet_timeout)
    except Exception:  # noqa: BLE001 - a prewarm problem must never reach the app
        LOG.exception("the prewarm could not read its tasks and did not start")
        return None
    if not snapshot and not deferred:
        return None
    with _lock:
        if _started:
            return None
        thread = threading.Thread(target=_run, args=(snapshot, ready, ready_timeout, deferred, idle),
                                  kwargs={} if on_stage is None else {"on_stage": on_stage}, name=THREAD_NAME,
                                  daemon=True)
        _running.set()
        try:
            thread.start()
        except RuntimeError:
            _running.clear()
            LOG.exception("the prewarm thread could not start")
            return None
        _started = True
    return thread


def _run(tasks: tuple[Task, ...], ready: Callable[[], bool] | None, ready_timeout: float,
         later: tuple[Task, ...] = (), idle: Idle | None = None, on_stage: StageHook | None = None) -> None:
    ensure_log_lines(LOG)
    thread_began = time.monotonic()
    try:
        _wait_until_ready(ready, ready_timeout)
        began = time.monotonic()
        LOG.info("prewarm started: %d tasks, %d later tasks, %.2f s after the thread began", len(tasks), len(later),
                 began - thread_began)
        done = sum(_run_task(task) for task in tasks)
        LOG.info("prewarm finished: %d of %d tasks ok in %.2f s", done, len(tasks), time.monotonic() - began)
        _after_stage(on_stage, STAGE_TASKS)
        if not later:
            return
        _wait_until_quiet(idle if idle is not None else Idle(process_quiet_probe()))
        began = time.monotonic()
        done = sum(_run_task(task) for task in later)
        LOG.info("prewarm later tasks finished: %d of %d ok in %.2f s", done, len(later), time.monotonic() - began)
        _after_stage(on_stage, STAGE_LATER)
    finally:
        _running.clear()
        LOG.info("prewarm ended: %.2f s after the thread began", time.monotonic() - thread_began)


def _after_stage(on_stage: StageHook | None, stage: str) -> None:
    """Call the stage hook; a failure is logged and never raised."""
    if on_stage is None:
        return
    try:
        on_stage(stage)
    except Exception:  # noqa: BLE001 - a hook problem leaves the prewarm and the app alone
        LOG.exception("the prewarm stage hook failed after the %s", stage)


def _wait_until_quiet(idle: Idle) -> None:
    """Returns after `idle.windows` quiet readings in a row, after `idle.timeout` seconds, or at once on a broken check."""
    deadline = time.monotonic() + idle.timeout
    in_a_row = 0
    while in_a_row < idle.windows:
        if time.monotonic() >= deadline:
            LOG.info("the process never went quiet within %.1f s; the later prewarm tasks start anyway", idle.timeout)
            return
        try:
            in_a_row = in_a_row + 1 if idle.quiet() else 0
        except Exception:  # noqa: BLE001 - a broken check is logged and the later tasks go ahead
            LOG.exception("the prewarm quiet check failed; the later tasks start now")
            return


def _run_task(task: Task) -> int:
    """1 when the task ran to the end, 0 when it raised (logged); never raises."""
    name = getattr(task, "__name__", None) or repr(task)
    began = time.monotonic()
    try:
        task()
    except Exception:  # noqa: BLE001 - one failing task leaves the others and the app alone
        LOG.exception("prewarm task %s failed after %.2f s", name, time.monotonic() - began)
        return 0
    LOG.info("prewarm task %s done in %.2f s", name, time.monotonic() - began)
    return 1


def _wait_until_ready(ready: Callable[[], bool] | None, timeout: float) -> None:
    if ready is None:
        return
    deadline = time.monotonic() + timeout
    while True:
        try:
            if ready():
                return
        except Exception:  # noqa: BLE001 - a broken check is logged and the warm-up goes ahead
            LOG.exception("the prewarm ready check failed; starting anyway")
            return
        if time.monotonic() >= deadline:
            LOG.warning("the port was not bound, or READY and the first proof not seen, within %.1f s; the prewarm "
                        "starts anyway", timeout)
            return
        time.sleep(READY_POLL_S)
