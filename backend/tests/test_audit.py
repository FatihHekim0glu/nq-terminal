"""Audit and command endpoints (TASKS 2.4): OOS log, openings and pins, spec hashes, /api/commands.

Real files are read, never written: the OOS log is parsed from one snapshot of its text (a research workflow may
append while the tests run), and counts come from the files at run time, never from constants.
"""
from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import OOS_LOG, RESULTS, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_lab.oos_gate import OPENINGS
from nq_terminal.app import create_app
from nq_terminal.services import audit
from nq_terminal.settings import load_settings

from fakes import FIXTURES

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
KEY_SETS = {"basic", "series", "trades", "sealed"}
# The real log is appended to by the research runs, which add new line shapes over time. The terminal files any
# shape it does not know as "other" and keeps parsing it; the real-log tests allow that class and nothing else.
REAL_LOG_KEY_SETS = KEY_SETS | {"other"}


def client(env: dict | None = None) -> TestClient:
    return api_client(create_app(load_settings(env or {})), base_url=LOCAL, client=LOOPBACK)


def fixture_client() -> TestClient:
    return client({"NQT_FIXTURE_DIR": str(FIXTURES)})


def real_lines(text: str) -> list[str]:
    return [x for x in text.splitlines() if x.strip()]


def sealed_lines_only(text: str) -> str:
    return "".join(x + "\n" for x in real_lines(text) if json.loads(x).get("sealed") is True)


# ---------------------------------------------------------------- OOS log parser


def test_the_real_oos_log_parses_fully():
    text = OOS_LOG.read_text(encoding="utf-8")
    lines = real_lines(text)
    log = audit.parse_oos_log(text)
    assert log.errors == ()
    assert len(log.entries) == len(lines) - (1 if log.partial_tail else 0)
    found = {e["key_set"] for e in log.entries}
    assert KEY_SETS <= found <= REAL_LOG_KEY_SETS


def test_real_key_sets_match_a_direct_count():
    text = OOS_LOG.read_text(encoding="utf-8")
    log = audit.parse_oos_log(text)
    sealed = sum(1 for x in real_lines(text) if json.loads(x).get("sealed") is True)
    assert audit.key_set_counts(log.entries)["sealed"] == sealed
    assert sum(audit.key_set_counts(log.entries).values()) == len(log.entries)


def test_key_set_is_exact_and_unknown_shapes_are_other():
    basic = {"ts_utc": "t", "caller": "c", "reason": "r", "start": "s", "end": "e", "rows": 1}
    assert audit.key_set(basic) == "basic"
    assert audit.key_set({**basic, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor"}) == "series"
    assert audit.key_set({**basic, "symbol": "NQ.V.0", "schema": "trades"}) == "trades"
    assert audit.key_set({**basic, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", "sealed": True,
                          "spec_sha256": "x"}) == "sealed"
    assert audit.key_set({**basic, "extra": 1}) == "other"


def test_entries_carry_epoch_seconds_and_the_fence_flag():
    log = audit.parse_oos_log(FIXTURES.joinpath("results", "oos_access_log.jsonl").read_text(encoding="utf-8"))
    sealed = [e for e in log.entries if e["is_sealed"]]
    assert len(sealed) == 2 and all(e["past_fence"] for e in sealed)
    first = log.entries[0]
    assert first["line_no"] == 1
    assert first["start_epoch_s"] == 1285632000  # 2010-09-28 00:00 UTC
    assert first["end_epoch_s"] == 1640995200  # 2022-01-01 00:00 UTC: ends at the fence, does not cross it
    assert first["past_fence"] is False


def test_a_partial_last_line_is_held_back_not_an_error():
    good = json.dumps({"ts_utc": "2026-09-26T00:00:00+00:00", "caller": "c", "reason": "reason text", "start": "a",
                       "end": "b", "rows": 1})
    log = audit.parse_oos_log(good + "\n" + good[:40])
    assert len(log.entries) == 1 and log.partial_tail is True and log.errors == ()


def test_a_broken_complete_line_is_an_error_born_failing():
    good = json.dumps({"ts_utc": "t", "caller": "c", "reason": "reason text", "start": "a", "end": "b", "rows": 1})
    log = audit.parse_oos_log(good + "\n{not json\n" + json.dumps({"caller": "x"}) + "\n")
    assert [e.line_no for e in log.errors] == [2, 3]
    assert len(log.entries) == 1


def test_filters_by_caller_since_and_limit():
    log = audit.parse_oos_log(FIXTURES.joinpath("results", "oos_access_log.jsonl").read_text(encoding="utf-8"))
    terminal = audit.select_entries(log.entries, caller="terminal", since=None, limit=500)
    assert len(terminal) == 2 and {e["caller"] for e in terminal} == {"terminal"}
    late = audit.select_entries(log.entries, caller=None, since="2026-09-26T11:00:00+00:00", limit=500)
    assert late and all(e["ts_utc"] >= "2026-09-26T11" for e in late)
    last = audit.select_entries(log.entries, caller=None, since=None, limit=3)
    assert [e["line_no"] for e in last] == [e["line_no"] for e in log.entries[-3:]]


def test_since_must_be_a_date():
    with pytest.raises(ValueError):
        audit.parse_since("yesterday")
    assert audit.parse_since("2026-09-26").isoformat() == "2026-09-26T00:00:00+00:00"


# ---------------------------------------------------------------- endpoints: oos-log


def test_oos_log_endpoint_on_the_fixture():
    r = fixture_client().get("/api/audit/oos-log")
    assert r.status_code == 200
    body = r.json()
    assert body["terminal_reads"] == 2
    assert set(body["key_sets"]) == KEY_SETS
    assert body["parse_errors"] == []
    assert sum(body["counts_by_caller"].values()) == body["total"] == len(body["entries"])
    assert body["sealed_reads"] == 2


def test_oos_log_endpoint_filters_and_validates():
    c = fixture_client()
    body = c.get("/api/audit/oos-log", params={"caller": "terminal", "limit": 1}).json()
    assert body["returned"] == 1 and body["entries"][0]["caller"] == "terminal"
    assert body["total"] > 1  # counts describe the whole log, the page is filtered
    assert c.get("/api/audit/oos-log", params={"since": "not a date"}).status_code == 422
    assert c.get("/api/audit/oos-log", params={"limit": 0}).status_code == 422
    assert c.get("/api/audit/oos-log", params={"limit": 5001}).status_code == 422


def test_oos_log_endpoint_on_the_real_log_has_no_errors():
    body = client().get("/api/audit/oos-log", params={"limit": 5}).json()
    assert body["parse_errors"] == []
    assert KEY_SETS <= set(body["key_sets"]) <= REAL_LOG_KEY_SETS
    assert body["returned"] == 5


def test_missing_log_is_an_empty_audit(tmp_path: Path):
    (tmp_path / "results").mkdir()
    body = client({"NQT_FIXTURE_DIR": str(tmp_path)}).get("/api/audit/oos-log").json()
    assert body["total"] == 0 and body["entries"] == [] and body["log_present"] is False


# ---------------------------------------------------------------- openings and pins


def test_the_pins_report_ok_on_the_real_files():
    body = client().get("/api/audit/openings").json()
    assert body["openings_pin_ok"] is True
    assert body["sealed_log_pin_ok"] is True
    assert body["openings_closed"] is True
    assert body["openings_sha256"] == body["pinned"]["openings_sha256"]
    assert body["sealed_log"]["lines"] == body["pinned"]["sealed_log_lines"]
    assert [o["caller"] for o in body["openings"]] == ["rebal_v1_confirm"]
    assert body["label"] == "spent window, opened 2026-09-26, descriptive only"


def pinned_root(tmp_path: Path, openings: bytes, log_text: str) -> Path:
    (tmp_path / "results").mkdir()
    (tmp_path / "results" / "oos_openings.json").write_bytes(openings)
    (tmp_path / "results" / "oos_access_log.jsonl").write_text(log_text, encoding="utf-8")
    return tmp_path


def test_a_tampered_openings_file_fails_its_pin_born_failing(tmp_path: Path):
    log = sealed_lines_only(OOS_LOG.read_text(encoding="utf-8"))
    root = pinned_root(tmp_path, OPENINGS.read_bytes() + b" ", log)
    body = client({"NQT_FIXTURE_DIR": str(root)}).get("/api/audit/openings").json()
    assert body["openings_pin_ok"] is False
    assert body["sealed_log_pin_ok"] is True


def test_a_log_without_its_sealed_lines_fails_its_pin_born_failing(tmp_path: Path):
    root = pinned_root(tmp_path, OPENINGS.read_bytes(), "")
    body = client({"NQT_FIXTURE_DIR": str(root)}).get("/api/audit/openings").json()
    assert body["openings_pin_ok"] is True
    assert body["sealed_log_pin_ok"] is False


# ---------------------------------------------------------------- spec hashes


def registry_rows() -> list[dict]:
    with (RESULTS / "registry.csv").open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def test_every_real_spec_rehashes_to_its_result():
    body = client().get("/api/audit/spec-hashes").json()
    names = {r["name"] for r in body["rows"] if r["kind"] == "registry"}
    assert names == {r["name"] for r in registry_rows()}  # counted at run time: the registry may grow
    assert all(r["rehash_ok"] for r in body["rows"]), [r for r in body["rows"] if not r["rehash_ok"]]
    assert body["all_ok"] is True
    confirmations = [r for r in body["rows"] if r["kind"] == "confirmation"]
    assert [r["name"] for r in confirmations] == ["rebal_v1_confirm"]


def spec_root(tmp_path: Path, name: str, spec_bytes: bytes) -> Path:
    row = next(r for r in registry_rows() if r["name"] == name)
    (tmp_path / "results").mkdir()
    (tmp_path / "experiments").mkdir()
    with (tmp_path / "results" / "registry.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)
    (tmp_path / "experiments" / f"{row['spec']}.json").write_bytes(spec_bytes)
    return tmp_path


def test_a_copied_spec_hashes_ok(tmp_path: Path):
    root = spec_root(tmp_path, "overnight_v0", (ROOT / "experiments" / "overnight_v0.json").read_bytes())
    rows = audit.spec_hash_rows(root)
    assert [(r.name, r.rehash_ok) for r in rows] == [("overnight_v0", True)]


def test_a_spec_with_one_byte_changed_fails_born_failing(tmp_path: Path):
    spec = bytearray((ROOT / "experiments" / "overnight_v0.json").read_bytes())
    spec[10] = (spec[10] + 1) % 256
    root = spec_root(tmp_path, "overnight_v0", bytes(spec))
    [row] = audit.spec_hash_rows(root)
    assert row.rehash_ok is False
    assert row.actual_sha256 == hashlib.sha256(bytes(spec)).hexdigest() != row.recorded_sha256


def test_a_missing_spec_is_reported_not_raised(tmp_path: Path):
    root = spec_root(tmp_path, "overnight_v0", b"{}")
    (root / "experiments" / "overnight_v0.json").unlink()
    [row] = audit.spec_hash_rows(root)
    assert row.rehash_ok is False and row.actual_sha256 is None and row.note


def test_a_spec_name_that_leaves_experiments_is_refused(tmp_path: Path):
    root = spec_root(tmp_path, "overnight_v0", b"{}")
    text = (root / "results" / "registry.csv").read_text(encoding="utf-8").replace(",overnight_v0,", ",../x,")
    (root / "results" / "registry.csv").write_text(text, encoding="utf-8")
    [row] = audit.spec_hash_rows(root)
    assert row.rehash_ok is False and row.actual_sha256 is None


# ---------------------------------------------------------------- /api/commands


def test_commands_lists_every_p0_mnemonic():
    body = client().get("/api/commands").json()
    codes = {m["code"] for m in body["mnemonics"] if m["priority"] == "P0"}
    assert codes == {"HOME", "GP", "GIP", "DES", "REG", "MT", "RUNS", "RUN", "EQ", "DD", "RET", "RR", "MRET",
                     "MON", "CORR", "LEDG", "OOS", "LIVE", "JRNL", "HELP"}
    assert all(m["code"] == m["code"].upper() and m["screen"] for m in body["mnemonics"])


def test_commands_context_index_comes_from_the_files():
    body = client().get("/api/commands").json()
    assert [i["root"] for i in body["instruments"]] == [c.root for c in TABLE] + ["RTY"]  # plus catalog-only RTY
    assert body["hypotheses"] == [r["name"] for r in registry_rows()]
    assert body["confirmations"] == ["rebal_v1_confirm"]
    runs = sorted(p.parent.name for p in (ROOT / "backtests" / "output").glob("*/result.json"))
    assert body["runs"] == runs
    assert body["universe"] == ["27F"]


def test_commands_in_fixture_mode_use_the_fixture_runs():
    body = fixture_client().get("/api/commands").json()
    runs = sorted(p.parent.name for p in FIXTURES.joinpath("backtests", "output").glob("*/result.json"))
    assert body["runs"] == runs
    assert body["hypotheses"] == ["overnight_v0", "volmanaged_v0"]  # the fixture registry (manifest)


def test_audit_routes_are_get_only():
    c = client()
    for path in ("/api/audit/oos-log", "/api/audit/openings", "/api/audit/spec-hashes", "/api/commands"):
        assert c.post(path).status_code == 405
