"""GET /api/health: pins, fence, sealed pin status, kill switch, gate counters, fixture mode."""
from __future__ import annotations

import json
from datetime import datetime
from importlib.metadata import version
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import IS_END, IS_START, OOS_LOG
from nq_lab.oos_gate import OPENINGS
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)  # TestClient's default client ("testclient") is not an address


def sealed_lines_only(src: Path) -> str:
    """The real log's sealed lines (all the pin covers), so a fixture copy stays small."""
    lines = src.read_text(encoding="utf-8").splitlines()
    return "".join(x + "\n" for x in lines if x.strip() and json.loads(x).get("sealed") is True)


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
    r = TestClient(app, base_url=LOCAL, client=LOOPBACK).get("/api/health")
    assert r.status_code == 200
    return r.json()


def test_health_keys_match_the_contract(data_root):
    h = get_health(data_root)
    assert set(h) == {"now_utc", "nautilus_version", "pins", "fence", "sealed", "kill_switch_on",
                      "gate_reads_this_process", "cache", "fixture_mode"}
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


def test_half_written_log_line_reports_unknown(data_root):
    path = data_root / "results" / "oos_access_log.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write('{"caller": "rebal_v0", "sea')
    assert get_health(data_root)["sealed"]["sealed_log_pin_ok"] is None


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
