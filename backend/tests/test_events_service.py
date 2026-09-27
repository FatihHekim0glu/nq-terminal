"""EVT service (Phase 11, event study): the fixed calendars, the daily and intraday paths, the cross-event band.

Hand-built series check every rule; the real calendar files are read (read only) to prove the parser agrees with
nq-lab's own `calendar_announce.parse_macro_line` and with the FOMC statements in data/text/fomc. Born-failing
cases: a calendar whose FOMC dates disagree with the statements, a window that passes the fence, a stale close and a
roll inside an intraday window must each be refused or voided.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_lab.calendar_announce import parse_macro_line
from nq_lab.config import IS_END, IS_START, ROOT
from nq_terminal.services.bars import BarService
from nq_terminal.services.events import (
    BAND_Z,
    FOMC_MANIFEST,
    GATED_REASON,
    MACRO_SPEC,
    CalendarError,
    EventPick,
    aggregate,
    daily_paths,
    daily_study,
    end_stats,
    intraday_path,
    intraday_study,
    load_calendar,
    parse_line,
    pick_events,
)
from nq_terminal.services.files import FileCache

from fakes import make_fake_serve

D = dt.date
REAL_SPEC = ROOT / MACRO_SPEC
REAL_MANIFEST = ROOT / FOMC_MANIFEST


def _calendar_root(tmp_path: Path, lines: list[str], fomc: list[str] | None = None) -> Path:
    (tmp_path / "experiments").mkdir(parents=True, exist_ok=True)
    (tmp_path / MACRO_SPEC).write_text(json.dumps({"name": "macroday_v0", "event_dates": lines}), encoding="utf-8")
    if fomc is not None:
        (tmp_path / FOMC_MANIFEST).parent.mkdir(parents=True, exist_ok=True)
        pages = {d: {"role": "event"} for d in fomc} | {"2010-09-21": {"role": "prev_only"}}
        (tmp_path / FOMC_MANIFEST).write_text(json.dumps({"pages": pages}), encoding="utf-8")
    return tmp_path


LINES = ["2015-01-09 NFP@08:30", "2015-01-15 PPI@08:30", "2015-01-16 CPI@08:30", "2015-01-28 FOMC@14:00",
         "2015-03-18 FOMC@14:00+PPI@08:30", "2015-04-03 NFP@08:30 EXCLUDED (Good Friday, NYSE closed)"]


# ---------------------------------------------------------------- the calendar


def test_parse_line_reads_every_release_and_its_time():
    day = parse_line("2010-12-14 FOMC@14:15+PPI@08:30")
    assert day.date == D(2010, 12, 14)
    assert [(r.type, r.time_et) for r in day.releases] == [("FOMC", "14:15"), ("PPI", "08:30")]
    assert not day.excluded
    assert parse_line(LINES[-1]).excluded


@pytest.mark.parametrize("bad", ["2010-12-14", "2010-12-14 GDP@08:30", "14/12/2010 CPI@08:30", "2010-12-14 CPI@8:30"])
def test_parse_line_refuses_an_unknown_shape(bad):
    with pytest.raises(CalendarError):
        parse_line(bad)


@pytest.mark.skipif(not REAL_SPEC.is_file(), reason="macroday_v0.json not on disk")
def test_the_real_calendar_agrees_with_nq_lab_parser_and_counts():
    lines = json.loads(REAL_SPEC.read_text(encoding="utf-8"))["event_dates"]
    for line in lines:
        ours, theirs = parse_line(line), parse_macro_line(line)
        assert (ours.date, ours.types, ours.excluded) == (theirs["date"], theirs["types"], theirs["excluded"])
    cal = load_calendar(FileCache(roots=[ROOT]), ROOT)
    assert cal.counts == {"CPI": 133, "PPI": 135, "NFP": 132, "FOMC": 89, "ALL": 475}  # five Good Fridays dropped
    assert len(cal.spec_sha256) == 64
    assert len(pick_events(cal, "FOMC")) == 89
    assert len(pick_events(cal, "ALL")) == 475
    assert max(p.date for p in pick_events(cal, "ALL")) <= D(2021, 12, 31)


@pytest.mark.skipif(not REAL_MANIFEST.is_file(), reason="FOMC statements not on disk")
def test_the_real_fomc_dates_agree_with_the_statements():
    cal = load_calendar(FileCache(roots=[ROOT]), ROOT)
    assert cal.fomc_check.startswith("agrees")


def test_a_calendar_whose_fomc_dates_disagree_is_refused(tmp_path):
    """Born failing: the statements list one FOMC date less than the spec."""
    root = _calendar_root(tmp_path, LINES, fomc=["2015-01-28"])
    with pytest.raises(CalendarError, match="disagree"):
        load_calendar(FileCache(roots=[root]), root)
    ok = _calendar_root(tmp_path, LINES, fomc=["2015-01-28", "2015-03-18"])
    assert load_calendar(FileCache(roots=[ok]), ok).fomc_check.startswith("agrees")


def test_without_the_statements_the_check_says_so(tmp_path):
    root = _calendar_root(tmp_path, LINES)
    cal = load_calendar(FileCache(roots=[root]), root)
    assert cal.fomc_check.startswith("not checked")


def test_a_missing_spec_is_refused(tmp_path):
    with pytest.raises(CalendarError, match="macroday_v0"):
        load_calendar(FileCache(roots=[tmp_path]), tmp_path)


def test_pick_events_by_type_and_all(tmp_path):
    root = _calendar_root(tmp_path, LINES)
    cal = load_calendar(FileCache(roots=[root]), root)
    fomc = pick_events(cal, "FOMC")
    assert [(p.date, p.time_et) for p in fomc] == [(D(2015, 1, 28), "14:00"), (D(2015, 3, 18), "14:00")]
    ppi = pick_events(cal, "PPI")
    assert [(p.date, p.time_et) for p in ppi] == [(D(2015, 1, 15), "08:30"), (D(2015, 3, 18), "08:30")]
    every = pick_events(cal, "ALL")
    assert len(every) == 5  # the Good Friday line is dropped
    double = next(p for p in every if p.date == D(2015, 3, 18))
    assert double.types == ("FOMC", "PPI") and double.time_et == "08:30"  # the earliest release
    assert cal.counts == {"CPI": 1, "PPI": 2, "NFP": 1, "FOMC": 2, "ALL": 5}
    with pytest.raises(ValueError):
        pick_events(cal, "GDP")


# ---------------------------------------------------------------- daily paths


DAYS = [D(2015, 1, 1) + dt.timedelta(days=i) for i in range(12)]
R = np.array([np.nan, 0.01, -0.02, 0.03, 0.005, -0.01, 0.02, 0.0, 0.01, -0.005, 0.015, 0.02])
FRESH = np.zeros(12, dtype=bool)


def _pick(day: dt.date) -> EventPick:
    return EventPick(date=day, types=("CPI",), time_et="08:30")


def test_daily_path_is_zero_at_the_close_before_the_event_and_sums_returns():
    (row,) = daily_paths(DAYS, R, FRESH, [_pick(DAYS[5])], pre=3, post=2)
    # offsets -3..2 at closes of sessions 2..7; r at 5 is the event day's return
    expected = [-(R[3] + R[4]), -R[4], 0.0, R[5], R[5] + R[6], R[5] + R[6] + R[7]]
    assert row.reason is None
    assert row.path == pytest.approx(expected, abs=1e-15)


def test_daily_voids_a_missing_return_a_stale_close_and_the_bounds():
    stale = FRESH.copy()
    stale[6] = True
    rows = daily_paths(DAYS, R, stale, [_pick(DAYS[5]), _pick(DAYS[1]), _pick(DAYS[10]), _pick(D(2016, 1, 1))],
                       pre=2, post=2)
    reasons = [r.reason for r in rows]
    assert "stale close" in reasons[0] and "2015-01-07" in reasons[0]
    assert "before the first session" in reasons[1] or "no return" in reasons[1]
    assert "last in-sample session" in reasons[2]
    assert "not an NYSE session" in reasons[3]
    assert all(r.path == () for r in rows)
    r = R.copy()
    r[4] = np.nan
    (gap,) = daily_paths(DAYS, r, FRESH, [_pick(DAYS[5])], pre=2, post=1)
    assert "no return on 2015-01-05" in gap.reason


# ---------------------------------------------------------------- intraday paths


T0 = pd.Timestamp("2015-01-16 13:30", tz="UTC")  # 08:30 ET


def _minute_bars(start: pd.Timestamp, n: int, *, drop: tuple[int, ...] = (), roll_at: int | None = None) -> pd.DataFrame:
    ts = [start + pd.Timedelta(minutes=i) for i in range(n) if i not in drop]
    idx = [i for i in range(n) if i not in drop]
    iid = [2 if roll_at is not None and i >= roll_at else 1 for i in idx]
    return pd.DataFrame({"ts": pd.DatetimeIndex(ts), "raw_c": [100.0 + i for i in idx], "instrument_id": iid})


def test_intraday_path_is_the_price_ratio_to_the_release_minute():
    start = T0 - pd.Timedelta(minutes=30)
    bars = _minute_bars(start, 60)
    path, reason = intraday_path(bars, T0, pre=2, post=3)
    # price at T0 + m is raw_c of the bar opened at T0 + m - 1: minute index 29 + m -> 129 + m
    p0 = 129.0
    assert reason is None
    assert path == pytest.approx([(p0 + m) / p0 - 1 for m in range(-2, 4)], abs=1e-15)


def test_intraday_carries_a_price_forward_but_not_past_the_staleness_limit():
    start = T0 - pd.Timedelta(minutes=30)
    thin = _minute_bars(start, 60, drop=(30, 31))  # the bars ending at T0 + 1 and T0 + 2 are missing
    path, reason = intraday_path(thin, T0, pre=1, post=3)
    assert reason is None and path[2] == 0.0 and path[3] == 0.0  # carried from the release minute
    empty = _minute_bars(start, 60, drop=tuple(range(0, 60)))
    path, reason = intraday_path(empty, T0, pre=1, post=1)
    assert path is None and "no bar" in reason


def test_intraday_voids_a_roll_inside_the_window():
    """Born failing: the contract changes two minutes after the release."""
    bars = _minute_bars(T0 - pd.Timedelta(minutes=30), 60, roll_at=31)
    path, reason = intraday_path(bars, T0, pre=1, post=5)
    assert path is None and "roll" in reason


# ---------------------------------------------------------------- the band


def test_aggregate_mean_se_and_band_by_hand():
    paths = [[0.0, 0.01, 0.03], [0.0, -0.01, 0.01], [0.0, 0.03, 0.02]]
    agg = aggregate(paths)
    col = np.array([0.01, -0.01, 0.03])
    se = col.std(ddof=1) / math.sqrt(3)
    assert agg.n == 3
    assert agg.mean[1] == pytest.approx(col.mean(), abs=1e-15)
    assert agg.se[1] == pytest.approx(se, abs=1e-15)
    assert agg.lower[1] == pytest.approx(col.mean() - BAND_Z * se, abs=1e-15)
    assert agg.upper[1] == pytest.approx(col.mean() + BAND_Z * se, abs=1e-15)
    assert agg.se[0] == 0.0


def test_aggregate_with_fewer_than_two_events_has_no_band():
    one = aggregate([[0.0, 0.01]])
    assert one.mean == [0.0, 0.01] and one.se == [None, None] and one.lower == [None, None]
    none = aggregate([], width=2)
    assert none.n == 0 and none.mean == [None, None]


def test_end_stats_describe_the_last_offset():
    stats = end_stats([[0.0, 0.02], [0.0, -0.01], [0.0, 0.03], [0.0, 0.0]])
    col = np.array([0.02, -0.01, 0.03, 0.0])
    assert stats["n"] == 4
    assert stats["mean"] == pytest.approx(col.mean())
    assert stats["median"] == pytest.approx(0.01)
    assert stats["sd"] == pytest.approx(col.std(ddof=1))
    assert stats["share_positive"] == pytest.approx(0.5)
    assert end_stats([])["mean"] is None


# ---------------------------------------------------------------- through the gate


def test_daily_study_serves_through_the_gate_with_caller_terminal(tmp_path):
    log = tmp_path / "log.jsonl"
    service = BarService(make_fake_serve(log), cache_bytes=512 * 1024**2)
    picks = [_pick(D(2015, 1, 16)), _pick(D(2016, 3, 11))]
    result = daily_study(service, "NQ.V.0", picks, pre=5, post=5)
    assert [r.reason for r in result.rows] == [None, None]
    assert result.offsets == list(range(-5, 6))
    assert result.agg.mean[4] == 0.0  # offset -1
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    assert lines and all(x["caller"] == "terminal" for x in lines)
    assert all(pd.Timestamp(x["end"]) <= pd.Timestamp("2022-01-01", tz="UTC") for x in lines)


# ---------------------------------------------------------------- rebuilt bars and excluded sessions (fix run)
#
# NQ's repaired 1m file stores no raw close and no offset on the sessions rebuilt from trades. EVT prices such a bar
# itself as its close less its contract's one offset (known from the contract's vendor bars, in the window or, when
# the window holds none, in a few days around the event), whatever the bar service did; and it drops an event whose
# window reads any excluded session, not only the release date. Each case below was born failing.

C_OFFSET = 10.0  # the contract's back-adjustment offset: c = raw_c + offset on its vendor bars


def _adjusted_bars(start: pd.Timestamp, n: int, *, rebuilt=lambda ts: np.zeros(len(ts), dtype=bool),
                   offset: float = C_OFFSET) -> pd.DataFrame:
    """Continuous 1m bars of one contract, raw close 100 + i; `rebuilt(ts)` marks the rows stored without a raw close
    or an offset, as the repaired file stores its rebuilt bars."""
    ts = pd.DatetimeIndex([start + pd.Timedelta(minutes=i) for i in range(n)])
    raw = 100.0 + np.arange(n, dtype=np.float64)
    frame = pd.DataFrame({"ts": ts, "c": raw + offset, "raw_c": raw, "offset": np.full(n, offset),
                          "instrument_id": np.ones(n, dtype=np.int64)})
    gone = np.asarray(rebuilt(ts), dtype=bool)
    frame.loc[gone, ["raw_c", "offset"]] = np.nan
    return frame


def _window_fetch(frame: pd.DataFrame, calls: list | None = None):
    def fetch(lo: pd.Timestamp, hi: pd.Timestamp):
        if calls is not None:
            calls.append((lo, hi))
        return frame[(frame["ts"] >= lo) & (frame["ts"] < hi)].reset_index(drop=True), (lo.year,), True

    return fetch


def test_intraday_prices_a_rebuilt_bar_as_its_close_less_the_contracts_offset():
    start = T0 - pd.Timedelta(minutes=30)
    whole = _adjusted_bars(start, 60)
    rebuilt = _adjusted_bars(start, 60, rebuilt=lambda ts: ts >= T0 - pd.Timedelta(minutes=5))
    expected, reason = intraday_path(whole, T0, pre=2, post=3)
    assert reason is None
    path, reason = intraday_path(rebuilt, T0, pre=2, post=3)
    assert reason is None, reason
    assert path == pytest.approx(expected, abs=1e-15)


def test_intraday_study_finds_a_rebuilt_windows_offset_around_the_event():
    """The whole release session is rebuilt, so its window holds no offset; the contract's vendor bars on the days
    around it give the one offset, read through the same fetch (the gate)."""
    start = T0 - pd.Timedelta(days=2)
    day = T0.normalize()
    rebuilt = _adjusted_bars(start, 4 * 24 * 60, rebuilt=lambda ts: (ts >= day) & (ts < day + pd.Timedelta(days=1)))
    whole = _adjusted_bars(start, 4 * 24 * 60)
    calls: list = []
    got = intraday_study(_window_fetch(rebuilt, calls), [_pick(D(2015, 1, 16))], pre=10, post=15)
    want = intraday_study(_window_fetch(whole), [_pick(D(2015, 1, 16))], pre=10, post=15)
    (row,) = got.rows
    assert row.reason is None, row.reason
    assert row.path == pytest.approx(want.rows[0].path, abs=1e-15)
    assert len(calls) == 2 and calls[1][0] >= IS_START and calls[1][1] <= IS_END  # the context stays in-sample


def test_intraday_voids_a_rebuilt_window_whose_contract_has_no_single_offset():
    start = T0 - pd.Timedelta(days=2)
    day = T0.normalize()
    frame = _adjusted_bars(start, 4 * 24 * 60, rebuilt=lambda ts: (ts >= day) & (ts < day + pd.Timedelta(days=1)))
    frame.loc[frame["ts"] < day - pd.Timedelta(days=1), "offset"] = C_OFFSET + 1.0  # two offsets: ambiguous
    (row,) = intraday_study(_window_fetch(frame), [_pick(D(2015, 1, 16))], pre=10, post=15).rows
    assert row.path == () and "rebuilt from trades" in row.reason


def test_intraday_voids_an_event_whose_window_reads_the_next_session_when_it_is_excluded():
    """An FOMC statement at 14:00 ET with 390 minutes after reads bars past 18:00 ET, the next CME trade date's open;
    when that session is excluded the event is void, as it is when the release date itself is excluded."""
    t0 = pd.Timestamp("2015-01-28 19:00", tz="UTC")  # 14:00 ET
    frame = _adjusted_bars(t0 - pd.Timedelta(hours=8), 16 * 60)  # continuous, so nothing else voids it
    pick = EventPick(D(2015, 1, 28), ("FOMC",), "14:00")
    kept = intraday_study(_window_fetch(frame), [pick], pre=30, post=390).rows[0]
    assert kept.reason is None, kept.reason
    (row,) = intraday_study(_window_fetch(frame), [pick], pre=30, post=390, gated=frozenset({"2015-01-29"})).rows
    assert row.path == () and row.reason == GATED_REASON
    short = intraday_study(_window_fetch(frame), [pick], pre=30, post=60, gated=frozenset({"2015-01-29"})).rows[0]
    assert short.reason is None  # a window inside the release session does not read the next one
