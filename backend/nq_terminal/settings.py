"""Terminal settings from NQT_* environment variables; the project root comes from nq_lab.config.

NQT_PORT         port uvicorn binds on 127.0.0.1 (default 8765)
NQT_CACHE_BYTES  byte cap of the in-memory gated bar cache (default 2 GiB)
NQT_FIXTURE_DIR  folder laid out like the project root (results/, live/, ...) that replaces it for every
                 research and live file read; used by tests, E2E and screenshots. It is resolved (strict)
                 and refused when it is a UNC or device path, the project root or any parent of it (e.g.
                 C:\\), or a folder inside the project other than terminal/backend/tests/fixtures, so a
                 stray value cannot relabel real files as fixtures or reach the network.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from nq_lab.config import ROOT

BIND_HOST = "127.0.0.1"
ALLOWED_HOSTS = ("127.0.0.1", "localhost")
DEFAULT_PORT = 8765
DEFAULT_CACHE_BYTES = 2 * 1024**3
MAX_PORT = 65535
TERMINAL_DIR = Path(__file__).resolve().parents[2]
WEB_DIST = TERMINAL_DIR / "web" / "dist"
FIXTURES_DIR = TERMINAL_DIR / "backend" / "tests" / "fixtures"
DEV_PORT = 5173  # Vite dev server (start.ps1 -Dev), which proxies /api


class SettingsError(ValueError):
    """Raised when an NQT_* variable is present but unusable."""


@dataclass(frozen=True)
class Settings:
    root: Path
    port: int = DEFAULT_PORT
    cache_bytes: int = DEFAULT_CACHE_BYTES
    fixture_dir: Path | None = None
    web_dist: Path = WEB_DIST

    @property
    def fixture_mode(self) -> bool:
        return self.fixture_dir is not None

    @property
    def data_root(self) -> Path:
        """Where research and live files are read from: the fixture folder in fixture mode, else ROOT."""
        return self.fixture_dir if self.fixture_dir is not None else self.root

    @property
    def results_dir(self) -> Path:
        return self.data_root / "results"

    @property
    def oos_log_path(self) -> Path:
        return self.results_dir / "oos_access_log.jsonl"

    @property
    def openings_path(self) -> Path:
        return self.results_dir / "oos_openings.json"

    @property
    def kill_switch_path(self) -> Path:
        return self.data_root / "live" / "KILL"


def _int_in_range(env: Mapping[str, str], name: str, default: int, low: int, high: int | None) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise SettingsError(f"{name} must be an integer, got {raw!r}") from exc
    if value < low or (high is not None and value > high):
        bound = f"between {low} and {high}" if high is not None else f"at least {low}"
        raise SettingsError(f"{name} must be {bound}, got {value}")
    return value


def _fixture_dir(env: Mapping[str, str]) -> Path | None:
    """The fixture folder, resolved; refused when it could stand in for real files (see the module docstring)."""
    raw = env.get("NQT_FIXTURE_DIR")
    if raw is None or raw.strip() == "":
        return None
    text = raw.strip()
    if text.replace("/", "\\").startswith("\\\\"):  # UNC (\\host\share) and device (\\?\, \\.\) paths
        raise SettingsError(f"NQT_FIXTURE_DIR may not be a UNC or device path: {text}")
    try:
        path = Path(text).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SettingsError(f"NQT_FIXTURE_DIR is not a folder: {text}") from exc
    if not path.is_dir():
        raise SettingsError(f"NQT_FIXTURE_DIR is not a folder: {path}")
    root = ROOT.resolve()
    if root.is_relative_to(path):
        raise SettingsError(f"NQT_FIXTURE_DIR may not be the project root or one of its parents: {path}")
    if path.is_relative_to(root) and not path.is_relative_to(FIXTURES_DIR.resolve()):
        raise SettingsError(f"NQT_FIXTURE_DIR inside the project must be under {FIXTURES_DIR}: {path}")
    return path


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Read the NQT_* variables (from `env`, or the process environment) and fail fast on bad values."""
    source = os.environ if env is None else env
    return Settings(
        root=ROOT,
        port=_int_in_range(source, "NQT_PORT", DEFAULT_PORT, 1, MAX_PORT),
        cache_bytes=_int_in_range(source, "NQT_CACHE_BYTES", DEFAULT_CACHE_BYTES, 1, None),
        fixture_dir=_fixture_dir(source),
    )
