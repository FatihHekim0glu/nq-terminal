"""RG2 trend regime (TASKS Phase 12; ANALYTICS_CATALOG section 10). Pure analytics, no gate.

The regime of session t comes from NQ's back-adjusted close at the last NYSE session before t, against the simple
mean of the 200 closes ending at that session (every one of them defined). "above" when the close is strictly above
its mean, else "below". Per regime n, mean, Sharpe (ddof 1, sqrt 252) and hit rate over non-zero sessions; Welch's t
of above against below, never a p-value.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal.analytics import trend_regime

CLOSE_DAYS = pd.bdate_range("2010-01-04", periods=900)
R_DAYS = CLOSE_DAYS[150:]


def closes(seed: int = 5) -> pd.Series:
    steps = np.random.default_rng(seed).normal(0.4, 12.0, len(CLOSE_DAYS))
    return pd.Series(2000.0 + np.cumsum(steps), index=CLOSE_DAYS)


def returns(seed: int = 6) -> pd.Series:
    r = np.random.default_rng(seed).normal(0.0004, 0.012, len(R_DAYS))
    r[::17] = 0.0
    return pd.Series(r, index=R_DAYS)


def by_hand(close: pd.Series, t: pd.Timestamp) -> tuple[float, float, str | None]:
    before = close[close.index < t]
    if len(before) < trend_regime.WINDOW:
        return (float(before.iloc[-1]) if len(before) else math.nan), math.nan, None
    window = before.iloc[-trend_regime.WINDOW:].to_numpy()
    x, m = float(window[-1]), float(window.mean())
    return x, m, "above" if x > m else "below"


def test_labels_use_the_close_and_mean_of_the_session_before():
    close, r = closes(), returns()
    frame = trend_regime.trend_frame(close, r.index)
    for pos in (0, 48, 49, 50, 51, 300, len(r) - 1):
        t = r.index[pos]
        x, m, want = by_hand(close, t)
        row = frame.loc[t]
        assert row["regime"] == want, (pos, t)
        if want is None:
            assert math.isnan(row["mean"])
            continue
        assert row["x"] == x and row["mean"] == pytest.approx(m, rel=1e-12)


def test_born_failing_the_same_session_close_would_be_look_ahead():
    """The check above can fail: a frame built on the session's own close and mean differs somewhere."""
    close, r = closes(), returns()
    frame = trend_regime.trend_frame(close, r.index)
    same = close.rolling(trend_regime.WINDOW).mean().reindex(r.index)
    own = np.where(close.reindex(r.index) > same, "above", "below")
    labelled = frame["regime"].notna().to_numpy()
    assert (frame["x"].to_numpy()[labelled] != close.reindex(r.index).to_numpy()[labelled]).any()
    assert (frame["regime"].to_numpy()[labelled] != own[labelled]).any()


def test_a_missing_close_inside_the_window_leaves_the_session_unlabelled():
    close, r = closes(), returns()
    holed = close.copy()
    holed.iloc[400] = np.nan
    frame = trend_regime.trend_frame(holed, r.index)
    hit = [t for t in r.index if close.index[400] < t <= close.index[400 + trend_regime.WINDOW]]
    assert frame.loc[hit, "regime"].isna().all()
    assert frame.loc[r.index[r.index > close.index[400 + trend_regime.WINDOW]], "regime"].notna().all()


def test_a_tie_counts_as_below():
    days = pd.bdate_range("2012-01-02", periods=trend_regime.WINDOW + 3)
    flat = pd.Series(100.0, index=days)
    frame = trend_regime.trend_frame(flat, days[-2:])
    assert list(frame["regime"]) == ["below", "below"]


def test_stats_per_regime_and_welch_t():
    close, r = closes(7), returns(8)
    found = trend_regime.trend_stats(r, close, 252)
    frame = trend_regime.trend_frame(close, r.index)
    for row in found["rows"]:
        part = r[frame["regime"] == row["regime"]]
        nonzero = int((part != 0).sum())
        assert row["n"] == len(part) and row["mean"] == pytest.approx(part.mean(), rel=1e-12)
        assert row["sharpe"] == pytest.approx(part.mean() / part.std(ddof=1) * math.sqrt(252), rel=1e-12)
        assert row["hit_rate"] == pytest.approx((part > 0).sum() / nonzero, rel=1e-12)
    above, below = r[frame["regime"] == "above"], r[frame["regime"] == "below"]
    t = sps.ttest_ind(above, below, equal_var=False)
    assert found["welch_t"] == pytest.approx(t.statistic, rel=1e-12)
    assert found["welch_df"] == pytest.approx(t.df, rel=1e-12)
    assert found["unlabelled"] == int(frame["regime"].isna().sum())
    assert [row["regime"] for row in found["rows"]] == ["above", "below"]
    assert found["tag"] == "[POST HOC]" and not any("p" == k or k.startswith("p_") for k in found)


def test_born_failing_the_pooled_t_differs_from_welch():
    close, r = closes(7), returns(8)
    found = trend_regime.trend_stats(r, close, 252)
    frame = trend_regime.trend_frame(close, r.index)
    pooled = sps.ttest_ind(r[frame["regime"] == "above"], r[frame["regime"] == "below"], equal_var=True)
    assert not math.isclose(pooled.statistic, found["welch_t"], rel_tol=1e-9)


def test_trend_regimes_need_a_daily_series():
    with pytest.raises(ValueError, match="daily"):
        trend_regime.trend_stats(returns(), closes(), 12)


def test_the_close_needs_a_date_index():
    with pytest.raises(ValueError, match="DatetimeIndex"):
        trend_regime.trend_frame(pd.Series([1.0, 2.0]), R_DAYS[:2])


def test_a_regime_with_one_session_has_no_sharpe_and_no_welch_t():
    days = pd.bdate_range("2012-01-02", periods=trend_regime.WINDOW + 2)
    rising = pd.Series(np.arange(len(days), dtype=float), index=days)
    r = pd.Series([0.01], index=days[-1:])
    found = trend_regime.trend_stats(r, rising, 252)
    above = next(row for row in found["rows"] if row["regime"] == "above")
    assert above["n"] == 1 and math.isnan(above["sharpe"]) and math.isnan(found["welch_t"])


# ---------------------------------------------------------------- series whose return window opens before the close

def planted_evening_move() -> tuple[pd.Series, pd.Timestamp]:
    """Flat 1d (UTC day) closes at 15010 except session D, whose close holds a 19:00 ET evening move to 15020.

    A long overnight return is labelled t = D + 1 (exit date) but runs from the 16:00 ET close of D, so D's own 1d
    close already contains the first hours of it.
    """
    days = pd.bdate_range("2012-01-02", periods=trend_regime.WINDOW + 3)
    close = pd.Series(15010.0, index=days)
    evening = days[trend_regime.WINDOW]
    close[evening] = 15020.0
    return close, days[trend_regime.WINDOW + 1]


def test_lag_takes_the_session_before_the_session_before():
    close, r = closes(), returns()
    frame = trend_regime.trend_frame(close, r.index, lag=1)
    for pos in (0, 48, 49, 50, 51, 300, len(r) - 1):
        t = r.index[pos]
        prior = CLOSE_DAYS[CLOSE_DAYS.get_loc(t) - 1]
        x, m, want = by_hand(close, prior)
        row = frame.loc[t]
        assert row["regime"] == want, (pos, t)
        if want is not None:
            assert row["x"] == x and row["mean"] == pytest.approx(m, rel=1e-12)


def test_born_failing_a_planted_evening_move_decides_the_regime_without_the_lag():
    close, t = planted_evening_move()
    assert trend_regime.trend_frame(close, pd.DatetimeIndex([t]))["regime"].iloc[0] == "above"
    assert trend_regime.trend_frame(close, pd.DatetimeIndex([t]), lag=1)["regime"].iloc[0] == "below"


def test_a_negative_lag_is_refused():
    close, t = planted_evening_move()
    with pytest.raises(ValueError, match="lag"):
        trend_regime.trend_frame(close, pd.DatetimeIndex([t]), lag=-1)
