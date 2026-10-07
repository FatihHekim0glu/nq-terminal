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

No price read: the groups read result files only.
"""
from __future__ import annotations

import json
import os
import zlib
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from nq_terminal.services.files import freeze
from nq_terminal.services.result_cache import ResultCache

GROUPS = 8  # a change re-reads an eighth of the runs; each group is one disk write on a first launch
ROUTE = "/api/runs#views"  # the groups' route name in their own cache; never served
MEMORY_BYTES = 16 * 1024**2
VIEW, ERROR = "view", "error"

View = Mapping[str, Any] | str  # a summary view, or the text of the error that made the run unreadable


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


def _load(body: bytes) -> dict[str, View]:
    rows = json.loads(body.decode("utf-8"))
    return {run_id: row[ERROR] if ERROR in row else freeze(row[VIEW]) for run_id, row in rows.items()}


class RunViewIndex:
    """The summary views of a data root's runs, in groups kept by a result cache on `state_dir` (thread safe)."""

    def __init__(self, *, state_dir: Path, data_root: Path):
        scope = os.path.normcase(str(Path(data_root).resolve()))
        self.cache = ResultCache(state_dir=Path(state_dir), memory_bytes=MEMORY_BYTES, persist_routes=(ROUTE,),
                                 scope=scope)

    def disk_name(self, query: Mapping[str, Any]) -> str:
        """The file name of a group's entry in the cache folder."""
        return self.cache.disk_name(ROUTE, query)

    def views(self, entries: Sequence[Any], read: Callable[[Any], View]) -> dict[str, View]:
        """run id -> view for every entry (`read(entry)` for each run of a group that must be built)."""
        by_id = {entry.run_id: entry for entry in entries}
        out: dict[str, View] = {}
        for query in bucket_queries(by_id).values():
            out.update(self._group(query, by_id, read))
        return out

    def _group(self, query: dict[str, Any], by_id: Mapping[str, Any], read: Callable[[Any], View]) -> dict[str, View]:
        built: dict[str, View] = {}

        def compute() -> bytes:
            built.clear()
            built.update((run_id, read(by_id[run_id])) for run_id in query["runs"])
            return _dump(built)

        body = self.cache.get(ROUTE, query, compute, price_free=True)
        return dict(built) if built else _load(body)
