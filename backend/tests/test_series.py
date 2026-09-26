"""Series builders (TASKS 3.1; ANALYTICS_CATALOG C1, C2, C6 and section 14; ARCHITECTURE s4 item (g)).

- Basis A from the screen CSVs through the research service: the section 14 Sharpe anchors (volmanaged `r_m_1`
  0.9914875364356387 and `r_bh_1`, dtsmom `r_ts_1` 0.25493487321272734 on 120 months) within 1e-12, and the
  born-failing sqrt(365) case.
- Basis B from Nautilus snapshots through the runs service: compounding from K ends at `balance_check.final_usd`.
- Realised daily P&L (runs without snapshots) on every gated session: gate-rejected sessions are dropped, the
  counts must equal the run's own `data` block, and a rejected session that carries P&L is refused (born failing).
- Benchmarks per C6: the paired Nautilus run for sized books and dtsmom, NQ buy and hold close to close through the
  gate (caller "terminal") for intraday runs and one-contract NQ screens.
"""
from __future__ import annotations

import json
import math
import shutil
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import ROOT
from nq_lab.dtsmom_panel import build_panel
from nq_terminal.analytics import perf, series
from nq_terminal.services.bars import BarService
from nq_terminal.services.research import ResearchService

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from test_runs_support import RUNS, FakeClock, copy_root, result_doc, service

ANCHOR = 1e-12
R_M_1 = 0.9914875364356387
R_BH_1 = 0.9946882195853758
R_TS_1 = 0.25493487321272734
CACHE_BYTES = 256 * 1024**2


@lru_cache(maxsize=1)
def real_research() -> ResearchService:
    return ResearchService(ROOT)


@lru_cache(maxsize=1)
def real_runs():
    return service(ROOT, clock=FakeClock())


def fixture_research() -> ResearchService:
    return ResearchService(FIXTURES)


def fixture_runs():
    return service(FIXTURES, clock=FakeClock())


def fake_bars(tmp_path: Path) -> tuple[BarService, object]:
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    return BarService(serve, cache_bytes=CACHE_BYTES), serve


# ---------------------------------------------------------------- session index


def test_session_index_is_nyse_sessions_end_exclusive():
    idx = series.session_index("2021-12-20", "2022-01-01")
    assert isinstance(idx, pd.DatetimeIndex) and idx.tz is None
    days = [d.strftime("%Y-%m-%d") for d in idx]
    assert days == ["2021-12-20", "2021-12-21", "2021-12-22", "2021-12-23", "2021-12-27", "2021-12-28",
                    "2021-12-29", "2021-12-30", "2021-12-31"]  # 24 Dec 2021 closed, weekends out


def test_session_index_counts_the_run_window():
    assert len(series.session_index("2010-09-28", "2022-01-01")) == 2836  # data.sessions of the za and overnight runs


def test_session_index_refuses_an_empty_or_reversed_window():
    with pytest.raises(ValueError, match="window"):
        series.session_index("2022-01-01", "2021-01-01")


# ---------------------------------------------------------------- SessionSeries contract


def _toy(periods: int = 252, **extra) -> series.SessionSeries:
    idx = pd.DatetimeIndex(["2015-01-02", "2015-01-05", "2015-01-06"])
    return series.SessionSeries(name="toy", basis="A", periods=periods, r=pd.Series([0.01, -0.02, 0.005], index=idx),
                                unit="return on capital per session", on_capital=True, capital=1.0, source="toy",
                                kind="daily", label="toy", **extra)


def test_session_series_accepts_a_clean_daily_series():
    s = _toy()
    assert s.periods == 252 and s.n == 3


def test_session_series_refuses_sqrt_365():
    """Born failing (QA protocol 4): a calendar-day annualisation cannot even be declared."""
    with pytest.raises(ValueError, match="periods"):
        _toy(periods=365)


def test_session_series_refuses_nan_unsorted_or_repeated_sessions():
    idx = pd.DatetimeIndex(["2015-01-05", "2015-01-02"])
    base = dict(name="x", basis="A", periods=252, unit="u", on_capital=True, capital=1.0, source="s", kind="daily",
                label="l")
    with pytest.raises(ValueError, match="NaN"):
        series.SessionSeries(r=pd.Series([0.1, math.nan], index=idx.sort_values()), **base)
    with pytest.raises(ValueError, match="increasing"):
        series.SessionSeries(r=pd.Series([0.1, 0.2], index=idx), **base)
    with pytest.raises(ValueError, match="increasing"):
        series.SessionSeries(r=pd.Series([0.1, 0.2], index=pd.DatetimeIndex(["2015-01-02"] * 2)), **base)
    with pytest.raises(ValueError, match="basis"):
        series.SessionSeries(r=pd.Series([0.1], index=idx[:1]), **{**base, "basis": "C"})


# ---------------------------------------------------------------- Basis A anchors (section 14)


def test_volmanaged_r_m_1_sharpe_anchor():
    s = series.hypothesis_series(real_research(), "volmanaged_v0", 1)
    assert (s.basis, s.periods, s.kind, s.on_capital) == ("A", 252, "daily", True)
    assert s.n == 2686
    assert abs(perf.sharpe(s.r, s.periods) - R_M_1) <= ANCHOR


def test_volmanaged_benchmark_is_same_exposure_buy_and_hold():
    s = series.hypothesis_series(real_research(), "volmanaged_v0", 1)
    assert s.bench is not None and s.bench.index.equals(s.r.index)
    assert s.bench_label == "same-exposure buy and hold (r_bh_1)"
    assert abs(perf.sharpe(s.bench, 252) - R_BH_1) <= ANCHOR


def test_dtsmom_r_ts_1_sharpe_anchor_on_120_months():
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    assert (s.basis, s.periods, s.kind, s.n) == ("A", 12, "monthly", 120)
    assert abs(perf.sharpe(s.r, s.periods) - R_TS_1) <= ANCHOR
    assert s.bench is not None and s.bench_label == "long-only equal-risk book (r_lo_1)"


def test_sqrt_365_misses_the_anchors():
    """Born failing (QA protocol 4): the same series annualised with sqrt(365) fails both anchors."""
    vol = series.hypothesis_series(real_research(), "volmanaged_v0", 1).r
    wrong = vol.mean() / vol.std(ddof=1) * math.sqrt(365)
    assert abs(wrong - R_M_1) > 0.1
    with pytest.raises(ValueError, match="periods"):
        perf.sharpe(vol, 365)
    ts = series.hypothesis_series(real_research(), "dtsmom_v0", 1).r
    assert abs(ts.mean() / ts.std(ddof=1) * math.sqrt(365) - R_TS_1) > 0.1


def test_basis_a_series_equals_the_research_series_values():
    rs = real_research().series("volmanaged_v0", 1)
    s = series.hypothesis_series(real_research(), "volmanaged_v0", 1)
    assert s.r.to_numpy().tolist() == rs.r
    assert s.source == rs.source == "volmanaged_v0_daily.csv"


# ---------------------------------------------------------------- Basis A, one-contract USD series


def test_trades_series_is_zero_filled_on_every_session_of_the_screen_window():
    """Item (d): the window the screen served (here the NQ data start to the fence), not first to last trade."""
    rs = fixture_research().series("overnight_v0", 1)
    s = series.hypothesis_series(fixture_research(), "overnight_v0", 1)
    assert (s.kind, s.on_capital, s.capital, s.periods) == ("trades", False, None, 252)
    assert s.unit == "USD per session, one NQ contract"
    assert s.r.index.equals(series.session_index("2010-09-28", "2022-01-01"))
    assert s.r.sum() == pytest.approx(sum(rs.r), abs=1e-9)
    assert int((s.r != 0).sum()) == len(rs.r)


def test_za_v0_trades_drop_the_gate_rejected_sessions():
    s = series.hypothesis_series(real_research(), "za_v0", 1)
    rejected = json.loads((ROOT / "results" / "screens" / "za_v0_repaired_rejected_days.json").read_text(
        encoding="utf-8"))
    days = set(s.r.index.strftime("%Y-%m-%d"))
    inside = [d for d in rejected if "2010-09-28" <= d <= "2021-12-31"]  # the screen window
    assert inside and not days & set(inside)
    assert set(s.dropped) == set(inside)
    assert int((s.r != 0).sum()) <= 2778


def test_recorded_rows_keep_their_rows_and_void_nights_are_zero():
    s = series.hypothesis_series(real_research(), "eurodrift_v0", 1)
    assert s.kind == "nights" and s.n == 2835  # every candidate night; void nights are 0 (the screen's own book)


def test_every_registered_series_builds():
    for card in real_research().cards():
        if not card.registered or not card.series_costs:
            continue
        s = series.hypothesis_series(real_research(), card.name, card.series_costs[0])
        assert s.n > 0 and s.r.index.is_monotonic_increasing, card.name


def test_one_contract_screens_get_the_nq_usd_benchmark_through_the_gate(tmp_path):
    bars, serve = fake_bars(tmp_path)
    s = series.hypothesis_series(fixture_research(), "overnight_v0", 1, bars=bars)
    assert s.bench is not None and s.bench.index.equals(s.r.index)
    assert s.bench_label == series.NQ_BH_USD_LABEL
    assert serve.served and all(c.caller == "terminal" for c in serve.calls)
    served = bars.frame("NQ.V.0", "1d", "vendor", series.IS_START, series.IS_END).frame  # cached: no new serve
    days = [d.date() for d in series.session_index(s.r.index[0] - pd.Timedelta(days=7), s.r.index[-1]
                                                   + pd.Timedelta(days=1))]
    panel = build_panel({"NQ.V.0": served}, days)
    expected = pd.Series(panel.dB[:, 0] * 20.0, index=pd.DatetimeIndex(days)).reindex(s.r.index)
    assert np.allclose(s.bench.to_numpy(), expected.to_numpy(), rtol=0, atol=1e-9)
    assert np.isfinite(s.bench.to_numpy()).all()


def test_without_a_bar_service_there_is_no_price_benchmark():
    s = series.hypothesis_series(fixture_research(), "overnight_v0", 1)
    assert s.bench is None and s.bench_label is None


# ---------------------------------------------------------------- Basis B from snapshots


def test_snapshot_run_compounds_from_k_to_the_final_balance():
    run_id = RUNS["sized"]
    s = series.run_series(fixture_runs(), fixture_research(), run_id)
    doc = result_doc(run_id)
    k, final = doc["balance_check"]["starting_usd"], doc["balance_check"]["final_usd"]
    assert (s.basis, s.periods, s.kind, s.capital, s.on_capital) == ("B", 252, "mtm_snapshots", k, True)
    assert s.n == len(doc["strategy_log"]["snapshots"])
    assert k * float(np.prod(1.0 + s.r.to_numpy())) == pytest.approx(final, rel=1e-12)
    first = doc["strategy_log"]["snapshots"][0]["equity"]
    assert s.r.iloc[0] == pytest.approx(float(first) / k - 1.0, rel=1e-12)


def test_real_dtsmom_run_has_one_return_per_snapshot():
    s = series.run_series(real_runs(), real_research(), "nt_dtsmom_v0_ts1")
    assert s.n == 2517 and s.kind == "mtm_snapshots"
    final = real_runs().equity("nt_dtsmom_v0_ts1").final_usd
    assert s.capital * float(np.prod(1.0 + s.r.to_numpy())) == pytest.approx(final, rel=1e-12)


def test_unusable_run_is_refused():
    with pytest.raises(series.SeriesUnusable, match="rule 4"):
        series.run_series(fixture_runs(), fixture_research(), RUNS["unbalanced"])


# ---------------------------------------------------------------- realised P&L on every gated session (item g)


def test_za_run_keeps_every_gated_session_and_drops_the_rejected_ones():
    run_id = RUNS["za_orb"]
    s = series.run_series(fixture_runs(), fixture_research(), run_id)
    doc = result_doc(run_id)
    assert s.kind == "realised_trades" and s.label == "realised, no MTM"
    assert s.n == doc["data"]["gated_days"] == 2825
    rejected = json.loads((FIXTURES / "results" / "screens" / "za_v0_repaired_rejected_days.json").read_text(
        encoding="utf-8"))
    assert set(s.dropped) == set(rejected)
    assert not set(s.r.index.strftime("%Y-%m-%d")) & set(rejected)
    k = doc["balance_check"]["starting_usd"]
    assert k * float(np.prod(1.0 + s.r.to_numpy())) == pytest.approx(k + doc["pnl_total"], rel=1e-12)
    assert int((s.r != 0).sum()) == len({t["date"] for t in doc["trades"]})


def test_overnight_run_keeps_its_nights():
    run_id = RUNS["overnight"]
    s = series.run_series(fixture_runs(), fixture_research(), run_id)
    doc = result_doc(run_id)
    assert s.n == doc["data"]["nights"] == 2825
    skipped = {row["entry_date"] for row in doc["data"]["skipped"]}
    assert skipped <= set(s.dropped) and "2021-12-31" in s.dropped  # the last session starts no night in the window
    assert len(s.dropped) == len(skipped) + 1


def test_real_za_run_gated_sessions_match_its_data_block():
    s = series.run_series(real_runs(), real_research(), "nt_za_v0_repaired_a")
    assert s.n == 2825 and len(s.dropped) == 11
    final = real_runs().equity("nt_za_v0_repaired_a").final_usd
    assert s.capital * float(np.prod(1.0 + s.r.to_numpy())) == pytest.approx(final, rel=1e-12)


def _tampered_root(tmp_path: Path, rejected: dict) -> Path:
    root = copy_root(tmp_path, [RUNS["za_orb"]], session_qa=False)
    screens = root / "results" / "screens"
    screens.mkdir(parents=True)
    shutil.copy(FIXTURES / "results" / "screens" / "za_v0_rejected_days.json", screens)
    (screens / "za_v0_repaired_rejected_days.json").write_text(json.dumps(rejected), encoding="utf-8")
    return root


def _fixture_rejected() -> dict:
    return json.loads((FIXTURES / "results" / "screens" / "za_v0_repaired_rejected_days.json").read_text(
        encoding="utf-8"))


def test_a_rejected_session_with_pnl_is_refused(tmp_path):
    """Born failing: a rejected-days file that names a traded session cannot silently drop that P&L."""
    rejected = _fixture_rejected()
    rejected.pop("2020-03-18")
    rejected["2014-01-03"] = "tampered"  # a session with a fixture trade
    root = _tampered_root(tmp_path, rejected)
    with pytest.raises(series.SeriesError, match="2014-01-03"):
        series.run_series(service(root), ResearchService(root), RUNS["za_orb"])


def test_a_rejected_days_file_that_disagrees_with_the_run_is_refused(tmp_path):
    """Born failing: a stale rejected-days list (one day short) no longer matches data.gated_days."""
    rejected = _fixture_rejected()
    rejected.pop("2020-03-18")
    root = _tampered_root(tmp_path, rejected)
    with pytest.raises(series.SeriesError, match="gated"):
        series.run_series(service(root), ResearchService(root), RUNS["za_orb"])


def test_the_untampered_copy_passes(tmp_path):
    root = _tampered_root(tmp_path, _fixture_rejected())
    assert series.run_series(service(root), ResearchService(root), RUNS["za_orb"]).n == 2825


def test_a_missing_rejected_days_file_is_refused(tmp_path):
    root = copy_root(tmp_path, [RUNS["za_orb"]], session_qa=False)
    with pytest.raises(series.SeriesError, match="rejected"):
        series.run_series(service(root), ResearchService(root), RUNS["za_orb"])


# ---------------------------------------------------------------- run benchmarks (C6)


def test_intraday_run_benchmark_is_nq_buy_and_hold_through_the_gate(tmp_path):
    bars, serve = fake_bars(tmp_path)
    s = series.run_series(fixture_runs(), fixture_research(), RUNS["za_orb"], bars=bars)
    assert s.bench is not None and s.bench.index.equals(s.r.index)
    assert s.bench_label == series.NQ_BH_LABEL
    assert serve.served and all(c.caller == "terminal" for c in serve.calls)
    served = bars.frame("NQ.V.0", "1d", "vendor", series.IS_START, series.IS_END).frame
    days = [d.date() for d in series.session_index("2010-09-28", "2022-01-01")]
    panel = build_panel({"NQ.V.0": served}, days)
    full = pd.Series(panel.r[:, 0], index=pd.DatetimeIndex(days))
    expected = full.reindex(s.r.index)
    assert np.allclose(s.bench.to_numpy(), expected.to_numpy(), rtol=0, atol=0, equal_nan=True)
    assert np.isfinite(s.bench.to_numpy()[1:]).all()


def test_intraday_run_without_bars_has_no_benchmark():
    s = series.run_series(fixture_runs(), fixture_research(), RUNS["za_orb"])
    assert s.bench is None


def test_sized_run_benchmark_is_the_paired_bh_run():
    s = series.run_series(real_runs(), real_research(), "nt_volmanaged_v0_final_m1")
    assert s.bench_label == "paired run nt_volmanaged_v0_final_bh1 (same-exposure buy and hold)"
    bh = series.run_series(real_runs(), real_research(), "nt_volmanaged_v0_final_bh1")
    assert s.bench.dropna().equals(bh.r.reindex(s.r.index).dropna())


def test_dtsmom_run_benchmark_is_the_long_only_run():
    s = series.run_series(real_runs(), real_research(), "nt_dtsmom_v0_ts1")
    assert s.bench_label == "paired run nt_dtsmom_v0_lo1 (long-only equal-risk book)"
    assert s.bench is not None and int(s.bench.notna().sum()) == 2517


def test_benchmark_runs_carry_no_benchmark_and_fixture_sized_has_no_pair():
    assert series.run_series(real_runs(), real_research(), "nt_dtsmom_v0_lo1").bench is None
    assert series.run_series(fixture_runs(), fixture_research(), RUNS["sized"]).bench is None


def test_pair_choice_prefers_the_longest_shared_name():
    names = ["nt_volmanaged_v0_bh1", "nt_volmanaged_v0_final_bh1"]
    assert series.closest_name("nt_volmanaged_v0_final_m1", names) == "nt_volmanaged_v0_final_bh1"
    assert series.closest_name("nt_volmanaged_v0_m1", names) == "nt_volmanaged_v0_bh1"
    assert series.closest_name("x", []) is None


def test_fake_catalog_version_is_accepted(tmp_path):
    bars, _ = fake_bars(tmp_path)
    version = FakeCatalog().version("NQ.V.0", "1d", "vendor")
    s = series.run_series(fixture_runs(), fixture_research(), RUNS["overnight"], bars=bars, version=version)
    assert s.bench is not None
