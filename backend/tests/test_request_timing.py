"""Per-request timing in the HOME window (startup.md 11.3): one line per request while the HOME tasks stage runs.

`desktop/request_timing.py` is a pure ASGI middleware. While its window is open it writes one INFO line per HTTP request
to the `nq_terminal.request_timing` logger (backend.log, through the stderr handler the prewarm's `ensure_log_lines`
adds): method, path without the query string, status, start and end on the monotonic clock, wall milliseconds and the
CPU used by the serving thread and by the process. Outside the window it writes nothing and costs one flag read. The
window opens when the app is built in a desktop or launcher process (the processes that prewarm), closes when the HOME
tasks stage ends (`close_window`, called from the prewarm's stage hook), when the prewarm thread has ended, or after
`WINDOW_MAX_S`, whichever comes first.
"""
from __future__ import annotations

import dataclasses
import logging
import re
import types
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI

from conftest import api_client
from nq_terminal.desktop import request_timing
from nq_terminal.desktop.request_timing import LOGGER_NAME, RequestTimingMiddleware, TimingWindow
from nq_terminal.settings import load_settings

FIXTURES = Path(__file__).resolve().parent / "fixtures"

LINE = re.compile(r"^request timing: (?P<method>[A-Z]+) (?P<path>\S+) status=(?P<status>\d+) "
                  r"start=(?P<start>[\d.]+) end=(?P<end>[\d.]+) wall_ms=(?P<wall>[\d.]+) "
                  r"event_loop_cpu_ms=(?P<thread>[\d.]+) process_cpu_ms=(?P<process>[\d.]+)$")


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _app(window: TimingWindow) -> FastAPI:
    app = FastAPI()

    @app.get("/api/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(RequestTimingMiddleware, window=window)
    return app


def _client(window: TimingWindow):
    from starlette.testclient import TestClient

    return TestClient(_app(window))


def _lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == LOGGER_NAME]


@pytest.fixture
def caplog_timing(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)
    return caplog


def test_a_request_in_the_open_window_writes_one_line(caplog_timing: pytest.LogCaptureFixture) -> None:
    window = TimingWindow(enabled=True)
    assert _client(window).get("/api/ping").status_code == 200
    lines = _lines(caplog_timing)
    assert len(lines) == 1
    match = LINE.match(lines[0])
    assert match, lines[0]
    assert match["method"] == "GET" and match["path"] == "/api/ping" and match["status"] == "200"
    assert float(match["end"]) >= float(match["start"])
    assert float(match["wall"]) >= 0 and float(match["thread"]) >= 0 and float(match["process"]) >= 0


def test_a_request_after_the_home_stage_ends_writes_no_line(caplog_timing: pytest.LogCaptureFixture) -> None:
    """Born failing: without the window gate every request logs for the life of the process."""
    window = TimingWindow(enabled=True)
    client = _client(window)
    client.get("/api/ping")
    assert len(_lines(caplog_timing)) == 1
    window.close()
    client.get("/api/ping")
    client.get("/api/ping")
    assert len(_lines(caplog_timing)) == 1


def test_a_query_string_never_reaches_the_log(caplog_timing: pytest.LogCaptureFixture) -> None:
    """Born failing: the raw target (`path?query`) carries launch codes, symbols and session values."""
    window = TimingWindow(enabled=True)
    _client(window).get("/api/ping?code=SECRET-LAUNCH-CODE&symbol=NQ.V.0")
    text = "\n".join(r.getMessage() + " " + str(r.args) for r in caplog_timing.records)
    assert "SECRET" not in text and "code=" not in text and "?" not in text
    assert any(LINE.match(line) for line in _lines(caplog_timing))


def test_a_path_with_control_characters_stays_on_one_line(caplog_timing: pytest.LogCaptureFixture) -> None:
    window = TimingWindow(enabled=True)
    _client(window).get("/api/ping%0Aforged%20line")
    lines = _lines(caplog_timing)
    assert len(lines) == 1 and "\n" not in lines[0] and "\r" not in lines[0]


def test_a_window_that_was_never_enabled_never_logs(caplog_timing: pytest.LogCaptureFixture) -> None:
    _client(TimingWindow(enabled=False)).get("/api/ping")
    assert _lines(caplog_timing) == []


def test_the_window_ends_by_itself_after_its_maximum(caplog_timing: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    window = TimingWindow(enabled=True, max_s=30.0, clock=clock)
    client = _client(window)
    clock.now += 29.0
    client.get("/api/ping")
    assert len(_lines(caplog_timing)) == 1
    clock.now += 2.0
    client.get("/api/ping")
    assert len(_lines(caplog_timing)) == 1
    assert window.active() is False


def test_the_window_ends_when_the_prewarm_thread_has_ended(caplog_timing: pytest.LogCaptureFixture) -> None:
    running = [False]
    window = TimingWindow(enabled=True, prewarm_running=lambda: running[0])
    client = _client(window)
    client.get("/api/ping")  # the prewarm has not started: still open (READY, the proof and the session come first)
    running[0] = True
    client.get("/api/ping")
    running[0] = False  # the thread ended
    client.get("/api/ping")
    assert len(_lines(caplog_timing)) == 2


def test_a_closed_window_stays_closed(caplog_timing: pytest.LogCaptureFixture) -> None:
    window = TimingWindow(enabled=True)
    window.close()
    window.open()
    _client(window).get("/api/ping")
    assert _lines(caplog_timing) == []


def test_the_response_is_untouched_by_the_middleware() -> None:
    window = TimingWindow(enabled=True)
    plain = _client(TimingWindow(enabled=False)).get("/api/ping")
    timed = _client(window).get("/api/ping")
    assert (timed.status_code, timed.json(), dict(timed.headers)) == (plain.status_code, plain.json(),
                                                                       dict(plain.headers))


def test_an_unknown_path_is_timed_with_its_status(caplog_timing: pytest.LogCaptureFixture) -> None:
    _client(TimingWindow(enabled=True)).get("/api/nothing")
    match = LINE.match(_lines(caplog_timing)[0])
    assert match and match["status"] == "404"


def test_an_error_inside_the_app_is_logged_and_still_raised(caplog_timing: pytest.LogCaptureFixture) -> None:
    app = FastAPI()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("inside")

    app.add_middleware(RequestTimingMiddleware, window=TimingWindow(enabled=True))
    from starlette.testclient import TestClient

    with pytest.raises(RuntimeError, match="inside"):
        TestClient(app).get("/boom")
    assert len(_lines(caplog_timing)) == 1


def test_non_http_scopes_pass_through_untimed() -> None:
    seen: list[str] = []

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        seen.append(scope["type"])

    import asyncio

    middleware = RequestTimingMiddleware(inner, window=TimingWindow(enabled=True))
    asyncio.run(middleware({"type": "lifespan"}, None, None))
    assert seen == ["lifespan"]


def test_install_registers_one_middleware_and_remembers_the_window() -> None:
    app = FastAPI()
    window = request_timing.install(app, enabled=True)
    assert app.state.request_timing is window
    assert [m.cls for m in app.user_middleware].count(RequestTimingMiddleware) == 1


def test_a_disabled_install_adds_no_middleware() -> None:
    app = FastAPI()
    window = request_timing.install(app, enabled=False)
    assert app.state.request_timing is window and window.active() is False
    assert app.user_middleware == []


def test_close_window_closes_the_apps_window() -> None:
    app = FastAPI()
    window = request_timing.install(app, enabled=True)
    assert window.active() is True
    request_timing.close_window(app)
    assert window.active() is False
    request_timing.close_window(FastAPI())  # an app without a window: nothing happens


def test_install_defaults_to_the_prewarm_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NQT_PREWARM", raising=False)
    monkeypatch.delenv("NQT_DESKTOP", raising=False)
    assert request_timing.install(FastAPI()).active() is False
    monkeypatch.setenv("NQT_PREWARM", "1")
    assert request_timing.install(FastAPI()).active() is True


def test_the_production_app_is_untouched_in_tests_and_timed_in_a_prewarming_process(
        tmp_path: Path, caplog_timing: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    from nq_terminal.app import create_app

    # Fixture settings: no real data root, and the prewarm switch is set only while the app is built (no lifespan runs).
    settings = dataclasses.replace(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}), web_dist=tmp_path / "missing_dist")
    monkeypatch.delenv("NQT_PREWARM", raising=False)
    monkeypatch.delenv("NQT_DESKTOP", raising=False)
    plain = create_app(settings)
    assert RequestTimingMiddleware not in [m.cls for m in plain.user_middleware]
    assert _client_for(plain).get("/api/health").status_code == 200
    assert _lines(caplog_timing) == []

    monkeypatch.setenv("NQT_PREWARM", "1")
    timed = create_app(settings)
    monkeypatch.delenv("NQT_PREWARM")
    assert [m.cls for m in timed.user_middleware].count(RequestTimingMiddleware) == 1
    assert _client_for(timed).get("/api/health").status_code == 200
    assert len(_lines(caplog_timing)) >= 1
    request_timing.close_window(timed)
    before = len(_lines(caplog_timing))
    _client_for(timed).get("/api/health")
    assert len(_lines(caplog_timing)) == before


def _client_for(app: FastAPI):
    return api_client(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


def test_wall_ms_comes_from_the_fine_clock_not_the_tick_quantised_monotonic(
        monkeypatch: pytest.MonkeyPatch, caplog_timing: pytest.LogCaptureFixture) -> None:
    """Born failing: on Windows Python 3.12 time.monotonic ticks every 15.6 ms, so a fast request read start == end and
    wall_ms=0.0. The duration now comes from perf_counter (100 ns); start and end stay monotonic."""
    perf = iter([50.000000, 50.002500])  # a 2.5 ms request on the fine clock
    fake = types.SimpleNamespace(monotonic=lambda: 812.390625, perf_counter=lambda: next(perf),
                                 thread_time=lambda: 1.0, process_time=lambda: 2.0)
    monkeypatch.setattr(request_timing, "time", fake)
    _client(TimingWindow(enabled=True, clock=lambda: 0.0)).get("/api/ping")
    match = LINE.match(_lines(caplog_timing)[0])
    assert match, _lines(caplog_timing)
    assert match["start"] == match["end"] == "812.390625"
    assert float(match["wall"]) == pytest.approx(2.5, abs=0.05)
