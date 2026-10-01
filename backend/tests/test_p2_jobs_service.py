"""The JOBS queue (ARCHITECTURE section 8): one worker, a queue cap of 10, argv list never a shell, exit 0 ok,
1 failed checks, else error, state under a state folder. Most tests inject a fake `Popen`; the round trip test runs a
fake `run_base.py` under a path with a space. The real `run_base.py` is never executed.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from nq_terminal.models.jobs import JobSpec
from nq_terminal.services import jobs as js
from nq_terminal.services.jobs import DuplicateRunId, JobService, JobsOff, QueueFull, UnknownJob

from p2_jobs_fakes import DUMP_NAME, PYTHON, FakePopen, make_fake_root, spec_dict, wait_for

JOB_ID = re.compile(r"^j_[0-9a-f]{12}$")


def spec(run_id: str = "t_one", **overrides) -> JobSpec:
    return JobSpec.model_validate(spec_dict(run_id, **overrides))


@pytest.fixture
def root(tmp_path):
    return make_fake_root(tmp_path)


def service(root, tmp_path, popen: FakePopen | None = None, **kwargs) -> JobService:
    return JobService(root=root, state_dir=tmp_path / "state", python=PYTHON, popen=popen or FakePopen(hold=False),
                      **kwargs)


def finish(svc: JobService, job_id: str, state: str | None = None) -> js.Job:
    assert wait_for(lambda: svc.get(job_id).state in (state,) if state else svc.get(job_id).finished is not None)
    return svc.get(job_id)


def test_the_queue_cap_is_ten_waiting_jobs() -> None:
    assert js.MAX_QUEUED == 10


def test_a_job_runs_and_finishes_ok(root, tmp_path) -> None:
    svc = service(root, tmp_path)
    queued = svc.enqueue(spec())
    assert JOB_ID.match(queued.id) and queued.run_id == "t_one" and queued.state in ("queued", "running")
    done = finish(svc, queued.id)
    assert (done.state, done.exit_code) == ("ok", 0)
    assert done.started and done.finished and done.log_tail == ["ok"]
    svc.close()


@pytest.mark.parametrize(("code", "state"), [(0, "ok"), (1, "failed"), (2, "error"), (3, "error"), (-9, "error"),
                                             (255, "error")])
def test_exit_codes_map_to_states(root, tmp_path, code: int, state: str) -> None:
    svc = service(root, tmp_path, FakePopen(hold=False, codes={"t_one": code}))
    job = finish(svc, svc.enqueue(spec()).id)
    assert (job.state, job.exit_code) == (state, code)
    svc.close()


def test_the_command_is_an_argv_list_with_the_config_json_and_no_shell(root, tmp_path) -> None:
    popen = FakePopen(hold=False)
    svc = service(root, tmp_path, popen)
    new = spec("t_argv", strategy="za_orb", params={"or_minutes": 5, "target_r": 10.0})
    finish(svc, svc.enqueue(new).id)
    argv, kwargs = popen.calls[0]
    assert isinstance(argv, list) and all(isinstance(a, str) for a in argv)
    assert argv[:4] == [PYTHON, "-u", str(root / "backtests" / "run_base.py"), "--config"] and len(argv) == 5
    assert json.loads(argv[4]) == js.run_config(new)
    assert not kwargs.get("shell") and kwargs["cwd"] == root
    assert kwargs["env"]["PYTHONUTF8"] == "1" and kwargs["env"]["PYTHONIOENCODING"] == "utf-8"
    assert kwargs["stdin"] == subprocess.DEVNULL
    svc.close()


def test_one_worker_runs_one_job_at_a_time(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    first, second = svc.enqueue(spec("t_a")).id, svc.enqueue(spec("t_b")).id
    assert wait_for(lambda: svc.get(first).state == "running")
    assert svc.get(second).state == "queued" and len(popen.calls) == 1
    popen.release_all()
    assert finish(svc, second).state == "ok"
    assert [json.loads(c[0][4])["run_id"] for c in popen.calls] == ["t_a", "t_b"]
    svc.close()


def test_a_twelfth_queued_job_is_refused(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    running = svc.enqueue(spec("t_run")).id
    assert wait_for(lambda: svc.get(running).state == "running")
    for i in range(js.MAX_QUEUED):
        svc.enqueue(spec(f"t_wait{i}"))
    listing = svc.list_jobs()
    assert (listing.queued, listing.running, listing.queue_cap) == (10, 1, 10)
    with pytest.raises(QueueFull):
        svc.enqueue(spec("t_twelfth"))
    assert len(svc.list_jobs().jobs) == 11 and len(popen.calls) == 1
    popen.release_all()
    svc.close()


def test_the_cap_counts_waiting_jobs_only(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    first = svc.enqueue(spec("t_j0")).id
    assert wait_for(lambda: svc.get(first).state == "running")
    for i in range(1, js.MAX_QUEUED + 1):
        svc.enqueue(spec(f"t_j{i}"))
    popen.release_all()
    assert wait_for(lambda: svc.list_jobs().queued == 0 and svc.list_jobs().running == 0)
    svc.enqueue(spec("t_after"))  # the queue drained, so there is room again
    svc.close()


def test_a_repeated_run_id_is_refused(root, tmp_path) -> None:
    svc = service(root, tmp_path, FakePopen(hold=True))
    svc.enqueue(spec("t_same"))
    with pytest.raises(DuplicateRunId):
        svc.enqueue(spec("t_same"))
    svc.close()


def test_a_run_id_that_has_an_output_folder_is_refused(root, tmp_path) -> None:
    (root / "backtests" / "output" / "t_taken").mkdir(parents=True)
    svc = service(root, tmp_path, FakePopen(hold=True))
    with pytest.raises(DuplicateRunId):
        svc.enqueue(spec("t_taken"))
    svc.close()


def test_a_finished_job_keeps_its_run_id_reserved(root, tmp_path) -> None:
    svc = service(root, tmp_path)
    finish(svc, svc.enqueue(spec("t_done")).id)
    with pytest.raises(DuplicateRunId):
        svc.enqueue(spec("t_done"))
    svc.close()


def test_stopping_a_queued_job_never_starts_it(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    first, second = svc.enqueue(spec("t_a")).id, svc.enqueue(spec("t_b")).id
    assert wait_for(lambda: svc.get(first).state == "running")
    assert svc.remove(second).state == "stopped"
    popen.release_all()
    assert finish(svc, first).state == "ok"
    assert len(popen.calls) == 1 and svc.get(second).state == "stopped"
    svc.close()


def test_stopping_a_running_job_terminates_its_process(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    job = svc.enqueue(spec("t_a")).id
    assert wait_for(lambda: svc.get(job).state == "running")
    svc.remove(job)
    assert finish(svc, job).state == "stopped"
    assert popen.procs[0].terminated
    svc.close()


def test_removing_a_finished_job_drops_its_record_but_not_its_run_id_files(root, tmp_path) -> None:
    svc = service(root, tmp_path)
    job = finish(svc, svc.enqueue(spec("t_done")).id)
    assert svc.remove(job.id).state == "ok"
    with pytest.raises(UnknownJob):
        svc.get(job.id)
    assert not (root / "backtests" / "output").exists()  # the service never creates or deletes run output
    svc.close()


@pytest.mark.parametrize("bad", ["j_unknown00000", "../x", "", "j_" + "0" * 12 + "/", "t_one"])
def test_an_unknown_job_id_is_refused(root, tmp_path, bad: str) -> None:
    svc = service(root, tmp_path)
    for call in (svc.get, svc.remove):
        with pytest.raises(UnknownJob):
            call(bad)
    svc.close()


def test_a_process_that_cannot_start_is_an_error(root, tmp_path) -> None:
    svc = service(root, tmp_path, FakePopen(fail_with=OSError("no such file")))
    job = finish(svc, svc.enqueue(spec()).id)
    assert job.state == "error" and job.exit_code is None and "could not start" in job.message
    assert "no such file" not in job.message and str(root) not in job.message
    svc.close()


def test_the_log_tail_is_bounded_and_keeps_the_last_lines(root, tmp_path) -> None:
    lines = [f"line {i} " + "x" * 1000 for i in range(js.LOG_TAIL_LINES * 3)]
    svc = service(root, tmp_path, FakePopen(hold=False, lines=lines))
    job = finish(svc, svc.enqueue(spec()).id)
    assert len(job.log_tail) == js.LOG_TAIL_LINES
    assert job.log_tail[-1].startswith(f"line {len(lines) - 1} ")
    assert all(len(line) <= js.LOG_LINE_CHARS for line in job.log_tail)
    svc.close()


def test_the_log_tail_never_carries_a_local_path_or_the_user_name(root, tmp_path) -> None:
    out = root / "backtests" / "output" / "t_one" / "result.json"
    lines = ['RESULT_JSON: {"path": "' + str(out).replace("\\", "\\\\") + '"}',
             'Traceback (most recent call last):',
             '  File "C:\\Users\\Someone Else\\nq-lab\\backtests\\run_base.py", line 290, in main',
             '  File "/home/someone/.venv/lib/site.py", line 3, in load',
             "FileNotFoundError: " + str(root / "data" / "x.parquet"),
             "x" * (js.LOG_LINE_CHARS - 10) + " " + str(root / "tail.txt")]
    svc = service(root, tmp_path, FakePopen(hold=False, lines=lines, codes={"t_one": 2}))
    job = finish(svc, svc.enqueue(spec()).id)
    text = "\n".join(job.log_tail)
    state = (tmp_path / "state" / js.STATE_FILE).read_text(encoding="utf-8")
    for served in (text, state):
        assert str(root) not in served and str(tmp_path) not in served
        assert "Someone Else" not in served and "/home/someone" not in served and "Users" not in served
    assert "backtests" in text and "run_base.py" in text and "FileNotFoundError" in text  # the useful part stays
    assert all(len(line) <= js.LOG_LINE_CHARS for line in job.log_tail)
    svc.close()


def test_state_survives_a_restart_and_an_interrupted_job_becomes_an_error(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    first = service(root, tmp_path, popen)
    done_id = first.enqueue(spec("t_done")).id
    assert wait_for(lambda: first.get(done_id).state == "running")
    popen.release_all()
    finish(first, done_id)
    popen.held = True  # the next job stays running while the process "dies"
    running_id = first.enqueue(spec("t_running")).id
    assert wait_for(lambda: first.get(running_id).state == "running")
    saved = json.loads((tmp_path / "state" / js.STATE_FILE).read_text(encoding="utf-8"))
    assert {j["run_id"] for j in saved["jobs"]} == {"t_done", "t_running"}
    reloaded = service(root, tmp_path, FakePopen(hold=True), autostart=False)
    assert reloaded.get(done_id).state == "ok"
    interrupted = reloaded.get(running_id)
    assert interrupted.state == "error" and "stopped" in interrupted.message
    popen.release_all()
    first.close()
    reloaded.close()


def test_queued_jobs_come_back_after_a_restart(root, tmp_path) -> None:
    held = FakePopen(hold=True)
    first = service(root, tmp_path, held)
    running_id = first.enqueue(spec("t_a")).id
    queued_id = first.enqueue(spec("t_b")).id
    assert wait_for(lambda: first.get(running_id).state == "running")
    resumed = FakePopen(hold=False)
    reloaded = service(root, tmp_path, resumed)
    assert finish(reloaded, queued_id).state == "ok"
    assert [json.loads(c[0][4])["run_id"] for c in resumed.calls] == ["t_b"]
    held.release_all()
    first.close()
    reloaded.close()


def test_an_unreadable_state_file_starts_empty(root, tmp_path) -> None:
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / js.STATE_FILE).write_text("{not json", encoding="utf-8")
    svc = service(root, tmp_path)
    assert svc.list_jobs().jobs == []
    svc.close()


def test_the_history_is_capped(root, tmp_path) -> None:
    svc = service(root, tmp_path, max_history=3)
    ids = [finish(svc, svc.enqueue(spec(f"t_h{i}")).id).id for i in range(5)]
    assert [j.id for j in svc.list_jobs().jobs] == ids[:1:-1]
    svc.close()


def test_a_service_without_a_runner_refuses_new_jobs_but_lists(root, tmp_path) -> None:
    svc = JobService(root=root, state_dir=None, python=PYTHON, enabled=False)
    assert svc.list_jobs().jobs == [] and svc.list_jobs().enabled is False
    with pytest.raises(JobsOff):
        svc.enqueue(spec())


def test_a_memory_only_service_writes_no_state(root, tmp_path) -> None:
    svc = JobService(root=root, state_dir=None, python=PYTHON, popen=FakePopen(hold=False))
    finish(svc, svc.enqueue(spec()).id)
    assert not list(tmp_path.glob("**/jobs.json"))
    svc.close()


def test_listing_is_newest_first_and_counts_states(root, tmp_path) -> None:
    popen = FakePopen(hold=True)
    svc = service(root, tmp_path, popen)
    ids = [svc.enqueue(spec(f"t_o{i}")).id for i in range(3)]
    assert [j.id for j in svc.list_jobs().jobs] == ids[::-1]
    popen.release_all()
    svc.close()


def test_a_run_id_is_checked_again_at_the_door(root, tmp_path) -> None:
    svc = service(root, tmp_path)
    forged = JobSpec.model_construct(**{**spec_dict(), "run_id": "t_a/../../x", "params": {}})
    with pytest.raises(ValueError):
        svc.enqueue(forged)
    svc.close()


def test_the_real_process_round_trip_keeps_the_spaced_path_and_json_quotes(root, tmp_path) -> None:
    """A fake run_base under a path with a space, started through the real subprocess.Popen."""
    assert " " in str(root)
    svc = JobService(root=root, state_dir=tmp_path / "state", python=PYTHON)  # the real Popen
    new = spec("t_round", strategy="dtsmom", params={"ticks": 2, "book": "tsmom"})
    job = finish(svc, svc.enqueue(new).id)
    assert (job.state, job.exit_code) == ("ok", 0)
    dump = json.loads((root / DUMP_NAME).read_text(encoding="utf-8"))
    assert dump["cfg"] == js.run_config(new) and dump["cfg"]["params"] == {"ticks": 2, "book": "tsmom"}
    assert dump["argv"][0] == str(root / "backtests" / "run_base.py")
    assert dump["argv"][1] == "--config" and len(dump["argv"]) == 3
    assert '"strategy": "dtsmom"' in dump["argv"][2]  # the quotes arrive intact, not shell-stripped
    assert (dump["utf8"], dump["encoding"]) == ("1", "utf-8") and Path(dump["cwd"]).resolve() == root.resolve()
    assert any("café" in line for line in job.log_tail)  # UTF-8 output is decoded correctly
    svc.close()


@pytest.mark.parametrize(("run_id", "state", "code"), [("t_exit0", "ok", 0), ("t_exit1", "failed", 1),
                                                      ("t_exit2", "error", 2)])
def test_the_real_process_exit_codes(root, tmp_path, run_id: str, state: str, code: int) -> None:
    svc = JobService(root=root, state_dir=None, python=PYTHON)
    job = finish(svc, svc.enqueue(spec(run_id)).id)
    assert (job.state, job.exit_code) == (state, code)
    svc.close()


def test_the_state_file_is_valid_json_with_no_absolute_path(root, tmp_path) -> None:
    svc = service(root, tmp_path)
    finish(svc, svc.enqueue(spec()).id)
    text = (tmp_path / "state" / js.STATE_FILE).read_text(encoding="utf-8")
    assert json.loads(text)["jobs"][0]["state"] == "ok" and str(root) not in text
    svc.close()
