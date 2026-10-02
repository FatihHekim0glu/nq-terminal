"""Analytics API (TASKS 3.3; ARCHITECTURE s4 Analytics; ANALYTICS_CATALOG C1, C2, C6, C7, BR1, BR2, SV1, SV2, SV4, SV7).

Every value the API sends must equal the part A function applied to the stage A series, exactly (the JSON float
round trip is exact). Every response names its basis and unit. Prices are read only through an injected fake serve
(caller "terminal", temporary log); a client on the real data root always gets the fake serve, so these tests
never add a line to the real audit log.
"""
from __future__ import annotations

import copy
import math
from functools import lru_cache

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy import stats as sps

from nq_lab.config import ROOT
from nq_terminal.analytics import distribution, drawdown, perf, relative, risk, rolling, series, validity
from nq_terminal.app import create_app
from nq_terminal.services import stored_alpha
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from test_runs_support import RUNS, FakeClock, result_doc, service, strict_json

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
R_M_1 = 0.9914875364356387
R_TS_1 = 0.25493487321272734
ANCHOR = 1e-12
KPI_KEYS = ["total_return", "cagr", "volatility", "sharpe", "sortino", "calmar", "max_drawdown", "psr_0", "min_trl",
            "information_ratio", "tracking_error", "alpha_annual", "alpha_t"]
ROUTES = ("/api/analytics/hypothesis/{name}", "/api/analytics/hypothesis/{name}/panel",
          "/api/analytics/run/{run_id}", "/api/analytics/run/{run_id}/panel")


def make_client(root=FIXTURES, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def api() -> TestClient:
    return make_client()


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    """The real data root with the fake serve injected: no real gate read can happen."""
    return make_client(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


@lru_cache(maxsize=1)
def fixture_research() -> ResearchService:
    return ResearchService(FIXTURES)


@lru_cache(maxsize=1)
def fixture_runs():
    return service(FIXTURES, clock=FakeClock())


def nums(values) -> list:
    return [float(v) if v is not None and math.isfinite(float(v)) else None for v in np.asarray(values, dtype=float)]


def num(value):
    return nums([value])[0]


def get(client: TestClient, path: str, **params) -> dict:
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return strict_json(r.text)


def kpis(body: dict) -> dict:
    return {k["key"]: k for k in body["kpis"]}


# ---------------------------------------------------------------- routes


def test_analytics_routes_are_registered_get_only():
    paths = create_app(load_settings({})).openapi()["paths"]
    for route in ROUTES:
        assert set(paths[route]) == {"get"}, route


# ---------------------------------------------------------------- Basis A: KPI tiles equal the part A functions


def test_hypothesis_kpis_equal_the_part_a_functions(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    assert (body["basis"], body["periods_per_year"], body["n"], body["unit"]) == ("A", 252, s.n, s.unit)
    tiles = kpis(body)
    assert list(tiles) == KPI_KEYS
    assert tiles["sharpe"]["value"] == num(perf.sharpe(s.r, 252))
    assert tiles["sortino"]["value"] == num(perf.sortino(s.r, 252))
    assert tiles["volatility"]["value"] == num(perf.annual_volatility(s.r, 252))
    assert tiles["total_return"]["value"] == num(perf.total_return(s.r, "A"))
    assert tiles["cagr"]["value"] == num(perf.cagr(s.r, "A", 252))
    assert tiles["calmar"]["value"] == num(perf.calmar(s.r, "A", 252))
    assert tiles["max_drawdown"]["value"] == num(drawdown.max_drawdown(s.r, "A"))
    assert tiles["psr_0"]["value"] == num(validity.psr_from_returns(s.r, 0.0))
    assert tiles["information_ratio"]["value"] == num(relative.information_ratio(s.r, s.bench, 252))
    assert tiles["tracking_error"]["value"] == num(relative.tracking_error(s.r, s.bench, 252))


def test_every_kpi_names_its_basis_unit_and_tag(api):
    for path in ("/api/analytics/hypothesis/volmanaged_v0", f"/api/analytics/run/{RUNS['sized']}"):
        body = get(api, path)
        assert body["basis"] in ("A", "B") and body["unit"]
        for tile in body["kpis"]:
            assert tile["basis"] == body["basis"] and tile["unit"], (path, tile)
            assert tile["tag"] in ("[POST HOC]", "[PRE-REG]"), (path, tile)


def test_sharpe_interval_is_the_pf4_function(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    lo, hi = perf.sharpe_ci(s.r, 252)
    assert (body["ci"]["lo"], body["ci"]["hi"]) == (num(lo), num(hi))
    assert body["ci"]["sharpe"] == num(perf.sharpe(s.r, 252)) and body["ci"]["z"] == perf.CI_Z


def test_equity_drawdown_and_table_equal_the_part_a_functions(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    assert body["equity"]["equity"] == nums(perf.equity_curve(s.r, "A", 1.0))
    assert body["equity"]["bench"] == nums(perf.equity_curve(s.bench, "A", 1.0))
    assert body["equity"]["date"] == [d.strftime("%Y-%m-%d") for d in s.r.index]
    assert body["equity"]["t"] == [int(d.timestamp()) for d in s.r.index]
    assert body["drawdown"]["dd"] == nums(drawdown.underwater(s.r, "A"))
    assert body["drawdown"]["bench_dd"] == nums(drawdown.underwater(s.bench, "A"))
    table = drawdown.drawdown_table(s.r, "A")
    assert len(body["drawdown_table"]) == len(table)
    for got, want in zip(body["drawdown_table"], table):
        assert got["depth"] == want["depth"] and got["length"] == want["length"] and got["open"] == want["open"]
        assert got["trough"] == want["trough"].strftime("%Y-%m-%d")


def test_rolling_monthly_distribution_and_risk_equal_the_part_a_functions(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    panel = rolling.rolling_panel(s.r, 252)
    assert body["rolling"]["windows"] == [63, 252] and body["rolling"]["window_unit"] == "sessions"
    for key, line in (("sharpe_short", "sharpe_63"), ("sharpe_long", "sharpe_252"), ("vol_short", "vol_63"),
                      ("vol_long", "vol_252")):
        assert body["rolling"][key] == nums(panel[line]), key
    bands = body["rolling"]["sharpe_bands"]
    assert [b["window"] for b in bands] == [63, 252] and "if the full-sample Sharpe held" in body["rolling"]["band_label"]
    for got, w in zip(bands, (63, 252)):
        want = rolling.sharpe_band(s.r, w, 252)
        assert (got["lo"], got["hi"], got["se"], got["centre"]) == (want["lo"], want["hi"], want["se"], want["centre"])
    grid = distribution.monthly_heatmap(s.r, "A")
    assert body["monthly"]["years"] == [int(y) for y in grid.index]
    assert body["monthly"]["grid"] == [nums(row) for row in grid.to_numpy()]
    yearly = distribution.yearly_returns(s.r, "A")
    assert [(y["year"], y["value"]) for y in body["monthly"]["yearly"]] == list(zip(map(int, yearly.index),
                                                                                    nums(yearly)))
    hist = distribution.histogram(s.r)
    assert body["distribution"]["histogram"]["edges"] == nums(hist["edges"])
    assert body["distribution"]["histogram"]["counts"] == [int(c) for c in hist["counts"]]
    assert body["distribution"]["histogram"]["normal"] == nums(hist["normal"])
    assert body["risk"]["var_95"] == num(risk.var_table(s.r)["var_95"])
    assert body["risk"]["cvar_99"] == num(risk.var_table(s.r)["cvar_99"])
    tails = risk.loss_distribution(s.r)
    assert body["risk"]["tails21"]["n"] == tails["n"]
    assert body["risk"]["tails21"]["shortfall_5pct"] == num(tails["shortfall_5pct"])


def test_qq_is_scipy_probplot_against_the_normal(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    (osm, osr), (slope, intercept, r) = sps.probplot(s.r.to_numpy(), dist="norm")
    qq = body["distribution"]["qq"]
    assert qq["theoretical"] == nums(osm) and qq["ordered"] == nums(osr)
    assert (qq["slope"], qq["intercept"], qq["r"]) == (num(slope), num(intercept), num(r))


def test_stats_table_is_pf10(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    want = perf.stats_table(s.r, "A", 252)
    got = body["distribution"]["stats"]
    for key, value in want.items():
        assert got[key] == (value if isinstance(value, int) else num(value)), key


def test_relative_and_validity_equal_the_part_a_functions(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    rel = relative.relative_summary(s.r, s.bench, periods=252)
    got = body["relative"]
    assert got["bench_label"] == s.bench_label and got["n"] == rel["n"] and got["lags"] == [5, 21]
    assert got["alpha"]["alpha_annual_pct"] == num(rel["alpha"]["alpha_annual_pct"])
    assert got["alpha"]["t_min"] == num(rel["alpha"]["t_min"])
    assert got["alpha"]["t"] == {k: num(v) for k, v in rel["alpha"]["t"].items()}
    assert got["blocks"]["2010-13"]["n"] == rel["blocks"]["2010-13"]["n"]
    plain = validity.validity_summary(s.r, None, 252)
    paired = validity.validity_summary(s.r, s.bench, 252)
    assert body["validity"]["psr"]["at_zero"] == num(plain["psr"]["at_zero"])
    assert body["validity"]["psr"]["at_benchmark"] == num(paired["psr"]["at_benchmark"])
    assert body["validity"]["min_trl"]["at_zero"]["reachable"] == plain["min_trl"]["at_zero"]["reachable"]
    assert body["validity"]["moments"]["kurt"] == num(plain["sharpe_ci"]["moments"]["kurt"])


def test_registry_adjustments_come_from_the_registry(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    entry = body["validity"]["registry"]
    row = next(r for r in fixture_research().registry_rows() if r.name == "volmanaged_v0")
    assert entry["tag"] == "[PRE-REG]" and entry["family_k"] == row.family_k
    assert (entry["stored_bonferroni_p"], entry["stored_holm_p"], entry["stored_bh_q"]) == (
        row.bonferroni_p, row.holm_p, row.bh_q)
    frame = pd.DataFrame([r.model_dump() for r in fixture_research().registry_rows()])
    computed = validity.registry_adjustments(frame)["rows"].set_index("name").loc["volmanaged_v0"]
    assert entry["computed_bh_q"] == num(computed["bh_q"]) and entry["computed_holm_p"] == num(computed["holm_p"])
    assert entry["matches"] is True


# ---------------------------------------------------------------- BR1: stored alpha read from the screen JSON


def test_stored_alpha_is_read_from_the_screen_and_heads_the_alpha_tiles(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    screen = fixture_research().detail("volmanaged_v0").screen
    stored = screen["headline"]["1tick"]["alpha"]
    got = body["stored_alpha"]
    assert got["tag"] == "[PRE-REG]" and got["path"] == "headline.1tick.alpha"
    assert (got["n"], got["a"], got["alpha_annual_pct"], got["t_min"]) == (
        stored["n"], stored["a"], stored["alpha_annual_pct"], stored["t_min"])
    assert [b["block"] for b in got["blocks"]] == ["2010-13", "2014-17", "2018-21"]
    tiles = kpis(body)
    assert tiles["alpha_t"]["value"] == stored["t_min"] and tiles["alpha_t"]["tag"] == "[PRE-REG]"
    assert tiles["alpha_annual"]["value"] == stored["alpha_annual_pct"]


def test_stored_alpha_absent_at_an_unrecorded_cost_falls_back_to_the_computed_fit():
    screen = {"headline": {"1tick": {"alpha": {"n": 3, "a": 0.1, "t": {"5": 1.0}, "t_min": 1.0}}}}
    assert stored_alpha.stored_fit("volmanaged_v0", 1, screen).t_min == 1.0
    assert stored_alpha.stored_fit("volmanaged_v0", 1, {"headline": {}}) is None  # missing path: None, not a guess
    assert stored_alpha.stored_fit("overnight_v0", 1, screen) is None  # no stored alpha for this screen


def test_every_stored_alpha_path_resolves_on_the_real_screens():
    research = ResearchService(ROOT)
    for name, shape in stored_alpha.SHAPES.items():
        screen = research.detail(name).screen
        for cost in shape.paths:
            found = stored_alpha.stored_fit(name, cost, screen)
            assert found is not None and found.n and found.t_min is not None, (name, cost)
            want = 3 if shape.blocks and cost == shape.blocks_cost else 0
            assert len(found.blocks) == want, (name, cost)


def test_a_mistyped_stored_alpha_path_is_caught():
    """Born failing: the same walk over a table with one path typo finds the gap."""
    screen = ResearchService(ROOT).detail("volmanaged_v0").screen
    broken = copy.deepcopy(screen)
    broken["headline"]["1tick"].pop("alpha")
    assert stored_alpha.stored_fit("volmanaged_v0", 1, screen) is not None
    assert stored_alpha.stored_fit("volmanaged_v0", 1, broken) is None


# ---------------------------------------------------------------- real anchors through the API


def test_volmanaged_anchor_through_the_api(real_api):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    assert body["n"] == 2686 and abs(kpis(body)["sharpe"]["value"] - R_M_1) <= ANCHOR
    stored = body["stored_alpha"]
    assert abs(body["relative"]["alpha"]["alpha_annual_pct"] - stored["alpha_annual_pct"]) <= ANCHOR
    assert abs(body["relative"]["alpha"]["t_min"] - stored["t_min"]) <= ANCHOR
    for block in stored["blocks"]:
        computed = body["relative"]["blocks"][block["block"]]["alpha_annual_pct"]
        assert abs(computed - block["alpha_annual_pct"]) <= ANCHOR, block


def test_dtsmom_monthly_anchor_through_the_api(real_api):
    body = get(real_api, "/api/analytics/hypothesis/dtsmom_v0", cost=1)
    assert (body["periods_per_year"], body["n"]) == (12, 120)
    assert abs(kpis(body)["sharpe"]["value"] - R_TS_1) <= ANCHOR
    assert body["relative"]["lags"] == [4] and body["risk"]["tails21"] is None
    assert body["stored_alpha"]["path"] == "control"


def test_sqrt_365_is_not_a_valid_annualisation(real_api):
    """Born failing (QA protocol 4): a sqrt(365) Sharpe misses the anchor the API meets."""
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0", cost=1)
    wrong = kpis(body)["sharpe"]["value"] * math.sqrt(365 / 252)
    assert abs(wrong - R_M_1) > 0.1 and abs(kpis(body)["sharpe"]["value"] - R_M_1) <= ANCHOR


# ---------------------------------------------------------------- one-contract series: no K


def test_one_contract_series_has_no_capital_numbers(api):
    body = get(api, "/api/analytics/hypothesis/overnight_v0", cost=1)
    s = series.hypothesis_series(fixture_research(), "overnight_v0", 1)
    assert body["on_capital"] is False and body["unit"] == "USD per session, one NQ contract"
    tiles = kpis(body)
    for key in ("total_return", "cagr", "calmar", "alpha_annual"):
        assert tiles[key]["value"] is None and tiles[key]["note"], key
    assert body["equity"]["equity"] == nums(np.cumsum(s.r.to_numpy()))
    assert body["relative"] is None and body["equity"]["bench"] is None  # fixture mode without a price source


def test_one_contract_benchmark_goes_through_the_gate(tmp_path):
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    body = get(make_client(FIXTURES, serve), "/api/analytics/hypothesis/overnight_v0", cost=1)
    assert body["bench_label"] == series.NQ_BH_USD_LABEL and body["relative"] is not None
    assert serve.served and all(c.caller == "terminal" for c in serve.calls)


# ---------------------------------------------------------------- Basis B runs


def test_run_analytics_are_basis_b_and_end_at_the_final_balance(api):
    run_id = RUNS["sized"]
    body = get(api, f"/api/analytics/run/{run_id}")
    s = series.run_series(fixture_runs(), fixture_research(), run_id)
    doc = result_doc(run_id)
    assert (body["basis"], body["capital"], body["n"]) == ("B", s.capital, s.n)
    assert body["equity"]["equity"] == nums(perf.equity_curve(s.r, "B", s.capital))
    assert body["equity"]["equity"][-1] == pytest.approx(doc["balance_check"]["final_usd"], rel=1e-12)
    tiles = kpis(body)
    assert tiles["total_return"]["value"] == num(perf.total_return(s.r, "B"))
    assert tiles["max_drawdown"]["value"] == num(drawdown.max_drawdown(s.r, "B"))
    assert body["stored_alpha"] is None and body["validity"]["registry"] is None


def test_run_month_frequency_compounds_months(api):
    run_id = RUNS["za_orb"]
    body = get(api, f"/api/analytics/run/{run_id}", freq="M")
    s = series.run_series(fixture_runs(), fixture_research(), run_id)
    months = distribution.monthly_returns(s.r, "B")
    assert (body["periods_per_year"], body["n"], body["context"]["freq"]) == (12, len(months), "M")
    assert body["distribution"]["histogram"]["counts"] == [int(c) for c in distribution.histogram(months)["counts"]]
    assert kpis(body)["sharpe"]["value"] == num(perf.sharpe(months.to_numpy(), 12))


def test_intraday_run_benchmark_is_nq_through_the_gate(tmp_path):
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    body = get(make_client(FIXTURES, serve), f"/api/analytics/run/{RUNS['za_orb']}")
    assert body["bench_label"] == series.NQ_BH_LABEL
    assert body["relative"]["n"] > 2000 and all(c.caller == "terminal" for c in serve.calls)


def test_real_sized_run_uses_its_paired_run(real_api):
    body = get(real_api, "/api/analytics/run/nt_volmanaged_v0_final_m1")
    assert body["bench_label"] == "paired run nt_volmanaged_v0_final_bh1 (same-exposure buy and hold)"
    assert body["relative"]["information_ratio"] is not None


# ---------------------------------------------------------------- HOME [B] panel


def test_home_panel_equals_the_part_a_functions(api):
    body = get(api, "/api/analytics/hypothesis/volmanaged_v0/panel", cost=1)
    s = series.hypothesis_series(fixture_research(), "volmanaged_v0", 1)
    assert (body["basis"], body["unit"], body["n"]) == ("A", s.unit, s.n)
    assert body["equity"] == nums(perf.equity_curve(s.r, "A", 1.0))
    assert body["underwater"] == nums(drawdown.underwater(s.r, "A"))
    assert body["bench_underwater"] == nums(drawdown.underwater(s.bench, "A"))
    assert body["rolling_sharpe"] == nums(rolling.rolling_sharpe(s.r, 252, 252)) and body["rolling_window"] == 252
    assert body["sharpe"] == num(perf.sharpe(s.r, 252)) and body["bench_sharpe"] == num(perf.sharpe(s.bench, 252))
    run = get(api, f"/api/analytics/run/{RUNS['sized']}/panel")
    assert run["basis"] == "B" and run["unit"]


# ---------------------------------------------------------------- errors


@pytest.mark.parametrize("path", ["/api/analytics/hypothesis/nope", "/api/analytics/hypothesis/nope/panel",
                                  "/api/analytics/run/nt_nope", "/api/analytics/run/nt_nope/panel",
                                  "/api/analytics/run/..%2F..", "/api/analytics/hypothesis/volmanaged_v0?cost=9"])
def test_unknown_names_and_bad_parameters_are_refused(api, path):
    assert api.get(path).status_code in (404, 422), path


def test_an_unrecorded_cost_is_404(real_api):
    assert real_api.get("/api/analytics/hypothesis/za_v0", params={"cost": 0}).status_code == 404  # za_v0: 1 only


def test_an_unbalanced_run_is_unusable(api):
    r = api.get(f"/api/analytics/run/{RUNS['unbalanced']}")
    assert r.status_code == 422 and "rule 4" in r.json()["detail"]


def test_bad_frequency_is_422(api):
    assert api.get(f"/api/analytics/run/{RUNS['sized']}", params={"freq": "W"}).status_code == 422
