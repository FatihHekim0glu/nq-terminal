"""The preferred desktop port (startup.md 7.5, option a; owner decision O19, off by default).

A desktop backend binds port 0, so every launch is a new origin and neither WebView2's HTTP cache nor V8's code cache
can hit: the page's 107 files go through Python on every launch. With this setting on, the backend binds the port it
last bound when that port is free, so the origin stays the same between launches and the hashed files, served
`immutable` (security.py, `page_cache_control`), come from WebView2's own cache.

Files, both in the backend's state folder (`settings.state_dir`):

- `port_pref.json`, the setting: on only when it is a JSON object whose `preferred_port` is exactly `true`. Absent,
  unreadable, larger than `MAX_FILE_BYTES` or anything else: off. This module only reads it; the owner (or a harness
  run, in its own state folder) writes it.
- `last_port.json`, the record: `{"port": N}`, written by `remember` only while the setting is on, only when the port
  bound differs from the record, and only through a temporary file in the same folder and a replace.

Rules:

- Desktop mode only, and only when the settings' port is 0 (an explicit NQT_PORT, the launchers' 8765 and the browser
  form are never changed).
- A port is allowed only in the dynamic range 49152 to 65535 and never one of `NEVER_PORTS` (8765, the Vite dev port
  and the IB ports), so a planted or stale record can never choose them.
- The preferred port is bound with the same exclusive bind as port 0 (`__main__.bind_socket`), before the app is built;
  a busy or refused preferred port falls back to port 0 at once, and that port becomes the record.
- Nothing here raises for a bad file: a read problem means "no preference", a write problem is logged and the start
  goes on.
"""
from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

from nq_terminal.settings import DEFAULT_PORT, DEV_PORT, MODE_DESKTOP, Settings, inside_research_folder

SETTING_NAME = "port_pref.json"
SETTING_KEY = "preferred_port"
RECORD_NAME = "last_port.json"
RECORD_TEMP_NAME = "last_port.json.tmp"
RECORD_KEY = "port"
MAX_FILE_BYTES = 4096
PORT_LOW, PORT_HIGH = 49152, 65535  # the IANA dynamic range, Windows' default for port 0
IB_PORTS = frozenset({4001, 4002, 7496, 7497})  # TWS and the gateway, live and paper: never a terminal port
NEVER_PORTS = frozenset({DEFAULT_PORT, DEV_PORT}) | IB_PORTS
LOG = logging.getLogger(__name__)
# The bound listening socket. The module does not import `socket`: only `__main__` may (the IB read-only scan), and it
# makes the socket, so the type here is left open.
BoundSocket = Any
Binder = Callable[[Settings], BoundSocket]


def is_allowed(port: Any) -> bool:
    """True only for an int (not a bool) in 49152 to 65535 that is not one of `NEVER_PORTS`."""
    if type(port) is not int:
        return False
    return PORT_LOW <= port <= PORT_HIGH and port not in NEVER_PORTS


def _read_json(path: Path) -> Any:
    """The parsed file, or None when it is missing, too large, unreadable or not JSON."""
    try:
        with path.open("rb") as handle:
            data = handle.read(MAX_FILE_BYTES + 1)
    except OSError:
        return None
    if len(data) > MAX_FILE_BYTES:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None


def enabled(state_dir: Path) -> bool:
    """Whether `<state>/port_pref.json` turns the preferred port on (exactly `{"preferred_port": true}`)."""
    value = _read_json(Path(state_dir) / SETTING_NAME)
    return isinstance(value, dict) and value.get(SETTING_KEY) is True


def applies(settings: Settings) -> bool:
    """Desktop mode, port 0 asked for, and the setting on."""
    return settings.mode == MODE_DESKTOP and settings.port == 0 and enabled(settings.state_dir)


def _recorded(state_dir: Path) -> int | None:
    value = _read_json(Path(state_dir) / RECORD_NAME)
    port = value.get(RECORD_KEY) if isinstance(value, dict) else None
    return port if is_allowed(port) else None


def preferred(settings: Settings) -> int | None:
    """The port to try first, or None (port 0 as today)."""
    return _recorded(settings.state_dir) if applies(settings) else None


def bind(settings: Settings, binder: Binder) -> BoundSocket:
    """The bound socket: the preferred port when there is one and it is free, else `binder(settings)` as today.

    `binder` is `__main__.bind_socket` (exclusive use on 127.0.0.1). Only an OSError from the preferred bind falls back;
    a failure of the plain bind is raised as before."""
    port = preferred(settings)
    if port is not None:
        try:
            return binder(replace(settings, port=port))
        except OSError as exc:
            LOG.info("the preferred port %d is not free (%s); binding port 0", port, exc.__class__.__name__)
    return binder(settings)


def _record_folder(settings: Settings) -> Path:
    """The state folder itself, refused (ValueError) when it resolves inside a research folder of the lab."""
    folder = Path(settings.state_dir).resolve()
    if inside_research_folder(folder, Path(settings.root).resolve()):
        raise ValueError(f"the state folder is inside a research folder: {folder}")
    return folder


def _record_file(settings: Settings) -> Path:
    return _record_folder(settings) / RECORD_NAME


def _record_temp(settings: Settings) -> Path:
    return _record_folder(settings) / RECORD_TEMP_NAME


def remember(settings: Settings, port: int) -> bool:
    """Record `port` as the last bound one; True when the record was written.

    Nothing is written unless the setting applies, the port is allowed and differs from the record."""
    if not (applies(settings) and is_allowed(port)) or _recorded(settings.state_dir) == port:
        return False
    try:
        path = _record_file(settings)
        temp = _record_temp(settings)
    except (OSError, ValueError) as exc:
        LOG.warning("the preferred port could not be recorded (%s)", exc.__class__.__name__)
        return False
    try:
        temp.write_text(json.dumps({RECORD_KEY: port}), encoding="utf-8")
        os.replace(temp, path)
    except OSError as exc:
        LOG.warning("the preferred port could not be recorded (%s)", exc.__class__.__name__)
        try:
            temp.unlink(missing_ok=True)  # a failed replace must not leave the temporary file behind
        except OSError:
            LOG.info("the temporary port record could not be removed")
        return False
    return True
