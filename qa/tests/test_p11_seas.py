"""Tests for the SEAS reference (TASKS Phase 11). In memory only: hand values and born-failing cases."""
from __future__ import annotations

import datetime as dt
import math

import pytest

from crosscheck.p11_seas import bucket_returns, heatmap_flat, monthly, seasonality_references

DATES = ["2020-01-02", "2020-01-03", "2020-01-06", "2020-02-03", "2021-01-04", "2021-01-29"]
R = [0.01, -0.02, 0.03, None, 0.02, 0.0]


def refs(aggregation: str = "compound", bars: dict | None = None) -> dict:
    inputs = {"dates": DATES, "r": R, "aggregation": aggregation}
    if bars is not None:
        inputs["bars"] = bars
    return {k: v.value for k, v in seasonality_references(inputs).items()}


def test_weekday_groups_by_hand():
    out = refs()
    # Mon: 2020-01-06 (0.03), 2020-02-03 (null, dropped), 2021-01-04 (0.02); Thu 0.01; Fri -0.02 and 0.0
    assert out["weekday_n"] == [2.0, 0.0, 0.0, 1.0, 2.0]
    assert out["weekday_mean"][0] == pytest.approx(0.025, rel=1e-15)
    assert out["weekday_se"][0] == pytest.approx(math.sqrt(0.00005) / math.sqrt(2), rel=1e-12)
    assert out["weekday_hit"][4] == 0.0 and out["weekday_se"][3] is None and out["weekday_mean"][1] is None


def test_week_of_month_groups_by_hand():
    out = refs()
    # day 29 is week 5; days 2, 3, 4, 6 are week 1
    assert out["week_of_month_n"] == [4.0, 0.0, 0.0, 0.0, 1.0]
    assert out["week_of_month_mean"][4] == 0.0 and out["week_of_month_hit"][4] == 0.0


def test_months_compound_or_sum_and_one_value_per_year():
    compound, summed = refs("compound"), refs("sum")
    jan_2020 = 1.01 * 0.98 * 1.03 - 1
    assert compound["month_n"][0] == 2.0 and compound["month_n"][1] == 0.0
    assert compound["month_mean"][0] == pytest.approx((jan_2020 + 0.02) / 2, rel=1e-12)
    assert summed["month_mean"][0] == pytest.approx((0.02 + 0.02) / 2, rel=1e-12)
    # born failing: compounding and summing give different January values
    assert compound["month_mean"][0] != pytest.approx(summed["month_mean"][0], rel=1e-9)


def test_heatmap_is_flattened_years_by_months():
    flat = heatmap_flat(monthly([(dt.date(2019, 12, 2), 0.1),
                                 (dt.date(2020, 2, 3), 0.2)], "sum"))
    assert len(flat) == 24 and flat[11] == 0.1 and flat[13] == 0.2 and flat[12] is None


def test_unknown_aggregation_is_refused():
    with pytest.raises(ValueError):
        monthly([], "mean")


BARS = {
    "ts": ["2021-06-01T13:30:00Z", "2021-06-01T13:59:00Z", "2021-06-01T14:00:00Z", "2021-06-01T13:29:00Z",
           "2021-06-02T19:59:00Z"],
    "o": [1100.0, 1101.0, 1102.0, 5.0, 10.0],
    "c": [1101.0, 1102.0, 1100.0, 6.0, 12.0],
    "raw_c": [1001.0, 1002.0, 1000.0, 6.0, 12.0],
    "sessions": [{"date": "2021-06-01", "open_utc": "2021-06-01T13:30:00Z", "close_utc": "2021-06-01T20:00:00Z"},
                 {"date": "2021-06-02", "open_utc": "2021-06-02T13:30:00Z", "close_utc": "2021-06-02T20:00:00Z"}],
}


def test_bucket_returns_use_the_raw_close_and_drop_bars_outside_the_session():
    got = sorted(bucket_returns(BARS))
    assert [k for k, _ in got] == [0, 1, 12]
    assert got[0][1] == pytest.approx(2.0 / (1002.0 - 2.0), rel=1e-15)
    assert got[2][1] == pytest.approx(2.0 / (12.0 - 2.0), rel=1e-15)
    # born failing: the percent change of the back-adjusted series is another number
    assert got[0][1] != pytest.approx(1102.0 / 1100.0 - 1, rel=1e-9)


def test_intraday_refs_appear_only_with_bars():
    assert "intraday_n" not in refs()
    out = refs(bars=BARS)
    assert len(out["intraday_n"]) == 13 and out["intraday_n"][0] == 1.0 and out["intraday_n"][2] == 0.0


REBUILT = {
    "ts": ["2021-06-01T13:30:00Z", "2021-06-01T13:31:00Z", "2021-06-02T13:30:00Z", "2021-06-02T13:31:00Z"],
    "o": [1100.0, 1101.0, 1102.0, 1103.0],
    "c": [1101.0, 1102.0, 1103.0, 1104.0],
    "raw_c": [1001.0, 1002.0, None, None],  # the second session was rebuilt from trades: no raw close stored
    "offset": [100.0, 100.0, None, None],
    "instrument_id": [7, 7, 7, 7],
    "sessions": BARS["sessions"],
}


def test_a_rebuilt_bar_takes_its_raw_close_from_the_contracts_one_offset():
    got = sorted(v for _, v in bucket_returns(REBUILT))
    assert got == pytest.approx([2.0 / (1004.0 - 2.0), 2.0 / (1002.0 - 2.0)], rel=1e-15)


def test_born_failing_without_an_offset_the_rebuilt_session_drops():
    bare = {**REBUILT, "offset": [None] * 4}
    assert len(bucket_returns(bare)) == 1
    two = {**REBUILT, "offset": [100.0, 101.0, None, None]}  # two offsets on one contract: not derived
    assert len(bucket_returns(two)) == 1
