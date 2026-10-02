"""The test-only fixture entry: `python -E -s -m nq_terminal.desktop.fixture_main` (W2A, review 1).

It is honoured only when NQT_FIXTURE_DIR is set and resolves inside terminal/backend/tests/fixtures. It loads
`backend/tests/fixture_app.py` by file path (`-E` ignores PYTHONPATH), builds `create_fixture_app` (the fake serve and
catalog), and goes through the same lock, socket, stdin and NQT-READY path as `python -m nq_terminal`, so a test
build's `--fixture` serves the same synthetic prices as the browser fixture backend. The release shell never launches
this module: its spawn line is fixed to `-m nq_terminal`.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import pytest

from nq_terminal.desktop import fixture_main, handshake, lock
from nq_terminal.settings import FIXTURES_DIR

from conftest import BACKEND, LOCAL, LOOPBACK, api_client, desktop_env, open_session, spawn_backend
from fixture_app import create_fixture_app

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows start path")

TOKEN = "6b" * 32
NONCE = "4d" * 32
BARS = "/api/bars?symbol=NQ.V.0&timeframe=5m&start=2011-01-03&end=2011-01-08"


@pytest.mark.parametrize("value", [None, "", "   "])
def test_it_refuses_to_start_without_a_fixture_folder(value, lock_dir, capsys):
    env = {"NQT_STATE_DIR": str(lock_dir), "NQT_DESKTOP": "1"}
    if value is not None:
        env["NQT_FIXTURE_DIR"] = value
    assert fixture_main.main(env) == fixture_main.EXIT_REFUSED
    captured = capsys.readouterr()
    assert "NQT-" not in captured.out and "NQT_FIXTURE_DIR" in captured.err


@pytest.mark.parametrize("where", ["outside", "tests", "parent"])
def test_it_refuses_a_fixture_folder_outside_the_fixtures(where, lock_dir, tmp_path, capsys):
    folder = {"outside": tmp_path, "tests": BACKEND / "tests", "parent": FIXTURES_DIR / ".."}[where]
    env = {"NQT_STATE_DIR": str(lock_dir), "NQT_DESKTOP": "1", "NQT_FIXTURE_DIR": str(folder)}
    assert fixture_main.main(env) == fixture_main.EXIT_REFUSED
    assert "NQT-" not in capsys.readouterr().out
    assert not (lock_dir / "backend.lock").exists()


def test_the_real_fixtures_folder_is_accepted():
    assert fixture_main.fixture_folder({"NQT_FIXTURE_DIR": str(FIXTURES_DIR)}) == FIXTURES_DIR.resolve()


def test_the_harness_path_is_the_tests_fixture_app():
    assert fixture_main.FIXTURE_APP == BACKEND / "tests" / "fixture_app.py" and fixture_main.FIXTURE_APP.is_file()


def _get(port: int, path: str, cookie: str | None) -> tuple[int, dict]:
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Cookie": cookie} if cookie else {})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


@pytest.mark.usefixtures("window_watch")
def test_a_valid_fixture_start_prints_ready_and_serves_the_synthetic_bars(lock_dir, tmp_path):
    env = {**desktop_env(lock_dir), "NQT_FIXTURE_DIR": str(FIXTURES_DIR), "NQT_FIXTURE_LOG_DIR": str(lock_dir)}
    backend = spawn_backend(["-m", "nq_terminal.desktop.fixture_main"], env, token=TOKEN, nonce=NONCE)
    try:
        kind, ready = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
        assert handshake.verify_ready(ready, TOKEN, NONCE) and ready["mode"] == "desktop"
        assert lock.read_info(lock_dir).pid == ready["pid"]
        status, served = _get(ready["port"], BARS, open_session(ready["port"], TOKEN))
    finally:
        backend.stop()
    expected_app = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES_DIR), "NQT_STATE_DIR": str(tmp_path)},
                                      log_dir=tmp_path / "log")
    expected = api_client(expected_app, base_url=LOCAL, client=LOOPBACK).get(BARS).json()
    assert status == 200 and served == expected and served["sessions"]["assessed"] is True
    lines = [json.loads(x) for x in (lock_dir / "oos_access_log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert lines and all(x["caller"] == "terminal" for x in lines)  # the fake gate's own temporary log
    assert not (lock_dir / "backend.lock").exists()
