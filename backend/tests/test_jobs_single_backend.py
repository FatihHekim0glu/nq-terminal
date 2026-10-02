"""D2.4 (03 section 8; 02 C1-3): one backend per lab means one worker per lab, so a queued job runs once.

Two starts on one state folder give one backend: the second prints `NQT-ATTACH` for the first and exits 0 without
serving, so only one process ever reads `jobs.json` and starts its queued jobs. The tests start the real start path
(`nq_terminal.__main__.serve`, hidden, port 0, a state folder under D:/dev/tmp, under the window watch) through a
small driver whose job factory builds a JobService on a stand-in project root: each run of the stand-in
`run_base.py` appends one line to `runs.log`, so a job that ran twice shows as two lines. The real `run_base.py` is
never started and nothing touches 127.0.0.1:8765. The spaced-path argv test of the service
(`test_p2_jobs_service.py`) stays where it is and is run with this file.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from nq_terminal.desktop import lock

from conftest import desktop_env, fresh_lock_dir, open_session, remove_lock_dir, spawn_backend, wait_until
from p2_jobs_fakes import SPACED_HOME, spec_dict

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows start path")

TOKEN_A, TOKEN_B = "a1" * 32, "b2" * 32
NONCE_A, NONCE_B = "c3" * 32, "d4" * 32
RUN_ID = "t_once"
RUNS_LOG = "runs.log"
COUNTING_RUN_BASE = r'''
import json, sys, time
from pathlib import Path

cfg = json.loads(sys.argv[sys.argv.index("--config") + 1])
with Path("runs.log").open("a", encoding="utf-8") as log:
    log.write(cfg["run_id"] + "\n")
time.sleep(1.0)
print("counted " + cfg["run_id"], flush=True)
sys.exit(0)
'''
DRIVER = r'''
import sys
from pathlib import Path

import nq_terminal.api.jobs as jobs_api
import nq_terminal.__main__ as entry
from nq_terminal.app import create_app
from nq_terminal.services.jobs import JobService
from nq_terminal.settings import load_settings

# The stdin reader is __main__'s own (the polling reader): the first scipy import, which queueing a job does, must not
# freeze on it, and this driver does not stand in for that wiring.
ROOT = Path(sys.argv[1])
# the real factory would refuse a stand-in root (identity); this is the stand-in for the JobService it builds
jobs_api.service_for = lambda settings, **_: JobService(root=ROOT, state_dir=settings.state_dir, python=sys.executable)
sys.exit(entry.serve(load_settings(), lambda settings: create_app(settings)))
'''


def counting_root(base: Path) -> Path:
    root = base.joinpath(*SPACED_HOME)
    (root / "backtests").mkdir(parents=True)
    (root / "backtests" / "run_base.py").write_text(COUNTING_RUN_BASE, encoding="utf-8")
    return root


def queue_one_job(state: Path) -> None:
    """A jobs file holding one queued job, as a backend that stopped before running it would have left it."""
    queued = {"id": "j_" + "1" * 12, "run_id": RUN_ID, "state": "queued", "spec": spec_dict(RUN_ID),
              "created": "2026-10-02T00:00:00+00:00", "started": None, "finished": None, "exit_code": None,
              "message": "waiting in the queue", "log_tail": []}
    (state / "jobs.json").write_text(json.dumps({"version": 1, "jobs": [queued]}), encoding="utf-8")


def launcher_start(root: Path, state: Path, token: str, nonce: str):
    env = desktop_env(state) | {"NQT_JOBS": "on"}
    return spawn_backend(["-c", DRIVER, str(root)], env, token=token, nonce=nonce)


def get_json(port: int, path: str, cookie: str) -> dict:
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                     headers={"Cookie": cookie, "Origin": f"http://127.0.0.1:{port}"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as refused:
        pytest.fail(f"GET {path} answered {refused.code}")


def runs_logged(root: Path) -> list[str]:
    try:
        return (root / RUNS_LOG).read_text(encoding="utf-8").split()
    except OSError:
        return []


def run_the_queued_job_through(port: int, token: str, root: Path) -> dict:
    """First touch of /api/jobs builds the service, which runs the queued job; wait for it and return its record."""
    cookie = open_session(port, token)
    assert cookie is not None, "the session route is missing"
    listing = get_json(port, "/api/jobs", cookie)
    assert [job["run_id"] for job in listing["jobs"]] == [RUN_ID]
    job_id = listing["jobs"][0]["id"]
    assert wait_until(lambda: get_json(port, f"/api/jobs/{job_id}", cookie)["state"] in ("ok", "failed", "error"), 60)
    return get_json(port, f"/api/jobs/{job_id}", cookie)


@pytest.fixture
def lab(tmp_path):
    state = fresh_lock_dir("single-backend")
    queue_one_job(state)
    root = counting_root(tmp_path)
    started = []
    try:
        yield root, state, started
    finally:
        for backend in started:
            backend.stop()
        remove_lock_dir(state)


def test_the_second_start_on_one_state_folder_attaches_and_the_queued_job_runs_once(lab, window_watch):
    root, state, started = lab
    first = launcher_start(root, state, TOKEN_A, NONCE_A)
    started.append(first)
    kind, ready = first.first_nqt_line()
    assert kind == "NQT-READY", first.stderr_text()
    second = launcher_start(root, state, TOKEN_B, NONCE_B)
    started.append(second)
    kind, attach = second.first_nqt_line()
    assert kind == "NQT-ATTACH" and attach == {"port": ready["port"]}, second.stderr_text()
    assert second.wait_exit() == 0  # it never served
    assert lock.read_info(state).pid == ready["pid"]
    job = run_the_queued_job_through(ready["port"], TOKEN_A, root)
    assert job["state"] == "ok", job["log_tail"]
    time.sleep(2.0)  # a second worker would have started the job again by now
    assert runs_logged(root) == [RUN_ID]


def test_two_starts_at_once_give_one_backend_and_the_queued_job_runs_once(lab, window_watch):
    root, state, started = lab
    a = launcher_start(root, state, TOKEN_A, NONCE_A)
    b = launcher_start(root, state, TOKEN_B, NONCE_B)
    started.extend([a, b])
    lines = {name: backend.first_nqt_line() for name, backend in (("a", a), ("b", b))}
    kinds = sorted(kind for kind, _ in lines.values())
    assert kinds == ["NQT-ATTACH", "NQT-READY"], {n: line for n, line in lines.items()}
    winner = "a" if lines["a"][0] == "NQT-READY" else "b"
    loser = "b" if winner == "a" else "a"
    token = TOKEN_A if winner == "a" else TOKEN_B
    port = lines[winner][1]["port"]
    assert lines[loser][1] == {"port": port}
    assert (a if loser == "a" else b).wait_exit() == 0
    job = run_the_queued_job_through(port, token, root)
    assert job["state"] == "ok", job["log_tail"]
    time.sleep(2.0)
    assert runs_logged(root) == [RUN_ID]
    assert wait_until(lambda: lock.read_info(state) is not None and lock.read_info(state).port == port, 5)


def test_a_jobs_file_is_read_by_the_backend_that_holds_the_lock_only(lab, window_watch):
    """The attaching start leaves jobs.json exactly as the first backend wrote it (it never opened it)."""
    root, state, started = lab
    first = launcher_start(root, state, TOKEN_A, NONCE_A)
    started.append(first)
    kind, ready = first.first_nqt_line()
    assert kind == "NQT-READY", first.stderr_text()
    run_the_queued_job_through(ready["port"], TOKEN_A, root)
    written = (state / "jobs.json").read_bytes()
    second = launcher_start(root, state, TOKEN_B, NONCE_B)
    started.append(second)
    assert second.first_nqt_line()[0] == "NQT-ATTACH" and second.wait_exit() == 0
    assert (state / "jobs.json").read_bytes() == written
    assert runs_logged(root) == [RUN_ID]
