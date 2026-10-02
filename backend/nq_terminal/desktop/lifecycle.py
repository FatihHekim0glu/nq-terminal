"""The backend's life in the app: the lock in the start-up, and the same-origin list from the bound port (03 2.1).

`install(app, settings)` wraps the app's lifespan so the lock of `settings.state_dir` is taken before the app's own
start-up runs and released after its own shutdown. Because it sits in the lifespan rather than in `__main__.py`, every
way of starting a backend takes it: `python -m nq_terminal`, `uvicorn nq_terminal.app:create_app`, `uvicorn --reload`
(each reload releases and retakes it) and the fixture entry. A live lock fails the start-up with `LockHeld` and records
what the lock says in `attach_info(app)`, so `__main__.py` can print `NQT-ATTACH` and exit 0.

The runtime (token, port, pid, nonce, mode) is what the lock, the READY line and the proof route agree on.
`__main__.py` sets it before the server starts (the token and nonce from stdin, the bound port); otherwise the first
use makes one with a fresh random token and the settings' port, as a backend started directly needs.

`origins(settings, bound_port)` is the list `SameOriginApiMiddleware` accepts: both loopback host names on the bound
port (the settings' port when no socket is bound yet; none for an unbound port 0), plus the Vite dev port only when
NQT_DEV=1 (start.ps1 -Dev).
"""
from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI

from nq_terminal.desktop import lock
from nq_terminal.desktop.lock import HeldLock, LockHeld, LockInfo
from nq_terminal.settings import ALLOWED_HOSTS, DEV_PORT, Settings

RUNTIME_KEY = "nqt_runtime"
LOCK_KEY = "nqt_lock"
ATTACH_KEY = "nqt_attach"
STARTED_KEY = "nqt_lifespan_started"  # set once the lifespan has taken the lock (never in a bare TestClient)
INSTALLED_KEY = "nqt_lifecycle_settings"  # the settings install() was given; also the installed mark
TOKEN_BYTES = 32


@dataclass(frozen=True)
class Runtime:
    token: str
    port: int
    pid: int
    nonce: str | None = None
    mode: str = "browser"

    def __repr__(self) -> str:  # the token is the backend's master secret: never in a repr or a log line
        return f"Runtime(port={self.port}, pid={self.pid}, mode={self.mode!r})"


def new_token() -> str:
    return secrets.token_hex(TOKEN_BYTES)


def set_runtime(app: FastAPI, runtime: Runtime) -> None:
    setattr(app.state, RUNTIME_KEY, runtime)


def runtime(app: FastAPI, settings: Settings | None = None) -> Runtime:
    """The app's runtime, made on first use with a fresh token and the settings' port when nothing set one."""
    current = getattr(app.state, RUNTIME_KEY, None)
    if current is None:
        chosen = settings or getattr(app.state, INSTALLED_KEY, None) or app.state.settings
        current = Runtime(token=new_token(), port=chosen.port, pid=os.getpid(), mode=chosen.mode)
        set_runtime(app, current)
    return current


def held_lock(app: FastAPI) -> HeldLock | None:
    return getattr(app.state, LOCK_KEY, None)


def lock_held_now(app: FastAPI) -> bool | None:
    """Whether this running backend holds its state folder's lock: True or False once the lifespan has started
    (a request is only served after the lock was taken, so False means it was released), None when no lifespan has
    run (an app driven in process without one)."""
    if not getattr(app.state, STARTED_KEY, False):
        return None
    return held_lock(app) is not None


def attach_info(app: FastAPI) -> LockInfo | None:
    return getattr(app.state, ATTACH_KEY, None)


def _take_lock(app: FastAPI, settings: Settings) -> HeldLock:
    current = runtime(app, settings)
    try:
        held = lock.acquire(settings.state_dir, port=current.port, token=current.token, root=settings.root,
                            pid=current.pid)
    except LockHeld as refused:
        setattr(app.state, ATTACH_KEY, refused.info)
        raise
    setattr(app.state, LOCK_KEY, held)
    setattr(app.state, STARTED_KEY, True)
    return held


Lifespan = Callable[[Any], AbstractAsyncContextManager[Any]]


def _wrap(original: Lifespan, settings: Settings) -> Lifespan:
    @asynccontextmanager
    async def lifespan(app: Any) -> AsyncIterator[Any]:
        held = _take_lock(app, settings)
        try:
            async with original(app) as state:
                yield state
        finally:
            setattr(app.state, LOCK_KEY, None)
            held.release()

    return lifespan


def install(app: FastAPI, settings: Settings) -> None:
    """Take the lock of `settings.state_dir` in the app's start-up and release it at shutdown. Idempotent."""
    if getattr(app.state, INSTALLED_KEY, None) is not None:
        return
    app.router.lifespan_context = _wrap(app.router.lifespan_context, settings)
    setattr(app.state, INSTALLED_KEY, settings)


def origins(settings: Settings, bound_port: int | None = None) -> frozenset[str]:
    """Same-origin list for the bound port (or the settings' port), with the dev port only under NQT_DEV=1."""
    port = bound_port if bound_port else settings.port
    ports = ([port] if port else []) + ([DEV_PORT] if settings.dev else [])
    return frozenset(f"http://{host}:{p}" for host in ALLOWED_HOSTS for p in ports)
