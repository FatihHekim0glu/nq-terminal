"""The live stream against a real uvicorn server (TASKS 9.2 acceptance: "reconnects after a server restart").

TestClient buffers a whole response, so this file runs the app under uvicorn on an ephemeral loopback port (never
the user's 8765) and reads the stream as it arrives with httpx: a kill switch change and an appended row reach an
open stream; the server is stopped mid-stream (the stream ends); a row is written while it is down; a new server
with a fresh app answers the browser's `Last-Event-ID` with only the missed row. Each server is stopped in a
`finally`, and the stream's lifetime bound means no test can hang on an open connection.
"""
from __future__ import annotations

import json
import shutil
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn

from nq_terminal import __main__ as launcher
from nq_terminal.api import live_stream
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from conftest import session_cookie
from fakes import FIXTURES

BOOK = "volmanaged_paper_journal.jsonl"
LIMITS = live_stream.StreamLimits(poll_s=0.05, heartbeat_s=0.5, status_every_s=0.5, lifetime_s=20.0, retry_ms=500)
START_TIMEOUT_S = 10.0
READ_TIMEOUT_S = 10.0


class Server:
    """uvicorn in a thread on 127.0.0.1 and a free port; `stop` ends it within the graceful timeout."""

    def __init__(self, root: Path, limits: live_stream.StreamLimits = LIMITS) -> None:
        self.app = app = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)}))
        app.state.live_stream_limits = limits
        # the launcher's own options (graceful shutdown bound included), so these tests run what start.ps1 runs
        config = uvicorn.Config(app, host="127.0.0.1", port=0, lifespan="off", log_level="warning",
                                **launcher.SERVER_OPTIONS)
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self) -> Server:
        self.thread.start()
        deadline = time.monotonic() + START_TIMEOUT_S
        while not self.server.started:
            if time.monotonic() > deadline or not self.thread.is_alive():
                raise RuntimeError("the test server did not start")
            time.sleep(0.02)
        return self

    @property
    def cookies(self) -> dict[str, str]:
        """The session every request to this server carries: the stream, like every /api path, is behind the cookie."""
        name, value = session_cookie(self.app)
        return {name: value}

    @property
    def url(self) -> str:
        port = self.server.servers[0].sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=START_TIMEOUT_S)
        assert not self.thread.is_alive(), "the test server did not stop"


def events(lines: Iterator[str]) -> Iterator[dict]:
    """SSE events from a line iterator, as a browser's EventSource reads them."""
    fields: dict[str, str] = {}
    for line in lines:
        if line == "":
            if fields:
                yield {**fields, "data": json.loads(fields["data"]) if "data" in fields else None}
            fields = {}
        elif not line.startswith(":"):
            name, _, value = line.partition(": ")
            fields[name] = value


def until(stream: Iterator[dict], wanted, seen: list[dict]) -> dict:
    for event in stream:
        seen.append(event)
        if wanted(event):
            return event
    raise AssertionError(f"the stream ended before the wanted event; saw {[e['event'] for e in seen]}")


def append(path: Path, **fields) -> None:
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"type": "close", "date": "2026-10-05", **fields}) + "\n")


@pytest.fixture
def root(tmp_path: Path) -> Path:
    logs = tmp_path / "live" / "logs"
    logs.mkdir(parents=True)
    for path in (FIXTURES / "live" / "logs").iterdir():
        shutil.copyfile(path, logs / path.name)
    return tmp_path


def test_live_changes_reach_an_open_stream_and_a_restart_resumes(root: Path):
    book = root / "live" / "logs" / BOOK
    seen: list[dict] = []
    first = Server(root).start()
    try:
        with httpx.stream("GET", f"{first.url}/api/live/stream", cookies=first.cookies, timeout=READ_TIMEOUT_S) as response:
            assert response.status_code == 200
            stream = events(response.iter_lines())
            until(stream, lambda e: e["event"] == "status", seen)
            until(stream, lambda e: e["event"] == "journal_row" and e["data"]["row"]["file"] == BOOK
                  and e["data"]["row"]["line_no"] == 6, seen)
            (root / "live" / "KILL-now").write_text("", encoding="utf-8")
            assert until(stream, lambda e: e["event"] == "kill_switch", seen)["data"]["on"] is True
            append(book, target=4)
            row = until(stream, lambda e: e["event"] == "journal_row", seen)
            assert (row["data"]["row"]["file"], row["data"]["row"]["line_no"]) == (BOOK, 7)
            until(stream, lambda e: e["event"] == "heartbeat", seen)
            last_id = seen[-1]["id"]
            first.stop()  # the server goes away under the open stream, which must end (cut or closed)
            try:
                seen.extend(stream)
            except httpx.HTTPError:
                pass
            assert not first.thread.is_alive()
    finally:
        if first.thread.is_alive():
            first.stop()

    append(book, target=5)  # written while no server runs
    second = Server(root).start()
    try:
        with httpx.stream("GET", f"{second.url}/api/live/stream", headers={"Last-Event-ID": last_id},
                          cookies=second.cookies, timeout=READ_TIMEOUT_S) as response:
            resumed: list[dict] = []
            stream = events(response.iter_lines())
            hello = until(stream, lambda e: e["event"] == "hello", resumed)
            assert hello["data"]["resumed"] is True
            row = until(stream, lambda e: e["event"] == "journal_row", resumed)
            assert (row["data"]["row"]["file"], row["data"]["row"]["line_no"]) == (BOOK, 8)
            assert row["data"]["row"]["data"]["target"] == 5
            assert [e for e in resumed if e["event"] == "journal_reset"] == []
        slots = live_stream.stream_slots(second.app)
        deadline = time.monotonic() + READ_TIMEOUT_S  # the client hung up: the server ends the stream
        while slots.open and time.monotonic() < deadline:
            time.sleep(0.05)
        assert slots.open == 0
    finally:
        second.stop()


LONG_LIFE = live_stream.StreamLimits(poll_s=0.05, heartbeat_s=0.5, status_every_s=0.5, lifetime_s=60.0,
                                     retry_ms=500, max_streams=1)
SHUTDOWN_MARGIN_S = 3.0


def test_an_open_stream_holds_its_slot_on_a_real_server(root: Path):
    server = Server(root, LONG_LIFE).start()
    try:
        url = f"{server.url}/api/live/stream"
        with httpx.stream("GET", url, cookies=server.cookies, timeout=READ_TIMEOUT_S) as response:
            stream = events(response.iter_lines())  # kept referenced: a dropped iterator closes the connection
            until(stream, lambda e: e["event"] == "hello", [])
            assert live_stream.stream_slots(server.app).open == 1
            refused = httpx.get(url, cookies=server.cookies, timeout=READ_TIMEOUT_S)
            assert refused.status_code == 503 and "at most 1" in refused.json()["detail"]
    finally:
        server.stop()


def test_a_shutdown_does_not_wait_for_an_open_stream_to_reach_its_lifetime(root: Path):
    server = Server(root, LONG_LIFE).start()
    try:
        with httpx.stream("GET", f"{server.url}/api/live/stream", cookies=server.cookies, timeout=READ_TIMEOUT_S) as response:
            stream = events(response.iter_lines())  # kept open, so the server has a live stream to shut down
            until(stream, lambda e: e["event"] == "hello", [])
            assert live_stream.stream_slots(server.app).open == 1
            started = time.monotonic()
            server.server.should_exit = True
            server.thread.join(timeout=LONG_LIFE.lifetime_s)
            took = time.monotonic() - started
        assert not server.thread.is_alive()
        assert took < launcher.SHUTDOWN_GRACE_S + SHUTDOWN_MARGIN_S < LONG_LIFE.lifetime_s
    finally:
        if server.thread.is_alive():
            server.stop()


def test_the_dev_launcher_bounds_the_shutdown_like_the_launcher():
    """start.ps1 -Dev runs uvicorn with --reload: each reload is a shutdown, so it needs the same bound."""
    script = (FIXTURES.parents[2] / "start.ps1").read_text(encoding="utf-8")
    dev_args = script.split("function Get-BackendArgs", 1)[1].split("return @('-m', 'nq_terminal')", 1)[0]
    assert f"'--timeout-graceful-shutdown', '{launcher.SHUTDOWN_GRACE_S}'" in dev_args
