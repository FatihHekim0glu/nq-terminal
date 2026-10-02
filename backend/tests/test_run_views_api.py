"""Trade, cost and exposure routes of a Nautilus run (item (a); ANALYTICS_CATALOG TA1, TA3, TA6, EX1 to EX4).

`/api/analytics/run/{run_id}/trades`, `/costs` and `/exposure` serve the part A functions exactly, through
`services/run_books.py`. Prices for a book's exposure only through the gate (fake serve here, caller "terminal",
the in-sample window). TA6 reads `results/quote_check_v1.json` and the paper book journal's performance rows only
(the plumbing row in the fixture journal is dropped and counted). Errors follow the tear sheet's mapping.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
import pytest
from fastapi.testclient import TestClient

from nq_lab import paper_plumbing
from nq_lab.config import IS_END, IS_START, ROOT
from nq_terminal.analytics import exposure, trades
from nq_terminal.analytics.exposure import CostError, Instrument
from nq_terminal.app import create_app
from nq_terminal.services import journals, run_books
from nq_terminal.services.bars import BarService
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from test_runs_support import RUNS, FakeClock, service

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
ROUTES = ("/api/analytics/run/{run_id}/trades", "/api/analytics/run/{run_id}/costs",
          "/api/analytics/run/{run_id}/exposure")


def client_for(root, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def api() -> TestClient:
    return client_for(FIXTURES)


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    return client_for(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


@lru_cache(maxsize=1)
def fixture_runs():
    return service(FIXTURES, clock=FakeClock())


def _nums(values) -> list:
    return [None if v is None or not math.isfinite(float(v)) else float(v) for v in values]


def get(client: TestClient, path: str) -> dict:
    r = client.get(path)
    assert r.status_code == 200, r.text
    return r.json()


def test_routes_are_get_only():
    paths = create_app(load_settings({})).openapi()["paths"]
    for route in ROUTES:
        assert set(paths[route]) == {"get"}, route


# ---------------------------------------------------------------- TA1 and TA3


def _rows(run_id: str) -> list[dict]:
    return [row.model_dump() for row in fixture_runs().trades(run_id, 0, 5000).items]


def test_trade_tiles_are_the_part_a_function(api):
    run_id = RUNS["za_orb"]
    body = get(api, f"/api/analytics/run/{run_id}/trades")
    want = trades.trade_tiles(_rows(run_id), fixture_runs().detail(run_id).summary_stats)
    assert body["stats"] == {k: (v if isinstance(v, int) else _nums([v])[0]) for k, v in want["stats"].items()}
    assert body["hit_rate_matches"] is want["hit_rate_matches"] and body["tag"] == "[POST HOC]"
    assert body["stats"]["win_rate"] == body["summary"]["hit_rate"]


def test_intraday_runs_group_by_hour_and_books_do_not(api):
    za = get(api, f"/api/analytics/run/{RUNS['za_orb']}/trades")
    want = trades.by_entry(_rows(RUNS["za_orb"]), "hour")
    assert za["by_hour"]["rows"][0]["mean"] == want["rows"][0]["mean"] and za["hour_note"] is None
    for shape in ("sized", "dtsmom"):
        body = get(api, f"/api/analytics/run/{RUNS[shape]}/trades")
        assert body["by_hour"] is None and "session close" in body["hour_note"], shape
        assert body["by_weekday"]["rows"] and body["by_month"]["rows"], shape


def test_real_dtsmom_weekdays_are_session_dates_in_new_york(real_api):
    body = get(real_api, "/api/analytics/run/nt_dtsmom_v0_ts1/trades")
    assert body["by_hour"] is None
    assert {row["label"] for row in body["by_weekday"]["rows"]} <= {"Mon", "Tue", "Wed", "Thu", "Fri"}


# ---------------------------------------------------------------- TA6


def test_fixture_slippage_uses_performance_rows_only(api):
    body = get(api, f"/api/analytics/run/{RUNS['za_orb']}/trades")["slippage"]
    state = journals.LiveMonitor(FIXTURES).journal(journals.BOOK_JOURNAL)
    kept = journals.performance_series(state.rows)
    live = next(g for g in body["groups"] if g["name"] == "live close")
    assert live["n"] == sum(v is not None for v in kept["slippage_ticks"])
    assert body["live_plumbing_rows_skipped"] == kept["plumbing_rows_skipped"] >= 1
    assert body["plumbing_banner"] == paper_plumbing.BANNER
    assert body["quote_check_found"] is False  # the fixture root has no quote check


def test_real_quote_check_matches_its_stored_summary(real_api):
    body = get(real_api, "/api/analytics/run/nt_za_v0_repaired_a/trades")["slippage"]
    assert body["quote_check_found"] is True and body["matches_stored"] is True
    entry = next(g for g in body["groups"] if g["name"] == "entry")
    assert entry["n"] == 96 and entry["mean"] == pytest.approx(0.72, abs=0.01)


# ---------------------------------------------------------------- EX3 and EX4


@pytest.mark.parametrize("shape", ["za_orb", "overnight", "sized", "dtsmom"])
def test_costs_are_the_part_a_functions_and_net_is_pnl_total(api, shape):
    run_id = RUNS[shape]
    body = get(api, f"/api/analytics/run/{run_id}/costs")
    book = run_books.load_book(fixture_runs(), run_id)
    fall = exposure.cost_waterfall(book)
    assert body["waterfall"]["net"] == fall["net"] == fixture_runs().detail(run_id).summary.pnl_total
    assert body["sensitivity"]["net_usd"] == exposure.cost_sensitivity(book)["net_usd"]


# ---------------------------------------------------------------- EX1 and EX2


def test_sized_exposure_is_at_the_run_raw_close(api):
    body = get(api, f"/api/analytics/run/{RUNS['sized']}/exposure")
    book = run_books.load_book(fixture_runs(), RUNS["sized"])
    want = exposure.exposure(book)
    assert body["available"] is True and body["exposure"]["price_basis"] == exposure.PRICE_RAW_RUN
    assert body["exposure"]["gross"] == _nums(want["gross"])
    assert body["turnover"]["annualised"] == exposure.turnover(book)["annualised"]


def test_dtsmom_exposure_prices_come_through_the_gate(tmp_path):
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    body = get(client_for(FIXTURES, serve), f"/api/analytics/run/{RUNS['dtsmom']}/exposure")
    assert body["exposure"]["price_basis"] == exposure.PRICE_RAW_GATE
    assert serve.served and all(c.caller == "terminal" for c in serve.calls)
    assert all(c.start >= IS_START and c.end <= IS_END and c.timeframe == "1d" for c in serve.calls)


def test_without_a_price_source_the_book_says_its_price_is_back_adjusted(api):
    body = get(api, f"/api/analytics/run/{RUNS['dtsmom']}/exposure")
    assert body["exposure"]["price_basis"] == exposure.PRICE_SNAPSHOT


def test_an_intraday_run_has_no_exposure_and_says_why(api):
    body = get(api, f"/api/analytics/run/{RUNS['za_orb']}/exposure")
    assert body["available"] is False and body["exposure"] is None and "snapshots" in body["note"]


def test_real_volmanaged_exposure_respects_its_cap(real_api):
    body = get(real_api, "/api/analytics/run/nt_volmanaged_v0_final_m1/exposure")
    assert body["exposure"]["price_basis"] == exposure.PRICE_RAW_RUN
    assert max(v for v in body["exposure"]["gross"] if v is not None) <= 2.0 + 1e-9  # the 2x cap on raw close


# ---------------------------------------------------------------- symbols and errors


def test_a_crafted_instrument_name_never_reaches_the_gate(tmp_path):
    """Born failing (security review): `C:\\elsewhere\\x.XCME` used to become the serve symbol as it stood."""
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    book = run_books.load_book(fixture_runs(), RUNS["dtsmom"])
    evil = Instrument("C:\\elsewhere\\x.XCME", book.instruments[0].multiplier, book.instruments[0].tick_size,
                      book.instruments[0].cost_per_side, book.instruments[0].ticks)
    tampered = exposure.RunBook(**{**book.__dict__, "instruments": (evil, *book.instruments[1:])})
    with pytest.raises(CostError, match="not a futures root"):
        run_books.gated_raw_prices(BarService(serve, cache_bytes=64 * 1024**2), tampered)
    assert not serve.calls
    assert run_books.serve_symbol("ES.XCME") == "ES.V.0" and run_books.serve_symbol("6E.XCME") == "6E.V.0"


@pytest.mark.parametrize("route", ROUTES)
def test_an_unbalanced_run_is_422_and_an_unknown_one_404(api, route):
    r = api.get(route.format(run_id=RUNS["unbalanced"]))
    assert r.status_code == 422 and "rule 4" in r.json()["detail"]
    assert api.get(route.format(run_id="nt_nope")).status_code == 404


def test_quote_check_reader_returns_none_without_the_file():
    assert run_books.quote_check(ResearchService(FIXTURES)) is None
    doc = run_books.quote_check(ResearchService(ROOT))
    assert isinstance(doc, dict) and len(doc["trades"]) == 96


def test_the_book_journal_rows_feed_ta6_unchanged():
    live = run_books.live_slippage(journals.LiveMonitor(FIXTURES))
    assert live["found"] is True and np.isfinite([v for v in live["ticks"] if v is not None]).all()
