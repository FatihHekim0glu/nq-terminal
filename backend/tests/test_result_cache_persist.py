"""Disk persistence of the result cache (02 sections 4.1 item 1 and 7.2, 03 section 5): allow-listed and fail closed.

An entry reaches `<state_dir>/cache/` only when its route is on `PERSIST_ROUTES` and the process-wide serve counter
did not move while it was computed, so nothing price-derived is ever stored on disk and each backend process still
logs its first gated read of each window. Each guard was born failing (see the module docstring of
`test_result_cache.py`); the worker-thread case fails a cache that checks only its own contextvar.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import pytest

from nq_lab.config import ROOT
from nq_terminal.services import result_cache as rc
from nq_terminal.services.bars import BarService
from nq_terminal.services.files import FileCache

from fakes import FakeCatalog, make_fake_serve

PERSISTED = "/api/analytics/deflated"
NOT_PERSISTED = "/api/market/two-day"
MIB = 1024**2
WINDOW = (pd.Timestamp("2019-05-06", tz="UTC"), pd.Timestamp("2019-05-08", tz="UTC"))
SERIES = ("NQ.V.0", "1m", "vendor")
BACKEND = Path(__file__).resolve().parents[1]
TESTS = BACKEND / "tests"
MAIN_STATE = ROOT / "terminal" / "state"  # the shared lab's folder: a worktree on the shared venv still resolves here
CHECKOUT_STATE = BACKEND.parent / "state"  # this checkout's own folder


@pytest.fixture
def lab(tmp_path: Path):
    """A results folder with one input file, a FileCache over it and a state folder."""
    results, state = tmp_path / "results", tmp_path / "state"
    results.mkdir()
    state.mkdir()
    path = results / "trials.json"
    path.write_text('{"v": 1}', encoding="utf-8")
    return FileCache(roots=[results]), path, state


def _files_only(files: FileCache, path: Path, calls: list | None = None):
    def compute() -> bytes:
        if calls is not None:
            calls.append(1)
        return f'{{"v": {files.read_json(path)["v"]}}}'.encode("utf-8")
    return compute


def _disk(state: Path) -> list[Path]:
    folder = state / rc.CACHE_FOLDER
    return sorted(folder.iterdir()) if folder.is_dir() else []


def _gate(tmp_path: Path):
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    return BarService(serve, cache_bytes=64 * MIB), serve, FakeCatalog()


# ---------------------------------------------------------------- the allow list and the restart


def test_the_allow_list_is_exactly_deflated_the_run_index_and_the_ledger():
    assert rc.PERSIST_ROUTES == frozenset({"/api/analytics/deflated", "/api/runs", "/api/ledger"})
    assert rc.DISK_BYTES == 64 * MIB and rc.CACHE_FOLDER == "cache"


def test_an_allow_listed_file_only_entry_is_served_from_disk_after_a_restart(lab):
    files, path, state = lab
    calls: list = []
    body = rc.ResultCache(state_dir=state).get(PERSISTED, {"q": 1}, _files_only(files, path, calls))
    assert len(_disk(state)) == 1 and not any(p.suffix == ".tmp" for p in _disk(state))
    fresh = rc.ResultCache(state_dir=state)  # a new process: empty memory, same state folder
    assert fresh.get(PERSISTED, {"q": 1}, _files_only(files, path, calls)) == body
    assert len(calls) == 1 and fresh.stats().disk_hits == 1


def test_a_route_not_on_the_allow_list_is_never_written_to_disk(lab):
    """Born failing: a cache that persists every file-only entry writes this one."""
    files, path, state = lab
    cache = rc.ResultCache(state_dir=state)
    cache.get(NOT_PERSISTED, {}, _files_only(files, path))
    cache.get("/api/runs/compare", {}, _files_only(files, path))
    assert _disk(state) == [] and cache.stats().entries == 2


def test_without_a_state_folder_nothing_is_written(lab):
    files, path, state = lab
    rc.ResultCache(state_dir=None).get(PERSISTED, {}, _files_only(files, path))
    assert _disk(state) == []


# ---------------------------------------------------------------- gated reads stay in memory


def test_an_entry_that_made_a_gated_read_is_never_written_to_disk(lab, tmp_path):
    """Born failing: a cache that ignores gated reads persists a price-derived body."""
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)

    def compute() -> bytes:
        frame = bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame
        return f'{{"v": {files.read_json(path)["v"]}, "rows": {len(frame)}}}'.encode("utf-8")

    cache = rc.ResultCache(state_dir=state, gate_version=catalog.version)
    cache.get(PERSISTED, {}, compute)
    assert _disk(state) == [] and cache.stats().entries == 1  # memory only
    served = len(serve.calls)
    cache.get(PERSISTED, {}, compute)
    assert len(serve.calls) == served


def test_a_bar_cache_hit_inside_the_computation_still_keeps_it_off_disk(lab, tmp_path):
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)
    bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES))  # warm the bar cache: the next read serves nothing

    def compute() -> bytes:
        frame = bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame
        return f'{{"v": {files.read_json(path)["v"]}, "rows": {len(frame)}}}'.encode("utf-8")

    served = len(serve.calls)
    rc.ResultCache(state_dir=state, gate_version=catalog.version).get(PERSISTED, {}, compute)
    assert len(serve.calls) == served and _disk(state) == []


def test_a_gated_read_in_a_worker_thread_is_never_written_to_disk(lab, tmp_path):
    """Born failing with a contextvar-only check: the worker thread does not see the computation's recorder."""
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)

    def compute() -> bytes:
        with ThreadPoolExecutor(max_workers=1) as pool:
            frame = pool.submit(bars.frame, *SERIES, *WINDOW, version=catalog.version(*SERIES)).result().frame
        return f'{{"v": {files.read_json(path)["v"]}, "rows": {len(frame)}}}'.encode("utf-8")

    cache = rc.ResultCache(state_dir=state, gate_version=catalog.version)
    cache.get(PERSISTED, {}, compute)
    assert _disk(state) == [] and cache.stats().entries == 1


def test_a_direct_serve_in_a_worker_thread_is_never_written_to_disk(lab, tmp_path):
    from nq_terminal.services.bars import counted_serve

    files, path, state = lab
    serve = counted_serve(make_fake_serve(tmp_path / "oos_access_log.jsonl"))

    def compute() -> bytes:
        with ThreadPoolExecutor(max_workers=1) as pool:
            frame = pool.submit(serve, *WINDOW, caller="terminal", reason="nqt-test worker read").result()
        return f'{{"v": {files.read_json(path)["v"]}, "rows": {len(frame)}}}'.encode("utf-8")

    rc.ResultCache(state_dir=state).get(PERSISTED, {}, compute)
    assert _disk(state) == []


def test_a_concurrent_gated_read_elsewhere_in_the_process_keeps_the_entry_in_memory(lab, tmp_path):
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)
    started, finished = threading.Event(), threading.Event()

    def other_request() -> None:
        started.wait(5)
        bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES))
        finished.set()

    def compute() -> bytes:
        started.set()
        assert finished.wait(5)
        return _files_only(files, path)()

    thread = threading.Thread(target=other_request)
    thread.start()
    cache = rc.ResultCache(state_dir=state)
    cache.get(PERSISTED, {}, compute)
    thread.join()
    assert _disk(state) == [] and cache.stats().entries == 1


def _overlapped_by_other_serve(files, path, bars, catalog):
    """A compute that waits until another thread has served bars, so the process-wide counter moves meanwhile."""
    started, finished = threading.Event(), threading.Event()

    def other_request() -> None:
        started.wait(5)
        bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES))
        finished.set()

    def compute() -> bytes:
        started.set()
        assert finished.wait(5)
        return _files_only(files, path)()

    return compute, threading.Thread(target=other_request)


def test_a_price_free_entry_persists_while_another_request_serves_bars(lab, tmp_path):
    """Born failing: the process-wide counter kept deflated and the ledger off disk on a real first launch, when
    HOME's price requests overlap them. A route that cannot read prices ignores the counter."""
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)
    compute, thread = _overlapped_by_other_serve(files, path, bars, catalog)
    thread.start()
    cache = rc.ResultCache(state_dir=state)
    body = cache.get(PERSISTED, {}, compute, price_free=True)
    thread.join()
    assert len(_disk(state)) == 1
    restarted = rc.ResultCache(state_dir=state)
    assert restarted.get(PERSISTED, {}, lambda: pytest.fail("a disk hit runs nothing"), price_free=True) == body
    assert restarted.stats().disk_hits == 1


def test_a_price_free_entry_that_reads_a_gated_frame_itself_stays_off_disk(lab, tmp_path):
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)

    def compute() -> bytes:
        bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES))
        return _files_only(files, path)()

    rc.ResultCache(state_dir=state, gate_version=catalog.version).get(PERSISTED, {}, compute, price_free=True)
    assert _disk(state) == []


def test_without_the_price_free_assertion_a_concurrent_serve_still_keeps_the_entry_off_disk(lab, tmp_path):
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)
    compute, thread = _overlapped_by_other_serve(files, path, bars, catalog)
    thread.start()
    rc.ResultCache(state_dir=state).get(PERSISTED, {}, compute)
    thread.join()
    assert _disk(state) == []


def test_the_deflated_and_ledger_callables_assert_price_free():
    import inspect
    from nq_terminal.api import analytics, runs

    for fn in (analytics.cached_deflated, runs.cached_ledger):
        assert "price_free=True" in inspect.getsource(fn)


# ---------------------------------------------------------------- re-validation before use


def test_a_disk_entry_whose_input_mtime_changed_is_discarded(lab):
    """Born failing: a disk read that trusts the stored body serves the old value after the input moved."""
    files, path, state = lab
    rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path))
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10**9))
    calls: list = []
    fresh = rc.ResultCache(state_dir=state)
    fresh.get(PERSISTED, {}, _files_only(files, path, calls))
    assert len(calls) == 1 and fresh.stats().disk_hits == 0
    assert len(_disk(state)) == 1  # the stale file was replaced by the fresh one


def test_a_disk_entry_whose_input_size_changed_under_the_same_mtime_is_discarded(lab):
    files, path, state = lab
    rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path))
    old = path.stat()
    path.write_text('{"v": 12345}', encoding="utf-8")
    os.utime(path, ns=(old.st_atime_ns, old.st_mtime_ns))
    assert rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path)) == b'{"v": 12345}'


def test_a_disk_entry_whose_input_disappeared_is_discarded(lab):
    files, path, state = lab
    rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path))
    path.unlink()

    def compute() -> bytes:
        try:
            files.read_json(path)
        except FileNotFoundError:
            return b"gone"
        return b"present"

    assert rc.ResultCache(state_dir=state).get(PERSISTED, {}, compute) == b"gone"


def test_a_corrupt_disk_entry_is_discarded_and_recomputed(lab):
    files, path, state = lab
    rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path))
    (stored,) = _disk(state)
    stored.write_bytes(stored.read_bytes()[:-3] + b"zzz")
    calls: list = []
    assert rc.ResultCache(state_dir=state).get(PERSISTED, {}, _files_only(files, path, calls)) == b'{"v": 1}'
    assert len(calls) == 1


def test_a_disk_entry_for_another_key_is_never_served(lab):
    """The file name is a hash of the key; the stored key is compared too, so a renamed file cannot answer."""
    files, path, state = lab
    rc.ResultCache(state_dir=state).get(PERSISTED, {"q": 1}, _files_only(files, path))
    (stored,) = _disk(state)
    other = rc.ResultCache(state_dir=state)
    target = stored.with_name(other.disk_name(PERSISTED, {"q": 2}))
    target.write_bytes(stored.read_bytes())
    calls: list = []
    other.get(PERSISTED, {"q": 2}, _files_only(files, path, calls))
    assert len(calls) == 1


def test_a_disk_entry_written_under_another_code_stamp_is_discarded(lab):
    """Born failing: entries keyed on route, query and inputs alone serve the old code's body after an update."""
    files, path, state = lab

    def reading(body: bytes):
        def compute() -> bytes:
            files.read_json(path)
            return body
        return compute

    rc.ResultCache(state_dir=state, stamp="code-a").get(PERSISTED, {}, reading(b"old code body"))
    (stored,) = _disk(state)
    other = rc.ResultCache(state_dir=state, stamp="code-b")
    assert other.get(PERSISTED, {}, reading(b"new code body")) == b"new code body"
    assert other.stats().disk_hits == 0
    assert _disk(state) == [stored]  # one slot per key: the stale file was replaced by the fresh one
    again = rc.ResultCache(state_dir=state, stamp="code-b")
    assert again.get(PERSISTED, {}, reading(b"never run")) == b"new code body" and again.stats().disk_hits == 1


def test_a_disk_entry_from_before_stamps_existed_is_discarded(lab):
    files, path, state = lab
    rc.ResultCache(state_dir=state, stamp="code-a").get(PERSISTED, {}, _files_only(files, path))
    (stored,) = _disk(state)
    head, _, body = stored.read_bytes().partition(b"\n")
    legacy = json.loads(head)
    del legacy["stamp"]
    legacy["format"] = 1
    stored.write_bytes(json.dumps(legacy).encode("utf-8") + b"\n" + body)
    calls: list = []
    rc.ResultCache(state_dir=state, stamp="code-a").get(PERSISTED, {}, _files_only(files, path, calls))
    assert len(calls) == 1


def test_the_default_stamp_follows_the_package_sources(tmp_path: Path):
    """Born failing: a stamp that is only the version string does not move when a source file is fixed."""
    one, two = tmp_path / "one", tmp_path / "two"
    for folder in (one, two):
        (folder / "analytics").mkdir(parents=True)
        (folder / "analytics" / "perf.py").write_text("x = 1\n", encoding="utf-8")
    assert rc.compute_code_stamp(one, "0.1.0") == rc.compute_code_stamp(two, "0.1.0")
    (two / "analytics" / "perf.py").write_text("x = 2\n", encoding="utf-8")
    assert rc.compute_code_stamp(one, "0.1.0") != rc.compute_code_stamp(two, "0.1.0")
    assert rc.compute_code_stamp(one, "0.1.0") != rc.compute_code_stamp(one, "0.2.0")
    assert rc.code_stamp() == rc.code_stamp() and len(rc.code_stamp()) == 64


# ---------------------------------------------------------------- the disk bound and the folder


def test_disk_lru_holds_at_64_mib(lab):
    """Born failing without a disk bound: five 16 MiB bodies would take 80 MiB."""
    files, path, state = lab
    cache = rc.ResultCache(state_dir=state)

    def body(n: int):
        def compute() -> bytes:
            files.read_json(path)
            return bytes([65 + n]) * (16 * MIB - 4096)  # the header fits in the remainder
        return compute

    for n in range(5):
        cache.get(PERSISTED, {"n": n}, body(n))
        assert sum(p.stat().st_size for p in _disk(state)) <= rc.DISK_BYTES
    assert len(_disk(state)) == 4
    calls: list = []
    fresh = rc.ResultCache(state_dir=state)
    fresh.get(PERSISTED, {"n": 0}, lambda: calls.append(1) or body(0)())  # evicted: recomputed
    fresh.get(PERSISTED, {"n": 4}, lambda: calls.append(1) or body(4)())  # kept: from disk
    assert len(calls) == 1


def test_a_body_larger_than_the_disk_cap_is_not_written(lab):
    files, path, state = lab
    cache = rc.ResultCache(state_dir=state, disk_bytes=1024)

    def compute() -> bytes:
        files.read_json(path)
        return b"x" * 4096

    cache.get(PERSISTED, {}, compute)
    assert _disk(state) == []


def test_cache_file_names_are_confined_to_the_cache_folder(lab):
    files, path, state = lab
    cache = rc.ResultCache(state_dir=state)
    for name in ("../escape.bin", "..\\escape.bin", "sub/x.bin", "C:/x.bin", "x.json", ""):
        with pytest.raises(rc.ResultCacheError):
            cache._cache_file(name)
    name = cache.disk_name(PERSISTED, {})
    assert cache._cache_file(name).parent == (state / rc.CACHE_FOLDER).resolve()


def test_the_cache_folder_may_not_be_a_research_folder():
    with pytest.raises(rc.ResultCacheError):
        rc.ResultCache(state_dir=ROOT / "results")._cache_folder()
    with pytest.raises(rc.ResultCacheError):
        rc.ResultCache(state_dir=ROOT / "data")._cache_folder()


def test_leftover_temporary_files_are_swept(lab):
    files, path, state = lab
    cache = rc.ResultCache(state_dir=state)
    cache.get(PERSISTED, {}, _files_only(files, path))
    (stored,) = _disk(state)
    stray = stored.with_name(stored.stem + "." + "0" * 32 + ".tmp")
    stray.write_bytes(b"half a write")
    rc.ResultCache(state_dir=state).get(PERSISTED, {"other": 1}, _files_only(files, path))
    assert not stray.exists()


# ---------------------------------------------------------------- the state folder under pytest


PLANTED = '''
from pathlib import Path

from nq_terminal.settings import load_settings

MAIN_STATE = Path({main!r})
CHECKOUT_STATE = Path({checkout!r})


def test_planted_write_through_the_settings():
    target = load_settings().state_dir / "nqt-planted.txt"
    target.write_text("planted", encoding="utf-8")
    assert not target.resolve().is_relative_to(MAIN_STATE.resolve())
    assert not target.resolve().is_relative_to(CHECKOUT_STATE.resolve())


def test_planted_write_into_the_main_state_folder():
    (MAIN_STATE / "nqt-planted.txt").write_text("planted", encoding="utf-8")


def test_planted_write_into_the_checkout_state_folder():
    (CHECKOUT_STATE / "nqt-planted.txt").write_text("planted", encoding="utf-8")
'''


def test_a_planted_test_cannot_write_the_real_state_folder(tmp_path: Path):
    """A pytest session with this conftest: a write through the settings lands in a temporary folder, and a write
    aimed at either terminal/state (the shared lab's and this checkout's, which differ in a git worktree) is refused
    by the session guard. Born failing: the guard covered only this checkout's folder, so in a worktree the planted
    write into the main lab's folder succeeded and left nqt-planted.txt there."""
    planted = tmp_path / "test_planted_state.py"
    planted.write_text(textwrap.dedent(PLANTED.format(main=str(MAIN_STATE), checkout=str(CHECKOUT_STATE))),
                       encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("NQT_STATE_DIR", "PYTEST_ADDOPTS")}
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS), str(BACKEND)])
    command = [sys.executable, "-m", "pytest", "-p", "conftest", "-p", "no:cacheprovider", "-p", "no:warnings",
               "-o", "addopts=", "-q", "--rootdir", str(tmp_path), "--basetemp", str(tmp_path / "bt"), str(planted)]
    done = subprocess.run(command, cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8",
                          timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    output = done.stdout + done.stderr
    try:
        assert done.returncode != 0, output
        assert "2 failed" in output and "1 passed" in output, output
        assert "test_planted_write_into_the_main_state_folder" in output, output
        assert "test_planted_write_into_the_checkout_state_folder" in output, output
        assert output.count("may not modify") >= 2, output
        assert not (MAIN_STATE / "nqt-planted.txt").exists()
        assert not (CHECKOUT_STATE / "nqt-planted.txt").exists()
    finally:  # a guard that failed must not leave the stray file behind to break the next state check
        for stray in (MAIN_STATE / "nqt-planted.txt", CHECKOUT_STATE / "nqt-planted.txt"):
            if stray.exists():  # only then: the session guard also refuses a remove it sees in a protected folder
                stray.unlink()


# ---------------------------------------------------------------- nested cached calls


def test_a_nested_gated_memory_hit_keeps_the_enclosing_entry_off_disk(lab, tmp_path):
    """Born failing: the inner hit made no serve and recorded nothing, so the outer price-derived body was persisted."""
    files, path, state = lab
    bars, serve, catalog = _gate(tmp_path)
    cache = rc.ResultCache(state_dir=state, gate_version=catalog.version)

    def inner() -> bytes:
        return str(len(bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame)).encode("utf-8")

    def outer() -> bytes:
        return _files_only(files, path)() + cache.get(NOT_PERSISTED, {}, inner)

    cache.get(NOT_PERSISTED, {}, inner)  # in memory only: it made a gated read
    before = rc.serve_count()
    cache.get(PERSISTED, {}, outer)
    assert rc.serve_count() == before and _disk(state) == []
    catalog.touch(*SERIES)  # the outer memory entry re-validates the inner's bar input too
    served = len(serve.calls)
    cache.get(PERSISTED, {}, outer)
    assert len(serve.calls) > served


def test_a_nested_hit_on_an_entry_that_overlapped_a_serve_keeps_the_enclosing_entry_off_disk(lab, tmp_path):
    """Born failing: the inner entry holds file inputs only (its serve ran in a worker thread), yet it is
    price-derived, and a hit on it moved no counter."""
    from nq_terminal.services.bars import counted_serve

    files, path, state = lab
    serve = counted_serve(make_fake_serve(tmp_path / "oos_access_log.jsonl"))
    cache = rc.ResultCache(state_dir=state)

    def inner() -> bytes:
        with ThreadPoolExecutor(max_workers=1) as pool:
            frame = pool.submit(serve, *WINDOW, caller="terminal", reason="nqt-test worker read").result()
        return _files_only(files, path)() + str(len(frame)).encode("utf-8")

    cache.get(NOT_PERSISTED, {}, inner)
    cache.get(PERSISTED, {}, lambda: _files_only(files, path)() + cache.get(NOT_PERSISTED, {}, inner))
    assert cache.stats().entries == 2 and _disk(state) == []


def test_a_nested_file_only_disk_hit_still_persists_and_carries_its_inputs(lab, tmp_path):
    """The fix fails closed without over-blocking: a file-only inner lets the outer persist, keyed on both files."""
    files, path, state = lab
    other = path.parent / "other.json"
    other.write_text('{"v": 5}', encoding="utf-8")
    inner_route = "/api/runs"

    def outer() -> bytes:
        return _files_only(files, other)() + cache.get(inner_route, {}, _files_only(files, path))

    rc.ResultCache(state_dir=state).get(inner_route, {}, _files_only(files, path))  # inner on disk
    cache = rc.ResultCache(state_dir=state)  # a new process: the inner comes from disk
    assert cache.get(PERSISTED, {}, outer) == b'{"v": 5}{"v": 1}'
    assert cache.stats().disk_hits == 1 and len(_disk(state)) == 2
    path.write_text('{"v": 77}', encoding="utf-8")
    cache = rc.ResultCache(state_dir=state)
    assert cache.get(PERSISTED, {}, outer) == b'{"v": 5}{"v": 77}'
