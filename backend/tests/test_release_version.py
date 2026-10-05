"""Every place that carries the version of this build names the same one, and the test reads it from one source.

The installer name, the Cargo package and its lock entry, the Tauri configurations, the backend `__version__`, the
committed OpenAPI contract and the usage lines of the release scripts all read "this build". `build-release.ps1`
refuses a tree whose `tauri.conf.json` and `Cargo.toml` disagree with `-Version`; the others would drift silently, so
they are held together here. The one source is `tauri.conf.json`, the file `desktop/scripts/bump-version.ps1` reads the
current version from, so a bump never needs an edit to this test. Historical references to an earlier release (the tag,
its hash, the documents about it) are not this build and are not read (see test_release_docs_published.py).
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from nq_terminal import __version__

VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
TERMINAL = Path(__file__).resolve().parents[2]
TAURI = TERMINAL / "desktop" / "src-tauri"
APP_CRATE = "nq-lab-terminal"
SCRIPTS = {
    "build-release.ps1": TERMINAL / "desktop" / "scripts" / "build-release.ps1",
    "install-test.ps1": TERMINAL / "desktop" / "scripts" / "install-test.ps1",
    "release_check.ps1": TERMINAL / "scripts" / "release_check.ps1",
}
# How a usage line of a release script names a version: `-Version X`, `-Tag desktop-vX`, `release\X`, `_X_x64-setup`.
SCRIPT_VERSION = re.compile(r"(?:-Version |desktop-v|release\\|_)(\d+\.\d+\.\d+)(?=[\s\\\]_])")


def _json_version(path: Path) -> str:
    return json.loads(path.read_text(encoding="utf-8"))["version"]


def _toml(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def build_version() -> str:
    """The one source of the version of this build: the release Tauri configuration."""
    return _json_version(TAURI / "tauri.conf.json")


def _version_sources() -> dict[str, str]:
    lock_packages = _toml(TAURI / "Cargo.lock")["package"]
    return {
        "backend __version__": __version__,
        "Cargo.toml": _toml(TAURI / "Cargo.toml")["package"]["version"],
        "Cargo.lock (app crate)": next(p["version"] for p in lock_packages if p["name"] == APP_CRATE),
        "tauri.conf.json": build_version(),
        "tauri.measure.conf.json": _json_version(TAURI / "tauri.measure.conf.json"),
        "tauri.smoke.conf.json": _json_version(TAURI / "tauri.smoke.conf.json"),
        "contract/openapi.json": json.loads((TERMINAL / "contract" / "openapi.json").read_text(encoding="utf-8"))["info"][
            "version"
        ],
    }


def _script_header_versions() -> dict[str, list[str]]:
    """The versions named by the usage lines of each release script (its header comment, before the parameters)."""
    found: dict[str, list[str]] = {}
    for name, path in SCRIPTS.items():
        text = path.read_text(encoding="utf-8")
        header = re.split(r"^(?:\[CmdletBinding|param\()", text, maxsplit=1, flags=re.MULTILINE)[0]
        found[name] = SCRIPT_VERSION.findall(header)
    return found


def test_the_one_source_is_a_release_number():
    assert VERSION_PATTERN.match(build_version()), build_version()


def test_every_version_source_names_the_same_version():
    sources = _version_sources()
    assert {name: v for name, v in sources.items() if v != build_version()} == {}, sources


def test_the_script_usage_lines_name_the_build_version():
    found = _script_header_versions()
    assert all(found.values()), f"each release script names the version in its usage line: {found}"
    stale = {name: [v for v in versions if v != build_version()] for name, versions in found.items()}
    assert {name: v for name, v in stale.items() if v} == {}, found


# The third-party crates the 0.1.2 release binary is built from, as reviewed for 0.1.1 and held by `--locked`. A bump of
# the version must change only the app crate's own lock entry (bump-version.ps1 edits nothing else); moving any of these
# is a dependency update, which belongs in its own change with the `deny` and `audit` steps run against it and a line in
# the release notes. Update the table in that change, not as a side effect of an unlocked cargo run.
REVIEWED_LOCK_PINS = {
    "async-recursion": "1.1.1",
    "cc": "1.5.1",
    "mio": "1.2.3",
    "tokio": "1.53.1",
    "uuid": "1.26.1",
}


def test_the_lock_keeps_the_reviewed_dependency_pins():
    locked = {p["name"]: p["version"] for p in _toml(TAURI / "Cargo.lock")["package"]}
    drifted = {name: locked.get(name) for name, want in REVIEWED_LOCK_PINS.items() if locked.get(name) != want}
    assert drifted == {}, f"Cargo.lock moved reviewed pins {drifted}; restore them or review the update"
