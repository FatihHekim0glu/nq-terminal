"""No token and no launch code in any log line or server request line (04 D2.2; 03 section 15.2; 05 X10).

The token travels only in the `Authorization` header and the code only in `X-NQT-Code`, never in a URL, so the
server's request lines cannot carry them. This file drives the whole browser-door flow (code, redeem, a refused
code, a refused token, a refused origin) through a real uvicorn server on a free loopback port (never 8765) with
its access log on, and through the app in process with every logger at DEBUG, and finds neither the token, the code
nor the session value in what was logged. The whole test run is scanned as well (`secret_log_scan` in conftest.py).
"""
from __future__ import annotations

import dataclasses
import json
import logging
import threading
import time
import urllib.error
import urllib.request

import pytest
import uvicorn

from nq_terminal.app import create_app
from nq_terminal.desktop import lifecycle
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.security import SessionMiddleware
from nq_terminal.settings import load_settings

from conftest import SecretScan, bare_client

TOKEN = "8f" * 32
START_TIMEOUT_S = 10.0
LOGGERS = ("", "uvicorn", "uvicorn.access", "uvicorn.error", "nq_terminal", "fastapi", "starlette", "httpx")


def app_on(port: int):
    made = create_app(dataclasses.replace(load_settings({}), port=port, web_dist=load_settings({}).state_dir / "x"))
    if SessionMiddleware not in [m.cls for m in made.user_middleware]:
        made.add_middleware(SessionMiddleware)  # until the merge registers it, so the refusals are logged here too
    return made


def flow(get) -> list[str]:
    """The browser door end to end; returns every secret it saw."""
    code = get("/api/session/code", {"Authorization": f"NQT {TOKEN}"})[1]["code"]
    status, _, cookie = get("/api/session/redeem", {"X-NQT-Code": code})
    assert status == 200
    value = cookie.split(";", 1)[0].split("=", 1)[1]
    assert get("/api/session/redeem", {"X-NQT-Code": code})[0] == 401
    assert get("/api/session/code", {"Authorization": f"NQT {'90' * 32}"})[0] == 401
    assert get("/api/health", {"Cookie": cookie.split(";", 1)[0]})[0] == 200
    assert get("/api/health", {"Cookie": cookie.split(";", 1)[0], "Origin": "http://evil.example"})[0] == 403
    assert get("/api/health", {"Cookie": f"nqt_s_0={value}"})[0] == 401
    return [TOKEN, code, value]


@pytest.fixture
def capture():
    scan = SecretScan()
    loggers = [logging.getLogger(name) for name in LOGGERS]
    levels = [logger.level for logger in loggers]
    for logger in loggers:
        logger.addHandler(scan)
        logger.setLevel(logging.DEBUG)
    try:
        yield scan
    finally:
        for logger, level in zip(loggers, levels):
            logger.removeHandler(scan)
            logger.setLevel(level)


def test_the_flow_in_process_logs_no_secret(capture):
    app = app_on(8798)
    lifecycle.set_runtime(app, Runtime(token=TOKEN, port=8798, pid=4120, mode="launcher"))
    client = bare_client(app)

    def get(path, headers):
        r = client.get(path, headers={"Host": "127.0.0.1:8798", **headers})
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        return r.status_code, body, r.headers.get("set-cookie", "")

    for secret in flow(get):
        capture.remember(secret)
    assert capture.hits() == []


class Server:
    """uvicorn on 127.0.0.1 and a free port, access log on, in a thread."""

    def __init__(self) -> None:
        self.app = app_on(8798)
        config = uvicorn.Config(self.app, host="127.0.0.1", port=0, lifespan="off", log_level="debug",
                                access_log=True, log_config=None)
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> "Server":
        self.thread.start()
        deadline = time.monotonic() + START_TIMEOUT_S
        while not self.server.started:
            assert time.monotonic() < deadline and self.thread.is_alive(), "the test server did not start"
            time.sleep(0.02)
        port = self.server.servers[0].sockets[0].getsockname()[1]
        lifecycle.set_runtime(self.app, Runtime(token=TOKEN, port=port, pid=4120, mode="launcher"))
        self.port = port
        return self

    def __exit__(self, *_: object) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=START_TIMEOUT_S)


def test_the_flow_through_a_real_server_puts_no_secret_in_a_request_line(capture):
    with Server() as server:
        def get(path, headers):
            request = urllib.request.Request(f"http://127.0.0.1:{server.port}{path}", headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return response.status, json.loads(response.read() or b"{}"), response.headers.get("set-cookie", "")
            except urllib.error.HTTPError as refused:
                return refused.code, {}, ""

        secrets = flow(get)
    for secret in secrets:
        capture.remember(secret)
    lines = [text for text in capture.texts if "/api/session" in text]
    assert len(lines) >= 4, "the access log recorded the request lines"
    assert capture.hits() == []


def test_the_scan_is_born_failing():
    scan = SecretScan()
    scan.remember(TOKEN)
    scan.emit(logging.LogRecord("x", logging.INFO, __file__, 1, "token %s", (TOKEN,), None))
    assert len(scan.hits()) == 1
