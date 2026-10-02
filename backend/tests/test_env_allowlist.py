"""D2.4 (03 section 8; 02 C3-3; 05 X09): the allow-listed environment of the backend and of a job child.

`desktop/envlist.py` builds a NEW mapping from an allow list; nothing is copied by default. The base set and the two
Python settings reach both; `NQT_*` reaches the backend only; the four IB names reach the backend only and only with
`NQT_IB_READONLY=1`. A name ending in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`, any other `PYTHON*`, `COVERAGE_*`,
`WEBVIEW2_*` and `NQT_FIXTURE_DIR` in a child never pass. The canary tests prove it three ways: on the mapping, in a
real backend process (its environment block read from its own memory) and in a real job child (a stand-in
`run_base.py` that dumps what it sees). The real `run_base.py` is never started here.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from nq_terminal.desktop import envlist
from nq_terminal.desktop.envlist import backend_env, child_env
from nq_terminal.models.jobs import JobSpec
from nq_terminal.services.jobs import JobService

from conftest import (HIDDEN, desktop_env, fresh_lock_dir, process_strings, remove_lock_dir, spawn_backend)
from p2_jobs_fakes import SPACED_HOME, spec_dict, wait_for

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows environment")

TOKEN = "6b" * 32
NONCE = "4d" * 32
VENV = Path("D:/dev/tmp/fake-lab/.venv")
CANARIES = {"QUANTPAD_API_KEY": "canary-quantpad-7f3a", "TYPESAFE_API_KEY": "canary-typesafe-91bc",
            "IB_PAPER_DELAYED_DATA": "canary-ib-delayed-55de"}
BASE = {"SYSTEMROOT": r"C:\Windows", "WINDIR": r"C:\Windows", "COMSPEC": r"C:\Windows\system32\cmd.exe",
        "SYSTEMDRIVE": "C:", "PATHEXT": ".COM;.EXE;.BAT", "PROGRAMDATA": r"C:\ProgramData",
        "PROCESSOR_ARCHITECTURE": "AMD64", "NUMBER_OF_PROCESSORS": "32", "USERNAME": "tester",
        "COMPUTERNAME": "LAB-PC", "OS": "Windows_NT", "TEMP": r"D:\dev\tmp", "TMP": r"D:\dev\tmp",
        "USERPROFILE": r"C:\Users\tester", "HOMEDRIVE": "C:", "HOMEPATH": r"\Users\tester",
        "HOME": r"C:\Users\tester", "LOCALAPPDATA": r"C:\Users\tester\AppData\Local",
        "APPDATA": r"C:\Users\tester\AppData\Roaming", "PATH": r"C:\Windows\system32;C:\Windows"}
FORBIDDEN_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD")


def source(**extra: str) -> dict[str, str]:
    return {**BASE, **extra}


# ---------------------------------------------------------------- the mapping

@pytest.mark.parametrize("build", [backend_env, child_env], ids=["backend", "child"])
def test_the_base_set_reaches_both_and_nothing_is_added_from_the_rest(build):
    result = build(source(SOMETHING_ELSE="x", GIT_SSH="y"), venv=VENV)
    for name in BASE:
        assert name in result, name
    assert result["PROCESSOR_ARCHITECTURE"] == "AMD64" and result["SYSTEMDRIVE"] == "C:"
    assert "SOMETHING_ELSE" not in result and "GIT_SSH" not in result


@pytest.mark.parametrize("build", [backend_env, child_env], ids=["backend", "child"])
def test_canary_keys_reach_neither_the_backend_nor_a_job_child(build):
    result = build(source(**CANARIES, SOME_API_KEY="k", GITHUB_TOKEN="t", DB_SECRET="s", DB_PASSWORD="p"), venv=VENV)
    for name in (*CANARIES, "SOME_API_KEY", "GITHUB_TOKEN", "DB_SECRET", "DB_PASSWORD"):
        assert name not in result, name
    assert not [v for v in result.values() if v in CANARIES.values()]


@pytest.mark.parametrize("build", [backend_env, child_env], ids=["backend", "child"])
def test_python_settings_are_set_and_no_other_python_name_passes(build):
    result = build(source(PYTHONUTF8="0", PYTHONIOENCODING="latin-1", PYTHONPATH=r"C:\evil", PYTHONHOME=r"C:\py",
                          PYTHONSTARTUP=r"C:\s.py", PYTHONDONTWRITEBYTECODE="1"), venv=VENV)
    assert (result["PYTHONUTF8"], result["PYTHONIOENCODING"]) == ("1", "utf-8")
    assert sorted(n for n in result if n.startswith("PYTHON")) == ["PYTHONIOENCODING", "PYTHONUTF8"]


@pytest.mark.parametrize("build", [backend_env, child_env], ids=["backend", "child"])
def test_coverage_and_webview2_names_never_pass(build):
    result = build(source(COVERAGE_PROCESS_START="c.toml", COVERAGE_FILE="f", WEBVIEW2_USER_DATA_FOLDER="w",
                          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--x"), venv=VENV)
    assert not [n for n in result if n.startswith(("COVERAGE_", "WEBVIEW2_"))]


def test_nqt_names_reach_the_backend_only():
    given = source(NQT_PORT="0", NQT_DESKTOP="1", NQT_CACHE_BYTES="9", NQT_STATE_DIR=r"D:\dev\tmp\s", NQT_JOBS="off")
    backend, child = backend_env(given, venv=VENV), child_env(given, venv=VENV)
    for name in ("NQT_PORT", "NQT_DESKTOP", "NQT_CACHE_BYTES", "NQT_STATE_DIR", "NQT_JOBS"):
        assert backend[name] == given[name] and name not in child
    assert not [n for n in child if n.upper().startswith("NQT_")]


def test_a_secret_shaped_nqt_name_is_refused_even_for_the_backend():
    result = backend_env(source(NQT_PORT="0", NQT_SESSION_TOKEN="t", NQT_X_KEY="k", NQT_Y_SECRET="s",
                                NQT_Z_PASSWORD="p", nqt_lower_token="t"), venv=VENV)
    assert result["NQT_PORT"] == "0"
    assert not [n for n in result if n.upper().endswith(FORBIDDEN_SUFFIXES)]


def test_the_fixture_folder_never_reaches_a_child_and_stays_for_the_backend_entry():
    given = source(NQT_FIXTURE_DIR=r"D:\fixtures", nqt_fixture_dir_alias="x")
    assert "NQT_FIXTURE_DIR" not in child_env(given, venv=VENV)
    assert backend_env(given, venv=VENV)["NQT_FIXTURE_DIR"] == r"D:\fixtures"  # the fixture entry needs it


def test_the_ib_names_pass_to_the_backend_only_with_the_read_only_switch():
    ib = {"IB_HOST": "127.0.0.1", "IB_PORT": "7497", "IB_ACCOUNT_ID": "DU1", "IB_BASE_USD_RATE": "1.3",
          "IB_PAPER_DELAYED_DATA": "1", "IB_OTHER": "z"}
    on = backend_env(source(NQT_IB_READONLY="1", **ib), venv=VENV)
    assert {n: on[n] for n in ("IB_HOST", "IB_PORT", "IB_ACCOUNT_ID", "IB_BASE_USD_RATE")} == {
        "IB_HOST": "127.0.0.1", "IB_PORT": "7497", "IB_ACCOUNT_ID": "DU1", "IB_BASE_USD_RATE": "1.3"}
    assert on["NQT_IB_READONLY"] == "1" and "IB_PAPER_DELAYED_DATA" not in on and "IB_OTHER" not in on
    for given in (source(**ib), source(NQT_IB_READONLY="0", **ib), source(NQT_IB_READONLY="true", **ib)):
        assert not [n for n in backend_env(given, venv=VENV) if n.startswith("IB_")]


def test_a_job_child_gets_no_ib_name_even_with_the_switch_on():
    given = source(NQT_IB_READONLY="1", IB_HOST="127.0.0.1", IB_PORT="7497", IB_ACCOUNT_ID="DU1")
    assert not [n for n in child_env(given, venv=VENV) if n.startswith(("IB_", "NQT_"))]


@pytest.mark.parametrize("build", [backend_env, child_env], ids=["backend", "child"])
def test_the_venv_scripts_folder_comes_first_on_path_once(build):
    scripts = str(VENV / "Scripts")
    first = build(source(), venv=VENV)["PATH"].split(os.pathsep)
    assert first[0] == scripts and first[1:] == BASE["PATH"].split(os.pathsep)
    again = build(source(PATH=os.pathsep.join([scripts, *BASE["PATH"].split(os.pathsep)])), venv=VENV)["PATH"]
    assert again.split(os.pathsep).count(scripts) == 1 and again.split(os.pathsep)[0] == scripts


def test_names_are_matched_without_regard_to_case_and_the_input_is_left_alone():
    given = {"Path": r"C:\Windows", "SystemRoot": r"C:\Windows", "quantpad_api_key": "k", "Nqt_Port": "0"}
    snapshot = dict(given)
    result = backend_env(given, venv=VENV)
    assert given == snapshot and result is not given
    assert result["PATH"].split(os.pathsep)[0] == str(VENV / "Scripts") and result["SYSTEMROOT"] == r"C:\Windows"
    assert "quantpad_api_key" not in result and "QUANTPAD_API_KEY" not in result and result["NQT_PORT"] == "0"


def test_the_default_source_is_the_process_environment(monkeypatch: pytest.MonkeyPatch):
    for name, value in CANARIES.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("NQT_PORT", "12345")
    result = backend_env()
    assert result["NQT_PORT"] == "12345" and not set(CANARIES) & set(result)
    assert not set(CANARIES) & set(child_env()) and "NQT_PORT" not in child_env()
    assert result["PROCESSOR_ARCHITECTURE"] == os.environ["PROCESSOR_ARCHITECTURE"]
    assert result["SYSTEMDRIVE"] == os.environ["SYSTEMDRIVE"]


def test_the_default_venv_is_the_running_interpreters_prefix():
    first = child_env(source())["PATH"].split(os.pathsep)[0]
    assert Path(first) == Path(sys.prefix) / "Scripts"


def test_the_allow_list_names_are_the_reviewed_set():
    assert set(envlist.BASE_NAMES) == set(BASE)
    assert envlist.PYTHON_SETTINGS == {"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    assert set(envlist.IB_NAMES) == {"IB_HOST", "IB_PORT", "IB_ACCOUNT_ID", "IB_BASE_USD_RATE"}


# ---------------------------------------------------------------- a real job child

STAND_IN_RUN_BASE = r'''
import json, os, sys
from pathlib import Path

Path("env_dump.json").write_text(json.dumps({"env": dict(os.environ), "prefix": sys.prefix}), encoding="utf-8")
sys.exit(0)
'''


def stand_in_root(base: Path) -> Path:
    root = base.joinpath(*SPACED_HOME)
    (root / "backtests").mkdir(parents=True)
    (root / "backtests" / "run_base.py").write_text(STAND_IN_RUN_BASE, encoding="utf-8")
    return root


def run_one_stand_in_job(root: Path) -> dict:
    service = JobService(root=root, state_dir=None, python=sys.executable)  # the real Popen, a stand-in script
    try:
        job = service.enqueue(JobSpec.model_validate(spec_dict("t_env")))
        assert wait_for(lambda: service.get(job.id).state in ("ok", "failed", "error"), 60)
        assert service.get(job.id).state == "ok", service.get(job.id).log_tail
    finally:
        service.close()
    return json.loads((root / "env_dump.json").read_text(encoding="utf-8"))


def test_a_real_job_child_sees_neither_the_canaries_nor_the_other_switches(tmp_path, monkeypatch, window_watch):
    for name, value in {**CANARIES, "COVERAGE_PROCESS_START": "c", "WEBVIEW2_USER_DATA_FOLDER": "w",
                        "PYTHONPATH": str(tmp_path), "NQT_FIXTURE_DIR": "x", "SOME_SECRET": "s"}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("NQT_IB_READONLY", "1")
    monkeypatch.setenv("IB_HOST", "127.0.0.1")
    seen = {name.upper(): value for name, value in run_one_stand_in_job(stand_in_root(tmp_path))["env"].items()}
    assert not set(CANARIES) & set(seen) and not [v for v in seen.values() if v in CANARIES.values()]
    assert not [n for n in seen if n.startswith(("NQT_", "IB_", "COVERAGE_", "WEBVIEW2_"))]
    assert "SOME_SECRET" not in seen and "PYTHONPATH" not in seen
    assert seen["PYTHONUTF8"] == "1" and seen["PYTHONIOENCODING"] == "utf-8"


def test_a_real_job_child_gets_the_windows_variables_a_backtest_needs(tmp_path, window_watch):
    dump = run_one_stand_in_job(stand_in_root(tmp_path))
    seen = {name.upper(): value for name, value in dump["env"].items()}
    assert seen["PROCESSOR_ARCHITECTURE"] == os.environ["PROCESSOR_ARCHITECTURE"]
    assert seen["SYSTEMDRIVE"] == os.environ["SYSTEMDRIVE"]
    assert Path(seen["PATH"].split(os.pathsep)[0]) == Path(sys.prefix) / "Scripts"
    assert Path(dump["prefix"]) == Path(sys.prefix)


def test_a_job_child_started_with_the_allow_list_imports_the_venv_libraries_and_exits_zero(window_watch):
    code = "import pandas, pyarrow, exchange_calendars, sys; print(sys.prefix)"
    done = subprocess.run([sys.executable, "-c", code], env=child_env(), capture_output=True, text=True,
                          encoding="utf-8", creationflags=HIDDEN, timeout=120)
    assert done.returncode == 0, done.stderr
    assert Path(done.stdout.strip()) == Path(sys.prefix)


# ---------------------------------------------------------------- a real backend

def test_a_real_backend_started_with_the_allow_list_has_neither_canary_nor_secret_names(window_watch):
    folder = fresh_lock_dir("envlist")
    given = {**os.environ, **CANARIES, "SOME_API_KEY": "k", "COVERAGE_PROCESS_START": "c", "PYTHONPATH": str(folder)}
    env = backend_env(given) | {key: value for key, value in desktop_env(folder).items() if key.startswith("NQT_")}
    backend = spawn_backend(["-m", "nq_terminal"], env, token=TOKEN, nonce=NONCE)
    try:
        kind, ready = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
        _, block = process_strings(ready["pid"])
        names = {line.partition("=")[0].upper(): line.partition("=")[2] for line in block.split("\n")}
        assert not set(CANARIES) & set(names) and not [v for v in names.values() if v in CANARIES.values()]
        assert "SOME_API_KEY" not in names and "COVERAGE_PROCESS_START" not in names
        assert "PROCESSOR_ARCHITECTURE" in names and "SYSTEMDRIVE" in names and names["NQT_DESKTOP"] == "1"
        assert not [n for n in names if n.endswith(FORBIDDEN_SUFFIXES)]
    finally:
        backend.stop()
        remove_lock_dir(folder)
