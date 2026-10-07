"""Registry freshness (V031): is `results/registry.md` older than the newest result or spec it is built from?

Read only: `os.scandir` and `stat`, no file is opened, nothing is written. Inputs are the `*.json` files directly in
`results/screens/` and `experiments/` (a subfolder such as `experiments/drafts/` is never entered, and a name holding
`.draft.` in any case is a draft and never counts). `stale` is true only when both times are known and the newest input
is newer than the registry report; a missing or unreadable file gives a null time, never an error and never `stale`.
Times are UTC to the second, in the form the other `*_utc` fields use; the comparison uses nanoseconds.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

__all__ = ["RegistryFreshness", "registry_freshness"]

REGISTRY_REPORT = ("results", "registry.md")  # written by the registry build beside registry.csv
FRESHNESS_INPUTS = (("results", "screens"), ("experiments",))  # their *.json files, not their subfolders
INPUT_SUFFIX = ".json"
DRAFT_MARK = ".draft."  # `<name>.DRAFT.json` and the like are drafts, in any case


@dataclass(frozen=True)
class RegistryFreshness:
    generated_at: str | None
    newest_input_at: str | None
    newest_input_path: str | None
    stale: bool


def _utc(mtime_ns: int) -> str:
    stamp = datetime.fromtimestamp(mtime_ns / 1e9, tz=timezone.utc)
    return stamp.isoformat(timespec="seconds").replace("+00:00", "Z")


def _mtime_ns(path: Path) -> int | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def _newest_input(root: Path) -> tuple[int, str] | None:
    """(mtime_ns, path under the root) of the newest screen or spec JSON; None when there is none. A subfolder
    (`experiments/drafts/`) is never entered and a draft name never counts; an unreadable entry is skipped."""
    newest: tuple[int, str] | None = None
    for parts in FRESHNESS_INPUTS:
        try:
            entries = list(os.scandir(root.joinpath(*parts)))
        except OSError:
            continue
        for entry in entries:
            name = entry.name
            if not name.lower().endswith(INPUT_SUFFIX) or DRAFT_MARK in name.lower():
                continue
            try:
                if not entry.is_file():
                    continue
                stamp = entry.stat().st_mtime_ns
            except OSError:
                continue
            candidate = (stamp, "/".join((*parts, name)))
            if newest is None or candidate > newest:
                newest = candidate
    return newest


def registry_freshness(root: Path) -> RegistryFreshness:
    """When the registry was last written and whether a screen or spec is newer (read only; never raises on a missing
    or unreadable file: an unknown time is null and never makes the registry stale)."""
    generated = _mtime_ns(Path(root).joinpath(*REGISTRY_REPORT))
    newest = _newest_input(Path(root))
    return RegistryFreshness(
        generated_at=None if generated is None else _utc(generated),
        newest_input_at=None if newest is None else _utc(newest[0]),
        newest_input_path=None if newest is None else newest[1],
        stale=generated is not None and newest is not None and newest[0] > generated,
    )
