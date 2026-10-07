"""/api/hypotheses through the result cache, price free and persisted (V032G fix 3).

Before: every launch parsed all the screens (59 files, 7.2 MB, about 0.2 s) and listed the run folders for the card
list, 0.42 to 0.61 s cold. After: the body is cached (`cached_hypotheses`), kept on disk, and ended by any change of
what it was built from.

Proved here, on the fixture lab (its own copy and state folder per test) and on the real lab (read only):
- the served body equals, byte for byte, the body the route made before the change (a reference route that keeps the
  old handler: `response_model=list[HypothesisCard]` over `ResearchService.cards()`), on a miss and on a hit;
- a second request runs nothing (a hit);
- a new summary, a spec edit, a screen edit, a new run folder and a new result.json each end the entry, and the body
  after the change equals a fresh computation;
- the entry reaches disk and a second process answers from it, and is dropped when an input changed meanwhile;
- a refused request (the registry missing) is never stored and still answers 503;
- the route is on the persist list (`result_cache.PERSIST_ROUTES`).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.api import data, research
from nq_terminal.models.research import HypothesisCard
from nq_terminal.services import result_cache as rc
from nq_terminal.services.research import ResearchService, service_for_root

from fakes import FIXTURES
from fixture_app import create_fixture_app

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
URL = "/api/hypotheses"
ONE_DAY = 86_400 * 10**9


class Lab:
    """A fixture-mode app over its own copy of the fixture folder and its own state folder."""

    def __init__(self, tmp_path: Path, name: str = "lab", *, state: Path | None = None):
        self.root = tmp_path / name / "fixtures"
        if not self.root.exists():
            shutil.copytree(FIXTURES, self.root)
        self.state = state if state is not None else tmp_path / name / "state"
        self.state.mkdir(parents=True, exist_ok=True)
        self.log = tmp_path / name / "log"
        env = {"NQT_FIXTURE_DIR": str(self.root), "NQT_STATE_DIR": str(self.state)}
        self.app: FastAPI = create_fixture_app(env, log_dir=self.log)
        self.persist = True

    @property
    def client(self) -> TestClient:
        return api_client(self.app, base_url=LOCAL, client=LOOPBACK)

    @property
    def cache(self) -> rc.ResultCache:
        if getattr(self.app.state, rc.STATE_KEY, None) is None and self.persist:
            # the route is on PERSIST_ROUTES already; the explicit union keeps this helper independent of it
            routes = rc.PERSIST_ROUTES | {research.ROUTE_HYPOTHESES}
            setattr(self.app.state, rc.STATE_KEY,
                    rc.ResultCache(state_dir=self.state, persist_routes=routes,
                                   scope=os.path.normcase(str(Path(self.app.state.settings.data_root).resolve()))))
        return data.get_result_cache(self.app.state)

    def get(self) -> bytes:
        self.cache  # make sure the cache with the persisted route is the app's
        response = self.client.get(URL)
        assert response.status_code == 200, response.text
        return response.content

    def touch(self, relative: str) -> None:
        path = self.root / relative
        before = path.stat().st_mtime_ns
        os.utime(path, ns=(before + ONE_DAY, before + ONE_DAY))


@pytest.fixture()
def lab(tmp_path: Path) -> Lab:
    return Lab(tmp_path)


def reference_body(root: Path) -> bytes:
    """What the route answered before V032G: the framework's own serialisation of `cards()`."""
    app = FastAPI()
    service = ResearchService(root, retry_delay_s=0)

    @app.get("/ref", response_model=list[HypothesisCard])
    def ref() -> list[HypothesisCard]:
        return service.cards()

    return TestClient(app).get("/ref").content


# ---------------------------------------------------------------- equal to the old body, served from the cache


def test_the_body_equals_the_old_route_on_a_miss_and_on_a_hit(lab):
    expected = reference_body(lab.root)
    first = lab.get()
    after_miss = lab.cache.stats()
    second = lab.get()
    after_hit = lab.cache.stats()
    assert first == expected, "a miss serves the old body, byte for byte"
    assert second == expected, "a hit serves the same bytes"
    assert (after_miss.misses, after_miss.entries) == (1, 1)
    assert after_hit.hits == after_miss.hits + 1 and after_hit.misses == 1, "the second request computed nothing"
    assert lab.client.get(URL).headers["content-type"] == "application/json"


def test_the_body_equals_the_old_route_on_the_real_lab(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    from nq_terminal.app import create_app
    from nq_terminal.settings import load_settings

    app = create_app(load_settings({"NQT_STATE_DIR": str(state), "NQT_PREWARM": "0", "NQT_JOBS": "off"}))
    client = api_client(app, base_url=LOCAL, client=LOOPBACK)
    body = client.get(URL).content
    assert body == reference_body(ROOT)
    assert client.get(URL).content == body


def test_the_route_keeps_its_declared_response_model():
    from nq_terminal.app import create_app
    from nq_terminal.settings import load_settings

    schema = create_app(load_settings({})).openapi()["paths"][URL]["get"]["responses"]["200"]
    assert schema["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/HypothesisCard")


# ---------------------------------------------------------------- each change ends the entry


def _misses(lab: Lab) -> int:
    return lab.cache.stats().misses


def add_scanned_row(lab: Lab, name: str) -> None:
    """A registry row that no ROUNDS entry answers for, so its round comes from the summary files."""
    registry = lab.root / "results" / "registry.csv"
    lines = registry.read_text(encoding="utf-8").splitlines()
    extra = lines[-1].replace("volmanaged_v0", name, 1)
    registry.write_bytes(("\n".join([*lines, extra]) + "\n").encode("utf-8"))


def test_a_new_summary_ends_the_entry(lab):
    name = "scanned_v0"
    add_scanned_row(lab, name)
    first = lab.get()
    assert b'"round":null' in first
    lab.get()
    before = _misses(lab)
    (lab.root / "results" / "screens" / "round99_summary.md").write_text(f"{name} is in this round\n", encoding="utf-8")
    body = lab.get()
    assert _misses(lab) == before + 1, "recomputed"
    assert body == reference_body(lab.root)
    assert b'"round":99' in body


def test_a_spec_edit_ends_the_entry(lab):
    lab.get()
    before = _misses(lab)
    spec = lab.root / "experiments" / "volmanaged_v0.json"
    spec.write_bytes(spec.read_bytes().replace(b" ", b"\t", 1))
    body = lab.get()
    assert _misses(lab) == before + 1
    assert body == reference_body(lab.root)
    assert b'"spec_rehash_ok":false' in body


def test_a_spec_touched_without_a_change_of_bytes_ends_the_entry(lab):
    lab.get()
    before = _misses(lab)
    lab.touch("experiments/volmanaged_v0.json")
    assert lab.get() == reference_body(lab.root)
    assert _misses(lab) == before + 1


def test_a_screen_edit_ends_the_entry(lab):
    lab.get()
    before = _misses(lab)
    lab.touch("results/screens/volmanaged_v0.json")
    assert lab.get() == reference_body(lab.root)
    assert _misses(lab) == before + 1


def test_a_new_run_folder_ends_the_entry(lab):
    lab.get()
    before = _misses(lab)
    source = lab.root / "backtests" / "output" / "nt_volmanaged_v0_fixture_m1"
    target = lab.root / "backtests" / "output" / "nt_volmanaged_v0_fixture_m2"
    shutil.copytree(source, target)
    body = lab.get()
    assert _misses(lab) == before + 1
    assert body == reference_body(lab.root)
    assert b"nt_volmanaged_v0_fixture_m2" in body


def test_a_result_json_written_into_an_existing_empty_folder_ends_the_entry(lab):
    empty = lab.root / "backtests" / "output" / "nt_overnight_v0_pending"
    empty.mkdir()
    first = lab.get()
    assert b"nt_overnight_v0_pending" not in first
    before = _misses(lab)
    shutil.copyfile(lab.root / "backtests" / "output" / "nt_overnight_v0_fixture_open" / "result.json",
                    empty / "result.json")
    body = lab.get()
    assert _misses(lab) == before + 1
    assert b"nt_overnight_v0_pending" in body
    assert body == reference_body(lab.root)


def test_a_removed_run_folder_ends_the_entry(lab):
    first = lab.get()
    assert b"nt_overnight_v0_fixture_open" in first
    before = _misses(lab)
    shutil.rmtree(lab.root / "backtests" / "output" / "nt_overnight_v0_fixture_open")
    body = lab.get()
    assert _misses(lab) == before + 1
    assert b"nt_overnight_v0_fixture_open" not in body
    assert body == reference_body(lab.root)


def test_a_registry_row_edit_ends_the_entry(lab):
    lab.get()
    before = _misses(lab)
    registry = lab.root / "results" / "registry.csv"
    registry.write_bytes(registry.read_bytes() + b"")
    lab.touch("results/registry.csv")
    assert lab.get() == reference_body(lab.root)
    assert _misses(lab) == before + 1


def test_an_unchanged_lab_stays_cached_across_many_requests(lab):
    lab.get()
    for _ in range(5):
        lab.get()
    stats = lab.cache.stats()
    assert (stats.misses, stats.hits) == (1, 5)


# ---------------------------------------------------------------- disk


def test_the_entry_reaches_disk_and_a_second_process_answers_from_it(tmp_path):
    first = Lab(tmp_path, "one")
    body = first.get()
    assert first.cache.stats().disk_writes == 1
    # the same data root and the same state: a restart
    again = Lab(tmp_path, "one", state=first.state)
    assert again.get() == body
    assert again.cache.stats().disk_hits == 1 and again.cache.stats().misses == 0


def test_a_disk_entry_is_dropped_when_an_input_changed_while_the_app_was_closed(tmp_path):
    first = Lab(tmp_path, "one")
    first.get()
    first.touch("results/screens/volmanaged_v0.json")
    (first.root / "results" / "screens" / "round98_summary.md").write_text("volmanaged_v0\n", encoding="utf-8")
    again = Lab(tmp_path, "one", state=first.state)
    body = again.get()
    assert again.cache.stats().disk_hits == 0 and again.cache.stats().misses == 1
    assert body == reference_body(again.root)


def test_a_refused_request_is_never_stored(tmp_path):
    lab = Lab(tmp_path)
    (lab.root / "results" / "registry.csv").unlink()
    cache = lab.cache
    response = lab.client.get(URL)
    assert response.status_code == 503 and "registry.csv" in response.json()["detail"]
    assert cache.stats().entries == 0 and cache.stats().disk_writes == 0
    assert lab.client.get(URL).status_code == 503


def test_the_route_is_on_the_persist_list():
    assert research.ROUTE_HYPOTHESES in rc.PERSIST_ROUTES
    assert research.ROUTE_HYPOTHESES not in rc.CACHED_ROUTES, "the nine named slow routes stay nine"


def test_the_service_listing_calls_share_the_services_of_the_root(lab):
    """The cached body is built by the shared per-root service, so /api/registry and /api/commands see one parser."""
    lab.get()
    service = service_for_root(Path(lab.app.state.settings.data_root))
    assert service.registry_rows()
