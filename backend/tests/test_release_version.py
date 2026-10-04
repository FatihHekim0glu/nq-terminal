"""Every place that carries the version of this build names the same one.

The installer name, the Cargo package, the three Tauri configurations, the backend `__version__` and the committed
OpenAPI contract all read "this build". `build-release.ps1` refuses a tree whose `tauri.conf.json` and `Cargo.toml`
disagree with `-Version`; the others would drift silently, so they are held together here. Historical references to an
earlier release (the tag, its hash, the documents about it) are not this build and are not read.
"""
from __future__ import annotations

import json
import tomllib
from pathlib import Path

from nq_terminal import __version__

CURRENT_VERSION = "0.1.1"
TERMINAL = Path(__file__).resolve().parents[2]
TAURI = TERMINAL / "desktop" / "src-tauri"
APP_CRATE = "nq-lab-terminal"


def _json_version(path: Path) -> str:
    return json.loads(path.read_text(encoding="utf-8"))["version"]


def _toml(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def _version_sources() -> dict[str, str]:
    lock_packages = _toml(TAURI / "Cargo.lock")["package"]
    return {
        "backend __version__": __version__,
        "Cargo.toml": _toml(TAURI / "Cargo.toml")["package"]["version"],
        "Cargo.lock (app crate)": next(p["version"] for p in lock_packages if p["name"] == APP_CRATE),
        "tauri.conf.json": _json_version(TAURI / "tauri.conf.json"),
        "tauri.measure.conf.json": _json_version(TAURI / "tauri.measure.conf.json"),
        "tauri.smoke.conf.json": _json_version(TAURI / "tauri.smoke.conf.json"),
        "contract/openapi.json": json.loads((TERMINAL / "contract" / "openapi.json").read_text(encoding="utf-8"))["info"][
            "version"
        ],
    }


def test_every_version_source_names_the_same_version():
    sources = _version_sources()
    assert len(set(sources.values())) == 1, sources


def test_the_build_is_the_current_release():
    sources = _version_sources()
    assert {name: v for name, v in sources.items() if v != CURRENT_VERSION} == {}
