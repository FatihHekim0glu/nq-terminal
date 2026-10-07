"""The idle working-set trim (vnext perf-1; 02 section 4.1, the 400 MB idle target at HOME).

`nq_terminal/memtrim.py` empties the backend's working set on Windows (K32EmptyWorkingSet on the current process) once
the later prewarm tasks are done (not after the HOME tasks, whose end falls when HOME's own requests arrive), and once
per quiet period after 60 s with no foreground request. What is proved here: the prewarm calls its stage hook after
the tasks and after the later tasks (and `api/home_prewarm.py` hands it the trim for the later stage only); a trim never runs while a request or a job is running; the quiet trim
fires once per quiet period, and the page's background polls (health, commands, the event tape) neither start nor
reset a quiet period; off Windows it is a no-op; NQT_MEMTRIM=0 switches it off; a failing Windows call is logged and
never raised. The real call is made once on Windows, on this test process (it only moves pages to the standby list).
"""
from __future__ import annotations

import asyncio
import functools
import logging
import sys
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.routing import iter_route_contexts

from nq_terminal import memtrim
from nq_terminal.api import actions as actions_api
from nq_terminal.api import audit as audit_api
from nq_terminal.api import commands as commands_api
from nq_terminal.api import home_prewarm
from nq_terminal.api import jobs as jobs_api
from nq_terminal.api import runs as runs_api
from nq_terminal.api import system as system_api
from nq_terminal.app import create_app
from nq_terminal.services import prewarm
from nq_terminal.settings import load_settings

from conftest import api_client

WAIT_S = 10.0
LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


class Clock:
    """A monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture(autouse=True)
def windows_and_on(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every test starts on (a pretend) Windows with the switch unset and a spy in place of the native call."""
    calls: list[str] = []
    monkeypatch.setattr(memtrim, "PLATFORM", "win32")
    monkeypatch.delenv(memtrim.ENV_MEMTRIM, raising=False)
    monkeypatch.delenv(prewarm.ENV_DESKTOP, raising=False)
    monkeypatch.delenv(prewarm.ENV_PREWARM, raising=False)
    monkeypatch.setattr(prewarm, "_started", False)
    monkeypatch.setattr(memtrim, "_trim_current_process", lambda: calls.append("trim") or True)
    return calls


@pytest.fixture
def calls(windows_and_on: list[str]) -> list[str]:
    return windows_and_on


def trimmer(clock: Clock, **kwargs) -> memtrim.MemTrim:
    return memtrim.MemTrim(activity=memtrim.Activity(clock=clock), clock=clock, **kwargs)


# ---------------------------------------------------------------- after the prewarm tasks and after the later tasks


def test_born_failing_the_prewarm_calls_its_stage_hook_after_the_tasks_and_after_the_later_tasks():
    order: list[str] = []
    thread = prewarm.start_prewarm([lambda: order.append("home")], True, later=[lambda: order.append("later_task")],
                                   quiet=lambda: True, quiet_windows=1, on_stage=order.append)
    assert thread is not None
    thread.join(WAIT_S)
    assert not thread.is_alive()
    assert order == ["home", prewarm.STAGE_TASKS, "later_task", prewarm.STAGE_LATER]


def test_with_no_later_tasks_the_hook_runs_once_after_the_tasks():
    order: list[str] = []
    thread = prewarm.start_prewarm([lambda: order.append("home")], True, on_stage=order.append)
    thread.join(WAIT_S)
    assert order == ["home", prewarm.STAGE_TASKS]


def test_a_failing_stage_hook_is_logged_and_the_later_tasks_still_run(caplog, escaped_none):
    order: list[str] = []

    def boom(stage: str) -> None:
        order.append(stage)
        raise OSError("no trim for you")

    thread = prewarm.start_prewarm([lambda: None], True, later=[lambda: order.append("later_task")],
                                   quiet=lambda: True, quiet_windows=1, on_stage=boom)
    thread.join(WAIT_S)
    assert order == [prewarm.STAGE_TASKS, "later_task", prewarm.STAGE_LATER]
    assert "stage hook" in caplog.text
    assert escaped_none == []


def test_the_prewarm_is_running_while_its_thread_works_and_not_after():
    gate = threading.Event()
    seen: list[bool] = []
    thread = prewarm.start_prewarm([lambda: seen.append(prewarm.prewarm_running()) or gate.wait(WAIT_S)], True)
    gate.set()
    thread.join(WAIT_S)
    assert seen == [True] and prewarm.prewarm_running() is False


def test_born_failing_the_home_prewarm_hands_the_prewarm_the_apps_trim(monkeypatch, calls):
    monkeypatch.setenv("NQT_DESKTOP", "1")
    seen = {}

    def fake_start(tasks, enabled=None, *, ready=None, later=(), on_stage=None, **kwargs):
        seen["on_stage"] = on_stage
        return "thread"

    monkeypatch.setattr(home_prewarm, "start_prewarm", fake_start)
    clock = Clock()
    trim = trimmer(clock)
    state = SimpleNamespace(settings=SimpleNamespace(fixture_mode=False), **{memtrim.STATE_KEY: trim})
    assert home_prewarm.start_home_prewarm(SimpleNamespace(state=state)) == "thread"
    seen["on_stage"](prewarm.STAGE_TASKS)
    assert calls == [], "no trim right after the HOME tasks: the page's HOME requests are about to arrive"
    seen["on_stage"](prewarm.STAGE_LATER)
    assert calls == ["trim"]


def test_without_an_installed_trim_the_home_prewarm_trims_directly(monkeypatch, calls):
    monkeypatch.setenv("NQT_PREWARM", "1")
    seen = {}
    monkeypatch.setattr(home_prewarm, "start_prewarm",
                        lambda tasks, enabled=None, **kw: seen.update(kw) or "thread")
    state = SimpleNamespace(settings=SimpleNamespace(fixture_mode=False))
    home_prewarm.start_home_prewarm(SimpleNamespace(state=state))
    seen["on_stage"](prewarm.STAGE_LATER)
    assert calls == ["trim"]


def test_born_failing_the_trim_never_runs_before_home_is_served_only_after_the_later_tasks(monkeypatch, calls):
    """perf.md: 'A must not run before HOME is served'. The HOME tasks end seconds after the port binds, when HOME's own
    requests arrive, so a trim there pages out what the prewarm just warmed. The later stage waits for a quiet process."""
    assert home_prewarm.TRIM_STAGES == frozenset({prewarm.STAGE_LATER})
    monkeypatch.setenv("NQT_PREWARM", "1")
    seen = {}
    monkeypatch.setattr(home_prewarm, "start_prewarm",
                        lambda tasks, enabled=None, **kw: seen.update(kw) or "thread")
    home_prewarm.start_home_prewarm(SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(fixture_mode=False))))
    seen["on_stage"](prewarm.STAGE_TASKS)
    assert calls == []
    seen["on_stage"](prewarm.STAGE_LATER)
    assert calls == ["trim"]


# ---------------------------------------------------------------- never during a request or a job


def run_asgi(app, path: str = "/api/runs", method: str = "GET") -> list[dict]:
    sent: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict) -> None:
        sent.append(message)

    asyncio.run(app({"type": "http", "path": path, "method": method, "headers": []}, receive, send))
    return sent


def test_born_failing_no_trim_runs_while_a_request_is_being_served(calls):
    clock = Clock()
    trim = trimmer(clock)
    inside: list[tuple[bool, bool, int]] = []

    async def endpoint(scope, receive, send) -> None:
        clock.advance(10 * memtrim.QUIET_S)
        inside.append((trim.after_stage(prewarm.STAGE_TASKS), trim.quiet_check(), len(calls)))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    sent = run_asgi(memtrim.ActivityMiddleware(endpoint, activity=trim.activity))
    assert sent[0]["status"] == 200
    assert inside == [(False, False, 0)], "neither trim ran inside the request"
    assert trim.activity.in_flight == 0
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.quiet_check() is True and calls == ["trim"], "once the request is over and the quiet period passed"


def test_a_request_that_raises_still_ends_its_activity(calls):
    clock = Clock()
    trim = trimmer(clock)

    async def endpoint(scope, receive, send) -> None:
        raise RuntimeError("route failed")

    with pytest.raises(RuntimeError):
        run_asgi(memtrim.ActivityMiddleware(endpoint, activity=trim.activity))
    assert trim.activity.in_flight == 0


def test_no_quiet_trim_while_a_job_is_queued_or_running(calls):
    clock = Clock()
    jobs = SimpleNamespace(running=1, queued=0)
    trim = trimmer(clock, busy=[lambda: jobs.running + jobs.queued > 0])
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.quiet_check() is False and calls == []
    jobs.running, jobs.queued = 0, 1
    assert trim.quiet_check() is False and calls == []
    jobs.queued = 0
    assert trim.quiet_check() is True and calls == ["trim"]


def test_the_apps_job_service_and_the_prewarm_count_as_busy(monkeypatch, calls):
    state = SimpleNamespace()
    app = SimpleNamespace(state=state)
    assert memtrim.app_busy(app) is False  # no job service yet: nothing runs
    state.jobs = SimpleNamespace(list_jobs=lambda: SimpleNamespace(running=1, queued=0))
    assert memtrim.app_busy(app) is True
    state.jobs = SimpleNamespace(list_jobs=lambda: SimpleNamespace(running=0, queued=0))
    assert memtrim.app_busy(app) is False
    monkeypatch.setattr(prewarm, "prewarm_running", lambda: True)
    assert memtrim.app_busy(app) is True


def test_a_broken_busy_check_counts_as_busy_and_is_logged(caplog, calls):
    clock = Clock()

    def broken() -> bool:
        raise RuntimeError("no idea")

    trim = trimmer(clock, busy=[broken])
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.quiet_check() is False and calls == []
    assert "busy check" in caplog.text


# ---------------------------------------------------------------- once per quiet period


def foreground(trim: memtrim.MemTrim, path: str = "/api/runs") -> None:
    trim.activity.begin(path)
    trim.activity.end(path)


def test_born_failing_the_quiet_trim_fires_once_per_quiet_period(calls):
    clock = Clock()
    trim = trimmer(clock)
    foreground(trim)
    clock.advance(memtrim.QUIET_S - 1)
    assert trim.quiet_check() is False and calls == []
    clock.advance(2)
    assert trim.quiet_check() is True and calls == ["trim"]
    for _ in range(5):
        clock.advance(memtrim.QUIET_S * 3)
        assert trim.quiet_check() is False
    assert calls == ["trim"], "one trim for one quiet period"
    foreground(trim)  # a new request ends the quiet period
    clock.advance(memtrim.QUIET_S - 1)
    assert trim.quiet_check() is False
    clock.advance(2)
    assert trim.quiet_check() is True and calls == ["trim", "trim"]


def test_the_background_polls_neither_reset_nor_start_a_quiet_period(calls):
    clock = Clock()
    trim = trimmer(clock)
    foreground(trim)
    for _ in range(40):  # the page polls health every 2 s at HOME
        clock.advance(2)
        for path in memtrim.BACKGROUND_PATHS:
            foreground(trim, path)
    assert trim.quiet_check() is True and calls == ["trim"]
    clock.advance(memtrim.QUIET_S * 2)
    foreground(trim, path_of(system_api.health))
    assert trim.quiet_check() is False and calls == ["trim"], "a poll does not open a new quiet period"


def test_a_background_poll_in_flight_still_blocks_the_trim(calls):
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    trim.activity.begin(path_of(system_api.health))
    assert trim.quiet_check() is False and calls == []
    trim.activity.end(path_of(system_api.health))
    assert trim.quiet_check() is True and calls == ["trim"]


def test_a_post_prewarm_trim_counts_for_the_quiet_period_it_ran_in(calls):
    clock = Clock()
    trim = trimmer(clock)
    assert trim.after_stage(prewarm.STAGE_TASKS) is True
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.quiet_check() is False and calls == ["trim"], "nothing was served since that trim"
    foreground(trim)
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.quiet_check() is True and calls == ["trim", "trim"]


def test_the_quiet_thread_trims_once_and_stops(calls):
    clock = Clock()
    trim = trimmer(clock, poll_s=0.01)
    clock.advance(memtrim.QUIET_S + 1)
    thread = trim.start()
    assert thread is not None and thread.name == memtrim.THREAD_NAME and thread.daemon
    deadline = threading.Event()
    for _ in range(500):
        if calls:
            break
        deadline.wait(0.01)
    deadline.wait(0.1)
    trim.stop()
    thread.join(WAIT_S)
    assert not thread.is_alive() and calls == ["trim"]


# ---------------------------------------------------------------- off Windows, the switch, failures


def test_born_failing_off_windows_it_is_a_no_op(monkeypatch):
    monkeypatch.setattr(memtrim, "PLATFORM", "linux")
    monkeypatch.setattr(memtrim, "_trim_current_process", lambda: pytest.fail("no native call off Windows"))
    assert memtrim.trim_available() is False
    assert memtrim.trim_working_set("test") is False
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.after_stage(prewarm.STAGE_TASKS) is False and trim.quiet_check() is False


@pytest.mark.parametrize("value", ["0"])
def test_born_failing_nqt_memtrim_0_switches_it_off(monkeypatch, value):
    monkeypatch.setenv(memtrim.ENV_MEMTRIM, value)
    monkeypatch.setenv("NQT_DESKTOP", "1")
    monkeypatch.setattr(memtrim, "_trim_current_process", lambda: pytest.fail("NQT_MEMTRIM=0 must win"))
    assert memtrim.memtrim_enabled() is False and memtrim.quiet_trim_wanted() is False
    assert memtrim.trim_working_set("test") is False
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    assert trim.after_stage(prewarm.STAGE_LATER) is False and trim.quiet_check() is False


@pytest.mark.parametrize("env, wanted", [({}, False), ({"NQT_DESKTOP": "1"}, True), ({"NQT_PREWARM": "1"}, True),
                                         ({"NQT_MEMTRIM": "1"}, True), ({"NQT_DESKTOP": "1", "NQT_MEMTRIM": "0"}, False),
                                         ({"NQT_MEMTRIM": "yes"}, False)])
def test_the_quiet_thread_is_wanted_only_in_desktop_or_launcher_processes_or_when_asked(env, wanted):
    assert memtrim.quiet_trim_wanted(env) is wanted


def test_born_failing_a_failing_windows_call_is_logged_and_never_raised(monkeypatch, caplog):
    def boom() -> bool:
        raise OSError("access denied")

    monkeypatch.setattr(memtrim, "_trim_current_process", boom)
    with caplog.at_level(logging.WARNING, logger=memtrim.LOG.name):
        assert memtrim.trim_working_set("test") is False
    assert "working set trim failed" in caplog.text


def test_a_windows_call_that_reports_failure_is_logged(monkeypatch, caplog):
    monkeypatch.setattr(memtrim, "_trim_current_process", lambda: False)
    with caplog.at_level(logging.WARNING, logger=memtrim.LOG.name):
        assert memtrim.trim_working_set("test") is False
    assert "did not trim" in caplog.text


@pytest.mark.skipif(sys.platform != "win32", reason="the real Windows call")
def test_the_real_windows_call_trims_this_process(monkeypatch):
    monkeypatch.undo()
    monkeypatch.delenv(memtrim.ENV_MEMTRIM, raising=False)
    assert memtrim.trim_available() is True
    assert memtrim._trim_current_process() is True


# ---------------------------------------------------------------- installed on the real app


def test_install_counts_the_apps_requests_and_starts_no_thread_outside_desktop_mode(calls):
    app = create_app(load_settings({}))
    trim = memtrim.install(app)
    assert getattr(app.state, memtrim.STATE_KEY) is trim and memtrim.install(app) is trim  # idempotent
    before = trim.activity.generation
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as client:
        assert client.get("/api/runs").status_code in (200, 503)
        assert trim._thread is None, "pytest is not a desktop process"
    assert trim.activity.generation > before and trim.activity.in_flight == 0


def test_in_desktop_mode_the_lifespan_starts_the_quiet_thread_and_stops_it(monkeypatch, calls):
    monkeypatch.setenv("NQT_DESKTOP", "1")
    monkeypatch.setenv("NQT_PREWARM", "0")
    app = create_app(load_settings({}))
    trim = memtrim.install(app)
    with api_client(app, base_url=LOCAL, client=LOOPBACK):
        thread = trim._thread
        assert thread is not None and thread.is_alive()
    thread.join(WAIT_S)
    assert not thread.is_alive()


@pytest.fixture
def escaped_none(monkeypatch: pytest.MonkeyPatch) -> list[BaseException]:
    seen: list[BaseException] = []
    monkeypatch.setattr(threading, "excepthook", lambda args: seen.append(args.exc_value))
    return seen


# ---------------------------------------------------------------- the 0.2.0 job indicator beside the 0.1.2 trim

# The paths come from the real app's router, never from literals here (V031, V020I seams review): a renamed jobs, health,
# commands or event-tape route changes the derived path, so `memtrim.BACKGROUND_PATHS` no longer matches it and
# `test_born_failing_every_background_path_is_the_get_route_of_its_poll` fails, instead of these tests going on to pass
# against a path no page sends any more.
BACKGROUND_ENDPOINTS = (system_api.health, commands_api.commands, audit_api.oos_log, jobs_api.list_jobs)
INDICATOR_IDLE_S = 15.0  # web/src/screens/jobs/model.ts POLL_IDLE_MS: the indicator's read while no job is active
JOB_ID = "a1b2"


@functools.cache
def real_routes() -> tuple[tuple[str, str, object], ...]:
    """(method, path, endpoint) for every route of the real app, walked as FastAPI's OpenAPI generator walks them."""
    return routes_of(create_app(load_settings({})))


def routes_of(app) -> tuple[tuple[str, str, object], ...]:
    return tuple((method, ctx.path, ctx.endpoint) for ctx in iter_route_contexts(app.routes)
                 if ctx.path is not None for method in sorted(ctx.methods or ()))


def path_of(endpoint, method: str = "GET", routes=None) -> str:
    """The one path the app serves `endpoint` on for `method`; fails when there is none or more than one."""
    found = {path for m, path, e in (real_routes() if routes is None else routes) if e is endpoint and m == method}
    assert len(found) == 1, f"{method} {getattr(endpoint, '__name__', endpoint)}: {sorted(found)}"
    return found.pop()


def background_paths(routes=None) -> frozenset[str]:
    """The GET paths the page's background polls are sent to, read from the router."""
    return frozenset(path_of(endpoint, "GET", routes) for endpoint in BACKGROUND_ENDPOINTS)


def jobs_list() -> str:
    return path_of(jobs_api.list_jobs)


def runs_list() -> str:
    return path_of(runs_api.list_runs)


def served(trim: memtrim.MemTrim, path: str, method: str = "GET") -> None:
    async def endpoint(scope, receive, send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    run_asgi(memtrim.ActivityMiddleware(endpoint, activity=trim.activity), path, method)


def test_born_failing_every_background_path_is_the_get_route_of_its_poll():
    """Each literal in `memtrim.BACKGROUND_PATHS` is the path the real router serves the poll's endpoint on."""
    assert background_paths() == memtrim.BACKGROUND_PATHS
    get_paths = {path for method, path, _ in real_routes() if method == "GET"}
    assert memtrim.BACKGROUND_PATHS <= get_paths


def test_born_failing_a_renamed_jobs_route_is_caught():
    """Born failing on the literal paths: an app whose jobs router moved serves the job list somewhere else, and the
    derived set no longer equals the trim's list, so the check above would fail on such a rename."""
    moved = FastAPI()
    for router in (system_api.router, commands_api.router, audit_api.router):
        moved.include_router(router)
    moved.include_router(jobs_api.router, prefix="/v2")
    derived = background_paths(routes_of(moved))
    assert derived != memtrim.BACKGROUND_PATHS
    assert memtrim.BACKGROUND_PATHS - derived == {jobs_list()}
    assert "/v2" + jobs_list() in derived


def test_born_failing_the_job_indicators_idle_list_polls_do_not_keep_the_quiet_trim_away(calls):
    clock = Clock()
    trim = trimmer(clock)
    health = path_of(system_api.health)
    served(trim, runs_list())  # the last real request at HOME
    for _ in range(int((memtrim.QUIET_S * 2) / INDICATOR_IDLE_S)):  # the indicator reads the list every 15 s, HOME mounted
        clock.advance(INDICATOR_IDLE_S)
        served(trim, jobs_list())
        served(trim, health)
    assert trim.quiet_check() is True and calls == ["trim"], "the trim fires with the indicator mounted"
    clock.advance(INDICATOR_IDLE_S)
    served(trim, jobs_list())
    clock.advance(memtrim.QUIET_S * 2)
    assert trim.quiet_check() is False and calls == ["trim"], "an idle list poll does not open a new quiet period"


def test_a_queued_or_running_job_still_holds_the_trim_off_while_the_indicator_polls_every_2_s(calls):
    clock = Clock()
    jobs = SimpleNamespace(running=1, queued=0)
    trim = trimmer(clock, busy=[lambda: jobs.running + jobs.queued > 0])
    served(trim, runs_list())
    for _ in range(int(memtrim.QUIET_S * 2 / 2)):
        clock.advance(2)
        served(trim, jobs_list())
        assert trim.quiet_check() is False
    assert calls == []
    jobs.running = 0
    assert trim.quiet_check() is True and calls == ["trim"], "the job ended: the quiet period it spanned is over"


def test_only_reading_the_job_list_is_a_background_poll(calls):
    clock = Clock()
    trim = trimmer(clock)
    one_job = path_of(jobs_api.read_job).replace("{job_id}", JOB_ID)
    assert one_job == path_of(jobs_api.remove_job, "DELETE").replace("{job_id}", JOB_ID)
    for path, method in ((path_of(jobs_api.queue_job, "POST"), "POST"),
                         (path_of(actions_api.start_action, "POST"), "POST"),
                         (one_job, "GET"), (one_job, "DELETE"), (jobs_list(), "DELETE")):
        generation = trim.activity.generation
        served(trim, path, method)
        assert trim.activity.generation != generation, f"{method} {path} is a foreground request"
    generation = trim.activity.generation
    served(trim, jobs_list(), "GET")
    assert trim.activity.generation == generation, f"GET {jobs_list()} is a background poll"


# ---------------------------------------------------------------- the log lines the harness reads (carried, 0.3.0)
# The desktop shell drains the backend's stdout and stderr into backend.log. The prewarm and the trim logged at INFO, but a
# process that never set logging up drops INFO, so neither wrote a line there. These tests prove the lines exist (caplog) and
# that they reach stderr in such a process.

MB = 1024 * 1024


def messages(caplog) -> list[str]:
    return [record.getMessage() for record in caplog.records]


@pytest.fixture
def unconfigured_logging(monkeypatch: pytest.MonkeyPatch):
    """Call the returned function first in a test: from then on the process has never configured logging (no root handler,
    and no handler or level on the two loggers). Pytest adds its own root handlers when the test starts, so this cannot
    be done in the fixture's setup. The loggers' own state is put back afterwards."""
    loggers = [memtrim.LOG, prewarm.LOG]
    saved = [(logger, list(logger.handlers), logger.level) for logger in loggers]

    def start() -> None:
        monkeypatch.setattr(logging.root, "handlers", [])
        for logger in loggers:
            logger.handlers = []
            logger.setLevel(logging.NOTSET)

    yield start
    for logger, handlers, level in saved:
        logger.handlers = handlers
        logger.setLevel(level)


def test_born_failing_a_trim_logs_the_working_set_before_and_after(monkeypatch, caplog, calls):
    readings = iter([800 * MB, 300 * MB])
    monkeypatch.setattr(memtrim, "_working_set_bytes", lambda: next(readings))
    with caplog.at_level(logging.INFO, logger=memtrim.LOG.name):
        assert memtrim.trim_working_set("quiet period", collect=False) is True
    lines = [m for m in messages(caplog) if m.startswith("working set trimmed")]
    assert len(lines) == 1
    assert "(quiet period)" in lines[0] and "before 800.0 MB" in lines[0] and "after 300.0 MB" in lines[0]
    assert calls == ["trim"]


def test_a_working_set_that_cannot_be_read_is_logged_as_unavailable_and_the_trim_still_runs(monkeypatch, caplog, calls):
    monkeypatch.setattr(memtrim, "_working_set_bytes", lambda: None)
    with caplog.at_level(logging.INFO, logger=memtrim.LOG.name):
        assert memtrim.trim_working_set("test", collect=False) is True
    line = next(m for m in messages(caplog) if m.startswith("working set trimmed"))
    assert "before unavailable" in line and "after unavailable" in line
    assert calls == ["trim"]


def test_born_failing_the_quiet_trim_and_the_post_prewarm_trim_each_log_one_line(monkeypatch, caplog, calls):
    readings = iter([700 * MB, 350 * MB, 360 * MB, 340 * MB])
    monkeypatch.setattr(memtrim, "_working_set_bytes", lambda: next(readings))
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    with caplog.at_level(logging.INFO, logger=memtrim.LOG.name):
        assert trim.quiet_check() is True
        assert trim.after_stage(prewarm.STAGE_LATER) is True
    lines = [m for m in messages(caplog) if m.startswith("working set trimmed")]
    assert len(lines) == 2
    assert "(quiet period)" in lines[0] and "before 700.0 MB" in lines[0] and "after 350.0 MB" in lines[0]
    assert "(after the prewarm later)" in lines[1] and "before 360.0 MB" in lines[1]


def test_a_skipped_trim_logs_nothing_about_a_working_set(caplog, calls):
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    trim.activity.begin("/api/runs", "GET")
    with caplog.at_level(logging.INFO, logger=memtrim.LOG.name):
        assert trim.after_stage(prewarm.STAGE_LATER) is False
    assert not [m for m in messages(caplog) if m.startswith("working set trimmed")]
    assert calls == []


def test_the_working_set_reading_is_none_off_windows(monkeypatch):
    monkeypatch.setattr(memtrim, "PLATFORM", "linux")
    assert memtrim._working_set_bytes() is None


@pytest.mark.skipif(sys.platform != "win32", reason="the real Windows call")
def test_the_real_working_set_reading_is_a_positive_size(monkeypatch):
    monkeypatch.undo()
    reading = memtrim._working_set_bytes()
    assert isinstance(reading, int) and reading > 10 * MB


def test_born_failing_the_prewarm_logs_when_it_starts_and_when_it_ends(caplog):
    caplog.set_level(logging.INFO, logger=prewarm.LOG.name)
    thread = prewarm.start_prewarm([lambda: None, lambda: None], True, later=[lambda: None], quiet=lambda: True,
                                   quiet_windows=1)
    assert thread is not None
    thread.join(WAIT_S)
    assert not thread.is_alive()
    lines = messages(caplog)
    started = [m for m in lines if m.startswith("prewarm started")]
    ended = [m for m in lines if m.startswith("prewarm ended")]
    assert len(started) == 1 and "2 tasks" in started[0] and "1 later" in started[0]
    assert len(ended) == 1
    assert lines.index(started[0]) < lines.index(ended[0])
    assert lines.index(ended[0]) > max(i for i, m in enumerate(lines) if m.startswith("prewarm later tasks finished"))


def test_the_prewarm_end_line_is_logged_even_when_a_task_fails(caplog):
    def boom() -> None:
        raise RuntimeError("two-day failed")

    caplog.set_level(logging.INFO, logger=prewarm.LOG.name)
    thread = prewarm.start_prewarm([boom], True)
    assert thread is not None
    thread.join(WAIT_S)
    lines = messages(caplog)
    assert any(m.startswith("prewarm started") for m in lines) and any(m.startswith("prewarm ended") for m in lines)


def test_born_failing_the_lines_reach_stderr_when_the_process_never_set_logging_up(unconfigured_logging, capsys, calls):
    unconfigured_logging()
    assert memtrim.trim_working_set("quiet period", collect=False) is True
    err = capsys.readouterr().err
    assert "working set trimmed (quiet period)" in err and " INFO " in err
    thread = prewarm.start_prewarm([lambda: None], True)
    assert thread is not None
    thread.join(WAIT_S)
    err = capsys.readouterr().err
    assert "prewarm started" in err and "prewarm ended" in err
    assert len(memtrim.LOG.handlers) == 1 and len(prewarm.LOG.handlers) == 1, "one handler each, however many times it is asked"


def test_a_process_that_set_logging_up_is_left_alone(unconfigured_logging, capsys, monkeypatch):
    unconfigured_logging()
    own = logging.NullHandler()
    monkeypatch.setattr(logging.root, "handlers", [own])
    assert prewarm.ensure_log_lines(memtrim.LOG) is False
    assert memtrim.LOG.handlers == [] and memtrim.LOG.level == logging.NOTSET
    memtrim.LOG.info("nothing is added for this")
    assert capsys.readouterr().err == ""


def test_without_a_stderr_no_handler_is_made(unconfigured_logging, monkeypatch):
    unconfigured_logging()
    monkeypatch.setattr(sys, "stderr", None)
    assert prewarm.ensure_log_lines(memtrim.LOG) is False
    assert memtrim.LOG.handlers == []
