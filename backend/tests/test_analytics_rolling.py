"""RL1, RL2 and RL5 (ANALYTICS_CATALOG.md section 3): pandas rolling against a numpy loop, NaN until the
window fills, and block bars read from the result files, never recomputed."""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import RESULTS
from nq_terminal.analytics import rolling


def _random(n: int = 400, seed: int = 5) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0003, 0.01, n), index=pd.bdate_range("2013-01-02", periods=n))


def _loop(r: np.ndarray, window: int, fn) -> np.ndarray:
    out = np.full(len(r), np.nan)
    for end in range(window, len(r) + 1):
        out[end - 1] = fn(r[end - window:end])
    return out


def test_rolling_sharpe_matches_numpy_loop():
    r = _random()
    got = rolling.rolling_sharpe(r, 63)
    want = _loop(r.to_numpy(), 63, lambda w: w.mean() / w.std(ddof=1) * math.sqrt(252))
    assert got.index.equals(r.index)
    assert np.isnan(got.to_numpy()[:62]).all()
    assert np.allclose(got.to_numpy()[62:], want[62:], rtol=1e-9, atol=0)


def test_rolling_volatility_matches_numpy_loop():
    r = _random()
    got = rolling.rolling_volatility(r, 252)
    want = _loop(r.to_numpy(), 252, lambda w: w.std(ddof=1) * math.sqrt(252))
    assert np.isnan(got.to_numpy()[:251]).all()
    assert np.allclose(got.to_numpy()[251:], want[251:], rtol=1e-9, atol=0)


def test_rolling_sharpe_is_nan_on_a_flat_window():
    r = pd.Series([0.0] * 70 + [0.01, -0.01] * 5)
    got = rolling.rolling_sharpe(r, 63)
    assert np.isnan(got.to_numpy()[:70]).all()
    assert np.isfinite(got.iloc[-1])


def test_short_series_is_all_nan():
    assert rolling.rolling_sharpe([0.01, 0.02], 63).isna().all()


def test_window_must_be_at_least_two():
    with pytest.raises(ValueError, match="window"):
        rolling.rolling_volatility([0.01, 0.02, 0.03], 1)


def test_rolling_panel_has_the_four_catalog_lines():
    panel = rolling.rolling_panel(_random(300))
    assert set(panel) == {"sharpe_63", "sharpe_252", "vol_63", "vol_252"}
    assert panel["vol_252"].notna().sum() == 300 - 251


def test_block_bars_read_the_screen_values_unchanged():
    screen = json.loads((RESULTS / "screens" / "volmanaged_v0.json").read_text(encoding="utf-8"))
    bars = rolling.block_bars(screen["blocks_1tick"], "alpha_annual_pct", "t_min")
    assert [b["block"] for b in bars] == ["2010-13", "2014-17", "2018-21"]
    for bar in bars:
        src = screen["blocks_1tick"][bar["block"]]
        assert bar["value"] == src["alpha_annual_pct"] and bar["t"] == src["t_min"] and bar["n"] == src["n"]


def test_block_bars_order_by_start_year_and_skip_non_blocks():
    blocks = {"2018-2021": {"n": 3, "mean_r": 0.2}, "all": {"n": 9, "mean_r": 0.1},
              "2010-2013": {"n": 4, "mean_r": -0.1}, "ok": True}
    bars = rolling.block_bars(blocks, "mean_r")
    assert [b["block"] for b in bars] == ["2010-2013", "2018-2021"]
    assert bars[0] == {"block": "2010-2013", "n": 4, "value": -0.1, "t": None}


def test_block_bars_keep_a_missing_value_as_none():
    bars = rolling.block_bars({"2010-2013": {"n": 0, "mean_net_r": None, "t": None}}, "mean_net_r", "t")
    assert bars == [{"block": "2010-2013", "n": 0, "value": None, "t": None}]
