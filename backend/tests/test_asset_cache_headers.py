"""Cache headers on the page's files (startup.md 7.5, option a; wave w4a-startup-page, slice page-cache).

A hashed file under /assets/ never changes under its name, so it is `public, max-age=31536000, immutable`: with a
port that stays the same between launches (desktop/port_pref.py) WebView2 then loads it from its own cache and never
asks the backend. Every other page file (index.html, `/`, an unhashed or missing file) is `no-cache`, so a rebuilt
page is seen at once. Nothing under /api gets a cache header from this rule: an /api answer keeps exactly what its
route or the stream rule set. The static mount stays the one plain StaticFiles at `/` (app.py `_mount_web`).
"""
from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from starlette.staticfiles import StaticFiles
from starlette.routing import Mount

from nq_terminal import security
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from conftest import api_client, bare_client

IMMUTABLE = "public, max-age=31536000, immutable"
HASHED_JS = "/assets/index-CZqhk4Fd.js"
HASHED_WITH_DASH = "/assets/Cone-CLmF-tnY.js"  # a content hash may hold '-' or '_'
HASHED_WASM = "/assets/perspective-server-DyDuL7QC.wasm"
UNHASHED = "/assets/plain.js"
MISSING_HASHED = "/assets/gone-AAAAAAAA.js"
INDEX = "<!doctype html><title>cache</title>"


@pytest.fixture()
def dist(tmp_path: Path) -> Path:
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text(INDEX, encoding="utf-8")
    (folder / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    for name in ("index-CZqhk4Fd.js", "Cone-CLmF-tnY.js", "plain.js"):
        (folder / "assets" / name).write_text("export {};", encoding="utf-8")
    (folder / "assets" / "perspective-server-DyDuL7QC.wasm").write_bytes(b"\0asm\1\0\0\0")
    return folder


@pytest.fixture()
def app(dist: Path):
    return create_app(dataclasses.replace(load_settings({}), web_dist=dist))


@pytest.mark.parametrize("path", [HASHED_JS, HASHED_WITH_DASH, HASHED_WASM])
def test_born_failing_a_hashed_asset_is_public_for_a_year_and_immutable(app, path):
    r = bare_client(app).get(path)
    assert r.status_code == 200
    assert r.headers.get("cache-control") == IMMUTABLE


def test_a_head_of_a_hashed_asset_carries_the_same_header(app):
    r = bare_client(app).head(HASHED_JS)
    assert r.status_code == 200 and r.headers.get("cache-control") == IMMUTABLE


def test_a_revalidated_hashed_asset_keeps_the_header(app):
    c = bare_client(app)
    etag = c.get(HASHED_JS).headers["etag"]
    r = c.get(HASHED_JS, headers={"if-none-match": etag})
    assert r.status_code == 304 and r.headers.get("cache-control") == IMMUTABLE


@pytest.mark.parametrize("path", ["/", "/index.html"])
def test_born_failing_index_html_is_no_cache(app, path):
    r = bare_client(app).get(path)
    assert r.status_code == 200 and "<title>cache</title>" in r.text
    assert r.headers.get("cache-control") == "no-cache"


def test_a_revalidated_index_html_stays_no_cache(app):
    c = bare_client(app)
    etag = c.get("/").headers["etag"]
    r = c.get("/", headers={"if-none-match": etag})
    assert r.status_code == 304 and r.headers.get("cache-control") == "no-cache"


@pytest.mark.parametrize("path", [UNHASHED, "/favicon.svg", MISSING_HASHED, "/no-such-page"])
def test_born_failing_an_unhashed_or_missing_page_file_is_no_cache_never_immutable(app, path):
    r = bare_client(app).get(path)
    assert r.headers.get("cache-control") == "no-cache"
    if path == MISSING_HASHED:
        assert r.status_code == 404  # a missing hashed name must never be cached for a year


def test_regression_guard_an_api_answer_gets_no_cache_header_from_the_page_rule(app):
    r = api_client(app).get("/api/health")
    assert r.status_code == 200
    assert "cache-control" not in r.headers


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/assets/index-CZqhk4Fd.js", "/api/no-such-route"])
def test_regression_guard_an_api_path_shaped_like_an_asset_gets_no_cache_header(app, path):
    r = api_client(app).get(path)
    assert "cache-control" not in r.headers or r.headers["cache-control"] == "no-store"
    assert "immutable" not in r.headers.get("cache-control", "")


def test_an_api_refusal_keeps_its_own_no_store(app):
    r = bare_client(app).get("/api/health")  # no session: the session middleware's 401 sets no-store itself
    assert r.status_code == 401 and r.headers.get("cache-control") == "no-store"


def test_the_proof_route_keeps_its_own_no_store(app):
    r = bare_client(app).get("/api/desktop/proof", params={"nonce": "3c" * 32})
    assert r.headers.get("cache-control") == "no-store"


def test_the_security_headers_still_ride_on_an_asset(app):
    r = bare_client(app).get(HASHED_JS)
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert "frame-ancestors 'none'" in r.headers.get("content-security-policy", "")


def test_regression_guard_the_static_mount_is_still_the_one_plain_staticfiles_at_root(app, dist):
    mounts = [route for route in app.routes if isinstance(route, Mount)]
    assert len(mounts) == 1
    (mount,) = mounts
    assert mount.path == "" and type(mount.app) is StaticFiles
    assert Path(mount.app.directory).resolve() == dist.resolve()


@pytest.mark.parametrize("path, hashed", [
    ("/assets/index-CZqhk4Fd.js", True),
    ("/assets/Cone-CLmF-tnY.js", True),
    ("/assets/Bergoom-Bold-hZFEh5oo.woff2", True),
    ("/assets/index-CZqhk4Fd.css", True),
    ("/assets/plain.js", False),
    ("/assets/short-abc.js", False),
    ("/assets/sub/index-CZqhk4Fd.js", False),  # Vite writes no sub-folders under assets/
    ("/assets/index-CZqhk4Fd", False),
    ("/assets/index-CZq.k4Fd.js", False),
    ("/index-CZqhk4Fd.js", False),
    ("/api/assets/index-CZqhk4Fd.js", False),
    ("/assets/..%2Findex-CZqhk4Fd.js", False),
])
def test_is_hashed_asset_reads_vite_names_only(path, hashed):
    assert security.is_hashed_asset(path) is hashed


@pytest.mark.parametrize("path", ["/api", "/api/health", "/api/assets/index-CZqhk4Fd.js", "/api/live/stream"])
@pytest.mark.parametrize("status", [200, 304, 404])
def test_born_failing_the_page_rule_gives_no_cache_header_under_api(path, status):
    assert security.page_cache_control(path, status) is None


@pytest.mark.parametrize("path, status, expected", [
    (HASHED_JS, 200, IMMUTABLE),
    (HASHED_JS, 206, IMMUTABLE),
    (HASHED_JS, 304, IMMUTABLE),
    (HASHED_JS, 404, "no-cache"),  # a missing hashed name, or an error, is never kept for a year
    (HASHED_JS, 500, "no-cache"),
    ("/", 200, "no-cache"),
    ("/index.html", 200, "no-cache"),
    (UNHASHED, 200, "no-cache"),
    ("/apiary.html", 200, "no-cache"),  # outside /api: a page file
])
def test_born_failing_the_page_rule_by_path_and_status(path, status, expected):
    assert security.page_cache_control(path, status) == expected.encode("latin-1")
