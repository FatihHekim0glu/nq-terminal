"""Research endpoints (ARCHITECTURE s4 Research): GET only, names checked against the index built from disk."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from nq_lab.config import IS_END
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import create_app, non_get_routes
from nq_terminal.settings import load_settings

from test_research_support import PRICE_PATTERN, build_root, build_sealed_root, flip_one_byte, real_registry_rows

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
RESEARCH_PATHS = ("/api/registry", "/api/hypotheses", "/api/multiple-testing", "/api/confirmations", "/api/sealed")


def client_for(root: Path | None) -> TestClient:
    env = {} if root is None else {"NQT_FIXTURE_DIR": str(root)}
    return api_client(create_app(load_settings(env)), base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def real_client() -> TestClient:
    return client_for(None)


def test_research_routes_are_registered_and_get_only():
    app = create_app(load_settings({}))
    routes = {ctx.path: ctx.methods for ctx in iter_route_contexts(app.routes) if ctx.path}
    for path in (*RESEARCH_PATHS, "/api/hypotheses/{name}", "/api/hypotheses/{name}/series", "/api/sealed/{name}"):
        assert routes.get(path) == {"GET"}, path
    assert sorted(non_get_routes(app)) == sorted(ALLOWED_WRITE_ROUTES)


def test_registry_endpoint_counts_come_from_the_file(real_client):
    rows = real_registry_rows()
    body = real_client.get("/api/registry").json()
    assert body["counts"]["rows"] == len(rows) == len(body["rows"])
    assert body["counts"]["registered"] == sum(r["registered"] == "True" for r in rows)


def test_hypotheses_list_and_detail(real_client):
    cards = real_client.get("/api/hypotheses").json()
    assert len(cards) == len(real_registry_rows())
    registered = [c for c in cards if c["registered"]]
    assert registered and all(c["spec_rehash_ok"] is True for c in registered)
    detail = real_client.get("/api/hypotheses/overnight_v0").json()
    assert set(detail) >= {"card", "screen", "spec", "auxiliaries", "history", "summary_md"}
    assert detail["card"]["verdict_badge"] == "PASS"


@pytest.mark.parametrize("name", ["nope_v0", "..%2Fregistry", "overnight_v0%2F..", "a" * 200])
def test_unknown_names_are_404_or_422(real_client, name):
    assert real_client.get(f"/api/hypotheses/{name}").status_code in (404, 422)
    assert real_client.get(f"/api/sealed/{name}").status_code in (404, 422)


def test_series_endpoint(real_client):
    body = real_client.get("/api/hypotheses/volmanaged_v0/series", params={"cost": 2}).json()
    assert body["basis"] == "A" and body["cost"] == 2 and len(body["t"]) == len(body["r"])
    assert all(isinstance(t, int) for t in body["t"][:5]) and max(body["t"]) < IS_END.timestamp()
    assert real_client.get("/api/hypotheses/fomctone_v0/series", params={"cost": 0}).status_code == 404
    assert real_client.get("/api/hypotheses/volmanaged_v0/series", params={"cost": 3}).status_code == 422


def test_multiple_testing_endpoint(real_client):
    body = real_client.get("/api/multiple-testing").json()
    assert body["matches_registry"] is True and body["k"] == len(body["rows"])


def test_confirmations_endpoint_is_labelled_spent(real_client):
    body = real_client.get("/api/confirmations").json()
    assert body and all(c["label"].startswith("spent window, opened ") for c in body)


def test_sealed_endpoints_serve_no_price_column(real_client):
    items = real_client.get("/api/sealed").json()
    assert {"volmanaged_oos_daily", "rebal_v1_confirm_trades", "rebal_v1_confirm"} <= {i["name"] for i in items}
    for item in items:
        view = real_client.get(f"/api/sealed/{item['name']}").json()
        assert view["label"].startswith("spent window, opened ")
        names = view.get("columns") or []
        assert not [c for c in names if re.search(PRICE_PATTERN, c)], item["name"]


def test_missing_registry_in_fixture_mode_is_503(tmp_path):
    response = client_for(tmp_path).get("/api/hypotheses")
    assert response.status_code == 503 and "registry.csv" in response.json()["detail"]


def test_fixture_root_tampered_spec_shows_through_the_api(tmp_path):
    root = build_root(tmp_path, ("volmanaged_v0",))
    client = client_for(root)
    assert client.get("/api/hypotheses").json()[0]["spec_rehash_ok"] is True
    flip_one_byte(root / "experiments" / "volmanaged_v0.json")
    assert client.get("/api/hypotheses").json()[0]["spec_rehash_ok"] is False


def test_sealed_allowlist_error_is_a_server_error_not_a_leak(tmp_path):
    root = build_sealed_root(tmp_path)
    path = root / "results" / "sealed" / "volmanaged_oos_daily.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    header = lines[0].split(",")
    keep = [i for i, c in enumerate(header) if c != "wstar"]
    path.write_text("\n".join(",".join(line.split(",")[i] for i in keep) for line in lines) + "\n", encoding="utf-8")
    response = client_for(root).get("/api/sealed/volmanaged_oos_daily")
    assert response.status_code == 500 and "wstar" in response.json()["detail"]
    assert set(response.json()) == {"detail"}
