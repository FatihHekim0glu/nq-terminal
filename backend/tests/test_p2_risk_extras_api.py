"""P2 risk extras service and routes (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5).

`services/risk_extras.py` must serve the part A functions of `analytics/risk_extras.py` exactly, with the labelling
rules (basis, unit, "[POST HOC]", a one-contract series summed and without CAGR, so without Treynor). The routes in
`api/risk_extras.py` are GET only. Where `app.py` does not include the router yet, these tests add it to the
production app themselves (with no static mount, so nothing shadows the new paths). Real result files are read only;
prices come from the tests' fake serve (synthetic bars through `oos_gate.serve_bars` with a temporary log), so no
test touches the project's access log.
"""
from __future__ import annotations

import dataclasses
import math

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.analytics import perf, relative, risk_extras, series
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.api import risk_extras as risk_extras_api
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.models.analytics import Context
from nq_terminal.services import risk_extras as service
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService
from nq_terminal.services.tearsheet import NO_BENCH, NO_CAPITAL
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
ROUTES = ("/api/analytics/hypothesis/{name}/risk-extras", "/api/analytics/run/{run_id}/risk-extras")
REL = 1e-12
CONTEXT = Context(kind="run", name="synthetic", cost=None, freq="D")


def app_with_router(root, tmp_path, serve=None) -> FastAPI:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(dataclasses.replace(settings, web_dist=tmp_path / "no_web_dist"))
    assert ROUTES[0] in app.openapi()["paths"], "create_app includes the risk extras router"
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return app


@pytest.fixture(scope="module")
def tmp_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("p2risk")


@pytest.fixture(scope="module")
def api(tmp_dir) -> TestClient:
    return api_client(app_with_router(FIXTURES, tmp_dir), base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def real_api(tmp_dir) -> TestClient:
    serve = make_fake_serve(tmp_dir / "log" / "oos_access_log.jsonl")
    return api_client(app_with_router(None, tmp_dir, serve), base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def research() -> ResearchService:
    return ResearchService(ROOT)


def get(client: TestClient, path: str, **params) -> dict:
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def close(a, b, rel=REL) -> bool:
    if a is None or b is None or (isinstance(b, float) and math.isnan(b)):
        return a is None and (b is None or math.isnan(b))
    return a == pytest.approx(b, rel=rel, abs=1e-15)


def synthetic(basis: str = "B", on_capital: bool = True, bench: bool = True, periods: int = 252) -> SessionSeries:
    rng = np.random.default_rng(31)
    n = 600 if periods == 252 else 120
    idx = pd.bdate_range("2013-01-02", periods=n) if periods == 252 else pd.date_range("2012-01-31", periods=n,
                                                                                       freq="ME")
    b = pd.Series(0.0004 + 0.011 * rng.standard_normal(n), index=idx)
    r = pd.Series(0.0002 + 0.5 * b.to_numpy() + 0.006 * rng.standard_t(8, n), index=idx)
    unit = "fraction of the account per session" if on_capital else "USD per contract per session"
    return SessionSeries(name="synthetic", basis=basis, periods=periods, r=r if on_capital else r * 1e4, unit=unit,
                         on_capital=on_capital, capital=1e6 if basis == "B" else None, source="synthetic",
                         kind="run", label="synthetic", bench=b if bench else None,
                         bench_label="synthetic benchmark" if bench else None)


# ---------------------------------------------------------------- service


def test_service_serves_the_part_a_functions_on_basis_b():
    s = synthetic()
    body = service.risk_extras_view(s, CONTEXT)
    tiles = {k.key: k for k in body.drawdown_tiles}
    assert close(tiles["ulcer_index"].value, risk_extras.ulcer_index(s.r, "B"))
    assert close(tiles["recovery_factor"].value, risk_extras.recovery_factor(s.r, "B"))
    table = risk_extras.modified_es_table(s.r)
    for level in body.modified_es.levels:
        assert close(level.value, table[level.level]["value"]) and level.in_domain is table[level.level]["in_domain"]
    assert close(body.treynor.tile.value, risk_extras.treynor(s.r, s.bench, "B"))
    assert close(body.treynor.beta, relative.alpha_beta(s.r, s.bench)["b"])
    assert close(body.treynor.cagr, perf.cagr(s.r, "B")) and body.treynor.n_pairs == s.n
    assert body.tag == "[POST HOC]" and all(k.tag == "[POST HOC]" and k.basis == "B" for k in body.drawdown_tiles)
    assert body.modified_es.horizon == "1 session" and "domain" in body.modified_es.domain


def test_a_one_contract_series_is_summed_and_has_no_treynor():
    s = synthetic(basis="A", on_capital=False)
    body = service.risk_extras_view(s, CONTEXT)
    tiles = {k.key: k for k in body.drawdown_tiles}
    assert close(tiles["ulcer_index"].value, risk_extras.ulcer_index(s.r, "A"))
    assert "USD" in tiles["ulcer_index"].unit and "no K" in tiles["recovery_factor"].unit
    assert body.treynor.tile.value is None and body.treynor.tile.note == NO_CAPITAL and body.treynor.cagr is None


def test_born_failing_a_one_contract_series_compounded_would_differ():
    s = synthetic(basis="B", on_capital=False)  # a run's realised P&L in USD: still summed
    body = service.risk_extras_view(s, CONTEXT)
    ulcer = {k.key: k for k in body.drawdown_tiles}["ulcer_index"].value
    assert close(ulcer, risk_extras.ulcer_index(s.r, "A"))
    with np.errstate(over="ignore", invalid="ignore"):
        compounded = risk_extras.ulcer_index(s.r, "B")
    assert not close(ulcer, compounded)


def test_without_a_benchmark_treynor_says_so():
    body = service.risk_extras_view(synthetic(bench=False), CONTEXT)
    assert body.treynor.tile.value is None and body.treynor.tile.note == NO_BENCH and body.treynor.n_pairs == 0


def test_a_negative_beta_is_flagged_and_basis_a_names_its_cagr():
    s = synthetic(basis="A")
    s = dataclasses.replace(s, bench=-s.bench)
    body = service.risk_extras_view(s, CONTEXT)
    assert body.treynor.beta < 0 and body.treynor.tile.value is not None
    assert service.NEGATIVE_BETA in body.treynor.note and service.TREYNOR_BASIS_A in body.treynor.note


def test_a_monthly_book_is_one_month_and_p_twelve():
    s = synthetic(periods=12)
    body = service.risk_extras_view(s, CONTEXT)
    assert body.modified_es.horizon == "1 month" and body.periods_per_year == 12
    assert close(body.treynor.tile.value, risk_extras.treynor(s.r, s.bench, "B", 12))


def test_no_value_is_nan_in_the_json():
    body = service.risk_extras_view(synthetic(bench=False), CONTEXT).model_dump_json()
    assert "NaN" not in body and "Infinity" not in body


# ---------------------------------------------------------------- routes


def test_routes_are_get_only(tmp_path):
    paths = app_with_router(None, tmp_path).openapi()["paths"]
    for route in ROUTES:
        assert set(paths[route]) == {"get"}, route


def test_hypothesis_route_equals_the_part_a_functions(real_api, research):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0/risk-extras", cost=1)
    s = series.hypothesis_series(research, "volmanaged_v0", 1)
    assert body["basis"] == "A" and body["n"] == s.n and body["context"]["cost"] == 1
    tiles = {k["key"]: k for k in body["drawdown_tiles"]}
    assert close(tiles["ulcer_index"]["value"], risk_extras.ulcer_index(s.r, "A"))
    assert close(tiles["recovery_factor"]["value"], risk_extras.recovery_factor(s.r, "A"))
    table = risk_extras.modified_es_table(s.r)
    for level in body["modified_es"]["levels"]:
        assert close(level["value"], table[level["level"]]["value"])
        assert close(level["raw_expansion"], table[level["level"]]["raw_expansion"])
    assert close(body["treynor"]["tile"]["value"], risk_extras.treynor(s.r, s.bench, "A"))


def test_run_route_serves_the_account_series(real_api, research):
    body = get(real_api, "/api/analytics/run/nt_dtsmom_v0_ts1/risk-extras")
    s = series.run_series(RunService(data_root=ROOT, project_root=ROOT), research, "nt_dtsmom_v0_ts1")
    assert body["basis"] == "B" and body["n"] == s.n and body["context"]["freq"] == "D"
    assert close({k["key"]: k for k in body["drawdown_tiles"]}["ulcer_index"]["value"],
                 risk_extras.ulcer_index(s.r, "B"))
    expected = risk_extras.treynor(s.r, s.bench, "B") if s.bench is not None else None
    assert close(body["treynor"]["tile"]["value"], expected)


def test_run_route_in_months(real_api):
    body = get(real_api, "/api/analytics/run/nt_dtsmom_v0_ts1/risk-extras", freq="M")
    assert body["periods_per_year"] == 12 and body["modified_es"]["horizon"] == "1 month"


def test_fixture_mode_serves_and_refuses_as_the_tear_sheet(api):
    body = get(api, "/api/analytics/hypothesis/overnight_v0/risk-extras", cost=1)
    assert body["treynor"]["tile"]["value"] is None
    assert api.get("/api/analytics/hypothesis/no_such_thing/risk-extras").status_code == 404
    assert api.get("/api/analytics/run/no_such_run/risk-extras").status_code == 404
    assert api.get("/api/analytics/hypothesis/overnight_v0/risk-extras", params={"cost": 9}).status_code == 422
    assert api.get("/api/analytics/run/nt_za_v0_fixture_unbalanced/risk-extras").status_code == 422


def test_a_404_detail_never_carries_a_path(api):
    detail = api.get("/api/analytics/run/no_such_run/risk-extras").json()["detail"]
    assert "\\" not in detail and "/" not in detail
