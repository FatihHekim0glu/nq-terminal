"""GET /api/health: pins, fence, sealed pin status, kill switch, gate counters, fixture mode, and (D2) the desktop
contract number, the full sha256 of contract/openapi.json, the page build state and `port_fixed`."""
from __future__ import annotations

import dataclasses
import hashlib
import json
import os
from datetime import datetime
from importlib.metadata import version
from pathlib import Path

import pytest

from nq_lab import oos_gate
from nq_lab.config import IS_END, IS_START, OOS_LOG
from nq_lab.oos_gate import OPENINGS
from nq_terminal.api import system
from nq_terminal.app import create_app
from nq_terminal.desktop import build_stamp, handshake, lifecycle
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.services import gate_cursor, sealed_log
from nq_terminal.settings import load_settings

from conftest import api_client


def sealed_lines_only(src: Path) -> str:
    """The real log's sealed lines (all the pin covers), so a fixture copy stays small. A line is read as the gate reads
    it (oos_gate.parse_log), so the lone '}' a torn append leaves in the real log is no line."""
    lines = src.read_text(encoding="utf-8").splitlines()
    return "".join(x + "\n" for x in lines if any(e.get("sealed") is True for e in oos_gate.parse_log(x)[0]))


@pytest.fixture
def data_root(tmp_path: Path) -> Path:
    results = tmp_path / "results"
    results.mkdir()
    (results / "oos_openings.json").write_bytes(OPENINGS.read_bytes())
    (results / "oos_access_log.jsonl").write_text(sealed_lines_only(OOS_LOG), encoding="utf-8")
    (tmp_path / "live").mkdir()
    return tmp_path


def get_health(root: Path | None, app_state: dict | None = None) -> dict:
    env = {} if root is None else {"NQT_FIXTURE_DIR": str(root)}
    app = create_app(load_settings(env))
    for key, value in (app_state or {}).items():
        setattr(app.state, key, value)
    r = api_client(app).get("/api/health")
    assert r.status_code == 200
    return r.json()


def test_health_keys_match_the_contract(data_root):
    h = get_health(data_root)
    assert set(h) == {"now_utc", "nautilus_version", "pins", "fence", "sealed", "kill_switch_on",
                      "gate_reads_this_process", "cache", "fixture_mode", "contract", "openapi_sha256", "dist",
                      "port_fixed"}
    assert set(h["pins"]) == {"pandas", "pyarrow", "quantpad_data", "nautilus"}
    assert set(h["sealed"]) == {"openings_pin_ok", "sealed_log_pin_ok", "openings_closed"}
    assert set(h["cache"]) == {"series", "bytes"}


def test_pins_are_the_installed_versions(data_root):
    h = get_health(data_root)
    assert h["pins"] == {"pandas": version("pandas"), "pyarrow": version("pyarrow"),
                         "quantpad_data": version("quantpad-data"), "nautilus": version("nautilus-trader")}
    assert h["nautilus_version"] == version("nautilus-trader")


def test_pins_hold_the_project_versions(data_root):
    """The nq-lab project rules pin these; an unasked upgrade fails here."""
    h = get_health(data_root)
    assert h["pins"] == {"pandas": "2.3.3", "pyarrow": "25.0.1", "quantpad_data": "0.8.0",
                         "nautilus": "1.231.0"}


def test_fence_comes_from_nq_lab_config(data_root):
    h = get_health(data_root)
    assert h["fence"] == {"is_start": "2010-01-01", "is_end": "2022-01-01"}
    assert h["fence"] == {"is_start": IS_START.date().isoformat(), "is_end": IS_END.date().isoformat()}


def test_now_utc_is_timezone_aware_iso(data_root):
    now = datetime.fromisoformat(get_health(data_root)["now_utc"].replace("Z", "+00:00"))
    assert now.utcoffset().total_seconds() == 0


def test_sealed_pins_ok_on_true_copies(data_root):
    assert get_health(data_root)["sealed"] == {"openings_pin_ok": True, "sealed_log_pin_ok": True,
                                               "openings_closed": True}


def test_tampered_openings_fails_the_pin(data_root):
    path = data_root / "results" / "oos_openings.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["openings"][0]["closed"] = False
    path.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    sealed = get_health(data_root)["sealed"]
    assert sealed["openings_pin_ok"] is False
    assert sealed["openings_closed"] is False


def test_extra_sealed_log_line_fails_the_pin(data_root):
    path = data_root / "results" / "oos_access_log.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"caller": "x", "sealed": True, "reason": "nqt-test extra"}) + "\n")
    assert get_health(data_root)["sealed"]["sealed_log_pin_ok"] is False


def test_missing_files(tmp_path: Path):
    """A missing openings file cannot be read (unknown); a missing log counts as zero sealed lines under
    the gate's own rule (`sealed_log_digest`), which fails the pin."""
    sealed = get_health(tmp_path)["sealed"]
    assert sealed == {"openings_pin_ok": None, "sealed_log_pin_ok": False, "openings_closed": None}


def test_a_half_written_sealed_line_is_never_reported_ok(data_root):
    """A half-written line that could be a sealed line leaves the pin unproven: the gate refuses it (False) or cannot
    read the log (None), and the terminal reports what the gate says; it is never reported ok."""
    path = data_root / "results" / "oos_access_log.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write('{"caller": "rebal_v0", "sealed": tr')
    assert get_health(data_root)["sealed"]["sealed_log_pin_ok"] is not True


def test_kill_switch_follows_the_file(data_root):
    assert get_health(data_root)["kill_switch_on"] is False
    (data_root / "live" / "KILL-now").write_text("", encoding="utf-8")
    assert get_health(data_root)["kill_switch_on"] is True


def test_fixture_mode_flag(data_root):
    assert get_health(data_root)["fixture_mode"] is True


def test_gate_counters_default_to_zero(data_root):
    h = get_health(data_root)
    assert h["gate_reads_this_process"] == 0
    assert h["cache"] == {"series": 0, "bytes": 0}


def test_gate_counters_come_from_the_app_state_hook(data_root):
    h = get_health(data_root, {"gate_stats": lambda: (7, 3, 1024)})
    assert h["gate_reads_this_process"] == 7
    assert h["cache"] == {"series": 3, "bytes": 1024}


def test_real_root_health_reads_real_files_read_only():
    h = get_health(None)
    assert h["fixture_mode"] is False
    assert h["sealed"]["openings_pin_ok"] is True
    assert h["sealed"]["openings_closed"] is True
    assert h["sealed"]["sealed_log_pin_ok"] is not False


# ---------------------------------------------------------------- the desktop fields (03 sections 4.4, 4.6 and 7.1)

def health_of(settings, runtime: Runtime | None = None) -> dict:
    app = create_app(settings)
    if runtime is not None:
        lifecycle.set_runtime(app, runtime)
    r = api_client(app).get("/api/health")
    assert r.status_code == 200
    return r.json()


def test_health_reports_the_desktop_contract_number_and_the_full_openapi_sha256(data_root):
    h = get_health(data_root)
    contract = system.OPENAPI
    assert h["contract"] == handshake.contract_number() and isinstance(h["contract"], int) and h["contract"] >= 1
    assert h["openapi_sha256"] == hashlib.sha256(contract.read_bytes()).hexdigest() and len(h["openapi_sha256"]) == 64


def test_health_reports_the_page_build_state(tmp_path):
    settings = dataclasses.replace(load_settings({}), web_dist=tmp_path / "web" / "dist")
    assert health_of(settings)["dist"] == "missing"
    (tmp_path / "web" / "dist").mkdir(parents=True)
    (tmp_path / "web" / "dist" / "index.html").write_text("<!doctype html>", encoding="utf-8")
    system.reset_build_memo()
    assert health_of(settings)["dist"] == build_stamp.dist_status(tmp_path / "web", system.OPENAPI) == "stale"


@pytest.mark.parametrize(("stdin_control", "desktop", "port", "fixed"), [
    (True, False, 8765, True),     # start.ps1 on the fixed browser port
    (False, False, 8765, False),   # a backend started without the launcher's stdin channel
    (True, False, 8798, False),    # a launcher backend on any other port
    (False, True, 53117, False),   # the app's backend on its random port
])
def test_port_fixed_is_true_only_for_a_launcher_backend_on_8765(stdin_control, desktop, port, fixed):
    settings = dataclasses.replace(load_settings({}), stdin_control=stdin_control, desktop=desktop, port=port)
    runtime = Runtime(token="7a" * 32, port=port, pid=4120, mode=settings.mode)
    assert health_of(settings, runtime)["port_fixed"] is fixed


def test_port_fixed_follows_the_bound_port_with_8798_standing_in(monkeypatch):
    """The port table's stand-in for the fixed browser port: the rule reads the constant, not a literal."""
    monkeypatch.setattr(system, "FIXED_BROWSER_PORT", 8798)
    settings = dataclasses.replace(load_settings({}), stdin_control=True, port=8798)
    assert health_of(settings, Runtime(token="7a" * 32, port=8798, pid=4120, mode="launcher"))["port_fixed"] is True
    assert system.FIXED_BROWSER_PORT != 8765 and system.port_fixed("launcher", 8765) is False


def test_the_fixed_browser_port_is_the_launchers_8765():
    assert system.FIXED_BROWSER_PORT == 8765


# ---------------------------------------------------------------- the sealed-log cursor (V032G, growth fix 1)
# Every health poll used to re-parse the whole gate log (43 MB on 7 October 2026). The app now keeps a cursor on
# app.state and re-reads only what was appended; these pin that the answer is the whole-file answer at every step.

def whole_file_status(settings) -> dict:
    """The sealed block as the gate's whole-file checks give it, with no cursor and no memo."""
    return {"openings_pin_ok": system._pin_ok(oos_gate.check_openings_pin, settings.openings_path),
            "sealed_log_pin_ok": system._pin_ok(oos_gate.check_sealed_log_pin, settings.oos_log_path),
            "openings_closed": system._openings_closed(settings.openings_path)}


def step_forward(path: Path) -> None:
    """Give an edited file an mtime one second after its last one (an edit inside one clock tick that keeps the size
    is what the (mtime_ns, size) memo cannot see, as for the result cache)."""
    if path.exists():
        stamp = path.stat().st_mtime_ns + 1_000_000_000
        os.utime(path, ns=(stamp, stamp))


def log_steps(log: Path, openings: Path):
    original, opened = log.read_bytes(), openings.read_bytes()
    sealed = [x for x in original.decode("utf-8").splitlines() if x]
    extra = json.dumps({"caller": "x", "sealed": True, "reason": "nqt-test extra"})
    other = json.dumps({"caller": "terminal", "reason": "nqt-test other", "rows": 3})
    doc = json.loads(opened.decode("utf-8"))
    doc["openings"][0]["closed"] = False
    return [
        ("other lines", lambda: log.write_bytes(original + (other + "\n").encode() * 5)),
        ("crlf lines", lambda: log.write_bytes(log.read_bytes() + (other + "\r\n").encode() * 3)),
        ("an extra sealed line", lambda: log.write_bytes(log.read_bytes() + (extra + "\n").encode())),
        ("truncated back", lambda: log.write_bytes(original)),
        ("a half-written sealed line", lambda: log.write_bytes(original + b'{"caller": "rebal_v0", "sealed": tr')),
        ("the line finished", lambda: log.write_bytes(log.read_bytes() + b'ue}\n')),
        ("restored", lambda: log.write_bytes(original)),
        ("a sealed line edited", lambda: log.write_bytes(original.replace(b"NQ.V.0", b"NQ.V.9", 1))),
        ("a sealed line removed", lambda: log.write_bytes(original.replace((sealed[0] + "\n").encode(), b"", 1))),
        ("restored again", lambda: log.write_bytes(original)),
        ("a refused fragment", lambda: log.write_bytes(original + b'"spec_sha256": "ab"}\n' + (other + "\n").encode())),
        ("restored a third time", lambda: log.write_bytes(original)),
        ("the log removed", lambda: log.unlink()),
        ("the log back", lambda: log.write_bytes(original)),
        ("the openings tampered", lambda: openings.write_text(json.dumps(doc, indent=1), encoding="utf-8")),
        ("the openings back", lambda: openings.write_bytes(opened)),
        ("not utf-8", lambda: log.write_bytes(original + b"\xff\n")),
        ("restored last", lambda: log.write_bytes(original)),
    ]


def test_the_sealed_block_equals_the_whole_file_checks_across_appends_and_edits(data_root):
    settings = load_settings({"NQT_FIXTURE_DIR": str(data_root)})
    app = create_app(settings)
    client = api_client(app)
    log, openings = settings.oos_log_path, settings.openings_path
    seen = set()
    assert client.get("/api/health").json()["sealed"] == whole_file_status(settings)
    for name, step in log_steps(log, openings):
        step()
        step_forward(log)
        step_forward(openings)
        got = client.get("/api/health").json()["sealed"]
        assert got == whole_file_status(settings), name
        assert system.sealed_status(settings, app.state).model_dump() == got, name
        seen.add(got["sealed_log_pin_ok"])
    assert seen == {True, False, None}, "the steps reach every answer the pin can give"


def test_no_full_pass_of_the_log_after_the_first(data_root):
    settings = load_settings({"NQT_FIXTURE_DIR": str(data_root)})
    app = create_app(settings)
    client = api_client(app)
    for n in range(12):
        with settings.oos_log_path.open("ab") as fh:
            fh.write(json.dumps({"caller": "terminal", "reason": f"nqt-test {n}", "rows": n}).encode() + b"\n")
        assert client.get("/api/health").json()["sealed"]["sealed_log_pin_ok"] is True
    assert sealed_log.tracker_for(app.state).full_passes == 1


def test_an_unchanged_log_and_openings_file_are_not_read_again(data_root, monkeypatch):
    settings = load_settings({"NQT_FIXTURE_DIR": str(data_root)})
    client = api_client(create_app(settings))
    first = client.get("/api/health").json()["sealed"]
    calls = []
    for module, name in ((gate_cursor, "scan_sealed_log"), (oos_gate, "check_openings_pin"), (oos_gate, "load_openings")):
        real = getattr(module, name)
        monkeypatch.setattr(module, name, lambda *a, _real=real, _name=name, **k: calls.append(_name) or _real(*a, **k))
    for _ in range(3):
        assert client.get("/api/health").json()["sealed"] == first
    assert calls == []


def test_a_persisted_cursor_is_reused_by_a_second_app_and_dropped_when_the_prefix_changes(data_root, monkeypatch):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)  # the fixture log is small; persist it like the real one
    settings = load_settings({"NQT_FIXTURE_DIR": str(data_root)})
    log = settings.oos_log_path
    first = create_app(settings)
    assert api_client(first).get("/api/health").json()["sealed"]["sealed_log_pin_ok"] is True
    assert len(list((settings.state_dir / "cache").glob("*.bin"))) == 1
    with log.open("ab") as fh:
        fh.write(b'{"caller": "terminal", "reason": "nqt-test later", "rows": 1}\r\n')
    second = create_app(settings)
    assert api_client(second).get("/api/health").json()["sealed"] == whole_file_status(settings)
    assert sealed_log.tracker_for(second.state).full_passes == 0, "the second app started from the stored cursor"
    raw = log.read_bytes()
    log.write_bytes(raw.replace(b"rebal", b"rebaL", 1))
    third = create_app(settings)
    sealed = api_client(third).get("/api/health").json()["sealed"]
    assert sealed == whole_file_status(settings) and sealed["sealed_log_pin_ok"] is False
    assert sealed_log.tracker_for(third.state).full_passes == 1, "a changed prefix is read again from the start"


def test_the_sealed_status_without_an_app_is_the_whole_file_rule(data_root):
    settings = load_settings({"NQT_FIXTURE_DIR": str(data_root)})
    assert system.sealed_status(settings).model_dump() == whole_file_status(settings)
