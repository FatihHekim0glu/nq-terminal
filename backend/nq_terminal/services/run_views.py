"""The run list's per-run index in the state folder's cache (V031B: later starts rebuild only what changed).

The run list (/api/runs) is one result-cache entry, pinned on every run file, the run folders and the ledger, so one
new, changed or removed run made a later start read every run's result.json again. Under it, the summary views
(`runs.parse_summary`) are kept here in `GROUPS` groups: a run belongs to group `crc32(run_id) % GROUPS`, and a group's
entry is keyed on the ids it holds and pinned on their result files. When the list must be rebuilt, a group whose runs
and files are unchanged comes from memory or disk; only the group of a run that was added, changed or removed is read
again (an eighth of the runs, not all of them).

The groups live in a result cache of their own (`services/result_cache.py`): its own route name and counters, the same
state folder (`<state>/cache`, written only through that module's confined writer), scope (the data root, so two roots
that share a state folder never answer each other), code stamp, validation and single-flight. So an index file that is
damaged, from another key, another root or older code is ignored and rebuilt, and a group that read an unreadable run
is never stored. A group passes the files it read up to the run list's own entry, as a file-cache read would.

A group's body is a JSON object, run id to `{"view": <summary view>}` or `{"error": <why it is unreadable>}`. A view
holds only what the sanitiser leaves (strings, finite floats, integers inside JavaScript's safe range, booleans, null,
lists and objects), so it comes back from JSON exactly as it went in.

The cache checks a file's header, length and sha256, not what the body means, so a body is validated where it is read: it
must be an object whose keys are exactly the group's ids, each row holding exactly one of an error text and a view
object, and each view carrying its run kind (`view[META]["kind"]`, which the run list reads). A body that is not is
dropped from memory and disk (`ResultCache.forget`), logged by file name only, and the group is read again from its
result files.

A summary read by the framed fast path (`run_head_scan`) never decodes the large members, so a result file that is
corrupt inside `trades`, `fills` or `strategy_log` is first listed as readable. When a detail or section read then fails
to decode it, `RunService` records the failure here under the file's (mtime_ns, size) (`note_unreadable`), and `views`
lists the run as unreadable, as before V031B, until the file changes. The record lives in memory: a restart lists the
run from its group file again until the next failing read.

No price read: the groups read result files only.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import zlib
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from nq_terminal.services.files import freeze
from nq_terminal.services.result_cache import ResultCache

LOG = logging.getLogger(__name__)

GROUPS = 8  # a change re-reads an eighth of the runs; each group is one disk write on a first launch
ROUTE = "/api/runs#views"  # the groups' route name in their own cache; never served
MEMORY_BYTES = 16 * 1024**2
VIEW, ERROR = "view", "error"
# The summary view's own marker and its run kinds (`runs.META`, `models.runs.RunKind`). runs imports this module, so the
# two spellings are pinned equal by a test instead of imported; the run list reads `view[META]["kind"]` of every row.
META = "__terminal_meta__"
KINDS = frozenset({"intraday", "sized", "book"})

View = Mapping[str, Any] | str  # a summary view, or the text of the error that made the run unreadable
FileKey = tuple[int, int]  # (mtime_ns, size) of a result file
# what a body that passes the cache's checksum but is not a group's body can raise while it is read
LOAD_ERRORS = (ValueError, KeyError, TypeError, AttributeError, RecursionError, UnicodeDecodeError)


def bucket_of(run_id: str) -> int:
    """The group a run belongs to (stable across processes and machines)."""
    return zlib.crc32(run_id.encode("utf-8")) % GROUPS


def bucket_queries(run_ids: Iterable[str]) -> dict[int, dict[str, Any]]:
    """The cache query of every group that holds at least one of `run_ids`: its number and its sorted ids."""
    groups: dict[int, list[str]] = {}
    for run_id in run_ids:
        groups.setdefault(bucket_of(run_id), []).append(run_id)
    return {group: {"group": group, "runs": sorted(ids)} for group, ids in sorted(groups.items())}


def _dump(views: Mapping[str, View]) -> bytes:
    rows = {run_id: ({ERROR: view} if isinstance(view, str) else {VIEW: view}) for run_id, view in views.items()}
    return json.dumps(rows, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def _row_view(row: Any) -> View:
    """One row of a group's body: exactly one of an error text or a view object, else ValueError."""
    if not isinstance(row, dict) or len(row) != 1:
        raise ValueError("a group row holds exactly one of a view and an error")
    if ERROR in row:
        if not isinstance(row[ERROR], str):
            raise ValueError("a group row's error is not text")
        return row[ERROR]
    view = row.get(VIEW)
    if not isinstance(view, dict):
        raise ValueError("a group row's view is not an object")
    meta = view.get(META)
    kind = meta.get("kind") if isinstance(meta, dict) else None
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValueError("a group row's view holds no run kind")
    return freeze(view)


def _load(body: bytes, expected_ids: Iterable[str]) -> dict[str, View]:
    """The views of a group's body; ValueError (or a decode error) unless it holds exactly the ids asked for."""
    rows = json.loads(body.decode("utf-8"))
    if not isinstance(rows, dict) or set(rows) != set(expected_ids):
        raise ValueError("a group body does not hold exactly the ids it was asked for")
    return {run_id: _row_view(row) for run_id, row in rows.items()}


def file_key(path: Path) -> FileKey | None:
    """(mtime_ns, size) of a file, or None when it cannot be read."""
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return stat.st_mtime_ns, stat.st_size


class RunViewIndex:
    """The summary views of a data root's runs, in groups kept by a result cache on `state_dir` (thread safe).

    A run whose summary came from the framed fast path (`run_head_scan`: the large members are never decoded) can still
    fail a full decode later, in a detail or section read. `note_unreadable` records that failure under the result
    file's (mtime_ns, size), and `views` then shows the run as unreadable, as before V031B, until the file changes."""

    def __init__(self, *, state_dir: Path, data_root: Path):
        scope = os.path.normcase(str(Path(data_root).resolve()))
        self.cache = ResultCache(state_dir=Path(state_dir), memory_bytes=MEMORY_BYTES, persist_routes=(ROUTE,),
                                 scope=scope)
        self._unreadable: dict[str, tuple[FileKey, str]] = {}
        self._notes = threading.Lock()

    def disk_name(self, query: Mapping[str, Any]) -> str:
        """The file name of a group's entry in the cache folder."""
        return self.cache.disk_name(ROUTE, query)

    def note_unreadable(self, run_id: str, key: FileKey, message: str) -> bool:
        """Record that a full decode of the run's result file (read as `key`) failed; True when that is news."""
        with self._notes:
            known = self._unreadable.get(run_id)
            self._unreadable[run_id] = (key, message)
        return known != (key, message)

    def unreadable_text(self, run_id: str, result: Path) -> str | None:
        """The recorded error of a run whose result file still has the recorded (mtime_ns, size), else None."""
        with self._notes:
            noted = self._unreadable.get(run_id)
        if noted is None:
            return None
        if file_key(result) == noted[0]:
            return noted[1]
        with self._notes:
            if self._unreadable.get(run_id) == noted:
                del self._unreadable[run_id]  # the file changed: the record no longer describes it
        return None

    def views(self, entries: Sequence[Any], read: Callable[[Any], View]) -> dict[str, View]:
        """run id -> view for every entry (`read(entry)` for each run of a group that must be built)."""
        by_id = {entry.run_id: entry for entry in entries}
        out: dict[str, View] = {}
        for query in bucket_queries(by_id).values():
            out.update(self._group(query, by_id, read))
        with self._notes:
            noted = [run_id for run_id in self._unreadable if run_id in by_id]
        for run_id in noted:
            text = self.unreadable_text(run_id, by_id[run_id].result)
            if text is not None:
                out[run_id] = text
        return out

    def _group(self, query: dict[str, Any], by_id: Mapping[str, Any], read: Callable[[Any], View]) -> dict[str, View]:
        built: dict[str, View] = {}

        def compute() -> bytes:
            built.clear()
            built.update((run_id, read(by_id[run_id])) for run_id in query["runs"])
            return _dump(built)

        body = self.cache.get(ROUTE, query, compute, price_free=True)
        if built:
            return dict(built)
        try:
            return _load(body, query["runs"])
        except LOAD_ERRORS as exc:
            # the file passed the cache's checks (format, stamp, key, length, sha256) but is not a group's body: drop
            # it from memory and disk, or every later request would raise the same error until the next start
            LOG.warning("run view group file %s is not a valid group body (%s); rebuilding it", self.disk_name(query),
                        type(exc).__name__)
            self.cache.forget(ROUTE, query)
        body = self.cache.get(ROUTE, query, compute, price_free=True)
        if built:
            return dict(built)
        try:
            return _load(body, query["runs"])
        except LOAD_ERRORS:  # another thread led the flight and its body is no better: read the group here, uncached
            compute()
            return dict(built)
