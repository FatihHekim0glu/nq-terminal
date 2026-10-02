"""DQ routes (GET only): /api/dq/symbols, /api/dq/calendar/{symbol}, /api/dq/guards, in fixture mode over a tmp tree.

`create_app` includes the router before the web mount; these tests build it with no web/dist.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.api import dq as dq_api
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.settings import load_settings

from dq_fixtures import write_dq_results

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    write_dq_results(tmp_path)
    settings = replace(load_settings({"NQT_FIXTURE_DIR": str(tmp_path)}), web_dist=tmp_path / "no-dist")
    app = create_app(settings)  # create_app includes the DQ router before the web mount
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


def test_router_prefix_and_get_only():
    assert dq_api.router.prefix == "/api/dq"
    assert {m for r in dq_api.router.routes for m in r.methods} <= {"GET", "HEAD"}


def test_symbols(client):
    body = client.get("/api/dq/symbols").json()
    assert [s["symbol"] for s in body["symbols"]] == ["NQ.V.0", "ES.V.0", "GC.V.0"]
    assert body["fence"] == "2021-12-31"


def test_calendar(client):
    body = client.get("/api/dq/calendar/GC.V.0").json()
    assert body["symbol"]["counts"]["rebuilt"] == 1
    assert [d["state"] for d in body["days"]] == ["vendor", "rebuilt", "unrepairable", "vendor"]


def test_calendar_unknown_symbol_is_404(client):
    r = client.get("/api/dq/calendar/ZZ.V.0")
    assert r.status_code == 404 and "ZZ.V.0" in r.json()["detail"]


@pytest.mark.parametrize("bad", ["NQ", "nq.v.0", "..%2Fsecret", "ABCDEFG.V.0"])
def test_calendar_bad_symbol_is_422(client, bad):
    assert client.get(f"/api/dq/calendar/{bad}").status_code in (404, 422)
    assert client.get("/api/dq/calendar/nq.v.0").status_code == 422


def test_guards(client):
    body = client.get("/api/dq/guards").json()
    assert body["mismatch"] == 0 and body["ok"] == len(body["groups"])


def test_post_is_refused(client):
    assert client.post("/api/dq/symbols").status_code == 405


def test_no_local_path_in_any_body(client, tmp_path):
    for url in ("/api/dq/symbols", "/api/dq/calendar/NQ.V.0", "/api/dq/guards"):
        text = client.get(url).text
        assert str(tmp_path).replace("\\", "\\\\") not in text and "Users" not in text
