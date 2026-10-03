"""/api/runs through the result cache (02 section 4.1 item 3, decided: the first launch; 03 section 15.2; 04 D3.4).

HOME asks for the run index on every launch, and building it parses every run's result.json head (139 runs, 161 MB on
the real lab): after the ledger, the largest cost of a cold HOME. The index is price-free and already on the persist
allow list, so it now goes through the result cache like the ledger: one computation per process (single-flight with
the prewarm), from disk on a usual launch, invalidated by any change of a head, a sidecar, the ledger file or the run
folders. What is proved here: the body is the one the route served before (born failing: a second request parses
nothing); a restart on the same state folder serves it from disk without opening a result file; a run folder added
within the run index's rescan interval reaches both the index and the ledger at once (born failing: the entry used to
be rebuilt from the index's stale listing and then kept); a changed head or a removed folder recomputes.
"""
from __future__ import annotations

import json
import shutil

import pytest
from fastapi.encoders import jsonable_encoder

from nq_terminal.api import runs as runs_api
from nq_terminal.services import result_cache as rc

from test_result_cache_routes import Lab

INDEX = "/api/runs"
LEDGER = "/api/ledger"
COPY_FROM, COPY_TO = "nt_za_v0_fixture_a", "nt_za_v0_fixture_a_regress_r7"


def heads_parsed(lab: Lab) -> int:
    """How many result.json heads the app's run service has parsed (its file cache's misses of kind runs:head)."""
    service = runs_api.run_service_for(lab.app.state)
    return service.cache.stats().misses


def ids(body: bytes) -> list[str]:
    return [row["run_id"] for row in json.loads(body)]


@pytest.fixture()
def lab(tmp_path):
    return Lab(tmp_path).build()


def test_born_failing_a_second_index_request_is_a_hit_that_parses_nothing(lab):
    first = lab.client.get(INDEX)
    assert first.status_code == 200 and ids(first.content)
    parsed = heads_parsed(lab)
    second = lab.client.get(INDEX)
    assert second.content == first.content
    assert rc.ROUTE_RUNS in rc.CACHED_ROUTES and rc.ROUTE_RUNS in rc.PERSIST_ROUTES
    assert lab.cache.stats().hits == 1 and heads_parsed(lab) == parsed


def test_the_cached_index_is_the_body_the_route_served_before(lab):
    served = json.loads(lab.client.get(INDEX).content)
    service = runs_api.run_service_for(lab.app.state)
    assert served == jsonable_encoder(service.summaries(), by_alias=True)


def test_born_failing_a_restart_on_the_same_state_folder_serves_the_index_from_disk(tmp_path):
    first = Lab(tmp_path, "one").build()
    body = first.client.get(INDEX).content
    again = Lab(tmp_path, "one", state=first.state).build()
    assert again.client.get(INDEX).content == body
    assert again.cache.stats().disk_hits == 1 and heads_parsed(again) == 0, "no result.json opened on a disk hit"


def test_the_prewarm_callable_and_the_route_share_one_key(lab):
    body = runs_api.cached_runs(lab.app.state)
    assert lab.client.get(INDEX).content == body
    assert (lab.cache.stats().misses, lab.cache.stats().hits) == (1, 1)


@pytest.mark.parametrize("url", [INDEX, LEDGER])
def test_born_failing_a_run_folder_added_inside_the_rescan_interval_is_served_at_once(lab, url):
    """The index rescans at most every 5 s; a cached body must still never be rebuilt from a stale listing and kept."""
    assert lab.client.get(INDEX).status_code == 200  # the run index has scanned now
    assert lab.client.get(url).status_code == 200
    output = lab.root / "backtests" / "output"
    shutil.copytree(output / COPY_FROM, output / COPY_TO)
    again = lab.client.get(url)
    assert again.status_code == 200
    if url == INDEX:
        assert COPY_TO in ids(again.content)
    else:
        assert COPY_TO in [pair["anchor"] for pair in json.loads(again.content)["anchor_pairs"]]
    assert lab.client.get(url).content == again.content and lab.cache.stats().hits >= 1


@pytest.mark.parametrize("restart", [False, True], ids=["in_process", "after_restart"])
@pytest.mark.parametrize("url", [INDEX, LEDGER])
def test_born_failing_a_result_written_into_a_run_folder_that_already_existed_ends_the_entry(tmp_path, url, restart):
    """An empty run folder (a run whose result.json failed to serialise) is skipped by the scan and was never pinned:
    a rerun with the same run id then writes result.json into it, which changes no recorded input. The entry, in
    memory and on disk, must still end."""
    lab = Lab(tmp_path, "late").build()
    output = lab.root / "backtests" / "output"
    (output / COPY_TO).mkdir()
    before = lab.client.get(url)
    assert before.status_code == 200
    assert COPY_TO not in (ids(before.content) if url == INDEX else
                           [pair["anchor"] for pair in json.loads(before.content)["anchor_pairs"]])
    shutil.copyfile(output / COPY_FROM / "result.json", output / COPY_TO / "result.json")
    if restart:
        lab = Lab(tmp_path, "late", state=lab.state).build()
    after = lab.client.get(url)
    assert after.status_code == 200
    if url == INDEX:
        assert COPY_TO in ids(after.content)
    else:
        assert COPY_TO in [pair["anchor"] for pair in json.loads(after.content)["anchor_pairs"]]


def test_a_changed_head_and_a_removed_folder_recompute_the_index(lab):
    first = lab.client.get(INDEX).content
    result = lab.root / "backtests" / "output" / COPY_FROM / "result.json"
    doc = json.loads(result.read_text(encoding="utf-8"))
    doc["n_trades"] = int(doc["n_trades"]) + 1
    result.write_text(json.dumps(doc), encoding="utf-8")
    changed = json.loads(lab.client.get(INDEX).content)
    assert {r["run_id"]: r["n_trades"] for r in changed}[COPY_FROM] == doc["n_trades"]
    shutil.rmtree(result.parent)
    assert COPY_FROM not in ids(lab.client.get(INDEX).content) and ids(first)
