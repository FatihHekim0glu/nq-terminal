"""`GET /api/analytics/power` (the SV9 table, served) and `GET /api/analytics/plan` (the pre-registration planner),
research_ux.md item 2.

- `/power` serves the table the browser used to compute: one row per registered trial of the Deflated Sharpe view, the
  family alpha and k from the registry; every figure equals `analytics/power.py`, which equals scipy at 1e-12;
- `/plan` reads nothing (no price, no gate, no data file): its inputs are query parameters with a bound each, the
  registry's family size is the one count it reads, and its answer equals `qa/crosscheck/p12_plan.py` (scipy) over a grid.

Born failing: every bound is refused one step outside its range (and `periods` 365 with it); the bar at the next slot of
the family is alpha / (k + 1).
"""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.analytics import power, series
from nq_terminal.api import analytics as analytics_api
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from conftest import api_client
from fakes import FIXTURES, FakeCatalog, make_fake_serve

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
QA_DIR = Path(__file__).resolve().parents[2] / "qa"
REFERENCE_PATH = QA_DIR / "crosscheck" / "p12_plan.py"
GOLDEN = QA_DIR / "golden" / "p12_power.json"
POWER_ROUTE = "/api/analytics/power"
PLAN_ROUTE = "/api/analytics/plan"
SAMPLE_EVERY = 37  # every 37th design of the grid goes through HTTP; the whole grid goes through the function


def client_for(serve=None) -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    if serve is not None:
        app.state.serve_fn = serve
        app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def serve(tmp_path_factory):
    return make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")


@pytest.fixture(scope="module")
def api(serve) -> TestClient:
    return client_for(serve)


@pytest.fixture(scope="module")
def reference():
    spec = importlib.util.spec_from_file_location("p12_plan_reference", REFERENCE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get(client: TestClient, path: str, **params) -> dict:
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- the routes exist and are GET only


def test_both_routes_are_get_only_and_in_the_contract():
    paths = create_app(load_settings({})).openapi()["paths"]
    for route in (POWER_ROUTE, PLAN_ROUTE):
        assert list(paths[route]) == ["get"], route


def test_a_write_verb_is_refused(api):
    for route in (POWER_ROUTE, PLAN_ROUTE):
        assert api.post(route).status_code in (403, 405) and api.put(route).status_code in (403, 405)


def test_the_plan_parameters_are_declared_with_their_bounds_in_the_contract():
    document = create_app(load_settings({})).openapi()
    declared = {p["name"]: p["schema"] for p in document["paths"][PLAN_ROUTE]["get"]["parameters"]}
    assert set(declared) == {"periods", "n", "years", "k", "alpha", "sharpe", "event_sd"}
    assert document["components"]["schemas"]["PeriodsPerYear"]["enum"] == [252, 52, 12, 4]
    assert declared["periods"]["$ref"].endswith("/PeriodsPerYear")


# ---------------------------------------------------------------- SV9 served


def test_the_power_table_has_a_row_per_registered_trial_in_the_deflated_order(api):
    table = get(api, POWER_ROUTE)
    deflated = get(api, "/api/analytics/deflated")
    assert [r["name"] for r in table["rows"]] == [r["name"] for r in deflated["rows"]] == ["overnight_v0", "volmanaged_v0"]
    assert table["tag"] == "[POST HOC]" and table["basis"] == "A"
    assert table["power_target"] == 0.8 and table["reference_sharpe"] == 0.5


def test_the_power_family_is_the_one_the_multiple_testing_view_serves(api):
    table, family = get(api, POWER_ROUTE), get(api, "/api/multiple-testing")
    assert table["alpha"] == family["alpha"] == 0.05 and table["k"] == family["k"] == 2
    assert table["alpha_family"] == family["alpha"] / family["k"]


def test_every_power_figure_is_the_function_of_the_deflated_row(api):
    table, deflated = get(api, POWER_ROUTE), get(api, "/api/analytics/deflated")
    want = power.power_table(deflated["rows"], table["alpha"], table["k"])
    assert table == want
    for got, row in zip(table["rows"], deflated["rows"]):
        assert (got["periods"], got["n"], got["sharpe"]) == (row["periods"], row["n"], row["annual_sharpe"])
        assert got["mde_nominal"] == power.minimum_detectable_sharpe(row["n"], row["periods"], 0.05, 0.8)
        assert got["mde_family"] == power.minimum_detectable_sharpe(row["n"], row["periods"], 0.05 / 2, 0.8)
        assert got["power_family"] == power.power_at_sharpe(0.5, row["n"], row["periods"], 0.05 / 2)


def test_the_served_table_equals_the_golden_vectors_of_scipy_at_1e_12(monkeypatch):
    """qa/golden/p12_power.json against the served SV9: the golden's 24 books (the 21 real rows and three edge cases)
    are the Deflated Sharpe rows the route reads, and every served MDE and power equals scipy to 1e-12."""
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    books = [(c["n"], c["periods"]) for c in golden["mde"] if c["alpha"] == 0.05 and c["power"] == 0.8]
    rows = [{"name": f"book{i}", "kind": "daily", "periods": periods, "n": n, "annual_sharpe": 0.5}
            for i, (n, periods) in enumerate(books)]
    monkeypatch.setattr(analytics_api, "cached_deflated", lambda state: json.dumps({"rows": rows}).encode())
    monkeypatch.setattr(analytics_api, "registry_family_k", lambda state: (21, None))
    table = client_for().get(POWER_ROUTE).json()
    assert table["k"] == 21 and table["alpha_family"] == 0.05 / 21 and len(table["rows"]) == len(books) == 24
    mde = {(c["n"], c["periods"], c["alpha"]): c["value"] for c in golden["mde"] if c["power"] == 0.8}
    pwr = {(c["n"], c["periods"], c["alpha"]): c["value"] for c in golden["power"] if c["sharpe"] == 0.5}
    for row, (n, periods) in zip(table["rows"], books):
        for key, alpha in (("nominal", 0.05), ("family", 0.05 / 21)):
            assert math.isclose(row[f"mde_{key}"], mde[(n, periods, alpha)], rel_tol=1e-12), (n, periods, key)
            assert math.isclose(row[f"power_{key}"], pwr[(n, periods, alpha)], rel_tol=1e-12, abs_tol=1e-15), (n, periods, key)


def test_the_power_table_reads_no_price(api, serve):
    get(api, POWER_ROUTE)
    get(api, PLAN_ROUTE, n=2520)
    assert serve.calls == ()


def test_an_unbuildable_trial_refuses_the_power_table_as_it_refuses_the_deflated_view(monkeypatch):
    real = series.hypothesis_series

    def broken(research, name, cost, **kwargs):
        if name == "overnight_v0":
            raise series.SeriesError("its series file is missing (test)")
        return real(research, name, cost, **kwargs)

    monkeypatch.setattr(series, "hypothesis_series", broken)
    r = client_for().get(POWER_ROUTE)
    assert r.status_code == 503 and "overnight_v0" in r.json()["detail"]


# ---------------------------------------------------------------- the planner served


def test_the_plan_for_n_names_the_registry_family_and_the_next_slot(api):
    view = get(api, PLAN_ROUTE, n=2520)
    assert view["family_k_registry"] == get(api, "/api/multiple-testing")["k"] == 2
    assert view["registry_note"] is None
    assert [(s["source"], s["k"], s["slot"]) for s in view["slots"]] == [("registry", 2, 3)]
    assert view["slots"][0]["bonferroni"]["alpha"] == 0.05 / 3
    assert view["periods"] == 252 and view["n"] == 2520 and view["years"] == 10.0 and view["alpha"] == 0.05


def test_a_typed_family_size_is_shown_beside_the_registry(api):
    view = get(api, PLAN_ROUTE, n=2520, k=80)
    assert [(s["source"], s["k"], s["slot"]) for s in view["slots"]] == [("registry", 2, 3), ("typed", 80, 81)]
    assert view["slots"][1]["holm_strictest"]["alpha"] == 0.05 / 81 and view["slots"][1]["holm_loosest"]["alpha"] == 0.05


def test_years_stand_for_n_at_the_periods_of_the_book(api):
    by_years = get(api, PLAN_ROUTE, years=10, periods=12)
    by_n = get(api, PLAN_ROUTE, n=120, periods=12)
    assert by_years == by_n and by_years["n"] == 120
    assert get(api, PLAN_ROUTE, years=0.5, periods=4)["n"] == 2
    assert get(api, PLAN_ROUTE, years=10.66, periods=252)["n"] == 2687  # 2686.32 observations, rounded up


def test_the_typed_sharpe_and_the_event_sd_reach_the_answer(api):
    view = get(api, PLAN_ROUTE, n=787, sharpe=1.0, event_sd=14.8)
    assert view["typed_sharpe"] == 1.0 and view["event_sd"] == 14.8
    assert view["nominal"]["power_at_typed"] == power.power_at_sharpe(1.0, 787, 252, 0.05)
    assert view["nominal"]["mean_per_event"] == power.detectable_mean(14.8, 787, 0.05, 0.8)
    assert view["slots"][0]["at_slot"]["mean_per_event"] == power.detectable_mean(14.8, 787, 0.05 / 3, 0.8)
    bare = get(api, PLAN_ROUTE, n=787)
    assert bare["typed_sharpe"] is None and bare["nominal"]["mean_per_event"] is None


def test_the_wording_is_the_best_case_of_sv9(api):
    note = get(api, PLAN_ROUTE, n=2520)["note"].lower()
    assert "best case" in note and "normal" in note and "independent" in note


def test_without_a_registry_a_typed_family_size_carries_the_plan(api, monkeypatch):
    monkeypatch.setattr(analytics_api, "registry_family_k", lambda state: (None, "the registry could not be read"))
    view = get(api, PLAN_ROUTE, n=2520, k=80)
    assert view["family_k_registry"] is None and view["registry_note"] == "the registry could not be read"
    assert [s["source"] for s in view["slots"]] == ["typed"]
    r = api.get(PLAN_ROUTE, params={"n": 2520})
    assert r.status_code == 422 and "family size" in r.json()["detail"]


# ---------------------------------------------------------------- bounds: one step outside is refused


def above(value: float) -> float:
    return math.nextafter(value, math.inf)


def below(value: float) -> float:
    return math.nextafter(value, -math.inf)


# (name, lowest accepted, highest accepted, the other parameters the request needs)
BOUNDS = (
    ("n", 2, 100_000, {}),
    ("years", 0.5, 100.0, {}),
    ("k", 0, 1000, {"n": 2520}),
    ("alpha", 0.001, 0.25, {"n": 2520}),
    ("sharpe", 0.0, 5.0, {"n": 2520}),
    ("event_sd", 0.01, 10_000.0, {"n": 2520}),
)


def status(client: TestClient, **params) -> int:
    return client.get(PLAN_ROUTE, params=params).status_code


@pytest.mark.parametrize("name,low,high,rest", BOUNDS)
def test_born_failing_every_bound_is_refused_one_step_outside_its_range(api, name, low, high, rest):
    assert status(api, **{name: low}, **rest) == 200 and status(api, **{name: high}, **rest) == 200
    whole = isinstance(low, int) and isinstance(high, int)
    under, over = (low - 1, high + 1) if whole else (below(low), above(high))
    assert status(api, **{name: under}, **rest) == 422, f"{name}={under}"
    assert status(api, **{name: over}, **rest) == 422, f"{name}={over}"


def test_born_failing_365_periods_a_year_is_refused_and_so_is_every_other_number(api):
    for good in (252, 52, 12, 4):
        assert status(api, n=100, periods=good) == 200
    for bad in (365, 360, 366, 253, 251, 53, 51, 13, 11, 5, 3, 1, 0, -252):
        assert status(api, n=100, periods=bad) == 422, bad
    assert status(api, n=100, periods="daily") == 422


def test_the_book_is_given_by_n_or_by_years_never_both_never_neither(api):
    assert status(api) == 422 and status(api, periods=12) == 422
    assert status(api, n=120, years=10) == 422


def test_a_value_that_is_not_a_finite_number_is_refused(api):
    for name in ("n", "years", "k", "alpha", "sharpe", "event_sd"):
        rest = {} if name in ("n", "years") else {"n": 2520}
        for bad in ("nan", "inf", "-inf", "abc", ""):
            assert status(api, **{name: bad}, **rest) == 422, f"{name}={bad!r}"


def test_a_refusal_names_the_parameter_and_no_path(api):
    body = api.get(PLAN_ROUTE, params={"n": 1}).json()
    assert "n" in str(body["detail"]) and "\\" not in str(body) and ":/" not in str(body)


# ---------------------------------------------------------------- the served plan equals scipy


def test_the_function_equals_the_scipy_reference_over_the_whole_grid(reference):
    designs = reference.grid_inputs()
    assert len(designs) > 200
    for inputs in designs:
        want = reference.reference_plan(**inputs)
        got = power.plan(**inputs)
        assert reference.first_difference(got, want) is None, (inputs, reference.first_difference(got, want))


def test_the_route_equals_the_scipy_reference_on_a_sample_of_the_grid(api, reference):
    designs = reference.grid_inputs()[::SAMPLE_EVERY]
    assert len(designs) > 50
    for inputs in designs:
        query = {k: v for k, v in inputs.items() if v is not None and k != "k_registry"}
        query["k"] = query.pop("k_typed")
        served = get(api, PLAN_ROUTE, **query)
        for key in ("family_k_registry", "registry_note"):
            served.pop(key)
        want = reference.reference_plan(**{**inputs, "k_registry": 2})
        assert reference.first_difference(served, want) is None, (inputs, reference.first_difference(served, want))
