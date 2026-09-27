"""ROLL, the roll calendar (UI_SPEC section 5, P1; ANALYTICS MV10, gaps as MV2; TASKS Phase 11).

The service is fed the synthetic 1d frames of `fakes.py`, whose contracts roll at 22:00 UTC on the 10th of March,
June, September and December, so the first bar on a new contract is the first weekday after the 10th. That rule
is the independent check on the dates; the frame's own columns are the check on the gaps. The API tests go through
the fake serve with a temporary log; the real serve is never called. The paper schedule is checked against
`nq_lab.mnq_roll` and the project's recorded dates (MNQZ6: last trade 2026-12-18, roll 2026-12-08).
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab import mnq_roll
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.services import roll
from nq_terminal.services.bars import find_rolls
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve, synthetic_loader

LOCAL, LOOPBACK = "http://127.0.0.1", ("127.0.0.1", 50000)
QUARTER_MONTHS = (3, 6, 9, 12)


def daily(root: str) -> pd.DataFrame:
    return synthetic_loader(f"{root}.V.0", "1d")(IS_START, IS_END)


@pytest.fixture(scope="module")
def frames() -> dict[str, pd.DataFrame]:
    return {f"{c.root}.V.0": daily(c.root) for c in TABLE}


@pytest.fixture(scope="module")
def calendar(frames):
    return roll.roll_calendar(frames, TABLE)


def first_weekday_after_the_10th(year: int, month: int) -> str:
    day = dt.date(year, month, 11)
    while day.weekday() >= 5:
        day += dt.timedelta(days=1)
    return day.isoformat()


# ---------------------------------------------------------------- the service


def test_one_entry_per_contract_in_the_frozen_table(calendar):
    assert [m.symbol for m in calendar.markets] == [f"{c.root}.V.0" for c in TABLE]
    assert [m.sector for m in calendar.markets] == [c.sector for c in TABLE]
    assert calendar.missing == ()
    assert calendar.as_of == "2021-12-31"
    assert roll.LABEL.startswith("[POST HOC]")


def test_roll_dates_follow_the_synthetic_contract_rule(calendar):
    for market in calendar.markets:
        dates_2021 = [e.date for e in market.rolls if e.date.startswith("2021")]
        assert dates_2021 == [first_weekday_after_the_10th(2021, m) for m in QUARTER_MONTHS], market.symbol
        for event in market.rolls:
            assert event.last_date < event.date and event.from_id != event.to_id


def test_gaps_are_offset_changes_over_the_raw_close_before_the_roll(frames, calendar):
    frame = frames["CL.V.0"]
    market = next(m for m in calendar.markets if m.root == "CL")
    for event in market.rolls:
        at = int(frame.index[frame["ts"].dt.strftime("%Y-%m-%d") == event.date][0])
        gap = frame["offset"].iloc[at] - frame["offset"].iloc[at - 1]
        assert event.gap_pts == pytest.approx(gap, abs=1e-12)
        assert event.close_before == frame["c_none"].iloc[at - 1]
        assert event.gap_pct == pytest.approx(100 * gap / frame["c_none"].iloc[at - 1], rel=1e-12)
        assert event.from_id == frame["instrument_id"].iloc[at - 1] and event.to_id == frame["instrument_id"].iloc[at]


def test_born_failing_a_percent_gap_on_the_back_adjusted_close_differs(frames, calendar):
    """The check above can fail: the back-adjusted close before the roll gives another percent gap."""
    frame = frames["CL.V.0"]
    market = next(m for m in calendar.markets if m.root == "CL")
    differs = 0
    for event in market.rolls:
        at = int(frame.index[frame["ts"].dt.strftime("%Y-%m-%d") == event.date][0])
        wrong = 100 * event.gap_pts / frame["c_back"].iloc[at - 1]
        differs += not math.isclose(wrong, event.gap_pct, rel_tol=1e-9)
    assert differs > 0


def test_the_calendar_agrees_with_the_gp_roll_markers(frames, calendar):
    for market in calendar.markets:
        markers = find_rolls(frames[market.symbol], "1d")
        assert [(e.t, e.from_id, e.to_id) for e in market.rolls] == [(m.t, m.from_id, m.to_id) for m in markers]
        assert [e.gap_pts for e in market.rolls] == pytest.approx([m.gap_pts for m in markers], abs=1e-12)


def contango_roll() -> pd.DataFrame:
    """Two contracts, flat prices: the old one at 100.00, the new one above it at 101.25. Back-adjusted closes
    (`c_back = c_none + offset`, as in `fakes.py`) join at the roll, so the old contract's offset is +1.25 and the
    new, latest one's is 0."""
    ts = pd.to_datetime(["2021-03-08", "2021-03-09", "2021-03-10", "2021-03-11"], utc=True)
    none = [100.0, 100.0, 101.25, 101.25]
    offset = [1.25, 1.25, 0.0, 0.0]
    return pd.DataFrame({"ts": ts, "instrument_id": [7, 7, 8, 8], "c_none": none, "offset": offset,
                         "c_back": [n + o for n, o in zip(none, offset)]})


def note_sign_when_new_above(note: str) -> int:
    """The sign the unit note says a gap has when the new contract trades above the old."""
    said = {"negative": -1, "positive": 1}
    words = [w for w in said if f"{w} when the new contract trades above the old" in note]
    assert len(words) == 1, note
    return said[words[0]]


def test_the_unit_note_gives_the_sign_a_contango_roll_has():
    (event,) = roll.roll_events(contango_roll())
    assert event.gap_pts == pytest.approx(-1.25) and event.gap_pct == pytest.approx(-1.25)
    assert "old contract less new" in roll.UNIT_NOTE
    assert note_sign_when_new_above(roll.UNIT_NOTE) == int(math.copysign(1, event.gap_pts))


def test_born_failing_the_opposite_sign_note_is_caught():
    """The check above can fail: a note that calls the gap new less old gets the contango roll's sign wrong."""
    (event,) = roll.roll_events(contango_roll())
    wrong = ("the sign is the offset change, new contract less old, so it is positive when the new contract trades "
             "above the old")
    assert note_sign_when_new_above(wrong) != int(math.copysign(1, event.gap_pts))


def test_counts_by_year_and_the_month_axis(calendar):
    for market in calendar.markets:
        assert sum(market.per_year.values()) == len(market.rolls)
        assert market.per_year["2021"] == 4
        pcts = [abs(e.gap_pct) for e in market.rolls if e.gap_pct is not None]
        assert market.max_abs_gap_pct == pytest.approx(max(pcts))
        assert market.mean_abs_gap_pct == pytest.approx(sum(pcts) / len(pcts))
    assert calendar.months[0] == "2010-01" and calendar.months[-1] == "2021-12"
    assert len(calendar.months) == 12 * 12 and len(set(calendar.months)) == len(calendar.months)


def test_born_failing_a_bar_past_the_fence_never_becomes_a_roll(frames):
    """Defence in depth: a frame that (wrongly) holds a 2022 bar on a new contract shows no 2022 roll."""
    frame = frames["NQ.V.0"]
    extra = frame.iloc[[-1]].copy()
    extra["ts"] = pd.Timestamp("2022-01-03", tz="UTC")
    extra["instrument_id"] = frame["instrument_id"].iloc[-1] + 7
    leaky = pd.concat([frame, extra], ignore_index=True)
    assert find_rolls(leaky, "1d")[-1].t == int(pd.Timestamp("2022-01-03", tz="UTC").timestamp())
    events = roll.roll_events(leaky)
    assert events[-1].date <= "2021-12-31"
    assert len(events) == len(find_rolls(frame, "1d"))


def test_a_missing_market_is_listed_not_invented(frames):
    fewer = {k: v for k, v in frames.items() if k != "ZW.V.0"}
    result = roll.roll_calendar(fewer, TABLE)
    assert result.missing == ("ZW.V.0",)
    assert "ZW.V.0" not in [m.symbol for m in result.markets]


def test_a_market_with_one_contract_has_no_rolls():
    frame = daily("ES").iloc[:20]
    assert roll.roll_events(frame) == ()
    market = roll.market_rolls(frame, TABLE[0])
    assert market.per_year == {} and market.mean_abs_gap_pct is None and market.max_abs_gap_pct is None


def test_qa_report_counts_are_read_per_root():
    report = {"candidates": {"NQ": {"qa": {"rolls_total": 46, "rolls_per_year": {"2021": 4}}},
                             "ES": {"dropped": True}}}
    assert roll.qa_counts(report, "NQ") == (46, {"2021": 4})
    assert roll.qa_counts(report, "ES") == (None, None)
    assert roll.qa_counts(report, "CL") == (None, None)
    assert roll.qa_counts(None, "NQ") == (None, None)
    assert roll.qa_counts({"candidates": {"NQ": {"qa": {"rolls_total": "x"}}}}, "NQ") == (None, None)


# ---------------------------------------------------------------- the paper book's MNQ schedule


def test_paper_schedule_matches_the_recorded_mnqz6_dates():
    schedule = roll.paper_schedule(dt.date(2026, 9, 27), behind=2, ahead=4)
    assert schedule.held == "MNQZ6" and schedule.next_roll == "2026-12-08"
    held = next(r for r in schedule.rows if r.status == roll.HELD)
    assert (held.contract, held.expiry, held.roll_date, held.into) == ("MNQZ6", "2026-12-18", "2026-12-08", "MNQH7")
    assert [r.status for r in schedule.rows] == [roll.PAST] * 2 + [roll.HELD] + [roll.UPCOMING] * 4
    assert [r.contract for r in schedule.rows] == ["MNQM6", "MNQU6", "MNQZ6", "MNQH7", "MNQM7", "MNQU7", "MNQZ7"]
    assert schedule.roll_today is False and schedule.today_et == "2026-09-27"


def test_paper_schedule_dates_come_from_the_rule_module():
    schedule = roll.paper_schedule(dt.date(2027, 2, 1), behind=1, ahead=6)
    for row in schedule.rows:
        year, code = 2020 + int(row.contract[-1]), row.contract[3]
        month = {v: k for k, v in mnq_roll.QUARTER_CODES.items()}[code]
        contract = mnq_roll.Contract(year, month)
        assert row.expiry == mnq_roll.expiry(contract).isoformat()
        assert row.roll_date == mnq_roll.roll_date(contract).isoformat()
        assert row.into == contract.next().symbol


def test_on_a_roll_day_the_book_already_holds_the_new_contract():
    schedule = roll.paper_schedule(dt.date(2026, 12, 8), behind=1, ahead=1)
    assert schedule.roll_today is True and schedule.held == "MNQH7"
    past = [r for r in schedule.rows if r.status == roll.PAST]
    assert past[-1].contract == "MNQZ6" and past[-1].roll_date == "2026-12-08"


def test_paper_schedule_refuses_bad_counts():
    with pytest.raises(ValueError):
        roll.paper_schedule(dt.date(2026, 9, 27), behind=-1, ahead=4)
    with pytest.raises(ValueError):
        roll.paper_schedule(dt.date(2026, 9, 27), behind=0, ahead=0)


# ---------------------------------------------------------------- the API


def make_app(data_root: Path | None = None, serve=None):
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(data_root or FIXTURES)}))
    if serve is not None:
        app.state.serve_fn = serve
        app.state.catalog = FakeCatalog()
    return app


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


@pytest.fixture
def client(fake) -> TestClient:
    return TestClient(make_app(serve=fake), base_url=LOCAL, client=LOOPBACK)


def test_the_router_is_get_only(fake):
    assert_get_only(make_app(serve=fake))


def test_rolls_endpoint_contract(client, fake):
    r = client.get("/api/market/rolls")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"as_of", "label", "basis", "unit_note", "months", "markets", "missing", "qa_source", "gate"}
    assert body["label"].startswith("[POST HOC]") and body["as_of"] == "2021-12-31"
    assert len(body["markets"]) == 27 and body["missing"] == []
    nq = next(m for m in body["markets"] if m["symbol"] == "NQ.V.0")
    assert set(nq) == {"symbol", "root", "sector", "units", "tick", "first_date", "last_date", "rolls", "per_year",
                       "count", "mean_abs_gap_pct", "max_abs_gap_pct", "qa_rolls_total", "qa_match"}
    assert nq["count"] == len(nq["rolls"]) > 40
    assert set(nq["rolls"][0]) == {"date", "t", "last_date", "from", "to", "close_before", "gap_pts", "gap_pct"}
    assert all(e["date"] <= "2021-12-31" for m in body["markets"] for e in m["rolls"])
    assert body["gate"]["caller"] == "terminal"
    assert fake.calls and all(c.caller == "terminal" and c.timeframe == "1d" for c in fake.calls)
    assert all(c.end <= IS_END for c in fake.calls)


def test_a_second_request_is_served_from_the_cache(client, fake):
    client.get("/api/market/rolls")
    served = len(fake.calls)
    assert client.get("/api/market/rolls").json()["gate"]["cached"] is True
    assert len(fake.calls) == served


def test_the_nq_rolls_equal_the_bars_endpoint_markers(client):
    nq = next(m for m in client.get("/api/market/rolls").json()["markets"] if m["root"] == "NQ")
    bars = client.get("/api/bars", params={"symbol": "NQ.V.0", "timeframe": "1d"}).json()
    assert [(e["t"], e["from"], e["to"]) for e in nq["rolls"]] == [(m["t"], m["from"], m["to"]) for m in bars["rolls"]]
    assert [e["gap_pct"] for e in nq["rolls"]] == pytest.approx([m["gap_pct"] for m in bars["rolls"]], abs=1e-12)


def test_without_a_qa_report_the_qa_fields_are_null(client):
    body = client.get("/api/market/rolls").json()
    assert all(m["qa_rolls_total"] is None and m["qa_match"] is None for m in body["markets"])


def test_the_qa_report_counts_are_compared(tmp_path, fake):
    results = tmp_path / "data" / "results"
    results.mkdir(parents=True)
    calendar = roll.roll_calendar({f"{c.root}.V.0": daily(c.root) for c in TABLE[:2]}, TABLE[:2])
    es, nq = calendar.markets
    report = {"candidates": {"ES": {"qa": {"rolls_total": len(es.rolls)}}, "NQ": {"qa": {"rolls_total": 3}}}}
    (results / roll.QA_REPORT).write_text(json.dumps(report), encoding="utf-8")
    client = TestClient(make_app(tmp_path / "data", serve=fake), base_url=LOCAL, client=LOOPBACK)
    markets = {m["root"]: m for m in client.get("/api/market/rolls").json()["markets"]}
    assert markets["ES"]["qa_rolls_total"] == len(es.rolls) and markets["ES"]["qa_match"] is True
    assert markets["NQ"]["qa_rolls_total"] == 3 and markets["NQ"]["qa_match"] is False
    assert markets["CL"]["qa_rolls_total"] is None and markets["CL"]["qa_match"] is None


def test_no_price_source_answers_503():
    client = TestClient(make_app(), base_url=LOCAL, client=LOOPBACK)
    assert client.get("/api/market/rolls").status_code == 503


def test_paper_rolls_endpoint_is_dates_only(client):
    r = client.get("/api/market/paper-rolls", params={"ahead": 4})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"label", "rule", "source", "today_et", "held", "next_roll", "roll_today", "rows"}
    assert body["source"] == "nq_lab.mnq_roll"
    assert len([row for row in body["rows"] if row["status"] == roll.UPCOMING]) == 4
    for row in body["rows"]:
        assert set(row) == {"contract", "expiry", "roll_date", "into", "status"}
        assert dt.date.fromisoformat(row["expiry"]) and dt.date.fromisoformat(row["roll_date"])
    held = next(row for row in body["rows"] if row["status"] == roll.HELD)
    assert held["contract"] == body["held"] and held["roll_date"] == body["next_roll"]
    assert held["contract"] == mnq_roll.front_month(dt.date.fromisoformat(body["today_et"])).symbol


@pytest.mark.parametrize("params", [{"ahead": 0}, {"ahead": 41}, {"behind": -1}, {"behind": 9}])
def test_paper_rolls_refuses_out_of_range_counts(client, params):
    assert client.get("/api/market/paper-rolls", params=params).status_code == 422
