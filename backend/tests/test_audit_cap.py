"""The audit page past the old 128 MiB file cap (V032G fix 4).

Before: `/api/audit/oos-log` read the log through a FileCache with the default 128 MiB cap, and `read_log` caught only
FileNotFoundError, so a log past 128 MiB (about four research days after 7 October 2026) answered 500 on the audit
page and on every instrument page that counts its reads. After: the audit read has its own, larger cap
(`AUDIT_MAX_FILE_BYTES`), and a log over even that answers 503 with a plain message (never 500, never a partial
count: an audit page that understated the sealed reads would mislead).
"""
from __future__ import annotations

import dataclasses
import json
import os
import shutil
from pathlib import Path

import pytest

from nq_terminal.api import audit as audit_api
from nq_terminal.services import audit
from nq_terminal.services.files import DEFAULT_MAX_FILE_BYTES

from fakes import FIXTURES
from fixture_app import create_fixture_app

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
LOG_RELATIVE = Path("results") / "oos_access_log.jsonl"
PADDING = "x" * 4000
MIB = 1024**2


def _line(i: int) -> str:
    entry = {"ts_utc": f"2026-09-25T21:{i // 60 % 60:02d}:{i % 60:02d}+00:00", "caller": "terminal" if i % 3 else "cskew_v0",
             "reason": f"padding {i} {PADDING}", "start": "2020-01-01 00:00:00+00:00",
             "end": "2020-02-01 00:00:00+00:00", "rows": i}
    return json.dumps(entry) + "\n"


def _lab(tmp_path: Path, lines: int, *, min_bytes: int = 0) -> tuple[object, Path]:
    root = tmp_path / "fixtures"
    shutil.copytree(FIXTURES, root)
    log = root / LOG_RELATIVE
    with open(log, "wb") as handle:
        written = i = 0
        while i < lines or written < min_bytes:
            text = _line(i).encode("utf-8")
            handle.write(text)
            written += len(text)
            i += 1
    env = {"NQT_FIXTURE_DIR": str(root), "NQT_STATE_DIR": str(tmp_path / "state")}
    os.makedirs(env["NQT_STATE_DIR"], exist_ok=True)
    return create_fixture_app(env, log_dir=tmp_path / "gate"), log


def test_the_old_cap_is_not_the_audit_cap():
    assert audit_api.AUDIT_MAX_FILE_BYTES > 2 * DEFAULT_MAX_FILE_BYTES


def test_a_log_past_128_mib_answers_instead_of_failing(tmp_path):
    """Born failing: 129 MiB of the gate's own lines answered 500 (FileAccessError over the default cap)."""
    app, log = _lab(tmp_path, 10, min_bytes=DEFAULT_MAX_FILE_BYTES + MIB)
    assert log.stat().st_size > DEFAULT_MAX_FILE_BYTES
    lines = log.read_bytes().count(b"\n")
    response = api_client(app, base_url=LOCAL, client=LOOPBACK).get("/api/audit/oos-log?limit=5")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == lines and body["returned"] == 5 and body["log_present"] is True
    assert body["terminal_reads"] + body["counts_by_caller"].get("cskew_v0", 0) == lines
    assert [e["rows"] for e in body["entries"]] == list(range(lines - 5, lines))


def test_a_small_cap_answers_503_with_a_plain_message_never_500(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_api, "AUDIT_MAX_FILE_BYTES", 64 * 1024)
    app, log = _lab(tmp_path, 40)
    assert log.stat().st_size > 64 * 1024
    client = api_client(app, base_url=LOCAL, client=LOOPBACK)
    response = client.get("/api/audit/oos-log")
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert "oos_access_log.jsonl" in detail and str(tmp_path) not in detail and "\\" not in detail
    assert client.get("/api/instruments/NQ").status_code != 500


def test_a_log_under_a_small_cap_is_served_in_full(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_api, "AUDIT_MAX_FILE_BYTES", 256 * 1024)
    app, log = _lab(tmp_path, 20)
    assert log.stat().st_size < 256 * 1024
    body = api_client(app, base_url=LOCAL, client=LOOPBACK).get("/api/audit/oos-log?limit=500").json()
    assert body["total"] == 20 and body["returned"] == 20
    reference = audit.parse_oos_log_bytes(log.read_bytes())
    assert [e["rows"] for e in body["entries"]] == [e["rows"] for e in reference.entries]


def test_a_missing_log_is_still_an_empty_audit(tmp_path):
    app, log = _lab(tmp_path, 1)
    log.unlink()
    body = api_client(app, base_url=LOCAL, client=LOOPBACK).get("/api/audit/oos-log").json()
    assert body["log_present"] is False and body["total"] == 0


def test_the_audit_cache_keeps_a_log_heavier_than_the_app_wide_cap(tmp_path):
    """Born failing: the audit cache took min(its budget, settings.file_cache_bytes), 128 MiB in desktop mode, and a
    CompactLog weighs about 1.11 times its file, so past about 115 MiB the log was never cached (every call re-parsed
    it and the append-only extend path was lost). The cap is shrunk here to a size under the log's weight."""
    app, log = _lab(tmp_path, 40)
    app_cap = log.stat().st_size  # desktop's file_cache_bytes, scaled down: under the log's weight, over its size
    app.state.settings = dataclasses.replace(app.state.settings, file_cache_bytes=app_cap)
    client = api_client(app, base_url=LOCAL, client=LOOPBACK)
    first = client.get("/api/audit/oos-log?limit=5")
    second = client.get("/api/audit/oos-log?limit=5")
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    stats = app.state.audit_files.stats()
    assert stats.entries == 1 and stats.bytes > app_cap, stats
    assert (stats.hits, stats.misses) == (1, 1), stats


def test_an_appended_line_costs_only_the_extension_under_the_desktop_cap(tmp_path):
    app, log = _lab(tmp_path, 40)
    app.state.settings = dataclasses.replace(app.state.settings, file_cache_bytes=log.stat().st_size)
    client = api_client(app, base_url=LOCAL, client=LOOPBACK)
    assert client.get("/api/audit/oos-log?limit=1").json()["total"] == 40
    with open(log, "ab") as handle:
        handle.write(_line(40).encode("utf-8"))
    body = client.get("/api/audit/oos-log?limit=1").json()
    assert body["total"] == 41 and body["entries"][0]["rows"] == 40
    assert app.state.audit_files.stats().entries == 1
