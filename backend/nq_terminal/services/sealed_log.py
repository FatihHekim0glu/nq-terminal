"""The sealed-log pin for /api/health from the appended tail of the gate log (V032G, growth fix 1).

/api/health reports whether the gate log's sealed lines still match their pin. The gate's own check
(`oos_gate.check_sealed_log_pin`) re-parses the whole log, which only grows (43 MB and 0.3 s a call on 7 October 2026,
and the page polls every 2 s). A `SealedLogTracker` on `app.state` keeps a `SealedLogCursor` instead
(services/gate_cursor.py): `scan_sealed_log` re-hashes the bytes before the cursor (any edit, truncation or shrink
there forces a full pass) and parses only what follows with the gate's own `parse_log` and `check_fragments`, so every
answer is the whole-file answer, refusals included.

Memo. `remember` returns the last answer while every file it names keeps its (mtime_ns, size, file id); the health
route names the log and the openings file. As for the result cache (T05), an edit inside one file that keeps its size
and restores its mtime cannot be seen.

Persistence. The cursor is kept under <state>/cache by a result cache of its own (the pattern of the run index in
services/run_views.py): its own route name, scope (the data root, so two roots that share a state folder never use each
other's cursor) and code stamp, written only through that module's confined writer, and pinned on the gate's source
file, so a change to the gate's rules drops it. It is written once the committed part of the log reaches
`PERSIST_STEP_BYTES`, then again after each further step of growth or after a full pass, so a small log (the fixtures)
never writes the state folder and a busy log is not rewritten on every poll. A stored cursor that is damaged, from
another root, other code, or for a log whose prefix changed is ignored, and the next read is a full pass.

Trust. A stored cursor's sealed lines and refused fragment are trusted once its prefix hash matches the log, and the
result cache's header sha256 has no key, so an edited cursor would make the pin read as fine. The body is therefore
stored sealed to the signed-in user (services/user_seal.py, the Windows data protection API with `SEAL_PURPOSE`): a
body that does not open (edited, forged, from another user) is ignored like a damaged file, and where sealing is not
available nothing is stored.

No price read; no write outside <state>/cache.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Iterable, Mapping, TypeVar

from nq_terminal.services import gate_cursor, user_seal
from nq_terminal.services.result_cache import Input, ResultCache

ROUTE = "/api/health#sealed-log-cursor"  # the cursor's route name in its own cache; never served
SEAL_PURPOSE = b"nq-terminal sealed-log cursor v1"  # a stored body opens only for this purpose
STATE_KEY = "sealed_log_tracker"  # the attribute of `app.state` that holds the app's tracker
PERSIST_STEP_BYTES = 1024**2  # read at call time: a store is written per step of committed growth
MEMORY_BYTES = 1024**2

T = TypeVar("T")
FileState = tuple[int, int, int] | None  # (mtime_ns, size, file id), or None for a missing file


def _gate() -> ModuleType:
    """`nq_lab.oos_gate`, imported on first use so the start path does not load it (D1.1)."""
    from nq_lab import oos_gate

    return oos_gate


def gate_source() -> Path:
    """The gate's source file: a stored cursor is pinned on it (the cursor follows its `parse_log` and
    `check_fragments`; this package's own code is covered by the result cache's code stamp)."""
    return Path(_gate().__file__)


def _norm(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(path)))


def _log_name(path: Path | str) -> str:
    """One name per log file, however it is spelt (a junction or a relative path reaches the same cursor)."""
    return os.path.normcase(str(Path(path).resolve()))


def _file_states(paths: Iterable[str]) -> tuple[FileState, ...] | None:
    """The state of every file, or None when one cannot be read (then nothing is memoised)."""
    states: list[FileState] = []
    for path in paths:
        try:
            stat = os.stat(path)
        except (FileNotFoundError, NotADirectoryError):
            states.append(None)
            continue
        except OSError:
            return None
        states.append((stat.st_mtime_ns, stat.st_size, stat.st_ino))
    return tuple(states)


class _CursorCache(ResultCache):
    """A result cache that holds one body per log and replaces it in place (a cursor moves while its pin holds), through
    the base class's own disk reader and confined writer."""

    def load(self, query: Mapping[str, Any]) -> bytes | None:
        entry = self._from_disk(self._key(ROUTE, query))
        return None if entry is None else entry.body

    def save(self, query: Mapping[str, Any], body: bytes, pins: frozenset[Input]) -> bool:
        """True when the entry was written."""
        before = self.stats().disk_writes
        self._write_disk(self._key(ROUTE, query), pins, body)
        return self.stats().disk_writes > before


class SealedLogTracker:
    """The app's cursor over each gate log it checks, and a memo of answers on file states (thread safe)."""

    def __init__(self, *, state_dir: Path | None, data_root: Path):
        scope = os.path.normcase(str(Path(data_root).resolve()))
        self._store = None if state_dir is None else _CursorCache(
            state_dir=Path(state_dir), memory_bytes=MEMORY_BYTES, persist_routes=(ROUTE,), scope=scope)
        self._lock = threading.Lock()
        self._memo_lock = threading.Lock()
        self._memo: dict[tuple[str, ...], tuple[tuple[FileState, ...], Any]] = {}
        self._cursors: dict[str, Any] = {}  # log -> its SealedLogCursor, or None before the first read
        self._stored: dict[str, int] = {}  # log -> the offset of the cursor on disk
        self.full_passes = 0
        self.writes = 0

    def remember(self, paths: Iterable[Path], compute: Callable[[], T]) -> T:
        """compute(), or its last answer while every file in `paths` keeps its state. One computation at a time."""
        names = tuple(_norm(p) for p in paths)
        with self._memo_lock:
            states = _file_states(names)  # read before computing, so a change during the computation is seen next time
            held = self._memo.get(names)
            if states is not None and held is not None and held[0] == states:
                return held[1]
            value = compute()
            if states is not None:
                self._memo[names] = (states, value)
            return value

    def check_pin(self, log_path: Path) -> None:
        """`oos_gate.check_sealed_log_pin(log_path)`: the same pass, the same refusal, from the cursor."""
        scan = self._advance(log_path)
        gate_cursor.check_sealed_digest_pin(scan.digest(log_path), log_path)

    def digest(self, log_path: Path) -> dict:
        """`oos_gate.sealed_log_digest(log_path)`, from the cursor."""
        return self._advance(log_path).digest(log_path)

    def _advance(self, log_path: Path) -> Any:
        name = _log_name(log_path)
        with self._lock:
            if name not in self._cursors:
                self._cursors[name] = self._load(name)
            scan = gate_cursor.scan_sealed_log(Path(log_path), self._cursors[name])
            self._cursors[name] = scan.cursor
            self.full_passes += int(scan.full_pass)
            self._persist(name, scan)
        return scan

    def _load(self, name: str) -> Any:
        if self._store is None:
            return None
        stored = self._store.load({"log": name})
        body = None if stored is None else user_seal.unseal(stored, SEAL_PURPOSE)
        if body is None:  # nothing stored, or a body that does not open: not trusted, so a full pass
            return None
        try:
            cursor = gate_cursor.SealedLogCursor.from_dict(json.loads(body.decode("utf-8")))
        except ValueError:  # not JSON, not UTF-8, or not a cursor
            return None
        self._stored[name] = cursor.offset
        return cursor

    def _persist(self, name: str, scan: Any) -> None:
        offset = scan.cursor.offset
        if self._store is None or offset < PERSIST_STEP_BYTES:
            return
        stored = self._stored.get(name)
        if stored is not None and not scan.full_pass and offset - stored < PERSIST_STEP_BYTES:
            return
        pins = _gate_pins()
        if pins is None:
            return
        plain = json.dumps(scan.cursor.as_dict(), ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        body = user_seal.seal(plain, SEAL_PURPOSE)
        if body is not None and self._store.save({"log": name}, body, pins):
            self._stored[name] = offset
            self.writes += 1


def _gate_pins() -> frozenset[Input] | None:
    path = _norm(gate_source())
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return frozenset({Input(path, stat.st_mtime_ns, stat.st_size)})


_BUILD = threading.Lock()


def tracker_for(state: Any) -> SealedLogTracker:
    """The app's tracker (`state.sealed_log_tracker`), built once from `state.settings`."""
    tracker = getattr(state, STATE_KEY, None)
    if tracker is not None:
        return tracker
    with _BUILD:
        tracker = getattr(state, STATE_KEY, None)
        if tracker is None:
            settings = state.settings
            tracker = SealedLogTracker(state_dir=settings.state_dir, data_root=settings.data_root)
            setattr(state, STATE_KEY, tracker)
    return tracker
