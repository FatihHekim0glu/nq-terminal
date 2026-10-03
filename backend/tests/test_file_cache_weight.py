"""The FileCache charges each entry what it keeps, not what its file weighs (DEC1, the desktop EQ open; 02 O5).

At the desktop caps (128 MiB of files) the run index re-parsed every run's result.json on each GET /api/runs: the
index keeps only each run's head (about 0.7 MB for the 72 runs on 3 October 2026) but the cache charged every head
its whole file (163 MB in all), so one pass over the runs overflowed the cap and a least recently used cache scanned
in a cycle larger than itself keeps nothing for the next pass (0 hits; about 0.65 s a call against 15 ms at the
browser caps). The rule pinned here: a parsed value that keeps much less than its file (a projection such as the
run head) is charged its own retained size; a value that keeps at least half its file, or one the cache cannot
weigh (a DataFrame), is charged the file's size as before. The caps themselves are not raised, and the values
served are the same objects the parser built.

Every file these tests write lives under pytest's tmp_path.
"""
from __future__ import annotations

import json
from pathlib import Path

from nq_terminal.services import files
from nq_terminal.services.files import FileCache, freeze, retained_bytes, thaw
from nq_terminal.services.runs import RESULT_FILE, RunService

KIB = 1024
PAD_ROWS = 600  # about 64 KiB of trades per file


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return path


def _no_sleep(_seconds: float) -> None:
    return None


def _cache(tmp_path: Path, **kwargs) -> FileCache:
    return FileCache(roots=[tmp_path], sleep=_no_sleep, **kwargs)


def _trade(i: int) -> dict:
    return {"id": i, "entry": "2015-01-02T14:31:00Z", "exit": "2015-01-02T20:59:00Z", "pnl": 12.5 + i,
            "side": "long", "qty": 1, "fees": 1.22}


def _big_doc(name: str) -> dict:
    """A result-like document: a small head and a large array the head leaves out."""
    return {"name": name, "summary": {"n": PAD_ROWS, "t": 1.25}, "trades": [_trade(i) for i in range(PAD_ROWS)]}


def _head(raw: bytes):
    doc = json.loads(raw.decode("utf-8"))
    return freeze({k: v for k, v in doc.items() if k != "trades"})


# ---------------------------------------------------------------- the weight of one entry


def test_a_projection_is_charged_what_it_keeps_not_its_file(tmp_path):
    path = _write(tmp_path / "a.json", json.dumps(_big_doc("a")))
    size = path.stat().st_size
    cache = _cache(tmp_path)
    head = cache.get(path, _head, kind="head")
    assert head["name"] == "a"
    charged = cache.stats().bytes
    assert 0 < charged < size // 10, f"a {size} B file whose head keeps about 1 KiB was charged {charged} B"


def test_a_full_parse_is_still_charged_its_file_size(tmp_path):
    path = _write(tmp_path / "full.json", json.dumps(_big_doc("full")))
    cache = _cache(tmp_path)
    cache.read_json(path)
    assert cache.stats().bytes == path.stat().st_size


def test_a_frame_is_charged_its_file_size(tmp_path):
    path = _write(tmp_path / "t.csv", "a,b\n" + "".join(f"{i},{i * 2}\n" for i in range(2000)))
    cache = _cache(tmp_path)
    cache.read_csv(path)
    assert cache.stats().bytes == path.stat().st_size


def test_a_projection_larger_than_the_cache_is_still_not_cached(tmp_path):
    path = _write(tmp_path / "a.json", json.dumps(_big_doc("a")))
    cache = _cache(tmp_path, max_bytes=64)
    cache.get(path, _head, kind="head")
    assert cache.stats().entries == 0 and cache.stats().bytes == 0


def test_the_charged_bytes_are_returned_on_replace_and_eviction(tmp_path):
    paths = [_write(tmp_path / f"{i}.json", json.dumps(_big_doc(str(i)))) for i in range(3)]
    cache = _cache(tmp_path, max_entries=2)
    for path in paths:
        cache.get(path, _head, kind="head")
    kept = cache.stats()
    assert kept.entries == 2
    one = retained_bytes(_head(paths[1].read_bytes()), files.WEIGH_BUDGET_BYTES)
    assert one is not None and kept.bytes == 2 * one
    cache.clear()
    assert cache.stats().bytes == 0


# ---------------------------------------------------------------- the eviction pin: a scan larger than the cap


def test_a_scan_over_files_larger_than_the_cap_keeps_every_projection(tmp_path):
    """Born failing on the file-size weight: 8 files of about 64 KiB under a 256 KiB cap gave 0 hits on the second
    pass (each insert evicted the oldest, which the scan needed next)."""
    paths = [_write(tmp_path / f"run{i}.json", json.dumps(_big_doc(f"run{i}"))) for i in range(8)]
    total = sum(path.stat().st_size for path in paths)
    cap = 256 * KIB
    assert total > 2 * cap  # the files alone overflow the cap, as the runs do at the desktop caps
    cache = _cache(tmp_path, max_bytes=cap)
    first = [cache.get(path, _head, kind="head") for path in paths]
    second = [cache.get(path, _head, kind="head") for path in paths]
    stats = cache.stats()
    assert (stats.hits, stats.misses, stats.entries) == (8, 8, 8)
    assert all(a is b for a, b in zip(first, second))  # the same objects: served values cannot drift
    assert stats.bytes <= cap


def test_the_run_index_survives_a_cap_below_its_files(tmp_path):
    """The run index at a cap below the sum of its result files: the second GET /api/runs reads no file again."""
    output = tmp_path / "backtests" / "output"
    for i in range(6):
        doc = {"created_utc": "2026-09-27T00:00:00Z", "config": {"strategy": "s", "params": {}, "variant": "vendor",
                                                                 "start": "2015-01-01", "end": "2016-01-01"},
               "n_trades": PAD_ROWS, "pnl_total": 10.0, "fees_total": 1.0, "summary": {"hit_rate": 0.5},
               "balance_check": {"ok": True}, "trades": [_trade(j) for j in range(PAD_ROWS)], "fills": []}
        _write(output / f"run_{i}" / RESULT_FILE, json.dumps(doc))
    files_total = sum(path.stat().st_size for path in output.glob(f"*/{RESULT_FILE}"))
    cap = 128 * KIB
    assert files_total > 2 * cap
    small = RunService(data_root=tmp_path, project_root=tmp_path, cache=_cache(tmp_path, max_bytes=cap))
    roomy = RunService(data_root=tmp_path, project_root=tmp_path, cache=_cache(tmp_path))
    first = small.summaries()
    misses = small.cache.stats().misses
    second = small.summaries()
    assert small.cache.stats().misses == misses, "the second pass re-read result files the cache had dropped"
    as_json = [json.dumps(s.model_dump(mode="json"), sort_keys=True) for s in second]
    assert as_json == [json.dumps(s.model_dump(mode="json"), sort_keys=True) for s in first]
    assert as_json == [json.dumps(s.model_dump(mode="json"), sort_keys=True) for s in roomy.summaries()]


# ---------------------------------------------------------------- the estimator


def test_retained_bytes_counts_each_object_once_and_stops_at_its_budget():
    shared = "x" * 1000
    value = freeze({"a": [shared, shared, shared], "b": shared})
    once = retained_bytes(value, 10**6)
    assert once is not None and once < 3 * 1000  # the shared string is counted once
    assert retained_bytes(value, 500) is None  # over its budget: the caller charges the file instead
    assert retained_bytes(thaw(value), 10**6) is not None


def test_retained_bytes_does_not_weigh_unknown_objects():
    class Opaque:
        pass

    assert retained_bytes({"a": Opaque()}, 10**6) is None
