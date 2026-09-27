"""RK5's spent 2022 row when the sealed daily file is not there (TASKS 10.4; ANALYTICS_CATALOG RK5).

The spent row is one optional row of the stress table. The fixture tree has no `results/sealed/`, so
`GET /api/analytics/hypothesis/volmanaged_v0/extended` must still answer: the frozen windows and every other P1 view,
with no spent row and a note that names the missing sealed file. Born failing: before the fix the whole view was a
404 ("unknown sealed file"), so one absent optional file took Omega, Cornish-Fisher VaR and the rest down with it.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from nq_terminal import constants
from nq_terminal.app import create_app
from nq_terminal.services import tearsheet_extended
from nq_terminal.settings import load_settings

from fakes import FIXTURES

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


def _client() -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    return TestClient(app, base_url=LOCAL, client=LOOPBACK)


def test_fixture_tree_has_no_sealed_daily_file():
    assert not (FIXTURES / "results" / "sealed").exists()


def test_a_missing_sealed_file_drops_only_the_spent_row():
    r = _client().get(f"/api/analytics/hypothesis/{constants.STRESS_SPENT_PARENT}/extended", params={"cost": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body["stress"]["rows"]
    assert len(rows) == len(constants.STRESS_WINDOWS)
    assert not any(row["spent"] for row in rows)
    note = body["stress"]["spent_note"]
    assert note == tearsheet_extended.SPENT_MISSING.format(file=constants.STRESS_SPENT_FILE)
    assert constants.STRESS_SPENT_FILE in note
    assert [k["key"] for k in body["ratios"]] == ["omega", "tail_ratio", "gain_to_pain"]


def test_another_hypothesis_keeps_the_parent_note():
    body = _client().get("/api/analytics/hypothesis/overnight_v0/extended", params={"cost": 1}).json()
    assert body["stress"]["spent_note"] == tearsheet_extended.SPENT_NONE
