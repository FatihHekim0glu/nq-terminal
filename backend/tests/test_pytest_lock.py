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
    assert sorted(p.name for p in fresh_session_locks(tmp_path, now, is_alive=lambda pid: True)) == [fresh.name, young.name]
    assert fresh_session_locks(tmp_path / "missing", now, is_alive=lambda pid: True) == []


def _dead_pid() -> int:
    """The pid of a process that has already exited (not reused within the test)."""
    child = subprocess.Popen([sys.executable, "-c", ""])
    child.wait()
    return child.pid


def test_a_lock_whose_pid_is_not_running_is_stale_at_once_and_a_live_one_is_fresh(tmp_path: Path):
    live = write_session_lock(tmp_path, os.getpid())
    dead = write_session_lock(tmp_path, _dead_pid())
    assert conftest.pid_running(os.getpid()) is True
    assert conftest.pid_running(int(dead.name.split(".")[1])) is False
    assert [p.name for p in fresh_session_locks(tmp_path)] == [live.name], "the dead session's recent lock is stale"


def test_a_live_pid_is_not_enough_when_the_lock_is_over_two_hours_old(tmp_path: Path):
    old = write_session_lock(tmp_path, os.getpid())
    when = time.time() - 2 * HOUR - 60
    os.utime(old, (when, when))
    assert fresh_session_locks(tmp_path) == [], "pid reuse: the age limit stays as the fallback"


def test_a_lock_name_without_a_pid_is_judged_by_its_age_alone(tmp_path: Path):
    odd = tmp_path / "PYTEST.session-a.lock"
    odd.write_text("{}", encoding="utf-8")
    assert fresh_session_locks(tmp_path) == [odd]


def test_removing_a_lock_that_cannot_be_deleted_is_a_note_and_never_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = write_session_lock(tmp_path, 4242)
    notes: list[str] = []
    monkeypatch.setattr(conftest, "_NOTES", notes)

    def refuse(self, missing_ok=False):
        raise PermissionError(13, "Access is denied", str(self))

    monkeypatch.setattr(Path, "unlink", refuse)
    assert remove_session_lock(path) is False, "nothing was removed"
    assert len(notes) == 1 and "PYTEST.4242.lock" in notes[0] and "not removed" in notes[0], notes
    monkeypatch.undo()
    assert path.exists(), "the file is still there for the next session's stale check"


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


# ---------------------------------------------------------------- a live session keeps its lock fresh (V032)


def _age(path: Path, seconds: float) -> float:
    when = time.time() - seconds
    os.utime(path, (when, when))
    return when


def _wait_until(condition, timeout: float = 20.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.01)
    return condition()


def test_born_failing_one_refresh_moves_the_lock_time_forward(tmp_path: Path):
    path = write_session_lock(tmp_path, os.getpid())
    old = _age(path, 90 * 60)
    conftest.refresh_session_lock(path)
    assert path.stat().st_mtime > old + 60 * 60
    assert fresh_session_locks(tmp_path) == [path]


def test_born_failing_a_refresher_keeps_a_session_past_two_hours_fresh(tmp_path: Path):
    """Without a refresh a lock written at the start of a long session reads as stale after two hours."""
    path = write_session_lock(tmp_path, os.getpid())
    _age(path, 2 * HOUR + 600)
    assert fresh_session_locks(tmp_path) == []
    refresher = conftest.LockRefresher(path, interval_s=0.01)
    refresher.start()
    try:
        assert _wait_until(lambda: fresh_session_locks(tmp_path) == [path])
    finally:
        refresher.stop()


def test_a_stopped_refresher_leaves_the_lock_alone(tmp_path: Path):
    path = write_session_lock(tmp_path, os.getpid())
    refresher = conftest.LockRefresher(path, interval_s=0.01)
    refresher.start()
    refresher.stop()
    assert not refresher.alive()
    before = _age(path, 600)
    time.sleep(0.2)
    assert path.stat().st_mtime == pytest.approx(before, abs=1.0)


def test_a_refresh_that_fails_is_one_note_and_never_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "PYTEST.1.lock"  # not written: the refresh cannot find it
    notes: list[str] = []
    monkeypatch.setattr(conftest, "_NOTES", notes)
    refresher = conftest.LockRefresher(path, interval_s=60)
    refresher.run_once()
    refresher.run_once()
    assert len(notes) == 1 and "PYTEST.1.lock" in notes[0] and "not refreshed" in notes[0], notes


def test_the_refresh_interval_is_far_below_the_stale_limit():
    assert 0 < conftest.PYTEST_LOCK_REFRESH_S <= conftest.PYTEST_LOCK_STALE_S / 6


def test_the_session_hooks_start_and_stop_the_refresher(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    class Config:
        pass

    class Session:
        config = Config()

    monkeypatch.setenv("NQT_LOCK_DIR", str(tmp_path))
    monkeypatch.setattr(conftest, "_SESSION_LOCK", [])
    monkeypatch.setattr(conftest, "_LOCK_REFRESHERS", [])
    monkeypatch.setattr(conftest, "PYTEST_LOCK_REFRESH_S", 0.01)
    conftest.pytest_sessionstart(Session())
    (lock,) = conftest._SESSION_LOCK
    (refresher,) = conftest._LOCK_REFRESHERS
    assert refresher.alive()
    _age(lock, 2 * HOUR + 600)
    assert _wait_until(lambda: fresh_session_locks(tmp_path) == [lock])
    conftest.pytest_sessionfinish(Session(), 0)
    assert not refresher.alive() and not lock.exists() and conftest._LOCK_REFRESHERS == []


def test_born_failing_a_lock_that_cannot_be_written_is_said_at_once_and_noted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                                              capsys: pytest.CaptureFixture):
    class Config:
        pass

    class Session:
        config = Config()

    def refuse(folder, pid):
        raise PermissionError(13, "Access is denied")

    notes: list[str] = []
    monkeypatch.setattr(conftest, "_NOTES", notes)
    monkeypatch.setattr(conftest, "_SESSION_LOCK", [])
    monkeypatch.setattr(conftest, "_LOCK_REFRESHERS", [])
    monkeypatch.setattr(conftest, "write_session_lock", refuse)
    conftest.pytest_sessionstart(Session())
    err = capsys.readouterr().err
    assert "PYTEST lock not written" in err and "cannot see this session" in err
    assert len(notes) == 1 and conftest._SESSION_LOCK == [] and conftest._LOCK_REFRESHERS == []
