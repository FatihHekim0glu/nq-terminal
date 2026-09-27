"""Live monitor (TASKS 2.4): journal discovery and tailing, plumbing labels, the performance path, the Nautilus log
parser, the kill switch, env reporting and the read-only /api/live endpoints.

Real files under live/ are only read. Every write here goes to tmp_path (the session guard refuses the rest).
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab import paper_plumbing
from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.services import journals
from nq_terminal.settings import load_settings

from fakes import FIXTURES

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
PREFLIGHT = "preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl"
PREFLIGHT_LOG = "preflight2_2026-09-26_PLUMBING_DELAYED.log"
BOOK = "volmanaged_paper_journal.jsonl"
FIXTURE_LOGS = FIXTURES / "live" / "logs"
REAL_LOGS = ROOT / "live" / "logs"


def client(env: dict | None = None) -> TestClient:
    return TestClient(create_app(load_settings(env or {})), base_url=LOCAL, client=LOOPBACK)


def fixture_client() -> TestClient:
    return client({"NQT_FIXTURE_DIR": str(FIXTURES)})


def row(**fields) -> str:
    return json.dumps({"type": "close", "date": "2026-09-28", **fields}) + "\n"


# ---------------------------------------------------------------- discovery and the real preflight journal


def test_discovery_lists_every_real_journal():
    found = [p.name for p in journals.discover(REAL_LOGS, journals.JOURNAL_SUFFIX)]
    assert found == sorted(p.name for p in REAL_LOGS.glob("*.jsonl"))
    assert PREFLIGHT in found


def test_the_real_preflight_journal_is_read_and_every_row_is_plumbing():
    state = journals.JournalTailer(REAL_LOGS / PREFLIGHT).poll()
    lines = [x for x in (REAL_LOGS / PREFLIGHT).read_text(encoding="utf-8").splitlines() if x.strip()]
    assert len(state.rows) == len(lines) >= 1
    assert all(r.plumbing is True for r in state.rows)
    assert state.bad_lines == ()


def test_rows_are_classed_by_row_not_by_file_name():
    rows = journals.JournalTailer(FIXTURE_LOGS / BOOK).poll().rows
    labelled = {r.data["date"] for r in rows if r.plumbing}
    assert labelled == {"2026-10-02"}  # the one labelled row inside the book journal (DL11)
    assert all(r.plumbing == paper_plumbing.is_plumbing(r.data) for r in rows)


def test_nan_becomes_null_and_ns_fields_gain_iso_and_epoch():
    book = journals.JournalTailer(FIXTURE_LOGS / BOOK).poll().rows
    nan_row = next(r for r in book if r.data["date"] == "2026-09-30")
    assert nan_row.data["wstar"] is None and nan_row.data["exposure"] is None
    plumbing = journals.JournalTailer(FIXTURE_LOGS / "volmanaged_paper_journal.PLUMBING_DELAYED.jsonl").poll().rows
    fetch = next(r for r in plumbing if r.data["type"] == "delayed_fetch")
    assert fetch.data["decided_at_ns"] == "2026-09-28T19:55:05.000000000Z"
    assert fetch.data["decided_at_ns_epoch_s"] == 1790625305


# ---------------------------------------------------------------- the tailer


def test_tailer_reads_only_new_bytes(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1), encoding="utf-8")
    tailer = journals.JournalTailer(path)
    assert len(tailer.poll().rows) == 1
    first = tailer.offset
    with path.open("a", encoding="utf-8") as fh:
        fh.write(row(target=2))
    state = tailer.poll()
    assert [r.data["target"] for r in state.rows] == [1, 2]
    assert tailer.offset == path.stat().st_size > first


def test_tailer_holds_back_a_partial_last_line(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    full = row(target=2)
    path.write_text(row(target=1) + full[:20], encoding="utf-8")
    tailer = journals.JournalTailer(path)
    state = tailer.poll()
    assert len(state.rows) == 1 and state.partial_pending is True and state.bad_lines == ()
    with path.open("a", encoding="utf-8") as fh:
        fh.write(full[20:])
    state = tailer.poll()
    assert [r.data["target"] for r in state.rows] == [1, 2] and state.partial_pending is False
    assert [r.line_no for r in state.rows] == [1, 2]


def test_tailer_starts_again_after_truncation(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1) + row(target=2), encoding="utf-8")
    tailer = journals.JournalTailer(path)
    assert len(tailer.poll().rows) == 2
    path.write_text(row(target=9), encoding="utf-8")
    state = tailer.poll()
    assert [r.data["target"] for r in state.rows] == [9]
    assert state.resets == 1


def test_tailer_starts_again_when_the_file_is_replaced(tmp_path: Path):
    path, other = tmp_path / "j.jsonl", tmp_path / "k.jsonl"
    path.write_text(row(target=1), encoding="utf-8")
    tailer = journals.JournalTailer(path)
    tailer.poll()
    other.write_text(row(target=7) + row(target=8), encoding="utf-8")
    other.replace(path)
    assert [r.data["target"] for r in tailer.poll().rows] == [7, 8]


def test_tailer_returns_the_same_rows_until_the_file_changes(tmp_path: Path):
    """An unchanged journal costs no copy per poll (TASKS 9.2: many streams poll the one shared tailer)."""
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1), encoding="utf-8")
    tailer = journals.JournalTailer(path)
    first, second = tailer.poll(), tailer.poll()
    assert first.rows is second.rows
    with path.open("a", encoding="utf-8") as fh:
        fh.write(row(target=2))
    third = tailer.poll()
    assert third.rows is not second.rows and [r.data["target"] for r in third.rows] == [1, 2]


def test_tailer_reports_bad_lines_and_a_missing_file(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1) + "{broken\n" + "[1, 2]\n", encoding="utf-8")
    state = journals.JournalTailer(path).poll()
    assert len(state.rows) == 1 and [b.line_no for b in state.bad_lines] == [2, 3]
    gone = journals.JournalTailer(tmp_path / "none.jsonl").poll()
    assert gone.rows == () and gone.present is False


# ---------------------------------------------------------------- the stream cursor (TASKS 9.2, Last-Event-ID)


def rows_of(path: Path) -> tuple[journals.JournalRow, ...]:
    return journals.JournalTailer(path).poll().rows


def test_cursor_round_trips_and_sorts_by_name():
    entries = {"b.jsonl": journals.CursorEntry(3, "0123456789ab"), "a.jsonl": journals.CursorEntry(1, "ba9876543210")}
    text = journals.encode_cursor(entries)
    assert text == "c1|a.jsonl:1:ba9876543210|b.jsonl:3:0123456789ab"
    assert journals.parse_cursor(text) == entries
    assert journals.encode_cursor({}) == "c1" and journals.parse_cursor("c1") == {}


@pytest.mark.parametrize("text", [
    "", "c2", "c1|", "c1|a.jsonl:0:0123456789ab", "c1|a.jsonl:1:0123456789AB", "c1|a.jsonl:1:0123",
    "c1|../results/oos_access_log.jsonl:1:0123456789ab", "c1|a\\b.jsonl:1:0123456789ab", " c1",
    "c1|a.jsonl:1:0123456789ab|a.jsonl:2:0123456789ab", "c1|a.jsonl:01:0123456789ab",
    "c1" + "".join(f"|a{n}.jsonl:1:0123456789ab" for n in range(400)),
], ids=lambda text: repr(text[:40]))
def test_cursor_parser_refuses_anything_it_did_not_write(text: str):
    with pytest.raises(journals.CursorError):
        journals.parse_cursor(text)


def test_row_digest_is_stable_across_tailers_and_sees_a_changed_row(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1) + row(target=2), encoding="utf-8")
    first, again = rows_of(path), rows_of(path)  # a new tailer is a restarted server
    assert [journals.row_digest(r) for r in first] == [journals.row_digest(r) for r in again]
    path.write_text(row(target=1) + row(target=3), encoding="utf-8")
    assert journals.row_digest(rows_of(path)[1]) != journals.row_digest(first[1])
    assert len(journals.row_digest(first[0])) == journals.DIGEST_CHARS


def test_resume_point_continues_after_a_matching_row(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1) + "{broken\n" + row(target=2) + row(target=3), encoding="utf-8")
    rows = rows_of(path)
    entry = journals.CursorEntry(rows[1].line_no, journals.row_digest(rows[1]))
    assert journals.resume_point(rows, entry) == 2
    assert journals.resume_point(rows, None) == 0


def test_resume_point_is_none_when_the_row_changed_born_failing(tmp_path: Path):
    """A resume that trusted the line number alone would skip the rewritten rows; the digest catches it."""
    path = tmp_path / "j.jsonl"
    path.write_text(row(target=1) + row(target=2), encoding="utf-8")
    entry = journals.CursorEntry(2, journals.row_digest(rows_of(path)[1]))
    path.write_text(row(target=1) + row(target=9) + row(target=10), encoding="utf-8")
    assert journals.resume_point(rows_of(path), entry) is None
    path.write_text(row(target=1), encoding="utf-8")  # truncated below the cursor
    assert journals.resume_point(rows_of(path), entry) is None


def test_a_mislabelled_row_is_caught_born_failing():
    plumbing = {"type": "close", "date": "2026-10-02", "strategy_performance": False}
    journals.check_row_label(journals.JournalRow("j.jsonl", 1, True, plumbing))
    with pytest.raises(journals.PlumbingLeakError):
        journals.check_row_label(journals.JournalRow("j.jsonl", 1, False, plumbing))


# ---------------------------------------------------------------- the performance path


def fixture_rows():
    return journals.JournalTailer(FIXTURE_LOGS / BOOK).poll().rows


def test_performance_drops_the_plumbing_row():
    series = journals.performance_series(fixture_rows())
    assert "2026-10-02" not in series["date"]
    assert series["date"] == ["2026-09-28", "2026-09-30", "2026-10-01"]
    assert series["plumbing_rows_skipped"] == 1


def test_a_plumbing_row_reaching_performance_is_caught_born_failing():
    """Without `performance_rows` (an identity filter) the plumbing row leaks, and the guard sees it."""
    with pytest.raises(journals.PlumbingLeakError):
        journals.performance_series(fixture_rows(), keep=list)


def test_odd_field_types_become_null_in_the_series(tmp_path: Path):
    path = tmp_path / "j.jsonl"
    path.write_text(row(target="six", exposure=True, slippage_ticks=[1], sent="yes", error={"x": 1}), encoding="utf-8")
    series = journals.performance_series(journals.JournalTailer(path).poll().rows)
    assert series["target"] == [None] and series["exposure"] == [None] and series["slippage_ticks"] == [None]
    assert series["sent"] == [None] and series["error"] == ["{'x': 1}"]


def test_the_leak_guard_itself():
    journals.check_no_plumbing([{"type": "close"}])
    with pytest.raises(journals.PlumbingLeakError):
        journals.check_no_plumbing([{"type": "close", "strategy_performance": False}])
    with pytest.raises(journals.PlumbingLeakError):
        journals.check_no_plumbing([{"type": "close", "mode": paper_plumbing.MODE}])


def test_exposure_summary_is_the_imported_one():
    summary = journals.exposure(FIXTURE_LOGS / BOOK)
    assert summary == paper_plumbing.exposure_summary(FIXTURE_LOGS / BOOK)
    assert summary["plumbing_rows_skipped"] == 1 and summary["sessions"] == 1


def test_exposure_of_a_half_written_journal_is_none(tmp_path: Path):
    path = tmp_path / BOOK
    path.write_text(row(exposure=0.5) + row(exposure=0.6)[:15], encoding="utf-8")
    assert journals.exposure(path) is None


# ---------------------------------------------------------------- kill switch


def test_a_kill_now_file_counts_as_on(tmp_path: Path):
    (tmp_path / "live").mkdir()
    assert journals.kill_switch_on(tmp_path) is False
    (tmp_path / "live" / "NOKILL").write_text("", encoding="utf-8")
    assert journals.kill_switch_on(tmp_path) is False
    (tmp_path / "live" / "KILL-now").write_text("", encoding="utf-8")
    assert journals.kill_switch_on(tmp_path) is True


def test_status_follows_the_kill_file(tmp_path: Path):
    (tmp_path / "live" / "logs").mkdir(parents=True)
    c = client({"NQT_FIXTURE_DIR": str(tmp_path)})
    assert c.get("/api/live/status").json()["kill_switch_on"] is False
    (tmp_path / "live" / "KILL-now").write_text("", encoding="utf-8")
    assert c.get("/api/live/status").json()["kill_switch_on"] is True


# ---------------------------------------------------------------- Nautilus logs


def test_log_lines_parse_with_levels_components_and_masked_accounts():
    text = (FIXTURE_LOGS / PREFLIGHT_LOG).read_text(encoding="utf-8", errors="replace")
    lines = journals.parse_log_text(text, tail=500)
    assert len(lines) == len([x for x in text.splitlines() if x.strip()])
    assert {x.level for x in lines} == {"INFO", "WARN"}
    ib = next(x for x in lines if x.component == "InteractiveBrokersClient-011")
    assert ib.trader == "NQLAB-PAPER" and ib.ts_epoch_s is not None
    assert not any("DU1234567" in x.message for x in lines)
    assert any("DU*******" in x.message for x in lines)
    assert [x.line_no for x in journals.parse_log_text(text, tail=3)] == [x.line_no for x in lines[-3:]]


def test_a_line_outside_the_format_is_kept_as_raw():
    [line] = journals.parse_log_text("continuation of a traceback\n", tail=10)
    assert line.level is None and line.message == "continuation of a traceback"


def test_account_masking():
    assert journals.mask_accounts("account DU1234567 and U7654321 ok") == "account DU******* and U******* ok"
    assert journals.mask_accounts("MNQZ6.CME req_id=-1 code 2104") == "MNQZ6.CME req_id=-1 code 2104"


# ---------------------------------------------------------------- env and times


def test_env_reports_set_or_unset_and_masks_the_account():
    env = journals.live_env({"IB_ACCOUNT_ID": "DU1234567", "IB_PORT": "7497", "IB_HOST": "127.0.0.1",
                             "IB_PAPER_DELAYED_DATA": "1"})
    assert env == {"ib_host": "127.0.0.1", "ib_port": 7497, "account_masked": "DU*******",
                   "delayed_flag_set": True, "volman_c_set": False, "base_usd_rate_set": False}
    other = journals.live_env({"IB_HOST": "10.0.0.5", "IB_PORT": "x", "IB_PAPER_DELAYED_DATA": "true",
                               "VOLMAN_C": "0.1"})
    assert other["ib_host"] == "set (not loopback)" and other["ib_port"] is None
    assert other["delayed_flag_set"] is False and other["volman_c_set"] is True
    assert other["account_masked"] is None


def test_next_times_follow_the_roll_rule():
    times = journals.next_times(dt.date(2026, 9, 26))
    assert times == {"decision_et": "15:55:05", "order_et": "15:59:30", "contract": "MNQZ6",
                     "roll_date": "2026-12-08", "today_et": "2026-09-26"}


def test_decision_and_order_times_match_the_live_strategy():
    from nq_lab.strategies import volmanaged_live as live

    close = dt.datetime(2026, 1, 1, 16, 0)
    decide = close - dt.timedelta(microseconds=(live.CUTOFF_NS - live.DECISION_DELAY_NS) // 1000)
    order = close - dt.timedelta(microseconds=live.ORDER_LEAD_NS // 1000)
    assert decide.strftime("%H:%M:%S") == journals.DECISION_ET
    assert order.strftime("%H:%M:%S") == journals.ORDER_ET


# ---------------------------------------------------------------- endpoints


def test_status_on_the_fixture():
    body = fixture_client().get("/api/live/status").json()
    names = {j["name"] for j in body["journals"]}
    assert names == {p.name for p in FIXTURE_LOGS.glob("*.jsonl")}
    preflight = next(j for j in body["journals"] if j["name"] == PREFLIGHT)
    assert preflight["plumbing"] is True and preflight["path"] == f"live/logs/{PREFLIGHT}"
    assert all(e["present"] for e in body["expected"])
    assert body["kill_switch_on"] is False
    assert body["banner"] == paper_plumbing.BANNER
    assert body["exposure_summary"]["plumbing_rows_skipped"] == 1
    assert body["last_close"]["date"] == "2026-10-01"  # the 2026-10-02 row is plumbing
    assert body["read_only"] is True and body["order_path"] == "none" and body["tws"] == "not monitored"
    assert set(body["env"]) == {"ib_host", "ib_port", "account_masked", "delayed_flag_set", "volman_c_set",
                                "base_usd_rate_set"}
    assert set(body["next"]) == {"decision_et", "order_et", "contract", "roll_date", "today_et"}


def test_status_on_the_real_tree():
    body = client().get("/api/live/status").json()
    assert {j["name"] for j in body["journals"]} == {p.name for p in REAL_LOGS.glob("*.jsonl")}
    assert next(j for j in body["journals"] if j["name"] == PREFLIGHT)["plumbing"] is True


def test_empty_states_name_the_expected_file(tmp_path: Path):
    body = client({"NQT_FIXTURE_DIR": str(tmp_path)}).get("/api/live/status").json()
    assert body["journals"] == []
    book = next(e for e in body["expected"] if e["name"] == BOOK)
    assert book["present"] is False
    assert book["empty_state"] == "no journal yet: live/logs/volmanaged_paper_journal.jsonl"
    assert body["exposure_summary"] is None and body["last_close"] is None


def test_journal_endpoint_labels_plumbing_rows():
    c = fixture_client()
    body = c.get("/api/live/journal", params={"file": PREFLIGHT}).json()
    assert body["total"] >= 1
    assert all(r["plumbing"] and r["banner"] == paper_plumbing.BANNER for r in body["items"])
    closes = c.get("/api/live/journal", params={"file": BOOK, "type": "close"}).json()["items"]
    assert {r["data"]["type"] for r in closes} == {"close"}
    assert [r["plumbing"] for r in closes] == [False, False, False, True]
    assert all(r["banner"] is None for r in closes if not r["plumbing"])


def test_journal_endpoint_without_a_file_merges_every_journal():
    items = fixture_client().get("/api/live/journal", params={"limit": 5000}).json()["items"]
    assert {r["file"] for r in items} == {p.name for p in FIXTURE_LOGS.glob("*.jsonl")}


@pytest.mark.parametrize("name", ["missing.jsonl", "../results/oos_access_log.jsonl", "..\\x.jsonl",
                                  PREFLIGHT_LOG])
def test_journal_endpoint_refuses_names_it_did_not_discover(name: str):
    assert fixture_client().get("/api/live/journal", params={"file": name}).status_code == 404


def test_log_endpoint_tails_a_discovered_log():
    c = fixture_client()
    body = c.get("/api/live/log", params={"file": PREFLIGHT_LOG, "tail": 5}).json()
    assert len(body["lines"]) == 5 and body["total_lines"] >= 5
    assert c.get("/api/live/log", params={"file": PREFLIGHT, "tail": 5}).status_code == 404
    assert c.get("/api/live/log", params={"file": PREFLIGHT_LOG, "tail": 0}).status_code == 422


def test_performance_endpoint_uses_performance_rows_only():
    body = fixture_client().get("/api/live/performance").json()
    assert body["journal"] == BOOK and body["present"] is True
    assert "2026-10-02" not in body["date"] and body["plumbing_rows_skipped"] == 1
    assert body["banner"] == paper_plumbing.BANNER


def test_performance_endpoint_without_a_journal(tmp_path: Path):
    body = client({"NQT_FIXTURE_DIR": str(tmp_path)}).get("/api/live/performance").json()
    assert body["present"] is False and body["date"] == []
    assert body["empty_state"] == "no journal yet: live/logs/volmanaged_paper_journal.jsonl"


def test_live_routes_are_get_only():
    c = fixture_client()
    for path in ("/api/live/status", "/api/live/journal", "/api/live/log", "/api/live/performance"):
        assert c.post(path).status_code == 405
