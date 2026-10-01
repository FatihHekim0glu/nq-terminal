"""MV6 term structure (TASKS Phase 12; ANALYTICS_CATALOG section 11). Pure analytics, no gate.

The front (C.0) and next (C.1) calendar-chain contracts on the same session, with the lab's pinned CME last trading
days (`nq_lab.carry_expiry`): carry = (F1 - F2) / (F2 x tau), tau = days between the two expiries / 365.25, positive
in backwardation (the carry_v0 formula, `nq_lab.carry_signal.carry_value`). The NQ expiries below are written out by
hand (the third Friday of the contract month), an independent check on the table.
"""
from __future__ import annotations

import datetime as dt
import math

import pandas as pd
import pytest

from nq_lab import carry_signal
from nq_terminal.analytics import term_structure as ts

EXPIRY = {"NQH2015": dt.date(2015, 3, 20), "NQM2015": dt.date(2015, 6, 19), "NQU2015": dt.date(2015, 9, 18),
          "NQZ2015": dt.date(2015, 12, 18)}


def chain(rows: list[tuple[str, str, float, float]], *, h_pad: float = 1.0) -> pd.DataFrame:
    """(date, contract, close, volume) rows as a served chain frame."""
    return pd.DataFrame({"ts": pd.to_datetime([r[0] for r in rows], utc=True),
                         "o": [r[2] for r in rows], "h": [r[2] + h_pad for r in rows], "l": [r[2] - h_pad for r in rows],
                         "c": [r[2] for r in rows], "v": [r[3] for r in rows],
                         "instrument_id": list(range(len(rows))), "contract": [r[1] for r in rows]})


C0 = chain([("2015-01-05", "NQH2015", 4100.0, 300_000), ("2015-01-06", "NQH2015", 4050.0, 280_000),
            ("2015-01-07", "NQH2015", 4080.0, 5), ("2015-01-08", "", 4090.0, 250_000),
            ("2015-01-09", "NQH2015", 4070.0, 260_000), ("2015-01-13", "NQH2015", 4075.0, 255_000),
            ("2015-03-16", "NQM2015", 4400.0, 290_000), ("2022-01-03", "NQH2022", 16000.0, 300_000)])
C1 = chain([("2015-01-05", "NQM2015", 4090.0, 2_000), ("2015-01-06", "NQM2015", 4062.0, 1_500),
            ("2015-01-07", "NQM2015", 4072.0, 1_200), ("2015-01-08", "NQM2015", 4081.0, 1_100),
            ("2015-01-12", "NQM2015", 4060.0, 1_000), ("2015-01-13", "NQH2015", 4075.0, 1_000),
            ("2015-03-16", "NQU2015", 4410.0, 9_000), ("2022-01-03", "NQM2022", 16010.0, 3_000)])


def test_contract_keys_parse_to_their_month():
    assert ts.contract_month("NQH2015", "NQ") == (2015, 3)
    assert ts.contract_month("6EZ2019", "6E") == (2019, 12)
    assert ts.contract_month("ESH2015", "NQ") is None and ts.contract_month("", "NQ") is None
    assert ts.contract_month("NQH15", "NQ") is None


def test_the_pinned_table_gives_the_third_friday_for_nq():
    for key, day in EXPIRY.items():
        assert ts.expiry_of(key, "NQ") == day


def test_carry_is_the_front_to_next_spread_annualised_by_the_days_between_expiries():
    found = ts.front_next(C0, C1, "NQ")
    first = found["rows"][0]
    tau = (EXPIRY["NQM2015"] - EXPIRY["NQH2015"]).days / 365.25
    assert first["date"] == "2015-01-05" and (first["front"], first["next"]) == ("NQH2015", "NQM2015")
    assert first["spread"] == pytest.approx(10.0) and first["tau_years"] == pytest.approx(tau, rel=1e-15)
    assert first["carry"] == pytest.approx(10.0 / (4090.0 * tau), rel=1e-12)
    assert first["carry"] > 0  # the front above the next: backwardation
    assert first["t"] == int(pd.Timestamp("2015-01-05", tz="UTC").timestamp())
    second = found["rows"][1]
    assert second["spread"] == pytest.approx(-12.0) and second["carry"] < 0  # the next above the front: contango


def test_born_failing_months_between_contracts_give_another_tau():
    """The check above can fail: tau as three contract months (0.25) instead of the days between expiries."""
    found = ts.front_next(C0, C1, "NQ")
    first = found["rows"][0]
    assert not math.isclose(first["carry"], 10.0 / (4090.0 * 0.25), rel_tol=1e-9)


def test_the_terminal_agrees_with_the_lab_carry_value():
    found = ts.front_next(C0, C1, "NQ")
    for row in found["rows"]:
        want = carry_signal.carry_value(row["f1"], row["f2"], dt.date.fromisoformat(row["expiry_front"]),
                                        dt.date.fromisoformat(row["expiry_next"]))
        assert row["carry"] == pytest.approx(want, rel=1e-15)


def test_sessions_that_cannot_be_priced_are_void_and_counted():
    found = ts.front_next(C0, C1, "NQ")
    assert [r["date"] for r in found["rows"]] == ["2015-01-05", "2015-01-06", "2015-03-16"]
    assert found["void"] == {"missing_front": 1, "missing_next": 1, "unresolved": 1, "order": 1, "thin": 1,
                             "price": 0}
    assert found["sessions"] == 8 and found["fenced"] == 2


def test_the_fence_drops_rows_on_or_after_2022():
    found = ts.front_next(C0, C1, "NQ")
    assert all(r["date"] < "2022-01-01" for r in found["rows"])


def test_a_next_leg_at_or_below_zero_is_void():
    c0 = chain([("2020-04-20", "CLK2020", -37.63, 200_000)])
    c1 = chain([("2020-04-20", "CLM2020", 0.0, 150_000)])
    found = ts.front_next(c0, c1, "CL")
    assert found["rows"] == [] and found["void"]["price"] == 1


def test_a_negative_front_with_a_positive_next_is_defined():
    c0 = chain([("2020-04-20", "CLK2020", -37.63, 200_000)])
    c1 = chain([("2020-04-20", "CLM2020", 20.43, 150_000)])
    (row,) = ts.front_next(c0, c1, "CL")["rows"]
    assert row["carry"] < 0 and math.isfinite(row["carry"])


def test_summary_of_the_carry_series():
    found = ts.front_next(C0, C1, "NQ")
    carry = [r["carry"] for r in found["rows"]]
    s = ts.summary(found["rows"])
    assert s["n"] == 3 and s["mean"] == pytest.approx(sum(carry) / 3, rel=1e-12)
    assert s["min"] == min(carry) and s["max"] == max(carry)
    assert s["share_backwardation"] == pytest.approx(sum(c > 0 for c in carry) / 3)
    assert (s["last_date"], s["last"]) == ("2015-03-16", carry[-1])


def test_summary_of_no_rows_is_empty():
    s = ts.summary([])
    assert s["n"] == 0 and math.isnan(s["mean"]) and s["last_date"] is None


def test_the_latest_curve_lists_each_rank_on_the_last_front_session():
    c2 = chain([("2015-03-16", "NQZ2015", 4420.0, 50)])
    curve = ts.latest_curve({0: C0, 1: C1, 2: c2}, "NQ")
    assert curve["date"] == "2015-03-16"
    assert [(r["rank"], r["contract"], r["close"]) for r in curve["rows"]] == [
        (0, "NQM2015", 4400.0), (1, "NQU2015", 4410.0), (2, "NQZ2015", 4420.0)]
    assert [r["expiry"] for r in curve["rows"]] == ["2015-06-19", "2015-09-18", "2015-12-18"]
    assert curve["rows"][2]["days_to_expiry"] == (dt.date(2015, 12, 18) - dt.date(2015, 3, 16)).days
    assert curve["missing"] == []


def test_the_latest_curve_without_a_front_is_empty():
    curve = ts.latest_curve({1: C1}, "NQ")
    assert curve["date"] is None and curve["rows"] == []
