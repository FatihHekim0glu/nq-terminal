"""DD1 and DD2 (ANALYTICS_CATALOG.md section 2): the hand-computed 10-session table, both bases, the Basis A
floor at 0, parity with `sizing_stats.max_drawdown`, and a loop-based second implementation of DD2."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from nq_lab import sizing_stats
from nq_terminal.analytics import drawdown

# 10 sessions, Basis A. By hand: cumsum 0.02 0.01 -0.02 -0.01 0.03 0.01 -0.02 -0.01 0.04 0.03;
# running peak floored at 0: 0.02 0.02 0.02 0.02 0.03 0.03 0.03 0.03 0.04 0.04;
# underwater 0 -0.01 -0.04 -0.03 0 -0.02 -0.05 -0.04 0 -0.01.
TEN = [0.02, -0.01, -0.03, 0.01, 0.04, -0.02, -0.03, 0.01, 0.05, -0.01]
TEN_DATES = pd.bdate_range("2020-01-02", periods=10)
TEN_UW = [0.0, -0.01, -0.04, -0.03, 0.0, -0.02, -0.05, -0.04, 0.0, -0.01]
D = TEN_DATES
TEN_TABLE = [  # peak, trough, recovery, depth, peak to trough, trough to recovery, length, open
    (D[4], D[6], D[8], -0.05, 2, 2, 4, False),
    (D[0], D[2], D[4], -0.04, 2, 2, 4, False),
    (D[8], D[9], None, -0.01, 1, None, 1, True),
]


def _random(n: int, seed: int, scale: float = 0.012) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0002, scale, n), index=pd.bdate_range("2011-01-03", periods=n))


def _loop_table(r: pd.Series, basis: str) -> list[tuple]:
    """Second implementation: one pass over the equity curve with explicit peak tracking."""
    level, peak_level, peak_pos, episodes, current = (0.0 if basis == "A" else 1.0), None, -1, [], None
    peak_level = level
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
    return sorted(episodes, key=lambda e: (e[2], e[0]))


def test_ten_session_underwater_by_hand():
    uw = drawdown.underwater(pd.Series(TEN, index=TEN_DATES), "A")
    assert uw.index.equals(TEN_DATES)
    assert np.allclose(uw.to_numpy(), TEN_UW, rtol=0, atol=1e-15)
    assert drawdown.max_drawdown(TEN, "A") == pytest.approx(-0.05, abs=1e-15)


def test_ten_session_drawdown_table_by_hand():
    table = drawdown.drawdown_table(pd.Series(TEN, index=TEN_DATES), "A")
    assert len(table) == len(TEN_TABLE)
    for row, (peak, trough, rec, depth, p2t, t2r, length, is_open) in zip(table, TEN_TABLE):
        assert (row["peak"], row["trough"], row["recovery"]) == (peak, trough, rec)
        assert row["depth"] == pytest.approx(depth, abs=1e-15)
        assert (row["peak_to_trough"], row["trough_to_recovery"], row["length"], row["open"]) == (p2t, t2r, length,
                                                                                                   is_open)


def test_basis_a_floor_at_zero_counts_an_opening_loss():
    """Starting with a loss is a drawdown from K (cummax floored at 0), with the baseline as the peak."""
    uw = drawdown.underwater([-0.02, 0.01, 0.015], "A")
    assert np.allclose(uw.to_numpy(), [-0.02, -0.01, 0.0], atol=1e-15)
    row = drawdown.drawdown_table([-0.02, 0.01, 0.015], "A")[0]
    assert row["peak"] is None and row["trough"] == 0 and row["recovery"] == 2
    assert (row["peak_to_trough"], row["trough_to_recovery"], row["length"]) == (1, 2, 3)


def test_basis_b_by_hand_with_baseline_peak():
    """E: 0.9, 0.945, 1.0395 from E_0 = 1."""
    uw = drawdown.underwater([-0.1, 0.05, 0.1], "B")
    assert np.allclose(uw.to_numpy(), [-0.1, -0.055, 0.0], atol=1e-15)
    assert drawdown.max_drawdown([-0.1, 0.05, 0.1], "B") == pytest.approx(-0.1, abs=1e-15)


def test_trough_is_the_first_session_on_a_tie():
    """Underwater -0.5, 0, -0.5 (in units of K): two sessions share the depth; the first one is the trough."""
    row = drawdown.drawdown_table([0.5, -0.5, 0.0, 0.5, -0.5, 0.0, 0.5], "A")
    assert [(r["peak"], r["trough"], r["recovery"]) for r in row] == [(0, 1, 3), (3, 4, 6)]
    tie = drawdown.drawdown_table([0.5, -0.5, 0.25, -0.25, 1.0], "A")[0]  # underwater 0 -0.5 -0.25 -0.5 0
    assert (tie["peak"], tie["trough"], tie["recovery"]) == (0, 1, 4)


def test_no_drawdown_gives_zero_and_an_empty_table():
    assert drawdown.max_drawdown([0.01, 0.0, 0.02], "B") == 0.0
    assert drawdown.drawdown_table([0.01, 0.0, 0.02], "A") == []


def test_basis_a_matches_sizing_stats_max_drawdown():
    for seed in range(5):
        r = _random(800, seed)
        assert -drawdown.max_drawdown(r, "A") == pytest.approx(sizing_stats.max_drawdown(r), rel=1e-13)


@pytest.mark.parametrize("basis", ["A", "B"])
def test_table_agrees_with_loop_implementation(basis):
    for seed in range(8):
        r = _random(700, seed, 0.02)
        vec = drawdown.drawdown_table(r, basis, top=10_000)
        loop = _loop_table(r, basis)
        assert len(vec) == len(loop)
        for row, (peak_pos, trough_pos, depth, rec_pos) in zip(vec, loop):
            assert row["peak"] == (None if peak_pos < 0 else r.index[peak_pos])
            assert row["trough"] == r.index[trough_pos]
            assert row["recovery"] == (None if rec_pos is None else r.index[rec_pos])
            assert row["depth"] == pytest.approx(depth, rel=1e-12, abs=1e-15)


def test_top_limits_rows_and_sorts_deepest_first():
    rng = np.random.default_rng(1)
    r = pd.Series(rng.normal(0.001, 0.01, 2000), index=pd.bdate_range("2011-01-03", periods=2000))
    assert len(drawdown.drawdown_table(r, "B", top=10_000)) > 10
    table = drawdown.drawdown_table(r, "B")
    assert len(table) == 10
    depths = [row["depth"] for row in table]
    assert depths == sorted(depths)
    assert depths[0] == pytest.approx(drawdown.max_drawdown(r, "B"), rel=1e-15)
