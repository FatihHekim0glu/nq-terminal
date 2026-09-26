"""Analytics error mapping (ARCHITECTURE s4 Analytics; Phase 3 improvement run).

Every failure a route can meet is one of the declared statuses (403, 404, 422, 503), never an undeclared 500, and no
error detail carries a path: a drive letter or the data root would leak the user name (CWE-209).

- 503: a source that is missing, half written or inconsistent (a result.json that vanished after indexing, an empty
  series file, a repeated session date);
- 422: a deterministic property of the request's subject: an unbalanced run (rule 4) or an account whose equity
  reaches zero (item (b): the three lookahead probe runs), naming the first such session;
- 403: the gate's refusal, with the gate's own message;
- a NaN benchmark cell is a gap in the benchmark (null), not an error.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab import oos_gate
from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from research_guard import TEST_MARKER
from test_runs_support import RUNS, copy_root

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
PROBE = "nt_volmanaged_v0_final_probe_2012-02-16"


def client_for(root: Path | None, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return TestClient(app, base_url=LOCAL, client=LOOPBACK)


def assert_path_free(detail: str, root: Path | None = None) -> None:
    assert ":\\" not in detail and ":/" not in detail and "Users" not in detail, detail
    if root is not None:
        assert str(root) not in detail and str(root.parent) not in detail, detail


# ---------------------------------------------------------------- 503: a result.json that vanished


RUN_ROUTES = ("/api/analytics/run/{id}", "/api/analytics/run/{id}/panel", "/api/runs/{id}", "/api/runs/{id}/equity")


def test_a_vanished_result_file_is_a_path_free_503(tmp_path):
    root = copy_root(tmp_path, [RUNS["sized"]])
    client = client_for(root)
    assert client.get("/api/runs").status_code == 200  # the index now lists the run
    (root / "backtests" / "output" / RUNS["sized"] / "result.json").unlink()
    for route in RUN_ROUTES:
        r = client.get(route.format(id=RUNS["sized"]))
        assert r.status_code == 503, (route, r.text)
        detail = r.json()["detail"]
        assert "result.json" in detail and "no longer" in detail, detail
        assert_path_free(detail, root)


# ---------------------------------------------------------------- 503: malformed series files


def _research_root(tmp_path: Path, csv_text: str) -> Path:
    root = copy_root(tmp_path, [], session_qa=False)
    screens = root / "results" / "screens"
    screens.mkdir(parents=True)
    shutil.copy(FIXTURES / "results" / "registry.csv", root / "results" / "registry.csv")
    shutil.copy(FIXTURES / "results" / "screens" / "volmanaged_v0.json", screens / "volmanaged_v0.json")
    (screens / "volmanaged_v0_daily.csv").write_text(csv_text, encoding="utf-8")
    return root


def _daily_lines() -> list[str]:
    return (FIXTURES / "results" / "screens" / "volmanaged_v0_daily.csv").read_text(encoding="utf-8").splitlines()


def _bench_column(header: str) -> int:
    return header.split(",").index("r_bh_1")


@pytest.mark.parametrize("case", ["empty", "repeated date"])
def test_a_malformed_series_is_a_path_free_503(tmp_path, case):
    lines = _daily_lines()
    body = [lines[0]] if case == "empty" else [*lines[:3], lines[2], *lines[3:]]
    root = _research_root(tmp_path, "\n".join(body) + "\n")
    client = client_for(root)
    for route in ("/api/analytics/hypothesis/volmanaged_v0", "/api/analytics/hypothesis/volmanaged_v0/panel"):
        r = client.get(route, params={"cost": 1})
        assert r.status_code == 503, (case, route, r.text)
        assert_path_free(r.json()["detail"], root)


def test_a_nan_benchmark_cell_is_a_gap_not_an_error(tmp_path):
    lines = _daily_lines()
    column = _bench_column(lines[0])
    cells = lines[5].split(",")
    cells[column] = ""
    root = _research_root(tmp_path, "\n".join([*lines[:5], ",".join(cells), *lines[6:]]) + "\n")
    client = client_for(root)
    series = client.get("/api/hypotheses/volmanaged_v0/series", params={"cost": 1})
    assert series.status_code == 200, series.text
    at = series.json()["t"].index(int(pd.Timestamp(cells[0], tz="UTC").timestamp()))
    assert series.json()["r_bench"][at] is None
    tear = client.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1})
    assert tear.status_code == 200, tear.text
    assert tear.json()["equity"]["bench"][at] is None and tear.json()["relative"] is not None


# ---------------------------------------------------------------- 422: not compoundable (item (b))


@pytest.fixture(scope="module")
def real_client(tmp_path_factory) -> TestClient:
    """The real data root with the fake serve injected: no real gate read can happen."""
    return client_for(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


@pytest.mark.parametrize("route", ["/api/analytics/run/{id}", "/api/analytics/run/{id}?freq=M",
                                   "/api/analytics/run/{id}/panel"])
def test_a_probe_whose_equity_goes_negative_is_422_with_the_first_session(real_client, route):
    r = real_client.get(route.format(id=PROBE))
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert "not compoundable" in detail and "188 sessions" in detail and "first 2012-02-17" in detail
    assert_path_free(detail)


# ---------------------------------------------------------------- 403: the gate's refusal


def _refusing_serve(start, end, *, caller, reason, symbol="NQ.V.0", timeframe="1m", variant="vendor"):
    raise oos_gate.OOSAccessError(f"refused by the test gate ({TEST_MARKER})")


def test_a_gate_refusal_is_403_with_the_gate_message():
    client = client_for(FIXTURES, _refusing_serve)
    for route in ("/api/analytics/hypothesis/overnight_v0", f"/api/analytics/run/{RUNS['za_orb']}"):
        r = client.get(route)
        assert r.status_code == 403, (route, r.text)
        assert "refused by the test gate" in r.json()["detail"]


# ---------------------------------------------------------------- the real tree answers every run


def test_no_real_run_answers_a_500(real_client):
    ids = [row["run_id"] for row in real_client.get("/api/runs").json()]
    assert len(ids) >= 60
    statuses = {run_id: real_client.get(f"/api/analytics/run/{run_id}/panel").status_code for run_id in ids}
    assert set(statuses.values()) <= {200, 422}, {k: v for k, v in statuses.items() if v not in (200, 422)}
    refused = sorted(k for k, v in statuses.items() if v == 422)
    assert len(refused) == 3 and all("_probe_" in k for k in refused), refused


def test_the_real_root_is_never_named_in_a_detail(real_client):
    r = real_client.get(f"/api/analytics/run/{PROBE}")
    assert str(ROOT) not in r.json()["detail"]
