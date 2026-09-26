"""System endpoints: GET /api/health.

Every check reuses nq-lab's own read-only functions (`oos_gate.check_openings_pin`,
`check_sealed_log_pin`, `load_openings`, `live_guards.kill_switch_on`); nothing is reimplemented and
nothing is written.

Gate counters: until the bar service exists (Phase 2.3) they read 0. The service publishes them by setting
`app.state.gate_stats` to a callable returning `(gate_reads, cached_series, cached_bytes)`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Request

from nq_lab import live_guards, oos_gate
from nq_lab.config import IS_END, IS_START
from nq_terminal.models.common import CacheStats, Fence, Health, Pins, SealedStatus
from nq_terminal.settings import Settings

router = APIRouter(prefix="/api", tags=["system"])

GateStats = tuple[int, int, int]


def installed_pins() -> Pins:
    return Pins(pandas=version("pandas"), pyarrow=version("pyarrow"),
                quantpad_data=version("quantpad-data"), nautilus=version("nautilus-trader"))


def fence() -> Fence:
    return Fence(is_start=IS_START.date().isoformat(), is_end=IS_END.date().isoformat())


def _pin_ok(check: Callable[[Path], None], path: Path) -> bool | None:
    """True when the gate's check passes, False when it refuses, None when the file cannot be read."""
    try:
        check(path)
    except oos_gate.OOSAccessError:
        return False
    except (OSError, ValueError):
        return None
    return True


def _openings_closed(path: Path) -> bool | None:
    try:
        openings = oos_gate.load_openings(path)
    except (OSError, ValueError):
        return None
    return all(entry.get("closed") is True for entry in openings)


def sealed_status(settings: Settings) -> SealedStatus:
    return SealedStatus(
        openings_pin_ok=_pin_ok(oos_gate.check_openings_pin, settings.openings_path),
        sealed_log_pin_ok=_pin_ok(oos_gate.check_sealed_log_pin, settings.oos_log_path),
        openings_closed=_openings_closed(settings.openings_path),
    )


def gate_stats(state: object) -> GateStats:
    provider = getattr(state, "gate_stats", None)
    return provider() if callable(provider) else (0, 0, 0)


def build_health(settings: Settings, stats: GateStats, now: datetime | None = None) -> Health:
    reads, series, cached_bytes = stats
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    pins = installed_pins()
    return Health(
        now_utc=stamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        nautilus_version=pins.nautilus,
        pins=pins,
        fence=fence(),
        sealed=sealed_status(settings),
        kill_switch_on=live_guards.kill_switch_on(str(settings.kill_switch_path)),
        gate_reads_this_process=reads,
        cache=CacheStats(series=series, bytes=cached_bytes),
        fixture_mode=settings.fixture_mode,
    )


@router.get("/health", response_model=Health)
def health(request: Request) -> Health:
    """Versions, the in-sample fence, sealed-window pin status, kill switch and gate counters."""
    return build_health(request.app.state.settings, gate_stats(request.app.state))
