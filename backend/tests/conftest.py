"""Shared test set-up for the terminal backend.

- Puts `terminal/backend` on `sys.path` so `nq_terminal` imports without touching nq-lab's packaging.
- Copies the opening's spec into the fixtures from the nq-lab project when it is missing
  (`opening_spec.ensure_opening_spec_fixture`; the file is not under version control), before the guard below starts.
- The sha256 session fixture over the four research files (`oos_access_log.jsonl`, `ledger.csv`,
  `registry.csv`, `oos_openings.json`), made robust to other workflows that write them while the terminal
  tests run, plus `live/KILL` (presence) and an in-process write ban on the folders in `PROTECTED_DIRS`.

Why not a plain before and after sha256 comparison: a research workflow appends to
`oos_access_log.jsonl` and rebuilds `registry.csv` concurrently, so their legitimate writes would fail
the session. The fixture instead proves that the terminal's own tests did not change the files, in two
layers (details in `research_guard.py`):

1. Attribution: an in-process audit hook refuses (PermissionError) and records every open for writing,
   rename, replace, remove or truncate of a guarded file from this pytest process, before the OS call.
2. Content: at session end `oos_openings.json` must be byte-identical; the append-only files must keep
   their old bytes as a prefix, and no appended line may carry `"caller": "terminal"` or the test marker
   `nqt-test`; `registry.csv` may be rebuilt only by another process and never with the marker.

The sha256 of each file before and after the session is printed in the terminal summary as the record;
a change there is accepted only when layers 1 and 2 attribute it to another workflow.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from nq_lab.config import OOS_LOG, RESULTS, ROOT  # noqa: E402
from nq_lab.oos_gate import OPENINGS  # noqa: E402

from opening_spec import ensure_opening_spec_fixture  # noqa: E402
from research_guard import APPEND, APPEND_LOG, PRESENCE, REBUILT, STRICT, ResearchGuard  # noqa: E402

ensure_opening_spec_fixture()  # before the session guard write-protects the fixtures folder

RESEARCH_FILES = {
    OOS_LOG: APPEND_LOG,
    RESULTS / "ledger.csv": APPEND,
    RESULTS / "registry.csv": REBUILT,
    OPENINGS: STRICT,
}
WATCHED_FILES = {ROOT / "live" / "KILL": PRESENCE}  # the live workflow may toggle it; reported as a note
# No in-process write, remove, rename, mkdir, link or chmod anywhere under these folders.
PROTECTED_DIRS = (RESULTS, ROOT / "backtests" / "output", ROOT / "data", ROOT / "live",
                  BACKEND / "tests" / "fixtures")
_NOTES: list[str] = []


def _digest(content: bytes | None) -> str:
    return "missing" if content is None else hashlib.sha256(content).hexdigest()


def _current(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def sha256_lines(before: dict[Path, bytes | None], after: dict[Path, bytes | None]) -> list[str]:
    """One summary line per guarded file: its sha256 before and after the session."""
    lines = []
    for path, old in before.items():
        old_sha, new_sha = _digest(old), _digest(after.get(path))
        if old_sha == new_sha:
            lines.append(f"sha256 {path.name} unchanged: {old_sha}")
        else:
            lines.append(f"sha256 {path.name} changed during the session: {old_sha} -> {new_sha}")
    return lines


@pytest.fixture(scope="session", autouse=True)
def research_files_guard():
    guard = ResearchGuard({**RESEARCH_FILES, **WATCHED_FILES}, protected_dirs=PROTECTED_DIRS).start()
    try:
        yield guard
    finally:
        guard.stop()
    report = guard.verify()
    _NOTES.extend(sha256_lines(guard.before, {path: _current(path) for path in guard.before}))
    _NOTES.extend(report.notes)
    assert not report.problems, "research files changed by the terminal tests:\n" + "\n".join(report.problems)


def pytest_terminal_summary(terminalreporter):
    for note in _NOTES:
        terminalreporter.write_line(f"research guard note: {note}")
