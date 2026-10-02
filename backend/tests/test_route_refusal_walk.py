"""The refusal walk over the app's OWN route list (04 D2.2; 03 section 15.2 "Sessions"; 05 T06 and X10).

No hand-picked list: every route `create_app` registers under /api is found with `iter_route_contexts` (the walk the
OpenAPI generator itself does), the live stream included, and each is asked, with a fixture-mode app (the fake price
source, so nothing reaches the real gate):

- with no cookie, and with a wrong cookie under the right name: 401;
- with a live session cookie and a foreign Origin: 403;
- every route that is not GET, with a live cookie: 403 without an Origin, and 403 with Sec-Fetch-Site cross-site;
- every GET path also refuses HEAD without a cookie.

Exempt are exactly the proof and the three session routes, which take their own credentials (or none, for the proof)
and are tested in test_desktop_proof.py and test_session_routes.py. A gap is any answer other than the refusal named;
the walk needs at least 82 routes and 0 gaps. Static files outside /api need no cookie.
"""
from __future__ import annotations

import dataclasses
import re

import pytest
from fastapi.routing import iter_route_contexts
from starlette.middleware.trustedhost import TrustedHostMiddleware

from nq_terminal.api.live_stream import StreamLimits
from nq_terminal.app import create_app
from nq_terminal.desktop import lifecycle, sessions
from nq_terminal.security import (SESSION_EXEMPT, LoopbackOnlyMiddleware, SameOriginApiMiddleware,
                                  SecurityHeadersMiddleware, SessionMiddleware)
from nq_terminal.settings import load_settings

from conftest import bare_client, default_origin, session_cookie
from fakes import FIXTURES
from fixture_app import create_fixture_app

MIN_ROUTES = 82
PARAM = re.compile(r"\{([^}:]+)(:[^}]*)?\}")
FOREIGN = ("http://evil.example", "http://127.0.0.1:1", "http://localhost:9", "null")
STREAM = "/api/live/stream"


def api_routes(app) -> list[tuple[str, str]]:
    """(method, path) of every route under /api in the app's own route list, HEAD folded into its GET."""
    found = set()
    for ctx in iter_route_contexts(app.routes):
        path = ctx.path or ""
        if path == "/api" or path.startswith("/api/"):
            found |= {(method, path) for method in (ctx.methods or {"ANY"}) if method != "HEAD"}
    return sorted(found, key=lambda item: (item[1], item[0]))


def concrete(path: str) -> str:
    return PARAM.sub(lambda m: f"walk-{m.group(1)}", path)


@pytest.fixture(scope="module")
def walk_app(tmp_path_factory):
    """create_app's routes on the fixture lab: the fake price source, fake JOBS, NQT_JOBS=off, and a stream that ends
    within a second, so a stream the middleware failed to refuse shows up as a gap instead of hanging the walk."""
    app = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_JOBS": "off", "NQT_FIXTURE_JOBS": "fake",
                              "NQT_STATE_DIR": str(tmp_path_factory.mktemp("walk-state"))},
                             log_dir=tmp_path_factory.mktemp("walk-log"))
    app.state.live_stream_limits = StreamLimits(poll_s=0.05, heartbeat_s=0.2, status_every_s=0.2, lifetime_s=0.5,
                                                retry_ms=100)
    return app


@pytest.fixture(scope="module")
def live_cookie(walk_app) -> dict[str, str]:
    name, value = session_cookie(walk_app)
    return {name: value}


@pytest.fixture(scope="module")
def routes(walk_app) -> list[tuple[str, str]]:
    return [(m, p) for m, p in api_routes(walk_app) if p not in SESSION_EXEMPT]


def ask(app, method: str, path: str, cookies: dict | None = None, **headers) -> int:
    client = bare_client(app, cookies=cookies)
    try:
        return client.request(method, concrete(path), headers=headers).status_code
    finally:
        client.close()


def _gaps(cases) -> list[str]:
    return [f"{method} {path} [{label}] -> {status}" for method, path, label, status, wanted in cases
            if status != wanted]


def test_the_walk_sees_the_apps_whole_route_list_and_the_stream(walk_app, routes):
    plain = api_routes(create_app(load_settings({})))
    assert api_routes(walk_app) == plain, "the fixture app serves exactly create_app's routes"
    assert len(plain) >= MIN_ROUTES and len(routes) == len(plain) - len(SESSION_EXEMPT)
    assert ("GET", STREAM) in routes
    assert {p for _, p in api_routes(walk_app)} >= SESSION_EXEMPT
    assert {m for m, _ in routes} >= {"GET", "POST", "DELETE"}


def test_every_api_route_refuses_no_cookie_and_a_wrong_cookie(walk_app, routes):
    origin = default_origin(walk_app)
    wrong = {sessions.cookie_name(lifecycle.runtime(walk_app).port): "ee" * 32}
    cases = []
    for method, path in routes:
        same = {"Origin": origin} if method not in ("GET", "HEAD") else {}
        cases.append((method, path, "no cookie", ask(walk_app, method, path, **same), 401))
        cases.append((method, path, "wrong cookie", ask(walk_app, method, path, wrong, **same), 401))
        if method == "GET":
            cases.append(("HEAD", path, "no cookie", ask(walk_app, "HEAD", path), 401))
    assert len(cases) >= 2 * MIN_ROUTES
    assert _gaps(cases) == []


def test_every_api_route_refuses_a_foreign_origin_with_a_live_cookie(walk_app, routes, live_cookie):
    cases = [(method, path, f"origin {origin}", ask(walk_app, method, path, live_cookie, Origin=origin), 403)
             for method, path in routes for origin in FOREIGN]
    assert _gaps(cases) == []


def test_every_write_route_refuses_a_missing_origin_and_a_cross_site_fetch(walk_app, routes, live_cookie):
    origin = default_origin(walk_app)
    writes = [(m, p) for m, p in routes if m not in ("GET", "HEAD")]
    assert writes, "the app has write routes (the JOBS queue)"
    cases = []
    for method, path in writes:
        cases.append((method, path, "no origin", ask(walk_app, method, path, live_cookie), 403))
        for site in ("cross-site", "same-site", "none"):
            status = ask(walk_app, method, path, live_cookie, **{"Origin": origin, "Sec-Fetch-Site": site})
            cases.append((method, path, f"fetch site {site}", status, 403))
    assert _gaps(cases) == []


def test_every_get_route_also_refuses_a_write_method_without_an_origin(walk_app, routes, live_cookie):
    cases = [(method, path, "POST without origin", ask(walk_app, "POST", path, live_cookie), 403)
             for method, path in routes if method == "GET"]
    assert _gaps(cases) == []


def test_the_stream_refuses_all_three_ways(walk_app, live_cookie):
    wrong = {sessions.cookie_name(lifecycle.runtime(walk_app).port): "ee" * 32}
    assert ask(walk_app, "GET", STREAM) == 401
    assert ask(walk_app, "GET", STREAM, wrong) == 401
    assert ask(walk_app, "GET", STREAM, live_cookie, Origin="http://evil.example") == 403


def test_the_exempt_routes_are_exactly_four_and_all_registered(walk_app):
    registered = {p for _, p in api_routes(walk_app)}
    assert SESSION_EXEMPT <= registered and len(SESSION_EXEMPT) == 4
    for path in SESSION_EXEMPT:
        assert ask(walk_app, "POST", path) == 403


def test_static_files_need_no_cookie(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>walk</title>", encoding="utf-8")
    app = create_app(dataclasses.replace(load_settings({}), web_dist=dist))
    r = bare_client(app).get("/")
    assert r.status_code == 200 and "<title>walk</title>" in r.text
    assert bare_client(app).get("/api/health").status_code == 401


def test_the_session_middleware_sits_inside_the_host_checks_and_just_outside_same_origin():
    order = [m.cls for m in create_app(load_settings({})).user_middleware]  # outermost first
    assert order == [SecurityHeadersMiddleware, LoopbackOnlyMiddleware, TrustedHostMiddleware, SessionMiddleware,
                     SameOriginApiMiddleware]
