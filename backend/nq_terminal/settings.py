"""Terminal settings from NQT_* environment variables; the project root comes from nq_lab.config.

NQT_DESKTOP      exactly "1": desktop mode, a backend the app started (anything else: off). It binds port 0 by default,
                 reads TOKEN and NONCE on stdin, and uses the desktop cache caps below (02 O5).
NQT_STDIN_CONTROL exactly "1": launcher mode (start.ps1 sets it): TOKEN and NONCE on stdin, the port stays NQT_PORT.
NQT_PORT         port bound on 127.0.0.1 (default 8765; default 0 in desktop mode). 0 is allowed only in desktop mode,
                 where the backend binds a free port itself and reports it in its handshake line.
NQT_CACHE_BYTES  byte cap of the in-memory gated bar cache (default 2 GiB in the browser, 512 MiB in desktop mode)
NQT_JOBS         "off": this backend never runs a backtest or the IB snapshot (test and smoke backends); unset, empty
                 or "on": the queue as today. Any other value is refused.
NQT_TWO_DAY_WINDOW exactly "1": measurement only. The browser or launcher backend reads MON's two-day sparkline as the
                 app does (its exact window, no 1m year kept), so the T4 and G2 comparison with the browser terminal's
                 HOME is made on equal terms. Never set by start.ps1; leave it unset in daily use.
NQT_DEV          exactly "1": start.ps1 -Dev; the Vite dev origin (DEV_PORT) joins the same-origin list.
NQT_FIXTURE_DIR  folder laid out like the project root (results/, live/, ...) that replaces it for every
                 research and live file read; used by tests, E2E and screenshots. It is resolved (strict)
                 and refused when it is a UNC or device path, the project root or any parent of it (e.g.
                 C:\\), or a folder inside the project other than terminal/backend/tests/fixtures, so a
                 stray value cannot relabel real files as fixtures or reach the network.
NQT_STATE_DIR    the backend's own state folder (default terminal/state, git-ignored); the result cache keeps
                 its persisted bodies in <state>/cache. A given value is resolved strictly (it must be an existing
                 folder) and refused when it is a UNC or device path, the project root or any parent of it, or a
                 folder under results/, experiments/, data/, live/ or backtests/output/ (one list, RESEARCH_DIRS, which
                 the result cache and the workspace store share). Tests point it at a temporary folder.

Derived (NQT_TWO_DAY_WINDOW above can only turn it off in the other forms):
two_day_keeps_year  False in desktop mode, True in the browser and launcher forms. In the app, MON's two-day sparkline
                    reads its exact window and keeps no 1m year in the bar cache (W5C D1); a year frame already cached
                    is still used. The other forms keep the year-aligned read (PRD DL1), so their budgets are unchanged.
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
TERMINAL_STATE_DIR = TERMINAL_DIR / "state"
DEFAULT_STATE_DIR = TERMINAL_STATE_DIR  # read at call time, so the test harness can point it elsewhere
RESEARCH_DIRS = (("results",), ("experiments",), ("data",), ("live",), ("backtests", "output"))  # never written
DEV_PORT = 5173  # Vite dev server (start.ps1 -Dev), which proxies /api
DESKTOP_PORT = 0  # a backend the app starts binds a free port; the launchers keep 8765
DESKTOP_CACHE_BYTES = 512 * 1024**2  # 02 O5: the app shares the PC with WebView2
DESKTOP_FILE_CACHE_BYTES = 128 * 1024**2
SWITCH_ON = "1"
JOBS_OFF, JOBS_ON = "off", "on"
MODE_DESKTOP, MODE_LAUNCHER, MODE_BROWSER = "desktop", "launcher", "browser"


class SettingsError(ValueError):
    """Raised when an NQT_* variable is present but unusable."""


@dataclass(frozen=True)
class Settings:
    root: Path
    port: int = DEFAULT_PORT
    cache_bytes: int = DEFAULT_CACHE_BYTES
    fixture_dir: Path | None = None
    web_dist: Path = WEB_DIST
    state_dir: Path = TERMINAL_STATE_DIR
    desktop: bool = False
    stdin_control: bool = False
    jobs_enabled: bool = True
    dev: bool = False
    file_cache_bytes: int | None = None  # None: each FileCache keeps its own default (the browser terminal)
    two_day_window_only: bool = False  # NQT_TWO_DAY_WINDOW=1: measurement only, see the module docstring

    @property
    def fixture_mode(self) -> bool:
        return self.fixture_dir is not None

    @property
    def mode(self) -> str:
        """'desktop' (the app), 'launcher' (start.ps1 with the stdin channel) or 'browser' (anything else)."""
        if self.desktop:
            return MODE_DESKTOP
        return MODE_LAUNCHER if self.stdin_control else MODE_BROWSER

    @property
    def reads_stdin(self) -> bool:
        """Whether `python -m nq_terminal` reads TOKEN and NONCE on stdin (desktop or launcher mode only)."""
        return self.desktop or self.stdin_control

    @property
    def two_day_keeps_year(self) -> bool:
        """Whether the two-day sparkline keeps the 1m year it reads in the bar cache: not in desktop mode (W5C D1),
        and not in a browser or launcher form that the measurement switch NQT_TWO_DAY_WINDOW has put on the same read."""
        return not (self.desktop or self.two_day_window_only)

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


def _is_unc_or_device(text: str) -> bool:
    """UNC (\\\\host\\share) and device (\\\\?\\, \\\\.\\) paths, with either separator."""
    return text.replace("/", "\\").startswith("\\\\")


def _fixture_dir(env: Mapping[str, str]) -> Path | None:
    """The fixture folder, resolved; refused when it could stand in for real files (see the module docstring)."""
    raw = env.get("NQT_FIXTURE_DIR")
    if raw is None or raw.strip() == "":
        return None
    text = raw.strip()
    if _is_unc_or_device(text):
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


def _state_dir(env: Mapping[str, str]) -> Path:
    """NQT_STATE_DIR resolved strictly and checked (see the module docstring), else the default, which may not
    exist yet (the jobs file and the result cache create it on their first write)."""
    raw = env.get("NQT_STATE_DIR")
    if raw is None or raw.strip() == "":
        return Path(DEFAULT_STATE_DIR).resolve()
    text = raw.strip()
    if _is_unc_or_device(text):
        raise SettingsError(f"NQT_STATE_DIR may not be a UNC or device path: {text}")
    try:
        path = Path(text).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SettingsError(f"NQT_STATE_DIR is not a folder: {text}") from exc
    if not path.is_dir():
        raise SettingsError(f"NQT_STATE_DIR is not a folder: {path}")
    root = ROOT.resolve()
    if root.is_relative_to(path):
        raise SettingsError(f"NQT_STATE_DIR may not be the project root or one of its parents: {path}")
    for parts in RESEARCH_DIRS:
        if path.is_relative_to(root.joinpath(*parts)):
            raise SettingsError(f"NQT_STATE_DIR may not be inside the research folder {'/'.join(parts)}: {path}")
    return path


def _switch(env: Mapping[str, str], name: str) -> bool:
    """On only for exactly "1" (the same reading as the prewarm switch, services/prewarm.py)."""
    return env.get(name) == SWITCH_ON


def _jobs_enabled(env: Mapping[str, str]) -> bool:
    raw = (env.get("NQT_JOBS") or "").strip().lower()
    if raw in ("", JOBS_ON):
        return True
    if raw == JOBS_OFF:
        return False
    raise SettingsError(f"NQT_JOBS must be 'off' or 'on', got {env.get('NQT_JOBS')!r}")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Read the NQT_* variables (from `env`, or the process environment) and fail fast on bad values."""
    source = os.environ if env is None else env
    desktop = _switch(source, "NQT_DESKTOP")
    return Settings(
        root=ROOT,
        port=_int_in_range(source, "NQT_PORT", DESKTOP_PORT if desktop else DEFAULT_PORT, 0 if desktop else 1,
                           MAX_PORT),
        cache_bytes=_int_in_range(source, "NQT_CACHE_BYTES", DESKTOP_CACHE_BYTES if desktop else DEFAULT_CACHE_BYTES,
                                  1, None),
        fixture_dir=_fixture_dir(source),
        state_dir=_state_dir(source),
        desktop=desktop,
        stdin_control=_switch(source, "NQT_STDIN_CONTROL"),
        jobs_enabled=_jobs_enabled(source),
        dev=_switch(source, "NQT_DEV"),
        file_cache_bytes=DESKTOP_FILE_CACHE_BYTES if desktop else None,
        two_day_window_only=_switch(source, "NQT_TWO_DAY_WINDOW"),
    )
