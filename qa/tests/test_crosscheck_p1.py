"""Tests for the P1 cross-check references (TASKS Phase 10). In memory only; hand values and born-failing cases."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from crosscheck import compare, dumps
from crosscheck.compare import FAIL, PASS
from crosscheck.p1_reference import (
    bootstrap_references,
    cornish_fisher,
    deflated_references,
    filliben,
    paths_references,
    rolling_pair,
    sharpe_bands,
    stress_references,
    tracking_references,
)

PA_CASE = np.array([10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6]) / 1000
BARS = {"ts": [f"2015-03-02T14:3{i}:00+00:00" for i in range(6)], "h": [101.0, 102.5, 101.5, 104.0, 103.0, 105.0],
        "l": [99.5, 100.0, 98.0, 100.5, 101.0, 102.0]}
TRADES = [
    {"direction": 1, "entry_ts": "2015-03-02T14:30:00+00:00", "exit_ts": "2015-03-02T14:34:00+00:00",
     "entry_px": 100.0, "exit_px": 102.0, "r_pts": 2.0, "pnl_usd": 40.0},
    {"direction": -1, "entry_ts": "2015-03-02T14:31:30+00:00", "exit_ts": "2015-03-02T14:33:30+00:00",
     "entry_px": 101.0, "exit_px": 100.0, "r_pts": None, "pnl_usd": 20.0},
    {"direction": 1, "entry_ts": "2015-03-02T14:40:00+00:00", "exit_ts": "2015-03-02T14:45:00+00:00",
     "entry_px": 103.0, "exit_px": 102.5, "r_pts": None, "pnl_usd": -10.0},
]


def bundle(kind: str, inputs: dict, ours: dict) -> dict:
    return {"schema": dumps.SCHEMA, "kind": kind, "case": f"hand_{kind}", "source": "hand-built", "inputs": inputs,
            "values": {"ours": ours}, "missing": {}}


def statuses(doc: dict) -> dict:
    return {(row.metric, row.side): row.status for row in compare.compare_bundle(dumps.parse_bundle(doc))}


# ---------------------------------------------------------------- RK3 and RD3


def test_cornish_fisher_reproduces_the_performance_analytics_case():
    normal, raw, inside = cornish_fisher(PA_CASE, 0.05)
    assert raw == pytest.approx(0.03054020545420761997, rel=1e-12) and inside
    assert normal == pytest.approx(0.03403879625838738124, rel=1e-12)
    assert cornish_fisher(PA_CASE, 0.01)[1] == pytest.approx(0.06380761695529429767, rel=1e-12)


def test_born_failing_a_platykurtic_series_is_outside_the_grid_domain():
    _, _, inside = cornish_fisher(np.array([5, -2, 1, -7, 3, 2, -1, 4, -3, 0]) / 100, 0.05)
    assert inside is False


def test_filliben_medians_match_scipy_probplot():
    from scipy import stats as sps
    x = np.random.default_rng(3).standard_normal(50)
    (osm, _), _ = sps.probplot(x, dist="norm")
    assert np.allclose(filliben(50), osm, rtol=0, atol=1e-14)


# ---------------------------------------------------------------- RL3, RL4


def test_rolling_pair_marks_a_window_with_a_gap():
    r = np.arange(1.0, 9.0) / 100
    b = np.array([0.02, 0.01, 0.03, np.nan, 0.01, 0.02, 0.04, 0.01])
    beta, corr = rolling_pair(r, b, 3)
    assert beta[:2] == [None, None] and beta[3] is None and beta[5] is None and beta[6] is not None
    assert corr[7] == pytest.approx(np.corrcoef(r[5:8], b[5:8])[0, 1], rel=1e-12)


# ---------------------------------------------------------------- SV5 and SV3


def test_bootstrap_reference_catches_a_wrong_interval():
    rng = np.random.default_rng(8)
    inputs = {"r": (0.0005 + 0.01 * rng.standard_normal(200)).tolist(), "basis": "A", "periods": 252,
              "on_capital": True, "seed": 5, "reps": 200, "horizon": 20, "confidence": 0.95}
    refs = bootstrap_references(inputs)
    right = {"sharpe_lo": refs["sharpe_lo"].value, "sharpe_hi": refs["sharpe_hi"].value}
    wrong = {"sharpe_lo": refs["sharpe_lo"].value * 1.001, "sharpe_hi": refs["sharpe_hi"].value}
    assert statuses(bundle("bootstrap", inputs, right))[("sharpe_lo", "ours")] == PASS
    assert statuses(bundle("bootstrap", inputs, wrong))[("sharpe_lo", "ours")] == FAIL


def test_born_failing_the_reference_counts_ruin_when_the_path_touches_zero():
    from crosscheck.p1_reference import _replication_stats
    # Basis A: loses all of K on the second step, then recovers to 1.1 of K; Basis B: two factors below zero with
    # a positive product. Both are ruined (CAGR -1), whatever the end; a dip to 0.0001 of K survives.
    assert _replication_stats(np.array([-0.5, -0.6, 1.2]), "A", 252)[1] == -1.0
    assert _replication_stats(np.array([-3.0, -2.0, 0.1]), "B", 252)[1] == -1.0
    assert _replication_stats(np.array([-0.9999, 0.5, 0.6]), "A", 252)[1] == pytest.approx(1.1001 ** 84 - 1)


def test_deflated_reference_reproduces_the_paper_fixture():
    rng = np.random.default_rng(1)
    trials = [{"name": f"t{i}", "periods": 252, "r": (0.01 * i + rng.standard_normal(300)).tolist()} for i in range(3)]
    paper = {"n_trials": 100, "variance": 1 / 500, "t": 1250, "skew": -3.0, "kurt": 10.0, "sr": 2.5 / math.sqrt(250)}
    refs = deflated_references({"trials": trials, "paper": paper})
    assert (refs["paper_sr0"].value, refs["paper_dsr"].value) == (0.1132, 0.9004)
    assert refs["n_trials"].value == 3.0 and set(refs["dsr"].value) == {"t0", "t1", "t2"}


# ---------------------------------------------------------------- RL1 band


def test_rl1_band_reference_widens_as_the_window_shrinks():
    r = np.random.default_rng(4).standard_normal(800) * 0.01 + 0.0006
    refs = sharpe_bands(r, 252)
    width = {w: refs[f"band_hi_{w}"].value - refs[f"band_lo_{w}"].value for w in (63, 252)}
    assert width[63] > 1.9 * width[252]
    sr = r.mean() / r.std(ddof=1)
    assert refs["band_lo_63"].value + refs["band_hi_63"].value == pytest.approx(2 * sr * math.sqrt(252), rel=1e-12)


def test_born_failing_a_full_sample_band_on_the_rolling_pane_is_caught():
    r = np.random.default_rng(4).standard_normal(800) * 0.01 + 0.0006
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2012-01-02", periods=800)]
    inputs = {"dates": dates, "r": r.tolist(), "bench": None, "basis": "A", "periods": 252, "on_capital": False}
    full = sharpe_bands(r, 252, windows=(800,))
    ours = {"band_lo_63": full["band_lo_800"].value, "band_hi_63": full["band_hi_800"].value}
    found = statuses(bundle("p1series", inputs, ours))
    assert found[("band_lo_63", "ours")] == FAIL and found[("band_hi_63", "ours")] == FAIL


# ---------------------------------------------------------------- TA2, TA4, TA5


def test_paths_reference_gives_the_hand_values():
    refs = paths_references({"trades": TRADES, "all_trades": TRADES, "bars": BARS, "point_value": 20.0, "tick": 0.25})
    assert refs["mae_pts"].value == [-2.0, -3.0, -0.5] and refs["mfe_pts"].value == [4.0, 3.0, 0.0]
    assert refs["whole_bars"].value == [4.0, 1.0, 0.0] and refs["holding_minutes"].value == [4.0, 2.0, 5.0]
    assert (refs["longest_win"].value, refs["longest_loss"].value) == (2.0, 1.0)


STOP_BARS = {"ts": ["2010-09-29T13:34:00+00:00", "2010-09-29T13:35:00+00:00", "2010-09-29T13:36:00+00:00"],
             "h": [5791.0, 5791.5, 5792.5], "l": [5789.5, 5788.0, 5784.0]}
ZA = {"direction": 1, "entry_ts": "2010-09-29T13:35:00+00:00", "exit_ts": "2010-09-29T13:37:00+00:00",
      "entry_px": 5790.5, "exit_px": 5786.0, "r_pts": 4.5, "pnl_usd": -90.0, "reason": "stop"}


def za_paths(trades, bars=STOP_BARS):
    return paths_references({"trades": trades, "all_trades": trades, "bars": bars, "point_value": 20.0, "tick": 0.25})


def test_paths_reference_caps_a_stop_at_its_fill_and_drops_a_targets_favourable_exit_bar():
    stop = za_paths([ZA])
    assert (stop["mae_pts"].value, stop["mfe_pts"].value, stop["whole_bars"].value) == ([-4.5], [1.0], [1.0])
    eod = za_paths([dict(ZA, reason="eod")])
    assert (eod["mae_pts"].value, eod["mfe_pts"].value, eod["whole_bars"].value) == ([-6.5], [2.0], [2.0])
    bars = dict(STOP_BARS, h=[5791.0, 5791.5, 5797.0], l=[5789.5, 5788.0, 5789.0])
    target = za_paths([dict(ZA, reason="target", exit_px=5795.0, pnl_usd=90.0)], bars)
    assert (target["mae_pts"].value, target["mfe_pts"].value) == ([-2.5], [4.5])


def test_paths_reference_flags_bars_on_another_basis():
    assert za_paths([ZA])["off_basis"].value == [0.0]
    far = dict(STOP_BARS, h=[x + 1000.0 for x in STOP_BARS["h"]], l=[x + 1000.0 for x in STOP_BARS["l"]])
    assert za_paths([ZA], far)["off_basis"].value == [1.0]


def test_born_failing_an_mae_past_the_stop_is_caught():
    inputs = {"trades": [ZA], "all_trades": [ZA], "bars": STOP_BARS, "point_value": 20.0, "tick": 0.25}
    assert statuses(bundle("paths", inputs, {"mae_pts": [-6.5]}))[("mae_pts", "ours")] == FAIL


def test_born_failing_a_naive_mfe_is_caught():
    inputs = {"trades": TRADES, "all_trades": TRADES, "bars": BARS, "point_value": 20.0, "tick": 0.25}
    naive = {"mfe_pts": [4.0, 3.0 + 1.5, 0.0]}  # counting the short's partial entry bar low as favourable
    assert statuses(bundle("paths", inputs, naive))[("mfe_pts", "ours")] == FAIL


# ---------------------------------------------------------------- RK5 and LV5


def test_stress_reference_sums_and_compounds_inside_the_window():
    dates = pd.bdate_range("2020-02-17", periods=10).strftime("%Y-%m-%d").tolist()
    r = [0.01, -0.02, -0.03, 0.01, -0.01, 0.02, 0.0, 0.01, -0.01, 0.02]
    inputs = {"dates": dates, "r": r, "bench": None, "basis": "B",
              "windows": [{"peak": "2020-02-18", "trough": "2020-02-24"}]}
    refs = stress_references(inputs)
    inside = r[2:6]  # after 02-18 to 02-24 inclusive: 02-19, 02-20, 02-21, 02-24
    assert refs["w0_n"].value == 4.0 and refs["w0_strategy"].value == pytest.approx(np.prod(1 + np.array(inside)) - 1)
    assert refs["w0_bench"].value is None


def test_tracking_reference_attributes_a_roll_to_each_contract():
    rows = [{"type": "close", "date": "2026-12-07", "contract": "MNQZ6.CME", "target": 6, "actual": {"MNQZ6.CME": 6},
             "close_px_by_contract": {"MNQZ6.CME": 100.0, "MNQH7.CME": 110.0}},
            {"type": "close", "date": "2026-12-08", "contract": "MNQH7.CME", "target": 5, "actual": {"MNQH7.CME": 6},
             "close_px_by_contract": {"MNQZ6.CME": 101.0, "MNQH7.CME": 112.0}}]
    refs = tracking_references({"rows": rows, "multiplier": 2.0})
    assert refs["paper"].value == [12.0] and refs["model"].value == [12.0] and refs["n"].value == 1.0


def test_a_p1_bundle_without_its_inputs_is_refused():
    with pytest.raises(dumps.DumpError, match="lacks inputs"):
        dumps.parse_bundle(bundle("stress", {"dates": [], "r": []}, {}))
