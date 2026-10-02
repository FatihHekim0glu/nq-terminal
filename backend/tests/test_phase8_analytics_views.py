"""Tear sheet series the Phase 8 notes asked for (the look spec, section 7, reduced templates):

- EQ: the performance-difference pane, strategy minus benchmark cumulative return in fractions of K (Basis A summed,
  Basis B compounded; a one-contract series in its own unit), null where the benchmark has no value;
- RET: the per-period return series beside the histogram (the returns the histogram bins, in its unit);
- RR: the rolling volatility high and low of each window, with the session they fall on.
Every value is the part A function applied to the stage A series; the API sends exactly what the function gives.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.analytics import perf, rolling, series
from nq_terminal.app import create_app
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


def _client(root, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    return _client(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


@pytest.fixture(scope="module")
def fixture_api() -> TestClient:
    return _client(FIXTURES)


def test_fixture_runs_carry_the_new_fields(fixture_api):
    body = fixture_api.get("/api/analytics/run/nt_volmanaged_v0_fixture_m1").json()
    assert {"perf_diff", "perf_diff_unit"} <= set(body["equity"])
    assert len(body["distribution"]["series"]["r"]) == body["n"]
    assert len(body["rolling"]["vol_extremes"]) == 2


# ---------------------------------------------------------------- pure functions


def test_performance_difference_basis_a_is_the_difference_of_running_sums():
    idx = pd.date_range("2020-01-01", periods=4)
    r, b = pd.Series([0.01, -0.02, 0.03, 0.0], idx), pd.Series([0.0, 0.01, np.nan, 0.02], idx)
    diff = perf.performance_difference(r, b, "A")
    assert diff.iloc[0] == pytest.approx(0.01) and diff.iloc[1] == pytest.approx(-0.02)
    assert math.isnan(diff.iloc[2])
    assert diff.iloc[3] == pytest.approx(0.02 - 0.03, abs=1e-15)  # the benchmark sums over its own sessions


def test_performance_difference_basis_b_compounds():
    idx = pd.date_range("2020-01-01", periods=3)
    r, b = pd.Series([0.1, 0.1, -0.1], idx), pd.Series([0.0, 0.2, 0.0], idx)
    diff = perf.performance_difference(r, b, "B")
    assert diff.tolist() == pytest.approx([0.1, 1.21 - 1.2, 1.089 - 1.2])


def test_extremes_name_the_first_session_of_each():
    idx = pd.date_range("2020-01-01", periods=5)
    values = pd.Series([np.nan, 0.2, 0.5, 0.1, 0.5], idx)
    found = rolling.extremes(values)
    assert found["hi"] == 0.5 and found["hi_at"] == idx[2]
    assert found["lo"] == 0.1 and found["lo_at"] == idx[3]
    assert rolling.extremes(pd.Series([np.nan, np.nan], idx[:2])) == {"hi": None, "hi_at": None, "lo": None,
                                                                         "lo_at": None}


# ---------------------------------------------------------------- the API on real series


def test_eq_perf_difference_on_a_screen_series(real_api):
    body = real_api.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1}).json()
    s = series.hypothesis_series(ResearchService(ROOT), "volmanaged_v0", 1)
    eq = body["equity"]
    expected = perf.performance_difference(s.r, s.bench, "A")
    assert eq["perf_diff"] == [None if math.isnan(v) else v for v in expected]
    assert eq["perf_diff_unit"].startswith("fraction of K")
    last = len(eq["equity"]) - 1
    assert eq["perf_diff"][last] == pytest.approx(eq["equity"][last] - eq["bench"][last], abs=1e-12)


def test_ret_series_is_the_binned_returns(real_api):
    body = real_api.get("/api/analytics/hypothesis/dtsmom_v0", params={"cost": 1}).json()
    rows = body["distribution"]["series"]
    assert rows["t"] == body["equity"]["t"] and rows["date"] == body["equity"]["date"]
    assert sum(body["distribution"]["histogram"]["counts"]) == len(rows["r"])
    s = series.hypothesis_series(ResearchService(ROOT), "dtsmom_v0", 1)
    assert rows["r"] == s.r.tolist() and rows["unit"] == body["distribution"]["histogram"]["unit"]


def test_rr_volatility_high_and_low(real_api):
    body = real_api.get("/api/analytics/hypothesis/volmanaged_v0", params={"cost": 1}).json()
    roll = body["rolling"]
    assert [x["window"] for x in roll["vol_extremes"]] == roll["windows"]
    for item, values in zip(roll["vol_extremes"], (roll["vol_short"], roll["vol_long"])):
        finite = [(v, i) for i, v in enumerate(values) if v is not None]
        hi = max(finite, key=lambda x: x[0])
        lo = min(finite, key=lambda x: x[0])
        assert item["hi"] == hi[0] and item["hi_t"] == roll["t"][hi[1]] and item["hi_date"] == roll["date"][hi[1]]
        assert item["lo"] == lo[0] and item["lo_t"] == roll["t"][lo[1]]
        assert item["unit"] == roll["vol_unit"]


def test_a_series_without_a_benchmark_has_no_perf_difference(real_api):
    body = real_api.get("/api/analytics/hypothesis/tom_v0", params={"cost": 1}).json()
    assert body["equity"]["bench"] is None or body["equity"]["perf_diff"] is not None
    if body["equity"]["bench"] is None:
        assert body["equity"]["perf_diff"] is None and body["equity"]["perf_diff_unit"] is None


def test_a_run_perf_difference_is_in_fractions_of_the_starting_balance(real_api):
    body = real_api.get("/api/analytics/run/nt_volmanaged_v0_final_m1").json()
    eq = body["equity"]
    assert eq["bench"] is not None and body["basis"] == "B"
    k = body["capital"]
    for e, b, d in zip(eq["equity"], eq["bench"], eq["perf_diff"]):
        if b is None:
            assert d is None
        else:
            assert d == pytest.approx((e - b) / k, abs=1e-12)
    assert "compounded" in eq["perf_diff_unit"]


def test_monthly_series_rolling_extremes_use_month_windows(real_api):
    body = real_api.get("/api/analytics/hypothesis/vrp_eq_v0", params={"cost": 1}).json()
    assert [x["window"] for x in body["rolling"]["vol_extremes"]] == [12, 36]
    assert body["n"] == 120 and body["distribution"]["series"]["unit"] == body["distribution"]["histogram"]["unit"]


def test_the_overlay_tear_sheet_reproduces_the_stored_portfolio_drawdown(real_api):
    body = real_api.get("/api/analytics/hypothesis/vt_har_v0", params={"cost": 1}).json()
    import json
    screen = json.loads((ROOT / "results" / "screens" / "vt_har_v0.json").read_text(encoding="utf-8"))
    assert -body["drawdown"]["max_drawdown"] == pytest.approx(screen["headline"]["mdd_port_vt"], rel=1e-9)
    assert -body["drawdown"]["bench_max_drawdown"] == pytest.approx(screen["headline"]["mdd_port_ce"], rel=1e-9)
    assert body["on_capital"] is False and body["equity"]["perf_diff"] is not None
