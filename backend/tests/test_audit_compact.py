"""The OOS audit log kept in a compact form (W5C D6): an index over the raw bytes, decoded one page at a time.

What is proved here, on the fixture log and on a synthetic log of 24,000 lines in the real line shape (built under
tmp_path, never the real log):
- every /api/audit/oos-log body is byte-equal to the one the full parser gives (a reference route below keeps the
  pre-W5C handler verbatim over `audit.parse_oos_log_bytes`), for limits, offsets, caller and since filters;
- the cached value keeps at most twice the file's bytes, and the file cache charges it within 25% of what it keeps;
- a log that only grew is parsed from its last complete line on; any other change is parsed again in full;
- the per-symbol count the instrument page needs agrees with a count over the decoded entries.
"""
from __future__ import annotations

import gc
import json
import os
import tracemalloc
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Query
from fastapi.testclient import TestClient

from nq_lab.config import IS_END
from nq_terminal.app import create_app
from nq_terminal.models.audit import LineProblem, OosLog, OosLogEntry, OosLogFilters, SeverityLevel
from nq_terminal.models.common import DEFAULT_LIMIT, MAX_LIMIT
from nq_terminal.services import audit
from nq_terminal.services.bars import CALLER
from nq_terminal.services.instruments import logged_reads
from nq_terminal.settings import load_settings

from fakes import FIXTURES

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
SYNTHETIC_LINES = 24_000
LOG_RELATIVE = Path("results") / "oos_access_log.jsonl"
CALLERS = ("terminal", "terminal", "terminal", "terminal", "eurodrift_v0_rsv", "carry_v0_qa", "run_base", "cskew_v0")
SYMBOLS = ("NQ.V.0", "ES.V.0", "ZN.V.0", "GC.V.0", "6J.V.0", "HO.V.0")
ONE_SECOND_NS = 1_000_000_000
FIRST_TS = datetime(2026, 9, 25, 21, 0, tzinfo=timezone.utc)
PLUS_TWO = timezone(timedelta(hours=2))


# ---------------------------------------------------------------- the synthetic log


def _line(i: int) -> str:
    """One log line in the gate's own shape (json.dumps defaults), varied over callers, key sets and windows."""
    stamp = FIRST_TS + timedelta(microseconds=i * 37_123_457)
    ts = ("yesterday" if i % 401 == 0 else stamp.replace(tzinfo=None).isoformat() if i % 409 == 1
          else stamp.astimezone(PLUS_TWO).isoformat() if i % 103 == 2 else stamp.isoformat())
    caller = CALLERS[i % len(CALLERS)] if i % 97 else f"probe_{i % 13}"
    symbol = SYMBOLS[i % len(SYMBOLS)]
    year = 2010 + i % 12
    start = f"{year}-01-01 00:00:00+00:00" if i % 211 else "not a date"
    end = f"{year + 1}-01-01 00:00:00+00:00" if i % 157 else "2022-03-01 00:00:00+00:00"
    obj = {"ts_utc": ts, "caller": caller,
           "reason": f"terminal display: {symbol} 1m vendor {year} (chart only, not a registered test)",
           "start": start, "end": end, "rows": 300_000 + i}
    shape = i % 10
    if shape < 7:
        obj.update(symbol=symbol, timeframe="1m", variant="vendor")
    elif shape == 7:
        obj.update(symbol=symbol, schema="trades")
    elif shape == 8 and i % 1000 == 8:
        obj.update(symbol=symbol, timeframe="1m", variant="vendor", sealed=True, spec_sha256="ab" * 32)
    elif shape == 9 and i % 50 == 9:
        obj.update(extra_key="café")  # an unknown key set, and a multi-byte character
    return json.dumps(obj)


def synthetic_log(lines: int = SYNTHETIC_LINES, *, start: int = 0) -> bytes:
    """`lines` complete lines, with a few torn fragments and blank lines in among them, as the real log has."""
    out: list[str] = []
    for i in range(start, start + lines):
        if i % 4999 == 4998:
            out.append("}")  # the lone brace a concurrent append leaves
        elif i % 6007 == 6006:
            out.append("")
        else:
            out.append(_line(i))
    return ("\n".join(out) + "\n").encode("utf-8")


def write_log(root: Path, raw: bytes) -> Path:
    path = root / LOG_RELATIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def append_log(path: Path, raw: bytes) -> None:
    """Append and move the mtime on by a second, as a later append by the gate would."""
    before = path.stat().st_mtime_ns
    with open(path, "ab") as handle:
        handle.write(raw)
    os.utime(path, ns=(before + ONE_SECOND_NS, before + ONE_SECOND_NS))


def app_client(root: Path) -> TestClient:
    return api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(root)})), base_url=LOCAL, client=LOOPBACK)


# ---------------------------------------------------------------- the reference route (the pre-W5C handler)


def reference_client(log_path: Path) -> TestClient:
    """The /api/audit/oos-log handler as it stood before W5C, over the full parser, served by FastAPI the same way."""
    ref = FastAPI()

    @ref.get("/ref", response_model=OosLog)
    def oos_log(
        caller: str | None = Query(default=None),
        since: str | None = Query(default=None),
        limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
        offset: int = Query(default=0, ge=0),
    ) -> OosLog:
        try:
            floor = audit.parse_since(since) if since else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        parsed = audit.parse_oos_log_bytes(log_path.read_bytes())
        matched = audit.filter_entries(parsed.entries, caller=caller, since=floor)
        entries = audit.select_entries(matched, caller=None, since=None, limit=limit, offset=offset)
        callers = audit.caller_counts(parsed.entries)
        return OosLog(
            log_present=True,
            total=len(parsed.entries),
            returned=len(entries),
            matched=len(matched),
            partial_tail=parsed.partial_tail,
            parse_errors=[LineProblem(line_no=e.line_no, message=e.message) for e in parsed.errors],
            key_sets=audit.key_set_counts(parsed.entries),
            counts_by_caller=callers,
            terminal_reads=callers.get(audit.TERMINAL_CALLER, 0),
            sealed_reads=sum(1 for e in parsed.entries if e["is_sealed"]),
            severity_levels=[SeverityLevel(level=level, meaning=text) for level, text in audit.SEVERITY_LEVELS],
            severity_counts=audit.severity_counts(parsed.entries),
            fence_end=IS_END.date().isoformat(),
            filters=OosLogFilters(caller=caller, since=since, limit=limit, offset=offset),
            entries=[OosLogEntry.model_validate(dict(e)) for e in entries],
        )

    return TestClient(ref)


def assert_bodies_equal(app: TestClient, ref: TestClient, params: dict) -> dict:
    got = app.get("/api/audit/oos-log", params=params)
    want = ref.get("/ref", params=params)
    assert got.status_code == want.status_code == 200, params
    assert got.content == want.content, f"body differs for {params}"
    return got.json()


SYNTHETIC_PARAMS = [
    {"limit": 5000}, {"limit": 50}, {"limit": 1}, {"limit": 5000, "offset": 5000}, {"limit": 50, "offset": 5000},
    {"limit": 1, "offset": 23_000}, {"limit": 50, "offset": 99_999},
    {"limit": 50, "caller": "terminal"}, {"limit": 5000, "caller": "terminal", "offset": 5000},
    {"limit": 50, "caller": "eurodrift_v0_rsv"}, {"limit": 1, "caller": "probe_3"}, {"limit": 50, "caller": "nobody"},
    {"limit": 50, "since": "2026-09-27"}, {"limit": 5000, "since": "2026-09-28T11:00:00.5+00:00"},
    {"limit": 50, "since": "2026-09-29T03:00:00+02:00", "offset": 50}, {"limit": 50, "since": "2030-01-01"},
    {"limit": 50, "since": "2026-09-27", "caller": "carry_v0_qa"}, {"limit": 1, "since": "2026-09-26", "caller": "run_base"},
]
FIXTURE_PARAMS = [
    {}, {"limit": 5000}, {"limit": 1}, {"limit": 3, "offset": 3}, {"limit": 1, "offset": 5000},
    {"caller": "terminal"}, {"caller": "za_screen", "limit": 1}, {"since": "2026-09-26T11:00:00+00:00"},
    {"since": "2026-09-26", "caller": "terminal", "limit": 2},
]


def test_oos_log_body_byte_equal_on_the_fixture_log():
    app, ref = app_client(FIXTURES), reference_client(FIXTURES / LOG_RELATIVE)
    for params in FIXTURE_PARAMS:
        assert_bodies_equal(app, ref, params)


def test_oos_log_body_byte_equal(tmp_path):
    path = write_log(tmp_path, synthetic_log())
    app, ref = app_client(tmp_path), reference_client(path)
    whole = None
    for params in SYNTHETIC_PARAMS:
        body = assert_bodies_equal(app, ref, params)
        whole = whole or body
    assert whole["total"] > 23_000 and whole["parse_errors"], "the synthetic log has entries and torn fragments"
    assert set(whole["key_sets"]) == {"basic", "series", "trades", "sealed", "other"}
    assert set(whole["severity_counts"]) == {"1", "2", "3", "4"}


def test_oos_log_body_byte_equal_with_a_partial_tail_and_a_cut_character(tmp_path):
    whole = synthetic_log(300)
    torn = _line(9_999).replace("vendor", "véndor", 1).encode("utf-8")
    cut = torn[: torn.index("é".encode("utf-8")) + 1]  # the first byte of a two-byte character, no newline
    path = write_log(tmp_path, whole + cut)
    app, ref = app_client(tmp_path), reference_client(path)
    body = assert_bodies_equal(app, ref, {"limit": 5})
    assert body["partial_tail"] is True


# ---------------------------------------------------------------- what the cache keeps and charges


def test_oos_log_cached_weight_matches_retained(tmp_path):
    """The cached value keeps at most 2x the file's bytes, and the file cache charges within 25% of what it keeps.

    Born failing before W5C: the parsed log kept about 1.6 KB of dicts per line (about five times its file) and was
    charged only its file's size."""
    write_log(tmp_path, synthetic_log(2))
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(tmp_path)}))
    client = api_client(app, base_url=LOCAL, client=LOOPBACK)
    assert client.get("/api/audit/oos-log", params={"limit": 1}).status_code == 200  # warms routes and models
    raw = synthetic_log()
    write_log(tmp_path, raw)
    del raw
    gc.collect()
    tracemalloc.start()
    try:
        base = tracemalloc.get_traced_memory()[0]
        response = client.get("/api/audit/oos-log", params={"limit": 1})
        assert response.status_code == 200 and response.json()["total"] > 23_000
        del response
        gc.collect()
        retained = tracemalloc.get_traced_memory()[0] - base
    finally:
        tracemalloc.stop()
    size = (tmp_path / LOG_RELATIVE).stat().st_size
    stats = app.state.audit_files.stats()
    assert stats.entries == 1
    assert retained <= 2 * size, f"the cached log keeps {retained / size:.2f}x its file"
    assert abs(stats.bytes - retained) <= 0.25 * retained, f"charged {stats.bytes}, keeps {retained}"


# ---------------------------------------------------------------- a log that only grew


class ParseCounter:
    """Counts `audit._parse_line` calls: one per line the parser reads, one per entry a page decodes."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch):
        self.calls = 0
        real = audit._parse_line

        def counted(text: str):
            self.calls += 1
            return real(text)

        monkeypatch.setattr(audit, "_parse_line", counted)

    def take(self) -> int:
        calls, self.calls = self.calls, 0
        return calls


def test_oos_log_tail_append_reparses_tail_only(tmp_path, monkeypatch):
    lines = 3_000
    path = write_log(tmp_path, synthetic_log(lines))
    app, ref = app_client(tmp_path), reference_client(path)
    before = app.get("/api/audit/oos-log", params={"limit": 1}).json()
    counter = ParseCounter(monkeypatch)

    append_log(path, synthetic_log(10, start=50_000))
    body = app.get("/api/audit/oos-log", params={"limit": 10}).json()
    assert counter.take() <= 10 + 10 + 1, "only the appended lines are parsed, plus the page decoded"
    assert body["total"] == before["total"] + 10
    assert [e["rows"] for e in body["entries"]] == [300_000 + i for i in range(50_000, 50_010)]
    counter.take()
    assert_bodies_equal(app, ref, {"limit": 10})
    assert_bodies_equal(app, ref, {"limit": 5000, "caller": "terminal"})


def test_a_half_written_last_line_is_completed_by_the_next_append(tmp_path, monkeypatch):
    path = write_log(tmp_path, synthetic_log(500))
    app, ref = app_client(tmp_path), reference_client(path)
    app.get("/api/audit/oos-log", params={"limit": 1})
    counter = ParseCounter(monkeypatch)
    line = _line(70_000).encode("utf-8")
    append_log(path, line[:40])
    assert app.get("/api/audit/oos-log", params={"limit": 3}).json()["partial_tail"] is True
    assert counter.take() <= 1 + 3, "only the half-written line is parsed, plus the page decoded"
    assert_bodies_equal(app, ref, {"limit": 3})
    counter.take()
    append_log(path, line[40:] + b"\n")
    body = app.get("/api/audit/oos-log", params={"limit": 3}).json()
    assert counter.take() <= 1 + 3, "the completed line is parsed again, not the whole log"
    assert body["partial_tail"] is False and body["entries"][-1]["rows"] == 370_000
    assert_bodies_equal(app, ref, {"limit": 3})


def test_a_rewrite_that_is_not_an_append_parses_the_whole_log(tmp_path, monkeypatch):
    lines = 2_000
    path = write_log(tmp_path, synthetic_log(lines))
    app, ref = app_client(tmp_path), reference_client(path)
    app.get("/api/audit/oos-log", params={"limit": 1})
    counter = ParseCounter(monkeypatch)
    raw = path.read_bytes()
    changed = raw.replace(b'"caller": "terminal"', b'"caller": "terminaX"', 1) + _line(80_000).encode("utf-8") + b"\n"
    before = path.stat().st_mtime_ns
    path.write_bytes(changed)
    os.utime(path, ns=(before + ONE_SECOND_NS, before + ONE_SECOND_NS))
    app.get("/api/audit/oos-log", params={"limit": 1})
    assert counter.take() >= lines - 2, "a changed prefix is a full parse"
    assert_bodies_equal(app, ref, {"limit": 50, "caller": "terminaX"})

    path.write_bytes(changed[: len(changed) // 2].rsplit(b"\n", 1)[0] + b"\n")  # shrinks: a full parse too
    os.utime(path, ns=(before + 2 * ONE_SECOND_NS, before + 2 * ONE_SECOND_NS))
    counter.take()
    app.get("/api/audit/oos-log", params={"limit": 1})
    assert counter.take() >= lines // 2 - 2
    assert_bodies_equal(app, ref, {"limit": 5000})


# ---------------------------------------------------------------- the instrument page's count


def test_the_compact_count_of_terminal_reads_per_symbol_matches_the_decoded_entries():
    raw = synthetic_log(1_500)
    compact = audit.compact_oos_log(raw)
    entries = audit.parse_oos_log_bytes(raw).entries
    for root in ("NQ", "ES", "GC", "ZZ"):
        symbol = f"{root}.V.0"
        assert compact.count_reads(caller=CALLER, symbol=symbol) == logged_reads(entries, root)
    assert [dict(e) for e in compact.entries] == [dict(e) for e in entries], "the lazy view decodes every entry"


def test_the_instrument_page_counts_from_the_index_without_decoding_the_log(tmp_path, monkeypatch):
    lines = 2_000
    raw = synthetic_log(lines)
    write_log(tmp_path, raw)
    app = app_client(tmp_path)
    app.get("/api/audit/oos-log", params={"limit": 1})  # the log is now indexed and cached
    counter = ParseCounter(monkeypatch)
    body = app.get("/api/instruments/NQ").json()
    assert counter.take() == 0, "the instrument page decodes no log entry: it counts from the index"
    expected = logged_reads(audit.parse_oos_log_bytes(raw).entries, "NQ")
    assert expected > 0 and body["coverage"]["gate_reads_logged"] == expected
