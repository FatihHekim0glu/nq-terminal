"""JOBS endpoints (ARCHITECTURE sections 8 and 9, PRD U3): the backtest queue. With `PUT /api/workspaces/{doc}` (the
workspace store, `api/workspaces.py`, D3.1) the only routes in the terminal that are not GET, which is why `app.py` must
let exactly `ALLOWED_WRITE_ROUTES` (the two below, `POST /api/jobs/actions` of `api/actions.py` and that one) through
its GET-only check.

- `GET /api/jobs`: every job, newest first, with the queue counts. `GET /api/jobs/{job_id}`: one job.
- `POST /api/jobs` (201): queue one backtest (`JobSpec`, see `models/jobs.py`). The worker runs `backtests/run_base.py`
  with that config, one job at a time; at most 10 jobs wait. 409 for a run id already used, 429 when the queue is
  full, 422 for a refused spec, 503 when the job runner is off in this backend (fixture mode, `NQT_JOBS=off`, or a
  backend that is not the lab's own, `services.jobs.service_for`): no process is ever started there.
- `DELETE /api/jobs/{job_id}`: stop a queued or running job, or drop the record of a finished one. It never removes
  run output.

A backend with the runner off answers POST and DELETE 503 ("jobs are off in this backend", with the reason) right
after the write checks below and before any body is parsed or any job looked up.

POST and DELETE refuse (403) a request that is not from a loopback peer, that lacks `X-NQT: 1`, that the browser marks
cross-site (`Sec-Fetch-Site`) or whose `Origin` is not the terminal, and (415) one whose content type is not
`application/json`. The custom header means a cross-site page cannot send it without a CORS preflight, which the
terminal never answers (no CORS middleware). The body is read here, capped at 8 KB, so the checks come before parsing.
No detail carries a path.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import ValidationError

from nq_terminal.desktop import lifecycle, watchdog
from nq_terminal.models.common import ErrorDetail
from nq_terminal.models.jobs import JOB_ID_PATTERN, Job, JobList, JobSpec
from nq_terminal.security import SAME_ORIGIN_FETCH_SITES, is_loopback, terminal_origins
from nq_terminal.services.jobs import (
    DuplicateRunId,
    JobService,
    JobsOff,
    QueueFull,
    UnknownJob,
    service_for,
)
from nq_terminal.services.runs import ANCHOR_RE
from nq_terminal.settings import ALLOWED_HOSTS, DEV_PORT, Settings

ALLOWED_WRITE_ROUTES = (
    "POST /api/jobs", "DELETE /api/jobs/{job_id}", "POST /api/jobs/actions", "PUT /api/workspaces/{doc}",
)
MAX_BODY_BYTES = 8192
NQT_HEADER = "x-nqt"
JSON_MEDIA_TYPE = "application/json"
STATE_KEY = "jobs"
OFF_DETAIL = "jobs are off in this backend"
_LOCK = threading.Lock()

ERROR_TEXT = {
    403: "not a loopback peer, the X-NQT: 1 header is missing, or the request is cross-site",
    404: "unknown job",
    409: "the run id is already used by a job or an output folder",
    413: "the body is larger than 8 KB",
    415: "the content type is not application/json",
    422: "the spec was refused (the detail lists each reason)",
    429: "the queue is full (10 jobs waiting)",
    503: "the job runner is off in this backend (fixture mode, NQT_JOBS=off, or not the lab's own backend)",
}
router = APIRouter(prefix="/api/jobs", tags=["jobs"],
                   responses={code: {"model": ErrorDetail, "description": text} for code, text in ERROR_TEXT.items()
                              if code in (403, 404, 422, 503)})
_POST_BODY = {"requestBody": {"required": True,
                              "content": {JSON_MEDIA_TYPE: {"schema": {"$ref": "#/components/schemas/JobSpec"}}}}}


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def adopt_service(app: Any, service: JobService, *, watch: bool = True) -> JobService:
    """Make `service` the app's one JobService; with `watch`, the stdin watchdog closes it when the parent is gone."""
    setattr(app.state, STATE_KEY, service)
    if watch:
        watchdog.watch_jobs(service)
    return service


def get_service(request: Request) -> JobService:
    """One service per app, created on first use (the harness or a test may set `app.state.jobs` first).

    A backend whose stdin is its parent's pipe (desktop or launcher mode) has the watchdog close the service at end of
    file, which terminates a running job; any other backend has no such pipe and nothing to watch."""
    state = request.app.state
    with _LOCK:
        service = getattr(state, STATE_KEY, None)
        if service is None:
            settings = _settings(request)
            service = adopt_service(request.app, service_for(settings, lock_held=lifecycle.lock_held_now(request.app)),
                                    watch=settings.reads_stdin)
    return service


def _refuse(status: int, detail: str | list[dict[str, Any]]) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


def write_guard(request: Request) -> None:
    """The checks every write passes before anything is parsed (module docstring)."""
    if not (is_loopback(request.client) and is_loopback(request.scope.get("server"))):
        raise _refuse(403, "the terminal serves loopback clients only")
    if request.headers.get(NQT_HEADER) != "1":
        raise _refuse(403, "the X-NQT: 1 header is required")
    site, origin = request.headers.get("sec-fetch-site"), request.headers.get("origin")
    origins = terminal_origins(ALLOWED_HOSTS, (_settings(request).port, DEV_PORT))
    if (site is not None and site.strip().lower() not in SAME_ORIGIN_FETCH_SITES) or (
            origin is not None and origin.strip().lower() not in origins):
        raise _refuse(403, "cross-site requests to the terminal API are refused")
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media != JSON_MEDIA_TYPE:
        raise _refuse(415, "the content type must be application/json")


def require_jobs_on(request: Request, _guard: None = Depends(write_guard)) -> None:
    """503 with the reason when this backend's runner is off; after the write checks, before anything is read."""
    service = get_service(request)
    if not service.enabled:
        raise _refuse(503, service.off_reason or OFF_DETAIL)


async def read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise _refuse(413, "the body is larger than 8 KB")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise _refuse(413, "the body is larger than 8 KB")
        chunks.append(chunk)
    return b"".join(chunks)


async def read_spec(request: Request, _on: None = Depends(require_jobs_on)) -> JobSpec:
    body = await read_body(request)
    try:
        spec = JobSpec.model_validate_json(body)
    except ValidationError as exc:
        raise _refuse(422, [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]}
                            for e in exc.errors(include_url=False, include_context=False, include_input=False)])
    except ValueError:
        raise _refuse(422, [{"type": "json_invalid", "loc": [], "msg": "the body is not valid JSON"}]) from None
    if ANCHOR_RE.fullmatch(spec.run_id):  # only an anchor re-run (POST /api/jobs/actions) mints a rule 3 id
        raise _refuse(422, [{"type": "value_error", "loc": ["run_id"],
                             "msg": "a regression-anchor id is only given by an anchor re-run"}])
    return spec


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except QueueFull as exc:
        raise _refuse(429, str(exc)) from exc
    except DuplicateRunId as exc:
        raise _refuse(409, str(exc)) from exc
    except UnknownJob as exc:
        raise _refuse(404, str(exc)) from exc
    except JobsOff as exc:
        raise _refuse(503, str(exc) or OFF_DETAIL) from exc


@router.get("", response_model=JobList)
def list_jobs(request: Request) -> JobList:
    """Every job, newest first, with the queue counts."""
    return get_service(request).list_jobs()


@router.post("", response_model=Job, status_code=201, openapi_extra=_POST_BODY,
             responses={code: {"model": ErrorDetail, "description": ERROR_TEXT[code]}
                        for code in (409, 413, 415, 429)})
def queue_job(request: Request, spec: JobSpec = Depends(read_spec)) -> Job:
    """Queue one in-sample backtest; the worker runs `run_base.py` with exactly this config."""
    with _http_errors():
        return get_service(request).enqueue(spec)


@router.get("/{job_id}", response_model=Job)
def read_job(request: Request, job_id: str = Path(pattern=JOB_ID_PATTERN)) -> Job:
    with _http_errors():
        return get_service(request).get(job_id)


@router.delete("/{job_id}", response_model=Job, dependencies=[Depends(require_jobs_on)],
               responses={415: {"model": ErrorDetail, "description": ERROR_TEXT[415]}})
def remove_job(request: Request, job_id: str = Path(pattern=JOB_ID_PATTERN)) -> Job:
    """Stop a queued or running job, or drop a finished job's record; run output is never touched."""
    with _http_errors():
        return get_service(request).remove(job_id)
