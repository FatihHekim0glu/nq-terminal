"""The allow-listed environment for the backend and its job children (03 section 8; 02 C3-3; 05 X09).

`backend_env(environ)` is what a launcher or the shell passes to the backend, and `child_env(environ)` is what the
backend passes to a backtest child. Both build a NEW mapping from an allow list; nothing is copied by default, so a
name nobody listed (an API key, a token, a stray switch) cannot arrive by accident.

| Passed to                          | Backend | Job child |
|------------------------------------|---------|-----------|
| the base set (below), PATH         | yes     | yes       |
| PYTHONUTF8=1, PYTHONIOENCODING     | yes     | yes       |
| NQT_* (not secret-shaped)          | yes     | no        |
| IB_HOST, IB_PORT, IB_ACCOUNT_ID,   | only with NQT_IB_READONLY=1 | no |
| IB_BASE_USD_RATE                   |         |           |

Never passed to either: a name ending in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD` (also among the NQT_ names), any
other `PYTHON*`, `COVERAGE_*`, `WEBVIEW2_*`, any other `IB_*` (`IB_PAPER_DELAYED_DATA` included) and, for a child,
`NQT_FIXTURE_DIR`. `PATH` has the interpreter's own environment first (`<venv>/Scripts`), so a child resolves the
venv's tools whatever the caller's PATH said. Names are matched without regard to case, as Windows does, and are
written in upper case.
"""
from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from pathlib import Path

BASE_NAMES = ("SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "PATHEXT", "PROGRAMDATA", "PROCESSOR_ARCHITECTURE",
              "NUMBER_OF_PROCESSORS", "USERNAME", "COMPUTERNAME", "OS", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE",
              "HOMEPATH", "HOME", "LOCALAPPDATA", "APPDATA", "PATH")
MAC_NAMES = ("LANG",)  # 03 section 8: LANG on macOS
PYTHON_SETTINGS = {"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
IB_NAMES = ("IB_HOST", "IB_PORT", "IB_ACCOUNT_ID", "IB_BASE_USD_RATE")
BACKEND_PREFIX = "NQT_"
IB_SWITCH = "NQT_IB_READONLY"
SWITCH_ON = "1"
FIXTURE_NAME = "NQT_FIXTURE_DIR"
SECRET_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD")
PATH_NAME = "PATH"


def _upper(environ: Mapping[str, str]) -> dict[str, str]:
    """The same names in upper case; a name given twice in different cases keeps the later one."""
    return {name.upper(): value for name, value in environ.items()}


def _base_names() -> tuple[str, ...]:
    return BASE_NAMES + (MAC_NAMES if sys.platform == "darwin" else ())


def scripts_folder(venv: Path | str | None = None) -> str:
    """The venv's executables folder (`Scripts` on Windows, `bin` elsewhere); the running interpreter's by default."""
    root = Path(sys.prefix if venv is None else venv)
    return str(root / ("Scripts" if sys.platform == "win32" else "bin"))


def _path_with_venv_first(path: str | None, venv: Path | str | None) -> str:
    scripts = scripts_folder(venv)
    same = os.path.normcase(scripts)
    rest = [part for part in (path or "").split(os.pathsep) if part and os.path.normcase(part) != same]
    return os.pathsep.join([scripts, *rest])


def _base(upper: Mapping[str, str], venv: Path | str | None) -> dict[str, str]:
    kept = {name: upper[name] for name in _base_names() if name in upper}
    kept[PATH_NAME] = _path_with_venv_first(upper.get(PATH_NAME), venv)
    return kept | PYTHON_SETTINGS


def _secret_shaped(name: str) -> bool:
    return name.endswith(SECRET_SUFFIXES)


def backend_env(environ: Mapping[str, str] | None = None, *, venv: Path | str | None = None) -> dict[str, str]:
    """The base set, the two Python settings, the NQT_* names and, with `NQT_IB_READONLY=1`, the four IB names."""
    upper = _upper(os.environ if environ is None else environ)
    result = _base(upper, venv)
    result |= {name: value for name, value in upper.items()
               if name.startswith(BACKEND_PREFIX) and not _secret_shaped(name)}
    if upper.get(IB_SWITCH) == SWITCH_ON:
        result |= {name: upper[name] for name in IB_NAMES if name in upper}
    return result


def child_env(environ: Mapping[str, str] | None = None, *, venv: Path | str | None = None) -> dict[str, str]:
    """The base set and the two Python settings: no NQT_* (so no NQT_FIXTURE_DIR), no IB_*, nothing secret-shaped."""
    return _base(_upper(os.environ if environ is None else environ), venv)
