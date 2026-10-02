"""The live SSE stream (TASKS 9.2): journal rows, resets, status and kill switch changes, heartbeats, Last-Event-ID
resume across a restart, bounded work per tick, and the same origin and header rules as every other route.

Every journal here is a copy under tmp_path (the session guard refuses writes anywhere under live/). The session is
driven tick by tick with a fake clock; the route is read with TestClient, which buffers the whole response, so each
app gets a short stream lifetime (`app.state.live_stream_limits`).
"""
from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab import paper_plumbing
from nq_terminal.api import live, live_stream
from nq_terminal.app import create_app
from nq_terminal.models.live import LiveStatus
from nq_terminal.services import journals
from nq_terminal.settings import load_settings

from fakes import FIXTURES

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
BOOK = "volmanaged_paper_journal.jsonl"
PLUMBING = "volmanaged_paper_journal.PLUMBING_DELAYED.jsonl"
PREFLIGHT = "preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl"
FIXTURE_LOGS = FIXTURES / "live" / "logs"
KINDS = {"hello", "status", "kill_switch", "journal_reset", "journal_row", "heartbeat", "bye"}
FAST = live_stream.StreamLimits(poll_s=0.01, heartbeat_s=0.05, status_every_s=0.05, lifetime_s=0.25, retry_ms=500)


def row(**fields) -> str:
    return json.dumps({"type": "close", "date": "2026-09-28", **fields}) + "\n"


def logs_of(root: Path) -> Path:
    return root / "live" / "logs"


@pytest.fixture
def root(tmp_path: Path) -> Path:
    """A data root holding copies of the fixture journals and log."""
    logs_of(tmp_path).mkdir(parents=True)
    for path in FIXTURE_LOGS.iterdir():
        shutil.copyfile(path, logs_of(tmp_path) / path.name)
    return tmp_path


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _status_client(root: Path) -> TestClient:
    return api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(root)})), base_url=LOCAL, client=LOOPBACK)


def session(root: Path, cursor=None, limits: live_stream.StreamLimits = FAST, clock: Clock | None = None,
            note: str | None = None) -> live_stream.StreamSession:
    api = _status_client(root)
    monitor = journals.LiveMonitor(root)
    return live_stream.StreamSession(monitor=monitor, data_root=root,
                                     status=lambda: LiveStatus(**api.get("/api/live/status").json()),
                                     limits=limits, cursor=cursor, resume_note=note, clock=clock or Clock())


def start(s: live_stream.StreamSession) -> list:
    """The opening events, then ticks until no row is waiting (the fake clock stands still: no heartbeat)."""
    events = s.opening()
    while True:
        more_events, more = s.tick()
        events += more_events
        if not more:
            return events


def kinds(events) -> list[str]:
    return [e.event for e in events]


def rows_in(events) -> list[tuple[str, int]]:
    return [(e.data.row.file, e.data.row.line_no) for e in events if e.event == "journal_row"]


def lines_of(path: Path) -> int:
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())


# ---------------------------------------------------------------- the session, tick by tick


def test_a_fresh_stream_opens_with_hello_kill_status_then_every_journal(root: Path):
    events = start(session(root))
    assert kinds(events)[:3] == ["hello", "kill_switch", "status"]
    hello = events[0].data
    assert hello.resumed is False and hello.resume_note is None and events[0].retry == FAST.retry_ms
    assert hello.read_only is True and hello.order_path == "none" and hello.banner == paper_plumbing.BANNER
    resets = [e.data for e in events if e.event == "journal_reset"]
    assert [r.file for r in resets] == sorted(p.name for p in FIXTURE_LOGS.glob("*.jsonl"))
    assert {r.reason for r in resets} == {"sync"} and all(r.skipped_rows == 0 for r in resets)
    sent = rows_in(events)
    for name in {r.file for r in resets}:
        assert [n for f, n in sent if f == name] == list(range(1, lines_of(logs_of(root) / name) + 1))


def test_every_event_carries_the_cursor_after_it(root: Path):
    s = session(root)
    events = start(s)
    assert all(e.id is not None and e.id.startswith("c1") for e in events)
    assert events[-1].id == s.cursor_id
    assert set(journals.parse_cursor(s.cursor_id)) == {p.name for p in FIXTURE_LOGS.glob("*.jsonl")}
    assert all(e.data.kind == e.event for e in events) and set(kinds(events)) <= KINDS


def test_plumbing_rows_are_labelled_and_the_status_uses_performance_rows_only(root: Path):
    events = start(session(root))
    rows = [e.data.row for e in events if e.event == "journal_row"]
    assert all(r.banner == (paper_plumbing.BANNER if r.plumbing else None) for r in rows)
    assert all(r.plumbing for r in rows if r.file in (PLUMBING, PREFLIGHT))
    book_plumbing = [r.data["date"] for r in rows if r.file == BOOK and r.plumbing]
    assert book_plumbing == ["2026-10-02"]
    status = next(e.data.status for e in events if e.event == "status")
    assert status.last_close.date == "2026-10-01"  # the plumbing close of 2026-10-02 is not performance


def test_a_quiet_tick_sends_nothing_until_the_heartbeat_is_due(root: Path):
    clock = Clock()
    s = session(root, clock=clock)
    start(s)
    events, more = s.tick()
    assert events == [] and more is False
    clock.now += FAST.heartbeat_s
    events, _ = s.tick()
    assert kinds(events) == ["heartbeat"] and events[0].data.interval_s == FAST.heartbeat_s


def test_an_appended_row_is_sent_once_with_its_line_number(root: Path):
    s = session(root)
    start(s)
    with (logs_of(root) / BOOK).open("a", encoding="utf-8") as fh:
        fh.write(row(date="2026-10-05", target=4))
    events, _ = s.tick()
    assert rows_in(events) == [(BOOK, 7)]
    assert "status" in kinds(events)  # the book changed, so the status is sent again
    assert rows_in(s.tick()[0]) == []


def test_a_truncated_journal_is_reset_and_sent_again(root: Path):
    s = session(root)
    start(s)
    (logs_of(root) / BOOK).write_text(row(target=1), encoding="utf-8")
    events, _ = s.tick()
    reset = next(e.data for e in events if e.event == "journal_reset")
    assert reset.file == BOOK and reset.reason == "changed" and reset.first_line_no == 1
    assert rows_in(events) == [(BOOK, 1)]


def test_a_removed_journal_is_reset_and_leaves_the_cursor(root: Path):
    s = session(root)
    start(s)
    (logs_of(root) / PLUMBING).unlink()
    events, _ = s.tick()
    reset = next(e.data for e in events if e.event == "journal_reset")
    assert reset.file == PLUMBING and reset.reason == "removed"
    assert PLUMBING not in journals.parse_cursor(s.cursor_id)


def test_a_new_journal_is_announced_then_sent(root: Path):
    s = session(root)
    start(s)
    (logs_of(root) / "extra.jsonl").write_text(row(target=1) + row(target=2), encoding="utf-8")
    events, _ = s.tick()
    assert [(e.data.file, e.data.reason) for e in events if e.event == "journal_reset"] == [("extra.jsonl", "new")]
    assert rows_in(events) == [("extra.jsonl", 1), ("extra.jsonl", 2)]


def test_the_kill_switch_change_is_sent_with_a_new_status(root: Path):
    s = session(root)
    opening = start(s)
    assert next(e.data for e in opening if e.event == "kill_switch").on is False
    (root / "live" / "KILL-now").write_text("", encoding="utf-8")
    events, _ = s.tick()
    kill = next(e.data for e in events if e.event == "kill_switch")
    assert kill.on is True and kill.path == "live/KILL*"
    assert next(e.data.status for e in events if e.event == "status").kill_switch_on is True
    assert "kill_switch" not in kinds(s.tick()[0])


def test_the_backlog_is_capped_and_says_how_many_rows_it_skipped(tmp_path: Path):
    logs_of(tmp_path).mkdir(parents=True)
    (logs_of(tmp_path) / "big.jsonl").write_text("".join(row(target=i) for i in range(30)), encoding="utf-8")
    s = session(tmp_path, limits=live_stream.StreamLimits(backlog_rows=10))
    events = start(s)
    reset = next(e.data for e in events if e.event == "journal_reset")
    assert (reset.reason, reset.skipped_rows, reset.first_line_no) == ("sync", 20, 21)
    assert rows_in(events) == [("big.jsonl", n) for n in range(21, 31)]


def test_work_per_tick_is_bounded_and_nothing_is_lost(tmp_path: Path):
    logs_of(tmp_path).mkdir(parents=True)
    path = logs_of(tmp_path) / "j.jsonl"
    path.write_text(row(target=0), encoding="utf-8")
    s = session(tmp_path, limits=live_stream.StreamLimits(max_rows_per_tick=10))
    start(s)
    with path.open("a", encoding="utf-8") as fh:
        fh.write("".join(row(target=i) for i in range(1, 26)))
    sent, flags = [], []
    for _ in range(4):
        events, more = s.tick()
        sent += rows_in(events)
        flags.append(more)
    assert [n for _, n in sent] == list(range(2, 27))
    assert flags == [True, True, False, False]


def test_a_resumed_session_continues_after_the_cursor(root: Path):
    first = session(root)
    start(first)
    cursor = journals.parse_cursor(first.cursor_id)
    with (logs_of(root) / BOOK).open("a", encoding="utf-8") as fh:
        fh.write(row(date="2026-10-05", target=4))
    events = start(session(root, cursor=cursor))
    assert events[0].data.resumed is True
    assert "journal_reset" not in kinds(events)
    assert rows_in(events) == [(BOOK, 7)]


def test_a_resume_names_a_journal_that_went_away(root: Path):
    first = session(root)
    start(first)
    cursor = journals.parse_cursor(first.cursor_id)
    (logs_of(root) / PREFLIGHT).unlink()
    events = start(session(root, cursor=cursor))
    assert [(e.data.file, e.data.reason) for e in events if e.event == "journal_reset"] == [(PREFLIGHT, "removed")]


def test_a_mislabelled_row_never_leaves_the_session(root: Path, monkeypatch: pytest.MonkeyPatch):
    """Born failing: a parser that lost the plumbing label would stream a plumbing row as performance."""
    real = journals.parse_row

    def unlabelled(text: str, file: str, line_no: int):
        parsed = real(text, file, line_no)
        return journals.JournalRow(parsed.file, parsed.line_no, False, parsed.data)

    monkeypatch.setattr(journals, "parse_row", unlabelled)
    with pytest.raises(journals.PlumbingLeakError):
        start(session(root))


# ---------------------------------------------------------------- the route


def app_for(root: Path, limits: live_stream.StreamLimits = FAST):
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)}))
    app.state.live_stream_limits = limits
    return app


def client_for(root: Path, limits: live_stream.StreamLimits = FAST) -> TestClient:
    return api_client(app_for(root, limits), base_url=LOCAL, client=LOOPBACK)


def parse_stream(text: str) -> list[dict]:
    """The SSE wire format: blocks split by a blank line; comment lines (`:`) ignored."""
    events = []
    for block in text.split("\n\n"):
        fields: dict[str, str] = {}
        for line in block.split("\n"):
            if not line or line.startswith(":"):
                continue
            name, _, value = line.partition(": ")
            fields[name] = value
        if fields:
            events.append({**fields, "data": json.loads(fields["data"]) if "data" in fields else None})
    return events


def read(c: TestClient, last_event_id: str | None = None) -> tuple[object, list[dict]]:
    headers = {} if last_event_id is None else {"Last-Event-ID": last_event_id}
    response = c.get("/api/live/stream", headers=headers)
    return response, parse_stream(response.text)


def test_the_stream_is_text_event_stream_with_the_security_headers(root: Path):
    response, events = read(client_for(root))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    # no-store rather than the framework's no-cache: a live journal stream is never kept by a disk cache or proxy.
    assert response.headers.get_list("cache-control") == ["no-store"]
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["x-frame-options"] == "DENY" and response.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["referrer-policy"] == "no-referrer"
    assert events[0]["event"] == "hello" and events[0]["retry"] == str(FAST.retry_ms)
    assert events[-1]["event"] == "bye" and events[-1]["data"]["retry_ms"] == FAST.retry_ms
    assert all(e["data"]["kind"] == e["event"] and e["id"].startswith("c1") for e in events)
    assert "heartbeat" in {e["event"] for e in events}


def test_a_reconnect_after_a_server_restart_resumes_from_last_event_id(root: Path):
    _, before = read(client_for(root))
    last_id = before[-1]["id"]
    with (logs_of(root) / BOOK).open("a", encoding="utf-8") as fh:  # written while the server was down
        fh.write(row(date="2026-10-05", target=4))
    _, after = read(client_for(root), last_id)  # a new app: nothing survives in memory but the id
    assert after[0]["data"]["resumed"] is True
    assert [e for e in after if e["event"] == "journal_reset"] == []
    assert [(e["data"]["row"]["file"], e["data"]["row"]["line_no"]) for e in after if e["event"] == "journal_row"] \
        == [(BOOK, 7)]


def test_a_stream_whose_opening_outlasts_its_lifetime_still_ticks_once(root: Path):
    """A slow machine must not turn a stream into hello and bye with no journal row in between."""
    readings = iter([0.0])
    slow_clock = lambda: next(readings, 1000.0)  # noqa: E731  (the first reading fixes the end; the rest are late)

    async def collect() -> list:
        return [event async for event in live_stream.run_stream(session(root), FAST, clock=slow_clock)]

    events = asyncio.run(collect())
    assert events[-1].event == "bye"
    assert "journal_row" in [e.event for e in events]


def test_an_unrecognised_last_event_id_starts_again_and_says_so(root: Path):
    _, events = read(client_for(root), "c1|../results/oos_access_log.jsonl:1:0123456789ab")
    hello = events[0]["data"]
    assert hello["resumed"] is False and "not recognised" in hello["resume_note"]
    assert {e["data"]["reason"] for e in events if e["event"] == "journal_reset"} == {"sync"}


def test_a_tampered_last_event_id_replays_the_journal(root: Path):
    _, before = read(client_for(root))
    cursor = journals.parse_cursor(before[-1]["id"])
    cursor[BOOK] = journals.CursorEntry(cursor[BOOK].line_no, "0" * journals.DIGEST_CHARS)
    _, after = read(client_for(root), journals.encode_cursor(cursor))
    resets = [(e["data"]["file"], e["data"]["reason"]) for e in after if e["event"] == "journal_reset"]
    assert resets == [(BOOK, "changed")]
    assert [e["data"]["row"]["line_no"] for e in after if e["event"] == "journal_row"] == list(range(1, 7))


@pytest.mark.parametrize("headers", [{"Origin": "http://evil.example"}, {"Sec-Fetch-Site": "cross-site"}])
def test_a_cross_site_stream_is_refused(root: Path, headers: dict):
    assert client_for(root).get("/api/live/stream", headers=headers).status_code == 403


def test_a_non_loopback_client_is_refused(root: Path):
    c = api_client(app_for(root), base_url=LOCAL, client=("192.168.1.20", 50000))
    assert c.get("/api/live/stream").status_code == 403


def test_the_stream_is_get_only(root: Path):
    assert client_for(root).post("/api/live/stream").status_code == 405


def test_streams_are_capped_and_a_slot_is_freed_when_a_stream_ends(root: Path):
    app = app_for(root, live_stream.StreamLimits(poll_s=0.01, lifetime_s=0.05, max_streams=1))
    c = api_client(app, base_url=LOCAL, client=LOOPBACK)
    assert c.get("/api/live/stream").status_code == 200
    slots = live_stream.stream_slots(app)
    assert slots.open == 0
    assert slots.acquire() is True
    refused = c.get("/api/live/stream")
    assert refused.status_code == 503 and "at most 1" in refused.json()["detail"]
    slots.release()
    assert c.get("/api/live/stream").status_code == 200


def test_the_contract_documents_every_event_kind(root: Path):
    schema = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)})).openapi()
    op = schema["paths"]["/api/live/stream"]
    assert set(op) == {"get"}
    item = op["get"]["responses"]["200"]["content"]["text/event-stream"]["itemSchema"]
    assert set(item["properties"]["data"]["contentSchema"]["discriminator"]["mapping"]) == KINDS
    assert [p["name"] for p in op["get"]["parameters"]] == ["Last-Event-ID"]
    assert "503" in op["get"]["responses"]


@pytest.mark.parametrize("field", ["poll_s", "lifetime_s", "max_streams", "backlog_rows", "max_rows_per_tick"])
def test_limits_must_be_positive(field: str):
    with pytest.raises(ValueError):
        live_stream.StreamLimits(**{field: 0})


def test_the_stream_shares_the_live_monitor(root: Path):
    app = app_for(root)
    c = api_client(app, base_url=LOCAL, client=LOOPBACK)
    c.get("/api/live/status")
    monitor = app.state.live_monitor
    c.get("/api/live/stream")
    assert app.state.live_monitor is monitor is live.live_monitor(type("R", (), {"app": app})())
