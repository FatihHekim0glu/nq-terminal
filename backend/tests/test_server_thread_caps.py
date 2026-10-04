"""0.1.1 idle memory: the server process caps the native maths thread pools before numpy, scipy and pyarrow load.

On a 32-thread machine OpenBLAS, OpenMP and Arrow each start one worker per logical CPU, and every worker holds its
own private memory, so the idle backend carried about 90 threads and 40 to 60 MB it never used. `python -m
nq_terminal` now sets small pool sizes with `setdefault` (an explicit setting still wins) before its first import of
the app. Backtest children are not capped: their environment is the allow list of `desktop/envlist.py`, which does not
carry the cap names, so a job still gets every core for its maths.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from nq_terminal.desktop import envlist
from nq_terminal.threadcaps import CAP_NAMES, SERVER_POOL_THREADS, cap_native_pools

BACKEND = Path(__file__).resolve().parents[1]
EXPECTED_NAMES = {"OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_MAX_THREADS"}
USER_SETTING = "8"

CHILD_SCRIPT = r"""
import json, os, sys
from pathlib import Path
backend, out, names = sys.argv[1], Path(sys.argv[2]), sys.argv[3].split(",")
sys.path.insert(0, backend)
import nq_terminal.__main__  # noqa: F401  (the server's start path, as `python -m nq_terminal` imports it)
import pyarrow
from threadpoolctl import threadpool_info
report = {
    "environ": {name: os.environ.get(name) for name in names},
    "pools": [{"api": p["internal_api"], "threads": p["num_threads"]} for p in threadpool_info()],
    "arrow_cpu": pyarrow.cpu_count(),
}
out.write_text(json.dumps(report), encoding="utf-8")
"""


def test_the_capped_names_are_the_native_pools_of_numpy_scipy_and_pyarrow() -> None:
    assert set(CAP_NAMES) == EXPECTED_NAMES
    assert SERVER_POOL_THREADS == "2"


def test_every_absent_name_is_set_to_the_server_pool_size() -> None:
    environ: dict[str, str] = {}
    applied = cap_native_pools(environ)
    assert environ == {name: SERVER_POOL_THREADS for name in CAP_NAMES}
    assert applied == environ


def test_an_explicit_setting_still_wins() -> None:
    environ = {"OMP_NUM_THREADS": USER_SETTING}
    applied = cap_native_pools(environ)
    assert environ["OMP_NUM_THREADS"] == USER_SETTING
    assert "OMP_NUM_THREADS" not in applied
    assert environ["OPENBLAS_NUM_THREADS"] == SERVER_POOL_THREADS


def test_a_backtest_child_does_not_inherit_the_caps() -> None:
    capped = {"SYSTEMROOT": "C:\\Windows", "PATH": "C:\\x"}
    cap_native_pools(capped)
    child = envlist.child_env(capped)
    assert not set(child) & set(CAP_NAMES)


@pytest.fixture(scope="module")
def child_report(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    work = tmp_path_factory.mktemp("thread_caps")
    state = work / "state"
    state.mkdir()
    out = work / "report.json"
    env = {k: v for k, v in os.environ.items() if not k.startswith("NQT_") and k.upper() not in EXPECTED_NAMES}
    env |= {"NQT_STATE_DIR": str(state), "NQT_JOBS": "off", "PYTHONDONTWRITEBYTECODE": "1"}
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    done = subprocess.run(
        [sys.executable, "-c", CHILD_SCRIPT, str(BACKEND), str(out), ",".join(sorted(EXPECTED_NAMES))],
        env=env, cwd=str(work), capture_output=True, text=True, encoding="utf-8",
        timeout=180, creationflags=flags, check=False,
    )
    assert done.returncode == 0, f"the child interpreter failed:\n{done.stderr[-3000:]}"
    return json.loads(out.read_text(encoding="utf-8"))


def test_the_start_path_sets_the_caps_in_the_server_process(child_report: dict[str, Any]) -> None:
    assert child_report["environ"] == {name: SERVER_POOL_THREADS for name in EXPECTED_NAMES}


def test_the_loaded_maths_pools_are_capped(child_report: dict[str, Any]) -> None:
    pools = child_report["pools"]
    assert pools, "threadpoolctl found no native pool after the start path"
    assert all(p["threads"] <= int(SERVER_POOL_THREADS) for p in pools), pools


def test_the_arrow_cpu_pool_follows_the_openmp_cap(child_report: dict[str, Any]) -> None:
    assert child_report["arrow_cpu"] == int(SERVER_POOL_THREADS)
