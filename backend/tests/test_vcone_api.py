"""VCONE endpoints (TASKS Phase 11): `GET /api/market/vcone` and `GET /api/market/vcone/universe`.

`create_app` includes `api.vcone.router` ahead of the static mount; these tests build the production app. Every
request is a GET; prices come only from the injected fake serve (caller terminal, temporary log), never after
2021-12-31.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import create_app, non_get_routes
from nq_terminal.services import vcone
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve, synthetic_loader

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
CONE = "/api/market/vcone"
SMALL = "/api/market/vcone/universe"


def with_vcone(app):
    """create_app already includes the VCONE router before the static mount; kept as a named step."""
    return app


def make_client(serve=None) -> TestClient:
    settings = load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})
    app = with_vcone(create_app(settings))
    if serve is not None:
        app.state.serve_fn = serve
        app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


@pytest.fixture
def priced(fake) -> TestClient:
    return make_client(serve=fake)


def test_router_prefix_and_get_only():
    app = with_vcone(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})))
    assert sorted(non_get_routes(app)) == sorted(ALLOWED_WRITE_ROUTES)
    paths = api_client(app, base_url=LOCAL, client=LOOPBACK).get("/api/openapi.json").json()["paths"]
    for path in (CONE, SMALL):
        assert set(paths[path]) == {"get"}, path


def test_cone_for_nq(priced, fake):
    body = priced.get(CONE, params={"symbol": "NQ.V.0"}).json()
    assert body["symbol"] == "NQ.V.0" and body["root"] == "NQ" and body["sector"] == "equity"
    assert body["as_of"] == "2021-12-31" and body["label"].startswith("[POST HOC]")
    assert body["basis"] == vcone.BASIS and body["unit"] == vcone.UNIT
    assert body["percentiles"] == list(vcone.PERCENTILES) and body["min_windows"] == vcone.MIN_WINDOWS
    assert [h["sessions"] for h in body["horizons"]] == list(vcone.HORIZONS)
    assert body["gate"]["caller"] == "terminal"
    assert fake.served and all(c.caller == "terminal" and c.end <= IS_END for c in fake.served)
    assert "p_value" not in str(body).lower()


def test_cone_values_are_the_service_values(priced):
    body = priced.get(CONE, params={"symbol": "GC.V.0"}).json()
    frame = synthetic_loader("GC.V.0", "1d")(IS_START, IS_END)
    own = vcone.volatility_cone(frame, "GC.V.0")
    for got, want in zip(body["horizons"], own.horizons):
        assert got["latest"] == pytest.approx(want.latest, rel=1e-12)
        assert got["p50"] == pytest.approx(want.p50, rel=1e-12) and got["n"] == want.n


def test_small_multiples_at_one_horizon(priced):
    body = priced.get(SMALL, params={"horizon": 63}).json()
    assert body["sessions"] == 63 and body["horizons"] == list(vcone.HORIZONS)
    assert [r["symbol"] for r in body["rows"]] == [f"{c.root}.V.0" for c in TABLE] and body["missing"] == []
    cone = priced.get(CONE, params={"symbol": "NQ.V.0"}).json()
    nq = next(r for r in body["rows"] if r["symbol"] == "NQ.V.0")
    assert nq["stats"] == next(h for h in cone["horizons"] if h["sessions"] == 63)


def test_small_multiples_default_horizon(priced):
    assert priced.get(SMALL).json()["sessions"] == vcone.DEFAULT_HORIZON


def test_refusals(priced):
    assert priced.get(CONE, params={"symbol": "RTY.V.0"}).status_code == 404
    assert priced.get(CONE, params={"symbol": "NQ"}).status_code == 422
    assert priced.get(CONE).status_code == 422
    assert priced.get(SMALL, params={"horizon": 22}).status_code == 422
    assert priced.get(SMALL, params={"horizon": "x"}).status_code == 422


def test_needs_a_price_source():
    client = make_client()
    assert client.get(CONE, params={"symbol": "NQ.V.0"}).status_code == 503
    assert client.get(SMALL).status_code == 503


def test_a_write_method_is_refused(priced):
    assert priced.post(CONE, params={"symbol": "NQ.V.0"}).status_code == 405
