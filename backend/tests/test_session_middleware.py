"""SessionMiddleware on its own (03 section 4.2; 02 C3-9 and C3-11; 05 X10): the rules, one by one, on a small app.

The app here carries the real desktop router (proof and the three session routes), a GET route, a POST route, a
server-sent stream and a static mount, with the middleware in the place the merge gives it in `create_app`: inside the
security headers and the loopback and host checks, just outside `SameOriginApiMiddleware`. The walk over the real
app's own route list is test_route_refusal_walk.py.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent
from starlette.staticfiles import StaticFiles

from nq_terminal.api import desktop as desktop_api
from nq_terminal.desktop import lifecycle, sessions
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.security import SESSION_EXEMPT, SameOriginApiMiddleware, SessionMiddleware
from nq_terminal.settings import load_settings

from conftest import bare_client, session_cookie

TOKEN = "5c" * 32
PORT = 8798  # the stand-in for the fixed browser port (port table); nothing binds it here
ORIGIN = f"http://127.0.0.1:{PORT}"


def small_app(tmp_path: Path) -> FastAPI:
    settings = load_settings({"NQT_STATE_DIR": str(tmp_path)})
    app = FastAPI()
    app.state.settings = settings
    lifecycle.set_runtime(app, Runtime(token=TOKEN, port=PORT, pid=4120, mode="launcher"))
    app.include_router(desktop_api.router)

    @app.get("/api/thing")
    def thing() -> dict:
        return {"ok": True}

    @app.post("/api/thing")
    def write_thing() -> dict:
        return {"written": True}

    @app.get("/api/feed", response_class=EventSourceResponse)
    async def feed():
        yield ServerSentEvent(data={"n": 1}, event="hello")

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    app.add_middleware(SameOriginApiMiddleware, origins=lifecycle.origins(settings, PORT))
    app.add_middleware(SessionMiddleware)
    return app


@pytest.fixture
def app(tmp_path):
    return small_app(tmp_path)


@pytest.fixture
def cookie(app) -> dict[str, str]:
    name, value = session_cookie(app, ORIGIN)
    return {name: value}


def get(app, path: str, cookies: dict | None = None, **headers):
    client = bare_client(app, cookies=cookies)
    return client.get(path, headers=headers)


def post(app, path: str, cookies: dict | None = None, **headers):
    client = bare_client(app, cookies=cookies)
    return client.post(path, headers=headers)


# ---------------------------------------------------------------- the cookie

def test_a_get_without_a_cookie_is_refused_401(app):
    r = get(app, "/api/thing")
    assert r.status_code == 401 and r.json() == {"detail": "a session is required"}
    assert r.headers["cache-control"] == "no-store"


def test_a_get_with_a_wrong_cookie_is_refused_401(app):
    for value in ("ab" * 32, "not hex", "", "AB" * 32, "ab" * 33):
        assert get(app, "/api/thing", cookies={sessions.cookie_name(PORT): value}).status_code == 401, value


def test_a_get_with_a_live_cookie_and_no_origin_is_served(app, cookie):
    assert get(app, "/api/thing", cookies=cookie).json() == {"ok": True}


def test_a_cookie_for_another_port_is_not_this_ports_session(app, cookie):
    value = next(iter(cookie.values()))
    assert get(app, "/api/thing", cookies={sessions.cookie_name(8765): value}).status_code == 401
    assert get(app, "/api/thing", cookies={"nqt_s_": value, "nqt_s": value}).status_code == 401


def test_a_session_of_another_app_is_refused(app, tmp_path):
    (tmp_path / "other").mkdir()
    other = small_app(tmp_path / "other")
    name, value = session_cookie(other, ORIGIN)
    assert get(app, "/api/thing", cookies={name: value}).status_code == 401


# ---------------------------------------------------------------- the origin binding

@pytest.mark.parametrize("origin", ["http://127.0.0.1:1", "http://localhost:8798", "https://127.0.0.1:8798",
                                    "http://evil.example", "null", "http://127.0.0.1:87980", "http://127.0.0.1:8798 ",
                                    "http://127.0.0.1:8798é"])
def test_a_foreign_origin_is_refused_403_even_with_a_live_cookie(app, cookie, origin):
    r = bare_client(app, cookies=cookie).get("/api/thing", headers={"Origin": origin.encode("utf-8")})
    assert r.status_code == 403 and r.json() == {"detail": "the origin does not match the session"}


def test_the_session_origin_is_served(app, cookie):
    assert get(app, "/api/thing", cookies=cookie, Origin=ORIGIN).status_code == 200


def test_a_session_for_localhost_is_a_different_origin(app):
    name, value = session_cookie(app, f"http://localhost:{PORT}")
    assert get(app, "/api/thing", cookies={name: value}, Origin=f"http://localhost:{PORT}").status_code == 200
    assert get(app, "/api/thing", cookies={name: value}, Origin=ORIGIN).status_code == 403


# ---------------------------------------------------------------- writes need a same-origin Origin

def test_a_post_with_the_session_origin_is_served(app, cookie):
    assert post(app, "/api/thing", cookies=cookie, Origin=ORIGIN).json() == {"written": True}


def test_a_post_without_an_origin_is_refused_403(app, cookie):
    r = post(app, "/api/thing", cookies=cookie)
    assert r.status_code == 403 and r.json() == {"detail": "a write needs a same-origin Origin header"}


@pytest.mark.parametrize("site", ["cross-site", "same-site", "none", "Same-Site", ""])
def test_a_post_whose_fetch_site_is_not_same_origin_is_refused_403(app, cookie, site):
    r = post(app, "/api/thing", cookies=cookie, Origin=ORIGIN, **{"Sec-Fetch-Site": site})
    assert r.status_code == 403


def test_a_post_with_fetch_site_same_origin_is_served(app, cookie):
    assert post(app, "/api/thing", cookies=cookie, Origin=ORIGIN, **{"Sec-Fetch-Site": "same-origin"}).status_code == 200


def test_a_post_from_another_loopback_port_is_refused(app, cookie):
    """SameSite treats every loopback port as the same site, so the cookie rides along; the Origin does not match."""
    assert post(app, "/api/thing", cookies=cookie, Origin="http://127.0.0.1:9999",
                **{"Sec-Fetch-Site": "same-site"}).status_code == 403


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE", "OPTIONS"])
def test_every_other_method_needs_the_origin_too(app, cookie, method):
    client = bare_client(app, cookies=cookie)
    assert client.request(method, "/api/thing").status_code == 403
    assert client.request(method, "/api/thing", headers={"Origin": "http://evil.example"}).status_code == 403


def test_a_post_without_a_cookie_is_refused(app):
    assert post(app, "/api/thing", Origin=ORIGIN).status_code == 401
    assert post(app, "/api/thing").status_code == 403


# ---------------------------------------------------------------- the stream

def test_the_stream_refuses_without_a_cookie_and_with_a_foreign_origin(app, cookie):
    assert get(app, "/api/feed").status_code == 401
    assert get(app, "/api/feed", cookies={sessions.cookie_name(PORT): "cd" * 32}).status_code == 401
    assert get(app, "/api/feed", cookies=cookie, Origin="http://evil.example").status_code == 403
    served = get(app, "/api/feed", cookies=cookie)
    assert served.status_code == 200 and served.headers["content-type"].startswith("text/event-stream")


# ---------------------------------------------------------------- the exceptions

def test_the_proof_needs_no_cookie(app):
    assert bare_client(app).get("/api/desktop/proof", params={"nonce": "x"}).status_code == 422  # the route answered
    assert bare_client(app).get("/api/desktop/proof", params={"nonce": "a1" * 32}).status_code == 200


def test_the_session_routes_take_their_own_credentials(app):
    client = bare_client(app)
    assert client.get("/api/session", headers={"Authorization": f"NQT {TOKEN}", "X-NQT-Origin": ORIGIN}).status_code == 200
    code = client.get("/api/session/code", headers={"Authorization": f"NQT {TOKEN}"}).json()["code"]
    assert client.get("/api/session/redeem", headers={"X-NQT-Code": code, "Origin": ORIGIN}).status_code == 200
    assert client.get("/api/session").status_code == 401 and client.get("/api/session/code").status_code == 401
    assert client.get("/api/session/redeem").status_code == 401


def test_the_exempt_list_is_exactly_the_proof_and_the_three_session_routes():
    assert SESSION_EXEMPT == {"/api/desktop/proof", "/api/session", "/api/session/code", "/api/session/redeem"}


@pytest.mark.parametrize("path", sorted(SESSION_EXEMPT))
def test_a_write_to_an_exempt_path_is_still_refused(app, path):
    assert post(app, path).status_code == 403
    assert post(app, path, Origin=ORIGIN).status_code == 403


@pytest.mark.parametrize("path", ["/api/session/", "/api/sessionx", "/api/desktop/proof/", "/api/session/code/x",
                                  "/api/desktop"])
def test_only_the_exact_exempt_paths_are_exempt(app, path):
    assert get(app, path).status_code == 401


def test_static_files_need_no_cookie(app):
    r = get(app, "/")
    assert r.status_code == 200 and "<title>t</title>" in r.text


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/no-such-route", "/api/openapi.json"])
def test_any_api_path_is_refused_without_a_cookie_even_one_that_does_not_exist(app, path):
    assert get(app, path).status_code == 401


def test_a_websocket_under_api_is_closed(app):
    sent: list[dict] = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        sent.append(message)

    scope = {"type": "websocket", "path": "/api/thing", "headers": [], "app": app, "client": ("127.0.0.1", 1),
             "server": ("127.0.0.1", PORT), "scheme": "ws", "query_string": b"", "root_path": ""}
    asyncio.run(SessionMiddleware(app.router)(scope, receive, send))
    assert sent == [{"type": "websocket.close", "code": 1008}]


def test_a_scope_without_the_app_fails_closed(app):
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/api/thing", "headers": [], "client": ("127.0.0.1", 1),
             "server": ("127.0.0.1", PORT), "scheme": "http", "query_string": b"", "root_path": ""}
    asyncio.run(SessionMiddleware(app.router)(scope, receive, send))
    assert sent[0]["type"] == "http.response.start" and sent[0]["status"] == 401
