"""Tear sheet rules settled in the Phase 3 improvement run (ANALYTICS_CATALOG RL1, RL2, RD1, BR1, SV1, SV2, C2).

- Item (e): the rolling windows follow P: 63 and 252 sessions for a daily series, 12 and 36 months for a monthly
  one (a 252-month line is always empty; a 3-month Sharpe from 3 points is noise). HOME [B] uses the long window.
- RD1: when the interquartile range is 0 (a 95% zero-filled series) Freedman-Diaconis gives one bin, so the
  histogram falls back to Sturges and says so.
- BR1: a one-contract series (no K) has no alpha in % per year, in the headline fit or in any block.
- SV2: MinTRL says why it is null: the Sharpe is at or below the threshold, or the moments leave it undefined.
- SV1: PSR at the benchmark treats the benchmark Sharpe as a fixed threshold, and says so.
- `to_months`: a benchmark month with a session that has no benchmark value is null (born failing).
- `stored_alpha`: mim_v0's `a_x252` is an annual fraction and is served x100 as % per year.
- `clean_json` is bounded: a deeply nested fit cannot raise RecursionError.
"""
from __future__ import annotations

import dataclasses
import math
from functools import lru_cache

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.analytics import distribution, rolling, series, validity
from nq_terminal.app import create_app
from nq_terminal.services import stored_alpha, tearsheet
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


@lru_cache(maxsize=1)
def real_research() -> ResearchService:
    return ResearchService(ROOT)


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    app = create_app(load_settings({}))
    app.state.serve_fn = make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def api() -> TestClient:
    return api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)})), base_url=LOCAL,
                      client=LOOPBACK)


def _nums(values) -> list:
    return [float(v) if math.isfinite(float(v)) else None for v in np.asarray(values, dtype=float)]


# ---------------------------------------------------------------- item (e): windows by P


def test_windows_follow_the_period():
    assert rolling.windows_for(252) == (63, 252) and rolling.windows_for(12) == (12, 36)
    with pytest.raises(ValueError, match="periods"):
        rolling.windows_for(365)


def test_a_monthly_book_gets_12_and_36_month_lines(real_api):
    body = real_api.get("/api/analytics/hypothesis/dtsmom_v0", params={"cost": 1}).json()
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    view = body["rolling"]
    assert view["windows"] == [12, 36] and view["window_unit"] == "months"
    assert view["sharpe_long"] == _nums(rolling.rolling_sharpe(s.r, 36, 12))
    assert view["vol_short"] == _nums(rolling.rolling_volatility(s.r, 12, 12))
    assert sum(v is not None for v in view["sharpe_long"]) == 120 - 35  # the old 252-month line had none


def test_a_daily_series_keeps_63_and_252_sessions(api):
    view = api.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1}).json()["rolling"]
    assert view["windows"] == [63, 252] and view["window_unit"] == "sessions"


def test_home_panel_uses_the_long_window(real_api, api):
    monthly = real_api.get("/api/analytics/hypothesis/dtsmom_v0/panel", params={"cost": 1}).json()
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    assert (monthly["rolling_window"], monthly["rolling_unit"]) == (36, "months")
    assert monthly["rolling_sharpe"] == _nums(rolling.rolling_sharpe(s.r, 36, 12))
    daily = api.get("/api/analytics/hypothesis/volmanaged_v0/panel", params={"cost": 1}).json()
    assert (daily["rolling_window"], daily["rolling_unit"]) == (252, "sessions")


def test_a_run_at_month_frequency_uses_month_windows(api):
    from test_runs_support import RUNS
    view = api.get(f"/api/analytics/run/{RUNS['za_orb']}", params={"freq": "M"}).json()["rolling"]
    assert view["windows"] == [12, 36] and view["window_unit"] == "months"


# ---------------------------------------------------------------- RD1 on a sparse series


def test_a_mostly_zero_series_is_not_one_bin():
    r = np.zeros(2000)
    r[::20] = np.linspace(-500, 700, 100)
    hist = distribution.histogram(r)
    assert np.subtract(*np.percentile(r, [75, 25])) == 0
    assert len(hist["counts"]) > 1 and hist["bin_rule"].startswith("Sturges")
    assert int(np.sum(hist["counts"])) == len(r)


def test_freedman_diaconis_stays_the_rule_when_the_iqr_is_positive():
    r = np.random.default_rng(1).standard_normal(500)
    hist = distribution.histogram(r)
    assert hist["bin_rule"] == "Freedman-Diaconis"
    assert np.array_equal(hist["edges"], np.histogram_bin_edges(r, bins="fd"))


def test_real_sparse_screens_get_more_than_one_bin():
    for name in ("tom_v0", "prefomc_v0", "fomctone_v0"):
        s = series.hypothesis_series(real_research(), name, 1)
        assert len(distribution.histogram(s.r)["counts"]) > 1, name


# ---------------------------------------------------------------- BR1 on a one-contract series


def test_a_usd_series_has_no_annual_alpha_percentage(real_api):
    body = real_api.get("/api/analytics/hypothesis/za_v0", params={"cost": 1}).json()
    rel = body["relative"]
    assert body["on_capital"] is False and rel is not None
    assert rel["alpha"]["alpha_annual_pct"] is None and rel["alpha"]["a"] is not None
    assert all(block["alpha_annual_pct"] is None for block in rel["blocks"].values())


def test_a_capital_series_keeps_its_annual_alpha(api):
    rel = api.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1}).json()["relative"]
    assert rel["alpha"]["alpha_annual_pct"] is not None


# ---------------------------------------------------------------- SV2 and SV1 notes


def test_min_trl_says_why_it_is_null():
    below = validity.min_trl_from_returns(np.array([-0.01, 0.005, -0.02, 0.001, -0.004]))
    undefined = validity.min_trl_from_returns(np.array([0.01, 0.02, 0.015]))
    reached = validity.min_trl_from_returns(np.random.default_rng(3).normal(0.001, 0.01, 800))
    assert (below["reason"], undefined["reason"], reached["reason"]) == ("below_threshold", "undefined",
                                                                         "reachable")
    assert "at or below" in tearsheet.min_trl_note(below["reason"])
    assert "not defined" in tearsheet.min_trl_note(undefined["reason"]) and "at or below" not in \
        tearsheet.min_trl_note(undefined["reason"])


def test_psr_at_the_benchmark_says_the_benchmark_sharpe_is_fixed(api):
    psr = api.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1}).json()["validity"]["psr"]
    assert "fixed" in psr["at_benchmark_note"] and "SV7" in psr["at_benchmark_note"]


# ---------------------------------------------------------------- to_months keeps benchmark gaps


def test_a_benchmark_gap_makes_its_month_null():
    idx = pd.DatetimeIndex(["2015-01-02", "2015-01-05", "2015-02-02", "2015-02-03"])
    s = series.SessionSeries(name="t", basis="B", periods=252, r=pd.Series([0.01, -0.02, 0.03, 0.01], index=idx),
                             unit="return on the account per session", on_capital=True, capital=1.0, source="t",
                             kind="mtm_snapshots", label="t",
                             bench=pd.Series([0.02, math.nan, 0.01, 0.01], index=idx))
    months = tearsheet.to_months(s)
    assert math.isnan(months.bench.iloc[0]) and months.bench.iloc[1] == pytest.approx(1.01 * 1.01 - 1)
    whole = dataclasses.replace(s, bench=s.bench.fillna(0.0))
    assert not math.isnan(tearsheet.to_months(whole).bench.iloc[0])


# ---------------------------------------------------------------- stored alpha conversions and bounds


def test_mim_alpha_is_the_annual_fraction_times_100():
    screen = real_research().detail("mim_v0").screen
    found = stored_alpha.stored_fit("mim_v0", 1, screen)
    assert found.alpha_annual_pct == pytest.approx(100 * screen["alpha"]["a_x252"], rel=1e-15)
    assert found.alpha_annual_pct == pytest.approx(-19.23, abs=0.01)  # round9_summary.md


def test_clean_json_is_bounded_on_deep_nesting():
    deep: dict = {}
    node = deep
    for _ in range(1200):
        node["x"] = {}
        node = node["x"]
    out = stored_alpha.clean_json(deep)
    depth = 0
    while isinstance(out, dict) and "x" in out:
        out, depth = out["x"], depth + 1
    assert depth <= stored_alpha.MAX_DEPTH and out == stored_alpha.TOO_DEEP


# ---------------------------------------------------------------- one PF4 interval; rejections off the adjusted p


def test_perf_interval_is_the_validity_interval():
    from nq_terminal.analytics import perf
    r = np.random.default_rng(5).standard_t(4, 900) * 0.01 + 0.0005
    found = validity.sharpe_ci(r, 252)
    assert perf.sharpe_ci(r, 252) == (found["lo"], found["hi"])
    assert perf.sharpe_standard_error(r) * math.sqrt(252) == found["se_annual"]
    with pytest.raises(ValueError, match="NaN"):
        perf.sharpe_ci(np.append(r, math.nan), 252)


def test_rejections_are_read_off_the_adjusted_p():
    table = validity.mt_boundaries([0.04, 0.01, 0.05], 0.05)
    limit = 0.05 * (1 + validity.REJECT_TOL)
    for flag, column in (("reject_bonferroni", "bonferroni_p"), ("reject_holm", "holm_p"), ("reject_bh", "bh_q")):
        assert table[flag].tolist() == (table[column] <= limit).tolist(), flag
    assert table["reject_bh"].all()  # 0.05 sits on the BH line at rank 3
