"""P1 dumps for the reference cross-check in `terminal/qa` (TASKS Phase 10; ANALYTICS_CATALOG section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), with the prefix `nqt_p1_`
so the two dump tests never delete each other's files. Every dump is a bundle: the raw inputs and the values each
implementation computed; `terminal/qa/crosscheck/p1_reference.py` recomputes each one with the reference libraries.

- `p1series` (PF7, PF8, PF9, RK3, RD3, RD4, RL3, RL4, BR3, BR4): the served series of volmanaged_v0, dtsmom_v0 and
  za_v0 at 1 tick, the run nt_dtsmom_v0_ts1 and a seeded synthetic account series; `nautilus` adds
  `UpCaptureRatio`, `DownCaptureRatio` and `BetaRatio` per rolling window and over the whole sample.
- `bootstrap` (SV5, SV6): the series, seed and replication count, with the block length, the interval bounds and
  the cone percentiles; the reference redraws with arch's `StationaryBootstrap` at the same seed.
- `deflated` (SV3, SV3b): every registered trial's series (with its session dates) at 1 tick as the route builds it,
  with N, V, SR0 and each DSR, and the served `effective_n` (the `neff_*` keys: the effective number of trials, the
  SR0 and DSR each sets); `stored` carries the paper fixture (0.1132, 0.9004), `ours` the terminal's value of it
  rounded to 4 decimals.
- `paths` (TA2, TA4, TA5): three hand-built trades over six bars (the golden fixture), and za's and overnight's
  first trades over synthetic 1-minute bars from the tests' fake serve (no gate read of real prices), bars cut to
  the trades' spans and each trade's block moved to its fill level (the bar ending at the entry closes at the entry
  fill), so MAE and MFE are of a sensible size and the entry passes the price basis check; TA4 and TA5 on the whole
  za trade list.
- `regimes` (RG1) and `stress` (RK5): volmanaged_v0's series with the recorded `sigma2`, and with the frozen windows.
- `tracking` (LV5): the fixture journal's performance close rows plus a hand-built roll.

Read-only on `results/`; writes only into the dump folder.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, _synthetic, checked_dump_dir, dump_dir

from nq_lab import paper_plumbing
from nq_lab.config import RESULTS, ROOT
from nq_terminal import constants
from nq_terminal.analytics import (
    bootstrap,
    deflated,
    distribution,
    excursions,
    neff,
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
from nq_terminal.services import journals, run_books, tearsheet_extended
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService

from fakes import FIXTURES, make_fake_serve

PREFIX = "nqt_p1_"
NEFF_KEYS = ("neff_window_sessions", "neff_correlation", "neff_eigenvalues", "neff_participation", "neff_li_ji",
             "neff_clusters", "neff_n_total", "neff_sr0_session", "neff_dsr_participation", "neff_dsr_li_ji",
             "neff_dsr_clusters")
SERIES_CASES = (("volmanaged_v0", 1), ("dtsmom_v0", 1), ("za_v0", 1))
RUN_CASES = ("nt_dtsmom_v0_ts1",)
BOOT_CASES = ("volmanaged_v0", "dtsmom_v0", "synthetic_b")
PATH_RUNS = (("nt_za_v0_repaired_a", 40), ("nt_overnight_v0_open_a", 15))  # first n trades
HAND_BARS = pd.DataFrame({"ts": pd.date_range("2015-03-02 14:30", periods=6, freq="1min", tz="UTC"),
                          "h": [101.0, 102.5, 101.5, 104.0, 103.0, 105.0],
                          "l": [99.5, 100.0, 98.0, 100.5, 101.0, 102.0]})
HAND_TRADES = [
    {"direction": 1, "entry_ts": "2015-03-02T14:30:00+00:00", "exit_ts": "2015-03-02T14:34:00+00:00",
     "entry_px": 100.0, "exit_px": 102.0, "r_pts": 2.0, "pnl_usd": 40.0},
    {"direction": -1, "entry_ts": "2015-03-02T14:31:30+00:00", "exit_ts": "2015-03-02T14:33:30+00:00",
     "entry_px": 101.0, "exit_px": 100.0, "r_pts": None, "pnl_usd": 20.0},
    {"direction": 1, "entry_ts": "2015-03-02T14:40:00+00:00", "exit_ts": "2015-03-02T14:45:00+00:00",
     "entry_px": 103.0, "exit_px": 102.5, "r_pts": None, "pnl_usd": -10.0},
]
ROLL_ROWS = [
    {"type": "close", "date": "2026-12-07", "contract": "MNQZ6.CME", "target": 6, "actual": {"MNQZ6.CME": 6},
     "close_px_by_contract": {"MNQZ6.CME": 100.0, "MNQH7.CME": 110.0}},
    {"type": "close", "date": "2026-12-08", "contract": "MNQH7.CME", "target": 5, "actual": {"MNQH7.CME": 6},
     "close_px_by_contract": {"MNQZ6.CME": 101.0, "MNQH7.CME": 112.0}},
    {"type": "close", "date": "2026-12-09", "contract": "MNQH7.CME", "target": 5, "actual": {"MNQH7.CME": 5},
     "close_px_by_contract": {"MNQH7.CME": 111.5}},
]


class Case:
    def __init__(self, name: str, basis: str, periods: int, r: pd.Series, bench: pd.Series | None, on_capital: bool,
                 source: str):
        self.name, self.basis, self.periods, self.r, self.bench = name, basis, periods, r, bench
        self.on_capital, self.source = on_capital, source


def _research() -> ResearchService:
    return ResearchService(ROOT)


def _runs() -> RunService:
    return RunService(data_root=ROOT, project_root=ROOT)


def build_cases() -> list[Case]:
    research, runs = _research(), _runs()
    out = []
    for name, cost in SERIES_CASES:
        s = series.hypothesis_series(research, name, cost)
        out.append(Case(name, s.basis, s.periods, s.r, s.bench, s.on_capital, f"{s.source}, {s.label}"))
    for run_id in RUN_CASES:
        s = series.run_series(runs, research, run_id)
        out.append(Case(run_id, s.basis, s.periods, s.r, s.bench, s.on_capital, f"{s.source}, {s.label}"))
    r, b = _synthetic()
    out.append(Case("synthetic_b", "B", 252, r, b, True, "seeded synthetic account series (not project data)"))
    return out


def _dates(index: pd.Index) -> list[str]:
    return [pd.Timestamp(d).strftime("%Y-%m-%d") for d in index]


def _bundle(kind: str, case: str, source: str, inputs: dict, values: dict, missing: dict | None = None) -> dict:
    return _clean({"schema": SCHEMA, "kind": kind, "case": case, "source": source, "inputs": inputs,
                   "values": values, "missing": missing or {}})


def _stamps(index: pd.Index) -> list[int]:
    return pd.DatetimeIndex(index).tz_localize("UTC").as_unit("ns").asi8.tolist()


# ---------------------------------------------------------------- p1series


def _eff(case: Case) -> str:
    return case.basis if case.on_capital else "A"


def _ours_series(case: Case) -> dict:
    r = case.r
    out = {"omega": perf.omega(r), "tail_ratio": perf.tail_ratio(r),
           "gain_to_pain": perf.gain_to_pain(r, _eff(case), case.periods)}
    for level, row in risk.modified_var_table(r).items():
        out.update({f"var_normal_{level}": row["normal"], f"var_cf_raw_{level}": row["raw_expansion"],
                    f"cf_in_domain_{level}": float(row["in_domain"]), f"var_modified_{level}": row["value"],
                    f"var_historical_{level}": row["historical"]})
    jb, qq = distribution.jarque_bera(r), distribution.qq_plot(r)
    out.update({"jb_statistic": jb["statistic"], "jb_p": jb["p"], "qq_theoretical": qq["theoretical"].tolist(),
                "qq_slope": qq["slope"], "qq_intercept": qq["intercept"], "qq_r": qq["r"]})
    for w in rolling.windows_for(case.periods):
        band = rolling.sharpe_band(r, w, case.periods)
        out.update({f"band_lo_{w}": band["lo"], f"band_hi_{w}": band["hi"]})
    if case.bench is not None:
        window = rolling.relative_window(case.periods)
        fit = relative.scatter(r, case.bench, case.periods)
        out.update({"rolling_beta": rolling.rolling_beta(r, case.bench, window).tolist(),
                    "rolling_correlation": rolling.rolling_correlation(r, case.bench, window).tolist(),
                    "scatter_slope": fit["slope"], "scatter_intercept": fit["intercept"]})
        if case.on_capital:
            out.update({"up_capture": relative.up_capture(r, case.bench, case.periods),
                        "down_capture": relative.down_capture(r, case.bench, case.periods)})
    return out


def _nautilus_series(case: Case) -> dict:
    from nautilus_trader.analysis import BetaRatio, DownCaptureRatio, UpCaptureRatio
    if case.bench is None:
        return {}
    x, y, index = relative.align_pair(case.r, case.bench)
    stamps = _stamps(index)
    rs, bs = dict(zip(stamps, x.tolist())), dict(zip(stamps, y.tolist()))
    out = {"scatter_slope": BetaRatio().calculate_from_returns_with_benchmark(rs, bs)}
    if case.on_capital:
        out.update(up_capture=UpCaptureRatio(case.periods).calculate_from_returns_with_benchmark(rs, bs),
                   down_capture=DownCaptureRatio(case.periods).calculate_from_returns_with_benchmark(rs, bs))
    window = rolling.relative_window(case.periods)
    bench = case.bench.reindex(case.r.index).to_numpy(dtype=float)
    mine, all_stamps, betas = case.r.to_numpy(), _stamps(case.r.index), []
    for end in range(len(mine)):
        lo = end - window + 1
        if lo < 0 or np.isnan(bench[lo:end + 1]).any():
            betas.append(None)
            continue
        keys = all_stamps[lo:end + 1]
        betas.append(BetaRatio().calculate_from_returns_with_benchmark(
            dict(zip(keys, mine[lo:end + 1].tolist())), dict(zip(keys, bench[lo:end + 1].tolist()))))
    out["rolling_beta"] = betas
    return out


def series_doc(case: Case) -> dict:
    inputs = {"dates": _dates(case.r.index), "r": case.r.tolist(),
              "bench": None if case.bench is None else case.bench.reindex(case.r.index).tolist(),
              "basis": case.basis, "periods": case.periods, "on_capital": case.on_capital}
    return _bundle("p1series", f"p1series_{case.name}", case.source, inputs,
                   {"ours": _ours_series(case), "nautilus": _nautilus_series(case)})


# ---------------------------------------------------------------- bootstrap


def ruin_case() -> Case:
    """A seeded Basis A book (daily sd 3% of K, point CAGR near 27%) where about 1% of replications lose all of K."""
    rng = np.random.default_rng(21)
    r = pd.Series(0.0012 + 0.03 * rng.standard_normal(504), index=pd.bdate_range("2012-01-02", periods=504))
    return Case("synthetic_ruin_a", "A", 252, r, None, True, "seeded synthetic Basis A book that can lose all of K "
                "(not project data)")


def bootstrap_doc(case: Case) -> dict:
    found = bootstrap.bootstrap_summary(case.r, _eff(case), case.periods, on_capital=case.on_capital)
    ours = {"block_stationary": found["block"]["stationary"], "block_circular": found["block"]["circular"]}
    for name, interval in found["stats"].items():
        if interval is not None:
            ours.update({f"{name}_lo": interval["lo"], f"{name}_hi": interval["hi"],
                         f"{name}_median": interval["median"]})
            if name == "cagr":
                ours["cagr_ruin"] = float(interval["ruin"])
    ours.update({f"cone_{q}": list(v) for q, v in found["cone"]["quantiles"].items()})
    ours["cone_realised"] = list(found["cone"]["realised"])
    inputs = {"r": case.r.tolist(), "basis": _eff(case), "periods": case.periods, "on_capital": case.on_capital,
              "seed": found["seed"], "reps": found["reps"], "horizon": found["cone"]["horizon"],
              "confidence": found["confidence"]}
    return _bundle("bootstrap", f"bootstrap_{case.name}", case.source, inputs, {"ours": ours})


# ---------------------------------------------------------------- deflated


def neff_values(view) -> dict:
    """The served `effective_n` of the SV3 view as the dump's `ours` keys (see `p1_reference.neff_references`)."""
    if view.refusal is not None:
        return {}
    names, by = view.daily, {e.id: e for e in view.estimates}
    ranked = [[names[i] for i in group] for group in neff.rank_clusters(view.clusters)]
    return {"neff_window_sessions": float(view.window.sessions),
            "neff_correlation": {f"{a}|{b}": view.correlation[i][j] for i, a in enumerate(names)
                                 for j, b in enumerate(names) if i <= j},
            "neff_eigenvalues": list(view.eigenvalues), "neff_participation": by["participation"].n_daily,
            "neff_li_ji": by["li_ji"].n_daily, "neff_clusters": ";".join(",".join(g) for g in ranked),
            "neff_n_total": {k: by[k].n_total for k in neff.ESTIMATORS},
            "neff_sr0_session": {k: e.sr0_session for k, e in by.items()},
            **{f"neff_dsr_{k}": {d.name: getattr(d, k) for d in view.dsr} for k in neff.ESTIMATORS}}


def deflated_doc() -> dict:
    research = _research()
    trials = []
    for row in research.registry_rows():
        if row.registered:
            s = series.hypothesis_series(research, row.name, deflated.COST)
            trials.append(deflated.Trial(row.name, s.kind, s.periods, s.r))
    found = deflated.registry_dsr(trials)
    served = tearsheet_extended.deflated_view(trials).effective_n
    paper_sr0 = deflated.expected_max_sharpe(100, 1 / (2 * 250))
    paper_dsr = deflated.deflated_sharpe(2.5 / math.sqrt(250), paper_sr0, 1250, -3.0, 10.0)
    ours = {"n_trials": float(found["n_trials"]), "variance": found["variance"], "sr0_session": found["sr0_session"],
            "sr0_annual": found["sr0_annual"], "dsr": {row["name"]: row["dsr"] for row in found["rows"]},
            "sr_session": {row["name"]: row["sr_session"] for row in found["rows"]},
            "variance_null": found["variance_null"], "sr0_null_session": found["sr0_null_session"],
            "sr0_null_annual": found["sr0_null_annual"],
            "dsr_null": {row["name"]: row["dsr_null"] for row in found["rows"]},
            "loo_variance": {found["leave_one_out"]["name"]: found["leave_one_out"]["variance"]},
            "loo_sr0_session": {found["leave_one_out"]["name"]: found["leave_one_out"]["sr0_session"]},
            "paper_sr0": round(paper_sr0, 4), "paper_dsr": round(paper_dsr, 4), **neff_values(served)}
    registered = sum(1 for row in research.registry_rows() if row.registered)
    inputs = {"trials": [{"name": t.name, "periods": t.periods, "r": t.r.tolist(),
                          "dates": [d.strftime("%Y-%m-%d") for d in t.r.index]} for t in trials],
              "paper": {"n_trials": 100, "variance": 1 / (2 * 250), "t": 1250, "skew": -3.0, "kurt": 10.0,
                        "sr": 2.5 / math.sqrt(250)}}
    stored = {"paper_sr0": 0.1132, "paper_dsr": 0.9004, "n_trials": float(registered)}
    return _bundle("deflated", "deflated_registry", "every registered row of results/registry.csv at 1 tick",
                   inputs, {"ours": ours, "stored": stored})


# ---------------------------------------------------------------- paths (TA2, TA4, TA5)


def _bars_in_spans(frame: pd.DataFrame, rows: list[dict]) -> pd.DataFrame:
    """Each trade's bars (two minutes before the entry to one after the exit), shifted so the bar ending at the
    entry (or the last bar before it) closes at the entry fill; synthetic bars sit at the 2010 level, the fills at
    the back-adjusted one. A bar two trades share keeps the first trade's shift."""
    ts = pd.to_datetime(frame["ts"], utc=True)
    blocks = []
    for row in rows:
        entry = pd.Timestamp(row["entry_ts"])
        lo, hi = entry - pd.Timedelta(minutes=2), pd.Timestamp(row["exit_ts"]) + pd.Timedelta(minutes=1)
        block = frame.loc[((ts >= lo) & (ts <= hi)).to_numpy(), ["ts", "h", "l", "c"]].copy()
        before = block[pd.to_datetime(block["ts"], utc=True) < entry]
        anchor = before["c"].iloc[-1] if len(before) else block["c"].iloc[0]
        shift = float(row["entry_px"]) - float(anchor)
        blocks.append(block.assign(h=block["h"] + shift, l=block["l"] + shift))
    out = pd.concat(blocks).drop_duplicates("ts", keep="first").sort_values("ts")
    return out[["ts", "h", "l"]].reset_index(drop=True)


def _trade_fields(row: dict) -> dict:
    return {k: row.get(k) for k in ("direction", "entry_ts", "exit_ts", "entry_px", "exit_px", "r_pts", "pnl_usd",
                                    "reason")}


def paths_doc(case: str, rows: list[dict], bars: pd.DataFrame, point_value: float, tick: float, source: str,
              everything: list[dict] | None = None) -> dict:
    found = excursions.excursions(rows, bars, point_value=point_value, tick=tick)
    whole = everything if everything is not None else rows
    hold, streak = trades.holding_times(whole), trades.streaks(whole)
    ours = {"mae_pts": [r["mae_pts"] for r in found["rows"]], "mfe_pts": [r["mfe_pts"] for r in found["rows"]],
            "whole_bars": [float(r["whole_bars"]) for r in found["rows"]],
            "off_basis": [float(r["off_basis"]) for r in found["rows"]],
            "holding_minutes": hold["durations"], "holding_median": hold["median"],
            "longest_win": float(streak["longest_win"]), "longest_loss": float(streak["longest_loss"]),
            "runs": float(streak["runs_test"]["runs"]), "runs_z": streak["runs_test"]["z"],
            "runs_p": streak["runs_test"]["p"]}
    inputs = {"trades": [_trade_fields(r) for r in rows], "all_trades": [_trade_fields(r) for r in whole],
              "bars": {"ts": [pd.Timestamp(t).isoformat() for t in bars["ts"]], "h": bars["h"].tolist(),
                       "l": bars["l"].tolist()}, "point_value": point_value, "tick": tick}
    return _bundle("paths", f"paths_{case}", source, inputs, {"ours": ours})


def path_docs(serve) -> list[dict]:
    docs = [paths_doc("hand_fixture", HAND_TRADES, HAND_BARS, 20.0, 0.25, "three hand-built trades over six bars "
                      "(tests/test_p1_trade_paths.py)")]
    runs = _runs()
    for run_id, count in PATH_RUNS:
        book = run_books.load_book(runs, run_id)
        rows = [dict(r) for r in book.trades[:count]]
        start = pd.Timestamp(rows[0]["entry_ts"]).floor("D")
        end = pd.Timestamp(rows[-1]["exit_ts"]).floor("D") + pd.Timedelta(days=1)
        frame = serve(start, end, caller="terminal", reason="terminal display: QA dump (synthetic bars)",
                      symbol="NQ.V.0", timeframe="1m", variant="repaired")
        docs.append(paths_doc(run_id, rows, _bars_in_spans(frame, rows), float(book.instruments[0].multiplier),
                              float(book.instruments[0].tick_size),
                              f"backtests/output/{run_id} first {count} trades over synthetic 1m bars (fake serve) "
                              "moved to each trade's entry fill",
                              everything=[dict(r) for r in book.trades]))
    return docs


# ---------------------------------------------------------------- regimes, stress, tracking


def regimes_doc(case: Case) -> dict:
    frame = pd.read_csv(RESULTS / "screens" / "volmanaged_v0_daily.csv", parse_dates=["date"])
    rv = frame.set_index("date")["sigma2"].dropna()
    found = regimes.regime_stats(case.r, rv, case.periods)
    codes = {"low": 0.0, "mid": 1.0, "high": 2.0}
    ours = {"welch_t": found["welch_t"], "unlabelled": float(found["unlabelled"]),
            "labels": [None if pd.isna(v) else codes[v] for v in found["frame"]["regime"].to_numpy()]}
    for row in found["rows"]:
        ours.update({f"{row['regime']}_{k}": float(row[k]) for k in ("n", "mean", "sharpe", "hit_rate")})
    inputs = {"dates": _dates(case.r.index), "r": case.r.tolist(), "rv_dates": _dates(rv.index), "rv": rv.tolist(),
              "min_history": regimes.MIN_HISTORY}
    return _bundle("regimes", f"regimes_{case.name}", f"{case.source}; sigma2 from volmanaged_v0_daily.csv", inputs,
                   {"ours": ours})


def _yyyymmdd(day: str | None) -> float | None:
    """A covered date as a number (20200331.0) so the crosscheck compares it like any value."""
    return None if day is None else float(day.replace("-", ""))


def stress_doc(case: Case) -> dict:
    windows = constants.STRESS_WINDOWS
    rows = stress.window_rows(case.r, case.bench, _eff(case), windows, periods=case.periods)
    ours = {}
    for i, row in enumerate(rows):
        ours.update({f"w{i}_n": float(row["n"]), f"w{i}_strategy": row["strategy_return"],
                     f"w{i}_first": _yyyymmdd(row["covered_from"]), f"w{i}_last": _yyyymmdd(row["covered_to"]),
                     f"w{i}_bench": row["bench_return"], f"w{i}_mdd": row["strategy_max_drawdown"]})
    inputs = {"dates": _dates(case.r.index), "r": case.r.tolist(),
              "bench": None if case.bench is None else case.bench.reindex(case.r.index).tolist(),
              "basis": _eff(case), "periods": case.periods,
              "windows": [{"peak": w.peak, "trough": w.trough} for w in windows]}
    return _bundle("stress", f"stress_{case.name}", case.source, inputs, {"ours": ours})


def tracking_doc() -> dict:
    path = FIXTURES / "live" / "logs" / journals.BOOK_JOURNAL
    rows = [dict(journals.thaw(r.data)) for r in journals.JournalTailer(path).poll().rows] + ROLL_ROWS
    kept = paper_plumbing.performance_rows(rows)
    found = tracking.paper_tracking(kept, 2.0)
    ours = {k: found[k] for k in ("paper", "model", "difference")}
    ours.update(n=float(found["n"]), total_difference=found["total_difference"], tracking_sd=found["tracking_sd"])
    return _bundle("tracking", "tracking_fixture_journal", "tests/fixtures journal performance rows plus a roll",
                   {"rows": kept, "multiplier": 2.0}, {"ours": ours})


# ---------------------------------------------------------------- writing


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case']}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


@pytest.fixture(scope="module")
def cases() -> list[Case]:
    return build_cases()


def test_p1_dumps_hold_every_case(cases, tmp_path_factory):
    by_name = {c.name: c for c in cases}
    serve = make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")
    docs = ([series_doc(c) for c in cases] + [bootstrap_doc(by_name[n]) for n in BOOT_CASES] + [bootstrap_doc(ruin_case())]
            + [deflated_doc()]
            + path_docs(serve) + [regimes_doc(by_name["volmanaged_v0"]), stress_doc(by_name["volmanaged_v0"]),
                                  stress_doc(by_name["nt_dtsmom_v0_ts1"]), stress_doc(by_name["dtsmom_v0"]),
                                  tracking_doc()])
    assert all(c.caller == "terminal" for c in serve.calls)
    paths = write_dumps(dump_dir(), docs)
    assert len(paths) == len(docs)
    for path, doc in zip(paths, docs):
        back = json.loads(path.read_text(encoding="utf-8"))
        assert back["schema"] == SCHEMA and back["case"] == doc["case"] and back["values"]["ours"]


def test_the_deflated_dump_carries_each_trials_dates_and_the_served_effective_n():
    """SV3b (C8 mirror): the reference recomputes the effective number of trials from the dated series, and `ours` is
    what `GET /api/analytics/deflated` serves as `effective_n`."""
    doc = deflated_doc()
    trials, ours = doc["inputs"]["trials"], doc["values"]["ours"]
    assert all(len(t["dates"]) == len(t["r"]) for t in trials)
    daily = [t["name"] for t in trials if t["periods"] == 252]
    assert set(NEFF_KEYS) <= set(ours) and len(ours["neff_dsr_li_ji"]) == len(trials)
    assert ours["neff_window_sessions"] >= 252 and len(ours["neff_eigenvalues"]) == len(daily)
    assert len(ours["neff_correlation"]) == len(daily) * (len(daily) + 1) // 2
    assert set(ours["neff_sr0_session"]) == {"registered", "participation", "li_ji", "clusters"}
    assert set(ours["neff_n_total"]) == {"participation", "li_ji", "clusters"}
    assert sorted(n for g in ours["neff_clusters"].split(";") for n in g.split(",")) == sorted(daily)


def test_born_failing_the_paper_fixture_rounds_to_the_published_values():
    sr0 = deflated.expected_max_sharpe(100, 1 / (2 * 250))
    assert (round(sr0, 4), round(deflated.deflated_sharpe(2.5 / math.sqrt(250), sr0, 1250, -3.0, 10.0), 4)) == (
        0.1132, 0.9004)
    assert round(deflated.deflated_sharpe(2.5 / math.sqrt(250), sr0, 1250, 0.0, 3.0), 4) != 0.9004


def test_the_p1_prefix_leaves_the_p0_dumps_alone(tmp_path):
    (tmp_path / "nqt_qa_keep.json").write_text("{}", encoding="utf-8")
    write_dumps(tmp_path, [])
    assert (tmp_path / "nqt_qa_keep.json").exists()
