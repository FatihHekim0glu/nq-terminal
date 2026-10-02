"""Phase 2 QA contract items closed in Phase 3.1 (LOW): C-11, C-12 and C-14.

- C-12: OOS log entries carry `start` and `end` as ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SS+00:00`), the form `ts_utc`
  already has; the gate writes them as `2010-09-28 00:00:00+00:00`. Text that does not parse is passed through
  unchanged (its epoch value is None), never dropped.
- C-14: `EquitySeries.unit` ("USD", the account currency of every run) and `UniverseRow.returns_unit` (the horizon
  returns are fractions, not percent).
- C-11: `LiveStatus.last_close` is a typed `LastClose` (the fields read with the same coercion as the performance
  series, the whole sanitised row under `data`), not an untyped dict.
Real files are only read; every write goes to tmp_path.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import OOS_LOG
from nq_terminal.app import create_app
from nq_terminal.models.data import UniverseRow
from nq_terminal.models.live import LastClose, LiveStatus
from nq_terminal.models.runs import EquitySeries
from nq_terminal.services import audit, journals
from nq_terminal.services.market import RETURNS_UNIT
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from test_runs_support import RUNS, copy_root
from test_runs_support import client as runs_client

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$")
BOOK = "volmanaged_paper_journal.jsonl"


def fixture_client() -> TestClient:
    return api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})), base_url=LOCAL,
                      client=LOOPBACK)


def log_line(start: str, end: str) -> str:
    return json.dumps({"ts_utc": "2026-09-26T00:00:00+00:00", "caller": "c", "reason": "reason text",
                       "start": start, "end": end, "rows": 1}) + "\n"


# ---------------------------------------------------------------- C-12: OOS start and end in ISO


def test_fixture_log_start_and_end_are_iso_utc():
    log = audit.parse_oos_log(FIXTURES.joinpath("results", "oos_access_log.jsonl").read_text(encoding="utf-8"))
    first = log.entries[0]
    assert first["start"] == "2010-09-28T00:00:00+00:00"  # recorded as "2010-09-28 00:00:00+00:00"
    assert first["end"] == "2022-01-01T00:00:00+00:00"
    assert first["start_epoch_s"] == 1285632000


@pytest.mark.parametrize(("recorded", "iso"), [
    ("2015-01-01", "2015-01-01T00:00:00+00:00"),
    ("2015-01-01 00:00:00", "2015-01-01T00:00:00+00:00"),
    ("2015-01-01 05:00:00-05:00", "2015-01-01T10:00:00+00:00"),
    ("2015-01-01T00:00:00Z", "2015-01-01T00:00:00+00:00"),
])
def test_start_and_end_are_normalised_to_utc(recorded: str, iso: str):
    entry = audit.parse_oos_log(log_line(recorded, recorded)).entries[0]
    assert entry["start"] == iso and entry["end"] == iso


def test_unparseable_bounds_pass_through_unchanged():
    entry = audit.parse_oos_log(log_line("a", "b")).entries[0]
    assert (entry["start"], entry["end"]) == ("a", "b")
    assert entry["start_epoch_s"] is None and entry["end_epoch_s"] is None


def test_every_real_entry_with_a_time_is_iso():
    log = audit.parse_oos_log(OOS_LOG.read_text(encoding="utf-8"))
    timed = [e for e in log.entries if e["start_epoch_s"] is not None]
    assert timed, "the real log has no parseable windows: the check would pass vacuously"
    assert all(ISO_UTC.match(e["start"]) and ISO_UTC.match(e["end"]) for e in timed)


def test_oos_log_endpoint_serves_iso_bounds():
    entries = fixture_client().get("/api/audit/oos-log").json()["entries"]
    assert entries and all(ISO_UTC.match(e["start"]) and ISO_UTC.match(e["end"]) for e in entries)


# ---------------------------------------------------------------- C-14: units


def test_equity_series_names_its_unit(tmp_path: Path):
    api = runs_client(copy_root(tmp_path))
    usable = api.get(f"/api/runs/{RUNS['sized']}/equity").json()
    unusable = api.get(f"/api/runs/{RUNS['unbalanced']}/equity").json()
    assert usable["unit"] == "USD" and unusable["unit"] == "USD"
    assert EquitySeries.model_json_schema(mode="serialization")["properties"]["unit"]["const"] == "USD"


def test_universe_rows_name_the_returns_unit(tmp_path: Path):
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    app.state.serve_fn = make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")
    app.state.catalog = FakeCatalog()
    body = api_client(app, base_url=LOCAL, client=LOOPBACK).get("/api/market/universe").json()
    assert body["rows"] and {row["returns_unit"] for row in body["rows"]} == {RETURNS_UNIT}
    assert "fraction" in RETURNS_UNIT
    assert "returns_unit" in UniverseRow.model_json_schema(mode="serialization")["required"]


# ---------------------------------------------------------------- C-11: typed last close


def test_live_status_last_close_is_typed():
    assert LiveStatus.model_fields["last_close"].annotation == LastClose | None
    schema = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})).openapi()["components"]["schemas"]
    assert "LastClose" in schema
    assert schema["LiveStatus"]["properties"]["last_close"]["anyOf"][0]["$ref"].endswith("/LastClose")


def test_last_close_on_the_fixture_is_the_halted_error_row():
    close = fixture_client().get("/api/live/status").json()["last_close"]
    assert set(close) == set(LastClose.model_fields)
    assert close["date"] == "2026-10-01" and close["halted"] is True
    assert close["error"].startswith("reconciliation failed")
    assert close["expected"] is None and close["target"] is None  # the error row records neither
    assert close["data"]["type"] == "close" and close["data"]["error"] == close["error"]


def test_last_close_fields_use_the_performance_coercion(tmp_path: Path):
    logs = tmp_path / "live" / "logs"
    logs.mkdir(parents=True)
    row = {"type": "close", "date": "2026-09-28", "contract": "MNQZ6.CME", "target": 6, "wstar": float("nan"),
           "refused": None, "blocked": None, "sent": True, "expected": {"MNQZ6.CME": 6},
           "actual": {"MNQZ6.CME": 5}, "reconciled": {"ok": False, "diffs": {"MNQZ6.CME": -1}},
           "close_px": 24851.0, "slippage_ticks": 1.0, "fills": [["MNQZ6.CME", 1, 6, 24851.25]],
           "exposure": 0.298212, "halted": False}
    (logs / BOOK).write_text(json.dumps(row) + "\n", encoding="utf-8")
    api = api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(tmp_path)})), base_url=LOCAL,
                     client=LOOPBACK)
    close = api.get("/api/live/status").json()["last_close"]
    series = journals.performance_series(journals.JournalTailer(logs / BOOK).poll().rows)
    for key in ("target", "expected", "actual", "reconciled_ok", "exposure", "slippage_ticks", "sent", "halted"):
        assert close[key] == series[key][-1], key
    assert (close["expected"], close["actual"], close["reconciled_ok"]) == (6.0, 5.0, False)
    assert close["close_px"] == 24851.0 and close["data"]["wstar"] is None
    assert close["data"]["fills"] == [["MNQZ6.CME", 1, 6, 24851.25]]
