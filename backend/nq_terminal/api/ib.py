"""The read-only IB snapshot endpoint (ARCHITECTURE s4 and s8; PRD U3).

- `GET /api/ib/snapshot`: the account summary, positions, working orders (view only) and today's executions of a
  paper TWS or Gateway on this machine, account id masked, cached for a few seconds. Always a 200 with a `state`:
  `ok`, `disabled` (`NQT_IB_READONLY=1` not set, or fixture mode), `unavailable` (no TWS answered in time) or `refused` (a guard
  stopped the read, or this backend has `NQT_JOBS=off`: a test or smoke backend never reads a TWS, whatever the
  environment says; no socket is opened). There is no other IB route, and no route that could send anything to TWS.

The handler is a plain `def`: the read blocks on a socket for up to a few seconds, which belongs in the thread pool,
not on the event loop. The service (config from the environment, cache, lock) is built once per app on first use.
"""
from __future__ import annotations

import threading

from fastapi import APIRouter, Request

from nq_terminal.desktop import lifecycle
from nq_terminal.models.ib import IbSnapshot
from nq_terminal.services.ib_snapshot import IbSnapshotService
from nq_terminal.services.jobs import lock_refusal

router = APIRouter(prefix="/api/ib", tags=["ib"])

_LOCK = threading.Lock()
JOBS_OFF_PROBLEM = "IB snapshot refused: jobs are off in this backend (NQT_JOBS=off), so no TWS is read."
NOT_LOCK_HOLDER_PROBLEM = ("IB snapshot refused: this backend does not hold the lock of the lab's own state folder, "
                           "so no TWS is read.")


def _service(request: Request) -> IbSnapshotService:
    state = request.app.state
    with _LOCK:
        service = getattr(state, "ib_snapshot", None)
        if service is None:
            # Fixture mode is a test and demo mode: whatever the shell sets, it never opens a socket to a TWS
            # (the jobs service is disabled in fixture mode the same way).
            settings = state.settings
            if settings.fixture_mode:
                service = IbSnapshotService(None)
            elif not settings.jobs_enabled:  # a test or smoke backend (03 sections 8 and 9): refused, no socket
                service = IbSnapshotService(None, problem=JOBS_OFF_PROBLEM)
            elif lock_refusal(settings, lifecycle.lock_held_now(request.app)) is not None:  # not the lab's lock (03 s8)
                service = IbSnapshotService(None, problem=NOT_LOCK_HOLDER_PROBLEM)
            else:
                service = IbSnapshotService.from_env()
            state.ib_snapshot = service
    return service


@router.get("/snapshot", response_model=IbSnapshot)
def ib_snapshot(request: Request) -> IbSnapshot:
    """Account summary, positions, working orders (view only) and today's executions; see the module docstring."""
    return _service(request).snapshot()
