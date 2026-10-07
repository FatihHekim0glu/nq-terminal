"""The PYTEST lock of a backend test session (0.3.1, test-infra).

A backend pytest session creates `PYTEST.<pid>.lock` in the locks folder (D:/dev/locks, or NQT_LOCK_DIR) while it runs and
removes it at session end. A lock older than two hours is stale. `desktop/scripts/check.ps1` waits while a fresh one
exists before its real-backend smoke steps, so a real-data run and a test session never overlap.

Born failing: no such lock existed. The session test starts a child pytest session over this file with NQT_LOCK_DIR set to
a scratch folder and asserts, from inside that session, that its lock is there, then from outside that it is gone.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

import conftest
from conftest import fresh_session_locks, session_lock_path, remove_session_lock, write_session_lock

HERE = Path(__file__).resolve()
PROBE = "NQT_LOCK_PROBE"
HOUR = 3600


def test_the_lock_names_the_session_pid_and_holds_what_a_reader_needs(tmp_path: Path):
    path = write_session_lock(tmp_path, 4242)
    assert path == session_lock_path(4242, tmp_path) == tmp_path / "PYTEST.4242.lock"
    body = json.loads(path.read_text(encoding="utf-8"))
    assert body["pid"] == 4242 and body["started"].endswith("Z") and isinstance(body["argv"], list)
    assert remove_session_lock(path) is True
    assert not path.exists()
    assert remove_session_lock(path) is False, "removing a lock that is already gone is not an error"


def test_a_lock_older_than_two_hours_is_stale_and_a_younger_one_is_not(tmp_path: Path):
    now = time.time()
    fresh = write_session_lock(tmp_path, 1)
    young = write_session_lock(tmp_path, 2)
    old = write_session_lock(tmp_path, 3)
    os.utime(young, (now - 1 * HOUR, now - 1 * HOUR))
    os.utime(old, (now - 2 * HOUR - 60, now - 2 * HOUR - 60))
    (tmp_path / "PYTEST.notes.txt").write_text("not a lock", encoding="utf-8")
    (tmp_path / "QUIET_MEASURE").write_text("another lock", encoding="utf-8")
    assert sorted(p.name for p in fresh_session_locks(tmp_path, now)) == [fresh.name, young.name]
    assert fresh_session_locks(tmp_path / "missing", now) == []


def test_the_session_hooks_skip_an_xdist_worker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    class Config:
        workerinput = {"workerid": "gw0"}

    class Session:
        config = Config()

    monkeypatch.setenv("NQT_LOCK_DIR", str(tmp_path))
    conftest.pytest_sessionstart(Session())
    assert list(tmp_path.iterdir()) == [], "a worker must not write a lock; the controller owns it"


@pytest.mark.skipif(not os.environ.get(PROBE), reason="runs only inside the child session of the next test")
def test_probe_the_lock_exists_while_this_session_runs():
    folder = Path(os.environ["NQT_LOCK_DIR"])
    mine = [p for p in folder.glob("PYTEST.*.lock") if json.loads(p.read_text(encoding="utf-8"))["pid"] == os.getpid()]
    assert len(mine) == 1, f"no lock of pid {os.getpid()} in {folder}: {list(folder.iterdir())}"


def test_a_pytest_session_creates_its_lock_and_removes_it_at_the_end(tmp_path: Path):
    folder = tmp_path / "locks"
    env = {**os.environ, "NQT_LOCK_DIR": str(folder), PROBE: "1", "PYTHONDONTWRITEBYTECODE": "1"}
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:warnings", "-p", "no:cacheprovider", "-o", "addopts=", "-q",
         f"{HERE}::test_probe_the_lock_exists_while_this_session_runs"],
        env=env, cwd=HERE.parents[2], capture_output=True, text=True, timeout=600, check=False,
    )
    assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
    assert "1 passed" in run.stdout, run.stdout[-2000:]
    assert folder.is_dir(), "the session made the locks folder"
    assert list(folder.glob("PYTEST.*.lock")) == [], "the lock is removed at session end"
