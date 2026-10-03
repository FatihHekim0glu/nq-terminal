"""P1 analytics routes (TASKS Phase 10; ARCHITECTURE s4 Analytics): every route is GET only and serves the part A
functions exactly, with the P1 labelling rules.

- `/extended`: PF7 to PF9, RK3, RL3, RL4, BR3, BR4, RD4, RK5 (frozen windows, the spent row only for volmanaged_v0)
  and RG1 (daily only, no p-value);
- `/bootstrap`: SV5 and SV6 at the fixed seed, 10,000 replications;
- `/deflated`: SV3 over every registered trial; one trial that cannot be built refuses the whole view;
- `/run/{id}/excursions`: TA2 over the run's own 1-minute bars through the gate (caller "terminal"); TA4 and TA5 on
  their own `/trade-paths` route;
- `/paper-tracking`: LV5 over performance rows only.

Real data is read only; prices come from the tests' fake serve (synthetic bars through `oos_gate.serve_bars` with a
temporary log), so no test touches the project's access log.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab import paper_plumbing
from nq_lab.config import ROOT
from nq_terminal import constants
from nq_terminal.analytics import (
    bootstrap,
    deflated,
    distribution,
    excursions,
    perf,
    regimes,
    relative,
    risk,
    rolling,
    series,
    stress,
    tracking,
    trades,
)
from nq_terminal.app import create_app
from nq_terminal.services import journals, run_books, tearsheet_extended
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
P1_ROUTES = ("/api/analytics/hypothesis/{name}/extended", "/api/analytics/run/{run_id}/extended",
             "/api/analytics/hypothesis/{name}/bootstrap", "/api/analytics/run/{run_id}/bootstrap",
             "/api/analytics/deflated", "/api/analytics/run/{run_id}/excursions",
             "/api/analytics/run/{run_id}/trade-paths", "/api/analytics/paper-tracking")
REL = 1e-12


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
def serve(tmp_path_factory):
    return make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")


@pytest.fixture(scope="module")
def real_api(serve) -> TestClient:
    return client_for(None, serve)


@pytest.fixture(scope="module")
def research() -> ResearchService:
    return ResearchService(ROOT)


def get(client: TestClient, path: str, **params) -> dict:
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def close(a, b, rel=REL) -> bool:
    if a is None or b is None or (isinstance(b, float) and math.isnan(b)):
        return a is None and (b is None or math.isnan(b))
    return a == pytest.approx(b, rel=rel, abs=1e-15)


def test_p1_routes_are_get_only():
    paths = create_app(load_settings({})).openapi()["paths"]
    for route in P1_ROUTES:
        assert set(paths[route]) == {"get"}, route


# ---------------------------------------------------------------- /extended


def test_hypothesis_extended_equals_the_part_a_functions(real_api, research):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0/extended", cost=1)
    s = series.hypothesis_series(research, "volmanaged_v0", 1)
    tiles = {k["key"]: k for k in body["ratios"]}
    assert close(tiles["omega"]["value"], perf.omega(s.r))
    assert close(tiles["tail_ratio"]["value"], perf.tail_ratio(s.r))
    assert close(tiles["gain_to_pain"]["value"], perf.gain_to_pain(s.r, "A", 252))
    assert all(k["tag"] == "[POST HOC]" and k["basis"] == "A" for k in body["ratios"])
    table = risk.modified_var_table(s.r)
    for level in body["cornish_fisher_var"]["levels"]:
        assert close(level["value"], table[level["level"]]["value"]) and level["in_domain"] is True
    jb = distribution.jarque_bera(s.r)
    assert close(body["jarque_bera"]["statistic"], jb["statistic"])
    assert "never on a slice" in body["jarque_bera"]["note"]
    beta = rolling.rolling_beta(s.r, s.bench, 126).to_numpy()
    served = np.array([np.nan if v is None else v for v in body["rolling_relative"]["beta"]], dtype=float)
    assert np.allclose(served, beta, rtol=REL, equal_nan=True)
    assert close(body["capture"]["up"], relative.up_capture(s.r, s.bench, 252))
    # A Basis A series is summed everywhere else, so the capture label says it compounds (BR3).
    assert body["basis"] == "A" and "compounded as Nautilus defines it" in body["capture"]["label"]
    assert close(body["scatter"]["slope"], relative.alpha_beta(s.r, s.bench)["b"])


def test_stress_rows_are_the_frozen_windows_plus_the_spent_row(real_api, research):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0/extended", cost=1)["stress"]
    s = series.hypothesis_series(research, "volmanaged_v0", 1)
    want = stress.window_rows(s.r, s.bench, "A", constants.STRESS_WINDOWS)
    rows = body["rows"]
    assert [r["label"] for r in rows[:5]] == [w.label for w in constants.STRESS_WINDOWS]
    for got, expected in zip(rows, want):
        assert got["n"] == expected["n"] and close(got["strategy_return"], expected["strategy_return"])
        assert close(got["strategy_max_drawdown"], expected["strategy_max_drawdown"]) and got["spent"] is False
    spent = rows[5]
    assert spent["spent"] is True and "spent window" in spent["label"] and body["spent_note"] is None
    # the sealed record (results/sealed/SEALED_RESULT.md): volmanaged_oos max drawdown 15.9% (variant a, 1 tick)
    assert round(-spent["strategy_max_drawdown"], 3) == 0.159 and spent["n"] > 240
    assert body["tag"] == "[POST HOC]" and "frozen" in body["frozen"]


def test_regimes_are_rg1_on_the_recorded_variance_without_a_p_value(real_api, research):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0/extended", cost=1)["regimes"]
    s = series.hypothesis_series(research, "volmanaged_v0", 1)
    frame = pd.read_csv(ROOT / "results" / "screens" / "volmanaged_v0_daily.csv", parse_dates=["date"])
    rv = frame.set_index("date")["sigma2"].dropna()
    want = regimes.regime_stats(s.r, rv, 252)
    assert close(body["welch_t"], want["welch_t"]) and body["unlabelled"] == want["unlabelled"]
    for got, expected in zip(body["rows"], want["rows"]):
        assert got["n"] == expected["n"] and close(got["sharpe"], expected["sharpe"])
    assert "p" not in body and not any("p" in row for row in body["rows"])
    assert len(body["regime"]) == s.n and body["regime"][0] is None


def test_a_series_without_a_benchmark_has_no_relative_views_and_no_spent_row(api):
    body = get(api, "/api/analytics/hypothesis/overnight_v0/extended", cost=1)  # no price source: no NQ benchmark
    assert body["rolling_relative"] is None and body["capture"] is None and body["scatter"] is None
    assert body["relative_note"] == tearsheet_extended.NO_BENCH
    assert not any(r["spent"] for r in body["stress"]["rows"]) and body["stress"]["spent_note"]


def test_born_failing_a_one_contract_series_gets_no_capture(real_api, research):
    """Capture compounds returns: on za_v0's USD per contract it overflowed to a meaningless ratio."""
    s = series.hypothesis_series(research, "za_v0", 1)
    with np.errstate(over="ignore"):
        assert not math.isfinite(np.prod(1.0 + s.r.to_numpy()))
    body = get(real_api, "/api/analytics/hypothesis/za_v0/extended", cost=1)
    assert body["capture"] is None and body["relative_note"] == tearsheet_extended.NO_CAPTURE
    assert body["rolling_relative"] is not None and body["scatter"] is not None


def test_a_monthly_book_has_no_regimes_and_a_twelve_month_window(real_api):
    body = get(real_api, "/api/analytics/hypothesis/dtsmom_v0/extended", cost=1)
    assert body["regimes"] is None and body["regimes_note"] == tearsheet_extended.REGIMES_MONTHLY
    assert body["rolling_relative"]["window"] == 12 and body["cornish_fisher_var"]["horizon"] == "1 month"


def test_run_extended_serves_the_account_series(real_api, research):
    body = get(real_api, "/api/analytics/run/nt_dtsmom_v0_ts1/extended")
    s = series.run_series(RunService(data_root=ROOT, project_root=ROOT), research, "nt_dtsmom_v0_ts1")
    assert body["basis"] == "B" and body["n"] == s.n
    assert close({k["key"]: k for k in body["ratios"]}["gain_to_pain"]["value"], perf.gain_to_pain(s.r, "B", 252))
    assert not any(r["spent"] for r in body["stress"]["rows"])


# ---------------------------------------------------------------- /bootstrap


def test_bootstrap_equals_the_summary_at_the_fixed_seed(real_api, research):
    body = get(real_api, "/api/analytics/hypothesis/volmanaged_v0/bootstrap", cost=1)
    s = series.hypothesis_series(research, "volmanaged_v0", 1)
    want = bootstrap.bootstrap_summary(s.r, "A", 252)
    assert body["reps"] == bootstrap.REPS == 10_000 and body["seed"] == bootstrap.SEED
    assert close(body["block"]["stationary"], want["block"]["stationary"])
    by_name = {i["statistic"]: i for i in body["intervals"]}
    for name in bootstrap.STATISTICS:
        assert by_name[name]["lo"] == want["stats"][name]["lo"] and by_name[name]["hi"] == want["stats"][name]["hi"]
    cone = body["cone"]
    assert cone["label"] == bootstrap.CONE_LABEL and "pointwise percentiles" in cone["label"] and cone["how"] == "summed"
    assert cone["quantiles"]["50"] == pytest.approx(list(want["cone"]["quantiles"]["50"]), rel=REL)


def test_a_one_contract_series_has_no_cagr_interval(real_api):
    body = get(real_api, "/api/analytics/hypothesis/za_v0/bootstrap", cost=1)
    cagr = next(i for i in body["intervals"] if i["statistic"] == "cagr")
    assert cagr["point"] is None and cagr["lo"] is None and "no capital" in cagr["note"]


# ---------------------------------------------------------------- /deflated


def _trials(research: ResearchService) -> list[deflated.Trial]:
    """The registered rows the terminal has learned (a SeriesSource each), as trials."""
    out = []
    for row in research.registry_rows():
        if row.registered and row.name in constants.SERIES_SOURCES:
            s = series.hypothesis_series(research, row.name, 1)
            out.append(deflated.Trial(row.name, s.kind, s.periods, s.r))
    return out


def test_deflated_covers_every_learned_registered_trial_and_names_the_rest(real_api, research):
    body = get(real_api, "/api/analytics/deflated")
    trials = _trials(research)
    want = deflated.registry_dsr(trials)
    registered = [r.name for r in research.registry_rows() if r.registered]
    learned = [name for name in registered if name in constants.SERIES_SOURCES]
    assert body["n_trials"] == len(learned) == len(trials) and [r["name"] for r in body["rows"]] == learned
    assert all(name in body["n_note"] for name in registered if name not in learned)
    assert close(body["variance"], want["variance"]) and close(body["sr0_session"], want["sr0_session"])
    for got, expected in zip(body["rows"], want["rows"]):
        assert close(got["dsr"], expected["dsr"])
    assert body["tag"] == "[POST HOC]" and "never overrides" in body["label"] and body["cost"] == 1
    assert body["dominant"].startswith("mim_v0")  # SV3a step 9 names it


def test_born_failing_one_unbuildable_trial_refuses_the_whole_view(api, monkeypatch):
    real = series.hypothesis_series

    def broken(research, name, cost, **kwargs):
        if name == "overnight_v0":
            raise series.SeriesError("its series file is missing (test)")
        return real(research, name, cost, **kwargs)

    assert get(api, "/api/analytics/deflated")["n_trials"] == 2
    monkeypatch.setattr(series, "hypothesis_series", broken)
    # the first answer is now in the module client's result cache and no input changed, so the same app would answer
    # 200 from it; a fresh app (its own per-test state folder, so an empty cache) computes again and refuses
    r = client_for(FIXTURES).get("/api/analytics/deflated")
    assert r.status_code == 503 and "overnight_v0" in r.json()["detail"]


# ---------------------------------------------------------------- TA2, TA4, TA5


def test_born_failing_excursions_over_bars_on_another_basis_are_refused(real_api, serve):
    # the fake serve's synthetic NQ bars sit near 2480 while za's fills sit near 5790 (back adjusted): every fill
    # lies outside its bars, so the view refuses instead of showing MAE of thousands of points
    body = get(real_api, "/api/analytics/run/nt_za_v0_repaired_a/excursions")
    assert body["available"] is False and body["rows"] == [] and "price basis" in body["note"]
    assert body["symbol"] == "NQ.V.0" and body["variant"] == "repaired"
    assert body["basis_checked"] > 0 and body["off_basis"] == body["basis_checked"]
    calls = [c for c in serve.served if c.timeframe == "1m"]
    assert calls and all(c.caller == "terminal" and c.variant == "repaired" for c in calls)


def bars_on_the_fills(rows, shift=0.0) -> pd.DataFrame:
    """One bar ending at each fill stamp whose range holds the fill (plus `shift` points), in time order."""
    stamps, highs, lows = [], [], []
    for r in rows:
        for when, px in ((r["entry_ts"], r["entry_px"]), (r["exit_ts"], r["exit_px"])):
            stamps.append(pd.Timestamp(when).tz_convert("UTC").floor("1min") - pd.Timedelta(minutes=1))
            highs.append(px + 1.0 + shift)
            lows.append(px - 1.0 + shift)
    frame = pd.DataFrame({"ts": stamps, "h": highs, "l": lows}).drop_duplicates("ts").sort_values("ts")
    return frame.reset_index(drop=True)


class StubBars:
    """A bar service whose every frame is `bars` (the view's own gated read is tested above)."""

    def __init__(self, bars: pd.DataFrame):
        self.bars = bars

    def frame(self, symbol, source_tf, variant, start, end, *, version=None):
        from nq_terminal.services.bars import Served
        return Served(frame=self.bars, years=(start.year,), cached=False)


def test_excursions_on_the_fills_basis_equal_the_part_a_function():
    from nq_terminal.services import tearsheet_trades
    runs = RunService(data_root=ROOT, project_root=ROOT)
    book = run_books.load_book(runs, "nt_za_v0_repaired_a")
    bars = bars_on_the_fills(book.trades)
    found = tearsheet_trades.excursions_view(runs, StubBars(bars), "nt_za_v0_repaired_a")
    want = excursions.excursions(book.trades, bars, point_value=20.0, tick=0.25)
    assert found.available is True and found.off_basis == 0 and found.basis_checked == len(book.trades)
    assert [(r.mae_pts, r.mfe_pts, r.whole_bars) for r in found.rows] == [
        (r["mae_pts"], r["mfe_pts"], r["whole_bars"]) for r in want["rows"]]
    assert found.n == len(book.trades) and found.tag == "[POST HOC]" and found.tick == 0.25


def test_a_few_fills_off_their_bars_are_shown_and_counted():
    from nq_terminal.services import tearsheet_trades
    runs = RunService(data_root=ROOT, project_root=ROOT)
    book = run_books.load_book(runs, "nt_za_v0_repaired_a")
    bars = bars_on_the_fills(book.trades)
    bars.loc[0, ["h", "l"]] += 1000.0  # the first trade's entry bar only
    found = tearsheet_trades.excursions_view(runs, StubBars(bars), "nt_za_v0_repaired_a")
    assert found.available is True and found.off_basis == 1 and found.rows[0].off_basis is True
    shifted = tearsheet_trades.excursions_view(runs, StubBars(bars_on_the_fills(book.trades, 1000.0)),
                                               "nt_za_v0_repaired_a")
    assert shifted.available is False and shifted.off_basis == len(book.trades)


def test_excursions_are_for_intraday_runs_with_a_price_source(api, real_api):
    sized = get(real_api, "/api/analytics/run/nt_volmanaged_v0_final_m1/excursions")
    assert sized["available"] is False and "intraday" in sized["note"] and sized["rows"] == []
    fixture = get(api, "/api/analytics/run/nt_za_v0_fixture_a/excursions")
    assert fixture["available"] is False and "price source" in fixture["note"]


def test_trade_paths_carry_holding_times_and_streaks(real_api):
    body = get(real_api, "/api/analytics/run/nt_za_v0_repaired_a/trade-paths")
    book = run_books.load_book(RunService(data_root=ROOT, project_root=ROOT), "nt_za_v0_repaired_a")
    hold, streak = trades.holding_times(book.trades), trades.streaks(book.trades)
    assert body["holding"]["counts"] == hold["counts"] and close(body["holding"]["median"], hold["median"])
    assert body["streaks"]["longest_loss"] == streak["longest_loss"]
    assert close(body["streaks"]["runs_test"]["z"], streak["runs_test"]["z"])
    assert "durations" not in body["holding"] and body["tag"] == "[POST HOC]"
    assert "holding" not in get(real_api, "/api/analytics/run/nt_za_v0_repaired_a/trades")  # RunTrades keeps its shape


# ---------------------------------------------------------------- LV5


def test_paper_tracking_reads_performance_rows_only(api):
    body = get(api, "/api/analytics/paper-tracking")
    path = FIXTURES / "live" / "logs" / journals.BOOK_JOURNAL
    rows = [r.data for r in journals.JournalTailer(path).poll().rows]
    kept = paper_plumbing.performance_rows(rows)
    want = tracking.paper_tracking(kept, 2.0)
    assert body["plumbing_rows_skipped"] == len(rows) - len(kept) > 0
    assert body["date"] == want["date"] and body["paper"] == want["paper"] and body["n"] == want["n"]
    assert body["banner"] == paper_plumbing.BANNER and body["tag"] == "[POST HOC]"


def test_paper_tracking_refuses_an_unknown_journal_and_shows_an_empty_expected_one(api, real_api):
    assert api.get("/api/analytics/paper-tracking", params={"file": "nope.jsonl"}).status_code == 404
    body = get(real_api, "/api/analytics/paper-tracking")
    assert body["present"] in (True, False) and (body["present"] or body["empty_state"])


@pytest.mark.parametrize("path", ["/api/analytics/paper-tracking", "/api/live/journal", "/api/live/log",
                                  "/api/live/performance", "/api/live/routes"])
def test_a_404_for_an_unknown_journal_never_echoes_the_name_asked_for(api, path):
    asked = "nope<b>x</b>.jsonl"
    r = api.get(path, params={"file": asked})
    assert r.status_code == 404
    assert asked not in r.text and "nope" not in r.text


def test_born_failing_a_filter_that_keeps_plumbing_is_refused():
    rows = [{"type": "close", "date": "2026-10-02", "mode": "plumbing test, delayed data",
             "strategy_performance": False}]
    with pytest.raises(tracking.TrackingError, match="plumbing"):
        tracking.paper_tracking(rows, 2.0)
