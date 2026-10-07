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
   their old bytes as a prefix, and no appended line may carry the test marker `nqt-test`, nor `"caller": "terminal"`
   when this session could have read real data (a refused in-process write, or a backend started without the fixture and
   without NQT_PREWARM=0, see `note_child`); otherwise terminal lines are another checkout's real-data run, noted;
   `registry.csv` may be rebuilt only by another process and never with the marker.

The sha256 of each file before and after the session is printed in the terminal summary as the record;
a change there is accepted only when layers 1 and 2 attribute it to another workflow.

State isolation (W1A). No test may write the real `terminal/state` (the owner's live backend keeps its jobs file,
and from D1 the result cache, there). An autouse fixture points `NQT_STATE_DIR` and the settings' default state
folder at a fresh per-test folder beside `tmp_path`, so `load_settings()` and `load_settings({})` both resolve
there, and the session guard refuses any in-process write under `terminal/state` (`PROTECTED_DIRS`).

Desktop seam (W2A). `lock_dir` is a fresh folder under D:/dev/tmp for every lock test (never terminal/state); the
backend helpers below start real backends hidden, on port 0, with their own
state folder, NQT_JOBS=off and the prewarm off, and the window watch fails a test that shows a window or moves the
focus.

Sessions (W2B). Every /api path needs a session cookie, so every test that talks to an app goes through the shared
authenticated client: `api_client(app, origin=None, **TestClient kwargs)` (or the `authed_client` fixture, which also
closes what it made). It mints a session through the real session routes (`session_cookie`, from a separate loopback
client, so a test with another peer or host still carries a live cookie) and sends the session's origin as Origin on
every request that is not GET or HEAD, so no test needs a bypass in the app. `bare_client` has no session: only the
refusal, proof and session-route tests use it. No other file in this folder builds a TestClient. `secret_log_scan`
records every token, session value and launch code the run makes and fails the run when a log record or a test
backend's output names one.

Serialised sessions (0.3.1). A session creates `PYTEST.<pid>.lock` in the locks folder (D:/dev/locks, or NQT_LOCK_DIR)
while it runs and removes it at the end (`pytest_sessionstart` and `pytest_sessionfinish`, the xdist controller only);
a lock older than two hours is stale, and so is one whose process is not running (`fresh_session_locks`, as in check.ps1).
`desktop/scripts/check.ps1` waits while a fresh one exists before its real-backend smoke steps. A lock that cannot be written
or removed (a PermissionError) is reported in the terminal summary and never fails the session.
"""
from __future__ import annotations

import atexit
import ctypes
import datetime
import hashlib
import json
import logging
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from nq_lab.config import OOS_LOG, RESULTS, ROOT  # noqa: E402
from nq_lab.oos_gate import OPENINGS  # noqa: E402

from opening_spec import ensure_opening_spec_fixture  # noqa: E402
from research_guard import APPEND, APPEND_LOG, PRESENCE, REBUILT, STRICT, ResearchGuard, note_child  # noqa: E402

ensure_opening_spec_fixture()  # before the session guard write-protects the fixtures folder

RESEARCH_FILES = {
    OOS_LOG: APPEND_LOG,
    RESULTS / "ledger.csv": APPEND,
    RESULTS / "registry.csv": REBUILT,
    OPENINGS: STRICT,
}
WATCHED_FILES = {ROOT / "live" / "KILL": PRESENCE}  # the live workflow may toggle it; reported as a note
# No in-process write, remove, rename, mkdir, link or chmod anywhere under these folders.
# Two state folders: this checkout's, and the shared lab's (nq_lab's ROOT, the owner's live folder), which is a
# different folder when the tests run from a git worktree.
REAL_STATE_DIR = BACKEND.parent / "state"
MAIN_STATE_DIR = ROOT / "terminal" / "state"
PROTECTED_DIRS = (RESULTS, ROOT / "backtests" / "output", ROOT / "data", ROOT / "live", ROOT / "experiments",
                  BACKEND / "tests" / "fixtures", REAL_STATE_DIR, MAIN_STATE_DIR)
_NOTES: list[str] = []

PYTEST_LOCK_DIR = Path(r"D:\dev\locks")
PYTEST_LOCK_STALE_S = 2 * 60 * 60
_SESSION_LOCK: list[Path] = []


def session_lock_dir() -> Path:
    """The locks folder: NQT_LOCK_DIR when set (the lock tests), else D:/dev/locks."""
    return Path(os.environ.get("NQT_LOCK_DIR") or PYTEST_LOCK_DIR)


def session_lock_path(pid: int, folder: Path | None = None) -> Path:
    return (folder if folder is not None else session_lock_dir()) / f"PYTEST.{pid}.lock"


def write_session_lock(folder: Path, pid: int) -> Path:
    """Creates (or refreshes) this session's lock; the body says who holds it and since when."""
    folder.mkdir(parents=True, exist_ok=True)
    path = session_lock_path(pid, folder)
    started = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    path.write_text(json.dumps({"pid": pid, "started": started, "argv": sys.argv[:12]}) + "\n", encoding="utf-8")
    return path


def remove_session_lock(path: Path) -> bool:
    """Removes a lock; False when it was already gone or could not be removed (a note says why in the second case)."""
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    except PermissionError as error:  # another process holds the file open: the next session's stale check handles it
        _NOTES.append(f"PYTEST lock {path.name} not removed ({error}); it goes stale when this process is gone")
        return False
    return True


STILL_ACTIVE, ERROR_ACCESS_DENIED = 259, 5


def pid_running(pid: int) -> bool:
    """True when a process with this id is running (access denied still means it exists)."""
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(PROCESS_QUERY_LIMITED, False, pid)
    if not handle:
        return ctypes.get_last_error() == ERROR_ACCESS_DENIED
    try:
        code = ctypes.c_ulong()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == STILL_ACTIVE
    finally:
        kernel.CloseHandle(handle)


def fresh_session_locks(folder: Path, now: float | None = None, is_alive=None) -> list[Path]:
    """The locks in `folder` that are not stale: written within the last two hours and, when the file name carries a
    process id (PYTEST.<pid>.lock), that process is still running (a session killed without its cleanup leaves a lock
    behind; the two-hour limit stays as the fallback for a reused pid, as in check.ps1)."""
    moment = time.time() if now is None else now
    alive = pid_running if is_alive is None else is_alive
    found: list[Path] = []
    for path in sorted(folder.glob("PYTEST.*.lock")) if folder.is_dir() else []:
        try:
            if moment - path.stat().st_mtime >= PYTEST_LOCK_STALE_S:
                continue
        except FileNotFoundError:
            continue  # removed between the listing and the stat
        pid = path.name.split(".")[1]
        if pid.isdigit() and not alive(int(pid)):
            continue
        found.append(path)
    return found


def pytest_sessionstart(session):
    if hasattr(session.config, "workerinput"):
        return  # an xdist worker: the controller process holds the session's lock
    try:
        _SESSION_LOCK.append(write_session_lock(session_lock_dir(), os.getpid()))
    except OSError as error:
        _NOTES.append(f"PYTEST lock not written ({error}); check.ps1 cannot see this session")
        return
    atexit.register(remove_session_lock, _SESSION_LOCK[0])  # a session that ends without sessionfinish


def pytest_sessionfinish(session, exitstatus):
    while _SESSION_LOCK:
        remove_session_lock(_SESSION_LOCK.pop())


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


class SecretScan(logging.Handler):
    """The log scan of the whole run (04 D2.2, 03 15.2): every token, session value and launch code made during the
    session is recorded, every log record and every line a test backend printed is kept, and at the end no record
    or line may contain one of them."""

    def __init__(self) -> None:
        super().__init__(level=logging.NOTSET)
        self.secrets: set[str] = set()
        self.texts: list[str] = []
        self._format = logging.Formatter("%(name)s %(levelname)s %(message)s")

    def remember(self, value: object) -> object:
        if isinstance(value, str) and len(value) >= 32:
            self.secrets.add(value.lower())
        return value

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.texts.append(self._format.format(record))
        except Exception:  # a record that cannot be formatted is kept as its raw message
            self.texts.append(repr(record.msg))

    def hits(self) -> list[str]:
        return [text[:200] for text in self.texts if any(secret in text.lower() for secret in self.secrets)]


SCANNED_LOGGERS = ("", "uvicorn", "uvicorn.error", "uvicorn.access", "nq_terminal")
SECRET_SCAN: SecretScan | None = None


def _recording(scan: SecretScan, function):
    def wrapper(*args, **kwargs):
        return scan.remember(function(*args, **kwargs))

    return wrapper


@pytest.fixture(scope="session", autouse=True)
def secret_log_scan():
    """Records every secret the session makes and fails the run when a log record or a backend line names one."""
    global SECRET_SCAN
    from nq_terminal.desktop import lifecycle, sessions

    scan = SECRET_SCAN = SecretScan()
    patch = pytest.MonkeyPatch()
    patch.setattr(lifecycle, "new_token", _recording(scan, lifecycle.new_token))
    patch.setattr(sessions.SessionStore, "create", _recording(scan, sessions.SessionStore.create))
    patch.setattr(sessions.SessionStore, "mint_code", _recording(scan, sessions.SessionStore.mint_code))
    original_set_runtime = lifecycle.set_runtime

    def set_runtime(app, runtime):
        scan.remember(runtime.token)
        return original_set_runtime(app, runtime)

    patch.setattr(lifecycle, "set_runtime", set_runtime)
    loggers = [logging.getLogger(name) for name in SCANNED_LOGGERS]
    for logger in loggers:
        logger.addHandler(scan)
    try:
        yield scan
    finally:
        for logger in loggers:
            logger.removeHandler(scan)
        patch.undo()
        SECRET_SCAN = None
    hits = scan.hits()
    _NOTES.append(f"secret log scan: {len(scan.texts)} log records and backend lines against {len(scan.secrets)} "
                  f"secrets, {len(hits)} hits")
    assert not hits, "a token, session value or launch code reached a log line:\n" + "\n".join(hits)


def scan_text(text: str) -> None:
    """Add process output (a test backend's stdout and stderr) to the session's log scan."""
    if SECRET_SCAN is not None and text:
        SECRET_SCAN.texts.append(text)


def remember_secret(value: str) -> None:
    if SECRET_SCAN is not None:
        SECRET_SCAN.remember(value)


@pytest.fixture(scope="session", autouse=True)
def session_state_dir(tmp_path_factory: pytest.TempPathFactory):
    """One state folder for the whole session, set before any module-scoped fixture builds an app.

    A module-scoped client (for example the `api` fixture in test_p1_api.py) is built before the per-test fixture
    below runs, so without this its state folder would be the real `terminal/state` and its first cached route
    (the result cache keeps its bodies in <state>/cache) would try to create it there. The per-test fixture still
    gives each test its own folder on top of this one."""
    from nq_terminal import settings as settings_module

    folder = tmp_path_factory.mktemp("nqt-session-state")
    patch = pytest.MonkeyPatch()
    patch.setenv("NQT_STATE_DIR", str(folder))
    patch.setattr(settings_module, "DEFAULT_STATE_DIR", folder)
    try:
        yield folder
    finally:
        patch.undo()


@pytest.fixture(autouse=True)
def temporary_state_dir(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh state folder per test, for NQT_STATE_DIR and for the default of `load_settings({})`."""
    from nq_terminal import settings as settings_module

    folder = tmp_path_factory.mktemp("nqt-state")
    monkeypatch.setenv("NQT_STATE_DIR", str(folder))
    monkeypatch.setattr(settings_module, "DEFAULT_STATE_DIR", folder)
    return folder


@pytest.fixture(autouse=True)
def no_ib_settings_from_the_shell(monkeypatch: pytest.MonkeyPatch):
    """The owner's IB settings must not leak into a test: a test that wants one sets it itself (after this runs).

    NQT_JOBS=off is the standing rule for every test backend (03 section 2.6): an in-process `load_settings()` app
    never runs a backtest or reads a TWS unless the test says `on` itself. `load_settings({...})` ignores this."""
    for name in ("NQT_IB_READONLY", "IB_HOST", "IB_PORT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("NQT_JOBS", "off")


# ---------------------------------------------------------------- desktop seam helpers (W2A)

PY = ROOT / ".venv" / "Scripts" / "python.exe"  # the venv launcher; its child is the real interpreter
BACKEND_DIR = BACKEND
LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
LOCK_ROOT = Path("D:/dev/tmp")
NQT_LINE_WAIT_S = 120.0
STOP_WAIT_S = 15.0
PYTHON_FLAGS = ("-E", "-s", "-X", "utf8")
HIDDEN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def fresh_lock_dir(label: str) -> Path:
    """A new empty folder under D:/dev/tmp (or the system temp) for one lock or backend test."""
    base = LOCK_ROOT if LOCK_ROOT.is_dir() else Path(tempfile.gettempdir())
    safe = "".join(c if c.isalnum() else "-" for c in label)[:40]
    folder = base / f"nqt-w2a-{safe}-{uuid.uuid4().hex[:8]}"
    folder.mkdir(parents=True)
    return folder.resolve()


REMOVE_WAIT_S = 10.0


def remove_lock_dir(folder: Path) -> None:
    """Remove a test folder; a killed backend's handle on its lock file can outlive the kill, so retry for a while."""
    deadline = time.monotonic() + REMOVE_WAIT_S
    while True:
        shutil.rmtree(folder, ignore_errors=True)
        if not folder.exists() or time.monotonic() >= deadline:
            return
        time.sleep(0.1)


def desktop_env(state_dir: Path) -> dict[str, str]:
    """A backend the app would start: desktop mode, port 0, its own state folder, no jobs, no prewarm, no IB."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("NQT_", "IB_", "PYTHON"))}
    temp = str(LOCK_ROOT) if LOCK_ROOT.is_dir() else env.get("TEMP", tempfile.gettempdir())
    env.update({"NQT_DESKTOP": "1", "NQT_PORT": "0", "NQT_STATE_DIR": str(state_dir), "NQT_JOBS": "off",
                "NQT_PREWARM": "0", "TEMP": temp, "TMP": temp})
    return env


def wait_until(check, timeout_s: float, step_s: float = 0.05) -> bool:
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        if check():
            return True
        time.sleep(step_s)
    return bool(check())


class Backend:
    """A backend started hidden with stdin held open; stdout and stderr are drained on daemon threads."""

    def __init__(self, proc: subprocess.Popen) -> None:
        self.proc = proc
        self.stdout_lines: list[str] = []
        self.nqt_lines: list[str] = []
        self._stderr: list[str] = []
        self._nqt: queue.Queue[str] = queue.Queue()
        self.ready: dict | None = None
        self.attach: dict | None = None
        threading.Thread(target=self._drain_stdout, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stdout(self) -> None:
        for raw in iter(self.proc.stdout.readline, b""):
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            self.stdout_lines.append(line)
            if line.startswith("NQT-"):
                self.nqt_lines.append(line)
                self._nqt.put(line)
        scan_text("\n".join(self.stdout_lines))  # the log scan covers what the backend printed

    def _drain_stderr(self) -> None:
        for raw in iter(self.proc.stderr.readline, b""):
            self._stderr.append(raw.decode("utf-8", errors="replace"))
        scan_text(self.stderr_text())

    def stderr_text(self) -> str:
        return "".join(self._stderr)

    def first_nqt_line(self, timeout_s: float = NQT_LINE_WAIT_S) -> tuple[str, dict]:
        line = self._nqt.get(timeout=timeout_s)
        kind, _, rest = line.partition(" ")
        payload = json.loads(rest)
        if kind == "NQT-READY":
            self.ready = payload
        elif kind == "NQT-ATTACH":
            self.attach = payload
        return kind, payload

    def wait_exit(self, timeout: float = STOP_WAIT_S) -> int:
        return self.proc.wait(timeout=timeout)

    def stop(self, kill: bool = False) -> None:
        """Close stdin (the watchdog stops a desktop backend); kill the tree when asked or when it outlives the wait."""
        if self.proc.stdin is not None and not self.proc.stdin.closed:
            try:
                self.proc.stdin.close()
            except OSError:
                pass
        if not kill and self.proc.poll() is None:
            try:
                self.proc.wait(timeout=STOP_WAIT_S)
            except subprocess.TimeoutExpired:
                kill = True
        if kill or self.proc.poll() is None:
            for pid in child_pids(self.proc.pid):
                _terminate(pid)
            self.proc.kill()
            self.proc.wait(timeout=STOP_WAIT_S)


def spawn_backend(args: list[str], env: dict[str, str], *, token: str | None = None,
                  nonce: str | None = None) -> Backend:
    """`python -E -s -X utf8 <args>` from terminal/backend, hidden, stdin piped (TOKEN and NONCE written if given)."""
    note_child(args, env)
    proc = subprocess.Popen([str(PY), *PYTHON_FLAGS, *args], cwd=BACKEND, env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=HIDDEN)
    if token is not None:
        remember_secret(token)
        proc.stdin.write(f"TOKEN {token}\n".encode("ascii"))
    if nonce is not None:
        proc.stdin.write(f"NONCE {nonce}\n".encode("ascii"))
    proc.stdin.flush()
    return Backend(proc)


def open_session(port: int, token: str) -> str | None:
    """`nqt_s_<port>=<value>` minted through GET /api/session with the token, or None when the route is not there."""
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/session", headers={
        "Authorization": f"NQT {token}", "X-NQT-Origin": f"http://127.0.0.1:{port}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            cookie = response.headers.get("set-cookie", "")
    except urllib.error.HTTPError as refused:
        if refused.code == 404:
            return None
        raise
    return cookie.split(";", 1)[0] or None


# ---------------------------------------------------------------- reading other processes (Windows)

class _ProcessBasicInformation(ctypes.Structure):
    _fields_ = [("ExitStatus", ctypes.c_long), ("PebBaseAddress", ctypes.c_void_p),
                ("AffinityMask", ctypes.c_size_t), ("BasePriority", ctypes.c_long),
                ("UniqueProcessId", ctypes.c_size_t), ("InheritedFromUniqueProcessId", ctypes.c_size_t)]


class _ProcessEntry(ctypes.Structure):
    _fields_ = [("dwSize", ctypes.c_ulong), ("cntUsage", ctypes.c_ulong), ("th32ProcessID", ctypes.c_ulong),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", ctypes.c_ulong),
                ("cntThreads", ctypes.c_ulong), ("th32ParentProcessID", ctypes.c_ulong),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", ctypes.c_ulong), ("szExeFile", ctypes.c_wchar * 260)]


PROCESS_QUERY_INFORMATION, PROCESS_VM_READ, PROCESS_QUERY_LIMITED = 0x0400, 0x0010, 0x1000
PROCESS_TERMINATE, TH32CS_SNAPPROCESS = 0x0001, 0x2
PEB_PARAMETERS, PARAMS_COMMAND_LINE, PARAMS_ENVIRONMENT, PARAMS_ENVIRONMENT_SIZE = 0x20, 0x70, 0x80, 0x3F0


def _kernel32():
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.OpenProcess.restype = ctypes.c_void_p
    k.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    k.CloseHandle.argtypes = [ctypes.c_void_p]
    k.ReadProcessMemory.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
                                    ctypes.POINTER(ctypes.c_size_t)]
    k.QueryFullProcessImageNameW.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_wchar_p,
                                             ctypes.POINTER(ctypes.c_ulong)]
    k.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    k.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry)]
    k.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry)]
    k.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    return k


def _open(pid: int, access: int):
    handle = _kernel32().OpenProcess(access, False, pid)
    if not handle:
        raise OSError(ctypes.get_last_error(), f"OpenProcess({pid}) failed")
    return handle


def _read(handle, address: int, size: int) -> bytes:
    buffer, got = ctypes.create_string_buffer(size), ctypes.c_size_t()
    if not _kernel32().ReadProcessMemory(handle, ctypes.c_void_p(address), buffer, size, ctypes.byref(got)):
        raise OSError(ctypes.get_last_error(), "ReadProcessMemory failed")
    return buffer.raw[:got.value]


def _basic_information(handle) -> _ProcessBasicInformation:
    ntdll = ctypes.WinDLL("ntdll")
    info = _ProcessBasicInformation()
    status = ntdll.NtQueryInformationProcess(ctypes.c_void_p(handle), 0, ctypes.byref(info), ctypes.sizeof(info), None)
    if status != 0:
        raise OSError(status, "NtQueryInformationProcess failed")
    return info


def _pointer(handle, address: int) -> int:
    return int.from_bytes(_read(handle, address, 8), "little")


def process_strings(pid: int) -> tuple[str, str]:
    """(command line, environment block as NAME=value lines) read from another process's own memory."""
    handle = _open(pid, PROCESS_QUERY_INFORMATION | PROCESS_VM_READ)
    try:
        params = _pointer(handle, _basic_information(handle).PebBaseAddress + PEB_PARAMETERS)
        head = _read(handle, params + PARAMS_COMMAND_LINE, 16)
        length, buffer = int.from_bytes(head[:2], "little"), int.from_bytes(head[8:16], "little")
        command_line = _read(handle, buffer, length).decode("utf-16-le")
        env_size = _pointer(handle, params + PARAMS_ENVIRONMENT_SIZE)
        block = _read(handle, _pointer(handle, params + PARAMS_ENVIRONMENT), env_size).decode("utf-16-le", "replace")
    finally:
        _kernel32().CloseHandle(handle)
    return command_line, "\n".join(part for part in block.split("\0") if part)


def parent_pid(pid: int) -> int:
    handle = _open(pid, PROCESS_QUERY_LIMITED)
    try:
        return int(_basic_information(handle).InheritedFromUniqueProcessId)
    finally:
        _kernel32().CloseHandle(handle)


def image_path(pid: int) -> str:
    handle = _open(pid, PROCESS_QUERY_LIMITED)
    try:
        buffer, size = ctypes.create_unicode_buffer(32768), ctypes.c_ulong(32768)
        if not _kernel32().QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            raise OSError(ctypes.get_last_error(), "QueryFullProcessImageNameW failed")
        return buffer.value
    finally:
        _kernel32().CloseHandle(handle)


def process_parents() -> dict[int, int]:
    """{pid: parent pid} for every process, from one snapshot."""
    k = _kernel32()
    snapshot = k.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    entry, parents = _ProcessEntry(), {}
    entry.dwSize = ctypes.sizeof(_ProcessEntry)
    try:
        ok = k.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            ok = k.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        k.CloseHandle(snapshot)
    return parents


def child_pids(pid: int) -> list[int]:
    """The processes whose parent is `pid` (one level: the venv launcher's real interpreter)."""
    return [child for child, parent in process_parents().items() if parent == pid]


def descendant_pids(root: int) -> set[int]:
    """`root` and every process that descends from it (children, grandchildren, and so on)."""
    parents = process_parents()
    found = {root}
    grew = True
    while grew:
        grew = False
        for child, parent in parents.items():
            if parent in found and child not in found:
                found.add(child)
                grew = True
    return found


def _terminate(pid: int) -> None:
    try:
        handle = _open(pid, PROCESS_TERMINATE)
    except OSError:
        return
    try:
        _kernel32().TerminateProcess(handle, 1)
    finally:
        _kernel32().CloseHandle(handle)


# ---------------------------------------------------------------- the global window and foreground watch

class WindowWatch:
    """Polls every 100 ms: a new visible top-level window, or a change of the foreground window, is a problem when it
    belongs to this test process or one of its descendants (the backends and job children a test starts). The same
    event from another program (the owner's desktop) is only a note: it says nothing about the code under test.
    The owner-run launch checks keep the global watch (every process) in the shell harness."""

    POLL_S = 0.1

    def __init__(self) -> None:
        self._user32 = ctypes.WinDLL("user32", use_last_error=True)
        self._user32.GetForegroundWindow.restype = ctypes.c_void_p
        self._problems: list[str] = []
        self.notes: list[str] = []
        self._stop = threading.Event()
        self._baseline: set[int] = set()
        self._foreground_hwnd: int | None = None
        self._thread = threading.Thread(target=self._run, name="nqt-window-watch", daemon=True)

    def _visible(self) -> dict[int, int]:
        """{window handle: owning pid} for every visible top-level window."""
        found: dict[int, int] = {}
        proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def each(hwnd, _param):
            if self._user32.IsWindowVisible(ctypes.c_void_p(hwnd)):
                pid = ctypes.c_ulong()
                self._user32.GetWindowThreadProcessId(ctypes.c_void_p(hwnd), ctypes.byref(pid))
                found[int(hwnd)] = int(pid.value)
            return True

        self._user32.EnumWindows(proc(each), None)
        return found

    def _foreground(self) -> tuple[int, int]:
        """(handle, owning pid) of the foreground window (0, 0 when there is none)."""
        hwnd = self._user32.GetForegroundWindow()
        if not hwnd:
            return 0, 0
        pid = ctypes.c_ulong()
        self._user32.GetWindowThreadProcessId(ctypes.c_void_p(hwnd), ctypes.byref(pid))
        return int(hwnd), int(pid.value)

    def _own_tree(self) -> set[int]:
        return descendant_pids(os.getpid())

    def start(self) -> "WindowWatch":
        self._baseline = set(self._visible())
        self._foreground_hwnd = self._foreground()[0]
        self._thread.start()
        return self

    def _record(self, own: bool, text: str) -> None:
        (self._problems if own else self.notes).append(text)

    def poll_once(self) -> None:
        fresh = {hwnd: pid for hwnd, pid in self._visible().items() if hwnd not in self._baseline}
        hwnd_front, pid_front = self._foreground()
        if not fresh and hwnd_front == self._foreground_hwnd:
            return
        tree = self._own_tree()
        for hwnd, pid in fresh.items():
            self._baseline.add(hwnd)
            self._record(pid in tree, f"new visible window {hwnd:#x} (pid {pid})")
        if hwnd_front != self._foreground_hwnd:
            self._record(pid_front in tree,
                         f"foreground changed {self._foreground_hwnd} -> {hwnd_front} (pid {pid_front})")
            self._foreground_hwnd = hwnd_front

    def _run(self) -> None:
        while not self._stop.wait(self.POLL_S):
            self.poll_once()

    def stop(self) -> list[str]:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=5)
        return list(self._problems)


class AuthedTestClient(TestClient):
    """A TestClient that holds a session minted through the real session routes and sends a same-origin Origin on
    every request that is not GET or HEAD (unless the test gives its own).

    The session is minted by a separate loopback client (`session_cookie`), so a client built with another peer
    address or host still carries a live cookie and is refused only by the check the test is about."""

    def __init__(self, app, *, origin: str | None = None, base_url: str = LOCAL, client=LOOPBACK, **kwargs) -> None:
        super().__init__(app, base_url=base_url, client=client, **kwargs)
        self.origin = origin or default_origin(app)

    def mint_session(self) -> str:
        name, value = session_cookie(self.app, self.origin)
        self.cookies.set(name, value)
        return name

    def request(self, method: str, url, **kwargs):  # type: ignore[override]
        if method.upper() not in ("GET", "HEAD"):
            headers = dict(kwargs.pop("headers", None) or {})
            if not any(name.lower() == "origin" for name in headers):
                headers["Origin"] = self.origin
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


def default_origin(app) -> str:
    """The page origin of a backend: 127.0.0.1 on the port its runtime reports (the bound port)."""
    from nq_terminal.desktop import lifecycle

    return f"http://127.0.0.1:{lifecycle.runtime(app).port}"


def bare_client(app, *, base_url: str = LOCAL, client=LOOPBACK, **kwargs) -> TestClient:
    """A client with NO session: only for tests of the refusals, the proof and the session routes themselves."""
    return TestClient(app, base_url=base_url, client=client, **kwargs)


def session_cookie(app, origin: str | None = None) -> tuple[str, str]:
    """(cookie name, value) of a session for `origin`, minted through GET /api/session with the app's token."""
    from nq_terminal.desktop import lifecycle, sessions

    origin = origin or default_origin(app)
    token = lifecycle.runtime(app).token
    minter = bare_client(app)
    try:
        r = minter.get("/api/session", headers={"Authorization": f"NQT {token}", "X-NQT-Origin": origin})
    finally:
        minter.close()
    assert r.status_code == 200, f"the session routes refused the shared client ({r.status_code}): {r.text}"
    name = r.json()["cookie"]
    value = r.cookies.get(name)
    assert name == sessions.cookie_name(lifecycle.runtime(app).port) and value
    return name, value


def api_client(app, *, origin: str | None = None, **kwargs) -> AuthedTestClient:
    """The shared authenticated client: a TestClient (loopback peer, base http://127.0.0.1 unless given) that holds
    a live session for `origin` (default `default_origin(app)`). Every test that talks to an app uses this."""
    made = AuthedTestClient(app, origin=origin, **kwargs)
    made.mint_session()
    return made


@pytest.fixture
def lock_dir(request: pytest.FixtureRequest) -> Path:
    """A fresh state folder under D:/dev/tmp for one lock test (the system temp when D:/dev/tmp is absent)."""
    folder = fresh_lock_dir(request.node.name)
    try:
        yield folder
    finally:
        remove_lock_dir(folder)


@pytest.fixture
def window_watch():
    """Fails the test when a process of this test's own tree shows a new top-level window or takes the foreground.
    Windows and focus changes of other programs are noted in the run summary, not failed."""
    watch = WindowWatch().start()
    try:
        yield watch
    finally:
        problems = watch.stop()
        if watch.notes:
            _NOTES.append(f"window watch: {len(watch.notes)} window or focus changes by other programs ignored")
    assert not problems, "windows or focus changed during the test: " + "; ".join(problems)


@pytest.fixture
def authed_client():
    """The shared authenticated client as a fixture: `authed_client(app, origin=None, **TestClient kwargs)`; every
    client it made is closed after the test."""
    made: list[AuthedTestClient] = []

    def make(app, *, origin: str | None = None, **kwargs) -> AuthedTestClient:
        client = api_client(app, origin=origin, **kwargs)
        made.append(client)
        return client

    try:
        yield make
    finally:
        for client in made:
            client.close()


def pytest_terminal_summary(terminalreporter):
    for note in _NOTES:
        terminalreporter.write_line(f"research guard note: {note}")
