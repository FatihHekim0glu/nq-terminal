"""System endpoints: GET /api/health.

Desktop fields (03 sections 4.4, 4.6 and 7.1): `contract` is the desktop contract number
(`contract/desktop_version.json`), `openapi_sha256` the full sha256 of `contract/openapi.json`, `dist` whether the
served page build is `current`, `stale` or `missing` (`desktop/build_stamp.py`), and `port_fixed` is true only for a
backend a browser launcher started on the fixed port 8765 (launcher mode, bound there), so the page copies full
addresses there and the portable `#go=` string everywhere else. The page polls health every 2 s, so the two file
reads are memoised for `BUILD_MEMO_S`.

Every check reuses nq-lab's own read-only functions (`oos_gate.check_openings_pin`,
`check_sealed_log_pin`, `load_openings`, `live_guards.kill_switch_on`); nothing is reimplemented and
nothing is written outside the state folder's cache.

The sealed-log pin (V032G, growth fix 1): the route checks it through the app's `services/sealed_log` tracker, which
parses only what was appended to the gate log since its last call (`gate_cursor.scan_sealed_log`, the same answer as
`check_sealed_log_pin`); it still hashes every byte before its cursor, streamed in 1 MiB pieces, so a changed log costs
about 27 ms at 43 MB (linear in the log) and an unchanged one nothing. The whole sealed block is memoised on the
(mtime_ns, size) of the log and the openings file. `sealed_status(settings)` without an app state keeps the
whole-file checks.

Gate counters: until the bar service exists (Phase 2.3) they read 0. The service publishes them by setting
`app.state.gate_stats` to a callable returning `(gate_reads, cached_series, cached_bytes)`.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from types import ModuleType
from typing import Callable, Literal

from fastapi import APIRouter, Request

from nq_lab import live_guards
from nq_lab.config import IS_END, IS_START
from nq_terminal.desktop import lifecycle
from nq_terminal.desktop.build_stamp import OPENAPI, dist_status, openapi_sha256
from nq_terminal.desktop.handshake import contract_number
from nq_terminal.models.common import CacheStats, Fence, Health, Pins, SealedStatus
from nq_terminal.services import sealed_log
from nq_terminal.settings import DEFAULT_PORT, MODE_LAUNCHER, Settings

router = APIRouter(prefix="/api", tags=["system"])

GateStats = tuple[int, int, int]
FIXED_BROWSER_PORT = DEFAULT_PORT  # the browser door's port (03 section 2.1); read at call time
BUILD_MEMO_S = 5.0


class DesktopHealth(Health):
    """Health plus the fields the shell and the page compare (03 sections 4.4, 4.6 and 7.1)."""

    contract: int
    openapi_sha256: str | None
    dist: Literal["current", "stale", "missing"]
    port_fixed: bool


_BUILD_MEMO: dict[Path, tuple[float, str | None, str]] = {}
_BUILD_GUARD = threading.Lock()


def reset_build_memo() -> None:
    with _BUILD_GUARD:
        _BUILD_MEMO.clear()


def build_state(web_dir: Path) -> tuple[str | None, str]:
    """(full sha256 of contract/openapi.json, dist status of `web_dir`), read at most once per BUILD_MEMO_S."""
    now = time.monotonic()
    with _BUILD_GUARD:
        cached = _BUILD_MEMO.get(web_dir)
    if cached is not None and now - cached[0] < BUILD_MEMO_S:
        return cached[1], cached[2]
    state = (openapi_sha256(OPENAPI), dist_status(web_dir, OPENAPI))
    with _BUILD_GUARD:
        _BUILD_MEMO[web_dir] = (now, *state)
    return state


def port_fixed(mode: str, port: int) -> bool:
    """True only for a launcher backend bound on the fixed browser port."""
    return mode == MODE_LAUNCHER and port == FIXED_BROWSER_PORT


def _oos_gate() -> ModuleType:
    """`nq_lab.oos_gate`, imported on first use so the start path does not load it (D1.1)."""
    from nq_lab import oos_gate

    return oos_gate


def installed_pins() -> Pins:
    return Pins(pandas=version("pandas"), pyarrow=version("pyarrow"),
                quantpad_data=version("quantpad-data"), nautilus=version("nautilus-trader"))


def fence() -> Fence:
    return Fence(is_start=IS_START.date().isoformat(), is_end=IS_END.date().isoformat())


def _pin_ok(check: Callable[[Path], None], path: Path) -> bool | None:
    """True when the gate's check passes, False when it refuses, None when the file cannot be read."""
    try:
        check(path)
    except _oos_gate().OOSAccessError:
        return False
    except (OSError, ValueError):
        return None
    return True


def _openings_closed(path: Path) -> bool | None:
    try:
        openings = _oos_gate().load_openings(path)
    except (OSError, ValueError):
        return None
    return all(entry.get("closed") is True for entry in openings)


def _sealed_now(settings: Settings, check_log: Callable[[Path], None]) -> SealedStatus:
    return SealedStatus(
        openings_pin_ok=_pin_ok(_oos_gate().check_openings_pin, settings.openings_path),
        sealed_log_pin_ok=_pin_ok(check_log, settings.oos_log_path),
        openings_closed=_openings_closed(settings.openings_path),
    )


def sealed_status(settings: Settings, state: object | None = None) -> SealedStatus:
    """The gate's pin checks. With the app's state: the log's pin from the app's cursor, and the block memoised on the
    log and the openings file; without: the whole-file checks."""
    if state is None:
        return _sealed_now(settings, _oos_gate().check_sealed_log_pin)
    tracker = sealed_log.tracker_for(state)
    return tracker.remember((settings.oos_log_path, settings.openings_path),
                            lambda: _sealed_now(settings, tracker.check_pin))


def gate_stats(state: object) -> GateStats:
    provider = getattr(state, "gate_stats", None)
    return provider() if callable(provider) else (0, 0, 0)


def build_health(settings: Settings, stats: GateStats, now: datetime | None = None,
                 state: object | None = None) -> Health:
    reads, series, cached_bytes = stats
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    pins = installed_pins()
    return Health(
        now_utc=stamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        nautilus_version=pins.nautilus,
        pins=pins,
        fence=fence(),
        sealed=sealed_status(settings, state),
        kill_switch_on=live_guards.kill_switch_on(str(settings.kill_switch_path)),
        gate_reads_this_process=reads,
        cache=CacheStats(series=series, bytes=cached_bytes),
        fixture_mode=settings.fixture_mode,
    )


def desktop_health(settings: Settings, stats: GateStats, bound_port: int, state: object | None = None) -> DesktopHealth:
    sha, dist = build_state(settings.web_dist.parent)
    return DesktopHealth(**build_health(settings, stats, state=state).model_dump(), contract=contract_number(),
                         openapi_sha256=sha, dist=dist, port_fixed=port_fixed(settings.mode, bound_port))


@router.get("/health", response_model=DesktopHealth)
def health(request: Request) -> DesktopHealth:
    """Versions, the in-sample fence, sealed-window pin status, kill switch, gate counters and the desktop fields."""
    settings = request.app.state.settings
    state = request.app.state
    return desktop_health(settings, gate_stats(state), lifecycle.runtime(request.app).port, state)
