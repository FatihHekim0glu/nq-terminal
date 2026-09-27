"""App skeleton: loopback hosts only, no CORS, GET only, optional static mount of web/dist."""
from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles

from nq_terminal import app as app_module
from nq_terminal.app import GetOnlyError, assert_get_only, create_app, non_get_routes
from nq_terminal.settings import ALLOWED_HOSTS, load_settings

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)  # TestClient's default client ("testclient") is not an address


@pytest.fixture
def no_dist(tmp_path: Path):
    return dataclasses.replace(load_settings({}), web_dist=tmp_path / "missing_dist")


@pytest.fixture
def with_dist(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>nq-lab terminal</title>", encoding="utf-8")
    return dataclasses.replace(load_settings({}), web_dist=dist)


def client(settings) -> TestClient:
    return TestClient(create_app(settings), base_url=LOCAL, client=LOOPBACK)


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.1:8765", "localhost", "localhost:8765"])
def test_loopback_hosts_are_served(no_dist, host):
    r = client(no_dist).get("/api/health", headers={"host": host})
    assert r.status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "127.0.0.1.evil.example", "localhost.evil.example",
                                  "0.0.0.0", "testserver", ""])
def test_other_hosts_get_400(no_dist, host):
    r = client(no_dist).get("/api/health", headers={"host": host})
    assert r.status_code == 400


def test_trusted_host_middleware_lists_only_loopback(no_dist):
    app = create_app(no_dist)
    trusted = [m for m in app.user_middleware if m.cls is TrustedHostMiddleware]
    assert len(trusted) == 1
    assert tuple(trusted[0].kwargs["allowed_hosts"]) == ALLOWED_HOSTS


def test_no_cors(no_dist):
    app = create_app(no_dist)
    assert not [m for m in app.user_middleware if m.cls is CORSMiddleware]
    c = TestClient(app, base_url=LOCAL, client=LOOPBACK)
    r = c.get("/api/health", headers={"origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers
    pre = c.options("/api/health", headers={"origin": "http://evil.example",
                                            "access-control-request-method": "GET"})
    assert pre.status_code == 405
    assert "access-control-allow-origin" not in pre.headers


@pytest.mark.parametrize("settings_name", ["no_dist", "with_dist"])
def test_every_registered_route_is_get(settings_name, request):
    app = create_app(request.getfixturevalue(settings_name))
    assert non_get_routes(app) == []


def test_module_level_app_is_get_only():
    assert non_get_routes(app_module.app) == []


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_methods_are_refused(no_dist, method):
    r = getattr(client(no_dist), method)("/api/health")
    assert r.status_code == 405


def test_a_post_route_is_caught_born_failing(no_dist):
    app = create_app(no_dist)
    app.add_api_route("/api/sneaky", lambda: {"ok": True}, methods=["POST"])
    assert non_get_routes(app) == ["POST /api/sneaky"]
    with pytest.raises(GetOnlyError):
        assert_get_only(app)


def test_a_post_inside_an_included_router_is_caught_born_failing(no_dist):
    app = create_app(no_dist)
    router = APIRouter(prefix="/api/nested")
    router.add_api_route("/write", lambda: {"ok": True}, methods=["GET", "DELETE"])
    app.include_router(router)
    assert non_get_routes(app) == ["DELETE /api/nested/write"]


def test_a_mounted_sub_app_is_caught_born_failing(no_dist):
    app = create_app(no_dist)
    app.mount("/api/sub", FastAPI())
    assert non_get_routes(app) == ["MOUNT /api/sub"]


def test_a_websocket_route_is_caught_born_failing(no_dist):
    app = create_app(no_dist)

    async def ws(websocket):
        await websocket.close()

    app.add_api_websocket_route("/api/ws", ws)
    assert non_get_routes(app) == ["WEBSOCKET /api/ws"]


def test_no_interactive_docs(no_dist):
    c = client(no_dist)
    assert c.get("/docs").status_code == 404
    assert c.get("/redoc").status_code == 404


EXPECTED_PATHS = {  # ARCHITECTURE s4 (Phases 1 and 2); the contract snapshot pins the shapes
    "/api/health", "/api/commands",
    "/api/runs", "/api/runs/compare", "/api/runs/stats", "/api/runs/{run_id}", "/api/runs/{run_id}/equity",
    "/api/runs/{run_id}/fills",
    "/api/runs/{run_id}/log/{section}", "/api/runs/{run_id}/sidecar/{name}", "/api/runs/{run_id}/trades",
    "/api/ledger",
    "/api/registry", "/api/hypotheses", "/api/hypotheses/{name}", "/api/hypotheses/{name}/series",
    "/api/multiple-testing", "/api/confirmations", "/api/sealed", "/api/sealed/{name}",
    "/api/bars", "/api/data/catalog", "/api/market/universe", "/api/market/pair-corr", "/api/qa", "/api/qa/{name}",
    "/api/audit/oos-log", "/api/audit/openings", "/api/audit/spec-hashes",
    "/api/live/status", "/api/live/journal", "/api/live/log", "/api/live/performance",
    # Phase 8 (A1): the instrument DES, GP's RV22 line, MON's 2Day sparkline, LIVE's routes and fills
    "/api/instruments/{root}", "/api/market/rv", "/api/market/two-day", "/api/live/routes",
    "/api/live/stream",  # Phase 9 (9.2): the SSE stream for LIVE and JRNL
    # Phase 11: VCONE, SEAS, EVT, ROLL, DQ (RI4, RI5)
    "/api/market/vcone", "/api/market/vcone/universe",
    "/api/seasonality/instrument/{root}", "/api/seasonality/hypothesis/{name}",
    "/api/events/calendar", "/api/events/study",
    "/api/market/rolls", "/api/market/paper-rolls",
    "/api/dq/symbols", "/api/dq/calendar/{symbol}", "/api/dq/guards",
}
PHASE_3_PREFIX = "/api/analytics/"  # section 4 routes a concurrent Phase 3 build adds; checked by the contract


def test_openapi_is_served_under_api(no_dist):
    r = client(no_dist).get("/api/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert {p for p in paths if not p.startswith(PHASE_3_PREFIX)} == EXPECTED_PATHS
    assert all(set(ops) == {"get"} for ops in paths.values()), {p: sorted(ops) for p, ops in paths.items()}


def test_static_mount_absent_without_dist(no_dist):
    app = create_app(no_dist)
    assert not [r for r in app.routes if isinstance(getattr(r, "app", None), StaticFiles)]
    assert TestClient(app, base_url=LOCAL, client=LOOPBACK).get("/").status_code == 404


def test_static_mount_serves_dist_when_present(with_dist):
    c = client(with_dist)
    r = c.get("/")
    assert r.status_code == 200 and "nq-lab terminal" in r.text
    assert c.get("/api/health").status_code == 200
    assert c.post("/").status_code == 405


def test_static_mount_refuses_path_traversal(with_dist, tmp_path: Path):
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")
    r = client(with_dist).get("/../secret.txt")
    assert r.status_code == 404
    r = client(with_dist).get("/%2e%2e/secret.txt")
    assert r.status_code == 404


# ---------------------------------------------------------------- improvement run 1: security review findings

def test_a_static_mount_of_another_folder_is_caught_born_failing(with_dist, tmp_path: Path):
    app = create_app(with_dist)
    app.mount("/raw", StaticFiles(directory=tmp_path))
    problems = non_get_routes(app)
    assert len(problems) == 1 and problems[0].startswith("STATIC /raw")
    with pytest.raises(GetOnlyError):
        assert_get_only(app)


def test_a_root_static_mount_of_the_wrong_folder_is_caught_born_failing(no_dist, tmp_path: Path):
    app = create_app(no_dist)
    app.mount("/", StaticFiles(directory=tmp_path))
    assert [p for p in non_get_routes(app) if p.startswith("STATIC")]


def test_a_static_files_subclass_is_caught_born_failing(with_dist, tmp_path: Path):
    class Loose(StaticFiles):
        pass

    app = create_app(dataclasses.replace(with_dist, web_dist=tmp_path / "missing_dist"))
    app.state.settings = with_dist
    app.mount("/", Loose(directory=with_dist.web_dist))
    assert [p for p in non_get_routes(app) if p.startswith("STATIC")]


@pytest.mark.parametrize("peer", [("192.168.1.50", 50000), ("10.0.0.7", 1234), ("testclient", 50000)])
def test_a_client_that_is_not_loopback_gets_403(no_dist, peer):
    r = TestClient(create_app(no_dist), base_url=LOCAL, client=peer).get("/api/health", headers={"host": "localhost"})
    assert r.status_code == 403


def test_a_loopback_ipv6_client_is_served(no_dist):
    r = TestClient(create_app(no_dist), base_url=LOCAL, client=("::1", 50000)).get("/api/health")
    assert r.status_code == 200


def test_a_request_that_arrived_on_a_lan_interface_gets_403(no_dist):
    c = TestClient(create_app(no_dist), base_url="http://192.168.1.5:8765", client=LOOPBACK)
    assert c.get("/api/health", headers={"host": "127.0.0.1:8765"}).status_code == 403


def test_the_launcher_binds_loopback_only(monkeypatch):
    from nq_terminal import __main__ as launcher

    calls = []
    monkeypatch.setattr(launcher.uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))
    launcher.main({})
    launcher.main({"NQT_PORT": "9001"})
    (app, first), (_, second) = calls
    assert first["host"] == second["host"] == "127.0.0.1"
    assert (first["port"], second["port"]) == (8765, 9001)
    assert first["server_header"] is False and first["proxy_headers"] is False
    # an open live stream must not hold a shutdown for its whole lifetime (TASKS 9.2)
    from nq_terminal.api.live_stream import StreamLimits
    assert 0 < first["timeout_graceful_shutdown"] == launcher.SHUTDOWN_GRACE_S < StreamLimits().lifetime_s
    assert non_get_routes(app) == []


@pytest.mark.parametrize("headers", [
    {"sec-fetch-site": "cross-site"},
    {"sec-fetch-site": "same-site"},
    {"sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors"},
    {"origin": "https://evil.example"},
    {"origin": "null"},
    {"origin": "http://127.0.0.1.evil.example:8765"},
    {"origin": "http://localhost:3000"},
])
def test_cross_site_api_requests_get_403(no_dist, headers):
    r = client(no_dist).get("/api/health", headers={"host": "127.0.0.1:8765", **headers})
    assert r.status_code == 403
    assert "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize("headers", [
    {},
    {"sec-fetch-site": "same-origin"},
    {"sec-fetch-site": "none"},
    {"origin": "http://127.0.0.1:8765"},
    {"origin": "http://localhost:8765", "sec-fetch-site": "same-origin"},
    {"origin": "http://localhost:5173"},
])
def test_same_origin_api_requests_are_served(no_dist, headers):
    r = client(no_dist).get("/api/health", headers={"host": "127.0.0.1:8765", **headers})
    assert r.status_code == 200


def test_a_cross_site_navigation_to_the_spa_is_still_served(with_dist):
    r = client(with_dist).get("/", headers={"sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate"})
    assert r.status_code == 200


SECURITY_HEADERS = {"x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"}


def _assert_security_headers(r) -> None:
    for name, value in SECURITY_HEADERS.items():
        assert r.headers.get(name) == value, name
    csp = r.headers.get("content-security-policy", "")
    assert "frame-ancestors 'none'" in csp and "default-src 'self'" in csp


def test_security_headers_on_the_api(no_dist):
    _assert_security_headers(client(no_dist).get("/api/health"))


def test_security_headers_on_static_files_and_refusals(with_dist):
    c = client(with_dist)
    _assert_security_headers(c.get("/"))
    _assert_security_headers(c.get("/api/health", headers={"sec-fetch-site": "cross-site"}))
    _assert_security_headers(TestClient(create_app(with_dist), base_url=LOCAL, client=("10.0.0.7", 1)).get("/"))
