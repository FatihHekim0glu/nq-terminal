"""The runs service over the real `backtests/output/` (read only; TASKS 2.1 acceptance).

Counts are read from disk at run time (a research workflow may add runs while these tests run); the expected
values are computed here independently of the service, from the raw JSON.
"""
from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path

import pytest

from nq_lab.config import ROOT

from test_runs_support import FakeClock, service, strict_json

OUTPUT = ROOT / "backtests" / "output"
LEDGER = ROOT / "results" / "ledger.csv"
PROBES_SEEN_2026_09_26 = 12


def _real_runs() -> list[str]:
    return sorted(p.parent.name for p in OUTPUT.glob("*/result.json"))


REAL_RUNS = _real_runs()


@lru_cache(maxsize=1)
def real_service():
    return service(ROOT, clock=FakeClock())


@lru_cache(maxsize=None)
def raw(run_id: str) -> dict:
    """The small facts of one result file (the large arrays are dropped so 150 MB is not held in memory)."""
    doc = json.loads((OUTPUT / run_id / "result.json").read_text(encoding="utf-8"))
    keep = {k: v for k, v in doc.items() if k not in ("trades", "fills", "strategy_log")}
    return {**keep, "has_log": "strategy_log" in doc}


@lru_cache(maxsize=1)
def summaries() -> dict:
    return {s.run_id: s for s in real_service().summaries()}


def test_real_output_has_runs():
    assert len(REAL_RUNS) >= 65


def test_every_real_result_parses():
    by_id = summaries()
    missing = [r for r in REAL_RUNS if r not in by_id]
    unreadable = {r: s.error for r, s in by_id.items() if not s.readable}
    assert not missing and not unreadable, (missing, unreadable)


@pytest.mark.parametrize("run_id", REAL_RUNS)
def test_real_detail_is_strict_json(run_id):
    detail = real_service().detail(run_id)
    strict_json(detail.model_dump_json())
    assert detail.summary.n_trades == raw(run_id)["n_trades"]


def test_probes_are_flagged():
    expected = {r for r in REAL_RUNS if "lookahead_probe" in raw(r).get("data", {}) or "_probe_" in r}
    flagged = {r for r, s in summaries().items() if s.is_probe}
    assert flagged == expected and len(flagged) >= PROBES_SEEN_2026_09_26


def test_anchors_are_flagged_and_have_a_base():
    expected = {r for r in REAL_RUNS if "_regress_" in r or "_haltfix_" in r}
    flagged = {r for r, s in summaries().items() if s.is_anchor}
    assert flagged == expected and expected
    for run_id in sorted(expected):
        cmp = real_service().anchor(run_id)
        assert cmp is not None and cmp.base in summaries(), run_id


def test_real_nan_run():
    detail = real_service().detail("smoke_2015_01")
    assert detail.summary_stats["blocks"]["2010-2013"]["mean_net_r"] is None
    strict_json(real_service().equity("smoke_2015_01").model_dump_json())


@pytest.mark.parametrize("run_id", [r for r in REAL_RUNS if raw(r)["has_log"]])
def test_real_snapshot_equity_ends_at_final_usd(run_id):
    eq = real_service().equity(run_id)
    assert eq.source == "mtm_snapshots"
    assert eq.equity[-1] == pytest.approx(raw(run_id)["balance_check"]["final_usd"], rel=0, abs=1e-6)


@pytest.mark.parametrize("run_id", [r for r in REAL_RUNS if not raw(r)["has_log"]])
def test_real_realised_curve_ends_at_pnl_total(run_id):
    eq = real_service().equity(run_id)
    doc = raw(run_id)
    assert eq.source == "realised_trades"
    assert eq.pnl[-1] == pytest.approx(doc["pnl_total"], rel=0, abs=1e-6)
    assert eq.n_sessions == doc["data"]["sessions"]


def _ledger_ids() -> list[str]:
    with LEDGER.open(encoding="utf-8", newline="") as fh:
        return [row["run_id"] for row in csv.DictReader(fh)]


def test_real_ledger_rows_match_their_results():
    view = real_service().ledger()
    assert [r.run_id for r in view.rows] == _ledger_ids()
    bad = [r.run_id for r in view.rows if not (r.run_found and r.matches_result)]
    assert not bad
    ledgered = {r for r, s in summaries().items() if s.ledger is not None}
    assert ledgered == set(_ledger_ids())


def test_real_ledgered_runs_get_no_command():
    for run_id in _ledger_ids():
        cmd = real_service().detail(run_id).ledger_command
        assert not cmd.eligible and cmd.command is None


def test_real_regress_checks_agree_with_the_pairs():
    """Where regress_check.json says identical, the four compared numbers must agree too."""
    for check in sorted(OUTPUT.glob("*/regress_check.json")):
        doc = json.loads(check.read_text(encoding="utf-8"))
        cmp = real_service().anchor(check.parent.name)
        assert cmp.base == doc["old"] and cmp.regress_check_identical is doc["identical"]
        if doc["identical"]:
            assert cmp.verdict == "IDENTICAL", check.parent.name


def test_real_compare_of_two_anchored_runs():
    cmp = real_service().compare(["nt_tsmom_v0_m1", "nt_tsmom_v0_m1_regress_r8"])
    a, b = cmp.series
    assert a.rebased == b.rebased and cmp.stats[0].sharpe == cmp.stats[1].sharpe


def test_output_folder_is_the_real_one():
    assert Path(OUTPUT).is_dir() and real_service().data_root == ROOT
