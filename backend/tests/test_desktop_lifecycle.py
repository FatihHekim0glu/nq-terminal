"""D2.1 (03 section 2.1): the lock is taken in the app's start-up, so every way of starting a backend takes it.

`lifecycle.install(app, settings)` wraps the app's lifespan: the lock is taken (keyed on NQT_STATE_DIR) before the
app's own start-up runs and released after its own shutdown. `lifecycle.origins(settings, bound_port)` is the
same-origin list built from the BOUND port, with the Vite dev port only under NQT_DEV=1 (start.ps1 -Dev). app.py calls
both (app.py does since the W2A merge), so the production app and `uvicorn nq_terminal.app:create_app` take the lock.
"""
from __future__ import annotations

import dataclasses
import re
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI

from nq_lab.config import ROOT
from nq_terminal.desktop import lifecycle, lock
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.desktop.lock import LockHeld
from nq_terminal.settings import DEV_PORT, SettingsError, load_settings

from conftest import (LOCAL, LOOPBACK, api_client, bare_client, desktop_env, fresh_lock_dir, remove_lock_dir,
                      spawn_backend, wait_until)

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows lock")


def _minimal(lock_dir: Path, events: list[str] | None = None) -> FastAPI:
    seen = events if events is not None else []

    @asynccontextmanager
    async def own_lifespan(app: FastAPI):
        seen.append(f"own start, lock {'held' if lock.is_live(lock_dir) else 'free'}")
        yield
        seen.append(f"own stop, lock {'held' if lock.is_live(lock_dir) else 'free'}")

    settings = load_settings({"NQT_STATE_DIR": str(lock_dir)})
    app = FastAPI(lifespan=own_lifespan)
    lifecycle.install(app, settings)
    return app


def test_install_takes_the_lock_at_start_up_and_releases_it_at_shutdown(lock_dir):
    events: list[str] = []
    app = _minimal(lock_dir, events)
    assert not (lock_dir / "backend.lock").exists()  # building the app takes nothing
    with bare_client(app, base_url=LOCAL, client=LOOPBACK):
        info = lock.read_info(lock_dir)
        runtime = lifecycle.runtime(app)
        assert (info.pid, info.token, info.root) == (runtime.pid, runtime.token, str(ROOT))
        assert lifecycle.held_lock(app) is not None
    assert events == ["own start, lock held", "own stop, lock held"]
    assert not (lock_dir / "backend.lock").exists() and lifecycle.held_lock(app) is None


def test_the_lock_records_the_runtime_port(lock_dir):
    app = _minimal(lock_dir)
    lifecycle.set_runtime(app, Runtime(token="aa" * 32, port=53117, pid=1, nonce=None, mode="desktop"))
    with bare_client(app, base_url=LOCAL, client=LOOPBACK):
        assert lock.read_info(lock_dir).port == 53117 and lock.read_info(lock_dir).token == "aa" * 32


def test_install_is_idempotent(lock_dir):
    events: list[str] = []
    app = _minimal(lock_dir, events)
    lifecycle.install(app, load_settings({"NQT_STATE_DIR": str(lock_dir)}))
    with bare_client(app, base_url=LOCAL, client=LOOPBACK):
        pass
    assert events == ["own start, lock held", "own stop, lock held"]


def test_a_live_lock_fails_the_start_up_and_records_the_attach(lock_dir):
    app = _minimal(lock_dir)
    with lock.acquire(lock_dir, port=53999, token="bb" * 32, root=ROOT):
        with pytest.raises(LockHeld):
            with bare_client(app, base_url=LOCAL, client=LOOPBACK):
                pass
        assert lifecycle.attach_info(app).port == 53999
    assert lifecycle.held_lock(app) is None


def test_the_default_runtime_has_a_fresh_token_and_this_process(lock_dir):
    a, b = _minimal(lock_dir), _minimal(lock_dir)
    ra, rb = lifecycle.runtime(a), lifecycle.runtime(b)
    assert re.fullmatch(r"[0-9a-f]{64}", ra.token) and ra.token != rb.token
    assert ra.port == 8765 and ra.nonce is None and ra.mode == "browser"
    assert lifecycle.runtime(a) is ra  # stable once made


# ---------------------------------------------------------------- origins from the bound port

def _settings(**env: str):
    return load_settings(env)


def test_origins_use_the_bound_port_not_port_0():
    origins = lifecycle.origins(_settings(NQT_DESKTOP="1", NQT_PORT="0"), 53117)
    assert origins == {"http://127.0.0.1:53117", "http://localhost:53117"}


def test_origins_omit_the_dev_port_unless_nqt_dev_is_1():
    assert f"http://localhost:{DEV_PORT}" not in lifecycle.origins(_settings(), None)
    assert f"http://127.0.0.1:{DEV_PORT}" not in lifecycle.origins(_settings(NQT_DEV="0"), None)
    dev = lifecycle.origins(_settings(NQT_DEV="1"), None)
    assert {f"http://127.0.0.1:{DEV_PORT}", f"http://localhost:{DEV_PORT}", "http://127.0.0.1:8765"} <= dev


def test_origins_fall_back_to_the_settings_port():
    assert lifecycle.origins(_settings(NQT_PORT="9001"), None) == {"http://127.0.0.1:9001", "http://localhost:9001"}


def test_an_unbound_port_0_gives_no_origin():
    assert lifecycle.origins(_settings(NQT_DESKTOP="1"), None) == frozenset()


# ---------------------------------------------------------------- the production app

def test_create_app_takes_the_lock_in_its_start_up(lock_dir):
    from nq_terminal.app import create_app

    app = create_app(load_settings({"NQT_STATE_DIR": str(lock_dir)}))
    with api_client(app, base_url=LOCAL, client=LOOPBACK):
        assert lock.is_live(lock_dir)
    assert not (lock_dir / "backend.lock").exists()


def test_create_app_starts_when_the_default_state_folder_does_not_exist_yet(lock_dir):
    """terminal/state is git-ignored and absent in a fresh clone: the start-up makes it, it does not fail."""
    from nq_terminal.app import create_app

    fresh = lock_dir / "state"  # settings leave the default folder unchecked: it may not exist yet
    assert not fresh.exists()
    app = create_app(dataclasses.replace(load_settings({"NQT_STATE_DIR": str(lock_dir)}), state_dir=fresh))
    with api_client(app, base_url=LOCAL, client=LOOPBACK):
        assert fresh.is_dir() and lock.is_live(fresh)
    assert fresh.is_dir() and not (fresh / "backend.lock").exists()


def test_a_given_state_folder_that_does_not_exist_is_still_refused(lock_dir):
    with pytest.raises(SettingsError):
        load_settings({"NQT_STATE_DIR": str(lock_dir / "absent")})


@pytest.mark.usefixtures("window_watch")
def test_uvicorn_nq_terminal_app_create_app_takes_the_lock(lock_dir):
    env = desktop_env(lock_dir)
    env.pop("NQT_DESKTOP")
    env.pop("NQT_PORT")
    args = ["-m", "uvicorn", "nq_terminal.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "0"]
    backend = spawn_backend(args, env)
    try:
        assert wait_until(lambda: "Uvicorn running on" in backend.stderr_text(), 90), backend.stderr_text()
        assert lock.is_live(lock_dir)
    finally:
        backend.stop(kill=True)


# ---------------------------------------------------------------- the test folder is removed even while a handle lingers

def test_a_lock_test_folder_is_removed_after_a_killed_backend_lets_go_of_its_file():
    """A killed backend's file handle can outlive the kill by a moment; the folder must still go (it left one behind)."""
    folder = fresh_lock_dir("lingering handle")
    handle = open(folder / "backend.lock", "wb")  # a plain open() holds the file against deletion on Windows
    threading.Timer(0.6, handle.close).start()
    remove_lock_dir(folder)
    assert not folder.exists()
