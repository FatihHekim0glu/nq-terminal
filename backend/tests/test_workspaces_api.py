"""GET and PUT /api/workspaces/{doc}: the third write route (03 10.3, D3.1, G03)."""
from __future__ import annotations

import dataclasses
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from nq_terminal.api import workspaces as workspaces_api
from nq_terminal.app import create_app
from nq_terminal.models import workspaces as ws
from nq_terminal.settings import load_settings

from conftest import api_client, bare_client

PATH = "/api/workspaces"
WRITE = {"X-NQT": "1"}
RECIPE = {"version": 1, "panels": [{"line": "HOME", "group": "-", "ref": None, "direction": "right"}],
          "groups": {"A": None, "B": None, "C": None}}


def build_app(state: Path) -> FastAPI:
    settings = dataclasses.replace(load_settings({}), web_dist=state / "no_dist", state_dir=state)
    app = create_app(settings)
    paths = {ctx.path for ctx in iter_route_contexts(app.routes)}
    if f"{PATH}/{{doc}}" not in paths:  # until the merge step registers it in create_app
        app.include_router(workspaces_api.router)
    return app


@pytest.fixture
def state(tmp_path: Path) -> Path:
    folder = tmp_path / "state"
    folder.mkdir()
    return folder


@pytest.fixture
def app(state) -> FastAPI:
    return build_app(state)


@pytest.fixture
def client(app) -> TestClient:
    made = api_client(app)
    yield made
    made.close()


def put(client, doc, data, version, *, headers=None, **body):
    sent = {**WRITE, **({"If-Match": str(version)} if version is not None else {}), **(headers or {})}
    return client.put(f"{PATH}/{doc}", json={"data": data, **body}, headers=sent)


def stored_files(state: Path) -> list[str]:
    return sorted(str(p.relative_to(state)).replace("\\", "/") for p in state.rglob("*") if p.is_file())


# ---------------------------------------------------------------- reads

def test_the_index_lists_the_seven_documents(client):
    r = client.get(PATH)
    assert r.status_code == 200
    assert [d["doc"] for d in r.json()["documents"]] == list(ws.DOC_NAMES)
    assert {d["version"] for d in r.json()["documents"]} == {0}


def test_a_missing_document_reads_as_its_default(client, state):
    r = client.get(f"{PATH}/history")
    assert r.status_code == 200
    assert r.json() == {"doc": "history", "schema_version": 1, "version": 0, "saved_at": None, "data": []}
    assert r.headers["etag"] == '"0"'
    assert stored_files(state) == []


@pytest.mark.parametrize("name", ["secrets", "History", "workspaces.json", "%2E%2E", "%2e%2e", "..%2Fhistory",
                                  "history%2F..", "a%2Fb", "meta.json", "history.json.1", "%00"])
def test_a_name_outside_the_seven_gets_404_on_both_verbs(client, state, name):
    assert client.get(f"{PATH}/{name}").status_code == 404
    r = client.put(f"{PATH}/{name}", json={"data": []}, headers={**WRITE, "If-Match": "0"})
    assert r.status_code == 404
    assert stored_files(state) == []


def test_reads_are_cached_nowhere(client):
    assert client.get(f"{PATH}/prefs").headers["cache-control"] == "no-store"


# ---------------------------------------------------------------- writes

def test_a_put_stores_the_document_and_answers_the_new_version(client, state):
    r = put(client, "history", ["HOME", "GP NQ"], 0)
    assert r.status_code == 200
    body = r.json()
    assert (body["doc"], body["version"], body["data"]) == ("history", 1, ["HOME", "GP NQ"])
    assert r.headers["etag"] == '"1"' and r.headers["cache-control"] == "no-store"
    assert client.get(f"{PATH}/history").json() == body
    assert stored_files(state) == ["workspaces/history.json"]


def test_if_match_may_be_quoted(client):
    assert put(client, "history", ["A"], '"0"').status_code == 200
    assert put(client, "history", ["B"], '"1"').status_code == 200


def test_a_stale_version_gets_412_and_the_current_one_in_the_header(client, state):
    put(client, "history", ["A"], 0)
    r = put(client, "history", ["B"], 0)
    assert r.status_code == 412 and r.headers["etag"] == '"1"'
    assert client.get(f"{PATH}/history").json()["data"] == ["A"]
    assert put(client, "history", ["B"], 1).status_code == 200


@pytest.mark.parametrize("value", ["abc", "-1", "1.5", "*", "W/1", "", " "])
def test_a_malformed_if_match_gets_412(client, value):
    assert put(client, "history", ["A"], value).status_code == 412


def test_a_put_without_if_match_gets_428(client, state):
    r = put(client, "history", ["A"], None)
    assert r.status_code == 428 and stored_files(state) == []


@pytest.mark.parametrize(("doc", "data"), [
    ("workspaces", {"list": {f"WS{n:02d}": RECIPE for n in range(13)}, "last": None}),
    ("layouts", {"HOME": {"pad": "x" * ws.MAX_LAYOUT_CHARS}}),
    ("linkGroups", {"contexts": {"A": None, "B": None, "C": None}, "pad": "x" * 9000}),
    ("watch", {"pad": "x" * ws.MAX_WATCH_CHARS}),
    ("history", ["L"] * 101),
    ("prefs", {"theme": "x" * 4100}),
    ("meta", {"schema": 1, "imports": [{"origin": "o" * 40, "at": "t"}] * 50}),
])
def test_a_document_over_its_cap_gets_413_and_is_not_stored(client, state, doc, data):
    assert put(client, doc, data, 0).status_code == 413
    assert stored_files(state) == []


def test_a_body_far_over_every_cap_gets_413_before_it_is_parsed(client, state):
    r = client.put(f"{PATH}/history", content=b'{"data": ["' + b"x" * 5_000_000 + b'"]}',
                   headers={**WRITE, "If-Match": "0", "Content-Type": "application/json"})
    assert r.status_code == 413 and stored_files(state) == []


@pytest.mark.parametrize(("doc", "data"), [
    ("history", "HOME"), ("history", [1]), ("prefs", {"other": 1}), ("layouts", {"home": {}}),
    ("workspaces", {"list": {"lower": RECIPE}, "last": None}), ("linkGroups", {"nope": 1}),
    ("watch", [1]), ("meta", {"schema": "1", "imports": []}),
])
def test_a_document_of_the_wrong_shape_gets_422(client, state, doc, data):
    assert put(client, doc, data, 0).status_code == 422
    assert stored_files(state) == []


@pytest.mark.parametrize("content", [b"{not json", b"[]", b'{"nodata": 1}', b'{"data": [], "extra": 1}', b"",
                                     b'{"data": ' + b"[" * 5000 + b"]" * 5000 + b"}"])
def test_a_body_that_is_not_a_document_envelope_gets_422(client, state, content):
    r = client.put(f"{PATH}/history", content=content,
                   headers={**WRITE, "If-Match": "0", "Content-Type": "application/json"})
    assert r.status_code == 422 and stored_files(state) == []


def test_the_content_type_must_be_json(client, state):
    r = client.put(f"{PATH}/history", content=b'{"data": []}', headers={**WRITE, "If-Match": "0",
                                                                         "Content-Type": "text/plain"})
    assert r.status_code == 415 and stored_files(state) == []


def test_the_write_header_is_required(client, state):
    r = client.put(f"{PATH}/history", json={"data": []}, headers={"If-Match": "0"})
    assert r.status_code == 403 and stored_files(state) == []


def test_a_client_time_is_ignored_and_the_stored_time_is_the_backends(client):
    now = datetime.now(timezone.utc)
    for claimed in ("1999-01-01T00:00:00Z", "2999-01-01T00:00:00Z"):
        version = client.get(f"{PATH}/watch").json()["version"]
        r = put(client, "watch", {"saved_at": claimed}, version, saved_at=claimed)
        assert r.status_code == 200
        stored = datetime.strptime(r.json()["saved_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        assert abs(stored - now) < timedelta(seconds=30)


def test_the_eighth_write_keeps_dot_one_to_dot_five_and_nothing_else_appears(client, state):
    for version in range(8):
        assert put(client, "layouts", {"HOME": {"n": version}}, version).status_code == 200
    put(client, "linkGroups", {"contexts": {"A": None, "B": None, "C": None}}, 0)
    assert stored_files(state) == sorted(
        ["workspaces/linkGroups.json"] + ["workspaces/layouts.json"] + [f"workspaces/layouts.json.{n}" for n in range(1, 6)])
    assert json.loads((state / "workspaces" / "layouts.json.1").read_text(encoding="utf-8"))["version"] == 7


def test_a_failed_write_answers_503_without_a_path(client, state, monkeypatch):
    from nq_terminal.services import workspaces as service

    def broken(*_args, **_kwargs):
        raise OSError(f"cannot write {state}")

    monkeypatch.setattr(service.os, "replace", broken)
    r = put(client, "history", ["A"], 0)
    assert r.status_code == 503 and str(state) not in r.text
    monkeypatch.undo()
    assert client.get(f"{PATH}/history").json()["version"] == 0


def test_a_transient_read_fault_answers_503_on_every_route_and_the_version_holds(client, state, monkeypatch):
    assert put(client, "history", ["A"], 0).status_code == 200
    real = Path.read_bytes

    def refused(self):
        if self.name == "history.json":
            raise PermissionError(f"sharing violation on {state}")
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", refused)
    for reply in (client.get(PATH), client.get(f"{PATH}/history"), put(client, "history", ["B"], 1),
                  put(client, "history", ["B"], "abc")):
        assert reply.status_code == 503 and str(state) not in reply.text
    monkeypatch.undo()
    assert client.get(f"{PATH}/history").json()["version"] == 1


# ---------------------------------------------------------------- the session middleware (W2B)

def test_a_put_without_an_origin_is_refused_by_the_session_middleware(app, state):
    c = api_client(app)
    r = TestClient.request(c, "PUT", f"{PATH}/history", json={"data": []}, headers={**WRITE, "If-Match": "0"})
    assert r.status_code == 403 and stored_files(state) == []


@pytest.mark.parametrize("headers", [{"Origin": "http://evil.example"}, {"Origin": "http://127.0.0.1:1"},
                                     {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}])
def test_a_put_from_another_origin_or_site_is_refused(app, state, headers):
    r = put(api_client(app), "history", [], 0, headers=headers)
    assert r.status_code == 403 and stored_files(state) == []


def test_a_put_without_a_session_gets_401(app, state):
    r = bare_client(app).put(f"{PATH}/history", json={"data": []},
                             headers={**WRITE, "If-Match": "0", "Origin": "http://127.0.0.1:1"})
    assert r.status_code == 401 and stored_files(state) == []
    assert bare_client(app).get(f"{PATH}/history").status_code == 401


# ---------------------------------------------------------------- meta over HTTP

def meta_body(client, *origins, schema=1):
    return {"schema": schema, "imports": client.get(f"{PATH}/meta").json()["data"]["imports"]
            + [{"origin": o, "at": "x"} for o in origins]}


def test_a_meta_put_adding_the_sessions_own_origin_is_stored(client):
    r = put(client, "meta", meta_body(client, client.origin), 0)
    assert r.status_code == 200
    assert [e["origin"] for e in r.json()["data"]["imports"]] == [client.origin]
    assert r.json()["data"]["schema"] == 1 and r.json()["data"]["imports"][0]["at"] != "x"


def test_a_meta_put_adding_another_origin_gets_422(client, state):
    r = put(client, "meta", meta_body(client, "http://127.0.0.1:9"), 0)
    assert r.status_code == 422 and stored_files(state) == []


def test_two_sessions_each_add_only_their_own_origin(app, state):
    first, second = api_client(app, origin="http://127.0.0.1:41001"), api_client(app, origin="http://localhost:41002")
    assert put(first, "meta", meta_body(first, first.origin), 0).status_code == 200
    assert put(second, "meta", meta_body(second, first.origin), 1).status_code == 422  # not its own origin
    assert put(second, "meta", meta_body(second, second.origin), 1).status_code == 200
    origins = [e["origin"] for e in first.get(f"{PATH}/meta").json()["data"]["imports"]]
    assert origins == [first.origin, second.origin]


def test_a_meta_put_changing_the_schema_gets_422(client):
    assert put(client, "meta", meta_body(client, client.origin, schema=2), 0).status_code == 422


# ---------------------------------------------------------------- the contract

def test_the_openapi_names_the_two_routes_and_the_error_codes(app):
    paths = app.openapi()["paths"]
    assert set(paths[f"{PATH}/{{doc}}"]) == {"get", "put"} and set(paths[PATH]) == {"get"}
    assert {"200", "404", "412", "413", "422", "428", "503"} <= set(paths[f"{PATH}/{{doc}}"]["put"]["responses"])
    assert {"If-Match"} <= {p["name"] for p in paths[f"{PATH}/{{doc}}"]["put"]["parameters"]}


def test_the_openapi_names_the_503_of_a_read_the_page_treats_as_the_store_being_unavailable(app):
    paths = app.openapi()["paths"]
    for route in (PATH, f"{PATH}/{{doc}}"):
        assert "503" in paths[route]["get"]["responses"], route


def test_every_reference_in_the_openapi_resolves(app):
    schema = app.openapi()
    refs: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            refs.extend(v for k, v in node.items() if k == "$ref" and isinstance(v, str))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema["paths"][f"{PATH}/{{doc}}"])
    assert refs and all(ref.split("/")[-1] in schema["components"]["schemas"] for ref in refs), refs
    body = schema["paths"][f"{PATH}/{{doc}}"]["put"]["requestBody"]["content"]["application/json"]["schema"]
    assert body["required"] == ["data"] and body["additionalProperties"] is False
