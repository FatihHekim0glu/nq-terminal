"""HOME [B] builds the terminal's own relative fit only when the screen's stored fit does not cover both alpha tiles
(V032 first-launch).

`tearsheet.home_panel` used to call `relative_view` for every panel, and the relative fit is what reaches
`nq_lab.sizing_stats` and with it `scipy.stats` (`analytics/relative.py`). `_alpha_tiles` reads the fit only when the
stored fit lacks `alpha_annual_pct` or `t_min`, so for a hypothesis whose screen records both (volmanaged_v0 at every
recorded cost, HOME's own EQ panel) the fit was computed and thrown away. What is proved here:

- Born failing: a spy on `tearsheet.relative_view` sees no call for the volmanaged_v0 panel at costs 0, 1 and 2, and
  exactly one call for a run panel and one for a hypothesis with no stored fit (overnight_v0).
- Pinning (not born failing): every fixture panel answers what 0.3.1 answered. `qa/golden/home_panels_v031.json` holds
  the status and the parsed body of `/panel` for every fixture hypothesis at costs 0, 1 and 2 and for every fixture
  run at both frequencies, captured from the clean 0.3.1 tree (899b7d2) BEFORE `tearsheet.py` was edited. The bodies
  are compared as parsed values with ==, not as bytes. `NQT_UPDATE_HOME_PANELS_GOLDEN=1` rewrites the file; use it only
  on a tree whose panel code is the code the file pins, never to make a failing comparison pass.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nq_terminal.models.analytics import StoredAlpha
from nq_terminal.services import tearsheet

from fakes import FIXTURES
from fixture_app import create_fixture_app

from conftest import api_client

GOLDEN = Path(__file__).resolve().parents[2] / "qa" / "golden" / "home_panels_v031.json"
UPDATE = "NQT_UPDATE_HOME_PANELS_GOLDEN"
CAPTURED_FROM = "899b7d2"  # main at desktop 0.3.1 (tag desktop-v0.3.1 plus post-tag docs), panel code unchanged
COSTS = (0, 1, 2)
FREQS = ("D", "M")
STORED_FIT = "volmanaged_v0"  # the screen records alpha_annual_pct and t_min at 0, 1 and 2 ticks; HOME's EQ panel
NO_STORED_FIT = "overnight_v0"  # no stored_alpha shape: the terminal's own fit fills the tiles
ONE_RUN = "nt_volmanaged_v0_fixture_m1"


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """The fixture app with the fake serve (`fakes.make_fake_serve`, temporary log) and its own state folder."""
    work = tmp_path_factory.mktemp("home_panels")
    state = work / "state"
    state.mkdir()
    app = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_STATE_DIR": str(state)}, log_dir=work / "log")
    return api_client(app)


def panel_urls(client: TestClient) -> list[str]:
    """Every fixture panel: each hypothesis at each cost, each run at each frequency (a refused one included)."""
    hypotheses = sorted(h["name"] for h in client.get("/api/hypotheses").json())
    runs = sorted(r["run_id"] for r in client.get("/api/runs").json())
    assert hypotheses and runs, "the fixture lab lists hypotheses and runs"
    return ([f"/api/analytics/hypothesis/{name}/panel?cost={cost}" for name in hypotheses for cost in COSTS]
            + [f"/api/analytics/run/{run}/panel?freq={freq}" for run in runs for freq in FREQS])


def served(client: TestClient) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for url in panel_urls(client):
        response = client.get(url)
        out[url] = {"status": response.status_code, "body": response.json()}
    return out


def render(panels: dict[str, dict[str, Any]]) -> str:
    """One panel per line (sorted keys, compact), so the file stays reviewable and a change shows as one line."""
    head = {"captured_from": CAPTURED_FROM, "note": "fixture lab, fake serve: not research data",
            "source": "backend/tests/test_home_panel_lazy_relative.py"}
    lines = [f"{json.dumps(k)}: {json.dumps(v, sort_keys=True)}" for k, v in head.items()]
    body = [f" {json.dumps(url)}: {json.dumps(panels[url], sort_keys=True, separators=(',', ':'), allow_nan=False)}"
            for url in sorted(panels)]
    return "{\n" + ",\n".join(lines) + ',\n"panels": {\n' + ",\n".join(body) + "\n}\n}\n"


def count_relative(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    seen: list[str] = []
    real = tearsheet.relative_view

    def spy(s, u):
        seen.append(s.basis)
        return real(s, u)

    monkeypatch.setattr(tearsheet, "relative_view", spy)
    return seen


# ---------------------------------------------------------------- the relative fit only where a tile reads it


@pytest.mark.parametrize("cost", COSTS)
def test_born_failing_the_stored_fit_panel_builds_no_relative_fit(client, monkeypatch, cost):
    seen = count_relative(monkeypatch)
    response = client.get(f"/api/analytics/hypothesis/{STORED_FIT}/panel", params={"cost": cost})
    assert response.status_code == 200
    tiles = {t["key"]: t for t in response.json()["alpha"]}
    assert tiles["alpha_annual"]["tag"] == tiles["alpha_t"]["tag"] == "[PRE-REG]", "both tiles read the stored fit"
    assert seen == [], f"the panel at cost {cost} computed a relative fit no tile reads"


def test_a_hypothesis_without_a_stored_fit_builds_the_relative_fit_once(client, monkeypatch):
    seen = count_relative(monkeypatch)
    assert client.get(f"/api/analytics/hypothesis/{NO_STORED_FIT}/panel", params={"cost": 1}).status_code == 200
    assert len(seen) == 1


def test_a_run_panel_builds_the_relative_fit_once(client, monkeypatch):
    seen = count_relative(monkeypatch)
    assert client.get(f"/api/analytics/run/{ONE_RUN}/panel").status_code == 200
    assert len(seen) == 1


def test_stored_covers_needs_both_values():
    covers = tearsheet._stored_covers
    full = StoredAlpha(path="p", against="a", a_unit="u", n=1, a=0.1, b=0.0, alpha_annual_pct=3.5, t={},
                       t_min=1.2, p=0.1, blocks=[], raw={})
    assert covers(full) is True
    assert covers(None) is False
    assert covers(full.model_copy(update={"alpha_annual_pct": None})) is False
    assert covers(full.model_copy(update={"t_min": None})) is False


# ---------------------------------------------------------------- pinning: every panel answers what 0.3.1 answered


def test_every_fixture_panel_equals_the_031_golden(client):
    now = served(client)
    if os.environ.get(UPDATE) == "1":
        GOLDEN.write_text(render(now), encoding="utf-8", newline="\n")
    assert GOLDEN.is_file(), f"{GOLDEN} is missing: capture it at {CAPTURED_FROM} with {UPDATE}=1"
    stored = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert stored["captured_from"] == CAPTURED_FROM
    golden = stored["panels"]
    assert sorted(now) == sorted(golden), "the fixture panels are the ones the golden pins"
    changed_status = [url for url in golden if now[url]["status"] != golden[url]["status"]]
    assert changed_status == [], f"status changed for {changed_status}"
    changed_body = [url for url in golden if now[url]["body"] != golden[url]["body"]]
    assert changed_body == [], f"body changed for {changed_body}"


def test_the_golden_pins_the_stored_fit_panel_and_a_refusal():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))["panels"]
    for cost in COSTS:
        entry = golden[f"/api/analytics/hypothesis/{STORED_FIT}/panel?cost={cost}"]
        assert entry["status"] == 200 and entry["body"]["alpha"], "HOME's EQ panel is pinned at every cost"
    assert any(entry["status"] != 200 for entry in golden.values()), "a refused panel is pinned too"
