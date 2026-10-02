"""D2.4 (03 sections 2.3 and 2.4; 02 C1-8): the stdin watchdog stops JOBS and the backend within 5 s.

End of file on stdin means the parent is gone. `watchdog.on_eof()` runs the close hooks in order; the JobService hook
terminates a running child and kills it after a short grace period; the lifespan then releases the lock and the
process exits. A hard exit after `STOP_WITHIN_S` is the net under all of it (armed by `__main__`, never by a plain
call, so an in-process test of `on_eof` cannot end the test run).

The subprocess test starts the real start path (`nq_terminal.__main__.serve`, desktop mode, port 0, its own state
folder under D:/dev/tmp) hidden and under the window watch. Nothing of its wiring is replaced: the stdin reader, the
close hook and the hard exit are `__main__`'s own, and the JobService is created by the first `GET /api/jobs` after
`NQT-READY`, as in production (so the hooks run in the production order, the server's stop first). Only the factory
`jobs_api.service_for` is swapped, to build the service on a stand-in project root so the real `run_base.py` is never
started. Nothing here touches 127.0.0.1:8765.
"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from nq_terminal.api import jobs as jobs_api
from nq_terminal.desktop import lock, watchdog
from nq_terminal.models.jobs import JobSpec
from nq_terminal.services.jobs import JobService

from conftest import (BACKEND, HIDDEN, PY, PYTHON_FLAGS, desktop_env, fresh_lock_dir, open_session,
                      remove_lock_dir, spawn_backend, wait_until)
from p2_jobs_fakes import SPACED_HOME, spec_dict, wait_for

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows start path")

TOKEN = "7c" * 32
NONCE = "5e" * 32
PID_FILE = "pid.txt"
STILL_ACTIVE = 259
PROCESS_QUERY_LIMITED = 0x1000
SLOW_RUN_BASE = r'''
import os, sys, time
from pathlib import Path

Path("pid.txt").write_text(str(os.getpid()), encoding="utf-8")
print("slow runner started", flush=True)
for _ in range(1200):
    time.sleep(0.1)
sys.exit(0)
'''
DRIVER = r'''
import sys
from pathlib import Path

import nq_terminal.__main__ as entry
from nq_terminal.api import jobs as jobs_api
from nq_terminal.app import create_app
from nq_terminal.desktop import watchdog
from nq_terminal.services.jobs import JobService
from nq_terminal.settings import load_settings

ROOT = Path(sys.argv[1])
# the real factory would refuse a stand-in root (identity); this stands in for the JobService it builds
jobs_api.service_for = lambda settings, **_: JobService(root=ROOT, state_dir=settings.state_dir, python=sys.executable)

_add = watchdog.add_close_hook


def observed_add(hook):  # only observes: the hook is added exactly as before
    print("HOOK " + hook.__name__, flush=True)
    _add(hook)


watchdog.add_close_hook = observed_add
sys.exit(entry.serve(load_settings(), lambda settings: create_app(settings)))
'''


READER = r'''
import io, sys, threading, time

from nq_terminal.desktop import watchdog
from nq_terminal.desktop.handshake import StdinChannel

closed = threading.Event()
if sys.argv[1] == "real":  # the reader __main__ builds for a backend that reads stdin, closed by the watchdog
    import nq_terminal.__main__ as entry
    from nq_terminal.settings import load_settings

    watchdog.add_close_hook(closed.set)
    channel = entry._channel(load_settings())
else:
    stream = watchdog.PollingStdin() if sys.argv[1] == "polling" else io.FileIO(0, "rb", closefd=False)
    channel = StdinChannel(stream, on_eof=closed.set).start()
assert channel.wait(30) is not None
print("CREDENTIALS", flush=True)
started = time.monotonic()
import scipy.stats  # loads libgfortran, which looks at the standard handles
print("IMPORTED " + str(round(time.monotonic() - started, 2)), flush=True)
closed.wait(30)
print("EOF", flush=True)
'''


def slow_root(base: Path) -> Path:
    root = base.joinpath(*SPACED_HOME)
    (root / "backtests").mkdir(parents=True)
    (root / "backtests" / "run_base.py").write_text(SLOW_RUN_BASE, encoding="utf-8")
    return root


def process_alive(pid: int) -> bool:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED, False, pid)
    if not handle:
        return False
    try:
        code = ctypes.c_ulong()
        return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def read_pid(root: Path) -> int | None:
    try:
        return int((root / PID_FILE).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


@pytest.fixture(autouse=True)
def clean_watchdog():
    """No hook or armed exit from one test reaches the next."""
    watchdog.disarm_hard_exit()
    before = watchdog.close_hooks()
    yield
    watchdog.disarm_hard_exit()
    for hook in watchdog.close_hooks():
        if hook not in before:
            watchdog.remove_close_hook(hook)


# ---------------------------------------------------------------- the contract in numbers

def test_the_stop_budget_is_five_seconds_and_the_job_grace_fits_inside_it():
    assert watchdog.STOP_WITHIN_S == 5.0
    assert watchdog.JOB_KILL_AFTER_S + watchdog.JOB_JOIN_S < watchdog.STOP_WITHIN_S


# ---------------------------------------------------------------- the hard exit

def test_on_eof_never_exits_the_process_unless_the_hard_exit_was_armed(monkeypatch):
    exits: list[int] = []
    monkeypatch.setattr(watchdog.os, "_exit", exits.append)
    watchdog.on_eof()
    time.sleep(0.3)
    assert exits == [] and watchdog.hard_exit_armed() is False


def test_an_armed_hard_exit_fires_after_the_stop_budget_when_the_process_is_still_alive():
    exits: list[int] = []
    watchdog.arm_hard_exit(exit_fn=exits.append, after_s=0.2)
    watchdog.on_eof()
    assert wait_until(lambda: exits == [watchdog.EXIT_HARD], 3)


def test_the_hard_exit_does_not_wait_for_a_close_hook_that_never_returns():
    exits: list[int] = []
    release = threading.Event()
    watchdog.add_close_hook(lambda: release.wait(10))
    watchdog.arm_hard_exit(exit_fn=exits.append, after_s=0.2)
    threading.Thread(target=watchdog.on_eof, daemon=True).start()
    try:
        assert wait_until(lambda: exits == [watchdog.EXIT_HARD], 3)
    finally:
        release.set()


def test_a_disarmed_hard_exit_never_fires():
    exits: list[int] = []
    watchdog.arm_hard_exit(exit_fn=exits.append, after_s=0.1)
    watchdog.disarm_hard_exit()
    watchdog.on_eof()
    time.sleep(0.5)
    assert exits == []


# ---------------------------------------------------------------- JobService.close(): terminate, then kill

class StubbornProc:
    """A child that ignores terminate() and only ends when it is killed."""

    def __init__(self) -> None:
        self.ended = threading.Event()
        self.terminated = self.killed = False
        self.returncode: int | None = None
        self.stdout = self._stream()

    def _stream(self):
        self.ended.wait(30)
        yield from ()

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed, self.returncode = True, -9
        self.ended.set()

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        self.ended.wait(timeout)
        return self.returncode if self.returncode is not None else -1


def test_close_terminates_then_kills_a_stubborn_child_after_the_grace_period(tmp_path):
    proc = StubbornProc()
    service = JobService(root=slow_root(tmp_path), state_dir=None, python=sys.executable,
                         popen=lambda argv, **kwargs: proc)
    job = service.enqueue(JobSpec.model_validate(spec_dict("t_stubborn")))
    assert wait_for(lambda: service.get(job.id).state == "running", 10)
    assert wait_for(lambda: service._proc is proc, 10)
    started = time.monotonic()
    service.close(kill_after_s=0.2, join_s=3.0)
    assert proc.terminated and proc.killed and time.monotonic() - started < 3.0
    assert service.get(job.id).state == "error"


def test_close_is_safe_to_call_twice(tmp_path):
    service = JobService(root=slow_root(tmp_path), state_dir=None, python=sys.executable)
    service.close()
    service.close(kill_after_s=0.1, join_s=0.1)


# ---------------------------------------------------------------- on_eof stops a running job (in process)

def test_on_eof_stops_a_running_job_child_and_returns_inside_the_budget(tmp_path, window_watch):
    root = slow_root(tmp_path)
    service = JobService(root=root, state_dir=None, python=sys.executable)  # the real Popen, a stand-in script
    hook = watchdog.watch_jobs(service)
    try:
        job = service.enqueue(JobSpec.model_validate(spec_dict("t_eof")))
        assert wait_for(lambda: read_pid(root) is not None and service.get(job.id).state == "running", 60)
        pid = read_pid(root)
        assert process_alive(pid)
        started = time.monotonic()
        watchdog.on_eof()
        elapsed = time.monotonic() - started
        assert elapsed < watchdog.STOP_WITHIN_S
        assert wait_until(lambda: not process_alive(pid), 3), "the job child outlived the watchdog"
        assert service.get(job.id).state == "error" and "stopped while this job ran" in service.get(job.id).message
    finally:
        watchdog.remove_close_hook(hook)
        service.close()


def test_watch_jobs_adds_one_hook_and_a_removed_hook_is_not_run(tmp_path):
    service = JobService(root=slow_root(tmp_path), state_dir=None, python=sys.executable, enabled=False)
    before = len(watchdog.close_hooks())
    hook = watchdog.watch_jobs(service)
    assert len(watchdog.close_hooks()) == before + 1
    watchdog.remove_close_hook(hook)
    assert len(watchdog.close_hooks()) == before


def test_adopt_service_sets_the_app_service_and_registers_the_hook_only_when_asked(tmp_path):
    from types import SimpleNamespace

    app = SimpleNamespace(state=SimpleNamespace())
    service = JobService(root=slow_root(tmp_path), state_dir=None, python=sys.executable, enabled=False)
    before = len(watchdog.close_hooks())
    jobs_api.adopt_service(app, service, watch=False)
    assert app.state.jobs is service and len(watchdog.close_hooks()) == before
    jobs_api.adopt_service(app, service, watch=True)
    assert len(watchdog.close_hooks()) == before + 1


# ---------------------------------------------------------------- the real start path

def queue_one_job(state: Path) -> None:
    """A jobs file holding one queued job; the service built by the first /api/jobs request starts it."""
    queued = {"id": "j_" + "2" * 12, "run_id": "t_watchdog", "state": "queued", "spec": spec_dict("t_watchdog"),
              "created": "2026-10-02T00:00:00+00:00", "started": None, "finished": None, "exit_code": None,
              "message": "waiting in the queue", "log_tail": []}
    (state / "jobs.json").write_text(json.dumps({"version": 1, "jobs": [queued]}), encoding="utf-8")


def touch_jobs_api(port: int, token: str) -> None:
    """GET /api/jobs through a real session: the first request creates the JobService, as in production."""
    cookie = open_session(port, token)
    assert cookie is not None, "the session route is missing"
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/jobs",
                                     headers={"Cookie": cookie, "Origin": f"http://127.0.0.1:{port}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        assert response.status == 200


def test_closing_stdin_stops_a_running_job_releases_the_lock_and_exits_within_five_seconds(tmp_path, window_watch):
    root = slow_root(tmp_path)
    folder = fresh_lock_dir("watchdog")
    queue_one_job(folder)
    env = desktop_env(folder) | {"NQT_JOBS": "on"}
    backend = spawn_backend(["-c", DRIVER, str(root)], env, token=TOKEN, nonce=NONCE)
    try:
        kind, ready = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
        touch_jobs_api(ready["port"], TOKEN)
        assert wait_until(lambda: read_pid(root) is not None, 60), backend.stderr_text()
        job_pid = read_pid(root)
        assert process_alive(job_pid) and lock.read_info(folder).pid == ready["pid"]
        hooks = [line.split()[1] for line in backend.stdout_lines if line.startswith("HOOK ")]
        assert hooks == ["stop", "close_jobs"], hooks  # the production order: the server's stop, then the jobs
        started = time.monotonic()
        backend.proc.stdin.close()
        assert backend.wait_exit(timeout=watchdog.STOP_WITHIN_S + 3) == 0, backend.stderr_text()
        elapsed = time.monotonic() - started
        assert elapsed < watchdog.STOP_WITHIN_S, f"the backend took {elapsed:.1f} s to stop"
        assert wait_until(lambda: not process_alive(job_pid), 3), "the job child outlived the backend"
        assert lock.probe(folder) is None and not lock.lock_path(folder).exists()
    finally:
        backend.stop(kill=True)
        remove_lock_dir(folder)


# ---------------------------------------------------------------- the stdin reader that never blocks

def test_the_polling_reader_returns_each_line_with_its_newline_and_then_end_of_file():
    read_fd, write_fd = os.pipe()
    reader = watchdog.PollingStdin(read_fd, poll_s=0.01)
    os.write(write_fd, b"TOKEN abc\nNONCE def\n")
    os.close(write_fd)
    try:
        assert reader.readline(100) == b"TOKEN abc\n"
        assert reader.readline(100) == b"NONCE def\n"
        assert reader.readline(100) == b"" and reader.readline(100) == b""
    finally:
        os.close(read_fd)


def test_the_polling_reader_waits_for_a_line_that_arrives_in_pieces_and_honours_the_limit():
    read_fd, write_fd = os.pipe()
    reader = watchdog.PollingStdin(read_fd, poll_s=0.01)
    lines: list[bytes] = []
    thread = threading.Thread(target=lambda: lines.extend([reader.readline(8), reader.readline(8),
                                                           reader.readline(8)]))
    thread.start()
    os.write(write_fd, b"AB")
    time.sleep(0.1)
    os.write(write_fd, b"CD\n0123456789")
    os.close(write_fd)
    thread.join(10)
    os.close(read_fd)
    assert lines == [b"ABCD\n", b"01234567", b"89"]  # a line, then the limit, then what was left at end of file


def test_the_polling_reader_sees_a_closed_pipe_within_a_fraction_of_a_second():
    read_fd, write_fd = os.pipe()
    reader = watchdog.PollingStdin(read_fd)
    seen: list[float] = []
    thread = threading.Thread(target=lambda: (reader.readline(10), seen.append(time.monotonic())))
    thread.start()
    time.sleep(0.2)
    closed_at = time.monotonic()
    os.close(write_fd)
    thread.join(5)
    os.close(read_fd)
    assert seen and seen[0] - closed_at < 0.5


def start_reader(mode: str) -> subprocess.Popen:
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("NQT_")} | {"NQT_STDIN_CONTROL": "1"}
    return subprocess.Popen([str(PY), *PYTHON_FLAGS, "-c", READER, mode], cwd=BACKEND, env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=HIDDEN)


def collect_lines(proc: subprocess.Popen, sink: list[str]) -> None:
    def drain() -> None:
        sink.extend(raw.decode().strip() for raw in iter(proc.stdout.readline, b""))

    threading.Thread(target=drain, daemon=True).start()


def feed(proc: subprocess.Popen) -> None:
    proc.stdin.write(f"TOKEN {TOKEN}\nNONCE {NONCE}\n".encode("ascii"))
    proc.stdin.flush()


def imported(seen: list[str]) -> bool:
    return any(line.startswith("IMPORTED") for line in seen)


def test_a_blocking_read_of_stdin_freezes_a_scipy_import_in_the_same_process(window_watch):
    """The control: the stage A reader (a blocking read of fd 0) holds the pipe while scipy loads its Fortran runtime.
    Skipped on a machine where the stall does not reproduce, so the polling reader's test below is never vacuous."""
    proc, seen = start_reader("blocking"), []
    collect_lines(proc, seen)
    try:
        feed(proc)
        assert wait_until(lambda: "CREDENTIALS" in seen, 60)
        if wait_until(lambda: imported(seen), 8):
            pytest.skip("the blocking reader does not stall a scipy import on this machine")
        proc.stdin.close()  # the import finishes only once the parent closes the pipe
        assert wait_until(lambda: imported(seen), 60)
    finally:
        proc.kill()


def test_the_polling_reader_lets_scipy_import_while_stdin_stays_open_and_sees_the_close_at_once(window_watch):
    proc, seen = start_reader("polling"), []
    collect_lines(proc, seen)
    try:
        feed(proc)
        assert wait_until(lambda: imported(seen), 60)
        took = float(next(line for line in seen if line.startswith("IMPORTED")).split()[1])
        assert took < 30, f"the import took {took} s with the pipe still open"
        closed_at = time.monotonic()
        proc.stdin.close()
        assert wait_until(lambda: "EOF" in seen, 5) and time.monotonic() - closed_at < 2.0
        assert proc.wait(timeout=10) == 0
    finally:
        proc.kill()


def test_the_reader_main_builds_lets_scipy_import_while_stdin_stays_open_and_sees_the_close(window_watch):
    """The real wiring (`__main__._channel`), not a stand-in: were it a blocking read of fd 0, the import would freeze."""
    proc, seen = start_reader("real"), []
    collect_lines(proc, seen)
    try:
        feed(proc)
        assert wait_until(lambda: imported(seen), 30), "scipy did not import with the pipe open: " + repr(seen)
        closed_at = time.monotonic()
        proc.stdin.close()
        assert wait_until(lambda: "EOF" in seen, 5) and time.monotonic() - closed_at < 2.0
        assert proc.wait(timeout=10) == 0
    finally:
        proc.kill()


# ---------------------------------------------------------------- who registers the jobs hook

def test_a_backend_that_reads_stdin_watches_the_jobs_service_it_creates_and_a_browser_backend_does_not(authed_client):
    from nq_terminal.app import create_app
    from nq_terminal.settings import load_settings

    def hooks_after_first_touch(env: dict[str, str]) -> int:
        before = len(watchdog.close_hooks())
        authed_client(create_app(load_settings(env))).get("/api/jobs")
        return len(watchdog.close_hooks()) - before

    launcher = {"NQT_STDIN_CONTROL": "1", "NQT_PORT": "8797", "NQT_JOBS": "off"}  # the port is only a label here
    assert hooks_after_first_touch(launcher) == 1
    assert hooks_after_first_touch({"NQT_JOBS": "off"}) == 0
