"""Fakes for the JOBS tests (ARCHITECTURE section 8): a stand-in `run_base.py` that records what it was started
with, and a fake `Popen` that lets a test hold a job in the running state. The real `backtests/run_base.py` is never
executed by these tests.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Iterable

SPACED_HOME = ("Fatih Hekimoglu", "nq lab")  # the real home path holds a space; so does this fake root
DUMP_NAME = "argv_dump.json"
# Exit code = the digit after "exit" in the run_id (t_exit1 -> 1); anything else exits 0.
FAKE_RUN_BASE = r'''
import json, os, sys
from pathlib import Path

argv = sys.argv[1:]
cfg = json.loads(argv[argv.index("--config") + 1])
dump = {"argv": sys.argv, "cwd": os.getcwd(), "utf8": os.environ.get("PYTHONUTF8"),
        "encoding": os.environ.get("PYTHONIOENCODING"), "cfg": cfg}
Path(DUMP).write_text(json.dumps(dump), encoding="utf-8")
print("RESULT_JSON: " + json.dumps({"run_id": cfg["run_id"]}))
print("accents: caf\u00e9 \u2713")
run_id = cfg["run_id"]
sys.exit(int(run_id.split("exit")[1][0]) if "exit" in run_id else 0)
'''.replace("DUMP", repr(DUMP_NAME))


# The stand-in runner of the browser tests (fixture_app.py, NQT_FIXTURE_JOBS=fake): it writes nothing, prints a few
# lines and exits 0; a run id with "slow" in it keeps printing a line every 0.2 s for a minute, so a test can stop it.
E2E_RUN_BASE = r'''
import json, sys, time

cfg = json.loads(sys.argv[sys.argv.index("--config") + 1])
print("fake runner: " + cfg["run_id"] + " " + cfg["strategy"], flush=True)
if "slow" in cfg["run_id"]:
    for step in range(300):
        print("working " + str(step), flush=True)
        time.sleep(0.2)
else:
    for step in range(3):
        print("step " + str(step), flush=True)
        time.sleep(0.3)
sys.exit(0)
'''


def make_e2e_root(base: Path) -> Path:
    """A project root whose backtests/run_base.py is the browser tests' stand-in (nothing under it is ever research)."""
    root = base.joinpath(*SPACED_HOME)
    (root / "backtests").mkdir(parents=True)
    (root / "backtests" / "run_base.py").write_text(E2E_RUN_BASE, encoding="utf-8")
    return root


def make_fake_root(base: Path) -> Path:
    """A project root whose path has a space and whose backtests/run_base.py is the recording fake."""
    root = base.joinpath(*SPACED_HOME)
    (root / "backtests").mkdir(parents=True)
    (root / "backtests" / "run_base.py").write_text(FAKE_RUN_BASE, encoding="utf-8")
    return root


def wait_for(predicate: Callable[[], bool], timeout: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class FakeProc:
    """A process that prints `lines` and exits with `code` once `release` is set (or when it is terminated)."""

    def __init__(self, argv: list, release: threading.Event, code: int, lines: Iterable[str]) -> None:
        self.argv = argv
        self.release = release
        self.code = code
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False
        self._lines = list(lines)
        self.stdout = self._stream()

    def _stream(self):
        self.release.wait(30)
        yield from self._lines
        if self.returncode is None:
            self.returncode = self.code

    def wait(self, timeout: float | None = None) -> int:
        self.release.wait(timeout)
        if self.returncode is None:
            self.returncode = self.code
        return self.returncode

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15
        self.release.set()

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9
        self.release.set()


class FakePopen:
    """Callable standing in for subprocess.Popen: records every call; processes wait for `release_all`."""

    def __init__(self, *, hold: bool = True, codes: dict[str, int] | None = None, lines: Iterable[str] = ("ok",),
                 fail_with: Exception | None = None) -> None:
        self.calls: list[tuple[list, dict]] = []
        self.procs: list[FakeProc] = []
        self.held = hold
        self.codes = codes or {}
        self.lines = list(lines)
        self.fail_with = fail_with

    def __call__(self, argv, **kwargs) -> FakeProc:
        if self.fail_with is not None:
            raise self.fail_with
        self.calls.append((argv, kwargs))
        cfg = json.loads(argv[argv.index("--config") + 1])
        release = threading.Event()
        if not self.held:
            release.set()
        proc = FakeProc(argv, release, self.codes.get(cfg["run_id"], 0), self.lines)
        self.procs.append(proc)
        return proc

    def release_all(self) -> None:
        """Let every running process, and every later one, finish."""
        self.held = False
        for proc in list(self.procs):
            proc.release.set()


def spec_dict(run_id: str = "t_one", **overrides) -> dict:
    """A valid JobSpec as a JSON-ready dict (overnight needs no params)."""
    base = {"strategy": "overnight", "params": {}, "variant": "repaired", "start": "2010-09-28",
            "end": "2022-01-01", "run_id": run_id}
    return {**base, **overrides}


PYTHON = sys.executable
