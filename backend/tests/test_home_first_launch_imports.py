"""HOME's first launch imports no scipy.stats (V032 first-launch).

0.3.1's HOME prewarm task `warm` imported `nq_lab.sizing_stats`, which loads `scipy.stats` at module level, and HOME's
EQ panel built the terminal's relative fit, which reaches the same import, so on a first launch about half a second of
scipy.stats import sat inside HOME's window although no HOME tile needs it. V032 moves it to the first later task,
`warm_stats`, which runs once HOME is served and the process is quiet.

A fresh interpreter (as `test_startup_imports.py` runs one: a subprocess with no window, the report written as JSON
under `tmp_path`) builds the fixture app from `fakes.FIXTURES` and `fixture_app.create_fixture_app` only: it imports
no test module and no conftest, which would pull in scipy.stats themselves. It records which scipy.stats modules and
which nq_lab statistics modules are loaded at each point:

- after the app build: the baseline, which must hold no scipy.stats, or the test proves nothing;
- after each HOME task, in order;
- after each request HOME sends on a first launch (the 0.3.1 backend log, in its order: commands, jobs, the GP bars
  with variant and start, registry, the data catalogue, multiple-testing, confirmations, the EQ panel without a cost,
  the realised-volatility read, the universe at windows 22 and 252, runs, hypotheses, MON's two-day cells);
- after the deflated Sharpe, asked for separately and last: HOME's REG panel asks for it when it is not compact (the
  owner's 2400 x 1350 window), right after /api/hypotheses (the 0.3.1 log), and the route imports scipy.stats. It is the
  only request of the HOME window that does. The web holds the request back until the registry and the hypotheses have
  answered (`deflatedRequestable`), so the import follows HOME's last data response;
- after each later task, in order.

Two children: one runs the HOME tasks before the requests (the usual first launch), the other sends the requests on a
cold app before any task (a request that beats the prewarm). Born failing: 0.3.1's `warm` loads scipy.stats.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TESTS = BACKEND / "tests"

HOME_REQUESTS = (
    "/api/commands",
    "/api/jobs",
    "/api/bars?symbol=NQ.V.0&timeframe=1d&variant=vendor&start=2021-01-01",
    "/api/registry",
    "/api/data/catalog",
    "/api/multiple-testing",
    "/api/confirmations",
    "/api/analytics/hypothesis/volmanaged_v0/panel",
    "/api/market/rv?symbol=NQ.V.0&window=22",
    "/api/market/universe?window=22",
    "/api/market/universe?window=252",
    "/api/runs",
    "/api/hypotheses",
)
DEFLATED = "/api/analytics/deflated"
STATS = "scipy.stats"
WARMED = "scipy.cluster.hierarchy"

CHILD_SCRIPT = r"""
import json, sys
from pathlib import Path
backend, tests, fixture_dir, state, log_dir, mode, out = sys.argv[1:8]
requests = json.loads(sys.argv[8])
deflated = sys.argv[9]
sys.path[:0] = [backend, tests]

def loaded():
    mods = sys.modules
    return {"stats": sorted(m for m in mods if m == "scipy.stats" or m.startswith("scipy.stats.")),
            "nq_lab.sizing_stats": "nq_lab.sizing_stats" in mods,
            "nq_lab.calendar_stats": "nq_lab.calendar_stats" in mods,
            "scipy.cluster.hierarchy": "scipy.cluster.hierarchy" in mods,
            "foreign": sorted(m for m in mods if m == "conftest" or m.startswith("test_") or m == "pytest")}

from fixture_app import create_fixture_app
from fastapi.testclient import TestClient
from nq_terminal.api import home_prewarm
from nq_terminal.desktop import lifecycle

app = create_fixture_app({"NQT_FIXTURE_DIR": fixture_dir, "NQT_STATE_DIR": state}, log_dir=Path(log_dir))
points = [["app", loaded()]]
runtime = lifecycle.runtime(app)
origin = f"http://127.0.0.1:{runtime.port}"
client = TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))
minted = client.get("/api/session", headers={"Authorization": f"NQT {runtime.token}", "X-NQT-Origin": origin})
if minted.status_code != 200:
    raise SystemExit(f"session refused: {minted.status_code} {minted.text}")
name = minted.json()["cookie"]
client.cookies.set(name, minted.cookies.get(name))
statuses = {}

def home_tasks():
    for task in home_prewarm.home_tasks(app.state):
        task()
        points.append([f"task:{task.__name__}", loaded()])

def home_requests():
    for url in requests:
        statuses[url] = client.get(url).status_code
        points.append([f"get:{url}", loaded()])
    for symbol in home_prewarm.two_day_symbols():
        url = f"/api/market/two-day?symbols={symbol}"
        statuses[url] = client.get(url).status_code
    points.append(["get:/api/market/two-day (MON first paint)", loaded()])

if mode == "tasks_first":
    home_tasks()
    home_requests()
else:
    home_requests()
    home_tasks()
points.append(["home_done", loaded()])
statuses[deflated] = client.get(deflated).status_code
points.append([f"get:{deflated}", loaded()])
later = []
for task in home_prewarm.later_tasks(app.state):
    task()
    later.append(task.__name__)
    points.append([f"later:{task.__name__}", loaded()])
Path(out).write_text(json.dumps({"points": points, "statuses": statuses, "later": later}), encoding="utf-8")
"""


def _child_env(state_dir: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("NQT_")}
    env["NQT_STATE_DIR"] = str(state_dir)
    env["NQT_JOBS"] = "off"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def run_child(work: Path, mode: str) -> dict[str, Any]:
    from fakes import FIXTURES

    state, log = work / "state", work / "log"
    state.mkdir(parents=True)
    out = work / "report.json"
    args = [sys.executable, "-c", CHILD_SCRIPT, str(BACKEND), str(TESTS), str(FIXTURES), str(state), str(log), mode,
            str(out), json.dumps(list(HOME_REQUESTS)), DEFLATED]
    done = subprocess.run(args, env=_child_env(state), cwd=str(work), capture_output=True, text=True,
                          encoding="utf-8", timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                          check=False)
    assert done.returncode == 0, f"the child interpreter failed:\n{done.stderr[-3000:]}"
    return json.loads(out.read_text(encoding="utf-8"))


@pytest.fixture(scope="module", params=["tasks_first", "requests_first"])
def report(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    return run_child(tmp_path_factory.mktemp(f"first_launch_{request.param}"), request.param)


def points(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return dict(report["points"])


def home_points(report: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for name, seen in report["points"]:
        if name.startswith("later:") or name == f"get:{DEFLATED}":
            break
        out.append((name, seen))
    return out


def test_the_baseline_holds_no_scipy_stats_and_no_test_module(report):
    app = points(report)["app"]
    assert app["stats"] == [] and not app["nq_lab.sizing_stats"], "the app build loads scipy.stats: the test is void"
    assert app["foreign"] == [], "the child imported a test module or conftest"


def test_every_home_request_answered(report):
    assert report["statuses"] and set(report["statuses"].values()) == {200}, report["statuses"]
    assert report["statuses"][DEFLATED] == 200
    assert set(HOME_REQUESTS) <= set(report["statuses"])


def test_born_failing_no_home_task_or_request_imports_scipy_stats(report):
    loaded = [(name, seen["stats"][:3], seen["nq_lab.sizing_stats"], seen["nq_lab.calendar_stats"])
              for name, seen in home_points(report)
              if seen["stats"] or seen["nq_lab.sizing_stats"] or seen["nq_lab.calendar_stats"]]
    assert loaded == [], f"scipy.stats is loaded during HOME: {loaded[:3]}"


def test_deflated_is_the_only_home_window_request_that_imports_scipy_stats(report):
    """HOME's REG panel asks for the deflated Sharpe (not compact, the owner's window), after the hypotheses: the one
    HOME-window request that loads scipy.stats. Every request before it loads none (pinned above)."""
    by_name = points(report)
    assert by_name["home_done"]["stats"] == []
    assert STATS in by_name[f"get:{DEFLATED}"]["stats"]
    names = [name for name, _ in report["points"]]
    assert names.index(f"get:{DEFLATED}") > names.index(f"get:{HOME_REQUESTS[-1]}"), "deflated follows /api/hypotheses"
    assert names.index(f"get:{DEFLATED}") < names.index("later:warm_stats")


def test_the_warm_task_still_loads_cluster_and_spatial(report):
    assert points(report)["task:warm"][WARMED] is True


def test_warm_stats_is_the_first_later_task_and_loads_scipy_stats(report):
    assert report["later"][0] == "warm_stats"
    after = points(report)["later:warm_stats"]
    assert STATS in after["stats"] and after["nq_lab.sizing_stats"] is True
    assert points(report)["home_done"]["stats"] == [], "scipy.stats arrives with warm_stats, not before"
