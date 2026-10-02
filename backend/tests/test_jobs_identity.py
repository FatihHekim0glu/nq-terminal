"""D2.4 (03 sections 8 and 9; 05 G06; 02 C3-3): JOBS identity, and what a test or smoke backend can never do.

The REAL JobService factory (`services.jobs.service_for`) hands out a running service only when:

- this backend is the lab's own: `sys.prefix` resolves to `<ROOT>/.venv`, with ROOT from `nq_lab.config` (not the
  service's own `root` argument and not `Settings.root`, which a test can set to anything);
- it is not a fixture backend (`NQT_FIXTURE_DIR` unset, in desktop mode and in every other mode);
- the owner has not switched it off (`NQT_JOBS=off`, the test and smoke backends of 03 section 2.6).

Otherwise it hands out the disabled in-memory service: nothing is read from or written to a jobs file, `POST` and
`DELETE /api/jobs` answer 503 and the IB snapshot is refused. Services built past the factory (fixture_app's fake
JobService, `p2_jobs_fakes`) are unaffected. The real `run_base.py` is never started here.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from dataclasses import replace
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.desktop import lifecycle
from nq_terminal.models.jobs import JobSpec
from nq_terminal.services import jobs as jobs_service
from nq_terminal.services.jobs import JobService, JobsOff, service_for
from nq_terminal.settings import load_settings

from conftest import desktop_env, fresh_lock_dir, open_session, remove_lock_dir, spawn_backend
from fakes import FIXTURES
from fixture_app import create_fixture_app
from ib_fake_server import FakeIbServer
from p2_jobs_fakes import spec_dict, wait_for

HEADERS = {"X-NQT": "1", "Content-Type": "application/json"}
OFF_TEXT = "jobs are off in this backend"
TOKEN_A, TOKEN_B = "8d" * 32, "9e" * 32
NONCE_A, NONCE_B = "6f" * 32, "7a" * 32


def real_settings(**changes):
    return replace(load_settings({}), **changes)


# ---------------------------------------------------------------- the factory

def test_the_real_factory_runs_jobs_in_the_labs_own_environment(lab_state):
    assert Path(sys.prefix).resolve() == (ROOT / ".venv").resolve()  # the suite itself runs there
    service = service_for(real_settings(state_dir=lab_state))
    assert service.enabled is True and service.off_reason is None
    service.close()


def test_a_wrong_sys_prefix_refuses_jobs(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "prefix", str(tmp_path / "other-env"))
    service = service_for(real_settings())
    assert service.enabled is False and service.list_jobs().enabled is False
    assert OFF_TEXT in (service.off_reason or "")
    with pytest.raises(JobsOff) as refused:
        service.enqueue(JobSpec.model_validate(spec_dict()))
    assert OFF_TEXT in str(refused.value)


@pytest.mark.parametrize("prefix", [ROOT / ".venv2", ROOT / ".venv" / "Scripts", ROOT, ROOT.parent],
                         ids=["sibling", "inside", "the-root-itself", "the-parent"])
def test_a_prefix_that_only_looks_like_the_labs_venv_is_refused(monkeypatch, prefix):
    monkeypatch.setattr(sys, "prefix", str(prefix))
    assert service_for(real_settings()).enabled is False


def test_the_prefix_is_compared_as_the_filesystem_does(monkeypatch, lab_state):
    spelled = str(ROOT / ".venv").lower() + "\\"
    monkeypatch.setattr(sys, "prefix", spelled)
    service = service_for(real_settings(state_dir=lab_state))
    assert service.enabled is True
    service.close()


def test_the_root_comes_from_nq_lab_config_not_from_the_settings(monkeypatch, tmp_path):
    lab = tmp_path / "other lab"
    (lab / ".venv").mkdir(parents=True)
    monkeypatch.setattr(sys, "prefix", str(lab / ".venv"))
    service = service_for(real_settings(root=lab))  # a settings root that matches the prefix changes nothing
    assert service.enabled is False


def test_the_services_own_root_argument_does_not_make_a_foreign_prefix_pass(monkeypatch, tmp_path, lab_state):
    monkeypatch.setattr(sys, "prefix", str(tmp_path / ".venv"))
    assert jobs_service.jobs_refusal(real_settings(root=tmp_path), prefix=sys.prefix) is not None
    assert jobs_service.jobs_refusal(real_settings(state_dir=lab_state), prefix=str(ROOT / ".venv")) is None


@pytest.mark.parametrize("desktop", [True, False], ids=["desktop", "browser"])
def test_a_fixture_folder_refuses_jobs_in_every_mode(desktop):
    settings = real_settings(fixture_dir=FIXTURES, desktop=desktop)
    service = service_for(settings)
    assert service.enabled is False and "fixture" in (service.off_reason or "")
    assert service.list_jobs().jobs == [] and service.list_jobs().enabled is False


def test_nqt_jobs_off_gives_the_disabled_in_memory_service(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    (state / "jobs.json").write_text('{"version": 1, "jobs": []}', encoding="utf-8")
    before = (state / "jobs.json").read_bytes()
    service = service_for(load_settings({"NQT_JOBS": "off", "NQT_STATE_DIR": str(state)}))
    assert service.enabled is False and OFF_TEXT in (service.off_reason or "")
    with pytest.raises(JobsOff):
        service.enqueue(JobSpec.model_validate(spec_dict()))
    assert sorted(p.name for p in state.iterdir()) == ["jobs.json"] and (state / "jobs.json").read_bytes() == before


def test_a_disabled_service_never_adopts_a_queued_job_from_the_jobs_file(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    queued = {"id": "j_" + "0" * 12, "run_id": "t_queued", "state": "queued", "spec": spec_dict("t_queued"),
              "created": "2026-10-02T00:00:00+00:00", "started": None, "finished": None, "exit_code": None,
              "message": "waiting in the queue", "log_tail": []}
    (state / "jobs.json").write_text(json.dumps({"version": 1, "jobs": [queued]}), encoding="utf-8")
    service = service_for(load_settings({"NQT_JOBS": "off", "NQT_STATE_DIR": str(state)}))
    assert service.list_jobs().jobs == [] and service.list_jobs().running == 0


# ---------------------------------------------------------------- services built past the factory

def test_the_fixture_apps_fake_job_service_still_runs_a_job_through_the_real_popen(authed_client, tmp_path,
                                                                                 window_watch):
    env = {"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_FIXTURE_JOBS": "fake", "NQT_STATE_DIR": str(tmp_path)}
    app = create_fixture_app(env, log_dir=tmp_path / "log")
    assert isinstance(app.state.jobs, JobService) and app.state.jobs.enabled is True
    client = authed_client(app)
    posted = client.post("/api/jobs", content=json.dumps(spec_dict("t_fixture_fake")), headers=HEADERS)
    assert posted.status_code == 201, posted.text
    job_id = posted.json()["id"]
    assert wait_for(lambda: client.get(f"/api/jobs/{job_id}").json()["state"] in ("ok", "failed", "error"), 60)
    finished = client.get(f"/api/jobs/{job_id}").json()
    assert finished["state"] == "ok", finished["log_tail"]
    assert any("fake runner: t_fixture_fake" in line for line in finished["log_tail"])
    app.state.jobs.close()


# ---------------------------------------------------------------- the API under NQT_JOBS=off (in process)

def jobs_off_app(tmp_path):
    settings = load_settings({"NQT_JOBS": "off", "NQT_STATE_DIR": str(tmp_path)})
    assert settings.jobs_enabled is False and not settings.fixture_mode
    return create_app(settings)


def test_post_and_delete_answer_that_jobs_are_off_in_this_backend(authed_client, tmp_path):
    client = authed_client(jobs_off_app(tmp_path))
    posted = client.post("/api/jobs", content=json.dumps(spec_dict("t_off")), headers=HEADERS)
    assert posted.status_code == 503 and OFF_TEXT in posted.json()["detail"]
    deleted = client.delete("/api/jobs/j_000000000000", headers=HEADERS)
    assert deleted.status_code == 503 and OFF_TEXT in deleted.json()["detail"]
    listing = client.get("/api/jobs").json()
    assert listing["enabled"] is False and listing["jobs"] == [] and listing["queued"] == 0


def test_the_off_answer_comes_after_the_write_guard_and_before_the_body(authed_client, tmp_path):
    client = authed_client(jobs_off_app(tmp_path))
    assert client.post("/api/jobs", content="{}", headers={"Content-Type": "application/json"}).status_code == 403
    assert client.post("/api/jobs", content="{}", headers={"X-NQT": "1", "Content-Type": "text/plain"}
                       ).status_code == 415
    assert client.post("/api/jobs", content="not json", headers=HEADERS).status_code == 503
    assert client.delete("/api/jobs/j_000000000000", headers={"X-NQT": "1"}).status_code == 415


def test_a_default_in_process_app_has_jobs_off_whatever_the_shell_says(authed_client):
    """The suite's standing rule (03 section 2.6): a test backend runs with NQT_JOBS=off, set by the autouse fixtures.

    `load_settings()` reads the process environment, so an app built the way `__main__` builds it must refuse jobs.
    The body is not JSON, so a backend that wrongly had jobs on would answer 4xx and never start a run."""
    settings = load_settings()
    assert settings.jobs_enabled is False and not settings.fixture_mode
    client = authed_client(create_app(settings))
    posted = client.post("/api/jobs", content="not json", headers=HEADERS)
    assert posted.status_code == 503 and OFF_TEXT in posted.json()["detail"]
    assert client.get("/api/jobs").json()["enabled"] is False


def test_the_shell_cannot_switch_jobs_on_for_the_suite(monkeypatch):
    monkeypatch.setenv("NQT_JOBS", "on")  # a test that wants it says so itself, after the autouse fixtures ran
    assert load_settings().jobs_enabled is True


def test_a_wrong_prefix_answers_the_same_503(authed_client, monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "prefix", str(tmp_path / "other-env"))
    app = create_app(load_settings({"NQT_STATE_DIR": str(tmp_path)}))
    posted = authed_client(app).post("/api/jobs", content=json.dumps(spec_dict("t_prefix")), headers=HEADERS)
    assert posted.status_code == 503 and OFF_TEXT in posted.json()["detail"]


def test_fixture_mode_keeps_its_own_503_wording(authed_client):
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    posted = authed_client(app).post("/api/jobs", content=json.dumps(spec_dict("t_fx")), headers=HEADERS)
    assert posted.status_code == 503 and "fixture" in posted.json()["detail"]


def test_the_ib_snapshot_is_refused_under_nqt_jobs_off_and_no_socket_is_opened(authed_client, monkeypatch, tmp_path):
    with FakeIbServer() as server:
        monkeypatch.setenv("NQT_IB_READONLY", "1")
        monkeypatch.setenv("IB_HOST", "127.0.0.1")
        monkeypatch.setenv("IB_PORT", str(server.port))
        body = authed_client(jobs_off_app(tmp_path)).get("/api/ib/snapshot").json()
        assert server.connections == 0
    assert body["state"] == "refused" and OFF_TEXT in body["message"]


def test_the_same_ib_environment_reads_the_fake_server_when_jobs_are_on(authed_client, monkeypatch, lab_state):
    """The positive control of the refusal above: without NQT_JOBS=off the snapshot reaches the fake server."""
    with FakeIbServer() as server:
        monkeypatch.setenv("NQT_IB_READONLY", "1")
        monkeypatch.setenv("IB_HOST", "127.0.0.1")
        monkeypatch.setenv("IB_PORT", str(server.port))
        app = create_app(load_settings({"NQT_STATE_DIR": str(lab_state)}))
        body = authed_client(app).get("/api/ib/snapshot").json()
        assert server.connections >= 1
    assert body["state"] == "ok"


# ---------------------------------------------------------------- the lock of the lab's own state folder (03 section 8)

@pytest.fixture
def lab_state(monkeypatch, tmp_path):
    """Makes `tmp_path / "lab-state"` stand for `<ROOT>/terminal/state` (a test never uses the real folder)."""
    folder = tmp_path / "lab-state"
    folder.mkdir()
    monkeypatch.setattr(jobs_service, "LAB_STATE_DIR", folder)
    return folder


def test_a_backend_with_another_state_folder_refuses_jobs_with_jobs_on(lab_state, tmp_path):
    other = tmp_path / "my own folder"
    other.mkdir()
    refused = service_for(real_settings(state_dir=other))
    assert refused.enabled is False and refused.off_reason == jobs_service.OFF_NOT_LOCK_HOLDER
    assert OFF_TEXT in refused.off_reason and not (other / "jobs.json").exists()
    allowed = service_for(real_settings(state_dir=lab_state))
    assert allowed.enabled is True and allowed.off_reason is None
    allowed.close()


def test_the_state_folder_is_compared_as_the_filesystem_does(lab_state):
    spelled = Path(str(lab_state).upper()) / ".." / lab_state.name
    allowed = service_for(real_settings(state_dir=spelled))
    assert allowed.enabled is True
    allowed.close()


def test_a_lock_that_is_not_held_refuses_jobs(lab_state):
    assert jobs_service.jobs_refusal(real_settings(state_dir=lab_state), lock_held=False) == (
        jobs_service.OFF_NOT_LOCK_HOLDER)
    assert jobs_service.jobs_refusal(real_settings(state_dir=lab_state), lock_held=True) is None


def test_the_api_of_a_backend_with_another_state_folder_answers_503(authed_client, lab_state, tmp_path):
    other = tmp_path / "another"
    other.mkdir()
    app = create_app(load_settings({"NQT_STATE_DIR": str(other)}))
    assert app.state.settings.jobs_enabled is True
    posted = authed_client(app).post("/api/jobs", content=json.dumps(spec_dict("t_other")), headers=HEADERS)
    assert posted.status_code == 503 and OFF_TEXT in posted.json()["detail"]
    assert not (other / "jobs.json").exists()


def test_the_ib_snapshot_of_a_backend_with_another_state_folder_is_refused_and_no_socket_is_opened(
        authed_client, lab_state, monkeypatch, tmp_path):
    other = tmp_path / "another"
    other.mkdir()
    with FakeIbServer() as server:
        monkeypatch.setenv("NQT_IB_READONLY", "1")
        monkeypatch.setenv("IB_HOST", "127.0.0.1")
        monkeypatch.setenv("IB_PORT", str(server.port))
        app = create_app(load_settings({"NQT_STATE_DIR": str(other)}))
        assert app.state.settings.jobs_enabled is True
        body = authed_client(app).get("/api/ib/snapshot").json()
        assert server.connections == 0
    assert body["state"] == "refused" and "lock" in body["message"]


def test_a_released_lock_refuses_the_ib_snapshot_and_jobs(authed_client, lab_state, monkeypatch):
    """The lifespan ran and the lock is gone (shutdown, or taken back): nothing may start."""
    with FakeIbServer() as server:
        monkeypatch.setenv("NQT_IB_READONLY", "1")
        monkeypatch.setenv("IB_HOST", "127.0.0.1")
        monkeypatch.setenv("IB_PORT", str(server.port))
        app = create_app(load_settings({"NQT_STATE_DIR": str(lab_state)}))
        setattr(app.state, lifecycle.STARTED_KEY, True)  # the lifespan started; LOCK_KEY was never set (or cleared)
        client = authed_client(app)
        assert client.get("/api/ib/snapshot").json()["state"] == "refused" and server.connections == 0
        posted = client.post("/api/jobs", content=json.dumps(spec_dict("t_gone")), headers=HEADERS)
        assert posted.status_code == 503 and OFF_TEXT in posted.json()["detail"]


# ---------------------------------------------------------------- two real backends, one lock held

def call(port: int, method: str, path: str, cookie: str, body: dict | None = None) -> tuple[int, dict]:
    headers = {"Cookie": cookie, "Origin": f"http://127.0.0.1:{port}", "X-NQT": "1",
               "Content-Type": "application/json"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as refused:
        return refused.code, json.loads(refused.read())


def test_a_backend_with_its_own_state_folder_and_jobs_off_starts_beside_a_held_lock(window_watch):
    folder_a, folder_b = fresh_lock_dir("identity-a"), fresh_lock_dir("identity-b")
    ib = FakeIbServer()
    ib.start()
    env_b = desktop_env(folder_b) | {"NQT_IB_READONLY": "1", "IB_HOST": "127.0.0.1", "IB_PORT": str(ib.port)}
    holder = spawn_backend(["-m", "nq_terminal"], desktop_env(folder_a), token=TOKEN_A, nonce=NONCE_A)
    beside = None
    try:
        kind, ready_a = holder.first_nqt_line()
        assert kind == "NQT-READY", holder.stderr_text()
        beside = spawn_backend(["-m", "nq_terminal"], env_b, token=TOKEN_B, nonce=NONCE_B)
        kind, ready_b = beside.first_nqt_line()
        assert kind == "NQT-READY", beside.stderr_text()  # not an attach: its own state folder, its own lock
        assert ready_a["port"] != ready_b["port"] and ready_b["port"] != 8765
        cookie = open_session(ready_b["port"], TOKEN_B)
        if cookie is None:
            pytest.fail("the session route is missing")
        status, posted = call(ready_b["port"], "POST", "/api/jobs", cookie, spec_dict("t_beside"))
        assert status == 503 and OFF_TEXT in posted["detail"]
        status, deleted = call(ready_b["port"], "DELETE", "/api/jobs/j_000000000000", cookie)
        assert status == 503 and OFF_TEXT in deleted["detail"]
        status, snapshot = call(ready_b["port"], "GET", "/api/ib/snapshot", cookie)
        assert status == 200 and snapshot["state"] == "refused" and ib.connections == 0
        assert not (folder_a / "jobs.json").exists() and not (folder_b / "jobs.json").exists()
    finally:
        for backend in (beside, holder):
            if backend is not None:
                backend.stop()
        ib.stop()
        remove_lock_dir(folder_a)
        remove_lock_dir(folder_b)
