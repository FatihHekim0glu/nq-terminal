"""Session guard: the terminal's tests must not change nq-lab's four research files.

Other workflows legitimately write these files while the terminal tests run: a research workflow appends
to `oos_access_log.jsonl` and rebuilds `registry.csv`, and `ledger.csv` is append-only. A plain before and
after sha256 would fail on their writes, so the guard has two layers.

1. Attribution (in-process audit hook, `sys.addaudithook`). Any open for writing, rename, replace, remove,
   truncate, copy, mkdir, rmdir, rmtree, link, symlink, chmod or utime that touches a guarded file, or any
   path inside a protected folder (the session guard protects `results/`, `backtests/output/`, `data/`,
   `live/` and the fixtures), from this pytest process is recorded and refused with `PermissionError`
   before the operating system call runs. Paths are canonicalised first (`os.path.realpath`, which expands
   8.3 aliases such as `PROGRA~1`, then the Win32 device prefix is stripped), and a write target that is
   the same file as a guarded one (`st_dev`, `st_ino`, e.g. a hardlink made elsewhere) is refused too.
   Linking or symlinking a guarded file is refused, since it would create a new alias. Other processes are
   not seen, so their writes are tolerated.
2. Content check at session end.
   - `oos_openings.json` (strict): the sha256 must be identical. Nobody writes it legitimately and the gate
     pins its hash.
   - `oos_access_log.jsonl` and `ledger.csv` (append-only): the old bytes must be an unchanged prefix, and
     no appended line may carry the terminal caller (`"caller": "terminal"`) or `TEST_MARKER`.
   - `registry.csv` (rebuilt whole by `scripts/registry.py`): a change is accepted only when layer 1 saw no
     write from this process and the new content has no `TEST_MARKER`; the change is reported as a note.
   - `live/KILL` (presence): the live workflow may create or remove it; a change is reported as a note
     (in-process changes are already refused by layer 1).

Terminal tests that exercise the gate write to a temporary log and put `TEST_MARKER` in their reasons, so a
leak into the real files is visible in the content check even if it came from a child process.
"""
from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

TEST_MARKER = "nqt-test"
STRICT, APPEND_LOG, APPEND, REBUILT, PRESENCE = "strict", "append_log", "append", "rebuilt", "presence"
_TERMINAL_CALLER = re.compile(r'"caller"\s*:\s*"terminal"')
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
_EVENTS = frozenset({"open", "os.rename", "os.remove", "os.truncate", "shutil.copyfile", "os.mkdir", "os.rmdir",
                     "shutil.rmtree", "os.link", "os.symlink", "os.chmod", "os.utime", "os.chflags",
                     "shutil.copytree", "shutil.move"})
_BOTH_ENDS = frozenset({"os.rename", "os.link", "os.symlink", "shutil.move"})  # source and destination
_DESTINATION = frozenset({"shutil.copyfile", "shutil.copytree"})
_SEP = chr(92)
_DEVICE = _SEP * 2 + "?" + _SEP  # the Win32 device-path prefix
_DEVICE_UNC = _DEVICE + "UNC" + _SEP
_ACTIVE: list["ResearchGuard"] = []
_HOOK_INSTALLED = False


def _norm(path: object) -> str | None:
    """A canonical spelling: 8.3 aliases expanded, symlinks resolved, the device prefix stripped, case folded."""
    if isinstance(path, int) or path is None:
        return None
    try:
        text = os.fsdecode(path)
    except TypeError:
        return None
    try:
        text = os.path.realpath(text)
    except (OSError, ValueError):
        text = os.path.abspath(text)
    if text.startswith(_DEVICE_UNC):
        text = _SEP * 2 + text[len(_DEVICE_UNC):]
    elif text.startswith(_DEVICE):
        text = text[len(_DEVICE):]
    return os.path.normcase(text)


def _identity(path: str) -> tuple[int, int] | None:
    try:
        st = os.stat(path)
    except (OSError, ValueError):
        return None
    return (st.st_dev, st.st_ino) if st.st_ino else None


def _targets(event: str, args: tuple) -> list[str | None]:
    """The paths an audit event may modify, or [] when the event cannot write."""
    if event == "open":
        path, mode, flags = (tuple(args) + (None, None, None))[:3]
        if isinstance(mode, str):
            writes = any(c in mode for c in "wax+")
        else:
            writes = bool((flags or 0) & _WRITE_FLAGS)
        return [_norm(path)] if writes else []
    if event in _BOTH_ENDS:
        return [_norm(args[0]), _norm(args[1])]
    if event in _DESTINATION:
        return [_norm(args[1])]
    return [_norm(args[0])]


def _hook(event: str, args: tuple) -> None:
    if event not in _EVENTS or not _ACTIVE:
        return
    for guard in list(_ACTIVE):
        guard.check_event(event, args)


def _install_hook() -> None:
    global _HOOK_INSTALLED
    if not _HOOK_INSTALLED:
        sys.addaudithook(_hook)
        _HOOK_INSTALLED = True


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class ResearchGuard:
    """Snapshot the guarded files, refuse in-process writes to them, and verify them at the end."""

    def __init__(self, policies: dict[Path, str], protected_dirs: Iterable[Path] = ()):
        self.policies = {Path(p): kind for p, kind in policies.items()}
        self.protected_dirs = tuple(Path(d) for d in protected_dirs)
        self._keys = {_norm(p): p for p in self.policies}
        self._dirs = tuple(d for d in (_norm(p) for p in self.protected_dirs) if d)
        self._ids: dict[tuple[int, int], Path] = {}
        self.before: dict[Path, bytes | None] = {}
        self.blocked: list[str] = []

    def _hit(self, target: str | None) -> str | None:
        if target is None:
            return None
        if target in self._keys:
            return f"research file {self._keys[target]}"
        for folder in self._dirs:
            if target == folder or target.startswith(folder.rstrip(os.sep) + os.sep):
                return f"protected folder path {target}"
        same = self._ids.get(_identity(target)) if self._ids else None
        return f"research file {same} (through the alias {target})" if same is not None else None

    def would_block(self, event: str, args: tuple) -> str | None:
        """What this event would modify among the guarded files and folders, if anything (no writes)."""
        if event not in _EVENTS:
            return None
        hits = [h for h in (self._hit(t) for t in _targets(event, args)) if h]
        return hits[0] if hits else None

    def check_event(self, event: str, args: tuple) -> None:
        hit = self.would_block(event, args)
        if hit is not None:
            self.blocked.append(f"{event} on {hit}")
            raise PermissionError(f"terminal tests may not modify {hit}")

    def start(self) -> "ResearchGuard":
        self.before = {p: _read(p) for p in self.policies}
        self._ids = {ident: p for p in self.policies if (ident := _identity(str(p))) is not None}
        _install_hook()
        _ACTIVE.append(self)
        return self

    def stop(self) -> None:
        if self in _ACTIVE:
            _ACTIVE.remove(self)

    def verify(self) -> Report:
        report = Report(problems=[f"in-process write refused: {b}" for b in self.blocked])
        for path, kind in self.policies.items():
            _check_file(path, kind, self.before.get(path), _read(path), bool(self.blocked), report)
        return report


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _appended_lines(before: bytes, after: bytes) -> Iterable[str]:
    return after[len(before):].decode("utf-8", errors="replace").splitlines()


def _check_file(path: Path, kind: str, before: bytes | None, after: bytes | None,
                wrote_in_process: bool, report: Report) -> None:
    if before == after:
        return
    name = path.name
    if kind == PRESENCE:
        state = {True: "absent", False: "present"}
        report.notes.append(f"{name} changed during the session ({state[before is None]} -> {state[after is None]}); "
                            "in-process changes are refused, so it is attributed to another workflow")
        return
    if kind == STRICT:
        report.problems.append(f"{name} changed during the session (must be byte-identical)")
        return
    if after is None:
        report.problems.append(f"{name} disappeared during the session")
        return
    if kind in (APPEND, APPEND_LOG):
        _check_append(name, kind, before or b"", after, report)
        return
    if TEST_MARKER.encode("utf-8") in after:
        report.problems.append(f"{name} was rebuilt with the test marker {TEST_MARKER!r} inside")
    elif not wrote_in_process:
        report.notes.append(f"{name} changed during the session; no write from this process was seen, "
                            "so it is attributed to another workflow")


def _check_append(name: str, kind: str, before: bytes, after: bytes, report: Report) -> None:
    if not after.startswith(before):
        report.problems.append(f"{name} is append-only but its earlier bytes changed")
        return
    new = [line for line in _appended_lines(before, after) if line.strip()]
    for line in new:
        if TEST_MARKER in line:
            report.problems.append(f"{name} gained a line with the test marker: {line[:160]}")
        elif kind == APPEND_LOG and _TERMINAL_CALLER.search(line):
            report.problems.append(f"{name} gained a terminal line during the test session: {line[:160]}")
    if new:
        report.notes.append(f"{name} gained {len(new)} line(s) from another workflow during the session")
