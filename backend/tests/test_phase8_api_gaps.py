"""API gaps behind the reduced templates (TASKS Phase 8 notes; the look spec, section 7):

- `GET /api/instruments/{root}`: the instrument DES tabs (contract, month-code strip, related dates, data coverage,
  notes), from the frozen universe table, nq-lab's own rule modules and the repair provenance files; no price read;
- `GET /api/market/rv`: the RV22 (MV3) line for the GP indicator pane, on the universe's return convention, so its
  last value is the quote header's RV22 from `/api/market/universe?window=22`;
- `GET /api/market/two-day`: the MON 2Day sparkline, hourly closes of the last two sessions before the fence;
- `/api/audit/oos-log`: each entry's alert flag and 1 to 4 severity (house semantics, stated in the response);
- `GET /api/live/routes`: routes and fills from the journals, read only, plumbing rows labelled with the banner and
  kept out of the totals.
Every request is a GET; prices come only from the injected fake serve (caller terminal, temporary log).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from nq_lab import paper_plumbing
from nq_lab.config import IS_END, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_lab.live_guards import MNQ_POINT_VALUE
from nq_terminal.app import create_app
from nq_terminal.services import audit
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
BOOK = "volmanaged_paper_journal.jsonl"
PLUMBING_BOOK = "volmanaged_paper_journal.PLUMBING_DELAYED.jsonl"


def make_client(root=FIXTURES, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


@pytest.fixture
def priced(fake) -> TestClient:
    return make_client(serve=fake)


@pytest.fixture(scope="module")
def fixture_api() -> TestClient:
    return make_client()


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    return make_client(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


def _journal_rows(name: str) -> list[dict]:
    text = (FIXTURES / "live" / "logs" / name).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


# ---------------------------------------------------------------- OOS severity


def test_severity_rule_by_hand():
    base = {"caller": "terminal", "is_sealed": False, "past_fence": False, "start_epoch_s": 1_300_000_000}
    assert audit.severity(base) == 1
    assert audit.severity({**base, "caller": "za_screen"}) == 2
    assert audit.severity({**base, "past_fence": None}) == 3
    assert audit.severity({**base, "past_fence": True}) == 3
    assert audit.severity({**base, "start_epoch_s": 1_000_000_000}) == 3  # before 2010-01-01
    assert audit.severity({**base, "is_sealed": True, "past_fence": True}) == 4


def test_every_real_log_entry_carries_alert_and_severity(real_api):
    body = real_api.get("/api/audit/oos-log", params={"limit": 5000}).json()
    assert body["severity_levels"] and [x["level"] for x in body["severity_levels"]] == [1, 2, 3, 4]
    for entry in body["entries"]:
        assert entry["severity"] in (1, 2, 3, 4)
        assert entry["alert"] is (entry["severity"] >= 3)
        if entry["is_sealed"]:
            assert entry["severity"] == 4
        elif entry["caller"] == "terminal" and entry["past_fence"] is False:
            assert entry["severity"] == 1
    assert body["severity_counts"] == {str(k): v for k, v in body["severity_counts"].items()}
    assert sum(body["severity_counts"].values()) == body["total"]
    assert body["severity_counts"].get("4", 0) == body["sealed_reads"]


def test_fixture_log_severity(fixture_api):
    body = fixture_api.get("/api/audit/oos-log").json()
    assert all("severity" in e and "alert" in e for e in body["entries"])


# ---------------------------------------------------------------- LIVE routes and fills


def test_routes_one_per_close_row_with_status(fixture_api):
    body = fixture_api.get("/api/live/routes", params={"file": BOOK}).json()
    closes = [(i + 1, r) for i, r in enumerate(_journal_rows(BOOK)) if r.get("type") == "close"]
    assert [x["line_no"] for x in body["routes"]] == [n for n, _ in closes]
    status = {x["line_no"]: x["status"] for x in body["routes"]}
    for n, row in closes:
        want = ("error" if row.get("error") else "refused" if row.get("refused") else "blocked" if row.get("blocked")
                else "sent" if row.get("sent") else "not sent")
        assert status[n] == want
    assert body["present"] is True and body["banner"] == paper_plumbing.BANNER
    assert body["order_time_rule"].startswith("15:59:30 ET")


def test_fills_come_from_the_close_rows(fixture_api):
    body = fixture_api.get("/api/live/routes", params={"file": BOOK}).json()
    expected = [(i + 1, f) for i, r in enumerate(_journal_rows(BOOK)) if r.get("type") == "close"
                for f in r.get("fills") or []]
    assert len(body["fills"]) == len(expected)
    for got, (n, (contract, sign, qty, px)) in zip(body["fills"], expected):
        assert got["line_no"] == n and got["contract"] == contract and got["qty"] == qty and got["price"] == px
        assert got["side"] == ("BUY" if sign > 0 else "SELL")
        assert got["notional_usd"] == pytest.approx(qty * px * MNQ_POINT_VALUE)


def test_plumbing_rows_are_labelled_and_kept_out_of_the_totals(fixture_api):
    body = fixture_api.get("/api/live/routes", params={"file": BOOK}).json()
    rows = _journal_rows(BOOK)
    plumbing = {i + 1 for i, r in enumerate(rows) if paper_plumbing.is_plumbing(r)}
    for item in body["routes"] + body["fills"]:
        assert item["plumbing"] is (item["line_no"] in plumbing)
        assert item["banner"] == (paper_plumbing.BANNER if item["plumbing"] else None)
    summary = body["summary"]
    performance = [x for x in body["fills"] if not x["plumbing"]]
    assert summary["fills"] == len(performance)
    assert summary["filled_contracts"] == sum(x["qty"] for x in performance)
    assert summary["notional_usd"] == pytest.approx(sum(x["notional_usd"] for x in performance))
    assert summary["plumbing_fills"] == len(body["fills"]) - len(performance)
    assert summary["plumbing_routes"] == sum(x["plumbing"] for x in body["routes"])


def test_born_failing_a_plumbing_fill_would_change_the_totals(fixture_api):
    """The totals differ from a sum over every fill: the plumbing fill really is left out."""
    body = fixture_api.get("/api/live/routes", params={"file": BOOK}).json()
    assert any(x["plumbing"] for x in body["fills"])
    assert body["summary"]["filled_contracts"] != sum(x["qty"] for x in body["fills"])


def test_a_route_summarises_its_fills(fixture_api):
    body = fixture_api.get("/api/live/routes", params={"file": BOOK}).json()
    fills = body["fills"]
    for route in body["routes"]:
        own = [f for f in fills if f["line_no"] == route["line_no"]]
        if not own:
            assert route["filled_qty"] is None and route["side"] is None
            continue
        net = sum(f["qty"] * (1 if f["side"] == "BUY" else -1) for f in own)
        assert route["net_filled"] == net and route["filled_qty"] == sum(f["qty"] for f in own)
        assert route["avg_fill_px"] == pytest.approx(sum(f["qty"] * f["price"] for f in own) / route["filled_qty"])


def test_orders_for_an_expected_but_missing_journal_is_an_empty_state(tmp_path):
    (tmp_path / "live" / "logs").mkdir(parents=True)
    body = make_client(tmp_path).get("/api/live/routes").json()
    assert body["present"] is False and body["empty_state"] and body["routes"] == [] and body["fills"] == []


def test_orders_for_an_unknown_journal_is_404(fixture_api):
    r = fixture_api.get("/api/live/routes", params={"file": "nope.jsonl"})
    assert r.status_code == 404 and "Users" not in r.text


def test_the_plumbing_journal_is_all_labelled(fixture_api):
    body = fixture_api.get("/api/live/routes", params={"file": PLUMBING_BOOK}).json()
    assert body["routes"] and all(x["plumbing"] for x in body["routes"] + body["fills"])
    assert body["summary"]["fills"] == 0 and body["summary"]["filled_contracts"] == 0


# ---------------------------------------------------------------- instruments


def test_instrument_des_for_nq(real_api):
    body = real_api.get("/api/instruments/NQ").json()
    nq = next(c for c in TABLE if c.root == "NQ")
    assert body["root"] == "NQ" and body["symbol"] == "NQ.V.0" and body["in_universe"] is True
    assert body["contract"]["tick"] == nq.tick and body["contract"]["tick_usd"] == nq.tick_usd
    assert body["contract"]["point_value_usd"] == nq.mult and body["contract"]["sector"] == nq.sector
    codes = body["month_codes"]
    assert [m["code"] for m in codes] == list("FGHJKMNQUVXZ") and [m["month"] for m in codes] == list(range(1, 13))
    assert [m["code"] for m in codes if m["active"]] == ["H", "M", "U", "Z"]
    assert body["related"]["last_trading_rule"] == "third_friday"
    assert body["related"]["roll_rule"] and body["related"]["next_contract"].startswith("MNQ")
    assert body["coverage"]["fence"] == {"is_start": "2010-01-01", "is_end": "2022-01-01"}
    assert any(n["title"] == "Collapsed 1m days" for n in body["notes"])
    assert "C:\\" not in json.dumps(body) and "Users" not in json.dumps(body)


def test_instrument_notes_read_the_repair_provenance(real_api):
    body = real_api.get("/api/instruments/ES").json()
    index = json.loads((ROOT / "results" / "repair_provenance_futures_v2" / "index.json").read_text(encoding="utf-8"))
    es = index["symbols"]["ES"]
    note = next(n for n in body["notes"] if n["title"].startswith("1m repair"))
    assert f"{es['counts']['candidate_not_repaired']:,}" in note["text"] and "v2" in note["title"]
    assert [m["active"] for m in body["month_codes"]] == [None] * 12  # no listing cycle recorded for ES


def test_instrument_coverage_lists_the_catalog_series(priced):
    body = priced.get("/api/instruments/NQ").json()
    kinds = {(s["timeframe"], s["variant"]) for s in body["coverage"]["series"]}
    assert ("1m", "vendor") in kinds and ("1d", "vendor") in kinds
    assert all(s["root"] == "NQ" for s in body["coverage"]["series"])
    assert body["coverage"]["gate_reads_logged"] >= 0


def test_an_instrument_outside_the_table_is_described_without_a_contract(real_api):
    body = real_api.get("/api/instruments/RTY").json()
    assert body["in_universe"] is False and body["contract"] is None
    assert any("2017" in n["text"] for n in body["notes"])


def test_an_unknown_or_malformed_root(real_api):
    assert real_api.get("/api/instruments/QQQQ").status_code == 404
    assert real_api.get("/api/instruments/nq!").status_code == 422
    assert real_api.get("/api/instruments/ABCDEFG").status_code == 422


def test_instrument_des_reads_no_price(fake):
    client = make_client(serve=fake)
    assert client.get("/api/instruments/NQ").status_code == 200
    assert fake.served == ()


# ---------------------------------------------------------------- RV22 and the two-day sparkline


def test_rv22_last_value_is_the_universe_header(priced):
    rv = priced.get("/api/market/rv", params={"symbol": "NQ.V.0"}).json()
    uni = priced.get("/api/market/universe", params={"window": 22}).json()
    row = next(r for r in uni["rows"] if r["symbol"] == "NQ.V.0")
    assert rv["window"] == 22 and rv["date"][-1] == uni["as_of"]
    assert rv["rv"][-1] == pytest.approx(row["realised_vol"], rel=1e-12)
    assert rv["last"] == rv["rv"][-1] and rv["label"].startswith("[POST HOC]")
    assert max(rv["t"]) < IS_END.timestamp() and len(rv["t"]) == len(rv["rv"]) == len(rv["date"])
    assert rv["gate"]["caller"] == "terminal"


def test_rv_follows_the_rolling_definition(priced):
    rv = priced.get("/api/market/rv", params={"symbol": "ES.V.0", "window": 30}).json()
    values = [v for v in rv["rv"] if v is not None]
    assert values and all(v > 0 and math.isfinite(v) for v in values)
    assert rv["rv"][0] is None  # one session has no return


def test_rv_refuses_a_symbol_outside_the_universe(priced):
    assert priced.get("/api/market/rv", params={"symbol": "RTY.V.0"}).status_code == 404
    assert priced.get("/api/market/rv", params={"symbol": "NQ"}).status_code == 422
    assert priced.get("/api/market/rv", params={"symbol": "NQ.V.0", "window": 1}).status_code == 422


def test_two_day_sparkline(priced, fake):
    body = priced.get("/api/market/two-day", params={"symbols": "NQ.V.0,ZN.V.0"}).json()
    assert body["sessions"] == ["2021-12-30", "2021-12-31"] and body["bucket"] == "1h"
    assert {r["symbol"] for r in body["rows"]} == {"NQ.V.0", "ZN.V.0"}
    for row in body["rows"]:
        assert len(row["t"]) == len(row["c"]) == len(row["day"]) and set(row["day"]) <= {0, 1}
        assert row["day"] == sorted(row["day"]) and max(row["t"]) < IS_END.timestamp()
        closes = [c for c, d in zip(row["c"], row["day"]) if d == 0 and c is not None]
        assert row["prior_close"] == (closes[-1] if closes else None)
    assert all(call.caller == "terminal" for call in fake.served)


def test_two_day_refuses_unknown_symbols(priced):
    assert priced.get("/api/market/two-day", params={"symbols": "NQ.V.0,XX.V.0"}).status_code == 404
    assert priced.get("/api/market/two-day", params={"symbols": "bad"}).status_code == 422


def test_market_views_need_a_price_source(fixture_api):
    assert fixture_api.get("/api/market/rv", params={"symbol": "NQ.V.0"}).status_code == 503
    assert fixture_api.get("/api/market/two-day").status_code == 503


def test_new_routes_are_get_only(real_api):
    paths = real_api.get("/api/openapi.json").json()["paths"]
    for path in ("/api/instruments/{root}", "/api/market/rv", "/api/market/two-day", "/api/live/routes"):
        assert set(paths[path]) == {"get"}, path


def test_rv_numbers_match_a_direct_rolling_sd(priced):
    """The line is sd(r over `window` sessions, ddof 1) x sqrt(252) on the universe returns."""
    rv = priced.get("/api/market/rv", params={"symbol": "GC.V.0", "window": 22}).json()
    uni = priced.get("/api/market/universe", params={"window": 22}).json()
    row = next(r for r in uni["rows"] if r["symbol"] == "GC.V.0")
    assert np.isclose(rv["rv"][-1], row["realised_vol"], rtol=1e-12)


def test_no_two_response_models_share_a_schema_name(real_api):
    """Born failing (Phase 8): a second `FillRow` made the generator rename both to module-qualified names, which
    broke every front-end reference to `Schemas['FillRow']`; each model name must be unique."""
    names = real_api.get("/api/openapi.json").json()["components"]["schemas"]
    assert not [n for n in names if n.startswith("nq_terminal__")]
