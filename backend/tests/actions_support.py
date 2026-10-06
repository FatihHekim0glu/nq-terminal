"""Helpers for the actions tests (launch presets, backtests from a preset, anchor re-runs; vnext product-1 and 3).

No tests live here. Every root is a copy of the fixture runs under pytest's `tmp_path` with a fixture ledger and the
recording stand-in `run_base.py`; the job service uses the fake `Popen` of `p2_jobs_fakes.py`, so no real runner and
no real research file is ever touched. `snapshot` records every file under a folder (path and bytes), so a test can
prove that nothing under `results/` was written.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from nq_terminal.services.jobs import JobService
from nq_terminal.services.runs import RunService

from p2_jobs_fakes import FAKE_RUN_BASE, PYTHON, FakePopen
from test_runs_support import RUNS, FakeClock, add_run, copy_root, ledger_row, result_doc, write_ledger

ZA, OVERNIGHT, SIZED = RUNS["za_orb"], RUNS["overnight"], RUNS["sized"]
ZA_EXP, OVERNIGHT_EXP = "za_v0_fixture", "overnight_v0_fixture"


def row(run_id: str, exp_id: str, strategy: str, params: dict[str, Any], *, ts: str, variant: str = "repaired",
        start: str = "2010-09-28", end: str = "2022-01-01", runtime_s: str = "4.2") -> dict[str, Any]:
    """A ledger row written by hand (for rows whose run folder does not exist)."""
    return {"run_id": run_id, "ts_utc": ts, "exp_id": exp_id, "strategy": strategy,
            "params_json": json.dumps(params, sort_keys=True), "variant": variant, "start": start, "end": end,
            "n_trades": 1, "pnl_total": 1.0, "fees_total": 0.5, "mean_net_r": "", "t_net_r": "", "hit_rate": "",
            "balance_check": "OK", "runtime_s": runtime_s, "result_created_utc": ts}


def ledger_rows() -> list[dict[str, Any]]:
    """The fixture ledger, oldest first as the real one is appended:

    - an older row with the same config as the za_orb run (de-duplicated away by the newer one);
    - the za_orb and overnight fixture runs;
    - a volmanaged_bh row whose `t0` lies past the fence (listed, not launchable) and one whose `t0` is in-sample
      (launchable: `t0` is a feed key of volmanaged_bh);
    - a strategy the terminal does not know (skipped);
    - a window ending 2022-01-02 and one starting before 2010 (never offered)."""
    za = {**ledger_row(ZA, ZA_EXP), "ts_utc": "2026-09-26T02:00:00+00:00", "runtime_s": "28.3"}
    older = {**za, "run_id": "nt_za_v0_fixture_old", "ts_utc": "2026-09-25T02:00:00+00:00"}
    overnight = {**ledger_row(OVERNIGHT, OVERNIGHT_EXP), "ts_utc": "2026-09-26T03:00:00+00:00"}
    return [
        older,
        za,
        overnight,
        row("nt_bh_fixture", "volmanaged_v0_fixture", "volmanaged_bh", {"k": 1.0, "t0": "2022-03-01", "ticks": 1},
            ts="2026-09-26T04:00:00+00:00", start="2011-01-03"),
        row("nt_bh_ok_fixture", "volmanaged_v0_ok", "volmanaged_bh", {"k": 1.0, "t0": "2011-04-21", "ticks": 1},
            ts="2026-09-26T04:30:00+00:00", start="2011-01-03"),
        row("nt_mystery_fixture", "mystery_v0", "mystery", {}, ts="2026-09-26T05:00:00+00:00"),
        row("nt_za_late_fixture", "za_late", "za_orb", {"or_minutes": 5, "target_r": 10.0},
            ts="2026-09-26T06:00:00+00:00", end="2022-01-02"),
        row("nt_za_early_fixture", "za_early", "za_orb", {"or_minutes": 5, "target_r": 10.0},
            ts="2026-09-26T07:00:00+00:00", start="2009-12-31"),
    ]


def make_root(tmp_path: Path, *, ledger: bool = True) -> Path:
    """A data root with the fixture runs, the fixture ledger and the recording stand-in runner."""
    root = copy_root(tmp_path)
    if ledger:
        write_ledger(root, ledger_rows())
    (root / "backtests" / "run_base.py").write_text(FAKE_RUN_BASE, encoding="utf-8")
    return root


SPEC_DOCS: dict[str, str] = {
    ZA_EXP: '{"name": "za_v0_fixture", "bar": 2.5}\n',
    "volmanaged_v0_ok": '{"name": "volmanaged_v0_ok", "cap": 2.0}\n',
}  # OVERNIGHT_EXP and volmanaged_v0_fixture have no spec file on purpose


def add_specs(root: Path, docs: dict[str, str] | None = None) -> dict[str, str]:
    """Write `experiments/<exp>.json` for the fixture experiments that have a spec; returns each file's sha256."""
    folder = root / "experiments"
    folder.mkdir(exist_ok=True)
    hashes: dict[str, str] = {}
    for exp, text in (SPEC_DOCS if docs is None else docs).items():
        path = folder / f"{exp}.json"
        path.write_text(text, encoding="utf-8", newline="\n")
        hashes[exp] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def runs_for(root: Path) -> RunService:
    return RunService(data_root=root, project_root=root, clock=FakeClock())


def jobs_for(root: Path, tmp_path: Path, popen: FakePopen) -> JobService:
    return JobService(root=root, state_dir=tmp_path / "state", python=PYTHON, popen=popen)


def runner_argv(root: Path, config: dict[str, Any]) -> list[str]:
    """The exact command the queue starts: the one runner with the JSON config string, no shell."""
    return [PYTHON, "-u", str(root / "backtests" / "run_base.py"), "--config", json.dumps(config)]


def snapshot(folder: Path) -> dict[str, bytes]:
    """Every file under `folder` (relative path -> bytes)."""
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def plant_rerun(root: Path, run_id: str, base: str, mutate=None) -> Path:
    """The result.json a finished re-run would leave: the base's document, optionally changed by `mutate`."""
    doc = json.loads(json.dumps(result_doc(base)))
    if mutate is not None:
        mutate(doc)
    return add_run(root, run_id, doc)


__all__ = ["FakePopen", "OVERNIGHT", "OVERNIGHT_EXP", "PYTHON", "RUNS", "SIZED", "SPEC_DOCS", "ZA", "ZA_EXP",
           "add_specs", "jobs_for",
           "ledger_rows", "make_root", "plant_rerun", "row", "runner_argv", "runs_for", "snapshot"]
