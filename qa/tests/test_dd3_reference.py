"""DD3 reference (ANALYTICS_CATALOG section 2, DD3: time-to-recovery histogram and longest time under water).

The catalogue's QA reference is "loop against vectorised". Both live here, written from the definition and not from
the terminal's code (the QA package never imports the backend; the backend's own test,
`backend/tests/test_drawdown_episodes.py`, pins the same hand table):

- the LOOP walks the equity curve once with an explicit running peak and a current episode;
- the VECTORISED reference marks the sessions below the prior peak, labels the runs and reduces them with pandas.

Definitions (shared with DD2): the curve starts at the baseline (0 on Basis A, 1 on Basis B), which is the first
peak; a session is under water when it is strictly below the highest level before it; an episode is a maximal run of
such sessions; its trough is the deepest session (the first on ties); it recovers on the first session at or above the
peak (`>=`), else it is open. Time to recovery = recovery position minus trough position; length (time under water) =
recovery position (or the last position while open) minus peak position, the baseline peak sitting at -1. An open
episode is never a recovery: it is left out of the recovery times and the histogram, and counts for the longest time
under water. Histogram bins (inclusive): daily 1, 2-5, 6-10, 11-21, 22-63, 64-126, 127-252, 253+; monthly 1, 2-3,
4-6, 7-12, 13-24, 25-60, 61-120, 121+.

quantstats `drawdown_details` is INFO only: it starts the peak at the first session (so a series that opens with a loss
differs by the baseline episode), reports percent, and gives `end` as the last session under water, not the recovery.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

DAILY_EDGES = (1, 2, 6, 11, 22, 64, 127, 253)
MONTHLY_EDGES = (1, 2, 4, 7, 13, 25, 61, 121)

# 10 sessions, Basis A, exact in binary (the backend test's hand table). Levels .5 .25 .5 0 -.25 0 .25 .75 .5 .25.
HAND = [0.5, -0.25, 0.25, -0.5, -0.25, 0.25, 0.25, 0.5, -0.25, -0.25]
HAND_EPISODES = [  # peak pos, trough pos, recovery pos (None: open), depth, time to recovery, length
    (0, 1, 2, -0.25, 1, 2),
    (2, 4, 7, -0.75, 3, 5),
    (7, 9, None, -0.5, None, 2),
]


def levels(r: np.ndarray, basis: str) -> np.ndarray:
    return np.cumsum(r) if basis == "A" else np.cumprod(1.0 + r)


def baseline(basis: str) -> float:
    return 0.0 if basis == "A" else 1.0


def loop_episodes(r, basis: str, *, open_as_recovered: bool = False) -> list[dict]:
    """One pass, explicit state. `open_as_recovered` is the mutant the guard tests must catch."""
    values = np.asarray(r, dtype=float)
    level, peak_level, peak_pos = baseline(basis), baseline(basis), -1
    episodes: list[dict] = []
    current: dict | None = None
    for pos, x in enumerate(values):
        level = level + x if basis == "A" else level * (1.0 + x)
        if level >= peak_level:
            if current is not None:
                episodes.append({**current, "recovery": pos})
                current = None
            peak_level, peak_pos = level, pos
            continue
        depth = level - peak_level if basis == "A" else level / peak_level - 1.0
        if current is None:
            current = {"peak": peak_pos, "trough": pos, "depth": depth}
        elif depth < current["depth"]:
            current["trough"], current["depth"] = pos, depth
    if current is not None:
        episodes.append({**current, "recovery": len(values) if open_as_recovered else None})
    return episodes


def vectorised_episodes(r, basis: str) -> list[dict]:
    """Mark sessions below the prior peak, label the runs, reduce each run with pandas."""
    values = np.asarray(r, dtype=float)
    n = len(values)
    if n == 0:
        return []
    lv = levels(values, basis)
    prior = np.maximum.accumulate(np.r_[baseline(basis), lv])[:-1]  # highest level before each session
    under = lv < prior
    if not under.any():
        return []
    depth = (lv - prior) if basis == "A" else (lv / prior - 1.0)
    frame = pd.DataFrame({"under": under, "depth": np.where(under, depth, np.nan), "pos": np.arange(n)})
    frame["run"] = (frame["under"] & ~frame["under"].shift(fill_value=False)).cumsum().where(frame["under"])
    rows = []
    for _, run in frame.dropna(subset=["run"]).groupby("run"):
        first, last = int(run["pos"].iloc[0]), int(run["pos"].iloc[-1])
        rows.append({"peak": first - 1, "trough": int(run["depth"].idxmin()), "depth": float(run["depth"].min()),
                     "recovery": last + 1 if last + 1 < n else None})
    return rows


def summarise(episodes: list[dict], n: int, edges: tuple[int, ...]) -> dict:
    times = [e["recovery"] - e["trough"] for e in episodes if e["recovery"] is not None]
    lengths = [(e["recovery"] if e["recovery"] is not None else n - 1) - e["peak"] for e in episodes]
    counts = np.bincount(np.digitize(times, edges) - 1, minlength=len(edges)).tolist() if times else [0] * len(edges)
    return {"times": times, "counts": counts, "n_open": sum(e["recovery"] is None for e in episodes),
            "median": float(np.median(times)) if times else None, "max": max(times) if times else None,
            "longest": max(lengths) if lengths else None}


def random_series(n: int, seed: int, scale: float) -> np.ndarray:
    return np.random.default_rng(seed).normal(0.0003, scale, n)


# --------------------------------------------------------------------------------------------- hand table


def test_hand_table_by_hand_in_the_loop_and_the_vectorised_reference():
    for found in (loop_episodes(HAND, "A"), vectorised_episodes(HAND, "A")):
        assert len(found) == len(HAND_EPISODES)
        for e, (peak, trough, rec, depth, _, _) in zip(found, HAND_EPISODES):
            assert (e["peak"], e["trough"], e["recovery"]) == (peak, trough, rec)
            assert e["depth"] == pytest.approx(depth, abs=1e-15)


def test_hand_summary_times_histogram_and_longest():
    s = summarise(loop_episodes(HAND, "A"), len(HAND), DAILY_EDGES)
    assert s["times"] == [1, 3]
    assert s["counts"] == [1, 1, 0, 0, 0, 0, 0, 0]
    assert (s["n_open"], s["median"], s["max"], s["longest"]) == (1, 2.0, 3, 5)


def test_hand_off_by_one_neighbours_are_wrong():
    """Born failing: 2 or 4 sessions to recover (an off-by-one either way) is not the hand value 3."""
    e = loop_episodes(HAND, "A")[1]
    assert e["recovery"] - e["trough"] == 3
    assert e["recovery"] - e["trough"] not in (2, 4)
    assert e["recovery"] - e["peak"] == 5


def test_a_session_exactly_at_the_peak_recovers_and_one_hair_short_does_not():
    exact = loop_episodes([0.5, -0.25, 0.25], "A")
    assert [e["recovery"] for e in exact] == [2]
    short = loop_episodes([0.5, -0.25, 0.125], "A")
    assert [e["recovery"] for e in short] == [None]
    assert [e["recovery"] for e in vectorised_episodes([0.5, -0.25, 0.25], "A")] == [2]
    assert [e["recovery"] for e in vectorised_episodes([0.5, -0.25, 0.125], "A")] == [None]


def test_a_loss_on_the_first_session_is_an_episode_from_the_baseline_peak():
    e = loop_episodes([-0.25, 0.125, 0.25], "A")[0]
    assert (e["peak"], e["trough"], e["recovery"]) == (-1, 0, 2)
    assert vectorised_episodes([-0.25, 0.125, 0.25], "A") == [{**e}]


# --------------------------------------------------------------------------------------------- guards


def test_open_episode_counted_as_recovered_is_caught():
    """Born failing: the mutant turns the open episode into a third recovery, so the summaries differ."""
    good = summarise(loop_episodes(HAND, "A"), len(HAND), DAILY_EDGES)
    bad = summarise(loop_episodes(HAND, "A", open_as_recovered=True), len(HAND), DAILY_EDGES)
    assert good["n_open"] == 1 and bad["n_open"] == 0
    assert len(good["times"]) == 2 and len(bad["times"]) == 3
    assert good != bad


def test_histogram_never_drops_or_double_counts_a_recovery_time():
    times = [1, 2, 5, 6, 10, 11, 21, 22, 63, 64, 126, 127, 252, 253, 900]
    counts = np.bincount(np.digitize(times, DAILY_EDGES) - 1, minlength=8).tolist()
    assert counts == [1, 2, 2, 2, 2, 2, 2, 2] and sum(counts) == len(times)
    months = [1, 3, 4, 12, 13, 24, 25, 60, 61, 120, 121, 200]
    assert np.bincount(np.digitize(months, MONTHLY_EDGES) - 1, minlength=8).tolist() == [1, 1, 1, 1, 2, 2, 2, 2]


# --------------------------------------------------------------------------------------------- loop against vectorised


@pytest.mark.parametrize("basis", ["A", "B"])
@pytest.mark.parametrize("scale", [0.004, 0.02])
def test_loop_and_vectorised_reference_agree_on_random_series(basis, scale):
    for seed in range(12):
        r = random_series(900, seed, scale)
        loop = loop_episodes(r, basis)
        vec = vectorised_episodes(r, basis)
        assert len(loop) == len(vec) > 0
        for a, b in zip(loop, vec):
            assert (a["peak"], a["trough"], a["recovery"]) == (b["peak"], b["trough"], b["recovery"])
            assert a["depth"] == pytest.approx(b["depth"], rel=1e-12, abs=1e-15)
        assert summarise(loop, len(r), DAILY_EDGES) == summarise(vec, len(r), DAILY_EDGES)


@pytest.mark.parametrize("basis", ["A", "B"])
def test_episodes_are_ordered_disjoint_and_the_last_is_the_only_open_one(basis):
    r = random_series(1200, 5, 0.015)
    eps = loop_episodes(r, basis)
    for a, b in zip(eps, eps[1:]):
        assert a["recovery"] is not None
        assert a["trough"] < a["recovery"] <= b["peak"]  # the recovery session is a high, so the next peak is it or later
    assert all(e["recovery"] is not None for e in eps[:-1])


def test_a_flat_or_rising_series_has_no_episode_and_no_longest():
    for r in ([0.0, 0.0, 0.0], [0.01, 0.02, 0.0, 0.01], []):
        assert loop_episodes(r, "A") == [] and vectorised_episodes(r, "A") == []
        s = summarise([], len(r), DAILY_EDGES)
        assert s["longest"] is None and s["median"] is None and s["counts"] == [0] * 8


def test_longest_is_the_largest_length_and_an_open_tail_runs_to_the_last_session():
    r = HAND + [-0.25] + [0.0] * 6  # a 17-session series: the open episode now spans s7..s16
    s = summarise(loop_episodes(r, "A"), len(r), DAILY_EDGES)
    assert s["longest"] == 9 and s["n_open"] == 1 and s["times"] == [1, 3]


# --------------------------------------------------------------------------------------------- quantstats (INFO)


def test_info_quantstats_drawdown_details_agree_on_a_series_that_opens_with_a_gain():
    """INFO: `drawdown_details` has no baseline peak, so the series opens with a gain. It reports percent, `start` as
    the first session under water, `valley` as the trough and `end` as the last session under water."""
    qs = pytest.importorskip("quantstats")
    r = pd.Series(np.r_[0.01, random_series(600, 3, 0.02)], index=pd.bdate_range("2011-01-03", periods=601))
    details = qs.stats.drawdown_details(qs.stats.to_drawdown_series(r))
    eps = loop_episodes(r.to_numpy(), "B")
    assert len(details) == len(eps)
    index = r.index
    for row, e in zip(details.itertuples(index=False), eps):
        assert pd.Timestamp(row.start) == index[e["peak"] + 1]
        assert pd.Timestamp(row.valley) == index[e["trough"]]
        last_under = e["recovery"] - 1 if e["recovery"] is not None else len(r) - 1
        assert pd.Timestamp(row.end) == index[last_under]
        assert row[4] / 100.0 == pytest.approx(e["depth"], rel=1e-9, abs=1e-12)
