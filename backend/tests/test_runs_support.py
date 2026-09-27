"""Helpers for the runs tests (TASKS 2.1): temporary data roots, a fake clock, a spying FileCache, a client.

No tests live here. Temporary roots are built under pytest's `tmp_path` (outside the project), so they are
valid `NQT_FIXTURE_DIR` values and never touch `backtests/output/` or the Phase 1 fixtures.
"""
from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from typing import Any, Iterable

from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.services.files import FileCache
from nq_terminal.services.runs import RunService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, load_manifest

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
FIXTURE_OUTPUT = FIXTURES / "backtests" / "output"
RUNS = load_manifest()["runs"]  # shape -> run_id
LEDGER_FIELDS = ["run_id", "ts_utc", "exp_id", "strategy", "params_json", "variant", "start", "end", "n_trades",
                 "pnl_total", "fees_total", "mean_net_r", "t_net_r", "hit_rate", "balance_check", "runtime_s",
                 "result_created_utc"]


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class SpyCache(FileCache):
    """A FileCache that records every path it is asked to read."""

    def __init__(self, **kwargs: Any):
        super().__init__(**kwargs)
        self.paths: list[Path] = []

    def get(self, path, parser, *, kind):
        self.paths.append(Path(path))
        return super().get(path, parser, kind=kind)


def result_doc(run_id: str) -> dict:
    return json.loads((FIXTURE_OUTPUT / run_id / "result.json").read_text(encoding="utf-8"))


SESSION_QA = ("za_v0_rejected_days.json", "za_v0_repaired_rejected_days.json")


def copy_root(tmp_path: Path, runs: Iterable[str] | None = None, session_qa: bool = True) -> Path:
    """A data root in tmp_path holding copies of the fixture runs (all of them by default) and, unless
    `session_qa` is False, the za_v0 rejected-days files that give za_orb runs their gated sessions."""
    root = tmp_path / "root"
    output = root / "backtests" / "output"
    output.mkdir(parents=True)
    for run_id in runs if runs is not None else RUNS.values():
        shutil.copytree(FIXTURE_OUTPUT / run_id, output / run_id)
    (root / "results").mkdir()
    if session_qa:
        screens = root / "results" / "screens"
        screens.mkdir()
        for name in SESSION_QA:
            shutil.copy(FIXTURES / "results" / "screens" / name, screens / name)
    return root


def add_run(root: Path, run_id: str, doc: dict, sidecars: dict[str, Any] | None = None) -> Path:
    """Write a run folder with `doc` as its result.json (run_id and config.run_id set to `run_id`)."""
    folder = root / "backtests" / "output" / run_id
    folder.mkdir(parents=True)
    body = {**doc, "run_id": run_id, "config": {**doc["config"], "run_id": run_id}}
    (folder / "result.json").write_text(json.dumps(body), encoding="utf-8")
    for name, value in (sidecars or {}).items():
        text = value if isinstance(value, str) else json.dumps(value)
        (folder / name).write_text(text, encoding="utf-8")
    return folder


def ledger_row(run_id: str, exp_id: str, doc: dict | None = None) -> dict:
    doc = doc if doc is not None else result_doc(run_id)
    cfg, summ = doc["config"], doc.get("summary", {})
    return {"run_id": run_id, "ts_utc": "2026-09-26T00:00:00+00:00", "exp_id": exp_id, "strategy": cfg["strategy"],
            "params_json": json.dumps(cfg.get("params", {}), sort_keys=True), "variant": cfg.get("variant", ""),
            "start": cfg.get("start", ""), "end": cfg.get("end", ""), "n_trades": doc["n_trades"],
            "pnl_total": doc["pnl_total"], "fees_total": doc["fees_total"],
            "mean_net_r": "" if summ.get("mean_net_r") is None else summ["mean_net_r"],
            "t_net_r": "" if summ.get("t_net_r") is None else summ["t_net_r"],
            "hit_rate": summ.get("hit_rate", ""), "balance_check": "OK", "runtime_s": doc.get("elapsed_s", ""),
            "result_created_utc": doc.get("created_utc", "")}


def write_ledger(root: Path, rows: list[dict]) -> Path:
    path = root / "results" / "ledger.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=LEDGER_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return path


def service(root: Path, clock: FakeClock | None = None, cache: FileCache | None = None) -> RunService:
    return RunService(data_root=root, project_root=ROOT, clock=clock or FakeClock(), cache=cache)


def client(root: Path | None = None) -> TestClient:
    env = {} if root is None else {"NQT_FIXTURE_DIR": str(root)}
    return TestClient(create_app(load_settings(env)), base_url=LOCAL, client=LOOPBACK)


def strict_json(text: str) -> Any:
    """json.loads that refuses NaN and Infinity tokens (browsers reject them)."""
    def refuse(token: str) -> Any:
        raise ValueError(f"non-standard JSON token {token}")

    return json.loads(text, parse_constant=refuse)
