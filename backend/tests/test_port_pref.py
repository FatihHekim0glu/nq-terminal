"""The preferred desktop port (startup.md 7.5, option a; wave w4a-startup-page, slice page-cache; owner decision O19).

With the setting on (`<state>/port_pref.json` holding `{"preferred_port": true}`), a desktop backend binds the port it
last bound (`<state>/last_port.json`) when that port is free, else port 0, always with exclusive use and before the app
is built. The setting is off unless that file says exactly so; off means port 0 every time and no file written. 8765,
the Vite dev port, the IB ports and any port outside 49152 to 65535 are never chosen and never recorded. The launchers
and the browser form keep their fixed port whatever the setting says.
"""
from __future__ import annotations

import dataclasses
import io
import json
import random
import socket
import types
from pathlib import Path

import pytest

from nq_terminal import __main__ as launcher
from nq_terminal.desktop import port_pref, watchdog
from nq_terminal.desktop.handshake import StdinChannel
from nq_terminal.settings import load_settings

from conftest import Backend, desktop_env, spawn_backend

TOKEN = "5a" * 32
NONCE = "3c" * 32
SETTING = "port_pref.json"
RECORD = "last_port.json"
ON = {"preferred_port": True}


def free_port_in_range() -> int:
    """A loopback port in 49152 to 65535 that an exclusive bind takes now (and that is then released)."""
    for _ in range(200):
        port = random.randrange(49152, 65536)
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind(("127.0.0.1", port))
        except OSError:
            continue
        finally:
            probe.close()
        return port
    raise AssertionError("no free port in the dynamic range")


def write_json(folder: Path, name: str, value: object) -> Path:
    path = folder / name
    path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
    return path


def desktop(folder: Path, **changes):
    return dataclasses.replace(load_settings({"NQT_DESKTOP": "1"}), state_dir=folder, **changes)


class Binder:
    """The real exclusive bind, recording the port each call asked for."""

    def __init__(self) -> None:
        self.asked: list[int] = []

    def __call__(self, settings):
        self.asked.append(settings.port)
        return launcher.bind_socket(settings)


def bound(settings) -> tuple[int, list[int]]:
    binder = Binder()
    sock = port_pref.bind(settings, binder)
    try:
        assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE) == 1
        return sock.getsockname()[1], binder.asked
    finally:
        sock.close()


# ---------------------------------------------------------------- 8765 and ports outside the range are refused

@pytest.mark.parametrize("port", [8765, 5173, 4001, 4002, 7496, 7497, 0, 1, 1023, 49151, 65536, 70000, -1])
def test_born_failing_a_port_outside_the_range_or_a_named_port_is_refused(port):
    assert port_pref.is_allowed(port) is False


@pytest.mark.parametrize("port", [True, "50000", 50000.0, None])
def test_born_failing_a_port_that_is_not_an_int_is_refused(port):
    assert port_pref.is_allowed(port) is False


@pytest.mark.parametrize("port", [49152, 50000, 65535])
def test_a_port_in_the_dynamic_range_is_allowed(port):
    assert port_pref.is_allowed(port) is True


@pytest.mark.parametrize("recorded", [8765, 5173, 7497, 49151, 70000, 0, "50000", True, None])
def test_born_failing_a_recorded_8765_or_out_of_range_port_is_never_bound(tmp_path, recorded):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": recorded})
    settings = desktop(tmp_path)
    assert port_pref.preferred(settings) is None
    port, asked = bound(settings)
    assert asked == [0] and port != 8765


@pytest.mark.parametrize("port", [8765, 5173, 49151, 65536])
def test_born_failing_8765_or_an_out_of_range_port_is_never_recorded(tmp_path, port):
    write_json(tmp_path, SETTING, ON)
    assert port_pref.remember(desktop(tmp_path), port) is False
    assert not (tmp_path / RECORD).exists()


def test_8765_can_never_be_chosen_even_from_a_planted_record_with_the_launcher_port(tmp_path):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": 8765})
    assert port_pref.preferred(desktop(tmp_path)) is None


# ---------------------------------------------------------------- the setting off: port 0 every time

@pytest.mark.parametrize("setting", [
    None,                              # no file: the default (O19)
    {"preferred_port": False},
    {"preferred_port": "true"},
    {"preferred_port": 1},
    {"preferred": True},
    [True],
    "true",
    "{not json",
    json.dumps({"preferred_port": True, "pad": "x" * 8192}),  # oversized: not read
], ids=["absent", "false", "string", "one", "other-key", "list", "bare-true", "malformed", "oversized"])
def test_born_failing_with_the_setting_off_the_port_is_0_every_time(tmp_path, setting):
    recorded = free_port_in_range()
    if setting is not None:
        write_json(tmp_path, SETTING, setting)
    write_json(tmp_path, RECORD, {"port": recorded})
    settings = desktop(tmp_path)
    assert port_pref.enabled(tmp_path) is False
    assert port_pref.preferred(settings) is None
    for _ in range(2):
        port, asked = bound(settings)
        assert asked == [0]
        assert port_pref.remember(settings, port) is False
    assert json.loads((tmp_path / RECORD).read_text(encoding="utf-8")) == {"port": recorded}  # never rewritten


def test_with_the_setting_off_no_record_is_ever_written(tmp_path):
    settings = desktop(tmp_path)
    port, asked = bound(settings)
    assert asked == [0]
    assert port_pref.remember(settings, port) is False
    assert sorted(p.name for p in tmp_path.iterdir()) == []


@pytest.mark.parametrize("env", [{}, {"NQT_STDIN_CONTROL": "1"}], ids=["browser", "launcher"])
def test_the_launchers_and_the_browser_keep_their_fixed_port_whatever_the_setting(tmp_path, env):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": free_port_in_range()})
    settings = dataclasses.replace(load_settings(env), state_dir=tmp_path)
    assert settings.port == 8765
    assert port_pref.preferred(settings) is None
    assert port_pref.remember(settings, 50000) is False


def test_an_explicit_desktop_port_is_kept_whatever_the_setting(tmp_path):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": free_port_in_range()})
    explicit = free_port_in_range()
    settings = desktop(tmp_path, port=explicit)
    assert port_pref.preferred(settings) is None
    port, asked = bound(settings)
    assert asked == [explicit] and port == explicit


# ---------------------------------------------------------------- the setting on

def test_with_the_setting_on_the_last_bound_port_is_bound_again_exclusively(tmp_path):
    recorded = free_port_in_range()
    write_json(tmp_path, SETTING, ON)
    record = write_json(tmp_path, RECORD, {"port": recorded})
    before = record.stat().st_mtime_ns
    settings = desktop(tmp_path)
    port, asked = bound(settings)
    assert asked == [recorded] and port == recorded
    assert port_pref.remember(settings, port) is False  # unchanged: nothing written on a usual launch
    assert record.stat().st_mtime_ns == before


def test_with_the_setting_on_and_no_record_port_0_is_bound_and_then_recorded(tmp_path):
    write_json(tmp_path, SETTING, ON)
    settings = desktop(tmp_path)
    port, asked = bound(settings)
    assert asked == [0]
    if port_pref.is_allowed(port):  # the OS dynamic range is normally 49152 to 65535
        assert port_pref.remember(settings, port) is True
        assert json.loads((tmp_path / RECORD).read_text(encoding="utf-8")) == {"port": port}
        assert port_pref.preferred(settings) == port
    assert json.loads((tmp_path / SETTING).read_text(encoding="utf-8")) == ON  # the setting is never written


@pytest.mark.parametrize("record", ["{not json", "[]", json.dumps({"port": 50000, "pad": "x" * 8192})],
                         ids=["malformed", "list", "oversized"])
def test_an_unreadable_record_means_port_0_and_is_replaced(tmp_path, record):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, record)
    settings = desktop(tmp_path)
    assert port_pref.preferred(settings) is None
    assert port_pref.remember(settings, 50001) is True
    assert json.loads((tmp_path / RECORD).read_text(encoding="utf-8")) == {"port": 50001}
    assert sorted(p.name for p in tmp_path.iterdir()) == [RECORD, SETTING]  # no temporary file left behind


def test_born_failing_the_record_is_refused_inside_a_research_folder(tmp_path):
    state = tmp_path / "results" / "state"
    state.mkdir(parents=True)
    write_json(state, SETTING, ON)
    settings = desktop(state, root=tmp_path)
    assert port_pref.remember(settings, 50001) is False
    assert sorted(p.name for p in state.iterdir()) == [SETTING]  # neither the record nor a temporary file


def _fail_replace(_source, _target):
    raise PermissionError("replace refused")


def test_born_failing_a_failed_replace_returns_false_keeps_the_record_and_leaves_no_temporary_file(tmp_path, monkeypatch):
    write_json(tmp_path, SETTING, ON)
    record = write_json(tmp_path, RECORD, {"port": 50000})
    settings = desktop(tmp_path)
    monkeypatch.setattr(port_pref, "os", types.SimpleNamespace(replace=_fail_replace))
    assert port_pref.remember(settings, 50001) is False
    assert json.loads(record.read_text(encoding="utf-8")) == {"port": 50000}
    assert sorted(p.name for p in tmp_path.iterdir()) == [RECORD, SETTING]


def test_a_temporary_file_that_cannot_be_written_returns_false_and_keeps_the_record(tmp_path):
    write_json(tmp_path, SETTING, ON)
    record = write_json(tmp_path, RECORD, {"port": 50000})
    (tmp_path / port_pref.RECORD_TEMP_NAME).mkdir()  # a folder in the way: the write raises OSError
    assert port_pref.remember(desktop(tmp_path), 50001) is False
    assert json.loads(record.read_text(encoding="utf-8")) == {"port": 50000}


def _held(port: int, *, exclusive: bool) -> socket.socket:
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    option = socket.SO_EXCLUSIVEADDRUSE if exclusive else socket.SO_REUSEADDR
    holder.setsockopt(socket.SOL_SOCKET, option, 1)
    holder.bind(("127.0.0.1", port))
    holder.listen()
    return holder


@pytest.mark.parametrize("exclusive", [False, True], ids=["held-like-uvicorn", "held-exclusively"])
def test_born_failing_a_busy_preferred_port_falls_back_to_port_0(tmp_path, exclusive):
    recorded = free_port_in_range()
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": recorded})
    settings = desktop(tmp_path)
    holder = _held(recorded, exclusive=exclusive)
    try:
        port, asked = bound(settings)
    finally:
        holder.close()
    assert asked == [recorded, 0]
    assert port not in (recorded, 0, 8765)
    if port_pref.is_allowed(port):
        assert port_pref.remember(settings, port) is True  # the port it last bound
        assert port_pref.preferred(settings) == port


def test_a_failing_port_0_bind_is_still_raised(tmp_path):
    write_json(tmp_path, SETTING, ON)
    write_json(tmp_path, RECORD, {"port": free_port_in_range()})

    def refuse(_settings):
        raise OSError("no port")

    with pytest.raises(OSError):
        port_pref.bind(desktop(tmp_path), refuse)


# ---------------------------------------------------------------- the start path (in process, nothing served)

class RecordingServer:
    runs: list = []

    def __init__(self, config):
        self.config = config
        self.should_exit = False

    def run(self, sockets=None):
        type(self).runs.append(sockets)


def _channel(_settings) -> StdinChannel:
    return StdinChannel(io.BytesIO(f"TOKEN {TOKEN}\nNONCE {NONCE}\n".encode("ascii")), on_eof=lambda: None).start()


def _serve_desktop(state: Path, monkeypatch) -> int:
    RecordingServer.runs = []
    monkeypatch.setattr(launcher.uvicorn, "Server", RecordingServer)
    monkeypatch.setattr(launcher, "_channel", _channel)
    env = {"NQT_DESKTOP": "1", "NQT_STATE_DIR": str(state), "NQT_JOBS": "off", "NQT_PREWARM": "0"}
    try:
        assert launcher.main(env) == 0
    finally:
        watchdog.disarm_hard_exit()
    (sockets,) = RecordingServer.runs
    try:
        assert sockets[0].getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE) == 1
        return sockets[0].getsockname()[1]
    finally:
        for sock in sockets:
            sock.close()


def test_the_start_path_binds_the_preferred_port_before_the_app_is_built(lock_dir, monkeypatch):
    recorded = free_port_in_range()
    write_json(lock_dir, SETTING, ON)
    write_json(lock_dir, RECORD, {"port": recorded})
    built: list[int] = []
    real_create = launcher.create_app

    def create(settings):
        built.append(settings.port)
        return real_create(settings)

    monkeypatch.setattr(launcher, "create_app", create)
    assert _serve_desktop(lock_dir, monkeypatch) == recorded
    assert built == [recorded]  # the same-origin list names the bound port


def test_born_failing_the_start_path_records_the_port_it_bound(lock_dir, monkeypatch):
    write_json(lock_dir, SETTING, ON)
    port = _serve_desktop(lock_dir, monkeypatch)
    if port_pref.is_allowed(port):
        assert json.loads((lock_dir / RECORD).read_text(encoding="utf-8")) == {"port": port}


def test_regression_guard_the_start_path_with_the_setting_off_binds_port_0_and_writes_nothing(lock_dir, monkeypatch):
    recorded = free_port_in_range()
    record = write_json(lock_dir, RECORD, {"port": recorded})
    asked: list[int] = []
    real_bind = launcher.bind_socket

    def bind(settings):
        asked.append(settings.port)
        return real_bind(settings)

    monkeypatch.setattr(launcher, "bind_socket", bind)
    _serve_desktop(lock_dir, monkeypatch)
    assert asked == [0]
    assert json.loads(record.read_text(encoding="utf-8")) == {"port": recorded}


def test_born_failing_the_start_path_goes_on_when_the_record_cannot_be_written(lock_dir, monkeypatch):
    write_json(lock_dir, SETTING, ON)
    monkeypatch.setattr(port_pref, "os", types.SimpleNamespace(replace=_fail_replace))
    port = _serve_desktop(lock_dir, monkeypatch)  # exit code 0 and an exclusive socket, asserted inside
    assert port > 0
    assert not (lock_dir / RECORD).exists()
    assert not (lock_dir / port_pref.RECORD_TEMP_NAME).exists()


# ---------------------------------------------------------------- exit criterion 1, in real processes

SECOND_NONCE = "4d" * 32


def _start_ready(folder: Path, nonce: str) -> tuple[Backend, int]:
    """A real desktop backend on `folder`, waited on until its NQT-READY line; its READY port."""
    backend = spawn_backend(["-m", "nq_terminal"], desktop_env(folder), token=TOKEN, nonce=nonce)
    try:
        kind, payload = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
    except BaseException:
        backend.stop(kill=True)
        raise
    return backend, payload["port"]


def _assert_listening(port: int) -> None:
    """The READY port is the socket the backend really listens on."""
    with socket.create_connection(("127.0.0.1", port), timeout=10):
        pass


def _hold_exclusively(port: int) -> socket.socket:
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        holder.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        holder.bind(("127.0.0.1", port))
        holder.listen(1)
    except OSError:
        holder.close()
        raise
    return holder


@pytest.mark.usefixtures("window_watch")
def test_a_real_backend_keeps_its_port_across_two_launches_and_reports_it_in_ready_and_the_record(lock_dir):
    write_json(lock_dir, SETTING, ON)
    first, first_port = _start_ready(lock_dir, NONCE)
    try:
        _assert_listening(first_port)
        assert json.loads((lock_dir / RECORD).read_text(encoding="utf-8")) == {"port": first_port}
    finally:
        first.stop()
    second, second_port = _start_ready(lock_dir, SECOND_NONCE)
    try:
        assert second_port == first_port
        _assert_listening(second_port)
        assert json.loads((lock_dir / RECORD).read_text(encoding="utf-8")) == {"port": first_port}
    finally:
        second.stop()


@pytest.mark.usefixtures("window_watch")
def test_a_real_backend_whose_recorded_port_is_busy_reports_a_new_port_and_corrects_the_record(lock_dir):
    busy = free_port_in_range()
    write_json(lock_dir, SETTING, ON)
    write_json(lock_dir, RECORD, {"port": busy})
    holder = _hold_exclusively(busy)
    try:
        backend, port = _start_ready(lock_dir, NONCE)
        try:
            assert port != busy
            _assert_listening(port)
            assert json.loads((lock_dir / RECORD).read_text(encoding="utf-8")) == {"port": port}
        finally:
            backend.stop()
    finally:
        holder.close()
