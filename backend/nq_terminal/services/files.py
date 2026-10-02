"""Safe, cached, read-only file access for the terminal: FileCache, the sanitiser and frozen values.

Read-only contract for Phase 2 (TASKS 1.2). Services pass paths they have already validated against an
index built from disk; the cache adds defence in depth on top.

FileCache
- Entries are keyed on `(path, kind)` and validated against `(mtime_ns, size)` from `os.stat`: an entry is
  served only while both are unchanged, so a rewrite that changes either one reloads the file. (A rewrite
  of the same size inside one mtime tick cannot be seen; NTFS ticks are 100 ns.)
- A value is cached only when the stat before and after the read agree, so a write racing the read never
  pins a stale value under the new key.
- LRU bounded by entry count and by the source files' byte sizes; a file bigger than the cap is served
  but not cached. Thread safe (FastAPI runs sync endpoints in a thread pool).
- Read hook (result cache, services/result_cache.py): every read, a hit included, reports the file and the
  (mtime_ns, size) it was read at to the result cache's recorder; a missing file is reported as missing, and a file
  that changed while it was read is reported as unpinned, so a result built on it is never cached.
- Retry once: when parsing raises a decode error (`ValueError`, which covers `json.JSONDecodeError`,
  `UnicodeDecodeError` and pandas' CSV errors) the file is re-read once after `retry_delay_s` (200 ms,
  ARCHITECTURE section 9); a second failure raises `FileDecodeError`.
- Confinement: every path must resolve inside one of `roots`; parquet, arrow and feather files are
  refused (prices are read only through `nq_lab.data.serve`); files over `max_file_bytes` are refused.
- Values are frozen: dicts become `FrozenDict` (a read-only `dict` subclass, so json, orjson, pydantic
  and pandas accept it) and lists become tuples. Use `thaw()` for a mutable deep copy. CSV frames are
  cached once and each caller gets its own `.copy()`.

Sanitiser (`sanitise`, pure: returns new containers, never mutates its input)
- NaN, Inf and -Inf floats (including numpy floats and json's NaN tokens) become None.
- An int inside the ns epoch window [2000-01-01, 2100-01-01) is a nanosecond timestamp: as a dict value
  `k` it becomes an ISO 8601 UTC string with 9 fractional digits, plus `k_epoch_s` (int, floor seconds)
  for chart axes; in a list or at top level it becomes the ISO string only. Any other int beyond
  JavaScript's safe range (|n| > 2**53 - 1, Number.MAX_SAFE_INTEGER) becomes its exact decimal string.
- A Decimal string (`^[+-]?\\d+(\\.\\d+)?$`, e.g. Nautilus money "215.0000") is kept as the string and,
  as a dict value `k`, gains `k_float` for charts. `decimal.Decimal` objects become the same pair. The
  float sibling is added only when it is finite (an overlong digit string would give inf); a NaN or
  infinite `Decimal` becomes None, like a float.
- A sibling key already present in the source dict is never overwritten.
"""
from __future__ import annotations

import io
import json
import math
import numbers
import os
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, TypeVar

import pandas as pd

from nq_terminal.services import result_cache

T = TypeVar("T")

EPOCH_SUFFIX = "_epoch_s"
FLOAT_SUFFIX = "_float"
NS_PER_S = 1_000_000_000
NS_WINDOW = (946_684_800 * NS_PER_S, 4_102_444_800 * NS_PER_S)  # [2000-01-01, 2100-01-01) UTC
JS_MAX_SAFE_INT = 2**53 - 1  # Number.MAX_SAFE_INTEGER
DECIMAL_STRING = re.compile(r"[+-]?\d+(?:\.\d+)?")
REFUSED_SUFFIXES = frozenset({".parquet", ".arrow", ".feather"})
RETRY_DELAY_S = 0.2
DEFAULT_MAX_BYTES = 512 * 1024**2
DEFAULT_MAX_ENTRIES = 512
DEFAULT_MAX_FILE_BYTES = 128 * 1024**2
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class FileAccessError(PermissionError):
    """The path is outside the allowed roots, not a regular file, a refused type or too large."""


class FileDecodeError(ValueError):
    """The file could not be decoded, even after one retry."""

    def __init__(self, path: Path, cause: Exception):
        super().__init__(f"could not decode {path.name} after one retry: {cause}")
        self.path = path


# ---------------------------------------------------------------- sanitiser


def ns_to_iso(ns: int) -> str:
    """Nanoseconds since the epoch as ISO 8601 UTC with all nine fractional digits."""
    seconds, rem = divmod(int(ns), NS_PER_S)
    stamp = _EPOCH + timedelta(seconds=seconds)
    return f"{stamp:%Y-%m-%dT%H:%M:%S}.{rem:09d}Z"


def ns_to_epoch_s(ns: int) -> int:
    """Whole seconds since the epoch (floor), the unit of every chart axis."""
    return int(ns) // NS_PER_S


def _is_ns(value: int) -> bool:
    return NS_WINDOW[0] <= value < NS_WINDOW[1]


def _scalar(value: Any) -> Any:
    """Sanitise one leaf that has no dict key (list items, top level)."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, Decimal):
        return str(value) if value.is_finite() else None
    if isinstance(value, numbers.Integral):
        number = int(value)
        if _is_ns(number):
            return ns_to_iso(number)
        return str(number) if abs(number) > JS_MAX_SAFE_INT else number
    if isinstance(value, numbers.Real):
        number = float(value)
        return number if math.isfinite(number) else None
    return value


def _siblings(key: str, value: Any) -> dict[str, Any]:
    """The extra keys a dict value earns: epoch seconds for ns ints, a float for Decimal strings."""
    if isinstance(value, bool):
        return {}
    if isinstance(value, numbers.Integral) and _is_ns(int(value)):
        return {key + EPOCH_SUFFIX: ns_to_epoch_s(int(value))}
    decimal = (isinstance(value, Decimal) and value.is_finite()) or (
        isinstance(value, str) and DECIMAL_STRING.fullmatch(value) is not None)
    if decimal:
        number = float(value)
        return {key + FLOAT_SUFFIX: number} if math.isfinite(number) else {}
    return {}


def _sanitise_dict(source: Mapping[Any, Any]) -> dict[Any, Any]:
    out = {key: sanitise(value) for key, value in source.items()}
    for key, value in source.items():
        if not isinstance(key, str):
            continue
        for extra_key, extra in _siblings(key, value).items():
            if extra_key not in source:
                out[extra_key] = extra
    return out


def sanitise(value: Any) -> Any:
    """A JSON-safe copy of `value` (see the module docstring for the rules)."""
    if isinstance(value, Mapping):
        return _sanitise_dict(value)
    if isinstance(value, (list, tuple)):
        return [sanitise(item) for item in value]
    return _scalar(value)


# ---------------------------------------------------------------- frozen values


def _read_only(self: Any, *args: Any, **kwargs: Any) -> Any:
    raise TypeError("cached file values are read-only; use files.thaw() for a mutable copy")


class FrozenDict(dict):
    """A dict that refuses every in-place change. `dict(d)` and `d.copy()` give plain mutable dicts."""

    __slots__ = ()
    __setitem__ = __delitem__ = __ior__ = _read_only
    clear = pop = popitem = setdefault = update = _read_only

    def __reduce__(self) -> tuple[type, tuple[dict[Any, Any]]]:
        return (FrozenDict, (dict(self),))

    def __copy__(self) -> "FrozenDict":
        return self

    def __deepcopy__(self, memo: dict[int, Any]) -> "FrozenDict":
        return self


def freeze(value: Any) -> Any:
    """Dicts to FrozenDict and lists to tuples, recursively."""
    if isinstance(value, Mapping):
        return FrozenDict((key, freeze(item)) for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    return value


def thaw(value: Any) -> Any:
    """A mutable deep copy: mappings to dict, tuples and lists to list."""
    if isinstance(value, Mapping):
        return {key: thaw(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(item) for item in value]
    return value


# ---------------------------------------------------------------- local paths


_WINDOWS_HOME = re.compile(r"\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\"\r\n]+", re.IGNORECASE)
_POSIX_HOME = re.compile(r"(?<![\w.~])/(?:home|Users)/[^/\s\"]+")
_SEPARATORS = re.compile(r"[\\/]+")


def _root_prefixes(root: Path) -> re.Pattern[str]:
    """The root written with either separator, then at least one separator, in any case."""
    parts = [re.escape(part) for part in _SEPARATORS.split(str(root)) if part]
    return re.compile(r"[\\/]+".join(parts) + r"[\\/]+", re.IGNORECASE)


def redact_local_paths(value: Any, root: Path) -> Any:
    """A copy of `value` in which no string names a local folder: a path under `root` keeps only its part below
    the root, and any other home folder (`C:\\Users\\<name>`, `/home/<name>`, `/Users/<name>`) becomes `~`, so a
    response never carries the user name (research JSON records absolute cache and source paths in prose)."""
    prefix = _root_prefixes(Path(root))

    def _redact(item: Any) -> Any:
        if isinstance(item, str):
            return _POSIX_HOME.sub("~", _WINDOWS_HOME.sub("~", prefix.sub("", item)))
        if isinstance(item, Mapping):
            return {key: _redact(inner) for key, inner in item.items()}
        if isinstance(item, (list, tuple)):
            return [_redact(inner) for inner in item]
        return item

    return _redact(value)


# ---------------------------------------------------------------- parsers


def parse_json(raw: bytes) -> Any:
    """Strict utf-8, json's NaN and Infinity tokens accepted, then sanitised and frozen."""
    return freeze(sanitise(json.loads(raw.decode("utf-8"))))


def _text_parser(errors: str) -> Callable[[bytes], str]:
    def parse(raw: bytes) -> str:
        return raw.decode("utf-8", errors=errors)

    return parse


def parse_csv(raw: bytes) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(raw), encoding="utf-8")


# ---------------------------------------------------------------- cache


@dataclass(frozen=True)
class CacheStats:
    hits: int
    misses: int
    retries: int
    entries: int
    bytes: int


@dataclass(frozen=True)
class _Entry:
    mtime_ns: int
    size: int
    value: Any


def _positive(name: str, value: float) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")


class FileCache:
    """Cached, confined, retrying reads of text, JSON and CSV files (see the module docstring)."""

    def __init__(
        self,
        *,
        roots: Iterable[Path],
        max_bytes: int = DEFAULT_MAX_BYTES,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
        retry_delay_s: float = RETRY_DELAY_S,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._roots = tuple(Path(root).resolve() for root in roots)
        if not self._roots:
            raise ValueError("FileCache needs at least one root folder")
        for name, value in (("max_bytes", max_bytes), ("max_entries", max_entries), ("max_file_bytes", max_file_bytes)):
            _positive(name, value)
        if retry_delay_s < 0:
            raise ValueError(f"retry_delay_s must not be negative, got {retry_delay_s}")
        self._max_bytes, self._max_entries, self._max_file_bytes = max_bytes, max_entries, max_file_bytes
        self._retry_delay_s, self._sleep = retry_delay_s, sleep
        self._entries: OrderedDict[tuple[str, str], _Entry] = OrderedDict()
        self._bytes = self._hits = self._misses = self._retries = 0
        self._lock = threading.Lock()

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    # public API

    def read_json(self, path: Path) -> Any:
        return self.get(path, parse_json, kind="json")

    def read_text(self, path: Path, errors: str = "strict") -> str:
        return self.get(path, _text_parser(errors), kind=f"text:{errors}")

    def read_csv(self, path: Path) -> pd.DataFrame:
        return self.get(path, parse_csv, kind="csv").copy()

    def get(self, path: Path, parser: Callable[[bytes], T], *, kind: str) -> T:
        """The parsed file, from the cache while `(mtime_ns, size)` is unchanged. `kind` names the parser."""
        target = self._confine(Path(path))
        key = (os.path.normcase(str(target)), kind)
        try:
            stat = target.stat()
        except FileNotFoundError:
            self._drop(key)
            result_cache.record_missing(target)
            raise
        cached = self._lookup(key, stat.st_mtime_ns, stat.st_size)
        if cached is not None:
            result_cache.record_file(target, cached.mtime_ns, cached.size)
            return cached.value
        try:
            value, stable = self._load(target, parser)
        except Exception:
            # a caller may swallow this and finish with a body built without the file: never cache that body
            result_cache.record_unstable(target)
            raise
        if stable is not None:
            self._store(key, _Entry(stable[0], stable[1], value))
            result_cache.record_file(target, *stable)
        else:
            result_cache.record_unstable(target)
        return value

    def stats(self) -> CacheStats:
        with self._lock:
            return CacheStats(self._hits, self._misses, self._retries, len(self._entries), self._bytes)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._bytes = 0

    # internals

    def _confine(self, path: Path) -> Path:
        target = path.resolve()
        if not any(target.is_relative_to(root) for root in self._roots):
            raise FileAccessError(f"{path.name} is outside the terminal's read roots")
        if target.suffix.lower() in REFUSED_SUFFIXES:
            raise FileAccessError(f"{target.name}: price files are read only through the OOS gate")
        if target.exists() and not target.is_file():
            raise FileAccessError(f"{target.name} is not a regular file")
        return target

    def _read_bytes(self, target: Path) -> bytes:
        return target.read_bytes()

    def _stat_key(self, target: Path) -> tuple[int, int]:
        stat = target.stat()
        if stat.st_size > self._max_file_bytes:
            raise FileAccessError(f"{target.name} is {stat.st_size} bytes, over the {self._max_file_bytes} cap")
        return stat.st_mtime_ns, stat.st_size

    def _load(self, target: Path, parser: Callable[[bytes], T]) -> tuple[T, tuple[int, int] | None]:
        """Read and parse, retrying once on a decode error; also returns the stat key if it held still."""
        for attempt in (1, 2):
            before = self._stat_key(target)
            raw = self._read_bytes(target)
            after = self._stat_key(target)
            try:
                value = parser(raw)
            except ValueError as exc:
                if attempt == 2:
                    raise FileDecodeError(target, exc) from exc
                with self._lock:
                    self._retries += 1
                self._sleep(self._retry_delay_s)
                continue
            return value, (before if before == after else None)
        raise AssertionError("unreachable")  # pragma: no cover

    def _lookup(self, key: tuple[str, str], mtime_ns: int, size: int) -> _Entry | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and (entry.mtime_ns, entry.size) == (mtime_ns, size):
                self._entries.move_to_end(key)
                self._hits += 1
                return entry
            self._misses += 1
            return None

    def _drop(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._pop_locked(key)

    def _pop_locked(self, key: tuple[str, str]) -> None:
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._bytes -= entry.size

    def _store(self, key: tuple[str, str], entry: _Entry) -> None:
        """Replace, insert and evict under one lock, so two threads storing one key count it once."""
        with self._lock:
            self._pop_locked(key)
            if entry.size > self._max_bytes:
                return
            self._entries[key] = entry
            self._bytes += entry.size
            while len(self._entries) > self._max_entries or self._bytes > self._max_bytes:
                _, old = self._entries.popitem(last=False)
                self._bytes -= old.size


def file_cache(cap: int | None, *, roots: Iterable[Path], max_bytes: int = DEFAULT_MAX_BYTES, **options: Any) -> FileCache:
    """A FileCache that honours the settings' cap (`settings.file_cache_bytes`: 128 MiB in desktop mode, None in the
    browser terminal). A cache that asks for less than the cap keeps its own smaller size."""
    return FileCache(roots=roots, max_bytes=min(max_bytes, cap) if cap else max_bytes, **options)
