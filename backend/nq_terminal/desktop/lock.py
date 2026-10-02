"""One backend per lab: `<state_dir>/backend.lock`, created owner-only and held open for the backend's life.

03 sections 2.1 and 2.2, 05 X02 and T07; the review 2 form of the lock:

- Creation. `CreateFileW` with `CREATE_NEW` and a `SECURITY_ATTRIBUTES` whose descriptor is a protected DACL (the
  current user, SYSTEM and Administrators, full control each, inheritance off), so the file never exists with the
  inherited rights of its folder, even on D: (a later `SetSecurityInfo` would leave such a window).
- Holding. The creating handle (read, write and delete access) stays open until the backend stops, with share mode
  `FILE_SHARE_READ` only: the shell and the launchers can read pid, port and token (they open for reading and share
  read, write and delete), but no other handle can write the file, delete it or open it for DELETE.
- Liveness. A lock is live while an open of the file for DELETE fails with a sharing violation. When that open
  succeeds, the process that held it has ended (its handle is gone): the lock is stale, so it is deleted and created
  again with `CREATE_NEW`. If that create fails, another start won the race and this start attaches.
- Trust. A reader accepts the file only when the handle it reads through names this user (or SYSTEM or Administrators)
  as owner and carries the protected owner-only DACL; anything else is `LockUntrusted` (no attach, no replacement, the
  message names the file). The shell's `reads.rs` makes the same two checks on the handle it reads through.
- Release. The holder marks its own handle delete-on-close (POSIX semantics where the volume has them) and closes it,
  so the name goes away with the handle and a racing start can never delete a newer lock by name.
- Contents: one JSON object, `{"v", "pid", "port", "token", "root", "started"}`. The token is the backend's master
  secret; it is never in a repr, a log line or an exception message.

Every native call that takes a path gets it from `lock_file_text(state_dir)` (the safety AST test confines this
module's writes to that name), and the create and the delete first raise the matching `open` and `os.remove` audit
events, so the test session's research guard refuses a lock under the real terminal/state.
"""
from __future__ import annotations

import ctypes
import json
import os
import re
import sys
import time
from ctypes import wintypes
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOCK_NAME = "backend.lock"
LOCK_VERSION = 1
MAX_LOCK_BYTES = 64 * 1024
CREATE_ATTEMPTS = 8
READ_ATTEMPTS = 50
RETRY_S = 0.02

GENERIC_READ, GENERIC_WRITE, DELETE, READ_CONTROL = 0x80000000, 0x40000000, 0x00010000, 0x00020000
FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_SHARE_DELETE = 0x1, 0x2, 0x4
SHARE_ALL = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
CREATE_NEW, OPEN_EXISTING = 1, 3
FILE_ATTRIBUTE_NORMAL = 0x80
ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_ACCESS_DENIED = 2, 3, 5
ERROR_SHARING_VIOLATION, ERROR_FILE_EXISTS = 32, 80
FILE_DISPOSITION_INFO_CLASS, FILE_DISPOSITION_INFO_EX_CLASS = 4, 21
FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS = 0x1, 0x2
SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, DACL_SECURITY_INFORMATION, SDDL_REVISION_1 = 1, 0x1, 0x4, 1
TOKEN_QUERY, TOKEN_USER_CLASS = 0x0008, 1
# Well-known SIDs as SDDL writes them: SYSTEM and the built-in Administrators group.
SYSTEM_SID, ADMINISTRATORS_SID = "SY", "BA"
_ACE = re.compile(r"\(([^()]*)\)")


class LockError(OSError):
    """The lock could not be created, read or released for a reason other than a live holder."""


class LockUntrusted(LockError):
    """A lock file exists that its owner and rights do not vouch for (someone else made it): never attach, never replace.

    The message names the file only; nothing the file says (pid, port, token, root) is in it."""

    def __init__(self, path: Path, why: str) -> None:
        super().__init__(f"{path} is untrusted ({why}); not attaching and not replacing it")
        self.path = path


class LockHeld(Exception):
    """A live backend holds the lock; `info` is what its file says (None when it could not be read in time)."""

    def __init__(self, path: Path, info: "LockInfo | None") -> None:
        port = info.port if info is not None else "unknown"
        super().__init__(f"a live backend holds {path} (port {port})")
        self.path, self.info = path, info


@dataclass(frozen=True)
class LockInfo:
    pid: int
    port: int
    token: str = field(repr=False)
    root: str
    started: str

    def to_json(self) -> str:
        return json.dumps({"v": LOCK_VERSION, **asdict(self)}, separators=(",", ":"))

    @classmethod
    def from_json(cls, text: str) -> "LockInfo | None":
        try:
            doc = json.loads(text)
            info = cls(pid=int(doc["pid"]), port=int(doc["port"]), token=str(doc["token"]), root=str(doc["root"]),
                       started=str(doc["started"]))
        except (ValueError, TypeError, KeyError):
            return None
        return info if doc.get("v") == LOCK_VERSION else None


class _SecurityAttributes(ctypes.Structure):
    _fields_ = [("nLength", wintypes.DWORD), ("lpSecurityDescriptor", wintypes.LPVOID),
                ("bInheritHandle", wintypes.BOOL)]


class _DispositionEx(ctypes.Structure):
    _fields_ = [("Flags", wintypes.ULONG)]


class _Disposition(ctypes.Structure):
    _fields_ = [("DeleteFile", wintypes.BOOLEAN)]


class _Win32:
    """The kernel32 and advapi32 calls this module needs, with their argument types, loaded on first use."""

    def __init__(self) -> None:
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        a = ctypes.WinDLL("advapi32", use_last_error=True)
        k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.POINTER(_SecurityAttributes), wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        k.CreateFileW.restype = wintypes.HANDLE
        k.WriteFile.argtypes = [wintypes.HANDLE, wintypes.LPCVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                                wintypes.LPVOID]
        k.ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                               wintypes.LPVOID]
        k.FlushFileBuffers.argtypes = [wintypes.HANDLE]
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        k.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
        k.LocalFree.argtypes = [wintypes.HLOCAL]
        k.LocalFree.restype = wintypes.HLOCAL
        k.GetCurrentProcess.restype = wintypes.HANDLE
        a.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.ULONG)]
        a.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID),
            ctypes.POINTER(wintypes.ULONG)]
        a.GetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD, wintypes.LPVOID, wintypes.LPVOID,
                                      wintypes.LPVOID, wintypes.LPVOID, ctypes.POINTER(wintypes.LPVOID)]
        a.GetSecurityInfo.restype = wintypes.DWORD
        a.GetNamedSecurityInfoW.argtypes = [wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD, wintypes.LPVOID,
                                            wintypes.LPVOID, wintypes.LPVOID, wintypes.LPVOID,
                                            ctypes.POINTER(wintypes.LPVOID)]
        a.GetNamedSecurityInfoW.restype = wintypes.DWORD
        a.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        a.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD,
                                          ctypes.POINTER(wintypes.DWORD)]
        a.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPVOID)]
        self.kernel32, self.advapi32 = k, a


_API: _Win32 | None = None
_INVALID = wintypes.HANDLE(-1).value


def _api() -> _Win32:
    global _API
    if sys.platform != "win32":
        raise LockError("the backend lock is implemented for Windows only in this stage")
    if _API is None:
        _API = _Win32()
    return _API


def _fail(what: str) -> LockError:
    code = ctypes.get_last_error()
    return LockError(code, f"{what} failed: {ctypes.FormatError(code).strip()}")


def _local_text(pointer: wintypes.LPVOID) -> str:
    try:
        return ctypes.wstring_at(pointer)
    finally:
        _api().kernel32.LocalFree(pointer)


# ---------------------------------------------------------------- paths and rights

def lock_path(state_dir: Path) -> Path:
    return Path(state_dir) / LOCK_NAME


def lock_file_text(state_dir: Path) -> str:
    """The lock file's path as text, the only path this module's native calls receive."""
    return os.fspath(lock_path(state_dir))


def lock_folder(state_dir: Path) -> Path:
    """The state folder itself, the only folder this module may create (see `ensure_folder`)."""
    return Path(state_dir)


def ensure_folder(state_dir: Path) -> None:
    """Make the state folder when it is missing: the default `terminal/state` is git-ignored, so a fresh lab has none.

    A given NQT_STATE_DIR that does not exist is refused earlier, in settings; only the default reaches this."""
    folder = lock_folder(state_dir)
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise LockError(exc.errno or 0, f"creating the state folder {folder} failed: {exc.strerror or exc}") from exc


def current_user_sid() -> str:
    """The string SID of the user this process runs as (the token's user, not its owner group)."""
    api = _api()
    token = wintypes.HANDLE()
    if not api.advapi32.OpenProcessToken(api.kernel32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(token)):
        raise _fail("OpenProcessToken")
    try:
        size = wintypes.DWORD()
        api.advapi32.GetTokenInformation(token, TOKEN_USER_CLASS, None, 0, ctypes.byref(size))
        buffer = ctypes.create_string_buffer(size.value)
        if not api.advapi32.GetTokenInformation(token, TOKEN_USER_CLASS, buffer, size, ctypes.byref(size)):
            raise _fail("GetTokenInformation")
        sid = ctypes.cast(buffer, ctypes.POINTER(wintypes.LPVOID))[0]  # TOKEN_USER.User.Sid comes first
        text = wintypes.LPVOID()
        if not api.advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise _fail("ConvertSidToStringSidW")
        return _local_text(text)
    finally:
        api.kernel32.CloseHandle(token)


def owner_only_sddl(user_sid: str | None = None) -> str:
    """Protected DACL (`P`): full control for the user, SYSTEM and Administrators, and no inherited entry."""
    user = user_sid or current_user_sid()
    return f"D:P(A;;FA;;;{user})(A;;FA;;;{SYSTEM_SID})(A;;FA;;;{ADMINISTRATORS_SID})"


def is_owner_only(sddl: str, user_sid: str) -> bool:
    """True when an SDDL DACL is protected and allows only the user, SYSTEM and Administrators, none inherited."""
    head = sddl.split("(", 1)[0]
    if not head.startswith("D:") or "P" not in head[2:]:
        return False
    aces = _ACE.findall(sddl)
    allowed = {user_sid.upper(), SYSTEM_SID, ADMINISTRATORS_SID}
    for ace in aces:
        parts = ace.split(";")
        if len(parts) < 6 or parts[0] != "A" or "ID" in parts[1] or parts[5].upper() not in allowed:
            return False
    return bool(aces)


def is_trusted_owner(owner: str, user_sid: str) -> bool:
    """True when an SDDL owner (`S-1-5-...` or an alias) is the user, SYSTEM or Administrators: nobody else's file."""
    return owner.upper() in {user_sid.upper(), SYSTEM_SID, ADMINISTRATORS_SID}


def _sddl_of(descriptor: wintypes.LPVOID, part: int = DACL_SECURITY_INFORMATION) -> str:
    api, text, length = _api(), wintypes.LPVOID(), wintypes.ULONG()
    try:
        if not api.advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor, SDDL_REVISION_1, part, ctypes.byref(text), ctypes.byref(length)):
            raise _fail("ConvertSecurityDescriptorToStringSecurityDescriptorW")
        return _local_text(text)
    finally:
        api.kernel32.LocalFree(descriptor)


def _handle_sddl(handle: int, part: int) -> str:
    descriptor = wintypes.LPVOID()
    code = _api().advapi32.GetSecurityInfo(handle, SE_FILE_OBJECT, part, None, None, None, None,
                                           ctypes.byref(descriptor))
    if code:
        raise LockError(code, f"GetSecurityInfo failed: {ctypes.FormatError(code).strip()}")
    return _sddl_of(descriptor, part)


def handle_dacl_sddl(handle: int) -> str:
    """The DACL of an open handle (GetSecurityInfo), in SDDL form."""
    return _handle_sddl(handle, DACL_SECURITY_INFORMATION)


def handle_owner(handle: int) -> str:
    """The owner of an open handle (GetSecurityInfo), as an SDDL SID or alias without the `O:` prefix."""
    return _handle_sddl(handle, OWNER_SECURITY_INFORMATION).removeprefix("O:")


def file_dacl_sddl(path: Path) -> str:
    """The DACL of a file by name (GetNamedSecurityInfoW, read only), in SDDL form."""
    descriptor = wintypes.LPVOID()
    code = _api().advapi32.GetNamedSecurityInfoW(os.fspath(path), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None,
                                                 None, None, None, ctypes.byref(descriptor))
    if code:
        raise LockError(code, f"GetNamedSecurityInfoW failed: {ctypes.FormatError(code).strip()}")
    return _sddl_of(descriptor)


# ---------------------------------------------------------------- native create, read and delete

def create_new_protected(state_dir: Path) -> int | None:
    """Create the lock file with CREATE_NEW and the owner-only DACL; its handle, or None when the name exists."""
    api = _api()
    target = lock_file_text(state_dir)
    sys.audit("open", target, "xb", os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    descriptor = wintypes.LPVOID()
    if not api.advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            owner_only_sddl(), SDDL_REVISION_1, ctypes.byref(descriptor), None):
        raise _fail("ConvertStringSecurityDescriptorToSecurityDescriptorW")
    try:
        attributes = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), descriptor, False)
        handle = api.kernel32.CreateFileW(target, GENERIC_READ | GENERIC_WRITE | DELETE, FILE_SHARE_READ,
                                          ctypes.byref(attributes), CREATE_NEW, FILE_ATTRIBUTE_NORMAL, None)
        error = ctypes.get_last_error()
    finally:
        api.kernel32.LocalFree(descriptor)
    if handle != _INVALID:
        return handle
    if error in (ERROR_FILE_EXISTS, ERROR_ACCESS_DENIED):  # access denied: a delete is still pending on the name
        return None
    raise LockError(error, f"creating {target} failed: {ctypes.FormatError(error).strip()}")


def close_and_delete(handle: int) -> None:
    """Mark an open handle (opened with DELETE access) delete-on-close, then close it."""
    api = _api()
    posix = _DispositionEx(FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS)
    try:
        if not api.kernel32.SetFileInformationByHandle(handle, FILE_DISPOSITION_INFO_EX_CLASS, ctypes.byref(posix),
                                                       ctypes.sizeof(posix)):
            plain = _Disposition(True)  # a volume without POSIX delete semantics
            if not api.kernel32.SetFileInformationByHandle(handle, FILE_DISPOSITION_INFO_CLASS, ctypes.byref(plain),
                                                           ctypes.sizeof(plain)):
                raise _fail("marking the lock for deletion")
    finally:
        api.kernel32.CloseHandle(handle)


def _write_all(handle: int, data: bytes) -> None:
    api, written = _api(), wintypes.DWORD()
    if not api.kernel32.WriteFile(handle, data, len(data), ctypes.byref(written), None) or written.value != len(data):
        raise _fail("writing the lock")
    if not api.kernel32.FlushFileBuffers(handle):
        raise _fail("FlushFileBuffers")


def _open_existing(state_dir: Path, access: int) -> tuple[int | None, int]:
    target = lock_file_text(state_dir)
    handle = _api().kernel32.CreateFileW(target, access, SHARE_ALL, None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None)
    error = ctypes.get_last_error()
    return (handle, 0) if handle != _INVALID else (None, error)


def _vouched_for(handle: int) -> str | None:
    """Why the open file cannot be trusted (read from this very handle, so the name cannot be swapped), else None."""
    user = current_user_sid()
    owner = handle_owner(handle)
    if not is_trusted_owner(owner, user):
        return "its owner is not this user"
    if not is_owner_only(handle_dacl_sddl(handle), user):
        return "its rights are not owner-only"
    return None


def read_text(state_dir: Path) -> str | None:
    """The lock file's text, read while sharing read, write and delete with its holder; None when there is none.

    The file is trusted only when its owner is this user (or SYSTEM or Administrators) and its DACL is the protected
    owner-only one, both read from the handle that reads the text; otherwise LockUntrusted (05 X02): a file another
    principal made in a folder it can write to must never be attached to, and a live one is never replaced."""
    handle, error = _open_existing(state_dir, GENERIC_READ | READ_CONTROL)
    if handle is None:
        if error in (ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_ACCESS_DENIED):
            return None
        raise LockError(error, f"reading the lock failed: {ctypes.FormatError(error).strip()}")
    api = _api()
    try:
        why = _vouched_for(handle)
        if why is not None:
            raise LockUntrusted(lock_path(state_dir), why)
        buffer, got = ctypes.create_string_buffer(MAX_LOCK_BYTES), wintypes.DWORD()
        if not api.kernel32.ReadFile(handle, buffer, MAX_LOCK_BYTES, ctypes.byref(got), None):
            raise _fail("ReadFile")
        return buffer.raw[:got.value].decode("utf-8", errors="replace")
    finally:
        api.kernel32.CloseHandle(handle)


def read_info(state_dir: Path) -> LockInfo | None:
    text = read_text(state_dir)
    return LockInfo.from_json(text) if text else None


def _clear_if_stale(state_dir: Path) -> str:
    """'live' when the holder's handle is open; 'gone' after deleting a stale file (or finding none)."""
    handle, error = _open_existing(state_dir, DELETE)
    if handle is None:
        if error == ERROR_SHARING_VIOLATION:
            return "live"
        if error in (ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_ACCESS_DENIED):
            return "gone"  # access denied: a delete is pending, the name is on its way out
        raise LockError(error, f"checking the lock failed: {ctypes.FormatError(error).strip()}")
    sys.audit("os.remove", lock_file_text(state_dir), -1)
    close_and_delete(handle)
    return "gone"


def is_live(state_dir: Path) -> bool:
    """True while a holder keeps the lock open (an open for DELETE fails with a sharing violation)."""
    handle, error = _open_existing(state_dir, DELETE)
    if handle is not None:
        _api().kernel32.CloseHandle(handle)
        return False
    if error == ERROR_SHARING_VIOLATION:
        return True
    if error in (ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_ACCESS_DENIED):
        return False
    raise LockError(error, f"checking the lock failed: {ctypes.FormatError(error).strip()}")


def probe(state_dir: Path) -> LockInfo | None:
    """What a live lock says (waiting briefly for a holder that is still writing it), or None when there is none."""
    if not is_live(state_dir):
        return None
    return _read_live(state_dir)


def _read_live(state_dir: Path) -> LockInfo | None:
    for _ in range(READ_ATTEMPTS):
        info = read_info(state_dir)
        if info is not None or not is_live(state_dir):
            return info
        time.sleep(RETRY_S)
    return None


# ---------------------------------------------------------------- holding

class HeldLock:
    """The open lock. `release()` deletes the file with the handle; a crashed holder leaves a stale file."""

    def __init__(self, path: Path, handle: int, info: LockInfo) -> None:
        self.path, self.info, self._handle = path, info, handle

    def __repr__(self) -> str:
        return f"HeldLock({self.path}, pid={self.info.pid}, port={self.info.port})"

    @property
    def held(self) -> bool:
        return self._handle is not None

    def dacl_sddl(self) -> str:
        if self._handle is None:
            raise LockError("the lock is released")
        return handle_dacl_sddl(self._handle)

    def owner_sddl(self) -> str:
        if self._handle is None:
            raise LockError("the lock is released")
        return handle_owner(self._handle)

    def release(self) -> None:
        handle, self._handle = self._handle, None
        if handle is not None:
            close_and_delete(handle)

    def __enter__(self) -> "HeldLock":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.release()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def acquire(state_dir: Path, *, port: int, token: str, root: Path | str, pid: int | None = None) -> HeldLock:
    """Take the lock of `state_dir`, replacing a stale one; raise LockHeld when a live backend holds it."""
    folder = Path(state_dir)
    ensure_folder(folder)
    info = LockInfo(pid=os.getpid() if pid is None else pid, port=port, token=token, root=os.fspath(root),
                    started=_now())
    for _ in range(CREATE_ATTEMPTS):
        handle = create_new_protected(folder)
        if handle is not None:
            return _fill(folder, handle, info)
        if _clear_if_stale(folder) == "live":
            raise LockHeld(lock_path(folder), _read_live(folder))
        time.sleep(RETRY_S)
    raise LockError(f"could not take {lock_path(folder)} after {CREATE_ATTEMPTS} attempts")


def _fill(folder: Path, handle: int, info: LockInfo) -> HeldLock:
    try:
        _write_all(handle, info.to_json().encode("utf-8"))
    except BaseException:
        close_and_delete(handle)
        raise
    return HeldLock(lock_path(folder), handle, info)
