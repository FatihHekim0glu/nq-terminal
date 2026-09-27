"""Fixture mode end to end (item f, finding C8): the harness the Phase 4 and 7 E2E runs start.

`fixture_app.create_fixture_app` builds the normal app in fixture mode and injects the fake serve (a temporary
audit log, never the project's) and the fake catalog, so every P0 endpoint answers on fixture files and synthetic
bars. It refuses to build outside fixture mode, and the production package never imports it.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.settings import TERMINAL_DIR

from fakes import FIXTURES
from fixture_app import FixtureHarnessError, create_fixture_app

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
PACKAGE = TERMINAL_DIR / "backend" / "nq_terminal"


@pytest.fixture(scope="module")
def harness(tmp_path_factory) -> tuple[TestClient, Path]:
    log_dir = tmp_path_factory.mktemp("fixture-log")
    app = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES)}, log_dir=log_dir)
    return TestClient(app, base_url=LOCAL, client=LOOPBACK), log_dir


def test_research_endpoints_answer_on_the_fixture_registry(harness):
    c, _ = harness
    cards = c.get("/api/hypotheses").json()
    assert [x["name"] for x in cards] == ["overnight_v0", "volmanaged_v0"]
    assert all(x["spec_rehash_ok"] for x in cards)
    assert c.get("/api/multiple-testing").json()["matches_registry"] is True
    assert c.get("/api/audit/spec-hashes").json()["all_ok"] is True
    assert c.get("/api/hypotheses/volmanaged_v0").json()["des"]["cost_ladder"]
    assert c.get("/api/commands").json()["hypotheses"] == ["overnight_v0", "volmanaged_v0"]


def test_the_fixture_ledger_row_matches_its_run(harness):
    c, _ = harness
    body = c.get("/api/ledger").json()
    assert body["ledger_found"] is True and [r["matches_result"] for r in body["rows"]] == [True]


def test_bars_are_served_through_the_fake_gate_with_a_temporary_log(harness):
    c, log_dir = harness
    r = c.get("/api/bars", params={"symbol": "NQ.V.0", "timeframe": "5m", "start": "2011-01-03",
                                   "end": "2011-01-08"})
    assert r.status_code == 200 and r.json()["sessions"]["assessed"] is True
    lines = [json.loads(x) for p in log_dir.rglob("*.jsonl") for x in p.read_text(encoding="utf-8").splitlines()]
    assert lines and all(x["caller"] == "terminal" for x in lines)
    assert c.get("/api/bars", params={"symbol": "NQ.V.0", "start": "2022-01-03", "end": "2022-01-04"}).status_code == 403


def test_the_catalog_is_the_synthetic_one(harness):
    c, _ = harness
    series = c.get("/api/data/catalog").json()["series"]
    assert ("NQ.V.0", "1m", "repaired") in {(s["symbol"], s["timeframe"], s["variant"]) for s in series}
    assert all(s["rows"] is None for s in series)


def test_the_harness_refuses_to_start_outside_fixture_mode(tmp_path):
    with pytest.raises(FixtureHarnessError):
        create_fixture_app({}, log_dir=tmp_path)


def test_the_harness_refuses_a_log_inside_the_project_results(tmp_path):
    from nq_lab.config import RESULTS

    with pytest.raises(ValueError):
        create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES)}, log_dir=RESULTS)


def imported_modules(source: str) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module.split(".")[0])
    return names


def test_the_import_check_is_born_failing():
    assert {"fakes", "fixture_app"} <= imported_modules("import fakes\nfrom fixture_app import app\n")


def test_the_production_package_never_imports_the_harness_or_the_fakes():
    for path in PACKAGE.rglob("*.py"):
        found = imported_modules(path.read_text(encoding="utf-8")) & {"fakes", "fixture_app", "research_guard"}
        assert not found, (path, found)
