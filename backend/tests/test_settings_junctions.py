"""A state folder cannot reach a research folder through a junction (V032 review, LOW at settings.py:182).

Each test builds a temporary lab and points the project root at it, so nothing real is touched. Junctions are made with
`mklink /J` (no administrator rights needed); a test skips where the platform cannot make one.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

import nq_lab.config
from nq_terminal import settings as settings_module
from nq_terminal.services import result_cache as rc
from nq_terminal.services import workspaces as ws
from nq_terminal.settings import SettingsError, inside_research_folder, load_settings

FOLDERS = (("results",), ("experiments",), ("data",), ("live",), ("backtests", "output"))
IDS = ["/".join(parts) for parts in FOLDERS]

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="junctions are made with mklink /J")


def _junction(link: Path, target: Path) -> None:
    """Make `link` a directory junction to `target`; skip the test when the shell refuses."""
    link.parent.mkdir(parents=True, exist_ok=True)
    done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
    if done.returncode != 0 or not link.exists():
        pytest.skip(f"cannot make a junction here: {done.stdout} {done.stderr}")


def _point_root_at(root: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings_module, "ROOT", root)
    monkeypatch.setattr(nq_lab.config, "ROOT", root)


@pytest.fixture()
def junctioned_lab(tmp_path: Path, monkeypatch):
    """A lab whose research folders all sit behind junctions to folders outside it (the E: layout)."""
    root = tmp_path / "lab"
    root.mkdir()
    (root / "state").mkdir()
    elsewhere = tmp_path / "elsewhere"
    for parts in FOLDERS:
        target = elsewhere.joinpath(*parts)
        (target / "sub").mkdir(parents=True)
        _junction(root.joinpath(*parts), target)
    _point_root_at(root, monkeypatch)
    return root


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
@pytest.mark.parametrize("sub", ["", "sub"])
def test_a_state_folder_reached_through_a_research_junction_is_refused(junctioned_lab, parts, sub):
    target = junctioned_lab.joinpath(*parts, sub) if sub else junctioned_lab.joinpath(*parts)
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(target)})


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_a_state_folder_reached_through_the_junction_target_itself_is_refused(junctioned_lab, parts):
    real = junctioned_lab.joinpath(*parts).resolve() / "sub"
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(real)})


def test_a_state_folder_that_is_itself_a_junction_into_a_research_folder_is_refused(tmp_path, monkeypatch):
    root = tmp_path / "lab"
    (root / "experiments" / "sub").mkdir(parents=True)
    _junction(root / "state", root / "experiments" / "sub")
    _point_root_at(root, monkeypatch)
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(root / "state")})


def test_a_state_folder_beside_junctioned_research_folders_is_accepted(junctioned_lab):
    assert load_settings({"NQT_STATE_DIR": str(junctioned_lab / "state")}).state_dir == (junctioned_lab / "state").resolve()


@pytest.fixture()
def lab_behind_a_root_junction(tmp_path: Path, monkeypatch) -> Path:
    """The real layout: the lab root is reached through a junction (C: to E:) and has plain research folders."""
    real = tmp_path / "E" / "lab"
    for parts in FOLDERS:
        real.joinpath(*parts, "sub").mkdir(parents=True)
    (real / "terminal" / "state").mkdir(parents=True)
    link = tmp_path / "C" / "lab"
    _junction(link, real)
    _point_root_at(link, monkeypatch)
    return link


def test_the_lab_root_junction_keeps_the_state_folder_reachable(lab_behind_a_root_junction):
    link = lab_behind_a_root_junction
    state = load_settings({"NQT_STATE_DIR": str(link / "terminal" / "state")}).state_dir
    assert state == (link / "terminal" / "state").resolve()


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_the_lab_root_junction_still_refuses_its_research_folders(lab_behind_a_root_junction, parts):
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(lab_behind_a_root_junction.joinpath(*parts, "sub"))})


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_inside_research_folder_helper_reads_resolved_and_literal_folders(junctioned_lab, parts):
    root = junctioned_lab.resolve()
    assert inside_research_folder(junctioned_lab.joinpath(*parts, "sub").resolve(), root)
    assert inside_research_folder(junctioned_lab.joinpath(*parts).resolve(), root)
    assert not inside_research_folder((junctioned_lab / "state").resolve(), root)


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_the_workspace_folder_is_refused_behind_a_research_junction(junctioned_lab, parts):
    store = ws.WorkspaceStore(junctioned_lab.joinpath(*parts, "sub"))
    with pytest.raises(ws.StoreError):
        store._workspace_folder()


def test_the_workspace_folder_is_accepted_beside_junctioned_research_folders(junctioned_lab):
    assert ws.WorkspaceStore(junctioned_lab / "state")._workspace_folder() == (junctioned_lab / "state" / ws.FOLDER).resolve()


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_the_result_cache_folder_is_refused_behind_a_research_junction(junctioned_lab, parts):
    """V032C LOW: the result cache compared its folder with the research folders as written only, so a state folder
    behind a research junction resolved past the check; it now uses the shared helper, as settings and workspaces do."""
    cache = rc.ResultCache(state_dir=junctioned_lab.joinpath(*parts, "sub"))
    with pytest.raises(rc.ResultCacheError):
        cache._cache_folder()


def test_the_result_cache_folder_is_accepted_beside_junctioned_research_folders(junctioned_lab):
    cache = rc.ResultCache(state_dir=junctioned_lab / "state")
    assert cache._cache_folder() == (junctioned_lab / "state" / rc.CACHE_FOLDER).resolve()
