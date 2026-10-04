"""FileCache's optional hooks (W5C D6): `weigh` charges a value its real retained size, and `extend` builds the new
value from the cached one when the file has only grown. Every other caller passes neither and sees no change.

Every file these tests write lives under pytest's tmp_path.
"""
from __future__ import annotations

import os
from pathlib import Path

from nq_terminal.services.files import FileCache

ONE_SECOND_NS = 1_000_000_000


def _write(path: Path, raw: bytes, *, later_by: int = 0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    before = path.stat().st_mtime_ns if path.exists() else None
    path.write_bytes(raw)
    if before is not None and later_by:
        os.utime(path, ns=(before + later_by, before + later_by))
    return path


def _lines(raw: bytes) -> tuple[bytes, ...]:
    return tuple(raw.splitlines())


class Extender:
    """Records each call; extends only when the cached value's bytes are a prefix of the new ones."""

    def __init__(self):
        self.calls: list[tuple[tuple[bytes, ...], int]] = []

    def __call__(self, old: tuple[bytes, ...], raw: bytes):
        self.calls.append((old, len(raw)))
        joined = b"\n".join(old) + b"\n"
        if not raw.startswith(joined):
            return None
        return old + _lines(raw[len(joined):])


def test_weigh_sets_what_the_entry_is_charged(tmp_path):
    path = _write(tmp_path / "a.txt", b"x" * 100)
    cache = FileCache(roots=[tmp_path])
    assert cache.get(path, bytes, kind="raw", weigh=lambda value: 12_345) == b"x" * 100
    assert cache.stats().bytes == 12_345 and cache.stats().entries == 1


def test_a_value_weighed_over_the_cap_is_served_but_not_cached(tmp_path):
    path = _write(tmp_path / "a.txt", b"x" * 10)
    cache = FileCache(roots=[tmp_path], max_bytes=1_000)
    assert cache.get(path, bytes, kind="raw", weigh=lambda value: 1_001) == b"x" * 10
    assert cache.stats().entries == 0 and cache.stats().bytes == 0


def test_without_weigh_the_charge_is_unchanged(tmp_path):
    path = _write(tmp_path / "a.txt", b"x" * 100)
    cache = FileCache(roots=[tmp_path])
    cache.get(path, bytes, kind="raw")
    assert cache.stats().bytes == 100


def test_extend_builds_on_the_cached_value_when_the_file_only_grew(tmp_path):
    path = _write(tmp_path / "log.txt", b"a\nb\n")
    cache, extend = FileCache(roots=[tmp_path]), Extender()
    parsed: list[int] = []

    def parser(raw: bytes):
        parsed.append(len(raw))
        return _lines(raw)

    assert cache.get(path, parser, kind="log", extend=extend) == (b"a", b"b")
    assert extend.calls == [], "nothing is cached yet: the first read is a full parse"
    _write(path, b"a\nb\nc\n", later_by=ONE_SECOND_NS)
    assert cache.get(path, parser, kind="log", extend=extend) == (b"a", b"b", b"c")
    assert parsed == [4] and extend.calls == [((b"a", b"b"), 6)]
    assert cache.get(path, parser, kind="log", extend=extend) == (b"a", b"b", b"c")
    assert len(extend.calls) == 1, "an unchanged file is a hit"


def test_extend_returning_none_falls_back_to_the_full_parser(tmp_path):
    path = _write(tmp_path / "log.txt", b"a\nb\n")
    cache, extend = FileCache(roots=[tmp_path]), Extender()
    cache.get(path, _lines, kind="log", extend=extend)
    _write(path, b"z\nb\nc\n", later_by=ONE_SECOND_NS)
    assert cache.get(path, _lines, kind="log", extend=extend) == (b"z", b"b", b"c")
    assert len(extend.calls) == 1


def test_extend_is_not_offered_a_file_that_shrank_or_went_back_in_time(tmp_path):
    path = _write(tmp_path / "log.txt", b"a\nb\nc\n")
    cache, extend = FileCache(roots=[tmp_path]), Extender()
    cache.get(path, _lines, kind="log", extend=extend)
    _write(path, b"a\nb\n", later_by=ONE_SECOND_NS)
    assert cache.get(path, _lines, kind="log", extend=extend) == (b"a", b"b")
    _write(path, b"a\nb\nc\nd\n", later_by=-10 * ONE_SECOND_NS)
    assert cache.get(path, _lines, kind="log", extend=extend) == (b"a", b"b", b"c", b"d")
    assert extend.calls == []
