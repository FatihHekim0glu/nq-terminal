"""`GET /api/analytics/paper-expectation` (LV6 and LV6b served; ANALYTICS_CATALOG section 13). [POST HOC].

The route serves what the LIVE card computed in the browser from four reads (paper tracking, hypothesis card and run
list, the run analytics' capital, the hypothesis's bootstrap cone): these tests read the same routes and check that
the served placement equals `analytics.expectation.placement` on them, so the served value is the browser's.

Until the merge step registers the router in `create_app` (before the web mount), `with_route` adds it to the test
app and moves it in front of the mount; once registered, it does nothing.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_terminal.analytics import bootstrap, expectation
from nq_terminal.api import paper_expectation as route
from nq_terminal.app import create_app
from nq_terminal.models.analytics_p1 import PaperTracking
from nq_terminal.services import journals, paper_expectation
from nq_terminal.settings import load_settings

from fakes import FIXTURES

from conftest import api_client

URL = "/api/analytics/paper-expectation"
LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
HYPOTHESIS = "volmanaged_v0"
RUN = "nt_volmanaged_v0_fixture_m1"


def with_route(app):
    if URL not in app.openapi()["paths"]:
        app.include_router(route.router)
        routes = app.router.routes
        routes.insert(0, routes.pop())  # in front of the web mount at "/", as create_app orders its routers
    app.openapi_schema = None
    return app


@pytest.fixture(scope="module")
def api() -> TestClient:
    return api_client(with_route(create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))), base_url=LOCAL,
                      client=LOOPBACK)


def tracking_rows(n: int, *, lead: int = 2, seed: int = 11, gaps: tuple[int, ...] = ()) -> PaperTracking:
    """A tracking read with `lead` rows before the first value and n paper sessions after (USD per session)."""
    rng = np.random.default_rng(seed)
    total = lead + n
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-01-05", periods=total)]
    paper: list[float | None] = [None] * lead + [float(v) for v in rng.normal(30.0, 800.0, n).round(2)]
    model: list[float | None] = [None] * lead + [float(v) for v in rng.normal(30.0, 800.0, n).round(2)]
    for i in gaps:
        paper[lead + i] = model[lead + i] = None

    def running(values):
        out, acc = [], 0.0
        for v in values:
            if v is None:
                out.append(None)
            else:
                acc += v
                out.append(acc)
        return out

    diff = [None if p is None or m is None else p - m for p, m in zip(paper, model)]
    return PaperTracking(journal=journals.BOOK_JOURNAL, present=True, empty_state=None, banner="b", basis="b",
                         tag="[POST HOC]", label="l", unit="USD per session", multiplier=2.0, plumbing_rows_skipped=0,
                         t=[None] * total, date=dates, paper=paper, model=model, difference=diff,
                         paper_cumulative=running(paper), model_cumulative=running(model), n=n, total_difference=0.0,
                         tracking_sd=None)


@pytest.fixture()
def tracked(monkeypatch):
    def use(found: PaperTracking) -> PaperTracking:
        monkeypatch.setattr(paper_expectation.tearsheet_trades, "paper_tracking_view", lambda monitor, file: found)
        return found
    return use


def get(api: TestClient, **params) -> dict:
    r = api.get(URL, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- the route itself


def test_the_route_is_get_only(api):
    assert set(api.app.openapi()["paths"][URL]) == {"get"}
    assert set(route.router.routes[0].methods) == {"GET"} and len(route.router.routes) == 1
    assert api.post(URL).status_code in (403, 405)


def test_the_fixture_journal_has_no_value_yet_so_both_cones_are_absent(api):
    body = get(api)
    assert body["tag"] == "[POST HOC]" and body["journal"] == journals.BOOK_JOURNAL
    assert body["refusal"] == {"code": "empty", "params": {}}
    assert body["backtest"] is None and body["live"] is None and body["hypothesis"] == HYPOTHESIS


def test_an_unknown_journal_is_404_and_the_name_is_not_echoed(api):
    r = api.get(URL, params={"file": "nope_<script>.jsonl"})
    assert r.status_code == 404 and "nope" not in r.text and "script" not in r.text


def test_a_journal_no_hypothesis_owns_is_refused_in_words(api):
    body = get(api, file="preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl")
    assert body["refusal"]["code"] in ("empty", "no_book") and body["backtest"] is None


# ---------------------------------------------------------------- equal to what the browser computed from four reads


def test_the_served_placement_equals_the_browser_arithmetic_on_the_same_reads(api, tracked):
    paper_expectation.CONES.clear()
    found = tracked(tracking_rows(40)).model_dump()
    body = get(api)
    capital = get_json(api, f"/api/analytics/run/{RUN}", freq="D")["capital"]
    boot = get_json(api, f"/api/analytics/hypothesis/{HYPOTHESIS}/bootstrap", cost=1)
    assert body["refusal"] is None
    assert (body["hypothesis"], body["cost"], body["run_id"], body["capital"]) == (HYPOTHESIS, 1, RUN, capital)
    want = expectation.placement(found, capital, boot["cone"])
    assert body["backtest"]["placement"] == want
    assert body["backtest"]["cone"] == boot["cone"]
    assert body["backtest"]["block"] == boot["block"]["stationary"]
    assert body["backtest"]["source_n"] == boot["n"]


def test_the_live_start_cone_is_sv6_on_the_paper_book_and_takes_both_paths(api, tracked):
    found = tracked(tracking_rows(45, gaps=(7,))).model_dump()
    body = get(api)
    live = body["live"]
    want = expectation.live_start_cone(found["date"], found["paper"], body["capital"])
    assert live["refusal"] is None and live["start"] == "live"
    assert live["source_n"] == 44 and live["source_start"] == found["date"][2] == want["start_date"]
    assert live["cone"]["quantiles"] == want["quantiles"] and live["cone"]["horizon"] == 44
    assert live["cone"]["unit"] == "fraction of K" and live["cone"]["how"] == "summed"
    assert live["block"] == want["block"] and live["reps"] == bootstrap.REPS and live["seed"] == bootstrap.SEED
    assert live["placement"] == expectation.live_placement(found, body["capital"], want)
    assert live["placement"]["latest_step"] == 44 == live["placement"]["horizon"] and live["placement"]["beyond"] == 0


def test_born_failing_a_short_paper_book_gets_the_backtest_cone_but_no_live_cone(api, tracked):
    tracked(tracking_rows(12))
    body = get(api)
    assert body["backtest"]["placement"] is not None
    assert body["live"]["cone"] is None and body["live"]["placement"] is None
    assert body["live"]["refusal"] == {"code": "live_short", "params": {"n": "12", "min": "30"}}


def test_the_backtest_cone_is_built_once_while_the_series_is_unchanged(api, tracked, monkeypatch):
    paper_expectation.CONES.clear()
    calls = []
    real = paper_expectation.tearsheet_extended.bootstrap_view
    monkeypatch.setattr(paper_expectation.tearsheet_extended, "bootstrap_view",
                        lambda s, c: calls.append(c) or real(s, c))
    tracked(tracking_rows(31))
    first, second = get(api), get(api)
    assert len(calls) == 1 and first["backtest"] == second["backtest"]


def test_the_route_reads_no_price_on_the_real_files(tracked, tmp_path):
    """Real research and run files (read only) with the tests' fake serve: the served view needs no gate read."""
    from fakes import make_fake_serve
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    app = with_route(create_app(load_settings({})))
    app.state.serve_fn = serve
    real = api_client(app, base_url=LOCAL, client=LOOPBACK)
    tracked(tracking_rows(35))
    body = get(real)
    assert body["refusal"] is None and body["backtest"]["placement"] is not None, body["refusal"]
    assert body["backtest"]["source_end"] <= "2021-12-31"
    assert len(serve.calls) == 0
    boot = get_json(real, f"/api/analytics/hypothesis/{HYPOTHESIS}/bootstrap", cost=body["cost"])
    assert body["backtest"]["cone"] == boot["cone"]  # the same cone as the tear sheet's bootstrap route


def get_json(api: TestClient, path: str, **params) -> dict:
    r = api.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- the refusals, in the browser's order


class Card:
    def __init__(self, costs=(0, 1, 2), runs=(RUN,)):
        self.series_costs = list(costs)
        self.nautilus_runs = list(runs)


def view(found: PaperTracking, *, file=journals.BOOK_JOURNAL, card=None, runs=None, capital=1e6, series=None):
    reads: list[str] = []

    def read_card(name):
        reads.append("card")
        return card or Card()

    def read_runs():
        reads.append("runs")
        return runs if runs is not None else [{"run_id": RUN, "is_probe": False, "balance_ok": True, "readable": True}]

    def read_capital(run_id):
        reads.append("capital")
        return capital

    def read_series(name, cost):
        raise AssertionError("no cone is read when the gate refuses")

    class Monitor:
        pass

    original = paper_expectation.tearsheet_trades.paper_tracking_view
    paper_expectation.tearsheet_trades.paper_tracking_view = lambda monitor, f: found
    try:
        out = paper_expectation.expectation_view(Monitor(), file, card=read_card, run_summaries=read_runs,
                                                 run_capital=read_capital,
                                                 hypothesis_series=series or read_series)
    finally:
        paper_expectation.tearsheet_trades.paper_tracking_view = original
    return out, reads


def test_no_card_is_read_for_a_journal_no_hypothesis_owns():
    out, reads = view(tracking_rows(5), file="other_journal.jsonl")
    assert out.refusal.code == "no_book" and reads == []


def test_a_hypothesis_without_a_cost_reads_no_run():
    out, reads = view(tracking_rows(5), card=Card(costs=()))
    assert out.refusal.code == "no_cost" and out.refusal.params == {"hypothesis": HYPOTHESIS} and reads == ["card"]


def test_no_usable_run_and_no_capital_are_refused_naming_the_run():
    out, _ = view(tracking_rows(5), runs=[{"run_id": RUN, "is_probe": True, "balance_ok": True, "readable": True}])
    assert out.refusal.code == "no_run" and out.run_id is None
    for capital in (None, 0.0, -5.0, math.nan):
        out, _ = view(tracking_rows(5), capital=capital)
        assert out.refusal.code == "no_capital" and out.refusal.params == {"run": RUN}
        assert out.capital is None or out.capital <= 0


def test_k_comes_from_the_run_and_not_from_a_constant():
    s = paper_expectation  # the backtest cone needs a series; use a seeded one, labelled not research data
    rng = np.random.default_rng(3)
    idx = pd.bdate_range("2015-01-02", periods=300)
    from nq_terminal.analytics.series import SessionSeries
    fake = SessionSeries(name="synthetic", basis="A", periods=252, r=pd.Series(rng.normal(0, 0.01, 300), index=idx),
                         unit="fraction of K", on_capital=True, capital=None, source="seeded, not research data",
                         kind="daily", label="synthetic")
    s.CONES.clear()
    found = tracking_rows(30)
    half, _ = view(found, capital=500_000.0, series=lambda n, c: fake)
    full, _ = view(found, capital=1_000_000.0, series=lambda n, c: fake)
    assert half.capital == 500_000.0 and full.capital == 1_000_000.0
    p_half, p_full = half.backtest.placement.paper.fraction, full.backtest.placement.paper.fraction
    assert p_half[0] == pytest.approx(2 * p_full[0], rel=1e-15)
