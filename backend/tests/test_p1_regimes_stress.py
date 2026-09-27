"""RG1 volatility regimes and RK5 stress windows (TASKS 10.4; ANALYTICS_CATALOG sections 5 and 10).

RG1: the regime of session t comes from NQ's 22-session RTH realised variance known at t-1 (the last value dated
before t) ranked against the terciles of every value dated before t, once at least 252 exist; numpy's linear quantile.
RK5: the frozen windows from `constants.STRESS_WINDOWS`, sessions after the peak up to the trough.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal import constants
from nq_terminal.analytics import regimes, stress

DAYS = pd.bdate_range("2011-01-03", periods=700)


def rv_series(seed=1) -> pd.Series:
    return pd.Series(np.exp(np.random.default_rng(seed).normal(-10, 0.5, len(DAYS))), index=DAYS)


def returns(seed=2) -> pd.Series:
    return pd.Series(np.random.default_rng(seed).normal(0.0003, 0.01, len(DAYS)), index=DAYS)


def test_labels_follow_the_expanding_terciles_of_earlier_values():
    rv, r = rv_series(), returns()
    frame = regimes.regime_frame(rv, r.index)
    for pos in (0, 251, 252, 253, 400, 699):
        t = r.index[pos]
        history = rv[rv.index < t].to_numpy()
        row = frame.loc[t]
        if len(history) < 252:
            assert row["regime"] is None and math.isnan(row["q_low"])
            continue
        lo, hi = np.quantile(history, 1 / 3), np.quantile(history, 2 / 3)
        x = history[-1]
        want = "low" if x <= lo else "high" if x > hi else "mid"
        assert (row["x"], row["q_low"], row["q_high"], row["regime"]) == (x, lo, hi, want)


def test_born_failing_using_the_same_day_value_is_look_ahead():
    rv, r = rv_series(), returns()
    frame = regimes.regime_frame(rv, r.index)
    t = r.index[500]
    assert frame.loc[t, "x"] == rv.iloc[499] != rv.iloc[500]


def test_stats_per_regime_and_welch_t():
    rv, r = rv_series(3), returns(4)
    found = regimes.regime_stats(r, rv, 252)
    frame = regimes.regime_frame(rv, r.index)
    for row in found["rows"]:
        part = r[frame["regime"] == row["regime"]]
        assert row["n"] == len(part) and row["mean"] == pytest.approx(part.mean(), rel=1e-12)
        assert row["sharpe"] == pytest.approx(part.mean() / part.std(ddof=1) * math.sqrt(252), rel=1e-12)
    high, low = r[frame["regime"] == "high"], r[frame["regime"] == "low"]
    t = sps.ttest_ind(high, low, equal_var=False)
    assert found["welch_t"] == pytest.approx(t.statistic, rel=1e-12)
    assert found["unlabelled"] == int(frame["regime"].isna().sum())
    assert found["tag"] == "[POST HOC]" and "p" not in found


def test_regimes_need_a_daily_series():
    with pytest.raises(ValueError):
        regimes.regime_stats(returns(), rv_series(), 12)


# ---------------------------------------------------------------- RK5


def test_window_rows_sum_on_a_compound_on_b():
    days = pd.bdate_range("2020-02-17", periods=30)
    r = pd.Series(np.linspace(-0.02, 0.01, 30), index=days)
    b = pd.Series(np.linspace(-0.03, 0.02, 30), index=days)
    b.iloc[5] = np.nan
    window = constants.STRESS_WINDOWS[0]
    inside = (days > pd.Timestamp(window.peak)) & (days <= pd.Timestamp(window.trough))
    row = stress.window_rows(r, b, "B", [window])[0]
    assert row["n"] == int(inside.sum()) and row["label"] == window.label and row["nq_depth"] == window.nq_depth
    assert row["strategy_return"] == pytest.approx(np.prod(1 + r[inside]) - 1, rel=1e-12)
    present = b[inside].dropna()
    assert row["bench_return"] == pytest.approx(np.prod(1 + present) - 1, rel=1e-12) and row["bench_n"] == len(present)
    level = np.cumprod(1 + r[inside].to_numpy())
    dd = (level / np.maximum(1, np.maximum.accumulate(level)) - 1).min()
    assert row["strategy_max_drawdown"] == pytest.approx(dd, rel=1e-12)
    row_a = stress.window_rows(r, b, "A", [window])[0]
    assert row_a["strategy_return"] == pytest.approx(r[inside].sum(), rel=1e-12)


def test_a_window_the_series_does_not_reach_has_no_values():
    r = pd.Series([0.01, -0.01], index=pd.to_datetime(["2012-05-01", "2012-05-02"]))
    row = stress.window_rows(r, None, "A", [constants.STRESS_WINDOWS[0]])[0]
    assert row["n"] == 0 and row["strategy_return"] is None and row["bench_return"] is None


def _month_end_series() -> pd.Series:
    ends = pd.date_range("2011-01-31", "2021-12-31", freq="BME")
    return pd.Series(np.linspace(-0.05, 0.05, len(ends)), index=ends)


def test_a_monthly_book_holds_every_month_the_window_overlaps():
    r = _month_end_series()
    rows = {row["label"]: row for row in stress.window_rows(r, None, "A", constants.STRESS_WINDOWS, periods=12)}
    covid = rows["2020 COVID crash"]
    assert (covid["covered_from"], covid["covered_to"], covid["n"]) == ("2020-02-28", "2020-03-31", 2)
    aug15 = rows["2015 August sell-off"]
    assert (aug15["covered_from"], aug15["covered_to"], aug15["n"]) == ("2015-07-31", "2015-08-31", 2)
    q4 = rows["2018 Q4 sell-off"]
    assert (q4["covered_from"], q4["covered_to"], q4["n"]) == ("2018-09-28", "2018-12-31", 4)
    jan16 = rows["2016 January sell-off"]
    assert (jan16["covered_from"], jan16["covered_to"]) == ("2015-12-31", "2016-02-29")
    assert covid["strategy_return"] == pytest.approx(r["2020-02-28":"2020-03-31"].sum(), rel=1e-12)


def test_born_failing_month_ends_inside_the_window_miss_the_crash_month():
    r = _month_end_series()
    daily_rule = stress.window_rows(r, None, "A", constants.STRESS_WINDOWS, periods=252)
    covid = {row["label"]: row for row in daily_rule}["2020 COVID crash"]
    assert covid["covered_to"] == "2020-02-28"  # March 2020, the crash month, is left out under the session rule


def test_a_daily_series_keeps_the_session_rule_and_names_its_span():
    days = pd.bdate_range("2020-02-17", periods=30)
    r = pd.Series(np.linspace(-0.02, 0.01, 30), index=days)
    row = stress.window_rows(r, None, "A", [constants.STRESS_WINDOWS[0]])[0]
    assert (row["covered_from"], row["covered_to"]) == ("2020-02-20", "2020-03-20")
