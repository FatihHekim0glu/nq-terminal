"""The fixture-mode app for E2E runs and screenshots (ARCHITECTURE s11 "Fixture mode"; TASKS Phases 4 and 7).

Start (PowerShell, from this repository's root, which sits inside the nq-lab project next to its `.venv`):
    $env:NQT_FIXTURE_DIR = (Resolve-Path backend/tests/fixtures).Path
    & ../.venv/Scripts/python.exe -m uvicorn fixture_app:app `
        --app-dir backend/tests --host 127.0.0.1 --port 8765

`create_fixture_app` builds the production app (`nq_terminal.app.create_app`) with fixture settings and injects:
- `app.state.serve_fn`: `fakes.make_fake_serve` over synthetic bars, through the real `oos_gate.serve_bars` with a
  temporary audit log (`NQT_FIXTURE_LOG_DIR`, or a fresh folder in the system temp); the fake refuses a log path
  inside results, data, live, backtests/output or the fixtures. `p2_chain_fakes.ChainServe` wraps it so the calendar
  chains `<ROOT>.C.k` (MV6, ROLL 2) Market) are synthetic too, through the same gate;
- `app.state.catalog`: `fakes.FakeCatalog` over the same synthetic series, so the catalog never lists the real
  processed folder;
- with `NQT_FIXTURE_JOBS=fake`: `app.state.jobs`, a real `JobService` over a stand-in `run_base.py` in a temporary
  folder (`p2_jobs_fakes.E2E_RUN_BASE`), so the browser tests can queue and stop a job. The real runner is never
  started and nothing is written under `backtests/output`.
- its own state folder: unless NQT_STATE_DIR names one, a fresh temporary folder (under the system temp, which is
  D:/dev/tmp under the build prelude) that is removed when the process ends, so the result cache and every other
  write of the backend land there and the real `terminal/state` is never touched (W1B). A given NQT_STATE_DIR that is
  `terminal/state` or inside it is refused. NQT_PREWARM is forced to 0, so the HOME prewarm never runs behind a test.
It refuses to build unless NQT_FIXTURE_DIR is set (fixture mode). The production package never imports this module
or `fakes` (a test checks), so the fake serve cannot reach a normal run. `app` is built on first access, so
importing the module for tests builds nothing.
"""
from __future__ import annotations

import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI  # noqa: E402

from nq_terminal.app import create_app  # noqa: E402
from nq_terminal.services.jobs import JobService  # noqa: E402
from nq_terminal.settings import TERMINAL_STATE_DIR, load_settings  # noqa: E402

from fakes import FakeCatalog, make_fake_serve  # noqa: E402
from opening_spec import ensure_opening_spec_fixture  # noqa: E402
from p2_chain_fakes import ChainServe  # noqa: E402
from p2_jobs_fakes import make_e2e_root  # noqa: E402

JOBS_ENV = "NQT_FIXTURE_JOBS"
FAKE_JOBS = "fake"
LOG_DIR_ENV = "NQT_FIXTURE_LOG_DIR"
LOG_NAME = "oos_access_log.jsonl"
STATE_ENV = "NQT_STATE_DIR"
PREWARM_ENV = "NQT_PREWARM"
STATE_PREFIX = "nqt-fixture-state-"


class FixtureHarnessError(RuntimeError):
    """The harness was asked to build an app outside fixture mode."""


def _inside_real_state(folder: Path) -> bool:
    real = TERMINAL_STATE_DIR.resolve()
    resolved = folder.resolve()
    return resolved == real or resolved.is_relative_to(real)


def _temporary_state_dir() -> Path:
    folder = Path(tempfile.mkdtemp(prefix=STATE_PREFIX))
    atexit.register(shutil.rmtree, folder, True)
    return folder


def fixture_environment(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """The variables the fixture app is built from: `env` (the process environment when None) with its own state
    folder (the given one, unless it is the real `terminal/state`; else a temporary one) and the prewarm off."""
    out = dict(os.environ if env is None else env)
    given = (out.get(STATE_ENV) or "").strip()
    if given:
        if _inside_real_state(Path(given)):
            raise FixtureHarnessError(f"the fixture app may not use the real state folder: {given}")
    else:
        out[STATE_ENV] = str(_temporary_state_dir())
    out[PREWARM_ENV] = "0"
    return out


def create_fixture_app(env: Mapping[str, str] | None = None, *, log_dir: Path | None = None) -> FastAPI:
    source = os.environ if env is None else env
    if not load_settings(source).fixture_mode:
        raise FixtureHarnessError("the fixture harness runs only in fixture mode: set NQT_FIXTURE_DIR")
    source = fixture_environment(env)
    settings = load_settings(source)
    ensure_opening_spec_fixture()  # a no-op once the copy exists
    folder = Path(log_dir) if log_dir is not None else Path(
        source.get(LOG_DIR_ENV) or tempfile.mkdtemp(prefix="nqt-fixture-log-"))
    serve = ChainServe(folder / LOG_NAME, make_fake_serve(folder / LOG_NAME))  # refuses a protected folder
    app = create_app(settings)
    app.state.serve_fn = serve
    app.state.catalog = FakeCatalog()
    app.state.fixture_log = serve.log_path
    if source.get(JOBS_ENV) == FAKE_JOBS:
        app.state.jobs = fake_job_service()
    return app


def fake_job_service() -> JobService:
    """A job service whose runner is the stand-in script of a temporary root; its state stays in memory."""
    root = make_e2e_root(Path(tempfile.mkdtemp(prefix="nqt-fixture-jobs-")))
    return JobService(root=root, state_dir=None, python=sys.executable)


def __getattr__(name: str) -> Any:
    if name == "app":
        os.environ.update(fixture_environment())  # one state folder and no prewarm for the whole process
        value = create_fixture_app()
        globals()["app"] = value
        return value
    raise AttributeError(name)
