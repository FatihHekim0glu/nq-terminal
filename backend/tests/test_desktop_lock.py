"""D2.1 (03 item 1.3a; 05 X02 and T07): one backend per lab through `<state>/backend.lock`.

The lock is created with CreateFileW, CREATE_NEW and a protected owner-only DACL passed in SECURITY_ATTRIBUTES, so the
file never exists with inherited rights, and its handle is held open for the backend's life sharing READ only. A live
lock is one whose open for DELETE fails with a sharing violation; a stale one (the process ended) is replaced.

Every test here works in a fresh folder under D:/dev/tmp (`lock_dir`), never the real terminal/state.
"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import textwrap
from ctypes import wintypes
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal import __main__ as launcher
from nq_terminal.desktop import lock
from nq_terminal.desktop.lock import LockHeld

from conftest import BACKEND, PY, Backend, desktop_env, spawn_backend
from research_guard import ResearchGuard

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows lock")

TOKEN = "ab" * 32
OTHER_TOKEN = "cd" * 32


def _acquire(folder: Path, port: int = 53117, token: str = TOKEN) -> lock.HeldLock:
    return lock.acquire(folder, port=port, token=token, root=ROOT)


# ---------------------------------------------------------------- contents and release

def test_the_lock_holds_pid_port_token_root_and_start(lock_dir):
    held = _acquire(lock_dir)
    try:
        info = lock.read_info(lock_dir)
        assert info is not None
        assert (info.pid, info.port, info.token, info.root) == (os.getpid(), 53117, TOKEN, str(ROOT))
        assert info.started.endswith("Z") and "T" in info.started
        assert held.info == info and held.path == lock_dir / "backend.lock"
    finally:
        held.release()


def test_release_removes_the_file_and_is_idempotent(lock_dir):
    held = _acquire(lock_dir)
    held.release()
    held.release()
    assert not (lock_dir / "backend.lock").exists()
    assert lock.is_live(lock_dir) is False and lock.probe(lock_dir) is None


def test_the_token_never_shows_in_the_repr(lock_dir):
    with _acquire(lock_dir) as held:
        assert TOKEN not in repr(held) and TOKEN not in repr(held.info) and TOKEN not in str(held.info)


# ---------------------------------------------------------------- owner-only rights (05 X02)

def test_the_owner_only_check_is_born_failing_on_a_file_with_inherited_rights(lock_dir):
    plain = lock_dir / "plain.txt"
    plain.write_text("x", encoding="utf-8")
    sddl = lock.file_dacl_sddl(plain)
    assert "ID" in sddl or not sddl.startswith("D:P")  # inherited from D:/dev/tmp
    assert lock.is_owner_only(sddl, lock.current_user_sid()) is False


def test_a_held_lock_has_a_protected_owner_system_administrators_dacl(lock_dir):
    with _acquire(lock_dir) as held:
        sddl = held.dacl_sddl()
        assert sddl.startswith("D:P"), sddl
        assert lock.is_owner_only(sddl, lock.current_user_sid()), sddl
        assert lock.is_owner_only(lock.file_dacl_sddl(held.path), lock.current_user_sid())


def test_the_file_has_the_dacl_from_its_first_moment(lock_dir):
    """Read through the creating handle before a byte is written: no window with inherited rights."""
    handle = lock.create_new_protected(lock_dir)
    try:
        sddl = lock.handle_dacl_sddl(handle)
        assert (lock_dir / "backend.lock").stat().st_size == 0
        assert lock.is_owner_only(sddl, lock.current_user_sid()), sddl
    finally:
        lock.close_and_delete(handle)
    assert not (lock_dir / "backend.lock").exists()


def test_icacls_shows_only_the_owner_system_and_administrators(lock_dir):
    with _acquire(lock_dir) as held:
        out = subprocess.run(["icacls", str(held.path)], capture_output=True, text=True, timeout=30,
                             creationflags=subprocess.CREATE_NO_WINDOW)
    assert out.returncode == 0, out.stderr
    rights = [line.strip().removeprefix(str(held.path)).strip() for line in out.stdout.splitlines()
              if ":(" in line]
    principals = sorted(r.split(":(")[0] for r in rights)
    assert len(principals) == 3, out.stdout
    assert any(p.endswith("\\SYSTEM") for p in principals) and any(p.endswith("\\Administrators") for p in principals)
    assert all("(I)" not in r for r in rights), out.stdout  # nothing inherited


# ---------------------------------------------------------------- liveness and attach

def test_a_live_lock_refuses_a_second_holder_with_its_port(lock_dir):
    with _acquire(lock_dir, port=53117):
        assert lock.is_live(lock_dir) is True
        with pytest.raises(LockHeld) as caught:
            _acquire(lock_dir, port=53999, token=OTHER_TOKEN)
        assert caught.value.info is not None and caught.value.info.port == 53117
        assert lock.probe(lock_dir).port == 53117
        assert TOKEN not in str(caught.value)


def test_a_reader_can_read_a_held_lock(lock_dir):
    with _acquire(lock_dir):
        doc = json.loads(lock.read_text(lock_dir))
    assert set(doc) == {"v", "pid", "port", "token", "root", "started"} and doc["token"] == TOKEN


def test_a_held_lock_cannot_be_deleted_or_written_by_another_handle(lock_dir):
    with _acquire(lock_dir) as held:
        with pytest.raises(PermissionError):
            held.path.unlink()
        with pytest.raises(PermissionError):
            held.path.write_text("{}", encoding="utf-8")


def test_no_lock_is_free(lock_dir):
    assert lock.is_live(lock_dir) is False and lock.probe(lock_dir) is None and lock.read_info(lock_dir) is None


STALE_SCRIPT = textwrap.dedent("""
    import os, sys
    from pathlib import Path
    from nq_terminal.desktop import lock
    lock.acquire(Path(sys.argv[1]), port=1, token="ef" * 32, root=Path(sys.argv[2]))
    os._exit(0)  # the process ends without releasing: the file stays, its handle is gone
""")


def _leave_a_stale_lock(folder: Path) -> None:
    done = subprocess.run([str(PY), "-E", "-s", "-c", STALE_SCRIPT, str(folder), str(ROOT)], cwd=BACKEND,
                          env=desktop_env(folder), capture_output=True, text=True, timeout=120,
                          creationflags=subprocess.CREATE_NO_WINDOW)
    assert done.returncode == 0, done.stderr
    assert (folder / "backend.lock").exists()


def test_a_stale_lock_whose_process_ended_is_replaced(lock_dir):
    _leave_a_stale_lock(lock_dir)
    assert lock.read_info(lock_dir).port == 1
    assert lock.is_live(lock_dir) is False and lock.probe(lock_dir) is None
    with _acquire(lock_dir, port=53117) as held:
        assert held.info.pid == os.getpid() and lock.read_info(lock_dir).port == 53117
        assert lock.is_owner_only(held.dacl_sddl(), lock.current_user_sid())


def test_the_lock_announces_its_writes_to_the_audit_hook(lock_dir):
    """The research guard refuses writes under a protected folder through the open audit event; the native create
    raises the same event first, so a test can never create a lock in the real terminal/state."""
    guard = ResearchGuard({}, protected_dirs=[lock_dir]).start()
    try:
        with pytest.raises(PermissionError):
            _acquire(lock_dir)
    finally:
        guard.stop()
    assert not (lock_dir / "backend.lock").exists()


# ---------------------------------------------------------------- two starts racing on a stale lock

@pytest.mark.usefixtures("window_watch")
def test_two_starts_racing_on_a_stale_lock_give_one_backend_and_one_attach(lock_dir):
    _leave_a_stale_lock(lock_dir)
    first = spawn_backend(["-m", "nq_terminal"], desktop_env(lock_dir), token=TOKEN, nonce="01" * 32)
    second = spawn_backend(["-m", "nq_terminal"], desktop_env(lock_dir), token=OTHER_TOKEN, nonce="02" * 32)
    backends: list[Backend] = [first, second]
    try:
        kinds = sorted(b.first_nqt_line()[0] for b in backends)
        assert kinds == ["NQT-ATTACH", "NQT-READY"], [b.stderr_text() for b in backends]
        winner = next(b for b in backends if b.ready is not None)
        loser = next(b for b in backends if b.ready is None)
        assert loser.wait_exit() == 0
        assert loser.attach == {"port": winner.ready["port"]}
        info = lock.read_info(lock_dir)
        assert (info.pid, info.port) == (winner.ready["pid"], winner.ready["port"])
    finally:
        for backend in backends:
            backend.stop()
    assert not (lock_dir / "backend.lock").exists()


# ---------------------------------------------------------------- a planted lock is never trusted (05 X02)

PLANTED = json.dumps({"v": 1, "pid": os.getpid(), "port": 4444, "token": "ee" * 32, "root": "evil",
                      "started": "2026-01-01T00:00:00.000Z"})


class _PlantedLock:
    """What another principal with create rights in the folder can do: make backend.lock with the folder's inherited
    rights, hold it open sharing READ only (so a delete-open fails: it looks live) and fill it with its own contents."""

    def __init__(self, folder: Path) -> None:
        api, target = lock._api(), os.fspath(folder / "backend.lock")
        self.handle = api.kernel32.CreateFileW(target, lock.GENERIC_READ | lock.GENERIC_WRITE | lock.DELETE,
                                               lock.FILE_SHARE_READ, None, lock.CREATE_NEW,
                                               lock.FILE_ATTRIBUTE_NORMAL, None)
        assert self.handle != lock._INVALID
        lock._write_all(self.handle, PLANTED.encode("utf-8"))
        self.path = folder / "backend.lock"

    def contents(self) -> str:
        """What the file says, read on the planter's own handle (a path open would be refused by its sharing)."""
        buffer, got = ctypes.create_string_buffer(4096), wintypes.DWORD()
        api = lock._api().kernel32
        api.SetFilePointer.argtypes = [wintypes.HANDLE, wintypes.LONG, wintypes.LPVOID, wintypes.DWORD]
        api.SetFilePointer(self.handle, 0, None, 0)
        assert api.ReadFile(self.handle, buffer, 4096, ctypes.byref(got), None)
        return buffer.raw[:got.value].decode("utf-8")

    def close(self) -> None:
        lock.close_and_delete(self.handle)


@pytest.fixture
def planted(lock_dir):
    plant = _PlantedLock(lock_dir)
    try:
        yield plant
    finally:
        plant.close()


def test_the_planted_file_is_born_with_inherited_rights_and_looks_live(planted, lock_dir):
    assert lock.is_owner_only(lock.file_dacl_sddl(planted.path), lock.current_user_sid()) is False
    assert lock.is_live(lock_dir) is True


def test_probe_and_read_refuse_a_lock_with_inherited_rights(planted, lock_dir):
    for read in (lock.probe, lock.read_info, lock.read_text):
        with pytest.raises(lock.LockUntrusted) as caught:
            read(lock_dir)
        assert "backend.lock" in str(caught.value) and "ee" * 32 not in str(caught.value)
        assert "4444" not in str(caught.value)


def test_acquire_neither_attaches_to_nor_replaces_a_planted_lock(planted, lock_dir):
    with pytest.raises(lock.LockUntrusted):
        _acquire(lock_dir)
    assert lock.is_live(lock_dir) is True and planted.contents() == PLANTED  # not replaced, not deleted


def test_a_start_with_a_planted_lock_prints_no_attach_and_exits_nonzero(planted, lock_dir):
    backend = spawn_backend(["-m", "nq_terminal"], desktop_env(lock_dir), token=TOKEN, nonce="01" * 32)
    try:
        code = backend.wait_exit()
        assert code == launcher.EXIT_UNTRUSTED_LOCK
        assert backend.nqt_lines == [] and "4444" not in "".join(backend.stdout_lines)
        assert "backend.lock" in backend.stderr_text() and "untrusted" in backend.stderr_text()
    finally:
        backend.stop()


def test_a_real_lock_is_owned_by_a_trusted_principal(lock_dir):
    with _acquire(lock_dir) as held:
        owner = held.owner_sddl()
        assert lock.is_trusted_owner(owner, lock.current_user_sid()), owner
        assert lock.read_info(lock_dir).token == TOKEN  # and it reads as trusted


@pytest.mark.parametrize("owner, trusted", [
    ("S-1-5-21-1-2-3-1001", True), ("s-1-5-21-1-2-3-1001", True), ("SY", True), ("BA", True),
    ("S-1-5-21-1-2-3-1002", False), ("AU", False), ("WD", False), ("", False), ("BU", False)])
def test_only_the_user_system_and_administrators_may_own_a_lock(owner, trusted):
    assert lock.is_trusted_owner(owner, "S-1-5-21-1-2-3-1001") is trusted
