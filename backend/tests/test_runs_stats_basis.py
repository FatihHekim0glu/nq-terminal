"""One definition of a run's Sharpe and max drawdown (item (c); item (b)).

The RUNS compare view, the anchor check and the tear sheet use the same Basis B series, `series.run_returns`
(one row for every gated session, ANALYTICS_CATALOG C1), so one run never shows two Sharpe values. Before, the
compare view counted gate-rejected sessions as zero-return days (za_orb repaired: 0.6065969432243145 against the
tear sheet's 0.6077780920358564). The compare chart keeps its flat points on those sessions. An account whose
equity reaches zero cannot compound, so its Sharpe and drawdown are null with the reason (the probe runs showed
0.2785 from returns of about +/-1,300).
"""
from __future__ import annotations

import math
from functools import lru_cache

import pytest

from nq_lab.config import ROOT
from nq_terminal.analytics import drawdown, perf, series
from nq_terminal.services.research import ResearchService

from test_runs_support import RUNS, FakeClock, copy_root, service

ZA, SIZED, OVERNIGHT = RUNS["za_orb"], RUNS["sized"], RUNS["overnight"]
PROBE = "nt_volmanaged_v0_final_probe_2012-02-16"


@lru_cache(maxsize=1)
def real_runs():
    return service(ROOT, clock=FakeClock())


def _tear_sheet_numbers(runs, research, run_id: str) -> tuple[float, float]:
    r = series.run_series(runs, research, run_id).r
    return perf.sharpe(r, 252), -drawdown.max_drawdown(r, "B")


@pytest.mark.parametrize("run_id", ["nt_za_v0_repaired_a", "nt_overnight_v0_open_a", "nt_volmanaged_v0_final_m1"])
def test_real_compare_numbers_equal_the_tear_sheet(run_id):
    other = "nt_dtsmom_v0_ts1"
    stats = {s.run_id: s for s in real_runs().compare([run_id, other]).stats}
    sharpe, depth = _tear_sheet_numbers(real_runs(), ResearchService(ROOT), run_id)
    assert stats[run_id].sharpe == sharpe and stats[run_id].max_drawdown == depth
    assert stats[run_id].stats_note is None


def test_za_compare_sharpe_is_the_gated_one():
    stats = real_runs().compare(["nt_za_v0_repaired_a", "nt_dtsmom_v0_ts1"]).stats[0]
    assert stats.sharpe == pytest.approx(0.6077780920358564, rel=1e-12)  # not 0.6065969432243145 (zero days)


def test_a_probe_has_no_compare_sharpe_and_says_why():
    stats = {s.run_id: s for s in real_runs().compare([PROBE, "nt_volmanaged_v0_final_m1"]).stats}[PROBE]
    assert stats.sharpe is None and stats.max_drawdown is None
    assert "not compoundable" in stats.stats_note and "first 2012-02-17" in stats.stats_note
    assert stats.total_return is not None  # the balance itself is still reported


def test_real_anchor_sharpe_is_the_tear_sheet_sharpe():
    anchor = real_runs().anchor("nt_za_v0_repaired_a_haltfix_r1")
    sharpe, _ = _tear_sheet_numbers(real_runs(), ResearchService(ROOT), "nt_za_v0_repaired_a_haltfix_r1")
    assert anchor.sharpe_anchor == sharpe and anchor.verdict == "IDENTICAL"


def test_fixture_compare_uses_the_gated_series(tmp_path):
    root = copy_root(tmp_path)
    runs = service(root)
    stats = {s.run_id: s for s in runs.compare([ZA, SIZED, OVERNIGHT]).stats}
    for run_id in (ZA, SIZED, OVERNIGHT):
        sharpe, depth = _tear_sheet_numbers(runs, ResearchService(root), run_id)
        assert stats[run_id].sharpe == sharpe and stats[run_id].max_drawdown == depth, run_id
        assert math.isfinite(stats[run_id].sharpe)


def test_without_the_gated_sessions_there_is_no_za_sharpe(tmp_path):
    """Born failing: without the rejected-days file the gated sessions are unknown, so no number is shown."""
    root = copy_root(tmp_path, session_qa=False)
    stats = {s.run_id: s for s in service(root).compare([ZA, SIZED]).stats}
    assert stats[ZA].sharpe is None and "rejected-days" in stats[ZA].stats_note
    assert stats[SIZED].sharpe is not None
