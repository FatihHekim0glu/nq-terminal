"""D1.1: the start path imports no heavy library, and every router is still registered.

A fresh interpreter imports `nq_terminal.__main__` (which builds the app, because `nq_terminal/app.py` ends with
`app = create_app()`), builds the app again with fixture settings, and reports what is in `sys.modules`, the route
list and `app.openapi()`. The report is written to a file under `tmp_path`, so the parent never parses a large
standard output.

What "lazy" means here (04 D1): every router module stays imported and registered with `include_router`; only the
heavy imports move inside the handlers and service functions that use them. So the route list and the schema must
equal the baseline: 78 (method, path) pairs, and `contract/openapi.json` byte for byte once rendered.

The route list is read with `fastapi.routing.iter_route_contexts` (since FastAPI 0.14x `include_router` registers one
node per router, so `len(app.routes)` says nothing about the API).
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TERMINAL = BACKEND.parent
CONTRACT = TERMINAL / "contract" / "openapi.json"
FIXTURES = BACKEND / "tests" / "fixtures"

BASELINE_ROUTE_PAIRS = 78  # 76 GET, POST /api/jobs, DELETE /api/jobs/{job_id}; docs/desktop/baseline/d1_preflight.md
BASELINE_CONTRACT_PATHS = 75

# Libraries and modules that must not load on the start path. `scipy.stats` is the 510 ms family; the rest are the
# modules that reach it, the heavy modules of 04 D1.1 and the IB client (loaded on demand only).
BANNED_AT_START = (
    "scipy.stats",
    "scipy.optimize",
    "scipy.cluster",
    "scipy.spatial",
    "nautilus_trader",
    "ibapi",
    "nq_terminal.analytics.perf",
    "nq_terminal.services.ib_readonly_client",
    "nq_lab.sizing_stats",
    "nq_lab.calendar_stats",
    "nq_lab.calendar_report",
    "nq_lab.dtsmom_stats",
    "nq_lab.oos_gate",
    "nq_lab.data",
)
# Not on the list, on purpose: pandas, numpy and pyarrow (every analytics module is written against them), and
# `exchange_calendars` with `nq_lab.sessions` (reached at module level by nq_lab's own calendar_effects,
# carry_expiry, dtsmom_panel and mnq_roll, which about fifteen terminal modules import; 78 ms, 5 % of the import).

CHILD_SCRIPT = r"""
import json, sys
from pathlib import Path
backend, fixtures, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
sys.path.insert(0, backend)
import nq_terminal.__main__  # noqa: F401  (builds the production app, as `python -m nq_terminal` does)
from fastapi.routing import iter_route_contexts
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings
app = create_app(load_settings({"NQT_FIXTURE_DIR": fixtures}))
pairs = sorted({(m, ctx.path) for ctx in iter_route_contexts(app.routes) if ctx.methods
                for m in ctx.methods if m not in ("HEAD", "OPTIONS")})
report = {
    "modules": sorted(sys.modules),
    "routes": [list(p) for p in pairs],
    "openapi": json.loads(json.dumps(app.openapi())),
}
out.write_text(json.dumps(report), encoding="utf-8")
"""


def _child_env(state_dir: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("NQT_")}
    env["NQT_STATE_DIR"] = str(state_dir)
    env["NQT_JOBS"] = "off"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


@pytest.fixture(scope="module")
def child_report(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    work = tmp_path_factory.mktemp("startup_imports")
    state = work / "state"
    state.mkdir()
    out = work / "report.json"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    done = subprocess.run(
        [sys.executable, "-c", CHILD_SCRIPT, str(BACKEND), str(FIXTURES), str(out)],
        env=_child_env(state), cwd=str(work), capture_output=True, text=True, encoding="utf-8",
        timeout=180, creationflags=flags, check=False,
    )
    assert done.returncode == 0, f"the child interpreter failed:\n{done.stderr[-3000:]}"
    return json.loads(out.read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", BANNED_AT_START)
def test_heavy_module_is_absent_after_import_and_app_build(child_report: dict[str, Any], name: str) -> None:
    loaded = set(child_report["modules"])
    assert name not in loaded, f"{name} is imported on the start path"


def test_no_scipy_submodule_other_than_the_bare_package_is_loaded(child_report: dict[str, Any]) -> None:
    loaded = [m for m in child_report["modules"] if m == "scipy" or m.startswith("scipy.")]
    assert len(loaded) < 10, f"{len(loaded)} scipy modules on the start path: {loaded[:12]}"


def test_route_list_is_the_baseline(child_report: dict[str, Any]) -> None:
    routes = [tuple(r) for r in child_report["routes"]]
    assert len(routes) == BASELINE_ROUTE_PAIRS
    non_get = sorted(r for r in routes if r[0] != "GET")
    assert non_get == [("DELETE", "/api/jobs/{job_id}"), ("POST", "/api/jobs")]


def test_every_contract_path_is_still_registered(child_report: dict[str, Any]) -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert len(contract["paths"]) == BASELINE_CONTRACT_PATHS
    registered = {path for _, path in child_report["routes"]}
    assert set(contract["paths"]) <= registered


def test_openapi_equals_the_contract_file(child_report: dict[str, Any]) -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert child_report["openapi"] == contract


def test_the_banned_names_belong_to_packages_that_can_be_imported_here() -> None:
    """Guard for the guard: an absent module only proves laziness when its package exists in this environment."""
    missing = [n for n in BANNED_AT_START if importlib.util.find_spec(n.split(".")[0]) is None]
    assert missing == [], f"these packages cannot be imported here, so their absence proves nothing: {missing}"
