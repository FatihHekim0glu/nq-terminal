"""LV5 paper against model tracking (TASKS 10.4; ANALYTICS_CATALOG LV5).

Daily paper P&L = the contracts actually held after the previous close row x the change of each contract's close to
this close row x the multiplier; the model's = the rule's target contracts on the previous row's contract over the
same closes. Plumbing rows never reach it (the caller passes performance rows; a plumbing row is refused here too).
"""
from __future__ import annotations

import math

import pytest

from nq_terminal.analytics import tracking

MULT = 2.0


def close(date, target, actual, px, contract="MNQZ6.CME", **extra):
    return {"type": "close", "date": date, "contract": contract, "target": target, "actual": actual,
            "close_px_by_contract": px, **extra}


ROWS = [
    close("2026-09-28", 6, {"MNQZ6.CME": 6}, {"MNQZ6.CME": 24851.0}),
    close("2026-09-29", 7, {"MNQZ6.CME": 6}, {"MNQZ6.CME": 24901.0}),  # held 6 and target 6: 6 x 50 x 2 = 600 each
    close("2026-09-30", 7, {"MNQZ6.CME": 7}, {}),  # no close price: both null
    close("2026-10-01", 5, {"MNQZ6.CME": 5}, {"MNQZ6.CME": 24881.0}),  # from 24901 (09-29) held 6, target 7
    close("2026-10-02", 5, {"MNQZ6.CME": 4}, {"MNQZ6.CME": 24891.0}),  # held 5, target 5: 5 x 10 x 2 = 100 each
    close("2026-10-05", 5, {"MNQZ6.CME": 5}, {"MNQZ6.CME": 24896.0}),  # held 4 x 5 x 2 = 40, target 5 x 5 x 2 = 50
]


def test_paper_and_model_pnl_by_hand():
    # 09-30 has no close price, so 09-30 and 10-01 (whose previous close row is 09-30) are both null: a move is never
    # attributed across a missing close
    found = tracking.paper_tracking(ROWS, MULT)
    assert found["date"] == ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"]
    assert found["paper"] == [600.0, None, None, 100.0, 40.0]
    assert found["model"] == [600.0, None, None, 100.0, 50.0]
    assert found["difference"] == [0.0, None, None, 0.0, -10.0]
    assert found["paper_cumulative"] == [600.0, None, None, 700.0, 740.0]
    assert found["model_cumulative"][-1] == 750.0
    assert found["n"] == 3 and found["total_difference"] == -10.0
    diffs = [0.0, 0.0, -10.0]
    mean = sum(diffs) / 3
    assert found["tracking_sd"] == pytest.approx(math.sqrt(sum((d - mean) ** 2 for d in diffs) / 2), rel=1e-12)


def test_a_roll_uses_each_contracts_own_close():
    rows = [close("2026-12-07", 6, {"MNQZ6.CME": 6}, {"MNQZ6.CME": 100.0, "MNQH7.CME": 110.0}),
            close("2026-12-08", 6, {"MNQH7.CME": 6}, {"MNQZ6.CME": 101.0, "MNQH7.CME": 112.0}, contract="MNQH7.CME")]
    found = tracking.paper_tracking(rows, MULT)
    assert found["paper"] == [6 * 1.0 * MULT] and found["model"] == [6 * 1.0 * MULT]


def test_plumbing_rows_are_refused():
    with pytest.raises(tracking.TrackingError, match="plumbing"):
        tracking.paper_tracking([dict(ROWS[0], strategy_performance=False), ROWS[1]], MULT)


def test_non_close_rows_are_skipped_and_one_row_gives_nothing():
    found = tracking.paper_tracking([ROWS[0], {"type": "skipped", "date": "2026-09-29"}], MULT)
    assert found["n"] == 0 and found["date"] == [] and math.isnan(found["tracking_sd"])
