"""V021: a start that survives a slow first identity proof (desktop 0.2.1).

After 0.2.0 the launch probe found about 1 start in 240 ending on the stopped page: the HOME prewarm began 24 to 42 ms
before `NQT-READY` was printed (the port-bound check turns true before the READY payload is built), and the sync proof
route made the event loop import anyio's asyncio backend and start the first worker thread while the prewarm imported
scipy. On the first start after a Windows Defender signature update that took longer than the shell waits (2 s).

What is proved here:
- the proof route is a coroutine function that needs no worker thread, no lazy import and no file read: the identity
  fields are read once when the app is built;
- the lifespan warms the worker thread pool before the server listens;
- the prewarm's start gate opens only after READY and the first answered proof in desktop mode, and also a few seconds
  after READY in launcher and browser modes, where no proof may come;
- through the real start path (`python -m nq_terminal`'s `serve`, hidden, its own state folder under D:/dev/tmp, the
  prewarm's tasks replaced by stand-ins that read nothing): the first task starts after the READY line and after the
  first proof was sent in full; a proof sent at READY answers within 250 ms while the stand-in task would hold the
  interpreter lock; a launcher start with no proof begins the prewarm `PROOF_FALLBACK_S` after READY;
- the trim stages agree with what the docstrings say: only the later prewarm stage trims (kept as measured in 0.2.0).

Nothing here touches 127.0.0.1:8765, reads a price or starts a real prewarm task.
"""
from __future__ import annotations

import dataclasses
import inspect
import json
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from nq_terminal import __main__ as launcher
from nq_terminal import app as app_module
from nq_terminal import memtrim
from nq_terminal.api import desktop as desktop_api
from nq_terminal.api import home_prewarm
from nq_terminal.app import create_app
from nq_terminal.desktop import handshake, lifecycle
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.services import prewarm
from nq_terminal.services.prewarm import PROOF_FALLBACK_S, START_GATE_KEY, StartGate
from nq_terminal.settings import load_settings

from conftest import (LOCAL, LOOPBACK, WindowWatch, api_client, bare_client, desktop_env, fresh_lock_dir,
                      remove_lock_dir, spawn_backend, wait_until)

TOKEN = "4d" * 32
NONCE = "e1" * 32
PORT = 8797
PROOF_BUDGET_S = 0.25  # the first proof at READY, with a busy prewarm waiting
STAMP_WAIT_S = 20.0
NO_PROOF_HOLD_S = 1.5  # how long the desktop test waits after READY before it proves


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def app(tmp_path):
    made = create_app(dataclasses.replace(load_settings({}), port=PORT, web_dist=tmp_path / "no_dist"))
    lifecycle.set_runtime(made, Runtime(token=TOKEN, port=PORT, pid=4121, mode="desktop"))
    return made


@pytest.fixture
def fresh_prewarm(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(prewarm, "_started", False)
    for name in (prewarm.ENV_DESKTOP, prewarm.ENV_PREWARM):
        monkeypatch.delenv(name, raising=False)


# ---------------------------------------------------------------- the proof route needs no worker thread


def test_the_proof_route_needs_no_threadpool(app, monkeypatch):
    """Born failing on the sync route: FastAPI ran it through `run_in_threadpool`, which on a first start imported
    anyio's backend and started a thread on the event loop's time."""
    assert inspect.iscoroutinefunction(desktop_api.desktop_proof)

    def no_thread(*args, **kwargs):
        raise AssertionError("the proof used the worker thread pool")

    monkeypatch.setattr("fastapi.routing.run_in_threadpool", no_thread)
    monkeypatch.setattr("fastapi.dependencies.utils.run_in_threadpool", no_thread)
    monkeypatch.setattr("starlette.background.run_in_threadpool", no_thread)
    monkeypatch.setattr("anyio.to_thread.run_sync", no_thread)
    r = bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert handshake.verify_proof(r.json(), TOKEN, NONCE, PORT) is True


def test_the_proof_answers_from_the_identity_read_when_the_app_was_built(app, monkeypatch):
    """No file read and no path resolution while answering: the contract number and the roots were read at build."""
    expected = handshake.identity(app.state.settings)

    def no_read(*args, **kwargs):
        raise AssertionError("the proof read its identity while answering")

    monkeypatch.setattr(handshake, "identity", no_read)
    monkeypatch.setattr(handshake, "contract_number", no_read)
    body = bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE}).json()
    assert list(body) == ["proof", "root", "prefix", "contract", "pid"]
    assert (body["root"], body["prefix"], body["contract"], body["pid"]) == (
        expected["root"], expected["prefix"], expected["contract"], 4121)


def test_replaced_settings_are_read_again_rather_than_answered_stale(app, tmp_path):
    replaced = dataclasses.replace(app.state.settings, root=tmp_path)
    app.state.settings = replaced
    body = bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE}).json()
    assert body["root"] == str(tmp_path)


def test_a_sent_answer_marks_the_start_gate_and_a_refused_one_does_not(app):
    gate = StartGate()
    setattr(app.state, START_GATE_KEY, gate)
    client = bare_client(app)
    assert client.get("/api/desktop/proof", params={"nonce": "x"}).status_code == 422
    assert gate.proved is False
    assert client.get("/api/desktop/proof", params={"nonce": NONCE}).status_code == 200
    assert gate.proved is True


def test_a_proof_without_a_gate_still_answers(app):
    assert getattr(app.state, START_GATE_KEY, None) is None
    assert bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE}).status_code == 200


# ---------------------------------------------------------------- the lifespan warms the worker pool before READY


def test_the_lifespan_warms_the_worker_pool_before_the_prewarm_starts(app, monkeypatch):
    order: list[str] = []

    class FakeToThread:
        @staticmethod
        async def run_sync(fn, *args, **kwargs):
            order.append("warm")
            return fn(*args)

    monkeypatch.setattr(app_module, "to_thread", FakeToThread)
    monkeypatch.setattr(app_module, "start_home_prewarm", lambda started: order.append("prewarm"))
    with api_client(app, base_url=LOCAL, client=LOOPBACK):
        pass
    assert order == ["warm", "prewarm"]


def test_a_failing_warm_up_is_logged_and_the_app_still_starts(app, monkeypatch, caplog):
    class Broken:
        @staticmethod
        async def run_sync(fn, *args, **kwargs):
            raise RuntimeError("no thread for you")

    monkeypatch.setattr(app_module, "to_thread", Broken)
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as client:
        assert client.get("/api/health").status_code == 200
    assert "could not be warmed" in caplog.text


# ---------------------------------------------------------------- the start gate


def test_the_desktop_gate_opens_only_after_ready_and_the_first_proof():
    clock = Clock()
    gate = StartGate(fallback_s=None, clock=clock)
    assert gate() is False
    gate.mark_proof()  # a proof before READY (no shell can know the port yet) opens nothing on its own
    assert gate() is False
    gate.mark_ready()
    assert gate() is True
    later = StartGate(fallback_s=None, clock=clock)
    later.mark_ready()
    clock.now += 600.0
    assert later() is False  # no fallback in desktop mode: the prewarm's own ready_timeout is the net
    later.mark_proof()
    assert later() is True


def test_the_launcher_and_browser_fallback_starts_the_prewarm_without_a_proof():
    clock = Clock()
    gate = StartGate(fallback_s=PROOF_FALLBACK_S, clock=clock)
    clock.now += 10 * PROOF_FALLBACK_S
    assert gate() is False  # the fallback counts from READY, not from the gate's making
    gate.mark_ready()
    clock.now += PROOF_FALLBACK_S - 0.01
    assert gate() is False
    clock.now += 0.01
    assert gate() is True
    early = StartGate(fallback_s=PROOF_FALLBACK_S, clock=clock)
    early.mark_ready()
    early.mark_proof()
    assert early() is True  # a proof that does come opens it at once


@pytest.mark.parametrize(("env", "fallback"), [
    ({"NQT_DESKTOP": "1"}, None),
    ({"NQT_STDIN_CONTROL": "1", "NQT_PORT": "9002"}, PROOF_FALLBACK_S),
    ({"NQT_PORT": "9003"}, PROOF_FALLBACK_S),
])
def test_the_launcher_makes_the_gate_for_its_mode(env, fallback):
    assert launcher.start_gate(load_settings(env)).fallback_s == fallback
    assert 1.0 <= PROOF_FALLBACK_S <= 5.0  # "a few seconds"


def test_the_prewarm_prefers_the_gate_over_the_port_bound_check():
    gate = StartGate()
    bound = lambda: True  # noqa: E731
    state = type("State", (), {})()
    setattr(state, prewarm.PORT_BOUND_KEY, bound)
    assert home_prewarm.start_check(state) is bound
    setattr(state, START_GATE_KEY, gate)
    assert home_prewarm.start_check(state) is gate


def test_the_prewarm_thread_waits_for_the_gate(fresh_prewarm):
    gate = StartGate()
    ran = threading.Event()
    thread = prewarm.start_prewarm([lambda: ran.set()], True, ready=gate, ready_timeout=STAMP_WAIT_S)
    assert thread is not None
    gate.mark_ready()
    assert ran.wait(0.4) is False
    gate.mark_proof()
    assert ran.wait(5.0) is True
    thread.join(5.0)


# ---------------------------------------------------------------- the trim stages agree with the docstrings


def test_only_the_later_prewarm_stage_trims_as_the_docstrings_say(monkeypatch):
    """Kept as measured in 0.2.0: the later stage trims, the HOME tasks stage does not; the quiet trim runs either
    way."""
    trimmed: list[str] = []
    monkeypatch.setattr(memtrim, "stage_hook", lambda app: trimmed.append)
    hook = home_prewarm._trim_after(object())
    hook(prewarm.STAGE_TASKS)
    hook(prewarm.STAGE_LATER)
    assert trimmed == [prewarm.STAGE_LATER]
    assert home_prewarm.TRIM_STAGES == frozenset({prewarm.STAGE_LATER})
    for doc in (memtrim.__doc__, home_prewarm.__doc__, prewarm.__doc__):
        assert "TRIM_STAGES" in doc and "later" in doc


# ---------------------------------------------------------------- through the real start path (Windows)

DRIVER = r'''
import sys
import time

import nq_terminal.__main__ as entry
from nq_terminal.api import home_prewarm
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

KIND, CHUNK = sys.argv[1], int(sys.argv[2])
HOG_S = 4.0


def stamp(label):
    print("STAMP " + label + " " + repr(time.monotonic()), flush=True)


def record():
    stamp("TASK")


def hog():
    """Holds the interpreter lock in long C calls, as an import under a file rescan does."""
    stamp("TASK")
    end = time.monotonic() + HOG_S
    while time.monotonic() < end:
        sum(range(CHUNK))
    stamp("HOGDONE")


home_prewarm.home_tasks = lambda state: [hog if KIND == "busy" else record]
home_prewarm.later_tasks = lambda state: []
plain_say = entry._say


def say(line):
    plain_say(line)
    if line.startswith("NQT-READY"):
        stamp("READY")


entry._say = say


class ProofSent:
    """Outermost: stamps the moment the proof's last body chunk has been handed to the server."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") != "/api/desktop/proof":
            await self.app(scope, receive, send)
            return

        async def sending(message):
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                stamp("PROOFSENT")

        await self.app(scope, receive, sending)


def build(settings):
    made = create_app(settings)
    made.add_middleware(ProofSent)
    return made


sys.exit(entry.serve(load_settings(), build))
'''
HOG_CHUNK = 60_000_000  # sum(range(n)) holds the lock for about 0.45 s per call on the build machine


def stamps(backend) -> dict[str, float]:
    found: dict[str, float] = {}
    for line in list(backend.stdout_lines):
        if line.startswith("STAMP "):
            _, label, value = line.split(" ", 2)
            found.setdefault(label, float(value))
    return found


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert port != 8765
    return port


def prove(port: int) -> tuple[dict, float]:
    began = time.perf_counter()
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/desktop/proof?nonce={NONCE}", timeout=30) as answer:
        body = json.loads(answer.read())
    return body, time.perf_counter() - began


def start_env(folder: Path, mode: str) -> dict[str, str]:
    env = desktop_env(folder)
    env.update({"NQT_PREWARM": "1", "NQT_MEMTRIM": "0"})
    if mode == "launcher":
        env.pop("NQT_DESKTOP")
        env.update({"NQT_STDIN_CONTROL": "1", "NQT_PORT": str(free_port())})
    return env


@pytest.fixture
def started(request):
    """Start the driver hidden under the window watch; yield a function that starts it once with (kind, mode)."""
    made = []
    watch = WindowWatch().start()

    def start(kind: str, mode: str = "desktop"):
        folder = fresh_lock_dir(f"v021-{kind}-{mode}")
        backend = spawn_backend(["-c", DRIVER, kind, str(HOG_CHUNK)], start_env(folder, mode), token=TOKEN,
                                nonce=NONCE)
        made.append((backend, folder))
        kind_line, payload = backend.first_nqt_line()
        assert kind_line == "NQT-READY", backend.stderr_text()
        assert wait_until(lambda: "READY" in stamps(backend), STAMP_WAIT_S)
        return backend, payload

    try:
        yield start
    finally:
        for backend, folder in made:
            backend.stop()
            remove_lock_dir(folder)
        problems = watch.stop()
        assert not problems, problems


windows_only = pytest.mark.skipif(sys.platform != "win32", reason="the Windows start path")


@windows_only
def test_the_prewarm_starts_only_after_ready_and_the_first_proof(started):
    """Born failing: the prewarm began on the port-bound check, before READY was printed and before any proof."""
    backend, ready = started("record")
    time.sleep(NO_PROOF_HOLD_S)
    assert "TASK" not in stamps(backend), "the prewarm started before the first proof"
    body, _ = prove(ready["port"])
    assert handshake.verify_proof(body, TOKEN, NONCE, ready["port"]) is True
    assert wait_until(lambda: "TASK" in stamps(backend), STAMP_WAIT_S), backend.stderr_text()
    seen = stamps(backend)
    assert seen["READY"] < seen["PROOFSENT"] <= seen["TASK"], seen
    assert seen["TASK"] - seen["READY"] >= NO_PROOF_HOLD_S


@windows_only
def test_the_first_proof_at_ready_answers_within_250_ms_with_a_busy_prewarm_waiting(started):
    """Born failing: the busy stand-in task already held the interpreter lock when the shell's first proof came."""
    backend, ready = started("busy")
    body, took = prove(ready["port"])
    assert handshake.verify_proof(body, TOKEN, NONCE, ready["port"]) is True
    assert took < PROOF_BUDGET_S, f"the first proof took {took * 1000:.0f} ms; {stamps(backend)}"
    assert wait_until(lambda: "TASK" in stamps(backend), STAMP_WAIT_S)  # and the prewarm did start after it
    seen = stamps(backend)
    assert seen["PROOFSENT"] <= seen["TASK"], seen


@windows_only
def test_a_launcher_start_with_no_proof_begins_the_prewarm_a_few_seconds_after_ready(started):
    """Born failing: the prewarm began before READY; now the launcher's fallback starts it PROOF_FALLBACK_S later."""
    backend, ready = started("record", mode="launcher")
    assert ready["mode"] == "launcher" and ready["port"] != 8765
    assert wait_until(lambda: "TASK" in stamps(backend), STAMP_WAIT_S), backend.stderr_text()
    seen = stamps(backend)
    assert "PROOFSENT" not in seen
    assert PROOF_FALLBACK_S - 0.05 <= seen["TASK"] - seen["READY"] <= PROOF_FALLBACK_S + 2.0, seen
