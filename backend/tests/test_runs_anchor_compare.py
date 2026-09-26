"""Anchor verdicts need values on both sides (rule 3 and 4), and the compare view rebases at K (C1).

- Two unusable runs have no Sharpe; `None == None` must not read as an exact match, so the pair is
  NOT COMPARABLE, never IDENTICAL.
- Missing `n_trades`, `pnl_total` or `fees_total` on both sides is not equality either.
- The rebased compare line starts at 1.0 on the day before the first session and divides by the starting
  balance K, so its last point equals 1 + total_return exactly.
"""
from __future__ import annotations

import copy

import pytest

from test_runs_support import RUNS, add_run, copy_root, result_doc, service

ZA, SIZED, BOOK = RUNS["za_orb"], RUNS["sized"], RUNS["dtsmom"]
BASE, ANCHOR = "x_a", "x_a_regress_r1"


@pytest.fixture
def root(tmp_path):
    return copy_root(tmp_path)


def _pair(root, mutate) -> None:
    doc = copy.deepcopy(result_doc(ZA))
    mutate(doc)
    add_run(root, BASE, doc)
    add_run(root, ANCHOR, doc, {"regress_check.json": {"old": BASE, "new": ANCHOR, "identical": True}})


def _unbalance(doc: dict) -> None:
    doc["balance_check"]["ok"] = False


def _drop_counts(doc: dict) -> None:
    for key in ("n_trades", "pnl_total", "fees_total"):
        doc.pop(key)


def test_two_unusable_runs_are_not_comparable(root):
    _pair(root, _unbalance)
    cmp = service(root).anchor(ANCHOR)
    assert cmp.sharpe_anchor is None and cmp.sharpe_base is None
    assert cmp.sharpe_equal is False
    assert cmp.verdict == "NOT COMPARABLE"


def test_missing_counts_on_both_sides_are_not_equal(root):
    _pair(root, _drop_counts)
    cmp = service(root).anchor(ANCHOR)
    assert (cmp.n_trades_equal, cmp.pnl_total_equal, cmp.fees_total_equal) == (False, False, False)
    assert cmp.verdict == "NOT COMPARABLE"


def test_a_whole_pair_is_still_identical(root):
    _pair(root, lambda doc: None)
    assert service(root).anchor(ANCHOR).verdict == "IDENTICAL"


@pytest.mark.parametrize("run_id", [SIZED, BOOK, ZA])
def test_the_rebased_line_ends_at_one_plus_total_return(root, run_id):
    cmp = service(root).compare([run_id, ZA if run_id != ZA else SIZED])
    series = {s.run_id: s for s in cmp.series}[run_id]
    stats = {s.run_id: s for s in cmp.stats}[run_id]
    values = [v for v in series.rebased if v is not None]
    assert values[0] == 1.0
    assert values[-1] == pytest.approx(1.0 + stats.total_return, rel=0, abs=1e-12)


def test_trades_carry_epoch_seconds_for_chart_axes(root):
    """ARCHITECTURE s3.7: charts take integer epoch seconds; trades had ISO strings only."""
    from datetime import datetime

    page = service(root).trades(ZA)
    assert page.items
    for row in page.items:
        for key in ("entry_ts", "exit_ts"):
            stamp = getattr(row, key)
            expected = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()) if stamp else None
            assert getattr(row, f"{key}_epoch_s") == expected
