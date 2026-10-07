"""Result cache for slow routes (03 item 1.2a and section 5; 02 sections 4.1 item 1 and 7.2; 04 D1.2).

Key. The route, the normalised query (`normalise_query`), the scope (the data root the app reads, so two roots that share
a state folder never answer each other) and the frozen set of `Input(path, mtime_ns, size)` of every input the
computation read. The inputs are recorded by a read hook: `FileCache` (services/files.py) calls
`record_file` on every read (a hit too) and the bar service (services/bars.py) calls `record_gate_read` on every
frame it hands out, keyed on the processed file's (mtime_ns, size) from the catalogue. The hook writes into a
recorder held in a contextvar, so only reads made by the computation's own thread (or a thread run in a copied
context) are recorded. A lookup re-checks every recorded input against the disk (and the catalogue for bar
inputs), so a rewrite that changes the mtime or the size misses (T05: a rewrite of the same size that also
restores the mtime cannot be seen). A folder recorded with `record_input` (a listing, such as the run index) is
pinned on its mtime and a digest of its sorted entry names.

Nesting. A cached call made inside another cached computation hands its inputs, and whether it was price-derived
or could not be pinned, to the enclosing computation, whether its body came from memory, disk or a fresh run.

What is never cached: a body marked clock-dependent; a computation that recorded no input at all, or a read it
could not pin (a file that changed while it was read, a bar read without a catalogue version); a failed
computation. A cache hit runs nothing: no serve call, no gate line.

Process-wide serve counter. `bump_serve_count` is called by the bar service on every frame (entry and exit) and
by the serve wrapper `bars.counted_serve` around every serve, from any thread. A computation whose counter
reading moved between its start and its end overlapped a gated read somewhere in the process, perhaps its own in a
worker thread that the contextvar cannot see.

A route that cannot read prices at all (deflated, the ledger) passes `price_free=True` to `get`: the counter is then
ignored for it, because on a first launch HOME's price requests overlap those computations and would otherwise keep
every one of them off disk. Its own recorder (a gated read in its own context, a gate input) still keeps it off.

Memory. Serialised bodies, least recently used, at most `MEMORY_BYTES` (64 MiB) in total.

Disk, fail closed (02 section 4.1). An entry is written under `<state_dir>/cache/` only when its route is on
`PERSIST_ROUTES` AND the computation recorded no gated read AND the process-wide serve counter did not move
during it AND every input is a plain file. So nothing price-derived reaches the disk, and each backend process
still logs its first gated read of each window. At most `DISK_BYTES` (64 MiB), least recently used by file mtime;
written atomically (a temporary file, then `os.replace`); a disk entry is re-validated against every input's
(path, mtime_ns, size) and the stored key before use, and discarded when anything differs or the body's sha256
does not match. Every disk entry also carries the code stamp (`code_stamp`: the terminal version and a hash of
every source file of the package) of the process that wrote it, and an entry from another stamp is discarded, so
an update or a fixed function never serves a body computed by the old code. Every disk write goes through
`_cache_file`/`_cache_folder`, which confine the path to the cache folder; `test_safety_ast.py` allows writes in
this module only on names bound by those two calls.

Single-flight (04 D1.3). The first request for a key that finds neither memory nor disk leads: it computes, stores
and releases. A request for the same key that arrives meanwhile (another request, or the HOME prewarm) waits for the
leader and takes its body, so there is one computation, one serve call and one gate line. A leader that fails with an
ordinary exception hands that exception to its waiters (nothing is stored); a leader interrupted by anything else
(a `BaseException` that is not an `Exception`) leaves its waiters to run the work again. A computation that asks for
its own key from inside itself computes directly instead of waiting for itself. Different keys never wait.

The eight routes (`CACHED_ROUTES`, 03 item 1.2b) call `get` through module-level callables of their routers
(`cached_two_day`, `cached_compare`, ...), so a route and the prewarm share one key. `json_body` serialises a response
model the way the framework does, so a cached body is byte-equal to a fresh one. Live and clock-dependent routes do
not appear here and never call the cache.
"""
from __future__ import annotations

import contextvars
import functools
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from stat import S_ISDIR
from typing import Any, Callable, Iterable, Mapping

LOG = logging.getLogger(__name__)

MEMORY_BYTES = 64 * 1024**2
DISK_BYTES = 64 * 1024**2
CACHE_FOLDER = "cache"
PERSIST_ROUTES: frozenset[str] = frozenset({"/api/analytics/deflated", "/api/runs", "/api/ledger", "/api/hypotheses"})
ROUTE_COMPARE = "/api/runs/compare"
ROUTE_LEDGER = "/api/ledger"
ROUTE_TWO_DAY = "/api/market/two-day"
ROUTE_HYPOTHESIS_BOOTSTRAP = "/api/analytics/hypothesis/{name}/bootstrap"
ROUTE_RUN_BOOTSTRAP = "/api/analytics/run/{run_id}/bootstrap"
ROUTE_DEFLATED = "/api/analytics/deflated"
ROUTE_SEASONALITY = "/api/seasonality/instrument/{root}"
ROUTE_SPA = "/api/analytics/spa"
ROUTE_RUNS = "/api/runs"  # the run index: on the persist list since D1, cached since DEC1 (HOME asks for it every launch)
CACHED_ROUTES: frozenset[str] = frozenset({ROUTE_COMPARE, ROUTE_LEDGER, ROUTE_TWO_DAY, ROUTE_HYPOTHESIS_BOOTSTRAP,
                                           ROUTE_RUN_BOOTSTRAP, ROUTE_DEFLATED, ROUTE_SEASONALITY, ROUTE_SPA,
                                           ROUTE_RUNS})
STATE_KEY = "result_cache"  # the attribute of `app.state` that holds the app's cache
JSON_MEDIA_TYPE = "application/json"
GATE_PREFIX = "gate:"
MISSING = -1  # mtime_ns and size of an input that did not exist when it was read
UNREADABLE = -2  # what a lookup sees for an input it cannot stat (never recorded, so it never matches)
FORMAT = 2
DISK_SUFFIX = ".bin"
TMP_SUFFIX = ".tmp"
DISK_NAME = re.compile(r"[0-9a-f]{64}(?:\.[0-9a-f]{32}\.tmp|\.bin)")
RESEARCH_DIRS = (("results",), ("data",), ("live",), ("backtests", "output"))

GateVersion = Callable[[str, str, str], "tuple[int, int] | None"]


class ResultCacheError(RuntimeError):
    """A cache path would leave the cache folder, or the folder sits where the terminal never writes."""


@dataclass(frozen=True, order=True)
class Input:
    path: str  # a normalised file path, or GATE_PREFIX + "symbol|timeframe|variant"
    mtime_ns: int
    size: int


@dataclass(frozen=True)
class ResultCacheStats:
    hits: int
    disk_hits: int
    misses: int
    uncached: int
    disk_writes: int
    entries: int
    bytes: int
    waited: int = 0  # requests that waited for a computation of their key that was already running


# ---------------------------------------------------------------- the process-wide serve counter


class _Counter:
    def __init__(self) -> None:
        self._value = 0
        self._lock = threading.Lock()

    def bump(self) -> None:
        with self._lock:
            self._value += 1

    def value(self) -> int:
        with self._lock:
            return self._value


_SERVES = _Counter()


def bump_serve_count() -> None:
    """Called by the bar service and the serve wrapper on every gated read, from any thread."""
    _SERVES.bump()


def serve_count() -> int:
    return _SERVES.value()


# ---------------------------------------------------------------- the read hook


@dataclass
class _Recorder:
    inputs: set[Input] = field(default_factory=set)
    gated: bool = False
    unpinned: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, item: Input | None, *, gated: bool = False) -> None:
        with self.lock:
            self.gated = self.gated or gated
            if item is None:
                self.unpinned = True
            else:
                self.inputs.add(item)

    def merge(self, inputs: Iterable[Input], *, gated: bool, unpinned: bool) -> None:
        with self.lock:
            self.inputs.update(inputs)
            self.gated = self.gated or gated
            self.unpinned = self.unpinned or unpinned


_RECORDER: contextvars.ContextVar[_Recorder | None] = contextvars.ContextVar("nqt_result_cache_recorder",
                                                                             default=None)


def _norm(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(path)))


def _listing_digest(path: str) -> int:
    """A folder's 'size': a digest of its sorted entry names (its mtime can repeat within one clock tick)."""
    names = "\n".join(sorted(os.listdir(path)))
    return int(hashlib.sha256(names.encode("utf-8", "surrogatepass")).hexdigest()[:15], 16)


def _stat(path: str) -> tuple[int, int]:
    """(mtime_ns, size) of a file, (mtime_ns, listing digest) of a folder, or MISSING twice."""
    try:
        stat = os.stat(path)
        if S_ISDIR(stat.st_mode):
            return stat.st_mtime_ns, _listing_digest(path)
    except (FileNotFoundError, NotADirectoryError):
        return MISSING, MISSING
    except OSError:
        return UNREADABLE, UNREADABLE  # never equal to a recorded read, so the entry misses
    return stat.st_mtime_ns, stat.st_size


def record_file(path: Path | str, mtime_ns: int, size: int) -> None:
    """A file the current computation read, with the (mtime_ns, size) it had when read."""
    recorder = _RECORDER.get()
    if recorder is not None:
        recorder.add(Input(_norm(path), int(mtime_ns), int(size)))


def record_missing(path: Path | str) -> None:
    """A file the current computation looked for and did not find; its later arrival invalidates the result."""
    record_file(path, MISSING, MISSING)


def record_unstable(path: Path | str) -> None:
    """A file that changed while it was read: the result cannot be pinned, so it is not cached."""
    recorder = _RECORDER.get()
    if recorder is not None:
        recorder.add(None)


def record_input(path: Path | str) -> None:
    """Any path (a folder too) read by other means than FileCache, recorded with its current stat."""
    mtime_ns, size = _stat(_norm(path))
    record_file(path, mtime_ns, size)


def record_gate_read(symbol: str, timeframe: str, variant: str, version: tuple[int, int] | None) -> None:
    """A frame served through the gate (or from the bar cache) for the current computation."""
    bump_serve_count()
    recorder = _RECORDER.get()
    if recorder is None:
        return
    item = None if version is None else Input(f"{GATE_PREFIX}{symbol}|{timeframe}|{variant}", *map(int, version))
    recorder.add(item, gated=True)


def _pass_up(inputs: Iterable[Input] = (), *, gated: bool = False, unpinned: bool = False) -> None:
    """A cached call made inside another cached computation hands its inputs and flags to the enclosing one, by
    whatever path its body came (memory, disk, computed, uncached): a hit records no read and moves no counter."""
    recorder = _RECORDER.get()
    if recorder is not None:
        recorder.merge(inputs, gated=gated, unpinned=unpinned)


# ---------------------------------------------------------------- keys


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return repr(value)  # exact, and never equal to the int or str spelling
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    raise TypeError(f"a cached route query may hold only plain values, not {type(value).__name__}")


def normalise_query(query: Mapping[str, Any] | None) -> str:
    """The query as canonical JSON: keys sorted, list order kept, types kept apart ({"a": 1} != {"a": "1"})."""
    plain = _plain(dict(query or {}))
    return json.dumps(plain, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def compute_code_stamp(package_dir: Path, version: str) -> str:
    """A digest of the version and of every `.py` file under `package_dir` (names and bytes, sorted)."""
    digest = hashlib.sha256(f"nq_terminal {version}".encode("utf-8"))
    for source in sorted(package_dir.rglob("*.py"), key=lambda p: p.relative_to(package_dir).as_posix()):
        digest.update(source.relative_to(package_dir).as_posix().encode("utf-8") + b"|")
        try:
            digest.update(hashlib.sha256(source.read_bytes()).digest())
        except OSError:
            digest.update(b"unreadable")  # an unreadable source still changes the stamp from a readable one
    return digest.hexdigest()


@functools.lru_cache(maxsize=1)
def code_stamp() -> str:
    """The stamp of the running terminal code, computed once per process."""
    from nq_terminal import __version__

    return compute_code_stamp(Path(__file__).resolve().parents[1], __version__)


def json_body(model: Any) -> bytes:
    """A response model as the framework serialises it (by alias, compact), so a cached body equals a fresh one."""
    return model.model_dump_json(by_alias=True).encode("utf-8")


def cache_for(state: Any, gate_version: GateVersion | None = None) -> "ResultCache":
    """The app's cache (`state.result_cache`), built once from `state.settings.state_dir` and scoped to its data root;
    `gate_version` (the catalogue's version of a served series) is bound at the first call."""
    cache = getattr(state, STATE_KEY, None)
    if cache is not None:
        return cache
    with _CACHE_BUILD:
        cache = getattr(state, STATE_KEY, None)
        if cache is None:
            cache = ResultCache(state_dir=state.settings.state_dir, gate_version=gate_version,
                                scope=os.path.normcase(str(Path(state.settings.data_root).resolve())))
            setattr(state, STATE_KEY, cache)
    return cache


_CACHE_BUILD = threading.Lock()


def _key_digest(route: str, query: str) -> str:
    return hashlib.sha256(json.dumps([route, query], ensure_ascii=True).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- the cache


@dataclass(frozen=True)
class _Entry:
    inputs: frozenset[Input]
    body: bytes
    gated: bool = False  # price-derived: made or overlapped a gated read (never true for a disk entry)


@dataclass(frozen=True)
class _Shared:
    """What a leader hands to its waiters: the body, and what an enclosing computation must learn from it."""

    body: bytes
    inputs: frozenset[Input]
    gated: bool
    unpinned: bool


class _Flight:
    """One running computation of one key. The leader finishes it exactly once; waiters block on `done`."""

    def __init__(self, owner: int):
        self.owner = owner  # the leader's thread, so the same thread never waits for itself
        self.done = threading.Event()
        self.shared: _Shared | None = None
        self.error: Exception | None = None

    def finish(self, shared: _Shared) -> None:
        self.shared = shared
        self.done.set()

    def fail(self, error: BaseException) -> None:
        self.error = error if isinstance(error, Exception) else None  # an interruption leaves the work to a waiter
        self.done.set()


@dataclass(frozen=True)
class _Outcome:
    inputs: frozenset[Input]
    gated: bool
    unpinned: bool
    quiet: bool  # the process-wide serve counter did not move during the computation

    @property
    def price_derived(self) -> bool:
        return self.gated or not self.quiet or any(i.path.startswith(GATE_PREFIX) for i in self.inputs)

    @property
    def cacheable(self) -> bool:
        return not self.unpinned and bool(self.inputs)


class ResultCache:
    """The cache (see the module docstring). Thread safe; one per app."""

    def __init__(self, *, state_dir: Path | None, memory_bytes: int = MEMORY_BYTES, disk_bytes: int = DISK_BYTES,
                 persist_routes: Iterable[str] = PERSIST_ROUTES, gate_version: GateVersion | None = None,
                 stamp: str | None = None, scope: str = ""):
        if memory_bytes <= 0 or disk_bytes <= 0:
            raise ValueError("the result cache bounds must be positive")
        self._state_dir = None if state_dir is None else Path(state_dir)
        self._memory_cap, self._disk_cap = memory_bytes, disk_bytes
        self._persist = frozenset(persist_routes)
        self._gate_version = gate_version
        self._stamp = code_stamp() if stamp is None else stamp
        self._scope = scope
        self._entries: OrderedDict[tuple[str, str], _Entry] = OrderedDict()
        self._bytes = 0
        self._counts = {"hits": 0, "disk_hits": 0, "misses": 0, "uncached": 0, "disk_writes": 0, "waited": 0}
        self._lock = threading.Lock()
        self._flights: dict[tuple[str, str], _Flight] = {}
        self._swept = False

    # public API

    def get(self, route: str, query: Mapping[str, Any] | None, compute: Callable[[], bytes], *,
            clock_dependent: bool = False, price_free: bool = False) -> bytes:
        """The body for (route, query): from memory, then disk, else computed (and cached when the rules allow).

        `price_free` is the caller's assertion that the computation cannot read prices at all (no bar service, no
        serve call, in any thread). Such a computation is not kept off disk because some other request served bars
        meanwhile; its own recorder still catches a gated read made in its own context."""
        if clock_dependent:
            self._count("uncached")
            _pass_up(unpinned=True)  # its reads already land in the enclosing recorder: compute runs in its context
            return self._checked(compute())
        key = self._key(route, query)
        while True:
            entry = self._lookup(key)
            if entry is not None:
                _pass_up(entry.inputs, gated=entry.gated)
                return entry.body
            flight, leader = self._join(key)
            if leader:
                return self._lead(key, flight, compute, price_free)
            if flight.owner == threading.get_ident():  # asked for from inside its own computation: never wait
                self._count("uncached")
                _pass_up(unpinned=True)
                return self._checked(compute())
            self._count("waited")
            shared = self._wait(flight)
            if shared is not None:
                _pass_up(shared.inputs, gated=shared.gated, unpinned=shared.unpinned)
                return shared.body
            # the leader was interrupted: ask again, and lead if nobody else has

    def _lookup(self, key: tuple[str, str]) -> _Entry | None:
        entry = self._from_memory(key)
        if entry is None and self._persists(key[0]):
            entry = self._from_disk(key)
        return entry

    def _join(self, key: tuple[str, str]) -> tuple[_Flight, bool]:
        """(the running computation of `key`, False) for a waiter, or (a new one, True) for the leader."""
        with self._lock:
            flight = self._flights.get(key)
            if flight is not None:
                return flight, False
            flight = _Flight(threading.get_ident())
            self._flights[key] = flight
            return flight, True

    def _leave(self, key: tuple[str, str], flight: _Flight) -> None:
        with self._lock:
            if self._flights.get(key) is flight:
                del self._flights[key]

    @staticmethod
    def _wait(flight: _Flight) -> _Shared | None:
        flight.done.wait()
        if flight.error is not None:
            raise flight.error
        return flight.shared

    def _lead(self, key: tuple[str, str], flight: _Flight, compute: Callable[[], bytes],
              price_free: bool = False) -> bytes:
        try:
            entry = self._lookup(key)  # another leader may have stored it between our lookup and our join
            if entry is not None:
                shared = _Shared(entry.body, entry.inputs, entry.gated, False)
            else:
                shared = self._compute_and_keep(key, compute, price_free)
        except BaseException as exc:
            self._leave(key, flight)
            flight.fail(exc)
            _pass_up(unpinned=True)  # an enclosing computation that catches this cannot pin what it saw
            raise
        self._leave(key, flight)  # after the entry is stored, so a later request finds it and does not lead again
        flight.finish(shared)
        _pass_up(shared.inputs, gated=shared.gated, unpinned=shared.unpinned)
        return shared.body

    def _compute_and_keep(self, key: tuple[str, str], compute: Callable[[], bytes],
                          price_free: bool = False) -> _Shared:
        self._count("misses")
        body, outcome = self._compute(compute, price_free)
        self._keep(key, body, outcome)
        return _Shared(body, outcome.inputs, outcome.price_derived, not outcome.cacheable)

    def _key(self, route: str, query: Mapping[str, Any] | None) -> tuple[str, str]:
        text = normalise_query(query)
        return route, f"{self._scope}|{text}" if self._scope else text

    def disk_name(self, route: str, query: Mapping[str, Any] | None) -> str:
        return _key_digest(*self._key(route, query)) + DISK_SUFFIX

    def stats(self) -> ResultCacheStats:
        with self._lock:
            return ResultCacheStats(**self._counts, entries=len(self._entries), bytes=self._bytes)

    def clear(self) -> None:
        """Forget the memory entries (the disk entries stay; each is re-validated before use)."""
        with self._lock:
            self._entries.clear()
            self._bytes = 0

    # computing

    @staticmethod
    def _checked(body: Any) -> bytes:
        if not isinstance(body, bytes):
            raise TypeError(f"a cached computation must return the serialised body as bytes, not {type(body).__name__}")
        return body

    def _compute(self, compute: Callable[[], bytes], price_free: bool = False) -> tuple[bytes, _Outcome]:
        recorder = _Recorder()
        token = _RECORDER.set(recorder)
        before = serve_count()
        try:
            body = self._checked(compute())
        finally:
            _RECORDER.reset(token)
        quiet = price_free or serve_count() == before  # a price-free route ignores serves made elsewhere
        with recorder.lock:
            outcome = _Outcome(frozenset(recorder.inputs), recorder.gated, recorder.unpinned, quiet)
        return body, outcome

    def _keep(self, key: tuple[str, str], body: bytes, outcome: _Outcome) -> None:
        if not outcome.cacheable:
            self._count("uncached")
            return
        self._store(key, _Entry(outcome.inputs, body, outcome.price_derived))
        if not outcome.price_derived and self._persists(key[0]):
            self._write_disk(key, outcome.inputs, body)

    # validation

    def _current(self, item: Input) -> tuple[int, int] | None:
        if not item.path.startswith(GATE_PREFIX):
            return _stat(item.path)
        if self._gate_version is None:
            return None
        symbol, timeframe, variant = item.path[len(GATE_PREFIX):].split("|")
        try:
            version = self._gate_version(symbol, timeframe, variant)
        except Exception:  # noqa: BLE001 - a catalogue that cannot answer means the input cannot be re-validated
            LOG.exception("the result cache could not read the catalogue version of %s", item.path)
            return None
        return None if version is None else (int(version[0]), int(version[1]))

    def _valid(self, inputs: Iterable[Input]) -> bool:
        return all(self._current(i) == (i.mtime_ns, i.size) for i in inputs)

    # memory

    def _count(self, name: str) -> None:
        with self._lock:
            self._counts[name] += 1

    def _from_memory(self, key: tuple[str, str]) -> _Entry | None:
        with self._lock:
            entry = self._entries.get(key)
        if entry is None:
            return None
        if not self._valid(entry.inputs):
            with self._lock:
                if self._entries.get(key) is entry:
                    self._pop_locked(key)
            return None
        with self._lock:
            if key in self._entries:
                self._entries.move_to_end(key)
            self._counts["hits"] += 1
        return entry

    def _pop_locked(self, key: tuple[str, str]) -> None:
        old = self._entries.pop(key, None)
        if old is not None:
            self._bytes -= len(old.body)

    def _store(self, key: tuple[str, str], entry: _Entry) -> None:
        with self._lock:
            self._pop_locked(key)
            if len(entry.body) > self._memory_cap:
                return
            self._entries[key] = entry
            self._bytes += len(entry.body)
            while self._bytes > self._memory_cap and self._entries:
                _, old = self._entries.popitem(last=False)
                self._bytes -= len(old.body)

    # disk: every write below targets a name bound by _cache_file or _cache_folder (test_safety_ast.py)

    def _persists(self, route: str) -> bool:
        return self._state_dir is not None and route in self._persist

    def _cache_folder(self) -> Path:
        """<state_dir>/cache, resolved; refused when it resolves into a research folder or outside the state."""
        if self._state_dir is None:
            raise ResultCacheError("the result cache has no state folder")
        from nq_lab.config import ROOT

        state = self._state_dir.resolve()
        folder = (state / CACHE_FOLDER).resolve()
        root = ROOT.resolve()
        if folder.parent != state or any(folder.is_relative_to(root.joinpath(*parts)) for parts in RESEARCH_DIRS):
            raise ResultCacheError(f"the result cache folder may not be {folder}")
        return folder

    def _cache_file(self, name: str) -> Path:
        """A file directly inside the cache folder, named by a key digest; anything else is refused."""
        if not isinstance(name, str) or DISK_NAME.fullmatch(name) is None:
            raise ResultCacheError(f"not a result cache file name: {name!r}")
        folder = self._cache_folder()
        path = folder / name
        if path.resolve().parent != folder:
            raise ResultCacheError(f"the result cache file {name} resolves outside {folder}")
        return path

    def _from_disk(self, key: tuple[str, str]) -> _Entry | None:
        try:
            target = self._cache_file(_key_digest(*key) + DISK_SUFFIX)
            raw = target.read_bytes()
        except FileNotFoundError:
            return None
        except (OSError, ResultCacheError) as exc:
            LOG.warning("the result cache could not read a disk entry: %s", exc)
            return None
        parsed = _parse_disk(raw, key, self._stamp)
        if parsed is None or not self._valid(parsed.inputs):
            self._discard(target.name)
            return None
        self._store(key, parsed)
        self._touch(target.name)
        self._count("disk_hits")
        return parsed

    def _discard(self, name: str) -> None:
        try:
            target = self._cache_file(name)
            target.unlink(missing_ok=True)
        except (OSError, ResultCacheError) as exc:
            LOG.warning("the result cache could not discard %s: %s", name, exc)

    def _touch(self, name: str) -> None:
        """Mark an entry as the most recently used: an mtime newer than every other entry's (ticks can repeat)."""
        try:
            folder = self._cache_folder()
            newest = max((s.st_mtime_ns for _, s in _stats(folder)), default=0)
            stamp = max(time.time_ns(), newest + 1)
            target = self._cache_file(name)
            os.utime(target, ns=(stamp, stamp))
        except (OSError, ResultCacheError) as exc:
            LOG.warning("the result cache could not mark %s as used: %s", name, exc)

    def _write_disk(self, key: tuple[str, str], inputs: frozenset[Input], body: bytes) -> None:
        payload = _disk_bytes(key, inputs, body, self._stamp)
        if len(payload) > self._disk_cap:
            return
        digest = _key_digest(*key)
        try:
            self._prepare_folder()
            tmp = self._cache_file(f"{digest}.{uuid.uuid4().hex}{TMP_SUFFIX}")
            final = self._cache_file(digest + DISK_SUFFIX)
            with open(tmp, "xb") as handle:
                handle.write(payload)
            os.replace(tmp, final)
        except (OSError, ResultCacheError) as exc:
            LOG.warning("the result cache could not write a disk entry: %s", exc)
            return
        self._count("disk_writes")
        self._touch(final.name)
        self._evict_disk(keep=final.name)

    def _prepare_folder(self) -> None:
        folder = self._cache_folder()
        folder.mkdir(parents=True, exist_ok=True)
        if not self._swept:
            self._swept = True
            for name in _names(folder):
                if name.endswith(TMP_SUFFIX):
                    self._discard(name)

    def _evict_disk(self, keep: str) -> None:
        """Remove the least recently used entries until the folder holds at most the disk cap."""
        folder = self._cache_folder()
        sized = [(s.st_mtime_ns, name, s.st_size) for name, s in _stats(folder)]
        total = sum(size for _, _, size in sized)
        for _, name, size in sorted(sized):
            if total <= self._disk_cap:
                break
            if name != keep:
                self._discard(name)
                total -= size


def _names(folder: Path) -> list[str]:
    try:
        return sorted(p.name for p in folder.iterdir() if DISK_NAME.fullmatch(p.name) and p.is_file())
    except OSError:
        return []


def _stats(folder: Path) -> list[tuple[str, os.stat_result]]:
    """(name, stat) of each cache file in the folder; a file that vanished meanwhile is left out."""
    out = []
    for name in _names(folder):
        try:
            out.append((name, (folder / name).stat()))
        except OSError:
            continue
    return out


def _disk_bytes(key: tuple[str, str], inputs: frozenset[Input], body: bytes, stamp: str) -> bytes:
    header = {"format": FORMAT, "stamp": stamp, "route": key[0], "query": key[1],
              "inputs": [[i.path, i.mtime_ns, i.size] for i in sorted(inputs)],
              "sha256": hashlib.sha256(body).hexdigest(), "length": len(body)}
    return json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("utf-8") + b"\n" + body


def _parse_disk(raw: bytes, key: tuple[str, str], stamp: str) -> _Entry | None:
    """The stored entry, or None when the file is damaged, from another format, code stamp or key."""
    head, sep, body = raw.partition(b"\n")
    if not sep:
        return None
    try:
        header = json.loads(head.decode("utf-8"))
        inputs = frozenset(Input(str(p), int(m), int(s)) for p, m, s in header["inputs"])
        ok = (header["format"] == FORMAT and header["stamp"] == stamp and (header["route"], header["query"]) == key
              and header["length"] == len(body) and header["sha256"] == hashlib.sha256(body).hexdigest())
    except (ValueError, KeyError, TypeError):
        return None
    if not ok or not inputs or any(i.path.startswith(GATE_PREFIX) for i in inputs):
        return None
    return _Entry(inputs, body)
