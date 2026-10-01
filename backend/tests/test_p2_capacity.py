"""EX5 capacity (TASKS Phase 12; ANALYTICS_CATALOG section 9). Pure analytics, no gate.

Contracts traded per session over the session's volume. A fill belongs to the New York date of its time stamp (the
daily books stamp fills at 00:00 UTC, the evening of the session in New York); the volume is the vendor 1d bar of the
instrument's continuous series dated on that session. A micro contract counts in full contracts of its parent (MNQ is a
tenth of NQ); a per-contract name (eomtsy's ZTU2010) counts against its root's continuous series. Runs without fills
count one contract at the entry and one at the exit of each trade, as EX3 counts their sides.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import capacity

ROOTS = frozenset({"NQ", "ES", "ZT", "ZN"})
FULL = {"NQ": 20.0, "ES": 50.0, "ZT": 2000.0, "ZN": 1000.0}


def fill(ts: str, qty: float, side: str = "BUY", instrument: str | None = None) -> dict:
    return {"ts": ts, "qty": qty, "side": side, "instrument": instrument}


def test_a_fill_belongs_to_its_new_york_session():
    assert capacity.session_of("2012-01-04T00:00:00+00:00") == "2012-01-03"
    assert capacity.session_of("2011-04-21T20:00:00+00:00") == "2011-04-21"
    assert capacity.session_of(1303416000) == "2011-04-21"


def test_born_failing_the_utc_date_of_a_midnight_stamp_is_the_next_day():
    """The check above can fail: grouping a 00:00 UTC fill by its UTC date puts it one session late."""
    stamp = pd.Timestamp("2012-01-04T00:00:00+00:00")
    assert stamp.strftime("%Y-%m-%d") != capacity.session_of(stamp.isoformat())


def test_volume_sources_map_names_to_their_continuous_root():
    es = capacity.volume_source("ES.XCME", None, FULL, ROOTS)
    assert (es.root, es.factor, es.note) == ("ES", 1.0, None)
    zt = capacity.volume_source("ZTU2010.XCME", None, FULL, ROOTS)
    assert (zt.root, zt.factor) == ("ZT", 1.0) and "continuous" in zt.note
    micro = capacity.volume_source("MNQ.XCME", 2.0, FULL, ROOTS)
    assert micro.root == "NQ" and micro.factor == pytest.approx(0.1) and "MNQ" in micro.note
    one = capacity.volume_source(capacity.ONE_NQ, None, FULL, ROOTS)
    assert (one.root, one.factor) == ("NQ", 1.0)
    unknown = capacity.volume_source("RTY.XCME", None, FULL, ROOTS)
    assert unknown.root is None and "universe" in unknown.note


def test_a_micro_contract_without_a_multiplier_is_refused():
    with pytest.raises(capacity.CapacityError, match="multiplier"):
        capacity.volume_source("MNQ.XCME", None, FULL, ROOTS)


def test_contracts_add_up_by_root_and_session():
    sources = {"MNQ.XCME": capacity.volume_source("MNQ.XCME", 2.0, FULL, ROOTS)}
    legs = capacity.fill_legs([fill("2011-04-21T20:00:00+00:00", 210), fill("2011-04-22T20:00:00+00:00", 30, "SELL"),
                               fill("2011-04-22T20:00:01+00:00", 20)], "MNQ.XCME")
    table = capacity.contracts_by_session(legs, sources)
    assert table.to_dict("records") == [
        {"root": "NQ", "session": "2011-04-21", "traded": 210.0, "contracts": pytest.approx(21.0)},
        {"root": "NQ", "session": "2011-04-22", "traded": 50.0, "contracts": pytest.approx(5.0)},
    ]


def test_trade_legs_count_the_entry_and_the_exit_on_their_own_sessions():
    trades = [{"entry_ts": "2015-03-02T20:59:00+00:00", "exit_ts": "2015-03-03T14:31:00+00:00"},
              {"entry_ts": "2015-03-03T14:40:00+00:00", "exit_ts": "2015-03-03T20:00:00+00:00"}]
    legs = capacity.trade_legs(trades, capacity.ONE_NQ)
    assert [(leg.session, leg.qty) for leg in legs] == [("2015-03-02", 1.0), ("2015-03-03", 1.0), ("2015-03-03", 1.0),
                                                         ("2015-03-03", 1.0)]


def test_a_fill_without_a_positive_quantity_is_refused():
    with pytest.raises(capacity.CapacityError, match="quantity"):
        capacity.fill_legs([fill("2011-04-21T20:00:00+00:00", 0)], "ES.XCME")


def volume(values: dict[str, float]) -> pd.Series:
    return pd.Series(values, dtype=float)


def test_the_ratio_is_contracts_over_the_session_volume():
    contracts = pd.DataFrame({"root": ["ES"] * 4, "session": ["2015-01-05", "2015-01-06", "2015-01-07", "2015-01-08"],
                              "traded": [100.0, 40.0, 10.0, 5.0], "contracts": [100.0, 40.0, 10.0, 5.0]})
    found = capacity.capacity_table(contracts, {"ES": volume({"2015-01-05": 1e6, "2015-01-06": 8e5,
                                                              "2015-01-07": 0.0})})
    (row,) = found["rows"]
    ratios = np.array([100 / 1e6, 40 / 8e5])
    assert row["root"] == "ES" and row["sessions"] == 4 and row["sessions_with_volume"] == 2 and row["void"] == 2
    assert row["contracts_total"] == 155.0 and row["contracts_mean"] == pytest.approx(155 / 4)
    assert row["ratio_mean"] == pytest.approx(ratios.mean(), rel=1e-12)
    assert row["ratio_median"] == pytest.approx(np.median(ratios), rel=1e-12)
    assert row["ratio_p95"] == pytest.approx(np.quantile(ratios, 0.95), rel=1e-12)
    assert row["ratio_max"] == pytest.approx(1e-4) and row["ratio_max_session"] == "2015-01-05"
    assert row["volume_median"] == pytest.approx(9e5)
    assert [w["session"] for w in found["worst"]] == ["2015-01-05", "2015-01-06"]
    assert found["max_ratio"] == pytest.approx(1e-4) and found["max_root"] == "ES"


def test_born_failing_traded_contracts_of_a_micro_would_overstate_the_ratio():
    """The micro factor matters: MNQ contracts over NQ volume without it read ten times too high."""
    sources = {"MNQ.XCME": capacity.volume_source("MNQ.XCME", 2.0, FULL, ROOTS)}
    table = capacity.contracts_by_session(capacity.fill_legs([fill("2019-06-03T20:00:00+00:00", 100)], "MNQ.XCME"),
                                          sources)
    found = capacity.capacity_table(table, {"NQ": volume({"2019-06-03": 500_000.0})})
    assert found["rows"][0]["ratio_max"] == pytest.approx(10 / 500_000)
    assert not math.isclose(100 / 500_000, found["rows"][0]["ratio_max"], rel_tol=1e-9)


def test_a_root_without_any_volume_has_no_ratios():
    contracts = pd.DataFrame({"root": ["ZN"], "session": ["2015-01-05"], "traded": [3.0], "contracts": [3.0]})
    found = capacity.capacity_table(contracts, {})
    (row,) = found["rows"]
    assert row["sessions_with_volume"] == 0 and row["void"] == 1 and math.isnan(row["ratio_max"])
    assert found["worst"] == [] and math.isnan(found["max_ratio"]) and found["max_root"] is None
