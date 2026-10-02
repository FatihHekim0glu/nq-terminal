"""GET /api/ib/snapshot (ARCHITECTURE s4 and s8): the route, its shape, the middleware in front of it.

The router is not registered in `create_app` by this change (the merge step does that), so these tests add it to an
app built the normal way, which puts the real middleware stack and the GET-only check around it.
"""
from __future__ import annotations

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from nq_terminal.api import ib as ib_api
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app, non_get_routes
from nq_terminal.models.ib import IbSnapshot
from nq_terminal.services.ib_readonly_client import Timeouts
from nq_terminal.services.ib_snapshot import IbConfig, IbSnapshotService
from nq_terminal.settings import load_settings

from fakes import FIXTURES
from ib_fake_server import FakeIbServer, PAPER

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
PATH = "/api/ib/snapshot"


def make_app(service: IbSnapshotService | None = None):
    # No web/dist mount: it would sit before a router added afterwards and answer every path with a 404.
    settings = replace(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}), web_dist=FIXTURES / "no-such-dist")
    app = create_app(settings)
    assert PATH in app.openapi()["paths"], "create_app includes the IB router"
    if service is not None:
        app.state.ib_snapshot = service
    return app


def client_for(app) -> TestClient:
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


def test_the_route_is_one_get_and_nothing_else():
    app = make_app()
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    assert sorted(non_get_routes(app)) == sorted(ALLOWED_WRITE_ROUTES)  # the IB route adds no write
    paths = {(route.path, tuple(sorted(route.methods))) for route in ib_api.router.routes}
    assert paths == {(PATH, ("GET",))}


def test_the_route_names_carry_no_order_word():
    names = " ".join(f"{route.path} {route.name}" for route in ib_api.router.routes).lower()
    for word in ("order", "submit", "cancel", "modify"):
        assert word not in names


def test_disabled_by_default_gives_a_200_with_the_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("NQT_IB_READONLY", raising=False)
    response = client_for(make_app()).get(PATH)
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "disabled"
    assert body["read_only"] is True and body["order_path"] == "none"
    assert body["client_id"] == 95
    assert body["positions"] == [] and body["summary"] == []


def test_ok_over_the_fake_server_is_masked_and_complete():
    with FakeIbServer() as server:
        service = IbSnapshotService(IbConfig("127.0.0.1", server.port, Timeouts(2.0, 2.0)))
        response = client_for(make_app(service)).get(PATH)
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "ok"
    assert PAPER not in response.text and "1234567" not in response.text
    assert body["accounts_masked"] == ["DU*******"]
    assert body["positions"][0]["local_symbol"] == "MNQZ6"
    assert body["open_orders"][0]["status"] == "Submitted"
    assert body["executions"][0]["side"] == "BOT"
    assert {row["tag"] for row in body["summary"]} >= {"NetLiquidation", "BuyingPower"}


def test_the_body_validates_against_the_model():
    with FakeIbServer() as server:
        service = IbSnapshotService(IbConfig("127.0.0.1", server.port, Timeouts(2.0, 2.0)))
        body = client_for(make_app(service)).get(PATH).json()
    assert IbSnapshot.model_validate(body).state == "ok"


def test_a_second_request_inside_the_window_is_cached():
    with FakeIbServer() as server:
        service = IbSnapshotService(IbConfig("127.0.0.1", server.port, Timeouts(2.0, 2.0)))
        client = client_for(make_app(service))
        first, second = client.get(PATH).json(), client.get(PATH).json()
        assert server.connections == 1
    assert first["cached"] is False and second["cached"] is True


def test_tws_absent_is_a_clean_200_unavailable():
    with FakeIbServer() as server:
        port = server.port
    service = IbSnapshotService(IbConfig("127.0.0.1", port, Timeouts(0.8, 0.8)))
    response = client_for(make_app(service)).get(PATH)
    assert response.status_code == 200
    assert response.json()["state"] == "unavailable"


def test_a_live_account_is_a_refused_state_without_the_id():
    with FakeIbServer(accounts=("U7654321",)) as server:
        service = IbSnapshotService(IbConfig("127.0.0.1", server.port, Timeouts(2.0, 2.0)))
        response = client_for(make_app(service)).get(PATH)
    assert response.json()["state"] == "refused"
    assert "U7654321" not in response.text


def make_real_mode_app():
    """An app that is not in fixture mode (the settings object only; no real data is read by the IB route)."""
    app = make_app()
    app.state.settings = replace(app.state.settings, fixture_dir=None)
    assert not app.state.settings.fixture_mode
    return app


def test_fixture_mode_keeps_the_snapshot_off_and_opens_no_connection(monkeypatch: pytest.MonkeyPatch):
    # A test run, an e2e run or a smoke run with NQT_IB_READONLY=1 in the shell must never reach a TWS.
    with FakeIbServer() as server:
        monkeypatch.setenv("NQT_IB_READONLY", "1")
        monkeypatch.setenv("IB_HOST", "127.0.0.1")
        monkeypatch.setenv("IB_PORT", str(server.port))
        app = make_app()
        assert app.state.settings.fixture_mode
        body = client_for(app).get(PATH).json()
        assert server.connections == 0
    assert body["state"] == "disabled"


def test_the_service_is_built_once_per_app_from_the_environment(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NQT_IB_READONLY", "1")
    monkeypatch.setenv("IB_PORT", "7496")
    app = make_real_mode_app()
    client = client_for(app)
    assert client.get(PATH).json()["state"] == "refused"
    assert app.state.ib_snapshot is app.state.ib_snapshot


def test_a_cross_site_request_is_refused_by_the_same_origin_guard():
    response = client_for(make_app()).get(PATH, headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 403


def test_a_non_loopback_peer_is_refused():
    app = make_app()
    response = api_client(app, base_url=LOCAL, client=("203.0.113.9", 4000)).get(PATH)
    assert response.status_code == 403


def test_a_post_is_not_routed():
    response = client_for(make_app()).post(PATH)
    assert response.status_code in (404, 405)


def test_the_openapi_schema_lists_every_field_as_required():
    schema = make_app().openapi()
    assert PATH in schema["paths"]
    snapshot = schema["components"]["schemas"]["IbSnapshot"]
    assert set(snapshot["properties"]) == set(snapshot["required"])
    assert json.dumps(schema["paths"][PATH]).count('"get"') == 1
