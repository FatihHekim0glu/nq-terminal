"""P2 routes RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12). GET only.

The router is included on a fixture-mode app here (the merge step includes it in `app.py`); prices come from the
tests' fake serve (synthetic bars and synthetic calendar chains through `oos_gate.serve_bars` with a temporary log), so
no test touches the project's access log. Every served call must be caller "terminal", 1d, inside the fence.
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from p2_chain_fakes import THIN_DAY, UNRESOLVED_DAY, ChainServe, chain_rows

from nq_lab import carry_signal
from nq_lab.config import IS_END, ROOT
from nq_terminal.analytics import capacity, series, trend_regime
from nq_terminal.api import regimes_capacity_term as rct_api
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.services import regimes_capacity_term as rct
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve, synthetic_loader

from conftest import api_client

LOCAL, LOOPBACK = "http://127.0.0.1", ("127.0.0.1", 50000)
ROUTES = ("/api/analytics/hypothesis/{name}/trend-regime", "/api/analytics/run/{run_id}/trend-regime",
          "/api/analytics/run/{run_id}/capacity", "/api/market/term-structure/{root}")


def make_app(tmp_path: Path, serve=None, data_root: Path | None = FIXTURES):
    """A fixture-mode app (or, with `data_root=None`, the real project read only) with the P2 router included."""
    settings = load_settings({} if data_root is None else {"NQT_FIXTURE_DIR": str(data_root)})
    app = create_app(dataclasses.replace(settings, web_dist=tmp_path / "no_dist"))
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return app


@pytest.fixture
def fake(tmp_path: Path) -> ChainServe:
    return ChainServe(tmp_path / "chain" / "oos_access_log.jsonl",
                      make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl"))


@pytest.fixture
def client(tmp_path: Path, fake: ChainServe) -> TestClient:
    return api_client(make_app(tmp_path, fake), base_url=LOCAL, client=LOOPBACK)


@pytest.fixture
def real(tmp_path: Path, fake: ChainServe) -> TestClient:
    """The real project's result files, read only, with the fake serve for prices."""
    return api_client(make_app(tmp_path, fake, data_root=None), base_url=LOCAL, client=LOOPBACK)


def same(value, ref) -> bool:
    """A served number against its reference: null stands for NaN."""
    if value is None or ref is None or (isinstance(ref, float) and math.isnan(ref)):
        return value is None and (ref is None or math.isnan(ref))
    return math.isclose(value, ref, rel_tol=1e-12, abs_tol=1e-15)


def get(client: TestClient, path: str, **params) -> dict:
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def served_calls(fake: ChainServe) -> list:
    return list(fake.base.calls)


def test_the_router_is_get_only_and_declares_its_routes(tmp_path, fake):
    app = make_app(tmp_path, fake)
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    paths = app.openapi()["paths"]
    assert set(ROUTES) <= set(paths)
    assert all(set(paths[p]) == {"get"} for p in ROUTES)
    for route in ROUTES:
        declared = set(paths[route]["get"]["responses"])
        assert {"403", "404", "422", "503"} <= declared, route


# ---------------------------------------------------------------- RG2


def nq_close_by_hand() -> pd.Series:
    frame = synthetic_loader("NQ.V.0", "1d")(pd.Timestamp("2010-01-01", tz="UTC"), IS_END)
    days = series.session_index("2010-01-01", IS_END)
    stamps = pd.to_datetime(frame["ts"], utc=True).dt.tz_localize(None).dt.normalize()
    by_day = pd.Series(frame["c_back"].to_numpy(), index=stamps)
    return by_day.reindex(days, method="ffill")


def test_hypothesis_trend_regime_matches_the_analytics_on_the_served_close(real, fake):
    body = get(real, "/api/analytics/hypothesis/volmanaged_v0/trend-regime", cost=1)
    assert body["available"] is True and body["tag"] == "[POST HOC]" and body["window"] == 200
    assert body["context"] == {"kind": "hypothesis", "name": "volmanaged_v0", "cost": 1, "freq": "D"}
    s = series.hypothesis_series(ResearchService(ROOT), "volmanaged_v0", 1)
    want = trend_regime.trend_stats(s.r, nq_close_by_hand(), 252)
    for row, ref in zip(body["rows"], want["rows"], strict=True):
        assert row["regime"] == ref["regime"] and row["n"] == ref["n"] > 100
        assert all(same(row[k], ref[k]) for k in ("mean", "sharpe", "hit_rate")), row
    assert same(body["welch_t"], want["welch_t"]) and same(body["welch_df"], want["welch_df"])
    assert len(body["t"]) == len(body["date"]) == len(body["regime"]) == len(body["close"]) == len(s.r)
    assert "p" not in body and not any(k.startswith("p_") for k in body)
    assert body["gate"]["caller"] == "terminal"
    calls = served_calls(fake)
    assert calls and all(c.caller == "terminal" and c.timeframe == "1d" and c.end <= IS_END for c in calls)


def test_born_failing_a_close_one_session_late_changes_the_labels(real):
    """The labels above can fail: taking each session's own close (look-ahead) labels some sessions differently."""
    body = get(real, "/api/analytics/hypothesis/volmanaged_v0/trend-regime", cost=1)
    close = nq_close_by_hand()
    mean = close.rolling(200).mean()
    dates = pd.DatetimeIndex(body["date"])
    own = np.where(close.reindex(dates) > mean.reindex(dates), "above", "below")
    labelled = [r is not None for r in body["regime"]]
    assert any(o != r for o, r, ok in zip(own, body["regime"], labelled) if ok)


def test_overnight_book_regime_uses_the_session_before_the_entry(real):
    """overnight_v0 is labelled by exit date and opens at the 16:00 ET close, before the 1d (UTC day) close of the
    session before it: its regime comes from the session before the entry date."""
    body = get(real, "/api/analytics/hypothesis/overnight_v0/trend-regime", cost=1)
    s = series.hypothesis_series(ResearchService(ROOT), "overnight_v0", 1)
    want = trend_regime.trend_stats(s.r, nq_close_by_hand(), 252, lag=1)
    assert body["available"] is True and "before the entry" in body["label"]
    assert [row["n"] for row in body["rows"]] == [row["n"] for row in want["rows"]]
    assert same(body["welch_t"], want["welch_t"]) and same(body["welch_df"], want["welch_df"])
    same_session = trend_regime.trend_stats(s.r, nq_close_by_hand(), 252)
    assert [row["n"] for row in want["rows"]] != [row["n"] for row in same_session["rows"]] or not same(
        want["welch_t"], same_session["welch_t"])


def test_a_multi_session_book_has_no_trend_view(real):
    body = get(real, "/api/analytics/hypothesis/tom_v0/trend-regime", cost=1)
    assert body["available"] is False and body["rows"] == [] and body["gate"] is None
    assert "several sessions" in body["note"]


def test_run_trend_regime(client):
    body = get(client, "/api/analytics/run/nt_volmanaged_v0_fixture_m1/trend-regime")
    assert body["available"] is True and body["context"]["kind"] == "run" and body["context"]["freq"] == "D"
    assert sum(r["n"] for r in body["rows"]) + body["unlabelled"] == len(body["date"]) > 0


def test_a_monthly_book_has_no_trend_view_and_no_serve(tmp_path):
    base = make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")
    serve = ChainServe(tmp_path / "chain" / "oos.jsonl", base)
    client = api_client(make_app(tmp_path, serve, data_root=None), base_url=LOCAL, client=LOOPBACK)
    body = get(client, "/api/analytics/hypothesis/dtsmom_v0/trend-regime", cost=1)
    assert body["available"] is False and body["note"] == rct.TREND_MONTHLY and body["rows"] == []
    assert base.calls == () and body["gate"] is None


def test_trend_regime_without_a_price_source_is_503(tmp_path):
    client = api_client(make_app(tmp_path), base_url=LOCAL, client=LOOPBACK)
    r = client.get("/api/analytics/hypothesis/volmanaged_v0/trend-regime", params={"cost": 1})
    assert r.status_code == 503


def test_trend_regime_unknown_names_are_404(client):
    assert client.get("/api/analytics/hypothesis/nope_v0/trend-regime").status_code == 404
    assert client.get("/api/analytics/run/nope/trend-regime").status_code == 404


# ---------------------------------------------------------------- EX5


def fixture_fills(run_id: str) -> list[dict]:
    runs = RunService(data_root=FIXTURES, project_root=FIXTURES)
    return [r.model_dump() for r in runs.fills(run_id, 0, 5000).items]


def test_capacity_of_a_micro_book_counts_full_nq_contracts_over_nq_volume(client, fake):
    body = get(client, "/api/analytics/run/nt_volmanaged_v0_fixture_m1/capacity")
    assert body["source"] == "fills" and body["tag"] == "[POST HOC]"
    (inst,) = body["instruments"]
    assert inst["instrument"] == "MNQ.XCME" and inst["symbol"] == "NQ.V.0" and inst["factor"] == pytest.approx(0.1)
    (row,) = body["rows"]
    fills = fixture_fills("nt_volmanaged_v0_fixture_m1")
    by_session: dict[str, float] = {}
    for f in fills:
        day = pd.Timestamp(f["ts_epoch_s"], unit="s", tz="UTC").tz_convert("America/New_York").strftime("%Y-%m-%d")
        by_session[day] = by_session.get(day, 0.0) + f["qty"] * 0.1
    frame = synthetic_loader("NQ.V.0", "1d")(pd.Timestamp("2010-01-01", tz="UTC"), IS_END)
    volume = pd.Series(frame["v"].to_numpy(), index=pd.to_datetime(frame["ts"], utc=True).dt.strftime("%Y-%m-%d"))
    ratios = [c / volume[d] for d, c in by_session.items() if d in volume.index]
    assert row["sessions"] == len(by_session) and row["contracts_total"] == pytest.approx(sum(by_session.values()))
    assert row["ratio_max"] == pytest.approx(max(ratios), rel=1e-12)
    assert row["ratio_mean"] == pytest.approx(float(np.mean(ratios)), rel=1e-12)
    assert body["max_symbol"] == "NQ.V.0" and body["max_ratio"] == pytest.approx(max(ratios), rel=1e-12)
    assert all(c.caller == "terminal" and c.timeframe == "1d" for c in served_calls(fake))


def test_capacity_of_an_intraday_run_counts_each_trade_twice(client):
    body = get(client, "/api/analytics/run/nt_za_v0_fixture_a/capacity")
    assert body["source"] == "trades"
    (inst,) = body["instruments"]
    assert inst["instrument"] == capacity.ONE_NQ and inst["symbol"] == "NQ.V.0"
    (row,) = body["rows"]
    assert row["contracts_total"] == pytest.approx(2 * 6)


def test_capacity_of_a_multi_instrument_book(client):
    body = get(client, "/api/analytics/run/nt_dtsmom_v0_fixture_ts1/capacity")
    symbols = {r["symbol"] for r in body["rows"]}
    assert symbols and symbols <= {i["symbol"] for i in body["instruments"]}
    assert body["worst"] == sorted(body["worst"], key=lambda w: -w["ratio"])


def test_capacity_of_an_unbalanced_run_is_422(client):
    r = client.get("/api/analytics/run/nt_za_v0_fixture_unbalanced/capacity")
    assert r.status_code == 422 and "unusable" in r.json()["detail"]


def test_capacity_of_an_unknown_run_is_404(client):
    assert client.get("/api/analytics/run/nope/capacity").status_code == 404


def test_capacity_without_a_price_source_is_503(tmp_path):
    client = api_client(make_app(tmp_path), base_url=LOCAL, client=LOOPBACK)
    assert client.get("/api/analytics/run/nt_volmanaged_v0_fixture_m1/capacity").status_code == 503


# ---------------------------------------------------------------- MV6


def test_term_structure_carry_from_the_served_chain(client, fake):
    body = get(client, "/api/market/term-structure/NQ")
    assert body["root"] == "NQ" and body["ranks"] == [0, 1, 2] and body["tag"] == "[POST HOC]"
    assert body["void"]["thin"] == 1 and body["void"]["unresolved"] == 1
    c0, c1 = chain_rows("NQ", 0), chain_rows("NQ", 1)
    day = "2014-05-06"
    at = body["date"].index(day)
    a = c0.loc[c0["ts"].dt.strftime("%Y-%m-%d") == day].iloc[0]
    b = c1.loc[c1["ts"].dt.strftime("%Y-%m-%d") == day].iloc[0]
    e1 = dt.date.fromisoformat(body["expiry_front"][at])
    e2 = dt.date.fromisoformat(body["expiry_next"][at])
    assert (body["front"][at], body["next"][at]) == (a["contract"], b["contract"])
    assert body["carry"][at] == pytest.approx(carry_signal.carry_value(a["c"], b["c"], e1, e2), rel=1e-12)
    assert body["carry"][at] == pytest.approx(0.02, rel=0.05)
    assert THIN_DAY not in body["date"] and UNRESOLVED_DAY not in body["date"]
    assert max(body["date"]) < "2022-01-01" and body["curve"]["date"] == "2021-12-31"
    assert [p["rank"] for p in body["curve"]["points"]] == [0, 1, 2]
    assert fake.chain_calls == ("NQ.C.0", "NQ.C.1", "NQ.C.2")
    assert body["gate"]["caller"] == "terminal"


def test_term_structure_a_second_request_is_cached(client, fake):
    get(client, "/api/market/term-structure/ZN")
    calls = len(fake.chain_calls)
    assert get(client, "/api/market/term-structure/ZN")["gate"]["cached"] is True
    assert len(fake.chain_calls) == calls


def test_term_structure_of_a_root_without_a_chain_is_404(client):
    r = client.get("/api/market/term-structure/ES")
    assert r.status_code == 404 and "calendar chain" in r.json()["detail"]


def test_term_structure_outside_the_universe_is_404_before_any_serve(client, fake):
    r = client.get("/api/market/term-structure/ZZ")
    assert r.status_code == 404 and fake.chain_calls == ()


@pytest.mark.parametrize("root", ["nq", "N/Q", "NQ.C.0", "TOOLONG1"])
def test_term_structure_refuses_a_malformed_root(client, fake, root):
    r = client.get(f"/api/market/term-structure/{root}")
    assert r.status_code in (404, 422) and fake.chain_calls == ()


def test_term_structure_without_a_price_source_is_503(tmp_path):
    client = api_client(make_app(tmp_path), base_url=LOCAL, client=LOOPBACK)
    assert client.get("/api/market/term-structure/NQ").status_code == 503


def test_every_number_in_the_views_is_finite_or_null(client):
    for path in ("/api/analytics/hypothesis/overnight_v0/trend-regime?cost=1",
                 "/api/analytics/run/nt_volmanaged_v0_fixture_m1/capacity", "/api/market/term-structure/CL"):
        text = client.get(path).text
        assert "NaN" not in text and "Infinity" not in text, path
        assert not math.isnan(len(text))
