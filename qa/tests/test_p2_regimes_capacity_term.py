"""Tests for the RG2, EX5 and MV6 references (TASKS Phase 12). Everything is built in memory: no file writes.

Each reference is checked against numbers written by hand, and each comparison has a born-failing case: a wrong
terminal value (a label from the session's own close, a fill grouped by its UTC date, a carry annualised by contract
months) must FAIL through the crosscheck's own row logic (`compare._rows_for`).
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pytest

from crosscheck.compare import FAIL, PASS, _rows_for
from crosscheck.p2_regimes_capacity_term import (
    P2_RCT_INPUTS,
    P2_RCT_REFERENCES,
    Calendar,
    capacity_references,
    expiry_references,
    last_trading_day,
    term_references,
    trend_labels,
    trend_references,
)

HOLIDAYS_2015 = {"2015-01-01", "2015-01-19", "2015-02-16", "2015-04-03", "2015-05-25", "2015-07-03", "2015-09-07",
                 "2015-11-26", "2015-12-25", "2016-01-01"}


def nyse_2015() -> list[str]:
    day, out = dt.date(2014, 12, 1), []
    while day <= dt.date(2016, 2, 29):
        if day.weekday() < 5 and day.isoformat() not in HOLIDAYS_2015:
            out.append(day.isoformat())
        day += dt.timedelta(days=1)
    return out


def statuses(kind: str, inputs: dict, ours: dict) -> dict:
    refs = P2_RCT_REFERENCES[kind](inputs)
    rows = [row for key, ref in refs.items() for row in _rows_for("case", key, ref, {"ours": ours}, {})]
    return {row.metric: row.status for row in rows}


def test_every_kind_declares_its_inputs_and_reference():
    assert set(P2_RCT_INPUTS) == set(P2_RCT_REFERENCES) == {"p2trend", "p2capacity", "p2term", "p2expiry"}


# ---------------------------------------------------------------- the expiry rules


@pytest.mark.parametrize(("root", "year", "month", "want"), [
    ("NQ", 2015, 3, "2015-03-20"),   # third Friday
    ("ZN", 2015, 3, "2015-03-20"),   # 7 business days before the last one (31 March)
    ("6E", 2015, 3, "2015-03-16"),   # 2 business days before the third Wednesday (18 March)
    ("6C", 2015, 3, "2015-03-17"),   # 1 business day before it
    ("CL", 2015, 12, "2015-11-20"),  # 3 business days before 25 November
    ("NG", 2016, 1, "2015-12-29"),   # 3 business days before 1 January
    ("HO", 2016, 1, "2015-12-31"),   # the last business day of the month before
    ("GC", 2015, 12, "2015-12-29"),  # the third-last business day
    ("ZC", 2015, 3, "2015-03-13"),   # the business day before the 15th
    ("HE", 2015, 12, "2015-12-14"),  # the tenth business day
    ("ZT", 2015, 12, "2015-12-31"),  # the last business day
])
def test_rules_give_the_published_last_trading_days(root, year, month, want):
    assert last_trading_day(Calendar(nyse_2015()), root, year, month).isoformat() == want


def test_the_cl_rule_steps_back_one_more_day_when_the_25th_is_not_a_business_day():
    # CLF2016: 25 December 2015 is a holiday, so 4 business days before it (24, 23, 22, 21 December)
    assert last_trading_day(Calendar(nyse_2015()), "CL", 2016, 1).isoformat() == "2015-12-21"


def test_expiry_words_compare_exactly_and_a_wrong_day_fails():
    inputs = {"contracts": [["NQ", 2015, 3], ["CL", 2015, 12]], "business_days": nyse_2015()}
    assert expiry_references(inputs)["expiries"].value == ["2015-03-20", "2015-11-20"]
    good = statuses("p2expiry", inputs, {"expiries": ["2015-03-20", "2015-11-20"], "count": 2})
    bad = statuses("p2expiry", inputs, {"expiries": ["2015-03-20", "2015-11-19"], "count": 2})
    assert good["expiries"] == PASS and bad["expiries"] == FAIL


# ---------------------------------------------------------------- RG2


def trend_inputs() -> dict:
    close_dates = [f"2015-01-{d:02d}" for d in range(1, 11)]
    close = [10.0, 11.0, 12.0, 11.0, 10.0, 9.0, 12.0, 13.0, None, 14.0]
    dates = [f"2015-01-{d:02d}" for d in range(3, 13)]
    r = [0.01, -0.02, 0.0, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02, 0.01]
    return {"dates": dates, "r": r, "close_dates": close_dates, "close": close, "window": 3, "periods": 252}


def test_trend_labels_use_the_close_and_mean_before_each_session():
    # mean(10, 11, 12) = 11 at 01-03, so 01-04 sees 12 > 11: above; the hole at 01-09 blanks 01-10 to 01-12
    assert trend_labels(trend_inputs()) == [None, "above", "below", "below", "below", "above", "above", None, None,
                                            None]


def test_born_failing_labels_from_the_session_own_close_fail():
    inputs = trend_inputs()
    right = ["none" if x is None else x for x in trend_labels(inputs)]
    wrong = [None, "below", "below", "below", "below", "above", "above", None, None, None]  # 01-04 against its own mean
    wrong = ["none" if x is None else x for x in wrong]
    assert statuses("p2trend", inputs, {"labels": right})["labels"] == PASS
    assert statuses("p2trend", inputs, {"labels": wrong})["labels"] == FAIL


def test_trend_statistics_by_hand():
    refs = trend_references(trend_inputs())
    above = np.array([-0.02, 0.02, 0.01])
    assert refs["above_n"].value == 3 and refs["above_mean"].value == pytest.approx(above.mean())
    assert refs["above_sharpe"].value == pytest.approx(above.mean() / above.std(ddof=1) * math.sqrt(252))
    assert refs["below_hit_rate"].value == pytest.approx(1 / 2)  # 0.0, 0.03, -0.01: one of two non-zero
    assert refs["unlabelled"].value == 4


# ---------------------------------------------------------------- EX5


def capacity_inputs() -> dict:
    midnight = int(dt.datetime(2012, 1, 4, tzinfo=dt.timezone.utc).timestamp())  # evening of 3 January in New York
    close = int(dt.datetime(2012, 1, 4, 21, tzinfo=dt.timezone.utc).timestamp())
    return {"legs": [["ES", midnight, 10, 1.0], ["ES", close, 4, 1.0], ["NQ", close, 100, 0.1], [None, close, 5, 1.0]],
            "volume": {"ES": {"2012-01-03": 1000.0, "2012-01-04": 400.0}, "NQ": {"2012-01-04": 0.0}}}


def test_capacity_by_hand():
    refs = capacity_references(capacity_inputs())
    assert refs["ES.sessions"].value == 2 and refs["ES.contracts_total"].value == 14
    assert refs["ES.ratio_mean"].value == pytest.approx((10 / 1000 + 4 / 400) / 2)
    assert refs["ES.ratio_max"].value == pytest.approx(0.01) and refs["ES.ratio_max_session"].value == ["2012-01-03"]
    assert refs["NQ.void"].value == 1 and math.isnan(refs["NQ.ratio_max"].value)  # a volume of zero is void
    assert refs["max_ratio"].value == pytest.approx(0.01)


def test_born_failing_a_fill_grouped_by_its_utc_date_fails():
    """At 00:00 UTC the fill belongs to 3 January in New York; on 4 January its ratio would be 10/400."""
    inputs = capacity_inputs()
    right = {"ES.ratio_mean": (10 / 1000 + 4 / 400) / 2}
    wrong = {"ES.ratio_mean": 14 / 400}
    assert statuses("p2capacity", inputs, right)["ES.ratio_mean"] == PASS
    assert statuses("p2capacity", inputs, wrong)["ES.ratio_mean"] == FAIL


# ---------------------------------------------------------------- MV6


def leg(rows: list[tuple]) -> dict:
    return {"dates": [r[0] for r in rows], "c": [r[1] for r in rows], "v": [r[2] for r in rows],
            "h": [r[1] + 1 for r in rows], "l": [r[1] - 1 for r in rows], "contract": [r[3] for r in rows]}


def term_inputs() -> dict:
    front = leg([("2015-01-05", 4100.0, 1e5, "NQH2015"), ("2015-01-06", 4050.0, 5, "NQH2015"),
                 ("2015-01-07", 4000.0, 1e5, ""), ("2022-01-03", 16000.0, 1e5, "NQH2022")])
    nxt = leg([("2015-01-05", 4090.0, 2e3, "NQM2015"), ("2015-01-06", 4040.0, 2e3, "NQM2015"),
               ("2015-01-07", 3990.0, 2e3, "NQM2015"), ("2015-01-08", 3980.0, 2e3, "NQM2015"),
               ("2022-01-03", 16010.0, 2e3, "NQM2022")])
    return {"root": "NQ", "front": front, "next": nxt, "business_days": nyse_2015()}


def test_term_carry_by_hand():
    refs = term_references(term_inputs())
    tau = (dt.date(2015, 6, 19) - dt.date(2015, 3, 20)).days / 365.25
    assert refs["date"].value == ["2015-01-05"]
    assert refs["carry"].value == [pytest.approx(10.0 / (4090.0 * tau))]
    assert refs["void"].value == {"missing_front": 1.0, "missing_next": 0.0, "unresolved": 1.0, "order": 0.0,
                                  "thin": 1.0, "price": 0.0}


def test_born_failing_a_carry_annualised_by_contract_months_fails():
    inputs = term_inputs()
    tau = (dt.date(2015, 6, 19) - dt.date(2015, 3, 20)).days / 365.25
    assert statuses("p2term", inputs, {"carry": [10.0 / (4090.0 * tau)]})["carry"] == PASS
    assert statuses("p2term", inputs, {"carry": [10.0 / (4090.0 * 0.25)]})["carry"] == FAIL
