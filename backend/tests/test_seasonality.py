"""SEAS seasonality, pure functions (TASKS Phase 11; descriptive, [POST HOC], no p-values).

Hand-built inputs only: bucket statistics (n, mean, one standard error, hit rate), monthly aggregation (compound for
prices, sum for Basis A books), calendar keys (weekday, week of month) and the 30-minute NYSE buckets over 1m bars.
Born-failing cases: a percent change of the back-adjusted series gives a different bucket return than the project
convention; a bar outside the NYSE session or on an excluded session never reaches a bucket.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import seasonality as seas


def series(values, dates) -> pd.Series:
    return pd.Series(values, index=pd.DatetimeIndex(pd.to_datetime(dates)), dtype=float)


# ---------------------------------------------------------------- bucket statistics


def test_bucket_stats_give_n_mean_standard_error_and_hit_rate():
    values = np.array([0.01, -0.02, 0.03, 0.0, 0.02])
    keys = np.array([1, 1, 1, 2, 2])
    out = seas.bucket_stats(values, keys, ((1, "A"), (2, "B"), (3, "C")))
    a, b, c = out
    assert (a.key, a.label, a.n) == (1, "A", 3)
    assert a.mean == pytest.approx(np.mean([0.01, -0.02, 0.03]), rel=1e-15)
    assert a.se == pytest.approx(np.std([0.01, -0.02, 0.03], ddof=1) / math.sqrt(3), rel=1e-15)
    assert a.hit_rate == pytest.approx(2 / 3, rel=1e-15)
    assert b.hit_rate == 0.5  # a zero is not a hit
    assert (c.n, c.mean, c.se, c.hit_rate) == (0, None, None, None)


def test_one_observation_has_a_mean_but_no_standard_error():
    (only,) = seas.bucket_stats(np.array([0.5]), np.array([7]), ((7, "x"),))
    assert (only.n, only.mean, only.se, only.hit_rate) == (1, 0.5, None, 1.0)


def test_non_finite_values_are_left_out():
    (only,) = seas.bucket_stats(np.array([0.1, np.nan, np.inf, 0.3]), np.array([1, 1, 1, 1]), ((1, "x"),))
    assert only.n == 2 and only.mean == pytest.approx(0.2)


# ---------------------------------------------------------------- calendar keys and months


def test_weekday_and_week_of_month_keys():
    r = series([1, 2, 3, 4], ["2021-03-01", "2021-03-08", "2021-03-29", "2021-03-05"])
    assert seas.weekday_keys(r.index).tolist() == [0, 0, 0, 4]
    assert seas.week_of_month_keys(r.index).tolist() == [1, 2, 5, 1]


def test_monthly_compound_and_sum():
    r = series([0.10, 0.10, -0.05], ["2020-01-02", "2020-01-03", "2020-02-03"])
    comp = seas.monthly_returns(r, seas.COMPOUND)
    total = seas.monthly_returns(r, seas.SUM)
    assert comp.loc[(2020, 1)] == pytest.approx(1.1 * 1.1 - 1, rel=1e-15)
    assert total.loc[(2020, 1)] == pytest.approx(0.2, rel=1e-15)
    assert comp.loc[(2020, 2)] == pytest.approx(-0.05)
    with pytest.raises(ValueError):
        seas.monthly_returns(r, "mean")


def test_heatmap_is_years_by_twelve_months_with_blanks():
    r = series([0.01, 0.02, 0.03], ["2019-12-02", "2020-01-02", "2020-03-02"])
    years, values, counts = seas.heatmap(r, seas.SUM)
    assert years == [2019, 2020]
    assert len(values) == 2 and all(len(row) == 12 for row in values)
    assert values[0][11] == pytest.approx(0.01) and values[0][0] is None
    assert values[1][0] == pytest.approx(0.02) and values[1][1] is None and values[1][2] == pytest.approx(0.03)
    assert counts[1][0] == 1 and counts[1][1] == 0


def test_by_month_uses_one_value_per_month_and_year():
    r = series([0.01, 0.01, 0.03, -0.02], ["2019-01-02", "2019-01-03", "2020-01-02", "2020-02-03"])
    months = seas.by_month(r, seas.SUM)
    jan, feb = months[0], months[1]
    assert jan.n == 2 and jan.mean == pytest.approx((0.02 + 0.03) / 2)
    assert feb.n == 1 and feb.hit_rate == 0.0
    assert [m.label for m in months] == list(seas.MONTHS) and months[5].n == 0


# ---------------------------------------------------------------- 30-minute NYSE buckets


def sessions_table(*days: str, early: tuple[str, ...] = ()) -> pd.DataFrame:
    """Open 09:30 ET, close 16:00 ET (13:00 on an early close), as nq_lab.sessions.nyse_sessions gives them."""
    rows = {}
    for day in days:
        d = dt.date.fromisoformat(day)
        close = "13:00" if day in early else "16:00"
        rows[d] = {"open_utc": pd.Timestamp(f"{day} 09:30", tz="America/New_York").tz_convert("UTC"),
                   "close_utc": pd.Timestamp(f"{day} {close}", tz="America/New_York").tz_convert("UTC")}
    return pd.DataFrame.from_dict(rows, orient="index")


def bars(rows: list[tuple[str, float, float, float]]) -> pd.DataFrame:
    """(ET time 'YYYY-MM-DD HH:MM', o, c, raw_c) per 1m bar, stamped at the bar open in UTC."""
    ts = [pd.Timestamp(t, tz="America/New_York").tz_convert("UTC") for t, *_ in rows]
    return pd.DataFrame({"ts": pd.DatetimeIndex(ts), "o": [r[1] for r in rows], "c": [r[2] for r in rows],
                         "raw_c": [r[3] for r in rows]})


def test_bucket_returns_follow_the_project_convention():
    # back-adjusted o and c carry an offset of +100; the raw close is 100 points lower
    frame = bars([("2021-06-01 09:30", 1100.0, 1101.0, 1001.0),
                  ("2021-06-01 09:59", 1101.0, 1102.0, 1002.0),
                  ("2021-06-01 10:00", 1102.0, 1100.0, 1000.0)])
    out = seas.intraday_bucket_returns(frame, sessions_table("2021-06-01"), keep=None)
    assert out["bucket"].tolist() == [0, 1]
    d_b = 1102.0 - 1100.0
    assert out["r"].iloc[0] == pytest.approx(d_b / (1002.0 - d_b), rel=1e-15)  # dB / (N - dB)
    assert out["r"].iloc[1] == pytest.approx(-2.0 / (1000.0 + 2.0), rel=1e-15)
    # born failing: the percent change of the back-adjusted series is not the same number
    assert out["r"].iloc[0] != pytest.approx(1102.0 / 1100.0 - 1, rel=1e-9)


def test_bars_outside_the_session_or_on_excluded_days_are_dropped():
    frame = bars([("2021-06-01 09:29", 10.0, 11.0, 11.0),   # before the open
                  ("2021-06-01 12:59", 10.0, 11.0, 11.0),   # early close day: last bucket 12:30
                  ("2021-06-01 13:00", 10.0, 50.0, 50.0),   # after the early close
                  ("2021-06-02 15:59", 10.0, 12.0, 12.0),   # last bucket of a full day
                  ("2021-06-03 10:00", 10.0, 12.0, 12.0)])  # an excluded session
    table = sessions_table("2021-06-01", "2021-06-02", "2021-06-03", early=("2021-06-01",))
    out = seas.intraday_bucket_returns(frame, table, keep={dt.date(2021, 6, 1), dt.date(2021, 6, 2)})
    assert out["session"].tolist() == [dt.date(2021, 6, 1), dt.date(2021, 6, 2)]
    assert out["bucket"].tolist() == [6, 12]
    assert out["r"].iloc[0] == pytest.approx(0.1)


def test_bucket_labels_run_from_the_open_to_the_last_half_hour():
    assert seas.BUCKET_LABELS[0] == "09:30" and seas.BUCKET_LABELS[-1] == "15:30" and len(seas.BUCKET_LABELS) == 13


def test_by_bucket_counts_sessions_per_bucket():
    frame = pd.DataFrame({"session": [dt.date(2021, 6, 1)] * 2 + [dt.date(2021, 6, 2)],
                          "bucket": [0, 1, 0], "r": [0.01, -0.01, 0.03]})
    out = seas.by_bucket(frame)
    assert out[0].n == 2 and out[0].mean == pytest.approx(0.02) and out[1].n == 1 and out[12].n == 0


def test_an_empty_frame_gives_no_buckets():
    empty = pd.DataFrame({"ts": pd.DatetimeIndex([], tz="UTC"), "o": [], "c": [], "raw_c": []})
    out = seas.intraday_bucket_returns(empty, sessions_table("2021-06-01"), keep=None)
    assert out.empty and list(out.columns) == ["session", "bucket", "r"]
