"""D2.1 and the stage B stubs: the challenge-response proof and the session routes' final signatures.

`GET /api/desktop/proof?nonce=<64 hex>` takes NO Authorization header and returns HMAC-SHA256(token,
'proof'|nonce|port|pid) with root, prefix, contract and pid: whoever knows the token can check that the backend on the
port is the one it started, and a fresh nonce per call means an old answer cannot be replayed. The route reveals
nothing without the token. `Authorization: NQT <token>` is accepted only by `/api/session` and `/api/session/code`;
`/api/session/redeem` takes a one-time code. The session store is a stub in stage A that issues a working cookie
(`nqt_s_<port>`, HttpOnly, SameSite=Strict, Path=/api); stage B adds the middleware that requires it.

These tests build a small app with the desktop router and the lifecycle (app.py registers both at the merge), and
check the shared authenticated client of conftest.py against the real session routes.
"""
from __future__ import annotations

import inspect
import re

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.api import desktop as desktop_api
from nq_terminal.desktop import handshake, lifecycle, sessions
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.settings import load_settings

from conftest import LOCAL, LOOPBACK, AuthedTestClient, bare_client

TOKEN = "9e" * 32
PORT = 53117
NONCE_A, NONCE_B = "a1" * 32, "b2" * 32
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _app(lock_dir, *, extra_post: bool = False) -> FastAPI:
    settings = load_settings({"NQT_STATE_DIR": str(lock_dir)})
    app = FastAPI()
    app.state.settings = settings
    app.include_router(desktop_api.router)
    lifecycle.install(app, settings)
    lifecycle.set_runtime(app, Runtime(token=TOKEN, port=PORT, pid=4120, nonce=None, mode="desktop"))
    if extra_post:
        @app.post("/api/echo")
        async def echo(request: Request) -> dict:
            return {"origin": request.headers.get("origin"), "cookie": request.headers.get("cookie")}
    return app


@pytest.fixture
def client(lock_dir):
    return bare_client(_app(lock_dir), base_url=LOCAL, client=LOOPBACK)  # the session routes themselves


# ---------------------------------------------------------------- the proof

def test_the_proof_answers_without_authorization_and_verifies(client):
    r = client.get("/api/desktop/proof", params={"nonce": NONCE_A})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"proof", "root", "prefix", "contract", "pid"}
    assert body["proof"] == handshake.mac(TOKEN, handshake.PROOF, NONCE_A, PORT, 4120)
    assert handshake.verify_proof(body, TOKEN, NONCE_A, PORT) is True
    assert handshake.verify_proof(body, "9f" * 32, NONCE_A, PORT) is False
    assert handshake.verify_proof(body, TOKEN, NONCE_B, PORT) is False
    assert (body["root"], body["pid"]) == (str(ROOT), 4120) and isinstance(body["contract"], int)
    assert r.headers["cache-control"] == "no-store"


def test_two_nonces_give_two_macs_and_the_proof_is_not_the_ready_mac(client):
    a = client.get("/api/desktop/proof", params={"nonce": NONCE_A}).json()["proof"]
    b = client.get("/api/desktop/proof", params={"nonce": NONCE_B}).json()["proof"]
    assert a != b and HEX64.match(a) and HEX64.match(b)
    assert a != handshake.mac(TOKEN, handshake.READY, NONCE_A, PORT, 4120)


def test_the_proof_never_reads_an_authorization_header(client):
    plain = client.get("/api/desktop/proof", params={"nonce": NONCE_A})
    with_token = client.get("/api/desktop/proof", params={"nonce": NONCE_A},
                            headers={"Authorization": f"NQT {TOKEN}"})
    with_junk = client.get("/api/desktop/proof", params={"nonce": NONCE_A}, headers={"Authorization": "NQT 00"})
    assert plain.json() == with_token.json() == with_junk.json()
    params = inspect.signature(desktop_api.desktop_proof).parameters
    assert "authorization" not in params and set(params) == {"request", "nonce"}


def test_the_proof_reveals_no_token(client):
    text = client.get("/api/desktop/proof", params={"nonce": NONCE_A}).text
    assert TOKEN not in text


@pytest.mark.parametrize("nonce", ["", "a1" * 31, "a1" * 33, "A1" * 32, "zz" * 32, "a1" * 31 + "a "])
def test_a_bad_nonce_is_refused(client, nonce):
    assert client.get("/api/desktop/proof", params={"nonce": nonce}).status_code == 422


def test_a_missing_nonce_is_refused(client):
    assert client.get("/api/desktop/proof").status_code == 422


# ---------------------------------------------------------------- the session stubs

def _set_cookie(response) -> str:
    return response.headers["set-cookie"]


def test_the_token_and_an_origin_buy_a_cookie_bound_to_that_origin(client):
    r = client.get("/api/session", headers={"Authorization": f"NQT {TOKEN}",
                                            "X-NQT-Origin": f"http://127.0.0.1:{PORT}"})
    assert r.status_code == 200 and r.json() == {"ok": True, "cookie": f"nqt_s_{PORT}"}
    cookie = _set_cookie(r)
    assert cookie.startswith(f"nqt_s_{PORT}=")
    flags = {part.strip().lower() for part in cookie.split(";")[1:]}
    assert {"httponly", "samesite=strict", "path=/api"} <= flags
    value = cookie.split(";")[0].split("=", 1)[1]
    store = sessions.store(client.app)
    assert store.origin_of(value) == f"http://127.0.0.1:{PORT}"
    assert store.is_live(value, f"http://127.0.0.1:{PORT}") and not store.is_live(value, "http://127.0.0.1:1")
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("headers", [
    {},
    {"X-NQT-Origin": f"http://127.0.0.1:{PORT}"},
    {"Authorization": f"NQT {'9f' * 32}", "X-NQT-Origin": f"http://127.0.0.1:{PORT}"},
    {"Authorization": f"Bearer {TOKEN}", "X-NQT-Origin": f"http://127.0.0.1:{PORT}"},
    {"Authorization": f"NQT {TOKEN[:-1]}", "X-NQT-Origin": f"http://127.0.0.1:{PORT}"},
])
def test_the_session_route_refuses_a_missing_or_wrong_token(client, headers):
    r = client.get("/api/session", headers=headers)
    assert r.status_code == 401 and "set-cookie" not in r.headers


@pytest.mark.parametrize("origin", ["", "https://127.0.0.1:1", "http://example.com:80", "http://127.0.0.1",
                                    "http://127.0.0.1:1/x", "null"])
def test_the_session_route_refuses_an_origin_that_is_not_loopback(client, origin):
    r = client.get("/api/session", headers={"Authorization": f"NQT {TOKEN}", "X-NQT-Origin": origin})
    assert r.status_code == 400 and "set-cookie" not in r.headers


def test_a_launch_code_works_once(client):
    code = client.get("/api/session/code", headers={"Authorization": f"NQT {TOKEN}"}).json()
    assert set(code) == {"code", "expires_in_s"} and code["expires_in_s"] == sessions.CODE_TTL_S == 60
    headers = {"X-NQT-Code": code["code"], "Origin": "http://127.0.0.1:4273"}
    first = client.get("/api/session/redeem", headers=headers)
    assert first.status_code == 200 and _set_cookie(first).startswith(f"nqt_s_{PORT}=")
    assert client.get("/api/session/redeem", headers=headers).status_code == 401


def test_the_code_route_needs_the_token_and_redeem_ignores_it(client):
    assert client.get("/api/session/code").status_code == 401
    assert client.get("/api/session/redeem", headers={"Authorization": f"NQT {TOKEN}"}).status_code == 401


def test_a_code_dies_after_sixty_seconds():
    now = [1000.0]
    store = sessions.SessionStore(clock=lambda: now[0])
    code = store.mint_code()
    now[0] += sessions.CODE_TTL_S + 0.001
    assert store.redeem(code, "http://127.0.0.1:4273") is None
    fresh = store.mint_code()
    now[0] += sessions.CODE_TTL_S - 1
    assert store.redeem(fresh, "http://127.0.0.1:4273") is not None


def test_the_cookie_name_follows_the_port():
    assert sessions.cookie_name(8765) == "nqt_s_8765" and sessions.cookie_name(PORT) == f"nqt_s_{PORT}"


# ---------------------------------------------------------------- the shared authenticated client

def test_the_shared_client_mints_its_session_through_the_routes(lock_dir, authed_client):
    app = _app(lock_dir, extra_post=True)
    c = authed_client(app, origin=f"http://127.0.0.1:{PORT}")
    assert isinstance(c, AuthedTestClient)
    value = c.cookies.get(f"nqt_s_{PORT}")
    assert value and sessions.store(app).is_live(value, f"http://127.0.0.1:{PORT}")


def test_the_shared_client_sends_a_same_origin_origin_on_non_get_requests(lock_dir, authed_client):
    c = authed_client(_app(lock_dir, extra_post=True), origin=f"http://127.0.0.1:{PORT}")
    body = c.post("/api/echo").json()
    assert body["origin"] == f"http://127.0.0.1:{PORT}" and f"nqt_s_{PORT}=" in body["cookie"]
    assert c.post("/api/echo", headers={"Origin": "http://127.0.0.1:1"}).json()["origin"] == "http://127.0.0.1:1"


def test_the_shared_client_fails_loudly_without_the_session_routes(lock_dir, authed_client):
    app = FastAPI()
    app.state.settings = load_settings({"NQT_STATE_DIR": str(lock_dir)})
    with pytest.raises(AssertionError, match="session"):
        authed_client(app)
