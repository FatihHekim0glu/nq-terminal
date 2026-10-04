"""Arrow's memory pool: the platform allocator in every form (W5C D2).

pyarrow's default pool on Windows is mimalloc, which keeps the high-water mark of a load: a year of 1m bars read and
dropped left its pages with the process, which showed in the app's idle and start-up figures. `use_system_pool()`
switches the process to `pyarrow.system_memory_pool()`, which hands freed memory back to the operating system; the
cost measured was about 4 ms per year loaded.

`create_app` calls it first, so it covers `python -m nq_terminal`, the fixture entry (`desktop/fixture_main.py`), the
uvicorn factory backends and the tests, and it applies to the browser form too, which keeps the app and browser
comparison fair on allocator terms. It is set in code, not through an environment variable, so the shell's
allow-list needs none. The call is idempotent and never raises: when pyarrow refuses, or accepts the call but the
default pool is still not the system one, it logs one warning for the process (backend.log) and the default pool stays. It writes no file and starts no process.
"""
from __future__ import annotations

import logging
import threading

import pyarrow

SYSTEM_BACKEND = "system"
LOG = logging.getLogger("nq_terminal.allocator")
_lock = threading.Lock()
_warned = False


def use_system_pool() -> bool:
    """Make the system allocator pyarrow's default pool; True when it is (now or already), False when refused."""
    with _lock:
        try:
            if pyarrow.default_memory_pool().backend_name == SYSTEM_BACKEND:
                return True
            pyarrow.set_memory_pool(pyarrow.system_memory_pool())
            active = pyarrow.default_memory_pool().backend_name
            if active == SYSTEM_BACKEND:
                return True
            _warn_once("Arrow's default pool is still %s after set_memory_pool", active)
            return False
        except Exception as exc:  # noqa: BLE001 - a pool refusal must never stop the backend starting
            _warn_once("Arrow kept its default memory pool: %s", exc)
            return False


def _warn_once(message: str, *args: object) -> None:
    """One warning per process for a failed switch (the caller holds `_lock`)."""
    global _warned
    if not _warned:
        _warned = True
        LOG.warning(message, *args)
