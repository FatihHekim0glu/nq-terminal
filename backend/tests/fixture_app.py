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
It refuses to build unless NQT_FIXTURE_DIR is set (fixture mode). The production package never imports this module
or `fakes` (a test checks), so the fake serve cannot reach a normal run. `app` is built on first access, so
importing the module for tests builds nothing.
"""
from __future__ import annotations

import os
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
from nq_terminal.settings import load_settings  # noqa: E402

from fakes import FakeCatalog, make_fake_serve  # noqa: E402
from opening_spec import ensure_opening_spec_fixture  # noqa: E402
from p2_chain_fakes import ChainServe  # noqa: E402
from p2_jobs_fakes import make_e2e_root  # noqa: E402

JOBS_ENV = "NQT_FIXTURE_JOBS"
FAKE_JOBS = "fake"
LOG_DIR_ENV = "NQT_FIXTURE_LOG_DIR"
LOG_NAME = "oos_access_log.jsonl"


class FixtureHarnessError(RuntimeError):
    """The harness was asked to build an app outside fixture mode."""


def create_fixture_app(env: Mapping[str, str] | None = None, *, log_dir: Path | None = None) -> FastAPI:
    source = os.environ if env is None else env
    settings = load_settings(source)
    if not settings.fixture_mode:
        raise FixtureHarnessError("the fixture harness runs only in fixture mode: set NQT_FIXTURE_DIR")
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
        value = create_fixture_app()
        globals()["app"] = value
        return value
    raise AttributeError(name)
