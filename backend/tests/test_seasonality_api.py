"""SEAS over the API (TASKS Phase 11): `/api/seasonality/instrument/{root}` and `/api/seasonality/hypothesis/{name}`.

`create_app` includes the router before the web mount; these tests use a fixture-mode app with the
fake serve (temporary log) and the fake catalog. Checks: every price read is a gated serve with caller "terminal"
and nothing after 2021; the calendar panels equal an independent pandas grouping of the same returns; the 30-minute
buckets drop the gated sessions of the fixture's `qa.day_gate` files; no key anywhere looks like a test statistic
or a p-value; refusals (unknown root, a variant with no series, a year past 2021, start after end) come before any
serve.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.sessions import nyse_sessions
from nq_terminal.api import seasonality as seas_api
from nq_terminal.app import create_app
from nq_terminal.services import seasonality as seas_service
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve, synthetic_loader

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
YEAR = 2020
FORBIDDEN_KEY = re.compile(r"p_?value|pval|t_?stat|z_?score|welch|significan", re.IGNORECASE)


def build(tmp: Path, exclusions=None):
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    serve = make_fake_serve(tmp / "oos_access_log.jsonl")
    app.state.serve_fn = serve
    app.state.catalog = FakeCatalog()
    if exclusions is not None:
        app.state.seasonality_exclusions = exclusions
    return TestClient(app, base_url=LOCAL, client=LOOPBACK), serve


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    return build(Path(tmp_path_factory.mktemp("seas-log")))


@pytest.fixture(scope="module")
def nq(ctx) -> dict:
    client, _ = ctx
    response = client.get("/api/seasonality/instrument/NQ", params={"start_year": YEAR, "end_year": YEAR})
    assert response.status_code == 200, response.text
    return response.json()


def keys_of(value) -> list[str]:
    if isinstance(value, dict):
        return [k for k, v in value.items()] + [k for v in value.values() for k in keys_of(v)]
    if isinstance(value, list):
        return [k for v in value for k in keys_of(v)]
    return []


def panel(body: dict, pid: str) -> dict:
    return next(p for p in body["panels"] if p["id"] == pid)


def daily_nq(year: int) -> pd.Series:
    frame = synthetic_loader("NQ.V.0", "1d", "vendor")(pd.Timestamp("2010-01-01", tz="UTC"),
                                                         pd.Timestamp("2022-01-01", tz="UTC"))
    p = build_panel({"NQ.V.0": frame}, master_days(dt.date(2010, 1, 1), dt.date(2021, 12, 31)))
    r = pd.Series(p.r[:, 0], index=pd.DatetimeIndex([pd.Timestamp(d) for d in p.days]))
    r = r[np.isfinite(r.to_numpy())]
    return r[r.index.year == year]


def test_routes_are_get_only():
    methods = {m for route in seas_api.router.routes for m in route.methods}
    assert methods == {"GET"}
    assert seas_api.router.prefix == "/api/seasonality"


def test_label_basis_and_no_test_statistic_anywhere(nq):
    assert nq["label"].startswith("[POST HOC]")
    assert nq["kind"] == "instrument" and nq["subject"] == "NQ.V.0" and nq["variant"] == "repaired"
    assert nq["fraction"] is True and nq["aggregation"] == "compound"
    assert "standard error" in nq["error_bar"]
    assert not [k for k in keys_of(nq) if FORBIDDEN_KEY.search(k)]
    assert "p-value" not in json.dumps(nq).replace("no p-value", "")


def test_every_read_is_a_gated_terminal_serve_before_the_fence(ctx, nq):
    _, serve = ctx
    assert serve.served and not serve.refusals
    assert all(c.caller == "terminal" for c in serve.calls)
    assert all(c.end <= pd.Timestamp("2022-01-01", tz="UTC") for c in serve.calls)
    assert {c.timeframe for c in serve.served} == {"1d", "1m"}
    assert nq["gate"]["caller"] == "terminal" and nq["last"] <= "2021-12-31"


def test_weekday_and_week_of_month_equal_a_pandas_grouping(nq):
    r = daily_nq(YEAR)
    grouped = r.groupby(r.index.weekday)
    for bucket in panel(nq, "weekday")["buckets"]:
        g = grouped.get_group(bucket["key"])
        assert bucket["n"] == len(g)
        assert math.isclose(bucket["mean"], g.mean(), rel_tol=1e-12)
        assert math.isclose(bucket["se"], g.std(ddof=1) / math.sqrt(len(g)), rel_tol=1e-12)
        assert math.isclose(bucket["hit_rate"], float((g > 0).mean()), rel_tol=1e-12)
    weeks = r.groupby((r.index.day - 1) // 7 + 1).size()
    assert [b["n"] for b in panel(nq, "week_of_month")["buckets"]] == [int(weeks.get(k, 0)) for k in range(1, 6)]
    assert nq["sessions"] == len(r)


def test_month_panel_and_heatmap_compound_the_sessions(nq):
    r = daily_nq(YEAR)
    monthly = (1 + r).groupby(r.index.month).prod() - 1
    heat = nq["heatmap"]
    assert heat["years"] == [YEAR] and len(heat["months"]) == 12
    assert np.allclose(heat["values"][0], monthly.reindex(range(1, 13)).to_numpy(), rtol=1e-12, atol=0)
    months = panel(nq, "month")["buckets"]
    assert all(b["n"] == 1 and b["se"] is None for b in months)  # one year: one value per month, no error bar
    assert math.isclose(months[0]["mean"], monthly[1], rel_tol=1e-12)


def gated_days(year: int) -> set[dt.date]:
    doc = json.loads((FIXTURES / "results" / "screens" / "za_v0_repaired_rejected_days.json").read_text("utf-8"))
    return {dt.date.fromisoformat(d[:10]) for d in doc if d[:4] == str(year)}


def test_intraday_buckets_drop_the_gated_sessions(nq):
    intraday = panel(nq, "intraday")
    assert intraday["available"] and len(intraday["buckets"]) == 13
    table = nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31))
    gated = gated_days(YEAR) & set(table.index)
    assert intraday["excluded_sessions"] == len(gated)
    assert "qa.day_gate" in intraday["source"]
    frame = synthetic_loader("NQ.V.0", "1m", "repaired")(pd.Timestamp(f"{YEAR}-01-01", tz="UTC"),
                                                         pd.Timestamp(f"{YEAR + 1}-01-01", tz="UTC"))
    rows = []
    for day, s in table.iterrows():
        if day in gated:
            continue
        part = frame[(frame["ts"] >= s["open_utc"]) & (frame["ts"] < s["close_utc"])]
        for b, g in part.groupby((part["ts"] - s["open_utc"]) // pd.Timedelta(minutes=30)):
            d_b = g["c"].iloc[-1] - g["o"].iloc[0]
            rows.append((int(b), d_b / (g["raw_c"].iloc[-1] - d_b)))
    expected = pd.DataFrame(rows, columns=["bucket", "r"]).groupby("bucket")["r"]
    for bucket in intraday["buckets"]:
        assert bucket["n"] == expected.size().get(bucket["key"], 0)
        if bucket["n"]:
            assert math.isclose(bucket["mean"], expected.mean()[bucket["key"]], rel_tol=1e-9)


def test_born_failing_without_the_exclusions_the_counts_differ(nq, tmp_path):
    none = seas_service.Exclusions(assessed=True, days=frozenset(), source="none (test)")
    client, _ = build(tmp_path, exclusions=lambda symbol, variant: none)
    body = client.get("/api/seasonality/instrument/NQ", params={"start_year": YEAR, "end_year": YEAR}).json()
    ours = sum(b["n"] for b in panel(nq, "intraday")["buckets"])
    unfiltered = sum(b["n"] for b in panel(body, "intraday")["buckets"])
    assert gated_days(YEAR) and unfiltered > ours


def test_a_symbol_without_session_qa_gets_no_intraday_panel(ctx):
    client, _ = ctx
    body = client.get("/api/seasonality/instrument/ES", params={"start_year": YEAR, "end_year": YEAR}).json()
    intraday = panel(body, "intraday")
    assert body["variant"] == "vendor" and intraday["available"] is False and intraday["buckets"] == []
    assert intraday["note"]
    assert panel(body, "weekday")["available"]


def test_an_injected_exclusion_list_is_applied(tmp_path):
    table = nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31))
    drop = frozenset(list(table.index)[:10])
    client, _ = build(tmp_path, exclusions=lambda s, v: seas_service.Exclusions(True, drop, "repair provenance"))
    body = client.get("/api/seasonality/instrument/ES", params={"start_year": YEAR, "end_year": YEAR}).json()
    intraday = panel(body, "intraday")
    assert intraday["available"] and intraday["excluded_sessions"] == 10
    assert max(b["n"] for b in intraday["buckets"]) == len(table) - 10


@pytest.mark.parametrize("path, params, status", [
    ("/api/seasonality/instrument/RTY", {}, 404),
    ("/api/seasonality/instrument/nq", {}, 422),
    ("/api/seasonality/instrument/ES", {"variant": "repaired"}, 404),
    ("/api/seasonality/instrument/NQ", {"end_year": 2022}, 422),
    ("/api/seasonality/instrument/NQ", {"start_year": 2009}, 422),
    ("/api/seasonality/instrument/NQ", {"start_year": 2015, "end_year": 2014}, 422),
    ("/api/seasonality/hypothesis/not_a_hypothesis", {}, 404),
    ("/api/seasonality/hypothesis/volmanaged_v0", {"cost": 9}, 422),
])
def test_refusals_come_before_any_serve(tmp_path, path, params, status):
    client, serve = build(tmp_path)
    assert client.get(path, params=params).status_code == status
    assert serve.calls == ()


def test_a_hypothesis_series_groups_its_recorded_sessions(ctx):
    client, serve = ctx
    before = len(serve.calls)
    body = client.get("/api/seasonality/hypothesis/volmanaged_v0", params={"cost": 1}).json()
    assert body["kind"] == "hypothesis" and body["aggregation"] == "sum" and body["cost"] == 1
    assert body["label"].startswith("[POST HOC]") and body["gate"] is None
    assert panel(body, "intraday")["available"] is False
    assert sum(b["n"] for b in panel(body, "weekday")["buckets"]) == body["sessions"] == 39
    assert len(serve.calls) == before  # a hypothesis series reads no price


def test_a_usd_series_is_not_a_fraction(ctx):
    client, _ = ctx
    body = client.get("/api/seasonality/hypothesis/overnight_v0", params={"start_year": 2012,
                                                                           "end_year": 2013}).json()
    assert body["fraction"] is False and body["unit"].startswith("USD")
    assert body["heatmap"]["years"] == [2012, 2013] and body["first"] >= "2012-01-01"
    assert body["last"] <= "2013-12-31"
