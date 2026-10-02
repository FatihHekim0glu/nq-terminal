"""The desktop contract number and its drift test (03 section 4.4; 04 item 1.3b).

`contract/desktop_version.json` holds the desktop contract number and the full sha256 of the part of the API the
shell itself calls (`/api/desktop/proof`, the three session routes and `/api/health`) in canonical form
(`api/desktop.shell_schema`: sorted keys, no spaces, descriptions and summaries left out). The page and the backend
come from one checkout, so only the shell can be out of step, and only on that part.

The rule: when that part changes, the number moves up by exactly one in the same commit, and never otherwise. The
test compares the app's own schema with the file, and the file with the committed one (`git show HEAD:...`, read
only): a changed sha256 needs the committed number plus one; an unchanged one needs the committed number. With
`NQT_UPDATE_CONTRACT=1` (the contract regeneration step) the file is written by that rule, so a run can never move
the number by more than one. The handshake and /api/health report the same number.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any

import pytest

from nq_terminal.api import desktop as desktop_api
from nq_terminal.app import create_app
from nq_terminal.desktop import handshake
from nq_terminal.settings import TERMINAL_DIR, load_settings

VERSION_FILE = TERMINAL_DIR / "contract" / "desktop_version.json"
OPENAPI_FILE = TERMINAL_DIR / "contract" / "openapi.json"
GIT_PATH = "contract/desktop_version.json"
UPDATE_ENV = "NQT_UPDATE_CONTRACT"
HIDDEN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
KEYS = {"contract", "shell_schema_sha256", "routes"}


def app_schema() -> dict[str, Any]:
    return create_app(load_settings({})).openapi()


def committed() -> dict[str, Any] | None:
    """The version file as the last commit has it, or None when the commit has none (read only)."""
    git = shutil.which("git")
    assert git, "git is needed to read the committed desktop_version.json"
    done = subprocess.run([git, "-C", str(TERMINAL_DIR), "show", f"HEAD:{GIT_PATH}"], capture_output=True,
                          creationflags=HIDDEN, timeout=60, check=False)
    if done.returncode != 0:
        return None
    return json.loads(done.stdout.decode("utf-8"))


def expected_number(head: dict[str, Any] | None, sha: str) -> int:
    """The committed number when the shell part is unchanged, that number plus one when it changed, 1 at first."""
    if head is None:
        return 1
    return head["contract"] if head["shell_schema_sha256"] == sha else head["contract"] + 1


def render(number: int, sha: str) -> str:
    doc = {"contract": number, "shell_schema_sha256": sha, "routes": list(desktop_api.SHELL_ROUTES)}
    return json.dumps(doc, indent=2) + "\n"


def test_the_version_file_pins_the_shell_part_of_the_contract():
    sha = desktop_api.shell_schema_sha256(app_schema())
    number = expected_number(committed(), sha)
    if os.environ.get(UPDATE_ENV) == "1":
        VERSION_FILE.write_text(render(number, sha), encoding="utf-8", newline="\n")
    assert VERSION_FILE.is_file(), f"write {VERSION_FILE} (set {UPDATE_ENV}=1 for one run):\n{render(number, sha)}"
    doc = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    assert set(doc) == KEYS and doc["routes"] == list(desktop_api.SHELL_ROUTES)
    assert doc["shell_schema_sha256"] == sha, (
        f"the shell-facing part of the API changed: raise the contract to {number} in the same commit "
        f"(set {UPDATE_ENV}=1 for one run)")
    assert doc["contract"] == number, f"the desktop contract must be {number} (the committed number, plus one on a change)"


def test_the_version_file_is_canonical():
    if not VERSION_FILE.is_file():
        pytest.fail(f"{VERSION_FILE} is missing (see the test above)")
    text = VERSION_FILE.read_text(encoding="utf-8")
    doc = json.loads(text)
    assert text == render(doc["contract"], doc["shell_schema_sha256"])


def test_the_saved_openapi_gives_the_same_shell_part_as_the_app():
    saved = json.loads(OPENAPI_FILE.read_text(encoding="utf-8"))
    assert desktop_api.shell_schema_sha256(saved) == desktop_api.shell_schema_sha256(app_schema())


def test_the_handshake_reports_the_files_number():
    if VERSION_FILE.is_file():
        assert handshake.contract_number() == json.loads(VERSION_FILE.read_text(encoding="utf-8"))["contract"]


# ---------------------------------------------------------------- the rule itself, born failing

def test_a_change_without_a_bump_is_caught():
    head = {"contract": 3, "shell_schema_sha256": "a" * 64}
    assert expected_number(head, "a" * 64) == 3
    assert expected_number(head, "b" * 64) == 4  # a file still saying 3 with sha b fails the first test
    assert expected_number(None, "b" * 64) == 1


def test_the_shell_part_moves_when_a_shell_route_changes_shape_and_not_on_prose():
    schema = app_schema()
    base = desktop_api.shell_schema_sha256(schema)
    reworded = json.loads(json.dumps(schema))
    reworded["paths"]["/api/health"]["get"]["description"] = "reworded"
    reworded["paths"]["/api/health"]["get"]["summary"] = "reworded"
    assert desktop_api.shell_schema_sha256(reworded) == base
    reshaped = json.loads(json.dumps(schema))
    reshaped["components"]["schemas"]["SessionIssued"]["properties"]["extra"] = {"type": "string"}
    assert desktop_api.shell_schema_sha256(reshaped) != base


def test_a_screen_route_does_not_move_the_shell_part():
    schema = app_schema()
    base = desktop_api.shell_schema_sha256(schema)
    changed = json.loads(json.dumps(schema))
    changed["paths"]["/api/ledger"]["get"]["parameters"] = [{"name": "new", "in": "query", "schema": {"type": "string"}}]
    assert desktop_api.shell_schema_sha256(changed) == base


def test_the_shell_part_holds_exactly_the_five_routes_and_what_they_reach():
    part = desktop_api.shell_schema(app_schema())
    assert sorted(part["paths"]) == sorted(desktop_api.SHELL_ROUTES)
    assert {"DesktopProof", "SessionIssued", "LaunchCode", "DesktopHealth", "Pins", "Fence"} <= set(part["schemas"])
    assert "Ledger" not in part["schemas"]
