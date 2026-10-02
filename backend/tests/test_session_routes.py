"""The three session routes in the real app (03 section 4.2; 04 D2.2; 05 X10).

`GET /api/session` (token and X-NQT-Origin), `GET /api/session/code` (token) and `GET /api/session/redeem` (the code
in X-NQT-Code), built by `create_app` exactly as a backend serves them. The cookie is `nqt_s_<port>` with exactly the
flags HttpOnly, SameSite=Strict and Path=/api; a code works once and dies after 60 s; every secret is compared with
`hmac.compare_digest`; no answer carries the token, and only the cookie carries a session value.
"""
from __future__ import annotations

import ast
import dataclasses
import re
from pathlib import Path

import pytest
from fastapi import FastAPI

from nq_terminal.api import desktop as desktop_api
from nq_terminal.app import create_app
from nq_terminal.desktop import lifecycle, sessions
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.settings import load_settings

from conftest import bare_client

TOKEN = "3d" * 32
PORT = 8798  # the stand-in for the fixed browser port (port table); nothing binds it here
ORIGIN = f"http://127.0.0.1:{PORT}"
PREVIEW = "http://127.0.0.1:4273"
AT_PREVIEW = {"Host": "127.0.0.1:4273"}  # a same-origin GET carries no Origin: the page is named by the Host
PACKAGE = Path(__file__).resolve().parents[1] / "nq_terminal"
SECRET_MODULES = ("desktop/sessions.py", "api/desktop.py", "security.py")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


@pytest.fixture
def app(tmp_path):
    settings = dataclasses.replace(load_settings({}), port=PORT, web_dist=tmp_path / "no_dist")
    made = create_app(settings)
    lifecycle.set_runtime(made, Runtime(token=TOKEN, port=PORT, pid=4120, mode="launcher"))
    return made


@pytest.fixture
def client(app):
    return bare_client(app)


def mint_code(client) -> str:
    r = client.get("/api/session/code", headers={"Authorization": f"NQT {TOKEN}"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    return r.json()["code"]


def cookie_parts(response) -> tuple[str, str, dict[str, str]]:
    """(name, value, {attribute: value}) of the one Set-Cookie header."""
    headers = response.headers.get_list("set-cookie")
    assert len(headers) == 1, headers
    first, *attributes = [part.strip() for part in headers[0].split(";")]
    name, value = first.split("=", 1)
    flags = {}
    for attribute in attributes:
        key, _, val = attribute.partition("=")
        flags[key.lower()] = val
    return name, value, flags


# ---------------------------------------------------------------- the cookie

def test_the_session_cookie_has_exactly_the_three_flags(client):
    r = client.get("/api/session", headers={"Authorization": f"NQT {TOKEN}", "X-NQT-Origin": ORIGIN})
    name, value, flags = cookie_parts(r)
    assert name == f"nqt_s_{PORT}" and HEX64.match(value)
    assert flags == {"httponly": "", "path": "/api", "samesite": "strict"}
    assert r.json() == {"ok": True, "cookie": name} and value not in r.text and TOKEN not in r.text
    assert r.headers["cache-control"] == "no-store"


def test_a_redeemed_cookie_has_exactly_the_three_flags_too(client):
    r = client.get("/api/session/redeem", headers={"X-NQT-Code": mint_code(client), **AT_PREVIEW})
    name, value, flags = cookie_parts(r)
    assert (name, flags) == (f"nqt_s_{PORT}", {"httponly": "", "path": "/api", "samesite": "strict"})
    assert sessions.store(client.app).origin_of(value) == PREVIEW and value not in r.text


def test_the_cookie_name_carries_the_runtime_port_not_the_settings_port(app, client):
    lifecycle.set_runtime(app, Runtime(token=TOKEN, port=53117, pid=4120, mode="desktop"))
    r = client.get("/api/session", headers={"Authorization": f"NQT {TOKEN}", "X-NQT-Origin": "http://127.0.0.1:53117"})
    assert cookie_parts(r)[0] == "nqt_s_53117"


# ---------------------------------------------------------------- launch codes

def test_a_code_works_once(client):
    code = mint_code(client)
    assert HEX64.match(code)
    first = client.get("/api/session/redeem", headers={"X-NQT-Code": code, **AT_PREVIEW})
    again = client.get("/api/session/redeem", headers={"X-NQT-Code": code, **AT_PREVIEW})
    assert first.status_code == 200 and again.status_code == 401 and "set-cookie" not in again.headers


def test_a_code_dies_after_sixty_seconds_through_the_routes(app, client):
    now = [5000.0]
    setattr(app.state, sessions.STATE_KEY, sessions.SessionStore(clock=lambda: now[0]))
    late, in_time = mint_code(client), mint_code(client)
    now[0] += 59.999
    assert client.get("/api/session/redeem", headers={"X-NQT-Code": in_time, **AT_PREVIEW}).status_code == 200
    now[0] += 0.002
    assert client.get("/api/session/redeem", headers={"X-NQT-Code": late, **AT_PREVIEW}).status_code == 401
    assert sessions.CODE_TTL_S == 60 and client.get("/api/session/code", headers={
        "Authorization": f"NQT {TOKEN}"}).json()["expires_in_s"] == 60


def test_an_expired_code_is_dropped_and_dies_on_its_failed_use(app, client):
    now = [0.0]
    store = sessions.SessionStore(clock=lambda: now[0])
    setattr(app.state, sessions.STATE_KEY, store)
    code = mint_code(client)
    now[0] = 61.0
    assert client.get("/api/session/redeem", headers={"X-NQT-Code": code, **AT_PREVIEW}).status_code == 401
    assert store.counts() == (0, 0)


def test_the_redeemed_session_is_bound_to_the_origin_header_or_else_the_host(app, client):
    by_origin = client.get("/api/session/redeem", headers={"X-NQT-Code": mint_code(client), "Origin": ORIGIN,
                                                            "Host": "127.0.0.1:5173"})
    by_host = client.get("/api/session/redeem", headers={"X-NQT-Code": mint_code(client), "Host": "127.0.0.1:5173"})
    store = sessions.store(app)
    assert store.origin_of(cookie_parts(by_origin)[1]) == ORIGIN
    assert store.origin_of(cookie_parts(by_host)[1]) == "http://127.0.0.1:5173"


@pytest.mark.parametrize("headers", [
    {"Origin": "http://evil.example"},
    {"Origin": "null"},
    {**AT_PREVIEW, "Sec-Fetch-Site": "cross-site"},
    {**AT_PREVIEW, "Sec-Fetch-Site": "same-site"},
    {"Host": "evil.example"},
])
def test_a_redeem_from_a_foreign_page_is_refused(client, headers):
    code = mint_code(client)
    r = client.get("/api/session/redeem", headers={"X-NQT-Code": code, **headers})
    assert r.status_code in (400, 403) and "set-cookie" not in r.headers


def router_only_app(tmp_path) -> FastAPI:
    """The desktop router with no middleware at all, so the route's own checks are what answers."""
    made = FastAPI()
    made.state.settings = load_settings({"NQT_STATE_DIR": str(tmp_path)})
    made.include_router(desktop_api.router)
    lifecycle.set_runtime(made, Runtime(token=TOKEN, port=PORT, pid=4120, mode="launcher"))
    return made


@pytest.mark.parametrize("site", ["cross-site", "same-site", "none"])
def test_the_redeem_route_itself_refuses_a_fetch_that_is_not_same_origin(tmp_path, site):
    client = bare_client(router_only_app(tmp_path))
    code = mint_code(client)
    r = client.get("/api/session/redeem", headers={"X-NQT-Code": code, **AT_PREVIEW, "Sec-Fetch-Site": site})
    assert r.status_code == 403 and "set-cookie" not in r.headers
    ok = client.get("/api/session/redeem", headers={"X-NQT-Code": mint_code(client), **AT_PREVIEW,
                                                     "Sec-Fetch-Site": "same-origin"})
    assert ok.status_code == 200


@pytest.mark.parametrize("code", ["", "zz" * 32, "ab" * 31, "AB" * 32, "ab" * 33])
def test_a_malformed_code_is_refused(client, code):
    assert client.get("/api/session/redeem", headers={"X-NQT-Code": code, **AT_PREVIEW}).status_code == 401


def test_redeem_ignores_the_token_and_the_session_route_ignores_a_code(client):
    code = mint_code(client)
    assert client.get("/api/session/redeem", headers={"Authorization": f"NQT {TOKEN}", **AT_PREVIEW}).status_code == 401
    assert client.get("/api/session", headers={"X-NQT-Code": code, "X-NQT-Origin": ORIGIN}).status_code == 401
    assert client.get("/api/session/code", headers={"X-NQT-Code": code}).status_code == 401


def test_the_code_route_refuses_a_wrong_token(client):
    for value in (f"NQT {'3e' * 32}", f"NQT {TOKEN.upper()}", f"nqt {TOKEN}", TOKEN, f"NQT {TOKEN} "):
        assert client.get("/api/session/code", headers={"Authorization": value}).status_code == 401, value


def test_unredeemed_codes_and_sessions_are_capped(app, client):
    for _ in range(sessions.MAX_CODES + 5):
        mint_code(client)
    for _ in range(sessions.MAX_SESSIONS + 5):
        sessions.store(app).create(ORIGIN)
    assert sessions.store(app).counts() == (sessions.MAX_SESSIONS, sessions.MAX_CODES)


def test_the_oldest_session_goes_first_when_the_cap_is_reached():
    store = sessions.SessionStore()
    first = store.create(ORIGIN)
    later = [store.create(ORIGIN) for _ in range(sessions.MAX_SESSIONS)]
    assert store.origin_of(first) is None and all(store.origin_of(v) == ORIGIN for v in later)


def test_a_non_ascii_value_or_origin_is_refused_not_raised():
    store = sessions.SessionStore()
    value = store.create(ORIGIN)
    assert store.is_live(value, "http://127.0.0.1:8798é") is False
    assert store.origin_of("é" * 64) is None and store.redeem("é" * 64, ORIGIN) is None


# ---------------------------------------------------------------- compare_digest everywhere

def _secret_name(node: ast.AST) -> bool:
    text = ast.unparse(node).lower()
    return any(word in text for word in ("token", "code", "digest", "cookie", "value", "origin", "proof", "stored"))


@pytest.mark.parametrize("module", SECRET_MODULES)
def test_no_secret_is_compared_with_equality(module):
    tree = ast.parse((PACKAGE / module).read_text(encoding="utf-8"))
    found = [ast.unparse(node) for node in ast.walk(tree) if isinstance(node, ast.Compare)
             and any(isinstance(op, (ast.Eq, ast.NotEq, ast.In, ast.NotIn)) for op in node.ops)
             and _secret_name(node) and not _allowed_comparison(node)]
    assert found == [], f"{module}: secrets must be compared with hmac.compare_digest: {found}"


def _allowed_comparison(node: ast.Compare) -> bool:
    """Comparisons of names, methods, paths and None, which are not secrets."""
    text = ast.unparse(node)
    return any(part in text for part in ("is None", "is not None", "method", "SESSION_EXEMPT", "READ_METHODS",
                                         "scope['type']", 'scope["type"]', "type(", "WRITE_FETCH_SITE", "SAME_ORIGIN_FETCH", "name", "self.origins",
                                         "SAME_ORIGIN_FETCH_SITES"))


def test_the_born_failing_case_of_the_equality_scan():
    tree = ast.parse("def check(token, given):\n    return token == given\n")
    hits = [n for n in ast.walk(tree) if isinstance(n, ast.Compare) and _secret_name(n) and not _allowed_comparison(n)]
    assert len(hits) == 1


@pytest.mark.parametrize("module", SECRET_MODULES)
def test_the_secret_modules_use_compare_digest(module):
    assert "compare_digest" in (PACKAGE / module).read_text(encoding="utf-8") or module == "security.py"
