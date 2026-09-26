"""OOS log paging (ARCHITECTURE s4 pagination rule): `offset` walks back from the newest window.

Page k (offset = k * limit) holds the entries just older than page k-1, oldest first inside the page, so the swimlane
can load every entry once the log passes the 5,000 limit. `matched` counts every entry the filters keep.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from nq_terminal.app import create_app
from nq_terminal.services import audit
from nq_terminal.settings import load_settings

from fakes import FIXTURES


def _entries(n: int) -> list[dict]:
    return [{"caller": "x", "ts_utc": f"2026-09-26T00:00:{i:02d}+00:00", "line_no": i} for i in range(n)]


def test_offset_walks_back_from_the_newest_window():
    rows = _entries(10)
    assert [e["line_no"] for e in audit.select_entries(rows, caller=None, since=None, limit=4)] == [6, 7, 8, 9]
    page = audit.select_entries(rows, caller=None, since=None, limit=4, offset=4)
    assert [e["line_no"] for e in page] == [2, 3, 4, 5]
    last = audit.select_entries(rows, caller=None, since=None, limit=4, offset=8)
    assert [e["line_no"] for e in last] == [0, 1]
    assert audit.select_entries(rows, caller=None, since=None, limit=4, offset=12) == []


def test_the_endpoint_pages_through_the_whole_fixture_log():
    c = TestClient(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})), base_url="http://127.0.0.1",
                   client=("127.0.0.1", 50000))
    whole = c.get("/api/audit/oos-log", params={"limit": 5000}).json()
    seen, offset = [], 0
    for _ in range(len(whole["entries"]) // 3 + 2):  # bounded: an endpoint ignoring offset cannot loop forever
        page = c.get("/api/audit/oos-log", params={"limit": 3, "offset": offset}).json()
        if not page["entries"]:
            break
        seen = page["entries"] + seen
        offset += 3
    assert [e["line_no"] for e in seen] == [e["line_no"] for e in whole["entries"]]
    assert whole["matched"] == whole["total"] and page["filters"]["offset"] == offset
