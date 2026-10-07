"""The cold HOME run list on a grown lab (V031B home-speed; 02 section 4.1 item 3, decided: the cold-HOME cap holds
on the first launch, with an empty state folder).

0.3.0 measured the HOME prewarm's run list at 2.72 s on the first launch: building /api/runs decoded every result.json
in full and sanitised its head, strategy-log metadata included (several MB of exits, trades and marks on the real lab),
although a row of the list reads a few fields. What is proved here, on a fixture copy grown by 1,500 run folders laid
out as the research writer lays them out (`many_runs_lab.py`), with no wall-clock bound:

- Born failing: a cold run list hands at most a quarter of the result files' bytes to a JSON decoder (the generated
  heads are a far larger share of their files than the real lab's, under 1 per cent) and decodes at most
  `MAX_WHOLE_DECODES` files whole (the unusual layouts, each read at most twice by the file cache's retry), where the
  old code decoded every file whole.
- The body is the one the old code served: a golden digest captured from the code before this change, and the rows
  rebuilt from each run's full head.
- Born failing: a later start whose run list must be rebuilt (a run added, changed or removed, or an unreadable run
  that keeps the list off disk) reads again only the result files of the affected groups of the per-run index the
  state folder's cache keeps, and serves the change.
- A corrupt or foreign index file is ignored and rebuilt, and the body is unchanged; another lab's index never answers.
- results/ and experiments/ of the lab are byte-identical after the tests (checked when the lab fixture is torn down, so
  it holds on every xdist worker; `test_cold_runs_guard.py`).
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import orjson
import pytest
from fastapi.encoders import jsonable_encoder

from nq_terminal.api import runs as runs_api
from nq_terminal.models.runs import RunSummary
from nq_terminal.services import files as files_service
from nq_terminal.services import result_cache as rc
from nq_terminal.services import runs as runs_service
from nq_terminal.services.runs import PROBE_MARKER, RunUnreadable, is_anchor

from many_runs_lab import EDGE_FALLBACKS, add_edges, add_runs, writer_bytes, result_doc
from test_result_cache_routes import Lab

GROWN = 1500
SMALL = 200
INDEX = "/api/runs"
MAX_WHOLE_DECODES = 2 * EDGE_FALLBACKS
MAX_DECODED_SHARE = 0.25
# /api/runs on the grown lab (the fixture copy plus add_runs(GROWN) and add_edges), from the code before this change.
GOLDEN_SHA256 = "3743ca3533740e339ead891fb471f64ac3e0b2aded1191d8b001673f8b33274b"
GOLDEN_LENGTH = 1068052
RESEARCH_PARTS = ("results", "experiments")


def _tree_digest(root: Path) -> dict[str, str]:
    out = {}
    for part in RESEARCH_PARTS:
        for path in sorted((root / part).rglob("*")):
            if path.is_file():
                out[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def _grow(base: Path, name: str, count: int, *, edges: bool = True) -> Path:
    lab = Lab(base, name)  # copies the fixture folder
    output = lab.root / "backtests" / "output"
    add_runs(output, count)
    if edges:
        add_edges(output)
    return base


@pytest.fixture(scope="module")
def grown(tmp_path_factory) -> Path:
    """The grown lab, shared by this module's tests. The byte-identical check runs in the teardown, so it holds on every
    worker that built the lab (under xdist each worker has its own copy and runs only some of the tests)."""
    base = _grow(tmp_path_factory.mktemp("grown"), "lab", GROWN)
    before = _tree_digest(base / "lab" / "fixtures")
    assert before and any(name.startswith("experiments/") for name in before)
    yield base
    assert _tree_digest(base / "lab" / "fixtures") == before, "results/ or experiments/ changed"


@pytest.fixture()
def small(tmp_path):
    """No unusual layouts here: an unreadable run keeps its group off disk, which the grown lab's test covers."""
    base = _grow(tmp_path, "lab", SMALL, edges=False)
    before = _tree_digest(base / "lab" / "fixtures")
    yield base
    assert _tree_digest(base / "lab" / "fixtures") == before, "results/ or experiments/ changed"


def _result_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in (root / "backtests" / "output").glob("*/result.json"))


class Reads:
    """Every result.json the file cache reads from disk (a cache hit reads nothing)."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch):
        self.paths: list[str] = []
        real = files_service.FileCache._read_bytes

        def read(cache: Any, target: Path) -> bytes:
            if target.name == "result.json":
                self.paths.append(target.parent.name)
            return real(cache, target)

        monkeypatch.setattr(files_service.FileCache, "_read_bytes", read)

    def runs(self) -> set[str]:
        return set(self.paths)


def _fresh(base: Path, name: str = "lab", state: Path | None = None) -> Lab:
    return Lab(base, name, state=state).build()


def _old_rows(lab: Lab) -> list[dict[str, Any]]:
    """The run list as the old code built it: every row from the run's full head."""
    service = runs_api.run_service_for(lab.app.state)
    refs = service._ledger_refs()
    rows = []
    for entry in service.index.rescan().values():
        try:
            head = service._read(entry, "head")
        except RunUnreadable as exc:
            rows.append(RunSummary(run_id=entry.run_id, readable=False, error=str(exc), sidecars=list(entry.sidecars),
                                   is_anchor=is_anchor(entry.run_id), is_probe=PROBE_MARKER in entry.run_id))
            continue
        rows.append(service._summary(entry, head, refs.get(entry.run_id)))
    return jsonable_encoder(rows, by_alias=True)


# ---------------------------------------------------------------- cold: what the first launch decodes


def test_born_failing_a_cold_run_list_decodes_a_quarter_of_the_bytes_and_few_files_whole(grown, monkeypatch):
    decoded = {"bytes": 0, "whole": 0}
    real_fast, real_std, real_kept = orjson.loads, json.loads, runs_service.kept_from

    def fast(raw: Any, *args: Any, **kwargs: Any) -> Any:
        decoded["bytes"] += len(raw)
        return real_fast(raw, *args, **kwargs)

    def std(raw: Any, *args: Any, **kwargs: Any) -> Any:
        decoded["bytes"] += len(raw)
        return real_std(raw, *args, **kwargs)

    def kept(raw: bytes, keep: Any) -> Any:
        decoded["whole"] += 1
        return real_kept(raw, keep)

    lab = _fresh(grown)
    monkeypatch.setattr(orjson, "loads", fast)
    monkeypatch.setattr(json, "loads", std)
    monkeypatch.setattr(runs_service, "kept_from", kept)
    response = lab.client.get(INDEX)
    assert response.status_code == 200 and len(json.loads(response.content)) > GROWN
    total = _result_bytes(lab.root)
    assert decoded["whole"] <= MAX_WHOLE_DECODES, f"{decoded['whole']} result files decoded whole"
    assert decoded["bytes"] <= MAX_DECODED_SHARE * total, f"{decoded['bytes']} of {total} bytes decoded"


def test_the_cold_run_list_is_the_golden_body_from_the_old_code(grown):
    body = _fresh(grown).client.get(INDEX).content
    assert (hashlib.sha256(body).hexdigest(), len(body)) == (GOLDEN_SHA256, GOLDEN_LENGTH)


def test_every_row_equals_the_row_built_from_the_full_head(grown):
    lab = _fresh(grown)
    served = json.loads(lab.client.get(INDEX).content)
    assert served == _old_rows(lab)
    kinds = {row["kind"] for row in served if row.get("readable", True)}
    unreadable = {row["run_id"] for row in served if row.get("readable") is False}
    assert kinds == {"book", "sized", "intraday"}
    assert unreadable == {"edge_not_object", "edge_trailing", "edge_truncated", "edge_empty", "edge_bom"}


def test_born_failing_a_restart_reads_again_only_the_groups_of_unreadable_runs(grown, monkeypatch, tmp_path):
    """An unreadable run keeps the whole list off disk (it cannot be pinned), so every start rebuilds the list; the
    groups of the per-run index that hold no unreadable run come from the state folder's cache."""
    state = tmp_path / "state"
    state.mkdir()
    first = _fresh(grown, state=state)
    body = first.client.get(INDEX).content
    unreadable = {row["run_id"] for row in json.loads(body) if row.get("readable") is False}
    reads = Reads(monkeypatch)
    again = _fresh(grown, state=state)
    assert again.client.get(INDEX).content == body
    groups = {_bucket(run_id) for run_id in unreadable}
    assert unreadable and reads.runs() == {r for r in _ids(body) if _bucket(r) in groups}


# ---------------------------------------------------------------- the per-run index: later starts are incremental


def _group(lab: Lab, run_id: str, ids: list[str]) -> set[str]:
    from nq_terminal.services import run_views

    mine = run_views.bucket_of(run_id)
    return {other for other in ids if run_views.bucket_of(other) == mine}


def _ids(body: bytes) -> list[str]:
    return [row["run_id"] for row in json.loads(body)]


def _restart_reads(small: Path, state: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[bytes, set[str], Lab]:
    reads = Reads(monkeypatch)
    lab = _fresh(small, state=state)
    body = lab.client.get(INDEX).content
    return body, reads.runs(), lab


def _first(small: Path, tmp_path: Path) -> tuple[Path, bytes, Lab]:
    state = tmp_path / "state"
    state.mkdir(exist_ok=True)
    lab = _fresh(small, state=state)
    return state, lab.client.get(INDEX).content, lab


def test_born_failing_a_changed_run_reads_again_only_its_group(small, tmp_path, monkeypatch):
    state, body, lab = _first(small, tmp_path)
    ids = _ids(body)
    changed = "nt_grow_v1_r00001"
    path = lab.root / "backtests" / "output" / changed / "result.json"
    doc = json.loads(path.read_bytes())
    doc["pnl_total"] = 123456.5
    path.write_bytes(writer_bytes(doc, crlf=True))
    after, read, again = _restart_reads(small, state, monkeypatch)
    assert 0 < len(read) <= len(ids) // 4, f"{len(read)} of {len(ids)} result files read again"
    assert read == _group(again, changed, ids), "only the changed run's group is read again"
    row = next(r for r in json.loads(after) if r["run_id"] == changed)
    assert row["pnl_total"] == 123456.5
    assert json.loads(after) == _old_rows(again)


def test_born_failing_an_added_run_reads_again_only_its_group(small, tmp_path, monkeypatch):
    import random

    state, body, lab = _first(small, tmp_path)
    added = "nt_grow_added_r1"
    folder = lab.root / "backtests" / "output" / added
    folder.mkdir()
    doc = result_doc(added, random.Random(5), probe_data=False, kind="sized", ok=True)
    (folder / "result.json").write_bytes(writer_bytes(doc, crlf=False))
    after, read, again = _restart_reads(small, state, monkeypatch)
    ids = _ids(after)
    assert added in ids and len(ids) == len(_ids(body)) + 1
    assert 0 < len(read) <= len(ids) // 4, f"{len(read)} of {len(ids)} result files read again"
    assert read == _group(again, added, ids)
    assert json.loads(after) == _old_rows(again)


def test_born_failing_a_removed_run_reads_again_only_its_group(small, tmp_path, monkeypatch):
    state, body, lab = _first(small, tmp_path)
    removed = "nt_grow_v2_r00002"
    shutil.rmtree(lab.root / "backtests" / "output" / removed)
    after, read, again = _restart_reads(small, state, monkeypatch)
    ids = _ids(after)
    assert removed not in ids and len(ids) == len(_ids(body)) - 1
    assert 0 < len(read) <= len(ids) // 4, f"{len(read)} of {len(ids)} result files read again"
    assert read == _group(again, removed, _ids(body)) - {removed}
    assert json.loads(after) == _old_rows(again)


def test_born_failing_an_error_before_the_file_read_is_never_pinned_into_the_index(small, tmp_path, monkeypatch):
    """A PermissionError from the stat (a file pending deletion on Windows) or a refusal from the confinement happens
    before the file cache records anything: the group that holds the run must still stay off disk, or the error row
    outlives the folder it came from."""
    import os

    state = tmp_path / "state"
    state.mkdir()
    victim = "nt_grow_v1_r00001"
    real = files_service.FileCache._confine

    def refuse(cache: Any, path: Path) -> Path:
        if path.name == "result.json" and path.parent.name == victim:
            raise PermissionError(5, "Access is denied")
        return real(cache, path)

    with monkeypatch.context() as patch:
        patch.setattr(files_service.FileCache, "_confine", refuse)
        first = _fresh(small, state=state)
        row = next(r for r in json.loads(first.client.get(INDEX).content) if r["run_id"] == victim)
        assert row["readable"] is False
    folder = first.root / "backtests" / "output" / victim
    stamp = folder.stat().st_mtime_ns + 5_000_000_000
    os.utime(folder, ns=(stamp, stamp))
    for _ in range(2):  # the second and third starts, as on the real lab
        again = _fresh(small, state=state)
        body = again.client.get(INDEX).content
        row = next(r for r in json.loads(body) if r["run_id"] == victim)
        assert row["readable"] is True, row.get("error")
        assert json.loads(body) == _old_rows(again)


def _index_files(lab: Lab, ids: list[str]) -> dict[int, Path]:
    from nq_terminal.services import run_views

    service = runs_api.run_service_for(lab.app.state)
    index = service.views
    folder = lab.state / rc.CACHE_FOLDER
    return {bucket: folder / index.disk_name(query) for bucket, query in run_views.bucket_queries(ids).items()}


def _drop_run_list_entry(lab: Lab) -> None:
    (lab.state / rc.CACHE_FOLDER / lab.cache.disk_name(rc.ROUTE_RUNS, {})).unlink()


def test_a_corrupt_index_file_is_ignored_and_rebuilt(small, tmp_path, monkeypatch):
    state, body, lab = _first(small, tmp_path)
    files = _index_files(lab, _ids(body))
    assert files and all(p.is_file() for p in files.values())
    victim = next(iter(files))
    files[victim].write_bytes(b"not an index file\n{]")
    _drop_run_list_entry(lab)
    after, read, again = _restart_reads(small, state, monkeypatch)
    assert after == body
    assert read == {r for r in _ids(body) if _bucket(r) == victim}
    assert files[victim].read_bytes().startswith(b"{") and b"not an index" not in files[victim].read_bytes()


def _bucket(run_id: str) -> int:
    from nq_terminal.services import run_views

    return run_views.bucket_of(run_id)


def test_a_foreign_index_file_is_ignored_and_rebuilt(small, tmp_path, monkeypatch):
    state, body, lab = _first(small, tmp_path)
    files = _index_files(lab, _ids(body))
    one, two = sorted(files)[:2]
    a, b = files[one].read_bytes(), files[two].read_bytes()
    files[one].write_bytes(b)  # another group's entry under this group's name
    files[two].write_bytes(a)
    _drop_run_list_entry(lab)
    after, read, _ = _restart_reads(small, state, monkeypatch)
    assert after == body
    assert read == {r for r in _ids(body) if _bucket(r) in (one, two)}


def test_an_index_file_from_another_lab_is_never_served(small, tmp_path, monkeypatch):
    """Two data roots that share a state folder never answer each other (the cache's scope)."""
    state, body, lab = _first(small, tmp_path)
    other = _grow(tmp_path / "other", "lab", SMALL, edges=False)
    output = other / "lab" / "fixtures" / "backtests" / "output"
    path = output / "nt_grow_v1_r00001" / "result.json"
    doc = json.loads(path.read_bytes())
    doc["n_trades"] = 777
    path.write_bytes(writer_bytes(doc, crlf=False))
    second = _fresh(other, state=state)
    row = next(r for r in json.loads(second.client.get(INDEX).content) if r["run_id"] == "nt_grow_v1_r00001")
    assert row["n_trades"] == 777
