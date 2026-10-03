"""A row the lab adds after a release (an unknown hypothesis name, a new sealed-test opening) is a plain row.

The lab registers hypotheses and opens sealed tests while the terminal runs and between its releases. Until the terminal
learns a registration (a SeriesSource in constants.SERIES_SOURCES, a Shape in des_shapes.SHAPES), every view shows it as
a plain row: named, without a series or tear-sheet figures, and never as a refusal of the whole view. Each test plants
the new rows in a copy of the fixture tree, so nothing here reads or counts the live lab registry.
"""
from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.api import analytics as analytics_api
from nq_terminal.app import create_app
from nq_terminal.constants import SERIES_SOURCES
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from test_research_support import write_registry

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
UNLEARNED = "zz_unlearned_v0"
NEW_OPENING = "zz_unlearned_v0_confirm"
FIXTURE_TRIALS = ["overnight_v0", "volmanaged_v0"]


def tree_with_a_new_registration(tmp_path: Path) -> Path:
    """The fixture tree plus one registered row the terminal has never seen (a copy of the first row, renamed)."""
    root = tmp_path / "tree"
    shutil.copytree(FIXTURES, root)
    with (root / "results" / "registry.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    write_registry(root, [*rows, dict(rows[0], name=UNLEARNED, spec=UNLEARNED)])
    return root


def client_for(root: Path, tmp_path: Path) -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)}))
    app.state.serve_fn = make_fake_serve(tmp_path / "serve_log.jsonl")
    app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture
def root(tmp_path: Path) -> Path:
    assert UNLEARNED not in SERIES_SOURCES
    return tree_with_a_new_registration(tmp_path)


def test_born_failing_an_unlearned_registered_row_leaves_the_deflated_view_standing(root, tmp_path):
    r = client_for(root, tmp_path).get("/api/analytics/deflated")
    assert r.status_code == 200, r.text
    view = r.json()
    assert [row["name"] for row in view["rows"]] == FIXTURE_TRIALS and view["n_trials"] == len(FIXTURE_TRIALS)
    assert UNLEARNED in view["n_note"] and "not learned" in view["n_note"]


def test_born_failing_registry_trials_names_the_rows_it_has_not_learned(root):
    trials, unlearned = analytics_api.registry_trials(ResearchService(root))
    assert [t.name for t in trials] == FIXTURE_TRIALS
    assert unlearned == [UNLEARNED]


def test_a_view_with_every_row_learned_says_nothing_about_unlearned_rows(tmp_path):
    r = client_for(FIXTURES, tmp_path).get("/api/analytics/deflated")
    assert r.status_code == 200, r.text
    assert "not learned" not in r.json()["n_note"]


def test_the_unlearned_row_is_a_plain_row_on_every_research_route(root, tmp_path):
    c = client_for(root, tmp_path)
    for path in ("/api/registry", "/api/hypotheses", f"/api/hypotheses/{UNLEARNED}", "/api/multiple-testing",
                 "/api/commands", "/api/analytics/deflated"):
        r = c.get(path)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:300]}"
    card = next(x for x in c.get("/api/hypotheses").json() if x["name"] == UNLEARNED)
    assert card["registered"] is True and card["series_costs"] == [] and card["series_kind"] is None
    assert UNLEARNED in [row["name"] for row in c.get("/api/multiple-testing").json()["rows"]]
    assert UNLEARNED in c.get("/api/commands").json()["hypotheses"]
    # its series routes answer "not found", never a server error
    for path in (f"/api/hypotheses/{UNLEARNED}/series", f"/api/analytics/hypothesis/{UNLEARNED}/extended",
                 f"/api/analytics/hypothesis/{UNLEARNED}/bootstrap"):
        assert c.get(path).status_code == 404, path


def plant_a_new_opening_and_a_torn_line(root: Path) -> None:
    """A second sealed-test opening (not yet run, so no sealed result) and the lone '}' a torn append leaves."""
    path = root / "results" / "oos_openings.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    first = doc["openings"][0]
    doc["openings"].append({**first, "caller": NEW_OPENING, "spec": f"experiments/{NEW_OPENING}.json",
                            "spec_sha256": "0" * 64, "closed": False, "closed_utc": None})
    path.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    with (root / "results" / "oos_access_log.jsonl").open("a", encoding="utf-8") as handle:
        handle.write("}\n")


def test_a_new_opening_and_a_torn_log_line_leave_the_audit_routes_standing(root, tmp_path):
    plant_a_new_opening_and_a_torn_line(root)
    c = client_for(root, tmp_path)
    for path in ("/api/audit/openings", "/api/audit/oos-log", "/api/audit/spec-hashes", "/api/confirmations",
                 "/api/commands", "/api/health", "/api/registry"):
        r = c.get(path)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:300]}"
    assert [o["caller"] for o in c.get("/api/audit/openings").json()["openings"]] == ["rebal_v1_confirm", NEW_OPENING]
    assert c.get("/api/commands").json()["confirmations"] == ["rebal_v1_confirm", NEW_OPENING]
    rows = c.get("/api/audit/spec-hashes").json()["rows"]
    assert NEW_OPENING in [row["name"] for row in rows if row["kind"] == "confirmation"]
    errors = c.get("/api/audit/oos-log").json()["parse_errors"]
    assert len(errors) == 1 and "not JSON" in errors[0]["message"]
