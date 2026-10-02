"""D2.1 (03 sections 2.2 and 2.4, Appendix A row 2): the start path, the handshake line and the stdin channel.

A backend the app starts runs `python -E -s -X utf8 -m nq_terminal` with NQT_DESKTOP=1: it binds 127.0.0.1:0 itself,
reads `TOKEN <hex>` and `NONCE <hex>` once each from stdin, takes the lock in the app's start-up and then prints one
`NQT-READY {json}` line whose proof is HMAC-SHA256(token, 'ready'|nonce|port|pid). End of file on stdin calls
`watchdog.on_eof()`, which stops the server. A second start beside a live lock prints `NQT-ATTACH {"port": P}` and
exits 0 without binding. Uvicorn started directly never reads stdin.

The subprocess tests start real backends through `.venv/Scripts/python.exe` (a venv launcher whose child is the real
interpreter) on port 0 with a temporary NQT_STATE_DIR under D:/dev/tmp, NQT_JOBS=off and NQT_PREWARM=0, hidden
(CREATE_NO_WINDOW) and under the window watch. They never touch 127.0.0.1:8765.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import socket
import subprocess
import sys
import textwrap
import threading
import time
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal import __main__ as launcher
from nq_terminal.desktop import handshake, lock, watchdog
from nq_terminal.desktop.handshake import StdinChannel
from nq_terminal.settings import TERMINAL_DIR, load_settings

from conftest import (BACKEND, PY, WindowWatch, desktop_env, image_path, parent_pid, process_strings, spawn_backend,
                      wait_until)

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows start path")

TOKEN = "5a" * 32
NONCE = "3c" * 32
HEX64 = re.compile(r"^[0-9a-f]{64}$")
OPENAPI = TERMINAL_DIR / "contract" / "openapi.json"
READY_KEYS = ["v", "port", "pid", "proof", "root", "prefix", "nq_lab", "nq_terminal", "contract", "openapi_sha256",
              "dist", "mode"]


@pytest.fixture(scope="module")
def running():
    """One desktop backend for the read-only checks of this module."""
    from conftest import fresh_lock_dir, remove_lock_dir

    folder = fresh_lock_dir("handshake")
    watch = WindowWatch().start()
    backend = spawn_backend(["-m", "nq_terminal"], desktop_env(folder), token=TOKEN, nonce=NONCE)
    try:
        kind, _ = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
        yield backend, folder
    finally:
        backend.stop()
        problems = watch.stop()
        remove_lock_dir(folder)
        assert not problems, problems


# ---------------------------------------------------------------- the READY line

def test_ready_is_the_first_nqt_line_and_carries_every_field_in_order(running):
    backend, _ = running
    assert backend.nqt_lines[0].startswith("NQT-READY {")
    assert list(backend.ready) == READY_KEYS
    ready = backend.ready
    assert ready["v"] == 1 and ready["mode"] == "desktop" and ready["port"] > 0 and ready["port"] != 8765
    assert Path(ready["root"]) == ROOT and Path(ready["prefix"]) == ROOT / ".venv"
    assert Path(ready["nq_terminal"]) == BACKEND / "nq_terminal"
    assert Path(ready["nq_lab"]) == ROOT / "src" / "nq_lab"
    assert isinstance(ready["contract"], int) and ready["contract"] >= 1
    assert HEX64.match(ready["openapi_sha256"]) and ready["openapi_sha256"] == hashlib.sha256(
        OPENAPI.read_bytes()).hexdigest()
    assert ready["dist"] in {"current", "stale", "missing"} and HEX64.match(ready["proof"])


def test_the_ready_hmac_verifies_and_a_wrong_nonce_or_token_fails(running):
    ready = running[0].ready
    assert handshake.verify_ready(ready, TOKEN, NONCE) is True
    assert handshake.verify_ready(ready, TOKEN, "3d" * 32) is False
    assert handshake.verify_ready(ready, "5b" * 32, NONCE) is False
    assert handshake.verify_ready({**ready, "port": ready["port"] + 1}, TOKEN, NONCE) is False
    assert handshake.verify_ready({**ready, "pid": ready["pid"] + 1}, TOKEN, NONCE) is False


def test_the_lock_names_the_real_interpreter_not_the_venv_launcher(running):
    backend, folder = running
    info = lock.read_info(folder)
    assert (info.pid, info.port, info.token) == (backend.ready["pid"], backend.ready["port"], TOKEN)
    assert backend.ready["pid"] != backend.proc.pid  # .venv/Scripts/python.exe is a launcher
    assert parent_pid(backend.ready["pid"]) == backend.proc.pid
    assert Path(image_path(backend.proc.pid)) == PY
    assert Path(image_path(backend.ready["pid"])) != PY and Path(image_path(backend.ready["pid"])).name == "python.exe"


def test_the_token_is_in_no_argv_and_no_environment(running):
    backend, _ = running
    for pid in (backend.proc.pid, backend.ready["pid"]):
        command_line, environment = process_strings(pid)
        assert "nq_terminal" in command_line and "NQT_STATE_DIR=" in environment  # the reader works
        assert TOKEN not in command_line and TOKEN not in environment
        assert TOKEN.upper() not in command_line.upper() and TOKEN.upper() not in environment.upper()


def test_the_token_never_appears_on_the_backends_output(running):
    backend, _ = running
    assert TOKEN not in "\n".join(backend.stdout_lines) and TOKEN not in backend.stderr_text()


def test_the_process_reader_is_born_failing():
    """A child given the token in its environment and its argv is caught by the same reader."""
    env = {**os.environ, "NQT_CANARY": TOKEN}
    # The child says it is up before the reader looks: a process still starting has no parameter block to read yet
    # (ReadProcessMemory error 299 under load).
    child = subprocess.Popen([str(PY), "-c", "import sys; print('up', flush=True); sys.stdin.read()", TOKEN], env=env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        assert child.stdout.readline().strip() == b"up"
        pid = child.pid
        command_line, environment = process_strings(pid)
        assert TOKEN in command_line and f"NQT_CANARY={TOKEN}" in environment
    finally:
        child.stdin.close()
        child.wait(timeout=30)
        child.stdout.close()


def test_a_held_lock_makes_a_second_start_attach_and_exit_0(running):
    backend, folder = running
    second = spawn_backend(["-m", "nq_terminal"], desktop_env(folder), token="77" * 32, nonce="88" * 32)
    try:
        kind, payload = second.first_nqt_line()
        assert (kind, payload) == ("NQT-ATTACH", {"port": backend.ready["port"]})
        assert second.wait_exit() == 0
        assert not any(line.startswith("NQT-READY") for line in second.stdout_lines)
    finally:
        second.stop()
    assert lock.read_info(folder).pid == backend.ready["pid"]


# ---------------------------------------------------------------- end of file, and starts without a token

@pytest.mark.usefixtures("window_watch")
def test_end_of_file_on_stdin_stops_the_backend_and_releases_the_lock(lock_dir):
    backend = spawn_backend(["-m", "nq_terminal"], desktop_env(lock_dir), token=TOKEN, nonce=NONCE)
    try:
        assert backend.first_nqt_line()[0] == "NQT-READY"
        backend.proc.stdin.close()
        started = time.monotonic()
        assert backend.wait_exit(timeout=15) == 0, backend.stderr_text()
        assert time.monotonic() - started < 5.0
    finally:
        backend.stop()
    assert not (lock_dir / "backend.lock").exists()


@pytest.mark.usefixtures("window_watch")
def test_a_desktop_start_without_a_token_refuses_to_serve(lock_dir):
    backend = spawn_backend(["-m", "nq_terminal"], desktop_env(lock_dir))
    try:
        backend.proc.stdin.close()
        assert backend.wait_exit(timeout=60) == launcher.EXIT_NO_TOKEN
        assert backend.nqt_lines == []
    finally:
        backend.stop()
    assert not (lock_dir / "backend.lock").exists()


MINI_APP = textwrap.dedent("""
    from fastapi import FastAPI
    from nq_terminal.desktop import lifecycle
    from nq_terminal.settings import load_settings


    def build():
        settings = load_settings()
        app = FastAPI()
        lifecycle.install(app, settings)
        return app
""")


@pytest.mark.usefixtures("window_watch")
@pytest.mark.parametrize("target", ["nq_terminal.app:create_app", "mini_app:build"])
def test_uvicorn_started_directly_never_reads_stdin(lock_dir, target):
    (lock_dir / "mini_app.py").write_text(MINI_APP, encoding="utf-8")
    env = {**desktop_env(lock_dir), "NQT_STDIN_CONTROL": "1"}
    env.pop("NQT_DESKTOP")
    env.pop("NQT_PORT")
    args = ["-m", "uvicorn", target, "--factory", "--app-dir", str(lock_dir), "--host", "127.0.0.1", "--port", "0"]
    backend = spawn_backend(args, env)
    try:
        backend.proc.stdin.close()  # end of file at once
        assert wait_until(lambda: "Uvicorn running on http://127.0.0.1:" in backend.stderr_text(), 90), \
            backend.stderr_text()
        time.sleep(1.5)
        assert backend.proc.poll() is None, backend.stderr_text()
    finally:
        backend.stop(kill=True)


# ---------------------------------------------------------------- the attach path binds nothing (in process)

def test_a_live_lock_makes_main_print_attach_and_return_0_before_binding(lock_dir, monkeypatch, capsys):
    def refuse(*_args, **_kwargs):
        raise AssertionError("bound or served beside a live lock")

    monkeypatch.setattr(launcher, "bind_socket", refuse)
    monkeypatch.setattr(launcher.uvicorn, "Server", refuse)
    monkeypatch.setattr(launcher, "create_app", refuse)
    env = {"NQT_DESKTOP": "1", "NQT_STATE_DIR": str(lock_dir)}
    with lock.acquire(lock_dir, port=53210, token=TOKEN, root=ROOT):
        assert launcher.main(env) == 0
    out = capsys.readouterr().out.splitlines()
    assert out == ['NQT-ATTACH {"port":53210}']


class RecordingServer:
    """Stands in for uvicorn.Server: records the sockets it is handed and binds nothing itself."""
    runs: list = []

    def __init__(self, config):
        self.config = config
        self.should_exit = False

    def run(self, sockets=None):
        type(self).runs.append(sockets)


def _port_held_like_uvicorn_binds() -> tuple[socket.socket, int]:
    """A listening loopback socket set up the way uvicorn sets up its own (SO_REUSEADDR), on a free port."""
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    holder.bind(("127.0.0.1", 0))
    holder.listen()
    return holder, holder.getsockname()[1]


@pytest.mark.parametrize("extra", [{}, {"NQT_STDIN_CONTROL": "1"}], ids=["browser", "launcher"])
def test_a_busy_fixed_port_is_refused_not_shared_in_every_mode(lock_dir, monkeypatch, extra):
    """The launchers' fixed port is bound exclusively too: uvicorn's own SO_REUSEADDR bind would share it on Windows."""
    RecordingServer.runs = []
    monkeypatch.setattr(launcher.uvicorn, "Server", RecordingServer)
    holder, port = _port_held_like_uvicorn_binds()
    env = {"NQT_PORT": str(port), "NQT_STATE_DIR": str(lock_dir), "NQT_JOBS": "off", **extra}
    try:
        if extra:  # launcher mode reads TOKEN and NONCE: give them at once on a stand-in stdin
            monkeypatch.setattr(launcher, "_channel", lambda settings: _channel(f"TOKEN {TOKEN}\nNONCE {NONCE}\n"))
        with pytest.raises(OSError):
            launcher.main(env)
    finally:
        holder.close()
    assert RecordingServer.runs == []


@pytest.mark.parametrize("extra", [{}, {"NQT_STDIN_CONTROL": "1"}], ids=["browser", "launcher"])
def test_the_fixed_port_socket_is_bound_exclusively_and_handed_to_the_server(lock_dir, monkeypatch, extra):
    RecordingServer.runs = []
    monkeypatch.setattr(launcher.uvicorn, "Server", RecordingServer)
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    env = {"NQT_PORT": str(port), "NQT_STATE_DIR": str(lock_dir), "NQT_JOBS": "off", **extra}
    if extra:
        monkeypatch.setattr(launcher, "_channel", lambda settings: _channel(f"TOKEN {TOKEN}\nNONCE {NONCE}\n"))
    assert launcher.main(env) == 0
    (sockets,) = RecordingServer.runs
    try:
        assert sockets is not None and len(sockets) == 1 and sockets[0].getsockname() == ("127.0.0.1", port)
        assert sockets[0].getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE) == 1
    finally:
        for sock in sockets or []:
            sock.close()


def test_a_launcher_run_that_returns_leaves_no_hard_exit_armed(lock_dir, monkeypatch):
    """The hard exit (end of file on stdin ends the process within 5 s) belongs to the run of the server: once the
    run is over it is disarmed, so a later end of file in the same process (a test runner) never ends that process."""
    RecordingServer.runs = []
    monkeypatch.setattr(launcher.uvicorn, "Server", RecordingServer)
    armed_during: list[bool] = []
    monkeypatch.setattr(RecordingServer, "run", lambda self, sockets=None: armed_during.append(watchdog.hard_exit_armed()))
    monkeypatch.setattr(launcher, "_channel", lambda settings: _channel(f"TOKEN {TOKEN}\nNONCE {NONCE}\n"))
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    env = {"NQT_PORT": str(port), "NQT_STATE_DIR": str(lock_dir), "NQT_JOBS": "off", "NQT_STDIN_CONTROL": "1"}
    watchdog.disarm_hard_exit()
    try:
        launcher.main(env)
        assert armed_during == [True]  # armed while the server runs ...
        assert watchdog.hard_exit_armed() is False  # ... and not after it
    finally:
        watchdog.disarm_hard_exit()


def test_a_second_bind_of_the_launcher_port_is_refused():
    first = launcher.bind_socket(load_settings({"NQT_DESKTOP": "1"}))  # port 0: any free port
    port = first.getsockname()[1]
    try:
        with pytest.raises(OSError):
            launcher.bind_socket(load_settings({"NQT_PORT": str(port)}))
    finally:
        first.close()


def test_the_desktop_socket_is_bound_on_loopback_port_0_exclusively():
    sock = launcher.bind_socket(load_settings({"NQT_DESKTOP": "1"}))
    try:
        host, port = sock.getsockname()
        assert host == "127.0.0.1" and port not in (0, 8765)
        assert sock.getsockopt(launcher.socket.SOL_SOCKET, launcher.socket.SO_EXCLUSIVEADDRUSE) == 1
    finally:
        sock.close()


# ---------------------------------------------------------------- the stdin channel (unit)

def _channel(text: str, on_eof=None) -> StdinChannel:
    return StdinChannel(io.BytesIO(text.encode("ascii")), on_eof=on_eof or (lambda: None)).start()


def test_the_channel_reads_token_and_nonce_once_each():
    eof = threading.Event()
    channel = _channel(f"TOKEN {TOKEN}\nNONCE {NONCE}\n", on_eof=eof.set)
    assert channel.wait(5) == (TOKEN, NONCE)
    assert eof.wait(5)


def test_the_channel_lowercases_and_accepts_crlf():
    channel = _channel(f"TOKEN {TOKEN.upper()}\r\nNONCE {NONCE}\r\n")
    assert channel.wait(5) == (TOKEN, NONCE)


@pytest.mark.parametrize("text", [
    f"TOKEN {TOKEN}\nTOKEN {'99' * 32}\nNONCE {NONCE}\n",   # a second token is ignored
    f"HELLO\nTOKEN {TOKEN}\nEXIT\nNONCE {NONCE}\n",          # anything else is ignored
    f"TOKEN {TOKEN[:-2]}\nTOKEN {TOKEN}\nNONCE {NONCE}\n",    # a short value is refused
    f"TOKEN {TOKEN}zz\nTOKEN {TOKEN}\nNONCE {NONCE}\n",       # a non-hex value is refused
])
def test_the_channel_keeps_the_first_good_value_and_nothing_else(text):
    assert _channel(text).wait(5) == (TOKEN, NONCE)


def test_the_channel_reports_end_of_file_before_both_values():
    eof = threading.Event()
    channel = _channel(f"TOKEN {TOKEN}\n", on_eof=eof.set)
    assert channel.wait(5) is None
    assert eof.wait(5)


def test_the_channel_never_echoes_what_it_refused(capsys):
    _channel(f"TOKEN {TOKEN}x\nNONCE {NONCE}\n").wait(5)
    captured = capsys.readouterr()
    assert TOKEN not in captured.out + captured.err


def test_watchdog_on_eof_runs_the_close_hooks_once_each_in_order():
    seen: list[str] = []
    first, second = (lambda: seen.append("a")), (lambda: seen.append("b"))
    watchdog.add_close_hook(first)
    watchdog.add_close_hook(second)
    try:
        watchdog.on_eof()
    finally:
        watchdog.remove_close_hook(first)
        watchdog.remove_close_hook(second)
    assert seen == ["a", "b"]


def test_a_failing_close_hook_does_not_stop_the_next():
    seen: list[str] = []

    def broken() -> None:
        raise RuntimeError("boom")

    def later() -> None:
        seen.append("later")

    watchdog.add_close_hook(broken)
    watchdog.add_close_hook(later)
    try:
        watchdog.on_eof()
    finally:
        watchdog.remove_close_hook(broken)
        watchdog.remove_close_hook(later)
    assert seen == ["later"]


# ---------------------------------------------------------------- the line formats (unit)

def test_ready_and_proof_macs_are_domain_separated():
    ready = handshake.mac(TOKEN, handshake.READY, NONCE, 53117, 4120)
    proof = handshake.mac(TOKEN, handshake.PROOF, NONCE, 53117, 4120)
    assert ready != proof and HEX64.match(ready) and HEX64.match(proof)


def test_the_lines_parse_back():
    assert handshake.parse_line('NQT-ATTACH {"port":53117}') == ("NQT-ATTACH", {"port": 53117})
    assert handshake.attach_line(53117) == 'NQT-ATTACH {"port":53117}'
    assert handshake.parse_line("INFO: Started server process") is None
    assert handshake.parse_line("NQT-READY not json") is None
    assert json.loads(handshake.ready_line({"v": 1}).removeprefix("NQT-READY ")) == {"v": 1}
