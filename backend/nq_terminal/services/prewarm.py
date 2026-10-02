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
- `ready` (optional) is polled until it returns true before the first task, so the prewarm starts after the port is
  bound (the lifespan hook runs before the listening socket exists). A check that never turns true, or that raises,
  delays the start by at most `ready_timeout` seconds and the tasks then run anyway.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Callable, Iterable, Mapping

LOG = logging.getLogger(__name__)

ENV_DESKTOP = "NQT_DESKTOP"
ENV_PREWARM = "NQT_PREWARM"
SWITCH_ON = "1"
THREAD_NAME = "nqt-prewarm"
PORT_BOUND_KEY = "port_bound"  # app.state attribute: a zero-argument callable, true once the socket is bound
READY_TIMEOUT_S = 15.0
READY_POLL_S = 0.05

Task = Callable[[], object]

_lock = threading.Lock()
_started = False


def prewarm_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """True only when NQT_DESKTOP or NQT_PREWARM is exactly "1" in `environ` (default: the process environment)."""
    env = os.environ if environ is None else environ
    return env.get(ENV_DESKTOP) == SWITCH_ON or env.get(ENV_PREWARM) == SWITCH_ON


def start_prewarm(tasks: Iterable[Task], enabled: bool | None = None, *, ready: Callable[[], bool] | None = None,
                  ready_timeout: float = READY_TIMEOUT_S) -> threading.Thread | None:
    """Run `tasks` once, in order, on a daemon thread; return the thread, or None when nothing was started.

    `enabled` None reads the environment (`prewarm_enabled`); False starts nothing and does not use up the
    once-per-process start. Never raises."""
    global _started
    try:
        if not (prewarm_enabled() if enabled is None else bool(enabled)):
            return None
        snapshot = tuple(tasks)
    except Exception:  # noqa: BLE001 - a prewarm problem must never reach the app
        LOG.exception("the prewarm could not read its tasks and did not start")
        return None
    if not snapshot:
        return None
    with _lock:
        if _started:
            return None
        thread = threading.Thread(target=_run, args=(snapshot, ready, ready_timeout), name=THREAD_NAME, daemon=True)
        try:
            thread.start()
        except RuntimeError:
            LOG.exception("the prewarm thread could not start")
            return None
        _started = True
    return thread


def _run(tasks: tuple[Task, ...], ready: Callable[[], bool] | None, ready_timeout: float) -> None:
    _wait_until_ready(ready, ready_timeout)
    began = time.monotonic()
    done = 0
    for task in tasks:
        done += _run_task(task)
    LOG.info("prewarm finished: %d of %d tasks ok in %.2f s", done, len(tasks), time.monotonic() - began)


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
            LOG.warning("the listening port was not bound within %.1f s; the prewarm starts anyway", timeout)
            return
        time.sleep(READY_POLL_S)
