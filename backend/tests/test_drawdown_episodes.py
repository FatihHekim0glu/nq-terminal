"""DD3 (ANALYTICS_CATALOG.md section 2): every drawdown episode with its time to recovery, a histogram of the
recovery times and the longest time under water.

- A 10-session hand table extending the DD2 golden (`test_analytics_drawdown.py`): three episodes, two recovered
  after 1 and 3 sessions, one open.
- Born failing: an open episode counted as recovered; an off-by-one recovery (a session back exactly at the peak is
  recovered, one session short is not); a histogram that drops or double counts a recovery time.
- A loop implementation against the vectorised one on random series, both bases.
- The served view: episodes only on the full tear-sheet path, never in the HOME panel."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import drawdown
from nq_terminal.analytics._inputs import PERIODS_DAILY, PERIODS_MONTHLY

# 10 sessions, Basis A, every value exact in binary. Levels: .5 .25 .5 0 -.25 0 .25 .75 .5 .25;
# running peak (floored at 0): .5 .5 .5 .5 .5 .5 .5 .75 .75 .75; underwater (K): 0 -.25 0 -.5 -.75 -.5 -.25 0 -.25 -.5.
# Episode 1: peak s0, trough s1, back at the peak on s2 (recovery in 1 session, length 2).
# Episode 2: peak s2, trough s4, back at the peak on s7 (3 sessions from the trough, length 5).
# Episode 3: peak s7, trough s9, still under water (open, length 2).
HAND = [0.5, -0.25, 0.25, -0.5, -0.25, 0.25, 0.25, 0.5, -0.25, -0.25]
HAND_DATES = pd.bdate_range("2020-01-02", periods=10)
D = HAND_DATES
HAND_EPISODES = [  # peak, trough, recovery, depth, peak to trough, trough to recovery, length, open
    (D[0], D[1], D[2], -0.25, 1, 1, 2, False),
    (D[2], D[4], D[7], -0.75, 2, 3, 5, False),
    (D[7], D[9], None, -0.5, 2, None, 2, True),
]
DAILY_BINS = [(1, 1), (2, 5), (6, 10), (11, 21), (22, 63), (64, 126), (127, 252), (253, None)]
MONTHLY_BINS = [(1, 1), (2, 3), (4, 6), (7, 12), (13, 24), (25, 60), (61, 120), (121, None)]


def _hand() -> pd.Series:
    return pd.Series(HAND, index=HAND_DATES)


def _random(n: int, seed: int, scale: float = 0.02) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0002, scale, n), index=pd.bdate_range("2011-01-03", periods=n))


def _loop_episodes(r: pd.Series, basis: str) -> list[tuple]:
    """Second implementation: one pass with explicit peak tracking. (peak pos, trough pos, depth, recovery pos)."""
    level = 0.0 if basis == "A" else 1.0
    peak_level, peak_pos, current, episodes = level, -1, None, []
    for pos, x in enumerate(r.to_numpy()):
        level = level + x if basis == "A" else level * (1 + x)
        if level >= peak_level:
            if current is not None:
                episodes.append((*current, pos))
                current = None
            peak_level, peak_pos = level, pos
            continue
        dd = level - peak_level if basis == "A" else level / peak_level - 1
        if current is None:
            current = [peak_pos, pos, dd]
        elif dd < current[2]:
            current[1], current[2] = pos, dd
    if current is not None:
        episodes.append((*current, None))
    return episodes


def test_all_episodes_by_hand_in_time_order():
    rows = drawdown.all_episodes(_hand(), "A")
    assert len(rows) == len(HAND_EPISODES)
    for row, (peak, trough, rec, depth, p2t, t2r, length, is_open) in zip(rows, HAND_EPISODES):
        assert (row["peak"], row["trough"], row["recovery"]) == (peak, trough, rec)
        assert row["depth"] == pytest.approx(depth, abs=1e-15)
        assert (row["peak_to_trough"], row["trough_to_recovery"], row["length"], row["open"]) == (p2t, t2r, length,
                                                                                                   is_open)


def test_all_episodes_are_not_capped_at_the_dd2_top_ten():
    r = _random(2000, 3)
    assert len(drawdown.all_episodes(r, "B")) == len(_loop_episodes(r, "B")) > drawdown.TOP_EPISODES


def test_open_episode_is_never_counted_as_recovered():
    """Born failing: the last episode is still under water; counting it as recovered adds a time and a count."""
    summary = drawdown.episode_summary(_hand(), "A", PERIODS_DAILY)
    assert summary["n_episodes"] == 3
    assert summary["n_recovered"] == 2
    assert summary["n_open"] == 1
    assert summary["recovery_times"] == [1, 3]
    assert sum(b["count"] for b in summary["histogram"]) == 2
    assert summary["recovery_median"] == pytest.approx(2.0, abs=1e-15)
    assert summary["recovery_max"] == 3


def test_recovery_needs_a_session_back_at_the_peak_not_one_short():
    """Born failing off-by-one: level exactly at the peak is recovered (E_t >= E_peak); a hair short is not."""
    exact = drawdown.episode_summary([0.5, -0.25, 0.25], "A", PERIODS_DAILY)
    assert exact["n_recovered"] == 1 and exact["recovery_times"] == [1] and exact["n_open"] == 0
    short = drawdown.episode_summary([0.5, -0.25, 0.125], "A", PERIODS_DAILY)
    assert short["n_recovered"] == 0 and short["recovery_times"] == [] and short["n_open"] == 1


def test_time_to_recovery_runs_from_the_trough_and_length_from_the_peak():
    """Episode 2: trough s4, recovery s7 gives 3 (not 2 or 4, the off-by-one neighbours); length s2 to s7 is 5."""
    ep = drawdown.all_episodes(_hand(), "A")[1]
    assert ep["trough_to_recovery"] == 3
    assert ep["length"] == 5


def test_longest_under_water_is_the_longest_length_and_an_open_episode_runs_to_the_last_session():
    summary = drawdown.episode_summary(_hand(), "A", PERIODS_DAILY)
    longest = summary["longest"]
    assert (longest["length"], longest["open"]) == (5, False)
    assert (longest["peak"], longest["recovery"]) == (D[2], D[7])
    # the same series with a long open tail: the open episode is now the longest, measured to the last session
    tail = pd.Series(HAND + [-0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], index=pd.bdate_range("2020-01-02", periods=17))
    longest = drawdown.episode_summary(tail, "A", PERIODS_DAILY)["longest"]
    assert (longest["open"], longest["length"], longest["recovery"]) == (True, 9, None)


def test_open_episode_does_not_enter_the_recovery_maximum_or_median():
    r = pd.Series([0.5, -0.25, 0.25] + [-0.25] + [0.0] * 20, index=pd.bdate_range("2020-01-02", periods=24))
    summary = drawdown.episode_summary(r, "A", PERIODS_DAILY)
    assert summary["recovery_times"] == [1]
    assert summary["recovery_max"] == 1 and summary["recovery_median"] == 1.0
    assert summary["longest"]["open"] is True and summary["longest"]["length"] == 21


def test_histogram_bins_daily_and_monthly_and_counts_every_recovery_once():
    daily = drawdown.recovery_histogram([1, 2, 5, 6, 10, 11, 21, 22, 63, 64, 126, 127, 252, 253, 900], PERIODS_DAILY)
    assert [(b["lo"], b["hi"]) for b in daily] == DAILY_BINS
    assert [b["count"] for b in daily] == [1, 2, 2, 2, 2, 2, 2, 2]
    monthly = drawdown.recovery_histogram([1, 3, 4, 12, 13, 24, 25, 60, 61, 120, 121, 200], PERIODS_MONTHLY)
    assert [(b["lo"], b["hi"]) for b in monthly] == MONTHLY_BINS
    assert [b["count"] for b in monthly] == [1, 1, 1, 1, 2, 2, 2, 2]


def test_histogram_with_no_recovery_has_all_bins_at_zero():
    bins = drawdown.recovery_histogram([], PERIODS_DAILY)
    assert [(b["lo"], b["hi"]) for b in bins] == DAILY_BINS
    assert all(b["count"] == 0 for b in bins)


def test_no_drawdown_gives_an_empty_summary():
    summary = drawdown.episode_summary([0.01, 0.0, 0.02], "A", PERIODS_DAILY)
    assert summary["n_episodes"] == 0 and summary["longest"] is None
    assert summary["recovery_median"] is None and summary["recovery_max"] is None
    assert summary["episodes"] == []


def test_baseline_peak_episode_counts_from_before_the_first_session():
    """Starting with a loss is a drawdown from K: the peak is the baseline, so the length counts the first session."""
    ep = drawdown.all_episodes([-0.25, 0.125, 0.25], "A")[0]
    assert ep["peak"] is None and ep["trough_to_recovery"] == 2 and ep["length"] == 3


def test_empty_series_gives_an_empty_summary():
    summary = drawdown.episode_summary(pd.Series([], dtype=float), "A", PERIODS_DAILY)
    assert summary["n_episodes"] == 0 and summary["histogram"] == drawdown.recovery_histogram([], PERIODS_DAILY)


@pytest.mark.parametrize("basis", ["A", "B"])
def test_summary_agrees_with_the_loop_on_random_series(basis):
    for seed in range(8):
        r = _random(700, seed)
        loop = _loop_episodes(r, basis)
        summary = drawdown.episode_summary(r, basis, PERIODS_DAILY)
        rows = summary["episodes"]
        assert len(rows) == len(loop) == summary["n_episodes"]
        times = []
        for row, (peak_pos, trough_pos, depth, rec_pos) in zip(rows, loop):
            assert row["peak"] == (None if peak_pos < 0 else r.index[peak_pos])
            assert row["trough"] == r.index[trough_pos]
            assert row["recovery"] == (None if rec_pos is None else r.index[rec_pos])
            assert row["depth"] == pytest.approx(depth, rel=1e-12, abs=1e-15)
            if rec_pos is not None:
                times.append(rec_pos - trough_pos)
        assert summary["recovery_times"] == times
        assert summary["n_recovered"] == len(times) and summary["n_open"] == len(loop) - len(times)
        assert sum(b["count"] for b in summary["histogram"]) == len(times)
        last = len(r) - 1
        lengths = [(rec_pos if rec_pos is not None else last) - peak_pos for peak_pos, _, _, rec_pos in loop]
        assert summary["longest"]["length"] == max(lengths)


def test_dd2_table_is_a_prefix_of_dd3_sorted_by_depth():
    r = _random(1500, 11)
    table = drawdown.drawdown_table(r, "B")
    deepest = sorted(drawdown.all_episodes(r, "B"), key=lambda ep: (ep["depth"], ep["peak"] or pd.Timestamp.min))[:10]
    assert [row["trough"] for row in table] == [row["trough"] for row in deepest]


# ------------------------------------------------------------------ the served view


def test_drawdown_view_serves_episodes_on_the_full_path_only():
    from nq_terminal.services import tearsheet
    s = _series_for_view()
    u = tearsheet.units(s)
    served = tearsheet.drawdown_view(s, u, with_episodes=True)
    assert served.episodes is not None
    assert served.episodes.unit == "sessions"
    assert served.episodes.n_episodes == 3 and served.episodes.n_recovered == 2 and served.episodes.n_open == 1
    assert [row.recovery for row in served.episodes.episodes] == [str(D[2].date()), str(D[7].date()), None]
    assert tearsheet.drawdown_view(s, u).episodes is None


def test_home_panel_never_computes_episodes(monkeypatch):
    from nq_terminal.services import tearsheet
    s = _series_for_view()
    calls: list[str] = []
    monkeypatch.setattr(drawdown, "episode_summary", lambda *a, **k: calls.append("episodes") or {})
    tearsheet.home_panel(s, _context(s), stored=None)
    assert calls == []


def test_build_carries_the_episodes_in_the_drawdown_view():
    from nq_terminal.services import tearsheet
    s = _series_for_view()
    sheet = tearsheet.build(s, _context(s))
    assert sheet.drawdown.episodes is not None
    assert sheet.drawdown.episodes.longest is not None and sheet.drawdown.episodes.longest.length == 5
    assert [b.count for b in sheet.drawdown.episodes.histogram][:2] == [1, 1]


def test_routes_serve_episodes_on_the_tear_sheet_and_none_on_the_home_panel():
    """The fixture hypothesis and run: the sheet's episodes equal the part A function; the panel has no such field."""
    from nq_terminal.analytics import series
    from test_analytics_api import fixture_research, get, make_client
    client = make_client()
    body = get(client, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    found = drawdown.episode_summary(s.r, s.basis, s.periods)
    served = body["drawdown"]["episodes"]
    assert served["n_episodes"] == found["n_episodes"] == len(served["episodes"]) >= 1
    assert served["n_recovered"] == found["n_recovered"] and served["n_open"] == found["n_open"]
    assert [b["count"] for b in served["histogram"]] == [b["count"] for b in found["histogram"]]
    assert served["longest"]["length"] == found["longest"]["length"]
    assert served["unit"] == "sessions"
    assert [row["peak_to_trough"] for row in body["drawdown_table"]] == [
        row["peak_to_trough"] for row in drawdown.drawdown_table(s.r, s.basis)]
    panel = get(client, "/api/analytics/hypothesis/volmanaged_v0/panel", cost=1)
    assert "episodes" not in panel and "drawdown" not in panel


def _series_for_view():
    from nq_terminal.analytics.series import SessionSeries
    return SessionSeries(name="hand", basis="A", periods=PERIODS_DAILY, r=_hand(), unit="fraction of K",
                         on_capital=True, capital=None, source="hand table", kind="daily", label="hand")


def _context(s):
    from nq_terminal.models.analytics import Context
    return Context(kind="hypothesis", name="hand", cost=None, freq="D")
