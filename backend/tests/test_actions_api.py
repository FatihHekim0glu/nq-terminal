"""`/api/jobs/actions` (vnext product-1 and product-3): one new write, `POST /api/jobs/actions`, plus two reads.

- `GET /api/jobs/actions/presets`: the launch presets and each strategy's parameter schema.
- `POST /api/jobs/actions` (201): `{"kind": "backtest", ...}` or `{"kind": "anchor", "base_run_id": ...}`; the body
  names a preset or a base run and named parameters only, never a config, a path or a command.
- `GET /api/jobs/actions/anchors/{run_id}`: MATCH, MISMATCH, PENDING or NOT COMPARABLE for a re-run and its base.

The write keeps the JOBS safety model exactly: the session cookie (401 without it), the same-origin Origin, `X-NQT: 1`,
a loopback peer, `application/json`, an 8 KB cap and 503 when the runner is off. Until the merge step includes the
router in `app.py`, these tests include it on an app built by `create_app` (before any static mount).
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI

from nq_terminal.api import actions as actions_api
from nq_terminal.api import jobs as jobs_api
from nq_terminal.app import assert_get_only, create_app, non_get_routes
from nq_terminal.settings import load_settings

from actions_support import (
    OVERNIGHT,
    ZA,
    ZA_EXP,
    FakePopen,
    jobs_for,
    make_root,
    plant_rerun,
    runner_argv,
    runs_for,
    snapshot,
)
from p2_jobs_fakes import wait_for
from test_runs_support import result_doc

from conftest import api_client, bare_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
HEADERS = {"X-NQT": "1", "Content-Type": "application/json"}
ACTIONS, PRESETS = "/api/jobs/actions", "/api/jobs/actions/presets"


def with_actions(app: FastAPI) -> FastAPI:
    """`create_app` includes the actions router itself; this refuses an app that does not."""
    assert ACTIONS in app.openapi()["paths"]
    return app


@pytest.fixture
def popen() -> FakePopen:
    return FakePopen(hold=True)


@pytest.fixture
def lab(tmp_path, popen):
    root = make_root(tmp_path)
    app = with_actions(create_app(load_settings({})))
    app.state.jobs = jobs_for(root, tmp_path, popen)
    app.state.run_service = runs_for(root)
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as client:
        yield root, app, client
    popen.release_all()
    app.state.jobs.close()


def post(client, body, headers=None):
    payload = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return client.post(ACTIONS, content=payload, headers=HEADERS if headers is None else headers)


def za_backtest(**fields) -> dict:
    return {"kind": "backtest", "preset_id": ZA, **fields}


def test_the_router_adds_exactly_one_write(lab) -> None:
    root, app, client = lab
    assert actions_api.WRITE_ROUTES == ("POST /api/jobs/actions",)
    assert "POST /api/jobs/actions" in jobs_api.ALLOWED_WRITE_ROUTES  # the allow list names the launch action
    assert set(actions_api.WRITE_ROUTES) <= set(jobs_api.ALLOWED_WRITE_ROUTES)
    assert sorted(non_get_routes(app)) == sorted(jobs_api.ALLOWED_WRITE_ROUTES)  # and the app adds no other write
    assert_get_only(app, jobs_api.ALLOWED_WRITE_ROUTES)


def test_presets_are_served_with_their_schemas(lab) -> None:
    root, app, client = lab
    response = client.get(PRESETS)
    assert response.status_code == 200
    body = response.json()
    assert [p["preset_id"] for p in body["presets"]] == ["nt_bh_ok_fixture", "nt_bh_fixture", OVERNIGHT, ZA]
    assert set(body) == {"ledger_found", "presets", "strategies"}
    assert {s["strategy"] for s in body["strategies"]} == {"volmanaged_bh", "overnight", "za_orb"}


def test_a_backtest_action_is_201_and_runs_the_exact_runner_command(lab, popen) -> None:
    root, app, client = lab
    response = post(client, za_backtest(params={"target_r": 4}, run_id="t_api_bt"))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "backtest" and body["job"]["run_id"] == "t_api_bt" and body["changed_params"] == ["target_r"]
    assert body["action"]["params"] == {"or_minutes": 5, "target_r": 4.0}
    expected = {"strategy": "za_orb", "params": {"or_minutes": 5, "target_r": 4.0}, "variant": "repaired",
                "start": "2010-09-28", "end": "2022-01-01", "run_id": "t_api_bt"}
    assert wait_for(lambda: popen.calls)
    assert popen.calls[0][0] == runner_argv(root, expected)


def test_an_anchor_action_is_201_and_its_comparison_is_served(lab, popen) -> None:
    root, app, client = lab
    response = post(client, {"kind": "anchor", "base_run_id": ZA})
    assert response.status_code == 201, response.text
    anchor_id = response.json()["job"]["run_id"]
    assert anchor_id == f"t_{ZA}_regress_r1" and response.json()["base_run_id"] == ZA
    pending = client.get(f"{ACTIONS}/anchors/{anchor_id}")
    assert pending.status_code == 200 and pending.json()["verdict"] == "PENDING"
    plant_rerun(root, anchor_id, ZA)
    app.state.run_service.index.rescan()
    done = client.get(f"{ACTIONS}/anchors/{anchor_id}").json()
    assert (done["verdict"], done["base"], done["first_difference"]) == ("MATCH", ZA, None)


def test_a_mismatch_names_the_first_differing_field(lab) -> None:
    root, app, client = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA, lambda doc: doc.update(pnl_total=doc["pnl_total"] - 1.0))
    body = client.get(f"{ACTIONS}/anchors/t_{ZA}_regress_r1").json()
    assert (body["verdict"], body["first_difference"]) == ("MISMATCH", "pnl_total")


@pytest.mark.parametrize("run_id", ["t_nowhere_regress_r1", "..%2F..%2Fresults"])
def test_an_unknown_anchor_is_404(lab, run_id) -> None:
    root, app, client = lab
    assert client.get(f"{ACTIONS}/anchors/{run_id}").status_code == 404


@pytest.mark.parametrize("body", [
    za_backtest(params={"or_minutes": 0}, run_id="t_r1"),
    za_backtest(params={"stop_r": 1.0}, run_id="t_r2"),
    za_backtest(end="2022-01-02", run_id="t_r3"),
    za_backtest(start="2022-01-01", end="2022-02-01", run_id="t_r4"),
    {"kind": "anchor", "base_run_id": ZA, "run_id": "t_mine"},
    {"kind": "backtest", "preset_id": ZA, "config": {"strategy": "za_orb"}},
    {"kind": "backtest", "preset_id": ZA, "command": "python evil.py"},
    {"kind": "shell", "argv": ["cmd"]},
    {"kind": "backtest", "preset_id": ZA, "run_id": "t_../../results"},
])
def test_a_refused_action_is_422_with_reasons_and_queues_nothing(lab, popen, body) -> None:
    root, app, client = lab
    response = post(client, body)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail and all({"loc", "msg"} <= set(d) for d in detail)
    assert client.get("/api/jobs").json()["jobs"] == [] and popen.calls == []


@pytest.mark.parametrize(("body", "status"), [
    (za_backtest(preset_id="nt_unknown", run_id="t_u"), 404),
    ({"kind": "anchor", "base_run_id": "nt_nowhere"}, 404),
])
def test_an_unknown_preset_or_base_is_404(lab, popen, body, status) -> None:
    root, app, client = lab
    assert post(client, body).status_code == status and popen.calls == []


def test_a_taken_run_id_is_409(lab) -> None:
    root, app, client = lab
    assert post(client, za_backtest(run_id="t_twice")).status_code == 201
    assert post(client, za_backtest(run_id="t_twice")).status_code == 409


def test_without_a_session_every_route_is_401_and_nothing_is_queued(lab, popen) -> None:
    root, app, client = lab
    bare = bare_client(app)
    try:
        assert bare.get(PRESETS).status_code == 401
        assert bare.get(f"{ACTIONS}/anchors/t_{ZA}_regress_r1").status_code == 401
        refused = bare.post(ACTIONS, content=json.dumps(za_backtest(run_id="t_nosession")),
                            headers={**HEADERS, "Origin": "http://127.0.0.1:8765"})
        assert refused.status_code == 401
    finally:
        bare.close()
    assert popen.calls == [] and app.state.jobs.list_jobs().jobs == []


@pytest.mark.parametrize(("headers", "status"), [
    ({"Content-Type": "application/json"}, 403),
    ({"X-NQT": "0", "Content-Type": "application/json"}, 403),
    ({"X-NQT": "1", "Content-Type": "text/plain"}, 415),
    ({**HEADERS, "Origin": "http://evil.example"}, 403),
    ({**HEADERS, "Sec-Fetch-Site": "cross-site"}, 403),
])
def test_the_write_checks_of_the_jobs_routes_apply(lab, popen, headers, status) -> None:
    root, app, client = lab
    assert post(client, za_backtest(run_id="t_guard"), headers=headers).status_code == status
    assert popen.calls == []


def test_a_body_over_8_kb_is_413(lab, popen) -> None:
    root, app, client = lab
    body = json.dumps(za_backtest(run_id="t_big", params={"or_minutes": 5}, pad="x" * 9000))
    assert post(client, body).status_code == 413 and popen.calls == []


def test_a_backend_with_the_runner_off_answers_503(tmp_path) -> None:
    root = make_root(tmp_path)
    app = with_actions(create_app(load_settings({})))  # no app.state.jobs: the factory hands out the disabled one
    app.state.run_service = runs_for(root)
    with api_client(app, base_url=LOCAL, client=LOOPBACK) as client:
        response = post(client, za_backtest(run_id="t_off"))
        assert response.status_code == 503 and "off" in response.json()["detail"]
        assert client.get(PRESETS).status_code == 200


def test_no_route_writes_under_results(lab, popen) -> None:
    root, app, client = lab
    before = snapshot(root / "results")
    client.get(PRESETS)
    assert post(client, za_backtest(run_id="t_quiet_api")).status_code == 201
    assert post(client, {"kind": "anchor", "base_run_id": ZA}).status_code == 201
    plant_rerun(root, f"t_{ZA}_regress_r7", ZA)
    client.get(f"{ACTIONS}/anchors/t_{ZA}_regress_r7")
    assert wait_for(lambda: popen.calls)
    assert snapshot(root / "results") == before
    assert result_doc(ZA)["config"]["run_id"] == ZA and ZA_EXP


def test_the_schema_names_the_route_family(lab) -> None:
    root, app, client = lab
    paths = app.openapi()["paths"]
    assert set(paths[ACTIONS]) == {"post"} and set(paths[PRESETS]) == {"get"}
    assert set(paths[f"{ACTIONS}/anchors/{{run_id}}"]) == {"get"}
    schemas = app.openapi()["components"]["schemas"]
    assert {"BacktestAction", "AnchorAction", "ActionResult", "PresetList", "AnchorCheck"} <= set(schemas)


@pytest.mark.parametrize("path", [ACTIONS, PRESETS, "/api/jobs/actions/anchors/x"])
@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_every_other_write_method_on_the_action_routes_is_405(lab, path, method) -> None:
    root, app, client = lab
    before = client.get("/api/jobs").json()
    response = client.request(method.upper(), path, content="{}", headers=HEADERS)
    if (method, path) == ("delete", ACTIONS):
        # `actions` is read by DELETE /api/jobs/{job_id} as a malformed job id: refused (422, or 503 with the runner off)
        assert response.status_code in (422, 503), response.status_code
    else:
        assert response.status_code == 405, (method, path, response.status_code)
    assert client.get("/api/jobs").json() == before
