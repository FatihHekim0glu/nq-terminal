"""The 27-future universe (TASKS 2.3, ANALYTICS MV4 and MV5): returns by the dtsmom_panel convention, realised
volatility, correlation and cluster order. The fixture is the synthetic 1d set from `fakes.py`; the reference is
nq-lab's own `dtsmom_panel.build_panel`, called here directly on the same frames.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd
import pytest
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.services.market import HORIZONS, LABEL, MIN_CORR_OBS, universe

from fakes import synthetic_loader

WINDOW = 252
LAST_DAY = dt.date(2021, 12, 31)


@pytest.fixture(scope="module")
def frames() -> dict[str, pd.DataFrame]:
    return {f"{c.root}.V.0": synthetic_loader(f"{c.root}.V.0", "1d")(IS_START, IS_END) for c in TABLE}


@pytest.fixture(scope="module")
def panel(frames):
    return build_panel(frames, master_days(IS_START.date(), LAST_DAY))


@pytest.fixture(scope="module")
def result(frames):
    return universe(frames, window=WINDOW, contracts=TABLE)


def compound(r: np.ndarray, n: int) -> float:
    return float(np.prod(1 + r[-n:]) - 1)


def test_one_row_per_contract_in_the_frozen_table(result):
    assert [row.symbol for row in result.rows] == [f"{c.root}.V.0" for c in TABLE]
    assert [row.sector for row in result.rows] == [c.sector for c in TABLE]
    assert result.missing == ()
    assert result.as_of == "2021-12-31"
    assert "[POST HOC]" in LABEL


def test_horizon_returns_match_the_dtsmom_panel_builder(result, panel):
    ytd = sum(1 for d in panel.days if d.year == LAST_DAY.year)
    sessions = {"1D": 1, "1W": 5, "1M": 21, "3M": 63, "YTD": ytd, "12M": 252}
    assert result.horizon_sessions == sessions
    assert [label for label, _ in HORIZONS] == list(sessions)
    for a, row in enumerate(result.rows):
        r = panel.r[:, a]
        for label, n in sessions.items():
            assert row.returns[label] == pytest.approx(compound(r, n), rel=1e-12, abs=1e-15), (row.symbol, label)
        assert row.returns["1D"] == pytest.approx(r[-1], rel=1e-12, abs=1e-15)
        assert row.last_close == panel.N[-1, a] and row.last_close_back == panel.B[-1, a]


def test_the_convention_divides_by_the_implied_previous_price_on_roll_days(panel):
    a = panel.col("CL.V.0")
    roll_days = np.flatnonzero(panel.roll[:, a])
    t = int(roll_days[-1])
    assert panel.r[t, a] == pytest.approx(panel.dB[t, a] / (panel.N[t, a] - panel.dB[t, a]), rel=1e-12)
    plain = t - 3
    assert not panel.roll[plain, a]
    assert panel.r[plain, a] == pytest.approx(panel.dB[plain, a] / panel.N[plain - 1, a], rel=1e-12)


def test_born_failing_percent_change_of_the_back_adjusted_series_gives_other_returns(result, panel):
    """The check above can fail: the naive pct_change of c_back disagrees with the convention."""
    wrong = pd.DataFrame(panel.B, columns=panel.symbols).pct_change().to_numpy()
    naive_12m = [compound(wrong[:, a], 252) for a in range(len(panel.symbols))]
    ours = [row.returns["12M"] for row in result.rows]
    assert not np.allclose(naive_12m, ours, rtol=1e-9, atol=0)


def test_realised_vol_and_vol_normalised_returns(result, panel):
    for a, row in enumerate(result.rows):
        sd = float(np.std(panel.r[-WINDOW:, a], ddof=1))
        assert row.realised_vol == pytest.approx(sd * math.sqrt(252), rel=1e-12)
        for label, n in result.horizon_sessions.items():
            assert row.vol_normalised[label] == pytest.approx(row.returns[label] / (sd * math.sqrt(n)), rel=1e-12)


def test_window_correlation_matches_numpy_corrcoef(result, panel):
    block = result.corr_window
    assert block.sessions == WINDOW and list(block.symbols) == panel.symbols
    want = np.corrcoef(panel.r[-WINDOW:].T)
    np.testing.assert_allclose(np.array(block.matrix, dtype=float), want, rtol=1e-12, atol=1e-12)


def test_full_sample_correlation_is_pairwise_complete(result, panel):
    block = result.corr_full
    assert block.sessions is None
    want = pd.DataFrame(panel.r, columns=panel.symbols).corr(min_periods=MIN_CORR_OBS).to_numpy()
    got = np.array([[np.nan if x is None else x for x in row] for row in block.matrix], dtype=float)
    np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-12)


def test_cluster_order_is_average_linkage_on_one_minus_rho(result, panel):
    for block in (result.corr_window, result.corr_full):
        rho = np.array([[0.0 if x is None else x for x in row] for row in block.matrix], dtype=float)
        dist = 1.0 - rho
        np.fill_diagonal(dist, 0.0)
        want = leaves_list(linkage(squareform(dist, checks=False), method="average"))
        assert list(block.order) == want.tolist()
        assert sorted(block.order) == list(range(len(panel.symbols)))


def test_correlation_to_nq_comes_from_the_window_matrix(result):
    nq = list(result.corr_window.symbols).index("NQ.V.0")
    for i, row in enumerate(result.rows):
        assert row.corr_to_nq == pytest.approx(result.corr_window.matrix[i][nq], rel=1e-12)


def test_a_missing_series_is_reported_and_left_out(frames):
    partial = {k: v for k, v in frames.items() if k != "HE.V.0"}
    out = universe(partial, window=WINDOW, contracts=TABLE)
    assert out.missing == ("HE.V.0",)
    assert "HE.V.0" not in [row.symbol for row in out.rows]
    assert len(out.corr_window.symbols) == len(TABLE) - 1


def test_a_window_below_the_minimum_is_refused(frames):
    with pytest.raises(ValueError):
        universe(frames, window=MIN_CORR_OBS - 1, contracts=TABLE)
