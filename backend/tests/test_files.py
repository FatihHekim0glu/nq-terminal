"""Tests for services/files.py: the sanitiser, the FileCache and the retry on half-written files (task 1.2).

Every file these tests write lives under pytest's tmp_path. The real-file smoke tests only read.
"""
from __future__ import annotations

import copy
import json
import math
import os
import pickle
import threading
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from pydantic import BaseModel

from nq_lab.config import ROOT
from nq_terminal.services import files
from nq_terminal.services.files import (
    EPOCH_SUFFIX,
    FLOAT_SUFFIX,
    FileAccessError,
    FileCache,
    FileDecodeError,
    FrozenDict,
    freeze,
    ns_to_epoch_s,
    ns_to_iso,
    sanitise,
    thaw,
)

NS = 1_300_000_000_000_000_000  # 2011-03-13T07:06:40Z, the "1.3e18 ns int" of the acceptance list
NS_ISO = "2011-03-13T07:06:40.000000000Z"


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))  # exact bytes: no newline translation on Windows
    return path


class Sleeper:
    """Stands in for time.sleep: records each delay and runs an optional action (e.g. finish a write)."""

    def __init__(self, action=None):
        self.calls: list[float] = []
        self.action = action

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        if self.action is not None:
            self.action()


def _cache(tmp_path: Path, **kwargs) -> FileCache:
    kwargs.setdefault("sleep", Sleeper())
    return FileCache(roots=[tmp_path], **kwargs)


# ---------------------------------------------------------------- sanitiser: NaN and Inf


def test_nan_and_infinity_tokens_become_null(tmp_path):
    path = _write(tmp_path / "j.json", '{"a": NaN, "b": Infinity, "c": -Infinity, "d": [1.5, NaN], "e": {"f": NaN}}')
    got = _cache(tmp_path).read_json(path)
    assert got == {"a": None, "b": None, "c": None, "d": (1.5, None), "e": {"f": None}}


def test_nonfinite_python_and_numpy_floats_become_null():
    got = sanitise({"a": float("nan"), "b": np.float64("inf"), "c": np.nan, "d": 2.5, "e": np.float32(-np.inf)})
    assert got == {"a": None, "b": None, "c": None, "d": 2.5, "e": None}
    assert type(got["d"]) is float


def test_sanitised_json_round_trips_through_strict_json():
    got = sanitise({"a": float("nan"), "ts": NS, "c": "1.25", "l": [float("inf")]})
    json.dumps(got, allow_nan=False)  # raises ValueError if a NaN or Inf survived


# ---------------------------------------------------------------- sanitiser: ns ints


def test_ns_int_becomes_iso_string_plus_epoch_seconds():
    got = sanitise({"ts": NS})
    assert got == {"ts": NS_ISO, "ts" + EPOCH_SUFFIX: 1_300_000_000}
    assert EPOCH_SUFFIX == "_epoch_s"


def test_ns_iso_keeps_nanoseconds_and_matches_pandas():
    ns = 1_325_635_200_000_000_001  # a real snapshot ts: session close plus 1 ns
    assert ns_to_iso(ns) == "2012-01-04T00:00:00.000000001Z"
    assert ns_to_epoch_s(ns) == 1_325_635_200
    for value in (NS, ns, 1_300_000_000_123_456_789, 1_640_995_199_999_999_999):
        stamp = pd.Timestamp(value, unit="ns", tz="UTC")
        assert ns_to_iso(value) == stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value % 10**9:09d}Z"
        assert ns_to_epoch_s(value) == value // 10**9


def test_ns_ints_nested_in_lists_of_rows_are_converted():
    got = sanitise({"fills": [{"ts": NS, "qty": 3}, {"ts": NS + 60 * 10**9, "qty": -1}]})
    assert got["fills"][0] == {"ts": NS_ISO, "ts_epoch_s": 1_300_000_000, "qty": 3}
    assert got["fills"][1]["ts"] == "2011-03-13T07:07:40.000000000Z"


def test_bare_ns_ints_in_a_list_or_at_top_level_become_iso():
    assert sanitise([NS, 5]) == [NS_ISO, 5]
    assert sanitise(NS) == NS_ISO


def test_numpy_int64_ns_is_converted():
    assert sanitise({"ts": np.int64(NS)}) == {"ts": NS_ISO, "ts_epoch_s": 1_300_000_000}


def test_small_ints_and_bools_are_left_alone():
    got = sanitise({"n": 2305, "ms": 1_300_000_000_000, "us": 1_300_000_000_000_000, "flag": True, "off": False})
    assert got == {"n": 2305, "ms": 1_300_000_000_000, "us": 1_300_000_000_000_000, "flag": True, "off": False}
    assert got["flag"] is True


def test_unsafe_non_timestamp_int_becomes_exact_string():
    too_big = 2**53 + 1  # beyond JavaScript's safe range, but not in the ns epoch window
    huge = 10**20
    assert sanitise({"a": too_big, "b": huge, "c": -too_big}) == {"a": str(too_big), "b": str(huge), "c": str(-too_big)}


def test_js_safe_integer_bound_is_exact():
    # Number.MAX_SAFE_INTEGER is 2**53 - 1; 2**53 is not safe (2**53 + 1 rounds to it in JavaScript).
    assert sanitise({"a": 2**53, "b": -(2**53), "c": 2**53 - 1, "d": -(2**53 - 1)}) == {
        "a": str(2**53), "b": str(-(2**53)), "c": 2**53 - 1, "d": -(2**53 - 1)}
    assert sanitise([2**53, 2**53 - 1]) == [str(2**53), 2**53 - 1]


def test_existing_sibling_key_is_not_overwritten():
    got = sanitise({"ts": NS, "ts_epoch_s": 7, "c": "2.50", "c_float": 9.0})
    assert got["ts_epoch_s"] == 7 and got["c_float"] == 9.0
    assert got["ts"] == NS_ISO and got["c"] == "2.50"


# ---------------------------------------------------------------- sanitiser: Decimal strings


def test_decimal_strings_are_kept_and_gain_a_float():
    got = sanitise({"commission": "215.0000", "balance": "99989180.0000", "neg": "-0.61", "K": "100000000"})
    assert FLOAT_SUFFIX == "_float"
    assert got["commission"] == "215.0000" and got["commission_float"] == 215.0
    assert got["balance"] == "99989180.0000" and got["balance_float"] == 99_989_180.0
    assert got["neg_float"] == -0.61 and got["K_float"] == 1e8
    assert all(type(got[k]) is float for k in ("commission_float", "balance_float", "neg_float", "K_float"))


def test_decimal_float_equals_decimal_conversion():
    for text in ("0.61", "2.5000", "1.3333333333333333333", "-12345.678"):
        assert sanitise({"x": text})["x_float"] == float(Decimal(text))


def test_non_decimal_strings_are_untouched():
    texts = ["2010-2013", "NQH1.CME", "NaN", "Infinity", "1e5", "", "12 USD", "2019-03-14", "0x1F", " 1.5", "1.", ".5"]
    got = sanitise({f"k{i}": t for i, t in enumerate(texts)})
    assert got == {f"k{i}": t for i, t in enumerate(texts)}


def test_decimal_strings_in_lists_stay_strings():
    assert sanitise(["1.25", "x"]) == ["1.25", "x"]


def test_real_decimal_objects_become_string_plus_float():
    got = sanitise({"px": Decimal("4321.25")})
    assert got == {"px": "4321.25", "px_float": 4321.25}


def test_overlong_decimal_string_gains_no_infinite_float():
    got = sanitise({"x": "9" * 400, "y": "-" + "9" * 400})
    assert got == {"x": "9" * 400, "y": "-" + "9" * 400}
    json.dumps(got, allow_nan=False)


def test_out_of_range_decimal_object_gains_no_infinite_float():
    got = sanitise({"x": Decimal("1E+400")})
    assert got == {"x": "1E+400"}
    json.dumps(got, allow_nan=False)


@pytest.mark.parametrize("value", [Decimal("NaN"), Decimal("sNaN"), Decimal("Infinity"), Decimal("-Infinity")])
def test_non_finite_decimal_objects_become_null(value):
    assert sanitise({"x": value}) == {"x": None}
    assert sanitise([value]) == [None]
    assert sanitise(value) is None


def test_sanitise_does_not_mutate_its_input():
    source = {"a": [float("nan"), {"ts": NS}], "c": "1.5"}
    before = copy.deepcopy(source)
    sanitise(source)
    assert json.dumps(source, sort_keys=True, default=str) == json.dumps(before, sort_keys=True, default=str)
    assert math.isnan(source["a"][0]) and source["a"][1] == {"ts": NS}


def test_pandas_records_are_sanitised():
    frame = pd.DataFrame({"ts": [NS, NS + 1], "r": [0.01, np.nan], "n": [1, 2]})
    got = sanitise(frame.to_dict("records"))
    assert got[1]["r"] is None and got[0]["ts"] == NS_ISO and got[0]["n"] == 1
    assert type(got[0]["n"]) is int


# ---------------------------------------------------------------- retry on half-written files


def test_half_written_file_becomes_valid_on_retry(tmp_path):
    path = _write(tmp_path / "result.json", '{"run_id": "r1", "trades": [1, 2')
    sleeper = Sleeper(action=lambda: _write(path, '{"run_id": "r1", "trades": [1, 2, 3]}'))
    got = _cache(tmp_path, sleep=sleeper).read_json(path)
    assert got == {"run_id": "r1", "trades": (1, 2, 3)}
    assert sleeper.calls == [pytest.approx(0.2)]


def test_file_still_broken_after_one_retry_raises(tmp_path):
    path = _write(tmp_path / "bad.json", '{"a": ')
    sleeper = Sleeper()
    cache = _cache(tmp_path, sleep=sleeper)
    with pytest.raises(FileDecodeError) as info:
        cache.read_json(path)
    assert sleeper.calls == [pytest.approx(0.2)]  # exactly one retry
    assert info.value.path == path.resolve()
    assert isinstance(info.value, ValueError)


def test_empty_file_is_retried_then_fails(tmp_path):
    path = _write(tmp_path / "empty.json", "")
    sleeper = Sleeper()
    with pytest.raises(FileDecodeError):
        _cache(tmp_path, sleep=sleeper).read_json(path)
    assert len(sleeper.calls) == 1


def test_invalid_utf8_is_a_decode_error(tmp_path):
    path = tmp_path / "latin.json"
    path.write_bytes(b'{"a": "caf\xe9"}')
    with pytest.raises(FileDecodeError):
        _cache(tmp_path).read_json(path)


def test_failed_decode_is_not_cached(tmp_path):
    path = _write(tmp_path / "bad.json", "{")
    cache = _cache(tmp_path)
    with pytest.raises(FileDecodeError):
        cache.read_json(path)
    _write(path, '{"ok": 1}')
    assert cache.read_json(path) == {"ok": 1}


# ---------------------------------------------------------------- cache hit and miss


def _set_mtime(path: Path, mtime_ns: int) -> None:
    os.utime(path, ns=(mtime_ns, mtime_ns))


def test_cache_hit_on_unchanged_mtime_and_size(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1}')
    cache = _cache(tmp_path)
    first = cache.read_json(path)
    second = cache.read_json(path)
    assert second is first
    stats = cache.stats()
    assert (stats.hits, stats.misses, stats.entries) == (1, 1, 1)


def test_cache_miss_when_mtime_changes_with_same_size(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1}')
    cache = _cache(tmp_path)
    mtime = path.stat().st_mtime_ns
    assert cache.read_json(path) == {"v": 1}
    _write(path, '{"v": 2}')  # same size
    _set_mtime(path, mtime + 1_000_000_000)
    assert cache.read_json(path) == {"v": 2}
    assert cache.stats().misses == 2


def test_cache_miss_when_size_changes_with_same_mtime(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1}')
    cache = _cache(tmp_path)
    mtime = path.stat().st_mtime_ns
    assert cache.read_json(path) == {"v": 1}
    _write(path, '{"v": 10}')
    _set_mtime(path, mtime)  # a path-plus-mtime key alone would serve the stale value here
    assert path.stat().st_mtime_ns == mtime
    assert cache.read_json(path) == {"v": 10}


def test_unchanged_content_rewritten_with_new_mtime_is_reloaded(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1}')
    cache = _cache(tmp_path)
    first = cache.read_json(path)
    _set_mtime(path, path.stat().st_mtime_ns + 5_000_000_000)
    second = cache.read_json(path)
    assert second == first and second is not first


def test_same_path_different_kinds_are_cached_separately(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1.5}')
    cache = _cache(tmp_path)
    assert cache.read_text(path) == '{"v": 1.5}'
    assert cache.read_json(path) == {"v": 1.5}
    assert cache.stats().entries == 2


def test_equivalent_spellings_of_a_path_share_one_entry(tmp_path):
    path = _write(tmp_path / "sub" / "a.json", "[1]")
    cache = _cache(tmp_path)
    cache.read_json(path)
    cache.read_json(tmp_path / "sub" / ".." / "sub" / "a.json")
    assert cache.stats().hits == 1


def test_value_not_cached_when_file_changes_during_read(tmp_path):
    path = _write(tmp_path / "a.json", '{"v": 1}')

    class RacyCache(FileCache):
        def _read_bytes(self, target: Path) -> bytes:
            raw = super()._read_bytes(target)
            _write(target, '{"v": 22}')  # a writer lands between our read and the second stat
            return raw

    racy = RacyCache(roots=[tmp_path], sleep=Sleeper())
    assert racy.read_json(path) == {"v": 1}
    assert racy.stats().entries == 0
    assert FileCache(roots=[tmp_path], sleep=Sleeper()).read_json(path) == {"v": 22}


class RacingCache(FileCache):
    """Holds two threads where the first version released the lock between dropping and inserting."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.loaded = threading.Barrier(2, timeout=5)
        self.dropped = threading.Barrier(2, timeout=2)
        self.racing = True

    def _load(self, target, parser):
        out = super()._load(target, parser)
        if self.racing:
            self.loaded.wait()  # both threads have missed and read before either stores
        return out

    def _drop(self, key):
        super()._drop(key)
        if self.racing:
            try:
                self.dropped.wait()
            except threading.BrokenBarrierError:
                pass


def _race_first_reads(cache: FileCache, path: Path) -> None:
    errors: list[BaseException] = []

    def read() -> None:
        try:
            cache.read_json(path)
        except BaseException as exc:  # surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=read) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert not errors, errors


def test_concurrent_first_reads_of_one_file_count_its_bytes_once(tmp_path):
    path = _write(tmp_path / "result.json", '{"a": 1, "b": [1, 2, 3], "c": "x"}')
    size = path.stat().st_size
    cache = RacingCache(roots=[tmp_path], sleep=Sleeper(), max_bytes=100)
    _race_first_reads(cache, path)
    stats = cache.stats()
    assert (stats.entries, stats.bytes) == (1, size)
    cache.racing = False
    other = _write(tmp_path / "other.json", '{"z": 2}')
    cache.read_json(other)
    assert cache.stats().entries == 2  # the cache did not shrink: phantom bytes would evict it at once


def test_lru_evicts_by_entry_count(tmp_path):
    cache = _cache(tmp_path, max_entries=2)
    paths = [_write(tmp_path / f"{i}.json", f'{{"i": {i}}}') for i in range(3)]
    cache.read_json(paths[0])
    cache.read_json(paths[1])
    cache.read_json(paths[0])  # 0 becomes most recent
    cache.read_json(paths[2])  # evicts 1
    assert cache.stats().entries == 2
    cache.read_json(paths[0])
    assert cache.stats().hits == 2
    cache.read_json(paths[1])
    assert cache.stats().misses == 4


def test_lru_evicts_by_bytes(tmp_path):
    cache = _cache(tmp_path, max_bytes=40)
    a = _write(tmp_path / "a.json", '{"pad": "' + "x" * 20 + '"}')
    b = _write(tmp_path / "b.json", '{"pad": "' + "y" * 20 + '"}')
    cache.read_json(a)
    cache.read_json(b)
    stats = cache.stats()
    assert stats.entries == 1 and stats.bytes <= 40


def test_file_larger_than_the_cache_is_served_but_not_cached(tmp_path):
    cache = _cache(tmp_path, max_bytes=10)
    path = _write(tmp_path / "big.json", '{"pad": "' + "z" * 50 + '"}')
    assert cache.read_json(path)["pad"] == "z" * 50
    assert cache.stats().entries == 0


def test_clear_empties_the_cache(tmp_path):
    cache = _cache(tmp_path)
    cache.read_json(_write(tmp_path / "a.json", "{}"))
    cache.clear()
    assert cache.stats().entries == 0 and cache.stats().bytes == 0


def test_generic_get_with_a_custom_parser(tmp_path):
    path = _write(tmp_path / "log.jsonl", '{"a": 1}\n{"a": NaN}\n')
    calls = []

    def parse_lines(raw: bytes):
        calls.append(1)
        return freeze(sanitise([json.loads(line) for line in raw.decode("utf-8").splitlines()]))

    cache = _cache(tmp_path)
    first = cache.get(path, parse_lines, kind="jsonl")
    assert cache.get(path, parse_lines, kind="jsonl") is first
    assert len(calls) == 1
    assert first == ({"a": 1}, {"a": None})


# ---------------------------------------------------------------- frozen values


def test_cached_values_are_frozen(tmp_path):
    got = _cache(tmp_path).read_json(_write(tmp_path / "a.json", '{"a": {"b": [1, {"c": 2}]}}'))
    assert isinstance(got, FrozenDict) and isinstance(got, dict)
    for mutate in (
        lambda: got.__setitem__("x", 1),
        lambda: got.__delitem__("a"),
        lambda: got.pop("a"),
        lambda: got.popitem(),
        lambda: got.update({"x": 1}),
        lambda: got.setdefault("x", 1),
        lambda: got.clear(),
        lambda: got["a"].__setitem__("b", 0),
    ):
        with pytest.raises(TypeError):
            mutate()
    with pytest.raises(TypeError):
        got |= {"x": 1}
    assert isinstance(got["a"]["b"], tuple)
    assert got == {"a": {"b": (1, {"c": 2})}}


def test_thaw_gives_a_mutable_deep_copy():
    frozen = freeze({"a": [1, {"b": [2]}]})
    thawed = thaw(frozen)
    thawed["a"][1]["b"].append(3)
    assert thawed == {"a": [1, {"b": [2, 3]}]}
    assert frozen == {"a": (1, {"b": (2,)})}
    assert type(thawed) is dict and type(thawed["a"]) is list


def test_frozen_values_serialise_copy_and_validate():
    frozen = freeze({"run_id": "r1", "trades": [{"pnl_usd": 1.5}], "n": 1})

    class Trade(BaseModel):
        pnl_usd: float

    class Run(BaseModel):
        run_id: str
        trades: list[Trade]
        n: int

    assert json.loads(json.dumps(frozen)) == {"run_id": "r1", "trades": [{"pnl_usd": 1.5}], "n": 1}
    assert Run.model_validate(frozen).trades[0].pnl_usd == 1.5
    assert copy.deepcopy(frozen) == frozen and isinstance(copy.deepcopy(frozen), FrozenDict)
    assert pickle.loads(pickle.dumps(frozen)) == frozen
    assert pd.DataFrame(list(frozen["trades"]))["pnl_usd"].tolist() == [1.5]
    assert dict(frozen) == frozen and type(frozen.copy()) is dict


# ---------------------------------------------------------------- confinement and refusals


def test_path_outside_the_roots_is_refused(tmp_path):
    inside = tmp_path / "inside"
    outside = _write(tmp_path / "outside" / "a.json", "{}")
    cache = FileCache(roots=[inside], sleep=Sleeper())
    with pytest.raises(FileAccessError):
        cache.read_json(outside)
    with pytest.raises(FileAccessError):
        cache.read_json(inside / ".." / "outside" / "a.json")


def test_prefix_sibling_folder_is_not_inside_the_root(tmp_path):
    root = tmp_path / "results"
    sibling = _write(tmp_path / "results_evil" / "a.json", "{}")
    with pytest.raises(FileAccessError):
        FileCache(roots=[root], sleep=Sleeper()).read_json(sibling)


def test_parquet_and_arrow_files_are_refused_even_inside_a_root(tmp_path):
    cache = _cache(tmp_path)
    for name in ("bars.parquet", "BARS.PARQUET", "bars.arrow", "bars.feather"):
        with pytest.raises(FileAccessError):
            cache.read_text(_write(tmp_path / name, "x"))


def test_folder_is_refused(tmp_path):
    (tmp_path / "d").mkdir()
    with pytest.raises(FileAccessError):
        _cache(tmp_path).read_text(tmp_path / "d")


def test_missing_file_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        _cache(tmp_path).read_json(tmp_path / "nope.json")


def test_missing_file_drops_a_stale_entry(tmp_path):
    path = _write(tmp_path / "a.json", "{}")
    cache = _cache(tmp_path)
    cache.read_json(path)
    path.unlink()
    with pytest.raises(FileNotFoundError):
        cache.read_json(path)
    assert cache.stats().entries == 0


def test_file_over_the_size_cap_is_refused(tmp_path):
    path = _write(tmp_path / "big.json", "[" + ",".join(["1"] * 100) + "]")
    with pytest.raises(FileAccessError):
        _cache(tmp_path, max_file_bytes=50).read_json(path)


def test_roots_are_required_and_must_not_be_empty():
    with pytest.raises(TypeError):
        FileCache()  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        FileCache(roots=[])


def test_bad_limits_fail_fast(tmp_path):
    for kwargs in ({"max_bytes": 0}, {"max_entries": 0}, {"max_file_bytes": 0}, {"retry_delay_s": -1}):
        with pytest.raises(ValueError):
            FileCache(roots=[tmp_path], **kwargs)


def test_module_has_no_write_calls():
    source = Path(files.__file__).read_text(encoding="utf-8")
    for banned in ("write_text", "write_bytes", "to_csv", "to_parquet", '"w"', '"a"', "'w'", "'a'",
                   "".join(("read_", "parquet"))):  # joined: the AST scan flags the name as a literal
        assert banned not in source, banned


# ---------------------------------------------------------------- text and CSV


def test_read_text_strict_and_replace(tmp_path):
    path = tmp_path / "x.log"
    path.write_bytes("2026-09-26 [INFO] ok ".encode("utf-8") + b"\xff\n")
    cache = _cache(tmp_path)
    with pytest.raises(FileDecodeError):
        cache.read_text(path)
    assert cache.read_text(path, errors="replace").endswith("ok �\n")


def test_read_text_keeps_utf8(tmp_path):
    path = _write(tmp_path / "s.md", "Sharpe difference (m - BH) ▲ ▼\n")
    assert _cache(tmp_path).read_text(path) == "Sharpe difference (m - BH) ▲ ▼\n"


def test_read_csv_returns_an_independent_copy(tmp_path):
    path = _write(tmp_path / "d.csv", "date,r_m_1\n2010-01-04,0.01\n2010-01-05,\n")
    cache = _cache(tmp_path)
    first = cache.read_csv(path)
    first.loc[0, "r_m_1"] = 99.0
    second = cache.read_csv(path)
    assert second.loc[0, "r_m_1"] == 0.01 and math.isnan(second.loc[1, "r_m_1"])
    assert cache.stats().hits == 1


def test_half_written_csv_is_retried(tmp_path):
    path = _write(tmp_path / "d.csv", "")
    sleeper = Sleeper(action=lambda: _write(path, "a,b\n1,2\n"))
    frame = _cache(tmp_path, sleep=sleeper).read_csv(path)
    assert frame.to_dict("records") == [{"a": 1, "b": 2}]
    assert len(sleeper.calls) == 1


# ---------------------------------------------------------------- real files (read only)

OUTPUT = ROOT / "backtests" / "output"


def _assert_clean(value) -> None:
    if isinstance(value, dict):
        for item in value.values():
            _assert_clean(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_clean(item)
    elif isinstance(value, float):
        assert math.isfinite(value)
    elif isinstance(value, int) and not isinstance(value, bool):
        assert abs(value) < 2**53


@pytest.mark.parametrize("run_id", ["nt_dtsmom_v0_ts1", "smoke_2015_01"])
def test_real_result_files_sanitise_cleanly(run_id):
    path = OUTPUT / run_id / "result.json"
    if not path.is_file():
        pytest.skip(f"{path} not on disk")
    got = FileCache(roots=[OUTPUT]).read_json(path)
    _assert_clean(got)
    json.dumps(got, allow_nan=False)
    fills = got.get("fills") or ()
    if fills:
        assert fills[0]["ts"].endswith("Z") and isinstance(fills[0]["ts_epoch_s"], int)
        assert isinstance(fills[0]["commission"], str) and isinstance(fills[0]["commission_float"], float)


# ---------------------------------------------------------------- confinement reuses the stat of the read (V032G)


def test_a_cache_hit_stats_the_file_twice_at_most(tmp_path, monkeypatch):
    """Born failing: the confinement ran exists() and is_file() (two stats) before the read's own stat: four per hit with
    the one inside `resolve`, about 30 percent of the 142 us a hit cost on the real lab."""
    path = _write(tmp_path / "a.json", "[1]")
    cache = _cache(tmp_path)
    cache.read_json(path)
    calls: list[Path] = []
    real = Path.stat

    def counting(self, *args, **kwargs):
        calls.append(self)
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", counting)
    assert cache.read_json(path) == (1,)
    assert len(calls) <= 2, calls  # the resolve's own stat and the read's: the old confinement made four


def test_a_folder_named_like_a_file_is_still_refused_and_a_missing_one_still_not_found(tmp_path):
    (tmp_path / "d.json").mkdir()
    cache = _cache(tmp_path)
    with pytest.raises(FileAccessError, match="not a regular file"):
        cache.read_json(tmp_path / "d.json")
    with pytest.raises(FileNotFoundError):
        cache.read_json(tmp_path / "missing.json")


def test_a_refused_suffix_is_refused_before_any_stat_even_when_the_file_is_missing(tmp_path):
    with pytest.raises(FileAccessError):
        _cache(tmp_path).read_text(tmp_path / "gone.parquet")


def test_a_file_turned_into_a_folder_is_refused_and_its_entry_does_not_serve(tmp_path):
    path = _write(tmp_path / "x.json", "[1]")
    cache = _cache(tmp_path)
    assert cache.read_json(path) == (1,)
    path.unlink()
    path.mkdir()
    with pytest.raises(FileAccessError):
        cache.read_json(path)


def test_the_confinement_is_still_one_method_a_caller_can_wrap(tmp_path):
    """tests/test_home_cold_runs.py replaces `_confine` to refuse one path: `get` must still call it by that name."""
    path = _write(tmp_path / "a.json", "[1]")
    cache = _cache(tmp_path)
    seen: list[str] = []
    real = cache._confine
    cache._confine = lambda p: (seen.append(Path(p).name), real(p))[1]  # type: ignore[method-assign]
    cache.read_json(path)
    assert seen == ["a.json"]
