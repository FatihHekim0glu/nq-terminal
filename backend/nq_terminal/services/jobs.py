"""The JOBS backtest queue (ARCHITECTURE section 8, PRD U3): one worker thread, a queue of at most 10 waiting jobs.

Each job runs `[python, "-u", <root>/backtests/run_base.py, "--config", <json>]` through `subprocess.Popen` with an
argument list, never a shell, `cwd` the project root and `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` in the
environment. Exit 0 is `ok`, exit 1 `failed` (a failed balance or coverage check), any other exit `error`.

What this module writes, and where:
- `<state_dir>/jobs.json` (default `terminal/state/`, git-ignored): the job records, replaced atomically on every
  state change. A service without a state folder keeps everything in memory.
- Nothing else. The run itself writes `backtests/output/<run_id>/result.json` and its gate log lines inside the
  child process, exactly as a hand-started in-sample run does; the terminal never writes the ledger, `results/`,
  `data/` or `live/`, and only reads (`exists`) the output folder to refuse a run id that is already used.
Prices stay behind `nq_lab.data.serve`: the child's reads are logged by the gate under the runner's own caller.

A restart marks the job that was running as an error (its process died with the terminal) and runs the queued
ones again. No error text from the operating system and no path is put in a job: the log tail is the child's own
output with local paths redacted (the project root dropped, any other home folder shown as `~`), cut to 100
lines of 400 characters.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from nq_terminal.models.jobs import (
    FINISHED_STATES,
    JOB_ID,
    RUN_ID,
    Job,
    JobList,
    JobSpec,
    config_json,
    run_config,
)
from nq_terminal.services.files import redact_local_paths
from nq_terminal.settings import TERMINAL_DIR, Settings

__all__ = ["DuplicateRunId", "Job", "JobError", "JobList", "JobService", "JobsOff", "QueueFull", "UnknownJob",
           "run_config", "service_for"]

LOG = logging.getLogger(__name__)
MAX_QUEUED = 10
MAX_HISTORY = 200
LOG_TAIL_LINES = 100
LOG_LINE_CHARS = 400
KILL_AFTER_SECONDS = 10.0
JOIN_SECONDS = 15.0
STATE_FILE = "jobs.json"
STATE_VERSION = 1
EXIT_OK, EXIT_FAILED_CHECKS = 0, 1
MESSAGES = {
    "queued": "waiting in the queue",
    "running": "running",
    "ok": "finished; the balance and coverage checks passed",
    "failed": "finished; a balance or coverage check failed, so the run is not usable",
    "error": "the run ended with an error",
    "stopped": "stopped on request",
}
START_FAILED = "could not start the run"
INTERRUPTED = "the terminal stopped while this job ran"
OUTPUT_DIR = ("backtests", "output")


class JobError(Exception):
    """Base of the refusals the router maps to a status code."""


class QueueFull(JobError):
    pass


class DuplicateRunId(JobError):
    pass


class UnknownJob(JobError):
    pass


class JobsOff(JobError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _child_env() -> dict[str, str]:
    return {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}


@dataclass
class _Record:
    """The one mutable thing here: a job while the queue owns it. `Job` (frozen) is what leaves the service."""

    id: str
    spec: JobSpec
    created: str
    state: str = "queued"
    started: str | None = None
    finished: str | None = None
    exit_code: int | None = None
    message: str = MESSAGES["queued"]
    tail: deque = field(default_factory=lambda: deque(maxlen=LOG_TAIL_LINES))
    stop_requested: bool = False

    def view(self) -> Job:
        return Job(id=self.id, run_id=self.spec.run_id, state=self.state, spec=self.spec, created=self.created,
                   started=self.started, finished=self.finished, exit_code=self.exit_code, message=self.message,
                   log_tail=list(self.tail))


class JobService:
    def __init__(self, *, root: Path, state_dir: Path | None, python: str,
                 popen: Callable[..., Any] = subprocess.Popen, queue_cap: int = MAX_QUEUED,
                 max_history: int = MAX_HISTORY, enabled: bool = True, autostart: bool = True) -> None:
        self._root = Path(root)
        self._script = self._root / "backtests" / "run_base.py"
        self._state_dir = None if state_dir is None else Path(state_dir)
        self._python = python
        self._popen = popen
        self._queue_cap = queue_cap
        self._max_history = max_history
        self._enabled = enabled
        self._records: dict[str, _Record] = {}
        self._queue: deque[str] = deque()
        self._proc: Any = None
        self._running_id: str | None = None
        self._closed = False
        self._cond = threading.Condition(threading.RLock())
        self._worker: threading.Thread | None = None
        self._load()
        if autostart and self._queue and self._enabled:
            self._ensure_worker()

    # ----- public -----
    def enqueue(self, spec: JobSpec) -> Job:
        if not self._enabled:
            raise JobsOff("the job runner is off")
        checked = JobSpec.model_validate(spec.model_dump(mode="json"))  # the door re-checks what the router checked
        with self._cond:
            if any(r.spec.run_id == checked.run_id for r in self._records.values()) or self._output_exists(checked):
                raise DuplicateRunId(f"run id {checked.run_id} is already used")
            if len(self._queue) >= self._queue_cap:
                raise QueueFull(f"the queue is full ({self._queue_cap} waiting jobs)")
            record = _Record(id="j_" + uuid.uuid4().hex[:12], spec=checked, created=_now())
            self._records[record.id] = record
            self._queue.append(record.id)
            self._trim_history()
            self._persist()
            self._ensure_worker()
            self._cond.notify_all()
            return record.view()

    def list_jobs(self) -> JobList:
        with self._cond:
            views = [r.view() for r in reversed(self._records.values())]
            return JobList(jobs=views, queued=len(self._queue), running=int(self._running_id is not None),
                           queue_cap=self._queue_cap, enabled=self._enabled)

    def get(self, job_id: str) -> Job:
        with self._cond:
            return self._record(job_id).view()

    def remove(self, job_id: str) -> Job:
        """Stop a queued or running job; drop the record of a finished one. Run output is never touched."""
        with self._cond:
            record = self._record(job_id)
            if record.state == "queued":
                self._queue.remove(record.id)
                self._finish(record, "stopped", None, MESSAGES["stopped"])
            elif record.state == "running":
                record.stop_requested = True
                self._terminate(self._proc)
            else:
                del self._records[record.id]
                self._persist()
            return record.view()

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._terminate(self._proc)
            self._cond.notify_all()
        worker = self._worker
        if worker is not None and worker is not threading.current_thread():
            worker.join(JOIN_SECONDS)

    # ----- internals -----
    def _record(self, job_id: str) -> _Record:
        record = self._records.get(job_id) if isinstance(job_id, str) and JOB_ID.fullmatch(job_id) else None
        if record is None:
            raise UnknownJob("unknown job")
        return record

    def _output_exists(self, spec: JobSpec) -> bool:
        return self._root.joinpath(*OUTPUT_DIR, spec.run_id).exists()

    def _trim_history(self) -> None:
        finished = [r.id for r in self._records.values() if r.state in FINISHED_STATES]
        for job_id in finished[: max(0, len(finished) - self._max_history)]:
            del self._records[job_id]

    def _terminate(self, proc: Any) -> None:
        if proc is None:
            return
        proc.terminate()
        timer = threading.Timer(KILL_AFTER_SECONDS, self._kill_if_alive, args=(proc,))
        timer.daemon = True
        timer.start()

    @staticmethod
    def _kill_if_alive(proc: Any) -> None:
        if proc.poll() is None:
            proc.kill()

    def _ensure_worker(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._work, name="nqt-jobs", daemon=True)
            self._worker.start()

    def _work(self) -> None:
        while True:
            with self._cond:
                while not self._queue and not self._closed:
                    self._cond.wait()
                if self._closed:
                    return
                record = self._records[self._queue.popleft()]
                record.state, record.started, record.message = "running", _now(), MESSAGES["running"]
                self._running_id = record.id
                self._persist()
            self._execute(record)

    def _execute(self, record: _Record) -> None:
        argv = [self._python, "-u", str(self._script), "--config", config_json(record.spec)]
        try:
            proc = self._popen(argv, cwd=self._root, env=_child_env(), stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                               errors="replace", bufsize=1)
        except (OSError, ValueError) as exc:
            LOG.warning("job %s could not start: %s", record.id, exc)
            with self._cond:
                self._finish(record, "error", None, START_FAILED)
            return
        with self._cond:
            self._proc = proc
            if record.stop_requested or self._closed:
                self._terminate(proc)
        code = self._pump(record, proc)
        with self._cond:
            self._proc = None
            self._finish(record, *self._outcome(record, code))

    def _log_line(self, line: str) -> str:
        """One line of the child's output with local paths redacted (the project root dropped, any other home folder
        shown as `~`) before it is cut to length, so a traceback or a RESULT_JSON line never names the user."""
        return redact_local_paths(line.rstrip("\r\n"), self._root)[:LOG_LINE_CHARS]

    def _pump(self, record: _Record, proc: Any) -> int | None:
        try:
            for line in proc.stdout:
                with self._cond:
                    record.tail.append(self._log_line(line))
            return proc.wait()
        except (OSError, ValueError) as exc:
            LOG.warning("job %s lost its process: %s", record.id, exc)
            self._terminate(proc)
            return None

    def _outcome(self, record: _Record, code: int | None) -> tuple[str, int | None, str]:
        if record.stop_requested and code != EXIT_OK:
            return "stopped", code, MESSAGES["stopped"]
        if self._closed and code != EXIT_OK:
            return "error", code, INTERRUPTED
        if code == EXIT_OK:
            return "ok", code, MESSAGES["ok"]
        if code == EXIT_FAILED_CHECKS:
            return "failed", code, MESSAGES["failed"]
        suffix = "" if code is None else f" (exit code {code})"
        return "error", code, MESSAGES["error"] + suffix

    def _finish(self, record: _Record, state: str, code: int | None, message: str) -> None:
        record.state, record.exit_code, record.message, record.finished = state, code, message, _now()
        if self._running_id == record.id:
            self._running_id = None
        self._trim_history()
        self._persist()

    # ----- state file -----
    def _load(self) -> None:
        path = None if self._state_dir is None else self._state_dir / STATE_FILE
        if path is None or not path.is_file():
            return
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))["jobs"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            LOG.warning("the jobs state file is unreadable and is ignored: %s", exc)
            return
        for entry in stored:
            try:
                job = Job.model_validate(entry)
            except ValueError as exc:
                LOG.warning("a stored job is invalid and is skipped: %s", exc)
                continue
            self._adopt(job)

    def _adopt(self, job: Job) -> None:
        record = _Record(id=job.id, spec=job.spec, created=job.created, state=job.state, started=job.started,
                         finished=job.finished, exit_code=job.exit_code, message=job.message)
        record.tail.extend(job.log_tail)
        if job.state == "running":
            record.state, record.finished, record.message = "error", _now(), INTERRUPTED
        self._records[record.id] = record
        if record.state == "queued":
            self._queue.append(record.id)

    def _persist(self) -> None:
        if self._state_dir is None:
            return
        document = {"version": STATE_VERSION, "jobs": [r.view().model_dump(mode="json") for r in self._records.values()]}
        target = self._state_dir / STATE_FILE
        scratch = self._state_dir / (STATE_FILE + ".tmp")
        try:
            self._state_dir.mkdir(parents=True, exist_ok=True)
            scratch.write_text(json.dumps(document, indent=1), encoding="utf-8")
            os.replace(scratch, target)
        except OSError as exc:
            LOG.warning("the jobs state file could not be written: %s", exc)


def service_for(settings: Settings) -> JobService:
    """The app's service: real in a normal run, a disabled in-memory one in fixture mode (no process is ever started)."""
    if settings.fixture_mode:
        return JobService(root=settings.root, state_dir=None, python=sys.executable, enabled=False)
    return JobService(root=settings.root, state_dir=TERMINAL_DIR / "state", python=sys.executable)
