"""A run that a detail read finds unreadable is listed as unreadable by /api/runs, through the app's own result cache
(V032 cleanup, 0.3.1 audit).

The cached body of /api/runs is pinned on the result files' (mtime_ns, size), which a corrupt-in-the-middle file keeps, so
the service tells its owner (`RunService(on_unreadable=...)`) and the owner drops the cached list. The first test attaches
that callback by hand and proves the contract through the real routes. The second asserts that `run_service_for` attaches
it (wired in api/runs.py by the V032 merge step).
"""
from __future__ import annotations

import random

from nq_terminal.api import runs as runs_api
from nq_terminal.services import result_cache as rc

from many_runs_lab import result_doc, writer_bytes
from test_result_cache_routes import Lab

RUN = "nt_corrupt_large_member_r1"


def _corrupt_run(lab: Lab) -> None:
    doc = result_doc(RUN, random.Random(0), probe_data=False, kind="book", ok=True)
    doc["trades"] = [{"t": 1, "pnl_usd": 1.5} for _ in range(5)]
    doc["n_trades"], doc["pnl_total"], doc["fills"] = 5, 7.5, []
    folder = lab.root / "backtests" / "output" / RUN
    folder.mkdir(parents=True)
    (folder / "result.json").write_bytes(writer_bytes(doc, crlf=False).replace(b'"t": 1', b'"t": @@@', 1))


def _row(lab: Lab) -> dict:
    return next(r for r in lab.client.get("/api/runs").json() if r["run_id"] == RUN)


def _drive(lab: Lab) -> None:
    assert _row(lab)["readable"] is True, "the framed fast path lists the corrupt run as readable first"
    assert lab.client.get(f"/api/runs/{RUN}").status_code == 503
    row = _row(lab)
    assert row["readable"] is False and RUN in row["error"]
    assert lab.cache.stats().entries >= 1


def test_the_run_list_shows_the_run_as_unreadable_once_the_owner_drops_its_cached_list(tmp_path):
    lab = Lab(tmp_path)
    _corrupt_run(lab)
    lab.build()
    service = runs_api.run_service_for(lab.app.state)
    service._on_unreadable = lambda: lab.cache.forget(rc.ROUTE_RUNS, {})  # what the merge step wires in run_service_for
    _drive(lab)


def test_run_service_for_attaches_the_callback_that_drops_the_cached_run_list(tmp_path):
    lab = Lab(tmp_path)
    _corrupt_run(lab)
    lab.build()
    _drive(lab)
