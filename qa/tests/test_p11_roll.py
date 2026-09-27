"""Tests for the ROLL reference (TASKS Phase 11; ANALYTICS MV2). Everything is built in memory: no file writes.

The dump format is the `roll` bundle the backend's `test_dump_for_qa_p11_roll.py` writes: `inputs` holds one
market's served 1d rows (`dates`, `t`, `instrument_id`, `offset`, `c_none`, and `qa_rolls_total` from the universe
QA report or null), `values.ours` the calendar the terminal serves. The comparison goes through the crosscheck's own
row logic (`compare._rows_for`), so wiring `roll` into `BUNDLE_REFERENCES` needs no other change.
"""
from __future__ import annotations

import math

import pytest

from crosscheck import compare
from crosscheck.compare import FAIL, PASS
from crosscheck.p11_roll import BUNDLE_INPUTS, roll_references

DATES = ["2021-03-09", "2021-03-10", "2021-03-11", "2021-03-12", "2021-06-10", "2021-06-11", "2022-01-03"]
T = [1615248000, 1615334400, 1615420800, 1615507200, 1623283200, 1623369600, 1641168000]
IDS = [11, 11, 12, 12, 12, 13, 14]
OFFSET = [2.5, 2.5, 1.0, 1.0, 1.0, 0.0, -9.0]
C_NONE = [100.0, 101.0, 102.5, 103.0, 104.0, 105.0, 106.0]


def inputs(**extra) -> dict:
    base = {"dates": DATES, "t": T, "instrument_id": IDS, "offset": OFFSET, "c_none": C_NONE, "qa_rolls_total": None}
    return {**base, **extra}


def values_of(refs: dict) -> dict:
    return {key: ref.value for key, ref in refs.items() if not ref.against}


def test_bundle_inputs_name_every_key_the_reference_reads():
    assert set(BUNDLE_INPUTS) == set(inputs())


def test_rolls_are_instrument_changes_with_offset_gaps_over_the_raw_close_before():
    refs = values_of(roll_references(inputs()))
    assert refs["count"] == 2  # the 2022 bar is past the fence and never becomes a roll
    assert refs["t"] == [1615420800, 1623369600]
    assert refs["from_id"] == [11, 12] and refs["to_id"] == [12, 13]
    assert refs["gap_pts"] == [-1.5, -1.0]
    assert refs["gap_pct"] == pytest.approx([100 * -1.5 / 101.0, 100 * -1.0 / 104.0], rel=1e-15)
    assert refs["close_before"] == [101.0, 104.0]
    assert refs["per_year"] == {"2021": 2}


def test_born_failing_a_gap_over_the_back_adjusted_close_is_caught():
    """The check can fail: dividing by the back-adjusted close before the roll (c_none + offset) gives other values."""
    refs = roll_references(inputs())
    wrong = [100 * -1.5 / (101.0 + 2.5), 100 * -1.0 / (104.0 + 1.0)]
    [row] = compare._rows_for("hand", "gap_pct", refs["gap_pct"], {"ours": {"gap_pct": wrong}}, {})
    assert row.status == FAIL


def test_born_failing_a_leaked_2022_roll_is_caught():
    refs = roll_references(inputs())
    leaked = {"count": 3, "t": [1615420800, 1623369600, 1641168000]}
    rows = [row for key in leaked for row in compare._rows_for("hand", key, refs[key], {"ours": leaked}, {})]
    assert {row.status for row in rows} == {FAIL}


def test_the_terminal_values_pass_through_the_crosscheck_rows():
    refs = roll_references(inputs())
    ours = values_of(refs)
    rows = [row for key, ref in refs.items() for row in compare._rows_for("hand", key, ref, {"ours": ours}, {})]
    assert rows and {row.status for row in rows} == {PASS}


def test_a_zero_or_missing_close_gives_no_percent_gap():
    closes = [100.0, 0.0, 102.5, 103.0, None, 105.0, 106.0]
    refs = values_of(roll_references(inputs(c_none=closes)))
    assert refs["gap_pct"] == [None, None] and refs["close_before"] == [0.0, None]
    assert all(v is None or math.isfinite(v) for v in refs["gap_pts"])


def test_unsorted_rows_are_put_in_time_order_first():
    order = [3, 0, 5, 1, 4, 2, 6]
    shuffled = {k: [v[i] for i in order] for k, v in
                {"dates": DATES, "t": T, "instrument_id": IDS, "offset": OFFSET, "c_none": C_NONE}.items()}
    assert values_of(roll_references(inputs(**shuffled))) == values_of(roll_references(inputs()))


def test_the_qa_report_count_is_compared_with_the_terminal_count():
    refs = roll_references(inputs(qa_rolls_total=2))
    ref = refs["count_vs_qa_report"]
    assert ref.against == "count" and ref.value == 2
    [ok] = compare._rows_for("hand", "count_vs_qa_report", ref, {"ours": {"count": 2}}, {})
    [bad] = compare._rows_for("hand", "count_vs_qa_report", ref, {"ours": {"count": 3}}, {})
    assert (ok.status, bad.status) == (PASS, FAIL)
    assert "count_vs_qa_report" not in roll_references(inputs())


def test_a_market_with_one_contract_has_no_rolls():
    refs = values_of(roll_references(inputs(instrument_id=[11] * len(IDS))))
    assert refs["count"] == 0 and refs["t"] == [] and refs["per_year"] == {}
