"""The result cache core (04 D1.2, 03 item 1.2a and section 5): key, read hook, serve counter and memory LRU.

Every guard here was shown failing on a weakened cache before the real one passed (the lab's rule that a check is
born failing): a key without the size, a hit that still calls serve, a contextvar-only gate check, no LRU bound.
Disk persistence has its own file, `test_result_cache_persist.py`.
"""
from __future__ import annotations

import contextvars
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import pytest

from nq_terminal.services import result_cache as rc
from nq_terminal.services.bars import BarService, counted_serve
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError

from fakes import FakeCatalog, make_fake_serve

ROUTE = "/api/test/route"
MIB = 1024**2
WINDOW = (pd.Timestamp("2019-05-06", tz="UTC"), pd.Timestamp("2019-05-08", tz="UTC"))
SERIES = ("NQ.V.0", "1m", "vendor")


def _log_lines(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines()) if path.exists() else 0


def _rewrite_keeping_mtime(path: Path, text: str) -> None:
    """Rewrite `path` and restore its exact mtime_ns, as a tool that restores timestamps would."""
    old = path.stat()
    path.write_text(text, encoding="utf-8")
    os.utime(path, ns=(old.st_atime_ns, old.st_mtime_ns))
    assert path.stat().st_mtime_ns == old.st_mtime_ns


class Counting:
    """A compute function that counts its calls and reads one JSON file through a FileCache."""

    def __init__(self, files: FileCache, path: Path):
        self.files, self.path, self.calls = files, path, 0

    def __call__(self) -> bytes:
        self.calls += 1
        value = self.files.read_json(self.path)
        return f'{{"value": {value["v"]}, "n": {self.calls}}}'.encode("utf-8")


@pytest.fixture
def source(tmp_path: Path) -> tuple[FileCache, Path]:
    folder = tmp_path / "results"
    folder.mkdir()
    path = folder / "input.json"
    path.write_text('{"v": 1}', encoding="utf-8")
    return FileCache(roots=[folder]), path


@pytest.fixture
def gate(tmp_path: Path):
    log = tmp_path / "oos_access_log.jsonl"
    serve = make_fake_serve(log)
    return BarService(serve, cache_bytes=64 * MIB), serve, FakeCatalog(), log


# ---------------------------------------------------------------- the key


def test_query_normalisation_ignores_key_order_and_keeps_values():
    assert rc.normalise_query({"b": 2, "a": [1, "x"]}) == rc.normalise_query({"a": [1, "x"], "b": 2})
    assert rc.normalise_query({"a": 1}) != rc.normalise_query({"a": 2})
    assert rc.normalise_query({"a": 1}) != rc.normalise_query({"a": "1"})
    assert rc.normalise_query({"a": [1, 2]}) != rc.normalise_query({"a": [2, 1]})
    assert rc.normalise_query(None) == rc.normalise_query({})


def test_query_normalisation_refuses_values_it_cannot_spell_exactly():
    with pytest.raises(TypeError):
        rc.normalise_query({"a": object()})


def test_a_repeat_call_is_a_memory_hit(source):
    files, path = source
    cache, compute = rc.ResultCache(state_dir=None), Counting(*source)
    first = cache.get(ROUTE, {"q": 1}, compute)
    assert cache.get(ROUTE, {"q": 1}, compute) == first and compute.calls == 1
    assert cache.get(ROUTE, {"q": 2}, compute) != first and compute.calls == 2
    assert cache.stats().hits == 1


def test_a_rewrite_with_the_same_mtime_and_a_new_size_misses(source):
    """Born failing: a key of path and mtime alone hits here and serves the stale body."""
    files, path = source
    cache, compute = rc.ResultCache(state_dir=None), Counting(*source)
    assert b'"value": 1' in cache.get(ROUTE, {}, compute)
    _rewrite_keeping_mtime(path, '{"v": 22}')
    assert b'"value": 22' in cache.get(ROUTE, {}, compute) and compute.calls == 2


def test_a_new_mtime_misses(source):
    files, path = source
    cache, compute = rc.ResultCache(state_dir=None), Counting(*source)
    cache.get(ROUTE, {}, compute)
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10**9))
    cache.get(ROUTE, {}, compute)
    assert compute.calls == 2


def test_a_file_cache_hit_inside_a_computation_is_recorded_too(source):
    """Born failing when only misses are recorded: the warm file is left out of the key."""
    files, path = source
    cold = path.with_name("cold.json")
    cold.write_text('{"v": 0}', encoding="utf-8")
    files.read_json(path)  # warm the file cache outside any computation

    def compute() -> bytes:
        return repr((files.read_json(path)["v"], files.read_json(cold)["v"])).encode("utf-8")

    cache = rc.ResultCache(state_dir=None)
    assert cache.get(ROUTE, {}, compute) == b"(1, 0)"
    _rewrite_keeping_mtime(path, '{"v": 333}')
    assert cache.get(ROUTE, {}, compute) == b"(333, 0)"


def test_a_swallowed_decode_error_is_never_cached(source):
    """Born failing when a failed file read is not recorded: the degraded body would outlive the repair."""
    files, path = source
    bad = path.parent / "bad.json"
    bad.write_text("{half", encoding="utf-8")
    calls = []

    def compute() -> bytes:
        calls.append(1)
        value = files.read_json(path)["v"]
        try:
            return f"{value}:{files.read_json(bad)['ok']}".encode("utf-8")
        except FileDecodeError:
            return b"degraded"

    cache = rc.ResultCache(state_dir=None)
    assert cache.get(ROUTE, {}, compute) == b"degraded"
    bad.write_text('{"ok": 7, "fixed": true}', encoding="utf-8")
    assert cache.get(ROUTE, {}, compute) == b"1:7"
    assert len(calls) == 2


def test_a_swallowed_oversize_refusal_is_never_cached(tmp_path: Path):
    """Born failing when the size refusal is not recorded: the body built without the big file would stick."""
    folder = tmp_path / "results"
    folder.mkdir()
    small, big = folder / "small.json", folder / "big.json"
    small.write_text('{"v": 1}', encoding="utf-8")
    big.write_text('{"pad": "' + "x" * 200 + '"}', encoding="utf-8")
    files = FileCache(roots=[folder], max_file_bytes=64)

    def compute() -> bytes:
        files.read_json(small)
        try:
            files.read_json(big)
            return b"full"
        except FileAccessError:
            return b"degraded"

    cache = rc.ResultCache(state_dir=None)
    assert cache.get(ROUTE, {}, compute) == b"degraded"
    big.write_text('{"pad": 1}', encoding="utf-8")
    assert cache.get(ROUTE, {}, compute) == b"full"


def test_a_missing_input_is_recorded_and_its_arrival_misses(tmp_path: Path):
    folder = tmp_path / "results"
    folder.mkdir()
    files, path, calls = FileCache(roots=[folder]), folder / "late.json", []

    def compute() -> bytes:
        calls.append(1)
        try:
            return repr(files.read_json(path)["v"]).encode("utf-8")
        except FileNotFoundError:
            return b"absent"

    cache = rc.ResultCache(state_dir=None)
    assert cache.get(ROUTE, {}, compute) == b"absent"
    assert cache.get(ROUTE, {}, compute) == b"absent" and len(calls) == 1
    path.write_text('{"v": 5}', encoding="utf-8")
    assert cache.get(ROUTE, {}, compute) == b"5" and len(calls) == 2


def test_record_input_covers_a_folder_listing(tmp_path: Path):
    """A computation that lists a folder (the run index) records the folder itself; adding a file misses."""
    folder = tmp_path / "runs"
    folder.mkdir()
    calls = []

    def compute() -> bytes:
        calls.append(1)
        rc.record_input(folder)
        return str(sorted(p.name for p in folder.iterdir())).encode("utf-8")

    cache = rc.ResultCache(state_dir=None)
    cache.get(ROUTE, {}, compute)
    cache.get(ROUTE, {}, compute)
    (folder / "new_run").mkdir()
    assert b"new_run" in cache.get(ROUTE, {}, compute) and len(calls) == 2


# ---------------------------------------------------------------- the gate: a hit never serves


def test_a_hit_makes_no_serve_call_and_writes_no_gate_line(gate):
    """Born failing without the cache: the second request serves again and the gate log gains a line."""
    bars, serve, catalog, log = gate
    calls = []

    def compute() -> bytes:
        calls.append(1)
        frame = bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame
        return str(len(frame)).encode("utf-8")

    cache = rc.ResultCache(state_dir=None, gate_version=catalog.version)
    body = cache.get(ROUTE, {}, compute)
    served, lines = len(serve.calls), _log_lines(log)
    assert served >= 1 and lines >= 1
    assert cache.get(ROUTE, {}, compute) == body
    assert (len(serve.calls), _log_lines(log), len(calls)) == (served, lines, 1)


def test_a_new_catalogue_version_of_a_bar_input_misses(gate):
    bars, serve, catalog, log = gate
    calls = []

    def compute() -> bytes:
        calls.append(1)
        return str(len(bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame)).encode("utf-8")

    cache = rc.ResultCache(state_dir=None, gate_version=catalog.version)
    cache.get(ROUTE, {}, compute)
    catalog.touch(*SERIES)  # the processed file was rewritten
    cache.get(ROUTE, {}, compute)
    assert len(calls) == 2


def test_a_bar_read_without_a_catalogue_version_is_never_cached(gate, source):
    """Born failing when an unversioned bar read is dropped from the key: the file input alone would pin it."""
    bars, serve, catalog, log = gate
    files, path = source
    calls = []

    def compute() -> bytes:
        calls.append(1)
        files.read_json(path)
        return str(len(bars.frame(*SERIES, *WINDOW, version=None).frame)).encode("utf-8")

    cache = rc.ResultCache(state_dir=None, gate_version=catalog.version)
    cache.get(ROUTE, {}, compute)
    cache.get(ROUTE, {}, compute)
    assert len(calls) == 2


def test_a_bar_input_is_not_reused_without_a_version_lookup(gate):
    bars, serve, catalog, log = gate
    calls = []

    def compute() -> bytes:
        calls.append(1)
        return str(len(bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES)).frame)).encode("utf-8")

    cache = rc.ResultCache(state_dir=None)  # no gate_version: a gated input cannot be re-validated
    cache.get(ROUTE, {}, compute)
    cache.get(ROUTE, {}, compute)
    assert len(calls) == 2


# ---------------------------------------------------------------- what is never cached


def test_clock_dependent_bodies_are_never_cached(source):
    cache, compute = rc.ResultCache(state_dir=None), Counting(*source)
    cache.get(ROUTE, {}, compute, clock_dependent=True)
    cache.get(ROUTE, {}, compute, clock_dependent=True)
    assert compute.calls == 2 and cache.stats().entries == 0


def test_a_computation_that_recorded_no_input_is_not_cached():
    calls = []

    def compute() -> bytes:
        calls.append(1)
        return b"{}"

    cache = rc.ResultCache(state_dir=None)
    cache.get(ROUTE, {}, compute)
    cache.get(ROUTE, {}, compute)
    assert len(calls) == 2


def test_a_body_must_be_bytes(source):
    with pytest.raises(TypeError):
        rc.ResultCache(state_dir=None).get(ROUTE, {}, lambda: {"not": "bytes"})


def test_a_failed_computation_caches_nothing(source):
    cache = rc.ResultCache(state_dir=None)
    files, path = source

    def boom() -> bytes:
        files.read_json(path)
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        cache.get(ROUTE, {}, boom)
    assert cache.stats().entries == 0


# ---------------------------------------------------------------- the memory bound


def test_memory_lru_holds_at_64_mib(tmp_path: Path):
    """Born failing without a byte bound: five 16 MiB bodies would all stay (80 MiB)."""
    assert rc.MEMORY_BYTES == 64 * MIB
    folder = tmp_path / "results"
    folder.mkdir()
    path = folder / "in.json"
    path.write_text("{}", encoding="utf-8")
    files = FileCache(roots=[folder])
    cache = rc.ResultCache(state_dir=None)

    def body(n: int):
        def compute() -> bytes:
            files.read_json(path)
            return bytes([n]) * (16 * MIB)
        return compute

    for n in range(5):
        cache.get(ROUTE, {"n": n}, body(n))
        assert cache.stats().bytes <= rc.MEMORY_BYTES
    stats = cache.stats()
    assert stats.entries == 4 and stats.bytes == 64 * MIB  # the fifth body pushed the first one out
    calls = []
    cache.get(ROUTE, {"n": 0}, lambda: calls.append(1) or body(0)())  # the oldest was evicted
    cache.get(ROUTE, {"n": 4}, lambda: calls.append(1) or body(4)())  # the newest is still there
    assert len(calls) == 1


def test_a_body_larger_than_the_memory_cap_is_served_but_not_kept(source):
    files, path = source
    cache = rc.ResultCache(state_dir=None, memory_bytes=1024)

    def compute() -> bytes:
        files.read_json(path)
        return b"x" * 2048

    assert len(cache.get(ROUTE, {}, compute)) == 2048
    assert cache.stats().entries == 0


# ---------------------------------------------------------------- the process-wide serve counter


def test_the_bar_service_counts_reads_from_any_thread(gate):
    """A gated read in a worker thread is invisible to a contextvar but moves the process-wide counter."""
    bars, serve, catalog, log = gate
    before = rc.serve_count()
    with ThreadPoolExecutor(max_workers=2) as pool:
        pool.submit(bars.frame, *SERIES, *WINDOW, version=catalog.version(*SERIES)).result()
    middle = rc.serve_count()
    assert middle > before
    bars.frame(*SERIES, *WINDOW, version=catalog.version(*SERIES))  # a bar-cache hit is still a gated read
    assert rc.serve_count() > middle


def test_the_serve_wrapper_counts_delegates_and_is_idempotent(tmp_path: Path):
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    wrapped = counted_serve(serve)
    assert counted_serve(wrapped) is wrapped
    before = rc.serve_count()
    frame = wrapped(*WINDOW, caller="terminal", reason="nqt-test terminal display", symbol="NQ.V.0")
    assert len(frame) > 0 and rc.serve_count() > before
    assert wrapped.calls == serve.calls and len(serve.calls) == 1  # attributes reach the wrapped serve
    assert wrapped.wrapped is serve


def test_the_serve_wrapper_counts_a_refused_serve_too(tmp_path: Path):
    wrapped = counted_serve(make_fake_serve(tmp_path / "oos_access_log.jsonl"))
    before = rc.serve_count()
    with pytest.raises(Exception):
        wrapped(pd.Timestamp("2023-01-02", tz="UTC"), pd.Timestamp("2023-01-03", tz="UTC"), caller="terminal",
                reason="nqt-test refused")
    assert rc.serve_count() > before


def test_a_worker_thread_with_a_copied_context_records_its_reads(source):
    files, path = source
    cache = rc.ResultCache(state_dir=None)

    def compute() -> bytes:
        ctx = contextvars.copy_context()
        with ThreadPoolExecutor(max_workers=1) as pool:
            value = pool.submit(ctx.run, files.read_json, path).result()
        return repr(value["v"]).encode("utf-8")

    cache.get(ROUTE, {}, compute)
    _rewrite_keeping_mtime(path, '{"v": 4444}')
    assert cache.get(ROUTE, {}, compute) == b"4444"


def test_the_counter_is_thread_safe():
    before = rc.serve_count()
    threads = [threading.Thread(target=lambda: [rc.bump_serve_count() for _ in range(1000)]) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert rc.serve_count() - before == 8000


# ---------------------------------------------------------------- nested cached calls


def _two_inputs(tmp_path: Path) -> tuple[FileCache, Path, Path]:
    folder = tmp_path / "results"
    folder.mkdir()
    a, b = folder / "a.json", folder / "b.json"
    a.write_text('{"v": 1}', encoding="utf-8")
    b.write_text('{"v": 1}', encoding="utf-8")
    return FileCache(roots=[folder]), a, b


@pytest.mark.parametrize("warm_inner", [True, False], ids=["inner-hit", "inner-miss"])
def test_a_nested_cached_call_passes_its_inputs_to_the_enclosing_computation(tmp_path: Path, warm_inner: bool):
    """Born failing: the inner call recorded b.json into its own recorder only, so the outer kept a stale body."""
    files, a, b = _two_inputs(tmp_path)
    cache = rc.ResultCache(state_dir=None)

    def inner() -> bytes:
        return str(files.read_json(b)["v"]).encode("utf-8")

    def outer() -> bytes:
        return f'{files.read_json(a)["v"]}:'.encode("utf-8") + cache.get("/api/test/inner", {}, inner)

    if warm_inner:
        cache.get("/api/test/inner", {}, inner)
    assert cache.get(ROUTE, {}, outer) == b"1:1"
    b.write_text('{"v": 22}', encoding="utf-8")
    assert cache.get(ROUTE, {}, outer) == b"1:22"


@pytest.mark.parametrize("kind", ["clock", "no-input", "failed"])
def test_a_nested_uncacheable_call_makes_the_enclosing_result_uncacheable(source, kind: str):
    """Born failing: the outer recorded only its own file read and was cached over a body it cannot pin."""
    files, path = source
    cache = rc.ResultCache(state_dir=None)
    calls: list = []

    def failing() -> bytes:
        raise RuntimeError("inner failure")

    def nested() -> bytes:
        if kind == "clock":
            return cache.get("/api/test/inner", {}, lambda: b"now", clock_dependent=True)
        if kind == "no-input":
            return cache.get("/api/test/inner", {}, lambda: b"constant")
        try:
            return cache.get("/api/test/inner", {}, failing)
        except RuntimeError:
            return b"fallback"

    def outer() -> bytes:
        calls.append(1)
        return f'{files.read_json(path)["v"]}:'.encode("utf-8") + nested()

    cache.get(ROUTE, {}, outer)
    cache.get(ROUTE, {}, outer)
    assert len(calls) == 2 and cache.stats().hits == 0
