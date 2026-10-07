"""ResultCache.forget drops one key (memory and disk) and nothing else (V032 cleanup, 0.3.1 audit)."""
from __future__ import annotations

from pathlib import Path

import pytest

from nq_terminal.services import result_cache as rc
from nq_terminal.services.files import FileCache

ROUTE = "/api/runs#views"


@pytest.fixture()
def lab(tmp_path: Path):
    results, state = tmp_path / "results", tmp_path / "state"
    results.mkdir()
    state.mkdir()
    path = results / "trials.json"
    path.write_text('{"v": 1}', encoding="utf-8")
    return FileCache(roots=[results]), path, state


def _compute(files: FileCache, path: Path, calls: list):
    def compute() -> bytes:
        calls.append(1)
        return f'{{"v": {files.read_json(path)["v"]}}}'.encode("utf-8")

    return compute


def _disk(state: Path) -> list[Path]:
    folder = state / rc.CACHE_FOLDER
    return sorted(folder.iterdir()) if folder.is_dir() else []


def test_forget_removes_the_memory_entry_and_the_disk_file_and_the_next_get_computes_again(lab):
    files, path, state = lab
    cache, calls = rc.ResultCache(state_dir=state, persist_routes=(ROUTE,)), []
    body = cache.get(ROUTE, {"q": 1}, _compute(files, path, calls))
    name = cache.disk_name(ROUTE, {"q": 1})
    assert [p.name for p in _disk(state)] == [name] and cache.stats().entries == 1
    cache.forget(ROUTE, {"q": 1})
    assert _disk(state) == [] and cache.stats().entries == 0 and cache.stats().bytes == 0
    assert cache.get(ROUTE, {"q": 1}, _compute(files, path, calls)) == body
    assert len(calls) == 2


def test_forget_leaves_every_other_key_alone(lab):
    files, path, state = lab
    cache, calls = rc.ResultCache(state_dir=state, persist_routes=(ROUTE,)), []
    cache.get(ROUTE, {"q": 1}, _compute(files, path, calls))
    cache.get(ROUTE, {"q": 2}, _compute(files, path, calls))
    cache.forget(ROUTE, {"q": 1})
    assert [p.name for p in _disk(state)] == [cache.disk_name(ROUTE, {"q": 2})] and cache.stats().entries == 1
    cache.get(ROUTE, {"q": 2}, _compute(files, path, calls))
    assert len(calls) == 2  # the second key is still a hit


def test_forgetting_an_unknown_key_is_harmless(lab):
    _, _, state = lab
    cache = rc.ResultCache(state_dir=state, persist_routes=(ROUTE,))
    cache.forget(ROUTE, {"never": "stored"})
    cache.forget("/api/ledger", {})
    assert cache.stats().entries == 0 and _disk(state) == []


def test_forget_without_a_state_folder_drops_the_memory_entry(lab):
    files, path, _ = lab
    cache, calls = rc.ResultCache(state_dir=None), []
    cache.get(ROUTE, {}, _compute(files, path, calls))
    cache.forget(ROUTE, {})
    assert cache.stats().entries == 0
    cache.get(ROUTE, {}, _compute(files, path, calls))
    assert len(calls) == 2


def test_forget_never_touches_a_flight_in_progress(lab):
    import threading

    files, path, state = lab
    cache = rc.ResultCache(state_dir=state, persist_routes=(ROUTE,))
    started, release, out = threading.Event(), threading.Event(), []

    def slow() -> bytes:
        started.set()
        release.wait(timeout=20)
        return b'{"v": 1}'

    leader = threading.Thread(target=lambda: out.append(cache.get(ROUTE, {"q": 1}, slow)))
    leader.start()
    assert started.wait(timeout=20)
    cache.forget(ROUTE, {"q": 1})  # the key is in flight: nothing to drop, and the flight must still finish
    release.set()
    leader.join(timeout=20)
    assert out == [b'{"v": 1}']
