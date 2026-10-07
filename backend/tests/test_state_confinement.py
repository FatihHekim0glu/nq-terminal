"""One shared list of research folders confines every state folder, and it includes experiments/ (0.3.1 audit).

The settings check (NQT_STATE_DIR), the result cache folder and the workspace folder all refuse a state folder inside
a folder the terminal never writes. Each test points the project root at a temporary lab, so nothing real is touched.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import nq_lab.config
from nq_terminal import settings as settings_module
from nq_terminal.services import result_cache as rc
from nq_terminal.services import workspaces as ws
from nq_terminal.settings import SettingsError, load_settings

FOLDERS = (("results",), ("experiments",), ("data",), ("live",), ("backtests", "output"))
IDS = ["/".join(parts) for parts in FOLDERS]


@pytest.fixture()
def lab(tmp_path: Path, monkeypatch) -> Path:
    root = tmp_path / "lab"
    for parts in FOLDERS:
        root.joinpath(*parts, "sub").mkdir(parents=True)
    (root / "state").mkdir()
    monkeypatch.setattr(settings_module, "ROOT", root)
    monkeypatch.setattr(nq_lab.config, "ROOT", root)
    return root


def test_there_is_one_list_and_it_names_experiments():
    assert settings_module.RESEARCH_DIRS == FOLDERS
    assert rc.RESEARCH_DIRS is settings_module.RESEARCH_DIRS
    assert ("experiments",) in rc.RESEARCH_DIRS


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
@pytest.mark.parametrize("sub", ["", "sub"])
def test_nqt_state_dir_is_refused_in_every_research_folder(lab, parts, sub):
    target = lab.joinpath(*parts, sub) if sub else lab.joinpath(*parts)
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(target)})


def test_nqt_state_dir_outside_the_research_folders_is_accepted(lab):
    assert load_settings({"NQT_STATE_DIR": str(lab / "state")}).state_dir == (lab / "state").resolve()


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_the_result_cache_folder_is_refused_in_every_research_folder(lab, parts):
    with pytest.raises(rc.ResultCacheError):
        rc.ResultCache(state_dir=lab.joinpath(*parts, "sub"))._cache_folder()


def test_the_result_cache_folder_is_accepted_beside_the_research_folders(lab):
    assert rc.ResultCache(state_dir=lab / "state")._cache_folder() == (lab / "state" / "cache").resolve()


@pytest.mark.parametrize("parts", FOLDERS, ids=IDS)
def test_the_workspace_folder_is_refused_in_every_research_folder(lab, parts):
    store = ws.WorkspaceStore(lab.joinpath(*parts, "sub"))
    with pytest.raises(ws.StoreError):
        store._workspace_folder()


def test_the_workspace_folder_is_accepted_beside_the_research_folders(lab):
    assert ws.WorkspaceStore(lab / "state")._workspace_folder() == (lab / "state" / ws.FOLDER).resolve()
