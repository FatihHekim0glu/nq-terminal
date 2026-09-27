"""Tests for the EVT reference (TASKS Phase 11). In memory only: hand values and born-failing cases."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from crosscheck.compare import TOL, judge
from crosscheck.p11_evt import BAND_Z, daily_paths, evt_references, intraday_paths

DATES = [str(pd.Timestamp("2015-01-01") + pd.Timedelta(days=i))[:10] for i in range(12)]
R = [None, 0.01, -0.02, 0.03, 0.005, -0.01, 0.02, 0.0, 0.01, -0.005, 0.015, 0.02]
DAILY = {"mode": "daily", "dates": DATES, "r": R, "stale": [False] * 12, "pre": 2, "post": 2,
         "events": [DATES[4], DATES[6], DATES[11], "2016-01-01"]}


def test_daily_paths_are_zero_at_the_close_before_the_event():
    paths = daily_paths(DAILY)
    assert len(paths) == 2  # the last event's window passes the end; 2016-01-01 is not a session
    r = np.array([np.nan if x is None else x for x in R])
    assert paths[0] == pytest.approx([-r[3], 0.0, r[4], r[4] + r[5], r[4] + r[5] + r[6]], abs=1e-15)


def test_daily_voids_a_stale_close_and_a_missing_return():
    stale = dict(DAILY, stale=[i == 7 for i in range(12)])
    assert len(daily_paths(stale)) == 1
    gap = dict(DAILY, r=[None if i == 8 else x for i, x in enumerate(R)])
    assert len(daily_paths(gap)) == 1


def test_band_and_end_statistics_by_hand():
    refs = evt_references(DAILY)
    paths = np.array(daily_paths(DAILY))
    se = paths.std(axis=0, ddof=1) / math.sqrt(2)
    assert refs["n_used"].value == 2.0
    assert refs["mean"].value == pytest.approx(paths.mean(axis=0).tolist(), abs=1e-15)
    assert refs["se"].value == pytest.approx(se.tolist(), abs=1e-15)
    assert refs["upper"].value == pytest.approx((paths.mean(axis=0) + BAND_Z * se).tolist(), abs=1e-15)
    assert refs["end_share_positive"].value == float((paths[:, -1] > 0).mean())
    assert "p_value" not in refs


def test_born_failing_a_path_anchored_at_the_event_close_fails_the_comparison():
    refs = evt_references(DAILY)
    wrong = (np.array(daily_paths(DAILY)) - np.array(daily_paths(DAILY))[:, [2]]).mean(axis=0).tolist()
    _, ok = judge(wrong, refs["mean"].value, TOL)
    assert not ok
    _, same = judge(refs["mean"].value, refs["mean"].value, TOL)
    assert same


T0 = "2015-01-16T13:30:00+00:00"


def _event(n: int = 60, *, drop: tuple[int, ...] = (), roll_at: int | None = None) -> dict:
    start = pd.Timestamp(T0) - pd.Timedelta(minutes=30)
    keep = [i for i in range(n) if i not in drop]
    return {"t0": T0, "ts": [str(start + pd.Timedelta(minutes=i)) for i in keep],
            "raw_c": [100.0 + i for i in keep],
            "instrument_id": [2 if roll_at is not None and i >= roll_at else 1 for i in keep]}


def test_intraday_paths_use_the_bar_closed_by_each_minute():
    (path,) = intraday_paths({"mode": "intraday", "events": [_event()], "pre": 2, "post": 3, "max_stale": 20})
    assert path == pytest.approx([(129.0 + m) / 129.0 - 1 for m in range(-2, 4)], abs=1e-15)


def test_intraday_voids_a_roll_and_a_gap_past_the_tolerance():
    roll = {"mode": "intraday", "events": [_event(roll_at=31)], "pre": 1, "post": 5, "max_stale": 20}
    assert intraday_paths(roll) == []
    gap = {"mode": "intraday", "events": [_event(drop=tuple(range(0, 60)))], "pre": 1, "post": 1, "max_stale": 20}
    assert intraday_paths(gap) == []
    carried = {"mode": "intraday", "events": [_event(drop=(30, 31))], "pre": 1, "post": 3, "max_stale": 20}
    (path,) = intraday_paths(carried)
    assert path[2] == 0.0 and path[3] == 0.0


def test_fewer_than_two_events_have_no_band():
    one = dict(DAILY, events=[DATES[4]])
    refs = evt_references(one)
    assert refs["n_used"].value == 1.0 and all(math.isnan(x) for x in refs["se"].value)
