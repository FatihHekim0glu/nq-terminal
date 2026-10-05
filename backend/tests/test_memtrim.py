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
import logging
import sys
import threading
from types import SimpleNamespace

import pytest

from nq_terminal import memtrim
from nq_terminal.api import home_prewarm
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
    foreground(trim, "/api/health")
    assert trim.quiet_check() is False and calls == ["trim"], "a poll does not open a new quiet period"


def test_a_background_poll_in_flight_still_blocks_the_trim(calls):
    clock = Clock()
    trim = trimmer(clock)
    clock.advance(memtrim.QUIET_S + 1)
    trim.activity.begin("/api/health")
    assert trim.quiet_check() is False and calls == []
    trim.activity.end("/api/health")
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

JOBS_LIST = "/api/jobs"
INDICATOR_IDLE_S = 15.0  # web/src/screens/jobs/model.ts POLL_IDLE_MS: the indicator's read while no job is active


def served(trim: memtrim.MemTrim, path: str, method: str = "GET") -> None:
    async def endpoint(scope, receive, send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    run_asgi(memtrim.ActivityMiddleware(endpoint, activity=trim.activity), path, method)


def test_born_failing_the_job_indicators_idle_list_polls_do_not_keep_the_quiet_trim_away(calls):
    clock = Clock()
    trim = trimmer(clock)
    served(trim, "/api/runs")  # the last real request at HOME
    for _ in range(int((memtrim.QUIET_S * 2) / INDICATOR_IDLE_S)):  # the indicator reads the list every 15 s, HOME mounted
        clock.advance(INDICATOR_IDLE_S)
        served(trim, JOBS_LIST)
        served(trim, "/api/health")
    assert trim.quiet_check() is True and calls == ["trim"], "the trim fires with the indicator mounted"
    clock.advance(INDICATOR_IDLE_S)
    served(trim, JOBS_LIST)
    clock.advance(memtrim.QUIET_S * 2)
    assert trim.quiet_check() is False and calls == ["trim"], "an idle list poll does not open a new quiet period"


def test_a_queued_or_running_job_still_holds_the_trim_off_while_the_indicator_polls_every_2_s(calls):
    clock = Clock()
    jobs = SimpleNamespace(running=1, queued=0)
    trim = trimmer(clock, busy=[lambda: jobs.running + jobs.queued > 0])
    served(trim, "/api/runs")
    for _ in range(int(memtrim.QUIET_S * 2 / 2)):
        clock.advance(2)
        served(trim, JOBS_LIST)
        assert trim.quiet_check() is False
    assert calls == []
    jobs.running = 0
    assert trim.quiet_check() is True and calls == ["trim"], "the job ended: the quiet period it spanned is over"


def test_only_reading_the_job_list_is_a_background_poll(calls):
    clock = Clock()
    trim = trimmer(clock)
    for path, method in (("/api/jobs", "POST"), ("/api/jobs/actions", "POST"), ("/api/jobs/a1b2", "GET"),
                         ("/api/jobs/a1b2", "DELETE"), ("/api/jobs", "DELETE")):
        generation = trim.activity.generation
        served(trim, path, method)
        assert trim.activity.generation != generation, f"{method} {path} is a foreground request"
    generation = trim.activity.generation
    served(trim, JOBS_LIST, "GET")
    assert trim.activity.generation == generation, "GET /api/jobs is a background poll"
