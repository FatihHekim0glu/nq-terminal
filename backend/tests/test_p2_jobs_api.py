"""`/api/jobs` (ARCHITECTURE sections 8 and 9): POST and DELETE need `X-NQT: 1`, `application/json` and a loopback
peer; GET is read only. `create_app` includes the router and lets `assert_get_only` pass the two write routes. No test starts the real `run_base`.
"""
from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nq_terminal.api import jobs as jobs_api
from nq_terminal.app import GetOnlyError, assert_get_only, create_app, non_get_routes
from nq_terminal.services.jobs import JobService
from nq_terminal.settings import load_settings

from fakes import FIXTURES
from p2_jobs_fakes import PYTHON, FakePopen, make_fake_root, spec_dict, wait_for

from conftest import api_client, bare_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
HEADERS = {"X-NQT": "1", "Content-Type": "application/json"}


def with_jobs(app: FastAPI) -> FastAPI:
    """`create_app` includes the router before the static mount and lets exactly its two writes through."""
    assert sorted(non_get_routes(app)) == sorted(jobs_api.ALLOWED_WRITE_ROUTES)
    return app


@pytest.fixture
def popen() -> FakePopen:
    return FakePopen(hold=True)


@pytest.fixture
def client(tmp_path, popen) -> TestClient:
    app = with_jobs(create_app(load_settings({})))
    root = make_fake_root(tmp_path)
    app.state.jobs = JobService(root=root, state_dir=tmp_path / "state", python=PYTHON, popen=popen)
    app.state.test_root = root
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as c:
        yield c
    popen.release_all()
    app.state.jobs.close()


def post(client: TestClient, body, headers=None):
    payload = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return client.post("/api/jobs", content=payload, headers=HEADERS if headers is None else headers)


def count_jobs(client: TestClient) -> int:
    return len(client.get("/api/jobs").json()["jobs"])


def test_the_only_non_get_routes_are_the_job_writes_the_launch_action_and_the_workspace_put(tmp_path) -> None:
    app = with_jobs(create_app(load_settings({})))
    assert jobs_api.ALLOWED_WRITE_ROUTES == (
        "POST /api/jobs", "DELETE /api/jobs/{job_id}", "POST /api/jobs/actions", "PUT /api/workspaces/{doc}")
    assert sorted(non_get_routes(app)) == sorted(jobs_api.ALLOWED_WRITE_ROUTES)
    # the app registers exactly those four writes; without the allow list the GET-only check refuses it
    assert sorted(non_get_routes(create_app(load_settings({})))) == sorted(jobs_api.ALLOWED_WRITE_ROUTES)
    with pytest.raises(GetOnlyError):
        assert_get_only(app)
    assert_get_only(app, jobs_api.ALLOWED_WRITE_ROUTES)


def test_an_accepted_job_is_201_with_the_job_body(client) -> None:
    response = post(client, spec_dict("t_api"))
    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"j_[0-9a-f]{12}", body["id"]) and body["run_id"] == "t_api"
    assert body["state"] in ("queued", "running") and body["spec"] == spec_dict("t_api")
    assert set(body) == {"id", "run_id", "state", "spec", "created", "started", "finished", "exit_code",
                         "message", "log_tail"}


def test_a_missing_nqt_header_is_403_and_queues_nothing(client, popen) -> None:
    response = post(client, spec_dict(), headers={"Content-Type": "application/json"})
    assert response.status_code == 403 and "X-NQT" in response.json()["detail"]
    assert count_jobs(client) == 0 and popen.calls == []


@pytest.mark.parametrize("value", ["0", "2", "true", "", " 1 x"])
def test_a_wrong_nqt_header_is_403(client, value: str) -> None:
    assert post(client, spec_dict(), headers={**HEADERS, "X-NQT": value}).status_code == 403
    assert count_jobs(client) == 0


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data",
                                          "application/jsonx", "text/json", None])
def test_a_body_that_is_not_json_content_is_415(client, content_type) -> None:
    headers = {"X-NQT": "1"} | ({"Content-Type": content_type} if content_type else {})
    response = client.post("/api/jobs", content=json.dumps(spec_dict()), headers=headers)
    assert response.status_code == 415 and count_jobs(client) == 0


def test_json_with_a_charset_is_accepted(client) -> None:
    headers = {**HEADERS, "Content-Type": "application/json; charset=utf-8"}
    assert post(client, spec_dict("t_cs"), headers=headers).status_code == 201


def test_a_cross_origin_post_is_403(client) -> None:
    response = post(client, spec_dict(), headers={**HEADERS, "Origin": "http://evil.example"})
    assert response.status_code == 403 and count_jobs(client) == 0
    assert post(client, spec_dict(), headers={**HEADERS, "Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_the_terminal_own_origin_is_accepted(client) -> None:
    ok = post(client, spec_dict("t_origin"), headers={**HEADERS, "Origin": "http://127.0.0.1:8765"})
    assert ok.status_code == 201


@pytest.mark.parametrize("peer", [("192.168.1.50", 50000), ("10.0.0.7", 1234), ("testclient", 50000)])
def test_a_non_loopback_peer_is_403(tmp_path, popen, peer) -> None:
    app = with_jobs(create_app(load_settings({})))
    app.state.jobs = JobService(root=make_fake_root(tmp_path), state_dir=None, python=PYTHON, popen=popen)
    c = api_client(app, base_url=LOCAL, client=peer)
    assert c.post("/api/jobs", content=json.dumps(spec_dict()), headers=HEADERS).status_code == 403
    assert c.delete("/api/jobs/j_000000000000", headers=HEADERS).status_code == 403
    assert popen.calls == []
    app.state.jobs.close()


def test_the_write_guard_itself_refuses_a_non_loopback_peer(client) -> None:
    """Defence in depth: the dependency checks the peer even if the middleware were missing."""
    from starlette.requests import Request

    scope = {"type": "http", "method": "POST", "path": "/api/jobs", "client": ("10.0.0.7", 1),
             "server": ("127.0.0.1", 8765), "headers": [(b"x-nqt", b"1"), (b"content-type", b"application/json")],
             "app": client.app}
    with pytest.raises(Exception) as caught:
        jobs_api.write_guard(Request(scope))
    assert getattr(caught.value, "status_code", None) == 403


def guard_request(app: FastAPI, **extra: str):
    """A POST /api/jobs request from a loopback peer with the X-NQT header and a JSON body type, plus `extra` headers."""
    from starlette.requests import Request

    headers = {"x-nqt": "1", "content-type": "application/json"} | {k.lower(): v for k, v in extra.items()}
    scope = {"type": "http", "method": "POST", "path": "/api/jobs", "client": LOOPBACK, "server": ("127.0.0.1", 8765),
             "headers": [(k.encode(), v.encode()) for k, v in headers.items()], "app": app}
    return Request(scope)


@pytest.mark.parametrize("extra", [
    {"Origin": "http://evil.example"}, {"Origin": "http://127.0.0.1:1"}, {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}, {"Sec-Fetch-Site": ""}])
def test_the_write_guard_itself_refuses_a_foreign_origin_or_fetch_site(client, extra) -> None:
    """Defence in depth: SessionMiddleware sits outside the router and refuses these first, so the router's own check
    is called directly; a guard that accepted any Origin or Sec-Fetch-Site would otherwise go unnoticed."""
    with pytest.raises(Exception) as caught:
        jobs_api.write_guard(guard_request(client.app, **extra))
    assert getattr(caught.value, "status_code", None) == 403
    assert "cross-site" in str(getattr(caught.value, "detail", ""))


@pytest.mark.parametrize("extra", [
    {}, {"Origin": "http://127.0.0.1:8765"}, {"Origin": "http://localhost:8765"}, {"Sec-Fetch-Site": "same-origin"},
    {"Sec-Fetch-Site": "none"}])
def test_the_write_guard_itself_accepts_the_terminal_own_origin(client, extra) -> None:
    """The control for the refusals above: the same call passes when the origin and fetch site are the terminal's."""
    assert jobs_api.write_guard(guard_request(client.app, **extra)) is None


@pytest.fixture
def router_only(tmp_path, popen) -> TestClient:
    """The JOBS router on a bare app: no session, host or origin middleware, so only the router's own checks answer."""
    app = FastAPI()
    app.state.settings = load_settings({})
    app.state.jobs = JobService(root=make_fake_root(tmp_path), state_dir=tmp_path / "state", python=PYTHON, popen=popen)
    app.include_router(jobs_api.router)
    with bare_client(app) as c:
        yield c
    popen.release_all()
    app.state.jobs.close()


@pytest.mark.parametrize("extra", [{"Origin": "http://evil.example"}, {"Sec-Fetch-Site": "cross-site"}])
def test_the_router_alone_refuses_a_cross_site_post_and_delete(router_only, popen, extra) -> None:
    c = router_only
    refused = c.post("/api/jobs", content=json.dumps(spec_dict("t_x")), headers={**HEADERS, **extra})
    assert refused.status_code == 403 and "cross-site" in refused.json()["detail"]
    assert c.delete("/api/jobs/j_000000000000", headers={**HEADERS, **extra}).status_code == 403
    assert c.get("/api/jobs").json()["jobs"] == [] and popen.calls == []
    same = c.post("/api/jobs", content=json.dumps(spec_dict("t_ok")), headers={**HEADERS, "Origin": "http://127.0.0.1:8765"})
    assert same.status_code == 201


@pytest.mark.parametrize("mutation", [
    {"strategy": "evil"}, {"run_id": "t_a/b"}, {"run_id": "t_..\\x"}, {"end": "2022-01-02"}, {"start": "2009-01-01"},
    {"strategy": "za_orb", "params": {"or_minutes": "5; calc"}}, {"extra": 1}, {"variant": "x"}])
def test_an_invalid_spec_is_422_and_queues_nothing(client, popen, mutation) -> None:
    response = post(client, spec_dict(**mutation))
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert count_jobs(client) == 0 and popen.calls == []


@pytest.mark.parametrize("run_id", ["t_x_regress_r1", "t_x_haltfix_r2"])
def test_a_hand_queued_job_cannot_take_an_anchor_run_id(client, popen, run_id) -> None:
    response = post(client, spec_dict(run_id=run_id))
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert count_jobs(client) == 0 and popen.calls == []


@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"null", b'"x"', b"\xff\xfe", b"NaN"])
def test_a_malformed_body_is_422(client, body: bytes) -> None:
    assert post(client, body).status_code == 422


def test_an_oversized_body_is_413(client) -> None:
    assert post(client, b" " * (jobs_api.MAX_BODY_BYTES + 1)).status_code == 413


def test_a_twelfth_queued_job_is_429(client, popen) -> None:
    first = post(client, spec_dict("t_run")).json()["id"]
    assert wait_for(lambda: client.get(f"/api/jobs/{first}").json()["state"] == "running")
    for i in range(10):
        assert post(client, spec_dict(f"t_w{i}")).status_code == 201
    response = post(client, spec_dict("t_twelfth"))
    assert response.status_code == 429 and "full" in response.json()["detail"]
    listing = client.get("/api/jobs").json()
    assert (listing["queued"], listing["running"], listing["queue_cap"]) == (10, 1, 10)


def test_a_repeated_run_id_is_409(client) -> None:
    assert post(client, spec_dict("t_dup")).status_code == 201
    assert post(client, spec_dict("t_dup")).status_code == 409


def test_a_run_id_with_an_output_folder_is_409(client) -> None:
    (client.app.state.test_root / "backtests" / "output" / "t_out").mkdir(parents=True)
    assert post(client, spec_dict("t_out")).status_code == 409


def test_list_and_get(client, popen) -> None:
    first = post(client, spec_dict("t_a")).json()["id"]
    second = post(client, spec_dict("t_b")).json()["id"]
    listing = client.get("/api/jobs").json()
    assert [j["id"] for j in listing["jobs"]] == [second, first] and listing["enabled"] is True
    assert client.get(f"/api/jobs/{first}").json()["run_id"] == "t_a"
    popen.release_all()
    assert wait_for(lambda: client.get(f"/api/jobs/{second}").json()["state"] == "ok")
    done = client.get(f"/api/jobs/{second}").json()
    assert done["exit_code"] == 0 and done["log_tail"] == ["ok"]


def test_get_an_unknown_job_is_404_and_a_malformed_id_is_422(client) -> None:
    assert client.get("/api/jobs/j_000000000000").status_code == 404
    for bad in ("x", "j_zz", "j_" + "0" * 13, "..", "t_one"):
        assert client.get(f"/api/jobs/{bad}").status_code in (404, 422)
    assert client.get("/api/jobs/j_ABCDEF012345").status_code == 422


def test_delete_stops_a_queued_job(client, popen) -> None:
    first = post(client, spec_dict("t_a")).json()["id"]
    second = post(client, spec_dict("t_b")).json()["id"]
    assert wait_for(lambda: client.get(f"/api/jobs/{first}").json()["state"] == "running")
    response = client.delete(f"/api/jobs/{second}", headers=HEADERS)
    assert response.status_code == 200 and response.json()["state"] == "stopped"
    popen.release_all()
    assert wait_for(lambda: client.get(f"/api/jobs/{first}").json()["state"] == "ok")
    assert len(popen.calls) == 1


def test_delete_stops_a_running_job_and_later_removes_it(client, popen) -> None:
    job = post(client, spec_dict("t_a")).json()["id"]
    assert wait_for(lambda: client.get(f"/api/jobs/{job}").json()["state"] == "running")
    client.delete(f"/api/jobs/{job}", headers=HEADERS)
    assert wait_for(lambda: client.get(f"/api/jobs/{job}").json()["state"] == "stopped")
    assert client.delete(f"/api/jobs/{job}", headers=HEADERS).status_code == 200  # now a finished record: removed
    assert client.get(f"/api/jobs/{job}").status_code == 404


def test_delete_needs_the_header_and_json_content_type(client) -> None:
    job = post(client, spec_dict("t_a")).json()["id"]
    assert client.delete(f"/api/jobs/{job}", headers={"Content-Type": "application/json"}).status_code == 403
    assert client.delete(f"/api/jobs/{job}", headers={"X-NQT": "1"}).status_code == 415
    assert client.delete(f"/api/jobs/{job}", headers={"X-NQT": "1", "Content-Type": "text/plain"}).status_code == 415
    assert client.delete(f"/api/jobs/{job}", headers={**HEADERS, "Origin": "http://evil.example"}).status_code == 403
    assert client.get(f"/api/jobs/{job}").json()["state"] in ("queued", "running")


def test_delete_an_unknown_job_is_404(client) -> None:
    assert client.delete("/api/jobs/j_000000000000", headers=HEADERS).status_code == 404


def test_other_methods_are_refused(client) -> None:
    for method in ("put", "patch"):
        assert getattr(client, method)("/api/jobs", headers=HEADERS, content="{}").status_code == 405


def test_fixture_mode_lists_nothing_and_refuses_new_jobs() -> None:
    app = with_jobs(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})))
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as c:
        listing = c.get("/api/jobs").json()
        assert listing["jobs"] == [] and listing["enabled"] is False
        response = post(c, spec_dict())
        assert response.status_code == 503 and "fixture" in response.json()["detail"]


def test_error_bodies_carry_no_path(client) -> None:
    (client.app.state.test_root / "backtests" / "output" / "t_out").mkdir(parents=True)
    text = post(client, spec_dict("t_out")).text + post(client, spec_dict(end="2023-01-01")).text
    assert str(client.app.state.test_root) not in text and "\\\\" not in text


def test_the_schema_has_the_job_models_and_no_order_words() -> None:
    schema = with_jobs(create_app(load_settings({}))).openapi()
    assert {"Job", "JobList", "JobSpec"} <= set(schema["components"]["schemas"])
    ours = {p: ops for p, ops in schema["paths"].items() if p.startswith("/api/jobs")}
    launch = {"/api/jobs/actions", "/api/jobs/actions/presets", "/api/jobs/actions/anchors/{run_id}"}  # V020 (api/actions.py)
    assert set(ours) == {"/api/jobs", "/api/jobs/{job_id}"} | launch
    assert set(ours["/api/jobs"]) == {"get", "post"} and set(ours["/api/jobs/{job_id}"]) == {"get", "delete"}
    assert set(ours["/api/jobs/actions"]) == {"post"} and set(ours["/api/jobs/actions/presets"]) == {"get"}
    assert set(ours["/api/jobs/actions/anchors/{run_id}"]) == {"get"}
    words = re.compile(r"order|submit|cancel|modify", re.IGNORECASE)
    names = list(ours) + [op["operationId"] for ops in ours.values() for op in ops.values()]
    assert not [n for n in names if words.search(n)]
    post_body = ours["/api/jobs"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    assert post_body == {"$ref": "#/components/schemas/JobSpec"}


def test_security_headers_ride_on_job_responses(client) -> None:
    response = client.get("/api/jobs")
    assert response.headers["x-frame-options"] == "DENY" and response.headers["x-content-type-options"] == "nosniff"


def test_the_listing_gives_the_shell_a_running_integer(client) -> None:
    """The desktop shell asks `GET /api/jobs` for `running` (link.rs `running_jobs`) before it closes; this route is
    not in the shell's contract hash, so this pin is what stops the field being renamed or retyped unnoticed."""
    idle = client.get("/api/jobs").json()
    assert idle["running"] == 0 and type(idle["running"]) is int
    first = post(client, spec_dict("t_shell_pin")).json()["id"]
    assert wait_for(lambda: client.get(f"/api/jobs/{first}").json()["state"] == "running")
    busy = client.get("/api/jobs").json()
    assert busy["running"] == 1 and type(busy["running"]) is int
