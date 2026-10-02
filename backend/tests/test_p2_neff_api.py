"""SV3b on `GET /api/analytics/deflated` (ANALYTICS_CATALOG SV3b; the C8 mirror): `effective_n` is `analytics.neff`
over the very trials and the very SV3 result the route serves, and nothing else is added to the view.

Real research files are read only; the route needs no price source (SV3a: no bar service, no gate read).
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.analytics import deflated, neff, series
from nq_terminal.app import create_app
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
ROUTE = "/api/analytics/deflated"


def client_for(root) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    return api_client(create_app(settings), base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def body() -> dict:
    r = client_for(None).get(ROUTE)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def trials() -> list[deflated.Trial]:
    research = ResearchService(ROOT)
    return [deflated.Trial(row.name, s.kind, s.periods, s.r) for row in research.registry_rows() if row.registered
            for s in [series.hypothesis_series(research, row.name, deflated.COST)]]


def test_the_view_carries_the_effective_number_of_trials(body):
    assert "effective_n" in body
    assert set(body["effective_n"]) == {"construction", "note", "cluster_cut", "min_common_sessions", "daily",
                                        "monthly", "refusal", "window", "correlation", "eigenvalues", "clusters",
                                        "sequence", "estimates", "dsr"}
    assert body["effective_n"]["cluster_cut"] == 0.5 and body["effective_n"]["min_common_sessions"] == 252


def test_the_served_view_is_the_estimators_over_the_registered_trials(body, trials):
    want = neff.effective_trials(trials, deflated.registry_dsr(trials))
    got = body["effective_n"]
    assert got["refusal"] is None and want["refusal"] is None
    assert got["daily"] == want["daily"] == [r["name"] for r in body["rows"] if r["periods"] == 252]
    assert got["monthly"] == want["monthly"] == [r["name"] for r in body["rows"] if r["periods"] == 12]
    assert got["window"] == want["window"] and got["clusters"] == want["clusters"]
    assert got["sequence"] == want["sequence"]
    np.testing.assert_allclose(got["correlation"], want["correlation"], rtol=0, atol=1e-15)
    np.testing.assert_allclose(got["eigenvalues"], want["eigenvalues"], rtol=1e-12)
    assert got["estimates"] == want["estimates"] and got["dsr"] == want["dsr"]


def test_the_registered_estimate_is_the_n_and_sr0_sv3_itself_serves_and_the_formula_reproduces_it(body):
    registered = body["effective_n"]["estimates"][0]
    assert registered["id"] == "registered" and registered["served"] is True
    assert registered["n_total"] == body["n_trials"] and registered["sr0_session"] == body["sr0_null_session"]
    again = neff.expected_max_sr0(body["variance_null"], body["n_trials"], body["euler_gamma"])
    assert abs(again - body["sr0_null_session"]) <= 1e-12


def test_each_dsr_row_is_a_registered_row_in_the_sv3_order_and_its_served_column_is_dsr_null(body):
    assert [d["name"] for d in body["effective_n"]["dsr"]] == [r["name"] for r in body["rows"]]
    for d, row in zip(body["effective_n"]["dsr"], body["rows"]):
        assert d["periods"] == row["periods"] and d["served"] == row["dsr_null"]


def test_the_dsr_the_view_serves_for_each_n_is_the_probabilistic_sharpe_at_that_n(body):
    n = {e["id"]: e for e in body["effective_n"]["estimates"]}
    row, d = body["rows"][0], body["effective_n"]["dsr"][0]
    sr0 = neff.expected_max_sr0(body["variance_null"], n["li_ji"]["n_total"], body["euler_gamma"])
    want = neff.probabilistic_sharpe(row["sr"], sr0 * math.sqrt(252 / row["periods"]), row["n"], row["skew"],
                                     row["kurt"])
    assert d["li_ji"] == pytest.approx(want, rel=1e-12)


def test_the_other_fields_of_the_sv3_view_are_unchanged(body, trials):
    want = deflated.registry_dsr(trials)
    assert body["n_trials"] == want["n_trials"] and body["sr0_null_session"] == want["sr0_null_session"]
    assert body["variance"] == want["variance"] and [r["name"] for r in body["rows"]] == [t.name for t in trials]


def test_the_fixture_tree_has_too_few_sessions_and_the_view_says_so_instead_of_failing():
    r = client_for(FIXTURES).get(ROUTE)
    assert r.status_code == 200, r.text
    view = r.json()["effective_n"]
    assert view["refusal"]["kind"] in {"too_few", "no_daily"} and view["correlation"] == [] and view["window"] is None
    assert view["estimates"] == [] and view["dsr"] == []


def test_the_route_is_still_get_only():
    assert set(create_app(load_settings({})).openapi()["paths"][ROUTE]) == {"get"}
