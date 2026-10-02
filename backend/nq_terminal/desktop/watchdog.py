"""The stdin watchdog (03 sections 2.3 and 2.4; 02 C1-8): end of file on stdin means the parent is gone.

`__main__.py` wires the stdin reader to `on_eof()`, and registers a close hook that stops the server, so a backend the
shell or a launcher started ends when its parent closes the pipe. `on_eof()` runs the registered close hooks in the
order they were added, which in production is:

1. `__main__`'s hook (added when the server starts to run) sets the server's exit flag; the lifespan then closes the
   app's services and releases the lock (`desktop/lifecycle.py`), and the process exits.
2. `watch_jobs(service)` adds the hook that calls `JobService.close()` with the watchdog's own grace period: terminate
   the running child, kill it if it is still alive after `JOB_KILL_AFTER_S`, and wait at most `JOB_JOIN_S` for the
   worker. `api/jobs.get_service` registers it when it creates the service, lazily on the first `/api/jobs` request,
   so after `__main__`'s hook, in a backend that reads stdin.

The whole stop is meant to fit in `STOP_WITHIN_S`. The net under it is a hard exit: once `arm_hard_exit()` has been
called (by `__main__`, never by a plain `on_eof()` call, so an in-process test cannot end the test run), end of file
also starts a daemon timer that ends the process with `os._exit(EXIT_HARD)` if it is still alive after
`STOP_WITHIN_S`. The lock's handle goes with the process, so the next start finds a stale lock and replaces it.
"""
from __future__ import annotations

import functools
import logging
import os
import threading
import time
from collections.abc import Callable
from typing import Any

STOP_WITHIN_S = 5.0
JOB_KILL_AFTER_S = 1.0
JOB_JOIN_S = 2.0
EXIT_HARD = 5
LOG = logging.getLogger("nq_terminal.desktop")
CloseHook = Callable[[], None]
ExitFn = Callable[[int], Any]

_HOOKS: list[CloseHook] = []
_GUARD = threading.Lock()
_HARD_EXIT: tuple[ExitFn, float] | None = None


def add_close_hook(hook: CloseHook) -> None:
    """Run `hook` at end of file, after the hooks added before it."""
    with _GUARD:
        _HOOKS.append(hook)


def remove_close_hook(hook: CloseHook) -> None:
    with _GUARD:
        if hook in _HOOKS:
            _HOOKS.remove(hook)


def close_hooks() -> tuple[CloseHook, ...]:
    with _GUARD:
        return tuple(_HOOKS)


@functools.cache
def _peek_named_pipe() -> Callable[..., int]:
    """kernel32's PeekNamedPipe with its types declared (Windows only; called once)."""
    import ctypes
    from ctypes import wintypes

    peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
    peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, wintypes.LPDWORD, wintypes.LPDWORD,
                     wintypes.LPDWORD]
    peek.restype = wintypes.BOOL
    return peek


class PollingStdin:
    """A reader of the parent's pipe that never sits inside a blocking read of it (the stdin channel's stream).

    Why: on Windows a thread blocked in a synchronous `ReadFile` on the pipe holds that file object's lock, and any
    other thread that asks the same handle a question waits for it. Loading a Fortran-backed extension (scipy's BLAS
    and LAPACK run libgfortran's start-up, which looks at the standard handles) asks exactly that, so the first
    request that imported scipy.stats froze the whole backend until the parent closed its end (measured: 40 s, until
    stdin was closed, against 0.6 s without the reader). This reader asks `PeekNamedPipe` instead, sleeps
    `POLL_S` between looks and reads only bytes that are already there, so nothing blocks, and a closed pipe
    (`ERROR_BROKEN_PIPE`) is the end of file the watchdog needs within a fraction of a second. A descriptor that is not
    a pipe (a file, the null device) cannot hold a reader, so it is read normally.

    `readline(limit)` has the contract `StdinChannel` uses: a line (with its newline) of at most `limit` bytes, or
    `b""` at end of file."""

    POLL_S = 0.05
    BROKEN_PIPE = 109  # ERROR_BROKEN_PIPE

    def __init__(self, fd: int = 0, poll_s: float = POLL_S) -> None:
        self._fd, self._poll_s = fd, poll_s
        self._buffer = b""
        self._eof = False

    def _pending(self) -> int | None:
        """Bytes waiting in the pipe; None when it is closed; -1 when this descriptor is not a pipe."""
        if os.name != "nt":
            return -1
        import ctypes
        import msvcrt
        from ctypes import wintypes

        available = wintypes.DWORD(0)
        if _peek_named_pipe()(msvcrt.get_osfhandle(self._fd), None, 0, None, ctypes.byref(available), None):
            return int(available.value)
        return None if ctypes.get_last_error() == self.BROKEN_PIPE else -1

    def _fill(self, want: int) -> None:
        """Add what is available now (waiting `poll_s` when nothing is) to the buffer; sets `_eof` at end of file."""
        pending = self._pending()
        if pending is None:
            self._eof = True
        elif pending == 0:
            time.sleep(self._poll_s)
        else:  # data is there, or this is not a pipe and a plain read is safe
            chunk = os.read(self._fd, want if pending < 0 else min(pending, want))
            self._buffer += chunk
            self._eof = not chunk

    def readline(self, limit: int = -1) -> bytes:
        cap = limit if limit and limit > 0 else 1 << 16
        while b"\n" not in self._buffer[:cap] and len(self._buffer) < cap and not self._eof:
            self._fill(cap - len(self._buffer))
        end = self._buffer.find(b"\n") + 1 if b"\n" in self._buffer[:cap] else min(len(self._buffer), cap)
        line, self._buffer = self._buffer[:end], self._buffer[end:]
        return line


def watch_jobs(service: Any) -> CloseHook:
    """Close `service` (terminate, then kill after the grace period) at end of file; returns the hook added."""

    def close_jobs() -> None:
        service.close(kill_after_s=JOB_KILL_AFTER_S, join_s=JOB_JOIN_S)

    add_close_hook(close_jobs)
    return close_jobs


def arm_hard_exit(exit_fn: ExitFn = os._exit, after_s: float = STOP_WITHIN_S) -> None:
    """From now on, end of file ends the process by `exit_fn(EXIT_HARD)` if it is still alive after `after_s`."""
    global _HARD_EXIT
    with _GUARD:
        _HARD_EXIT = (exit_fn, after_s)


def disarm_hard_exit() -> None:
    global _HARD_EXIT
    with _GUARD:
        _HARD_EXIT = None


def hard_exit_armed() -> bool:
    with _GUARD:
        return _HARD_EXIT is not None


def _start_hard_exit_timer() -> None:
    with _GUARD:
        armed = _HARD_EXIT
    if armed is None:
        return
    exit_fn, after_s = armed

    def stop_now() -> None:
        LOG.error("the backend did not stop within %.1f s of the parent closing stdin: ending the process", after_s)
        exit_fn(EXIT_HARD)

    timer = threading.Timer(after_s, stop_now)
    timer.daemon = True
    timer.start()


def on_eof() -> None:
    """The parent closed stdin: run every close hook once, in order. A failing hook is logged, never raised.

    The hard-exit timer starts first, so a hook that never returns cannot keep the process alive."""
    LOG.info("stdin closed: stopping the backend")
    _start_hard_exit_timer()
    for hook in close_hooks():
        try:
            hook()
        except Exception:  # noqa: BLE001  one broken hook must not keep the backend alive
            LOG.exception("a close hook failed")
