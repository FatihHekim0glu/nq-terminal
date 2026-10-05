"""Actions endpoints (vnext product-1 and product-3): launch research from the terminal through the JOBS queue.

- `GET /api/jobs/actions/presets`: the launch presets (ledger rows of registered strategies, newest first) and the
  named parameter schema of each strategy offered. Read only, price free.
- `POST /api/jobs/actions` (201): one action, discriminated by `kind`:
  `{"kind": "backtest", "preset_id", "params", "start", "end", "run_id"}` queues the preset's config with the named
  parameters changed (each checked against the strategy's schema), an optional narrower in-sample window and an
  optional run id; `{"kind": "anchor", "base_run_id"}` queues the base run's own config under a fresh
  `..._regress_r<N>` id. 404 for an unknown preset or base run, 409 for a run id already used, 422 with each reason
  (`loc`, `msg`) for a refused action, 429 when the queue is full, 503 when the runner is off in this backend.
- `GET /api/jobs/actions/anchors/{run_id}`: MATCH, MISMATCH (naming the first differing field), NOT COMPARABLE or
  PENDING for a re-run and its base, compared exactly. 404 for an id no run folder and no job holds.

The write is the fourth non-GET route of the terminal (`WRITE_ROUTES`; `app.py` must let it through its GET-only check
with `jobs.ALLOWED_WRITE_ROUTES`). It keeps the JOBS safety model exactly: the session middleware (cookie and
same-origin Origin) runs first, then `api/jobs.write_guard` (loopback peer, `X-NQT: 1`, no cross-site, JSON only) and
`require_jobs_on` (503 before anything is read), then the body is read here with the same 8 KB cap. The body names a
preset or a base run and named parameters only; any other field is refused, so no client can send a config, a path
or a command. Every action ends in `JobService.enqueue`, which runs only `backtests/run_base.py --config <json>`.
No route here writes a file; no detail carries a path.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import TypeAdapter, ValidationError

from nq_terminal.api import jobs as jobs_api
from nq_terminal.api.runs import run_service_for
from nq_terminal.models.actions import Action, ActionResult, AnchorAction, AnchorCheck, PresetList
from nq_terminal.models.common import ErrorDetail
from nq_terminal.services import actions, presets
from nq_terminal.services.anchor_check import check_anchor
from nq_terminal.services.jobs import DuplicateRunId, JobsOff, QueueFull
from nq_terminal.services.runs import RunService, RunUnreadable

WRITE_ROUTES = ("POST /api/jobs/actions",)
RUN_ID_PATH = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}$"
ERROR_TEXT = {
    403: "not a loopback peer, the X-NQT: 1 header is missing, or the request is cross-site",
    404: "unknown preset, base run or re-run",
    409: "the run id is already used by a job or an output folder",
    413: "the body is larger than 8 KB",
    415: "the content type is not application/json",
    422: "the action was refused (the detail lists each reason)",
    429: "the queue is full (10 jobs waiting)",
    503: "the job runner is off in this backend, or a result file could not be read",
}
router = APIRouter(prefix="/api/jobs/actions", tags=["jobs"],
                   responses={code: {"model": ErrorDetail, "description": ERROR_TEXT[code]} for code in (404, 422, 503)})
_ACTION = TypeAdapter(Action)
_POST_BODY = {"requestBody": {"required": True, "content": {jobs_api.JSON_MEDIA_TYPE: {"schema": {
    "oneOf": [{"$ref": "#/components/schemas/BacktestAction"}, {"$ref": "#/components/schemas/AnchorAction"}],
    "discriminator": {"propertyName": "kind", "mapping": {
        "backtest": "#/components/schemas/BacktestAction", "anchor": "#/components/schemas/AnchorAction"}}}}}}}


def _runs(request: Request) -> RunService:
    return run_service_for(request.app.state)


def _refuse(status: int, detail: str | list[dict[str, Any]]) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


def _details(problems: list[tuple[tuple[str, ...], str]]) -> list[dict[str, Any]]:
    return [{"type": "action_refused", "loc": list(loc), "msg": msg} for loc, msg in problems]


async def read_action(request: Request, _on: None = Depends(jobs_api.require_jobs_on)) -> Any:
    """The checked action: the write checks and the runner switch first, then the capped body, then the model."""
    body = await jobs_api.read_body(request)
    try:
        return _ACTION.validate_json(body)
    except ValidationError as exc:
        raise _refuse(422, [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]}
                            for e in exc.errors(include_url=False, include_context=False, include_input=False)])
    except ValueError:
        raise _refuse(422, [{"type": "json_invalid", "loc": [], "msg": "the body is not valid JSON"}]) from None


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except actions.ActionRefused as exc:
        raise _refuse(422, _details(exc.problems)) from exc
    except (actions.UnknownPreset, actions.UnknownBase, actions.UnknownAnchor) as exc:
        raise _refuse(404, str(exc)) from exc
    except DuplicateRunId as exc:
        raise _refuse(409, str(exc)) from exc
    except QueueFull as exc:
        raise _refuse(429, str(exc)) from exc
    except JobsOff as exc:
        raise _refuse(503, str(exc) or jobs_api.OFF_DETAIL) from exc
    except RunUnreadable as exc:
        raise _refuse(503, f"result file could not be read: {exc}") from exc


@router.get("/presets", response_model=PresetList)
def list_presets(request: Request) -> PresetList:
    """The ledger rows of registered strategies as launch presets, with each strategy's named parameters."""
    with _http_errors():
        return presets.list_presets(_runs(request))


@router.post("", response_model=ActionResult, status_code=201, openapi_extra=_POST_BODY,
             responses={code: {"model": ErrorDetail, "description": ERROR_TEXT[code]}
                        for code in (403, 409, 413, 415, 429)})
def start_action(request: Request, action: Any = Depends(read_action)) -> ActionResult:
    """Queue a backtest from a preset, or an anchor re-run of a finished run; the worker runs `run_base.py`."""
    service = jobs_api.get_service(request)
    with _http_errors():
        if isinstance(action, AnchorAction):
            return actions.rerun_anchor(action, runs=_runs(request), jobs=service)
        return actions.start_backtest(action, runs=_runs(request), jobs=service)


@router.get("/anchors/{run_id}", response_model=AnchorCheck)
def read_anchor(request: Request, run_id: str = Path(pattern=RUN_ID_PATH)) -> AnchorCheck:
    """The exact comparison of a re-run with its base (rule 3)."""
    with _http_errors():
        return check_anchor(run_id, runs=_runs(request), jobs=jobs_api.get_service(request))
