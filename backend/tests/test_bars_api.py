"""The data API (TASKS 2.3): /api/bars, /api/data/catalog, /api/market/universe, /api/qa, and the gate counters
in /api/health. Every price read goes through an injected fake serve with a temporary log; the real serve is
never called here.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab import data as nq_data
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from fakes import DAILY_ROOTS, FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


def make_client(env: dict | None = None, serve=None) -> TestClient:
    """Fixture mode by default. Fixture mode never lists the real processed folder, so a client with an injected
    serve also gets the fake catalog over the same synthetic series (as the E2E harness does)."""
    settings = load_settings(env if env is not None else {"NQT_FIXTURE_DIR": str(FIXTURES)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture
def client(fake) -> TestClient:
    return make_client(serve=fake)


def get_bars(client: TestClient, **params):
    return client.get("/api/bars", params={"symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", **params})


# ---------------------------------------------------------------- /api/bars

def test_bars_contract(client, fake):
    r = get_bars(client, timeframe="5m", start="2019-06-10", end="2019-06-11")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"symbol", "timeframe", "variant", "bucket", "ts_convention", "start", "end", "label", "t",
                         "o", "h", "l", "c", "v", "rolls", "sessions", "gate"}
    assert body["ts_convention"] == "bar open, UTC"
    assert body["bucket"] == "5m" and len(body["t"]) == len(body["h"]) > 0
    assert all(isinstance(x, int) for x in body["t"])
    assert body["start"] == "2019-06-10T00:00:00Z" and body["end"] == "2019-06-11T00:00:00Z"
    assert body["gate"] == {"caller": "terminal", "served_years": [2019], "cached": False, "reads_this_process": 1}
    [roll] = body["rolls"]
    assert set(roll) == {"t", "from", "to", "gap_pts", "gap_pct"} and roll["from"] != roll["to"]
    assert len(fake.calls) == 1 and fake.calls[0].caller == "terminal"


def test_fifty_api_requests_inside_one_year_make_one_serve(client, fake):
    first = pd.Timestamp("2019-02-01")
    for i in range(50):
        start = first + pd.Timedelta(days=i)
        r = get_bars(client, start=start.isoformat(), end=(start + pd.Timedelta(hours=6)).isoformat())
        assert r.status_code == 200
    assert len(fake.calls) == 1 and fake.loader_calls == 1


@pytest.mark.parametrize(("start", "end"), [("2022-01-03", "2022-01-04"), ("2021-12-30", "2022-01-05"),
                                            ("2009-06-01", "2009-06-02")])
def test_a_window_past_the_fence_gives_403_with_the_gate_message_and_no_load(client, fake, start, end):
    r = get_bars(client, start=start, end=end)
    assert r.status_code == 403
    assert "leaves the in-sample window" in r.json()["detail"]
    assert fake.calls == () and fake.loader_calls == 0
    assert not fake.log_path.exists()


def test_daily_past_the_fence_gives_403(client, fake):
    assert get_bars(client, timeframe="1d", start="2021-01-01", end="2023-01-01").status_code == 403
    assert fake.loader_calls == 0


def test_default_windows_end_at_the_fence(client, fake):
    body = get_bars(client, timeframe="1h").json()
    assert body["end"] == "2022-01-01T00:00:00Z" and body["start"] == "2021-01-01T00:00:00Z"
    assert max(body["t"]) < int(IS_END.timestamp())
    daily = get_bars(client, timeframe="1d").json()
    assert daily["start"] == "2010-01-01T00:00:00Z" and daily["gate"]["served_years"][-1] == 2021


@pytest.mark.parametrize("symbol", ["../NQ", "NQ.V.0/../../x", "nq.v.0", "NQ", "NQ.V.0 ", "C:\\x"])
def test_malformed_symbols_are_refused_before_the_gate(client, fake, symbol):
    assert get_bars(client, symbol=symbol, start="2019-01-02", end="2019-01-03").status_code == 422
    assert fake.calls == ()


def test_an_unknown_series_gives_404_before_the_gate(client, fake):
    r = get_bars(client, symbol="QQ.V.0", start="2019-01-02", end="2019-01-03")
    assert r.status_code == 404
    assert get_bars(client, symbol="ES.V.0", variant="repaired", start="2019-01-02", end="2019-01-03").status_code == 404
    assert fake.calls == ()


@pytest.mark.parametrize("params", [{"timeframe": "2m"}, {"variant": "raw"}, {"start": "not a date"},
                                    {"max_points": 5}, {"max_points": 999999},
                                    {"start": "2019-01-03", "end": "2019-01-02"}])
def test_bad_parameters_are_refused(client, fake, params):
    r = get_bars(client, **{"start": "2019-01-02", "end": "2019-01-03", **params})
    assert r.status_code in (403, 422)
    assert fake.loader_calls == 0


def test_timezone_offsets_are_converted_to_utc(client):
    body = get_bars(client, start="2019-06-10T02:00:00+02:00", end="2019-06-10T03:00:00+02:00").json()
    assert body["start"] == "2019-06-10T00:00:00Z" and len(body["t"]) == 60


def test_fixture_mode_without_an_injected_serve_gives_503(fake):
    r = get_bars(make_client(), start="2019-01-02", end="2019-01-03")
    assert r.status_code == 503


def test_the_production_default_is_the_real_gated_serve(tmp_path):
    """Inspected, never called: the service built outside fixture mode wraps nq_lab.data.serve."""
    from nq_terminal.api import data as data_api

    app = create_app(load_settings({}))
    services = data_api.build_services(app.state.settings, None)
    assert services.bars is not None and services.bars.serve_fn is nq_data.serve


def test_health_reports_the_gate_counters(client):
    assert client.get("/api/health").json()["gate_reads_this_process"] == 0
    get_bars(client, start="2019-06-10", end="2019-06-11")
    health = client.get("/api/health").json()
    assert health["gate_reads_this_process"] == 1
    assert health["cache"]["series"] == 1 and health["cache"]["bytes"] > 0


def test_every_data_route_is_get_only(client):
    methods = {m for r in client.app.routes for m in getattr(r, "methods", set()) or set()}
    assert methods <= {"GET", "HEAD"}
    assert client.post("/api/bars").status_code == 405


# ---------------------------------------------------------------- /api/data/catalog

def test_catalog_lists_the_real_processed_series_from_metadata(fake):
    body = make_client({}, serve=fake).get("/api/data/catalog").json()
    entries = {(e["symbol"], e["timeframe"], e["variant"]): e for e in body["series"]}
    nq = entries[("NQ.V.0", "1m", "vendor")]
    assert nq["rows"] > 1_000_000 and nq["error"] is None and nq["root"] == "NQ"
    assert {c["name"]: c["type"] for c in nq["columns"]}["instrument_id"] == "int32"
    assert nq["extends_past_fence"] is True and nq["first_ts"].startswith("2010-")
    assert ("NQ.V.0", "1m", "repaired") in entries
    assert sum(1 for k in entries if k[1] == "1d") == len(DAILY_ROOTS)
    assert fake.calls == ()


# ---------------------------------------------------------------- /api/market/universe

def test_universe_serves_each_daily_series_once(client, fake):
    r = client.get("/api/market/universe", params={"window": 126})
    assert r.status_code == 200
    body = r.json()
    assert [row["symbol"] for row in body["rows"]] == [f"{c.root}.V.0" for c in TABLE]
    assert body["as_of"] == "2021-12-31" and body["window"] == 126 and body["missing"] == []
    assert body["horizons"] == ["1D", "1W", "1M", "3M", "YTD", "12M"]
    assert "[POST HOC]" in body["label"] and "c_back" in body["basis"]
    assert body["correlation_window"]["sessions"] == 126 and body["correlation_full"]["sessions"] is None
    assert sorted(body["correlation_window"]["order"]) == list(range(len(TABLE)))
    assert len(fake.calls) == len(TABLE)
    assert {(c.timeframe, c.start, c.end) for c in fake.calls} == {("1d", IS_START, IS_END)}
    assert client.get("/api/market/universe").status_code == 200
    assert len(fake.calls) == len(TABLE)


@pytest.mark.parametrize("window", [5, 0, 100000])
def test_universe_window_bounds(client, window):
    assert client.get("/api/market/universe", params={"window": window}).status_code == 422


# ---------------------------------------------------------------- /api/qa

@pytest.fixture
def qa_root(tmp_path: Path) -> Path:
    results = tmp_path / "root" / "results"
    results.mkdir(parents=True)
    (results / "qa_report.json").write_text('{"sessions": 3, "bad": NaN}', encoding="utf-8")
    (results / "repair_report.json").write_text(json.dumps({"rebuilt": 487}), encoding="utf-8")
    (results / "registry.csv").write_text("name\n", encoding="utf-8")
    return tmp_path / "root"


def test_qa_lists_and_serves_reports(qa_root, fake):
    c = make_client({"NQT_FIXTURE_DIR": str(qa_root)}, serve=fake)
    index = c.get("/api/qa").json()
    assert [r["name"] for r in index["reports"]] == ["qa_report", "repair_report"]
    doc = c.get("/api/qa/qa_report").json()
    assert doc["name"] == "qa_report" and doc["content"] == {"sessions": 3, "bad": None}
    assert c.get("/api/qa/repair_report").json()["content"] == {"rebuilt": 487}


@pytest.mark.parametrize("name", ["registry", "missing", "..%5Cregistry", "qa_report.json", "..%2F..%2Fx"])
def test_qa_refuses_names_outside_the_index(qa_root, fake, name):
    c = make_client({"NQT_FIXTURE_DIR": str(qa_root)}, serve=fake)
    assert c.get(f"/api/qa/{name}").status_code == 404


def test_universe_builds_its_panel_once_across_windows_and_again_after_a_file_changes(client, monkeypatch):
    # HOME asks for two windows at once; the horizon-return panel does not depend on the window, so it is built
    # once per version of the served daily files (improvement run 3: it was 81 of the 85 ms of each request).
    from nq_terminal.services import market
    built: list[int] = []
    real = market.build_panel
    monkeypatch.setattr(market, "build_panel", lambda *a, **k: built.append(1) or real(*a, **k))
    short = client.get("/api/market/universe", params={"window": 22}).json()
    long = client.get("/api/market/universe", params={"window": 252}).json()
    assert len(built) == 1
    assert short["window"] == 22 and long["window"] == 252
    assert short["rows"][0]["returns"] == long["rows"][0]["returns"]
    assert short["rows"][0]["realised_vol"] != long["rows"][0]["realised_vol"]
    client.app.state.catalog.touch("NQ.V.0", "1d", "vendor")  # a rewritten processed file
    again = client.get("/api/market/universe", params={"window": 22}).json()
    assert len(built) == 2 and again["rows"] == short["rows"]
