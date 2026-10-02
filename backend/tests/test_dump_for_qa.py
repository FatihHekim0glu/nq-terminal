"""Dumps for the reference cross-check in `terminal/qa` (TASKS 3.4; ANALYTICS_CATALOG section 14).

The terminal never imports the QA libraries and the QA project never imports the backend, so this test writes
JSON dumps that `uv run --project terminal/qa python -m crosscheck` reads. Each series dump carries the returns,
the benchmark, and every P0 scalar as computed by up to four implementations:

- `ours`: `nq_terminal.analytics` (imported lazily; a missing module or a raising function is recorded in
  `missing` with the reason, so the cross-check shows a SKIP instead of this test failing);
- `nq_lab`: the helpers the catalogue says to reuse (`sizing_stats.sharpe`, `max_drawdown`, `spanning_alpha`,
  `tails`);
- `nautilus`: the Nautilus pyo3 statistics fed `{ts_ns: r}` on a session index (C3, never the analyser path);
- `stored`: values stored in the result files and the catalogue's anchors.

Inputs: the anchor CSVs (`volmanaged_v0_daily.csv` r_m_1 and r_bh_1, `dtsmom_v0_monthly.csv` r_ts_1 against
r_lo_1), the same r_m_1 treated as an account series (Basis B, for library parity on real data), a seeded
synthetic Basis B series, and seven `served_*` cases built through the terminal's own builders
(`series.hypothesis_series` and `series.run_series`, no bar service, so no gate read): what the API serves, dates
included, so a builder fault (the dtsmom month dating) shows up here. Read-only on `results/`; writes only into the
dump folder.

Phase 8 adds the tear sheet's new series to the series dumps (EQ's `perf_difference`, RR's `rolling_vol_<w>_hi`
and `_lo`), the round 13 and 14 series as served (their stored anchors: vt_har_v0's portfolio MDD_port, vrp_eq_v0's
Sharpe, alpha and beta), and one `market` dump for MV3 (GP's RV22 line): the daily universe returns of a synthetic
1d frame (the test loader, no gate and no file) with the line `services.market` serves and the universe table's
own realised volatility at the same window as a second terminal value.

Trade and cost dumps (TA1, TA3, EX1 to EX4) carry one real Nautilus run each, read through the runs service:
- `trades` (za_orb, overnight, volmanaged, dtsmom): the per-trade net P&L and entry times; `ours` from
  `analytics.trades`, `nautilus` from `calculate_from_realized_pnls` (ProfitFactor from returns), `stored` the
  run's `summary.hit_rate`, `n_trades` and `pnl_total`;
- `costs` (za_orb, volmanaged, dtsmom): the cost model read here from the run's venue and data (not through
  `analytics.exposure`), trade and fill money as decimal strings and the snapshot grid with the prices the terminal
  values the positions at (`price_basis`); `ours` from `analytics.exposure`, `stored` the run's `pnl_total`,
  `balance_check.delta_usd`, `fees_total` and the `pnl_total` of the same book re-run at 0 and 2 ticks.

Units in the dump follow the catalogue: drawdowns and VaR as positive fractions, shortfalls in % of K (as
`sizing_stats.tails`), MinTRL in sessions (infinite when not reachable); trade and cost values in USD, exposure
and turnover as notional over equity.

The dump folder is `NQT_QA_DUMP_DIR` when set, else `terminal/qa/.dumps` (git-ignored), as in
`terminal/qa/crosscheck/paths.py`. A folder equal to or under `results/`, `backtests/output/`, `data/` or `live/`,
the project root itself, or one of its parents is refused before anything is created or deleted (the hard rule:
the terminal never writes there).
"""
from __future__ import annotations

import ast
import base64
import hashlib
import importlib
import json
import math
import os
import subprocess
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab import sizing_stats
from nq_lab.config import RESULTS, ROOT

from conftest import api_client

SCHEMA = "nqt-qa-dump/1"
PREFIX = "nqt_qa_"
ENV = "NQT_QA_DUMP_DIR"
DUMP_FOLDER = ".dumps"
QA_ROOT = Path(__file__).resolve().parents[2] / "qa"
DEFAULT_DUMP_DIR = QA_ROOT / DUMP_FOLDER
QA_PATHS = QA_ROOT / "crosscheck" / "paths.py"
SCREENS = RESULTS / "screens"
REGISTRY = RESULTS / "registry.csv"
DAILY, MONTHLY = 252, 12
CATALOG_SHARPE = {"volmanaged_v0_m1": 0.9914875364356387, "volmanaged_v0_bh1": 0.9946882195853758,
                  "dtsmom_v0_ts1": 0.25493487321272734, "served_volmanaged_v0_c1": 0.9914875364356387,
                  "served_dtsmom_v0_c1": 0.25493487321272734}  # ANALYTICS_CATALOG section 14
STORED_AS = {"served_volmanaged_v0_c1": "volmanaged_v0_m1", "served_dtsmom_v0_c1": "dtsmom_v0_ts1"}
SERVED_HYPOTHESES = (("volmanaged_v0", 1), ("dtsmom_v0", 1), ("za_v0", 1), ("vt_har_v0", 1), ("vrp_eq_v0", 1))
SERVED_RUNS = ("nt_volmanaged_v0_final_m1", "nt_dtsmom_v0_ts1", "nt_za_v0_repaired_a", "nt_overnight_v0_open_a")
PROTECTED = (ROOT / "results", ROOT / "backtests" / "output", ROOT / "data", ROOT / "live")
ROLL_EXTREMES = tuple(f"rolling_vol_{w}_{side}" for w in (63, 252) for side in ("hi", "lo"))
DAILY_ONLY = frozenset({"best_day", "worst_day", "shortfall21_1pct", "shortfall21_5pct", "rolling_sharpe_63",
                        "rolling_sharpe_252", "rolling_vol_63", "rolling_vol_252", *ROLL_EXTREMES})
BENCH_ONLY = frozenset({"alpha_annual_pct", "beta", "alpha_t_5", "alpha_t_21", "alpha_t_min", "information_ratio",
                        "tracking_error", "psr_bench", "perf_difference"})
FAMILIES = {
    "perf": ("total_return", "cagr", "vol", "sharpe", "sortino", "calmar", "n", "years", "hit_rate", "best_day",
             "worst_day", "best_month", "worst_month", "pct_positive_months", "skew", "excess_kurtosis",
             "sharpe_se@perf", "sharpe_ci_lo@perf", "sharpe_ci_hi@perf", "perf_difference"),
    "drawdown": ("max_drawdown", "drawdown_series"),
    "distribution": ("monthly_returns",),
    "risk": ("var_95", "var_99", "cvar_95", "cvar_99", "shortfall21_1pct", "shortfall21_5pct"),
    "rolling": ("rolling_sharpe_63", "rolling_sharpe_252", "rolling_vol_63", "rolling_vol_252", *ROLL_EXTREMES),
    "relative": ("alpha_annual_pct", "beta", "alpha_t_5", "alpha_t_21", "alpha_t_min", "information_ratio",
                 "tracking_error"),
    "validity": ("sharpe_se", "sharpe_ci_lo", "sharpe_ci_hi", "psr_0", "psr_bench", "mintrl_sessions"),
}


def checked_dump_dir(folder: Path) -> Path:
    """`folder`, unless it is (or is inside) a protected folder, or is the project root or one of its parents."""
    target = Path(os.path.realpath(folder))
    root = Path(os.path.realpath(ROOT))
    inside = [base for base in PROTECTED if target.is_relative_to(Path(os.path.realpath(base)))]
    if inside or target == root or root.is_relative_to(target):
        raise ValueError(f"refused dump folder {target}: the terminal never writes under results/, "
                         "backtests/output/, data/ or live/, nor into the project root or above it")
    return folder


def dump_dir() -> Path:
    from_env = os.environ.get(ENV, "").strip()
    return checked_dump_dir(Path(from_env)) if from_env else DEFAULT_DUMP_DIR


# ---------- inputs ----------

class Input:
    def __init__(self, name: str, source: str, basis: str, periods: int, r: pd.Series, bench: pd.Series | None,
                 synthetic: bool = False):
        self.name, self.source, self.basis, self.periods = name, source, basis, periods
        self.r, self.bench, self.synthetic = r, bench, synthetic


def _daily_anchor() -> pd.DataFrame:
    frame = pd.read_csv(SCREENS / "volmanaged_v0_daily.csv", parse_dates=["date"])
    return frame.dropna(subset=["r_m_1", "r_bh_1"]).set_index("date")


def _monthly_anchor() -> pd.DataFrame:
    return pd.read_csv(SCREENS / "dtsmom_v0_monthly.csv", parse_dates=["start"]).set_index("start")


def _synthetic() -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(20260926)
    dates = pd.bdate_range("2012-01-02", periods=1512)
    bench = 0.0003 + 0.011 * rng.standard_t(5, len(dates)) / math.sqrt(5 / 3)
    r = 0.0002 + 0.7 * bench + 0.006 * rng.standard_normal(len(dates))
    r[::50] = 0.0  # sessions with no position: the hit rate counts only non-zero sessions
    return pd.Series(r, index=dates), pd.Series(bench, index=dates)


def served_inputs() -> list[Input]:
    """The series exactly as the API builds them (no bar service: no gate read, no NQ price benchmark)."""
    from nq_terminal.analytics import series
    from nq_terminal.services.research import ResearchService
    research, runs = ResearchService(ROOT), real_runs()
    built = [(f"served_{name}_c{cost}", series.hypothesis_series(research, name, cost))
             for name, cost in SERVED_HYPOTHESES]
    built += [(f"served_{run_id}", series.run_series(runs, research, run_id)) for run_id in SERVED_RUNS]
    return [Input(name, f"{s.source}, {s.label} (built by analytics.series); bench: {s.bench_label}", s.basis,
                  s.periods, s.r, s.bench) for name, s in built]


def build_inputs() -> list[Input]:
    daily, monthly = _daily_anchor(), _monthly_anchor()
    m1, bh1 = daily["r_m_1"].astype(float), daily["r_bh_1"].astype(float)
    ts1, lo1 = monthly["r_ts_1"].astype(float), monthly["r_lo_1"].astype(float)
    syn_r, syn_b = _synthetic()
    csv = "results/screens/volmanaged_v0_daily.csv"
    return [
        Input("volmanaged_v0_m1", f"{csv} r_m_1 against r_bh_1 (Basis A, screen)", "A", DAILY, m1, bh1),
        Input("volmanaged_v0_bh1", f"{csv} r_bh_1 (Basis A, screen)", "A", DAILY, bh1, None),
        Input("volmanaged_v0_m1_as_b", f"{csv} r_m_1 compounded as an account series (library parity only)",
              "B", DAILY, m1, bh1),
        Input("dtsmom_v0_ts1", "results/screens/dtsmom_v0_monthly.csv r_ts_1 against r_lo_1 (Basis A, monthly)",
              "A", MONTHLY, ts1, lo1),
        Input("synthetic_b", "seeded synthetic account series (default_rng 20260926), not project data",
              "B", DAILY, syn_r, syn_b, synthetic=True),
        *served_inputs(),
    ]


def applicable(metric: str, inp: Input) -> bool:
    base = metric.split("@")[0]
    if base in DAILY_ONLY and inp.periods != DAILY:
        return False
    return not (base in BENCH_ONLY and inp.bench is None)


# ---------- ours: nq_terminal.analytics, imported lazily ----------

def _perf(mod, inp: Input) -> dict:
    r, basis, p = inp.r, inp.basis, inp.periods
    table = mod.stats_table(r, basis, p)
    lo, hi = mod.sharpe_ci(r, p)
    out = {"total_return": mod.total_return(r, basis), "cagr": mod.cagr(r, basis, p),
           "vol": mod.annual_volatility(r, p), "sharpe": mod.sharpe(r, p), "sortino": mod.sortino(r, p),
           "calmar": mod.calmar(r, basis, p), "sharpe_se@perf": mod.sharpe_standard_error(r) * math.sqrt(p),
           "sharpe_ci_lo@perf": lo, "sharpe_ci_hi@perf": hi}
    out.update({k: table[k] for k in ("n", "years", "hit_rate", "best_day", "worst_day", "best_month",
                                      "worst_month", "pct_positive_months", "skew", "excess_kurtosis")})
    if inp.bench is not None:
        out["perf_difference"] = mod.performance_difference(r, inp.bench, basis).tolist()
    return out


def _drawdown(mod, inp: Input) -> dict:
    return {"max_drawdown": -mod.max_drawdown(inp.r, inp.basis),
            "drawdown_series": (-mod.underwater(inp.r, inp.basis)).tolist()}


def _distribution(mod, inp: Input) -> dict:
    months = mod.monthly_returns(inp.r, inp.basis)
    return {"monthly_returns": {f"{int(y):04d}-{int(m):02d}": float(v) for (y, m), v in months.items()}}


def _risk(mod, inp: Input) -> dict:
    out = dict(mod.var_table(inp.r))
    if inp.periods == DAILY:
        loss = mod.loss_distribution(inp.r)
        out.update(shortfall21_1pct=loss["shortfall_1pct"] * 100, shortfall21_5pct=loss["shortfall_5pct"] * 100)
    return out


def _rolling(mod, inp: Input) -> dict:
    if inp.periods != DAILY:
        return {}
    out = {f"rolling_{kind}_{w}": fn(inp.r, w, inp.periods).tolist() for w in (63, 252)
           for kind, fn in (("sharpe", mod.rolling_sharpe), ("vol", mod.rolling_volatility))}
    for w in (63, 252):
        found = mod.extremes(mod.rolling_volatility(inp.r, w, inp.periods))
        out.update({f"rolling_vol_{w}_hi": found["hi"], f"rolling_vol_{w}_lo": found["lo"]})
    return out


def _relative(mod, inp: Input) -> dict:
    if inp.bench is None:
        return {}
    fit = mod.alpha_beta(inp.r, inp.bench, periods=inp.periods)
    return {"alpha_annual_pct": fit["alpha_annual_pct"], "beta": fit["b"], "alpha_t_5": fit["t"]["5"],
            "alpha_t_21": fit["t"]["21"], "alpha_t_min": fit["t_min"],
            "information_ratio": mod.information_ratio(inp.r, inp.bench, inp.periods),
            "tracking_error": mod.tracking_error(inp.r, inp.bench, inp.periods)}


def _validity(mod, inp: Input) -> dict:
    summary = mod.validity_summary(inp.r, inp.bench, periods=inp.periods)
    ci, mintrl = summary["sharpe_ci"], summary["min_trl"]["at_zero"]
    out = {"sharpe_se": ci["se_annual"], "sharpe_ci_lo": ci["lo"], "sharpe_ci_hi": ci["hi"],
           "psr_0": summary["psr"]["at_zero"],
           "mintrl_sessions": mintrl["sessions"] if mintrl["reachable"] else math.inf}
    if inp.bench is not None:
        out["psr_bench"] = summary["psr"]["at_benchmark"]
    return out


ADAPTERS = {"perf": _perf, "drawdown": _drawdown, "distribution": _distribution, "risk": _risk,
            "rolling": _rolling, "relative": _relative, "validity": _validity}


def load_family(family: str):
    """(module, None) or (None, reason) for nq_terminal.analytics.<family>."""
    try:
        return importlib.import_module(f"nq_terminal.analytics.{family}"), None
    except ImportError as exc:
        return None, f"nq_terminal.analytics.{family} is not available yet ({exc})"


def ours(inp: Input, loader=load_family) -> tuple[dict, dict]:
    values, missing = {}, {}
    for family, metrics in FAMILIES.items():
        wanted = [m for m in metrics if applicable(m, inp)]
        mod, reason = loader(family)
        if mod is not None:
            try:
                values.update(ADAPTERS[family](mod, inp))
            except Exception as exc:  # noqa: BLE001 - a raising metric is reported in the dump, not hidden
                reason = f"nq_terminal.analytics.{family} raised {type(exc).__name__}: {exc}"
        for metric in wanted:
            if metric not in values:
                missing[metric] = reason or f"nq_terminal.analytics.{family} did not return {metric}"
    return values, missing


# ---------- values from nq_lab, from Nautilus, and stored ones ----------

def nq_lab_values(inp: Input) -> dict:
    r = inp.r.to_numpy()
    out = {"sharpe": sizing_stats.sharpe(r, inp.periods)}
    if inp.basis == "A":
        out["max_drawdown"] = sizing_stats.max_drawdown(r)
    if inp.periods == DAILY:
        tails = sizing_stats.tails(r)
        out.update(shortfall21_1pct=tails["shortfall_1pct"], shortfall21_5pct=tails["shortfall_5pct"])
    if inp.bench is not None:
        fit = sizing_stats.spanning_alpha(r, inp.bench.to_numpy(), (5, 21), inp.periods)
        out.update(alpha_annual_pct=fit["alpha_annual_pct"], beta=fit["b"], alpha_t_5=fit["t"]["5"],
                   alpha_t_21=fit["t"]["21"], alpha_t_min=fit["t_min"])
    return out


def _session_dict(series: pd.Series) -> dict:
    stamps = pd.DatetimeIndex(series.index).tz_localize("UTC") if series.index.tz is None else series.index
    return dict(zip(stamps.as_unit("ns").asi8.tolist(), series.astype(float).tolist()))


def nautilus_values(inp: Input) -> dict:
    from nautilus_trader.analysis import (
        CAGR,
        CalmarRatio,
        InformationRatio,
        MaxDrawdown,
        ReturnsVolatility,
        SharpeRatio,
        SortinoRatio,
        TrackingError,
    )
    p, r = inp.periods, _session_dict(inp.r)
    out = {"sharpe": SharpeRatio(p).calculate_from_returns(r), "sortino": SortinoRatio(p).calculate_from_returns(r),
           "vol": ReturnsVolatility(p).calculate_from_returns(r)}
    if inp.basis == "B":  # Nautilus compounds, so its CAGR, drawdown or Calmar exist only on Basis B
        out.update(cagr=CAGR(p).calculate_from_returns(r), calmar=CalmarRatio(p).calculate_from_returns(r),
                   max_drawdown=-MaxDrawdown().calculate_from_returns(r))
    if inp.bench is not None:
        b = _session_dict(inp.bench)
        out.update(information_ratio=InformationRatio(p).calculate_from_returns_with_benchmark(r, b),
                   tracking_error=TrackingError(p).calculate_from_returns_with_benchmark(r, b))
    return out


def _screen(name: str) -> dict:
    return json.loads((SCREENS / f"{name}.json").read_text(encoding="utf-8"))


def _alpha_values(fit: dict) -> dict:
    return {"alpha_annual_pct": fit["alpha_annual_pct"], "beta": fit["b"], "alpha_t_5": fit["t"]["5"],
            "alpha_t_21": fit["t"]["21"], "alpha_t_min": fit["t_min"]}


def stored_values(inp: Input) -> dict:
    out = {"sharpe@catalog": CATALOG_SHARPE[inp.name]} if inp.name in CATALOG_SHARPE else {}
    name = STORED_AS.get(inp.name, inp.name)
    if name in ("volmanaged_v0_m1", "volmanaged_v0_bh1"):
        screen = _screen("volmanaged_v0")
        head, tails = screen["headline"]["1tick"], screen["tails"]["managed" if name.endswith("m1") else "bh"]
        out.update(sharpe=head["sharpe_m" if name.endswith("m1") else "sharpe_bh"], years=screen["years"],
                   shortfall21_1pct=tails["shortfall_1pct"], shortfall21_5pct=tails["shortfall_5pct"],
                   max_drawdown=tails["max_drawdown_pct"] / 100)
        if name.endswith("m1"):
            out.update(_alpha_values(head["alpha"]))
    if name == "dtsmom_v0_ts1":
        screen = _screen("dtsmom_v0")
        out.update(sharpe=screen["headline"]["sharpe"], alpha_annual_pct=screen["control"]["a_x12_pct"],
                   beta=screen["control"]["b"])
    if name == "served_vt_har_v0_c1":  # the screen's P2 portfolio drawdown in sd units (MDD_port)
        out["max_drawdown"] = _screen("vt_har_v0")["headline"]["mdd_port_vt"]
    if name == "served_vrp_eq_v0_c1":
        screen = _screen("vrp_eq_v0")
        out.update(sharpe=screen["sharpe"]["1"]["VRP"], alpha_annual_pct=screen["headline"]["alpha_annual_pct"],
                   beta=screen["headline"]["b"])
    return out


# ---------- documents ----------

def _clean(value):
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_clean(v) for v in value]
    if isinstance(value, (float, np.floating)):
        return None if math.isnan(value) else float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    return value


def series_doc(inp: Input, loader=load_family) -> dict:
    our_values, missing = ours(inp, loader)
    return _clean({
        "schema": SCHEMA, "kind": "series", "case": inp.name, "source": inp.source, "basis": inp.basis,
        "periods": inp.periods, "synthetic": inp.synthetic,
        "dates": [d.strftime("%Y-%m-%d") for d in inp.r.index], "r": inp.r.tolist(),
        "bench": None if inp.bench is None else inp.bench.tolist(),
        "values": {"ours": our_values, "nq_lab": nq_lab_values(inp), "nautilus": nautilus_values(inp),
                   "stored": stored_values(inp)},
        "missing": missing,
    })


def registry_doc(loader=load_family) -> dict:
    frame = pd.read_csv(REGISTRY)
    reg = frame[frame["registered"].astype(str) == "True"]
    cols = ("bonferroni_p", "holm_p", "bh_q")
    values, missing = {}, {}
    mod, reason = loader("validity")
    if mod is None:
        missing = {col: reason for col in cols}
    else:
        p = reg["p"].to_numpy(dtype=float)
        values = {"bonferroni_p": mod.bonferroni(p), "holm_p": mod.holm(p), "bh_q": mod.benjamini_hochberg(p)}
    return _clean({"schema": SCHEMA, "kind": "registry", "case": "registry",
                   "source": "results/registry.csv registered rows", "names": reg["name"].tolist(),
                   "p": reg["p"].astype(float).tolist(),
                   "values": {"ours": values, "stored": {c: reg[c].astype(float).tolist() for c in cols}},
                   "missing": missing})


# ---------- MV3: GP's RV22 line on a synthetic daily frame ----------

RV_SYMBOL, RV_WINDOW = "NQ.V.0", 22


def market_doc() -> dict:
    """The universe returns of a synthetic 1d frame and the RV line the terminal serves on them (no gate read)."""
    from nq_lab.config import IS_END, IS_START
    from nq_lab.dtsmom_panel import build_panel, master_days
    from nq_lab.dtsmom_universe import TABLE
    from nq_terminal.services import market

    from fakes import synthetic_loader
    frame = synthetic_loader(RV_SYMBOL, "1d")(IS_START, IS_END)
    panel = build_panel({RV_SYMBOL: frame}, master_days(IS_START.date(), market.last_in_sample_day()))
    line = market.realised_vol_series(frame, RV_SYMBOL, window=RV_WINDOW)
    row = market.universe({RV_SYMBOL: frame}, window=RV_WINDOW, contracts=[c for c in TABLE if c.root == "NQ"]).rows[0]
    last = next((v for v in reversed(line.rv) if v is not None), None)
    return _clean({"schema": SCHEMA, "kind": "market", "case": "market_rv22_synthetic",
                   "source": "synthetic 1d NQ frame (tests/fakes.py), universe returns r = dB / (N - dB)",
                   "inputs": {"dates": list(line.days), "r": panel.r[:, 0].tolist(), "window": RV_WINDOW},
                   "values": {"ours": {"rv": list(line.rv), "rv_last": last, "rv_last@universe": row.realised_vol}},
                   "missing": {}})


# ---------- trades and costs of real runs (TA1, TA3, EX1 to EX4) ----------

TRADE_RUNS = ("nt_za_v0_repaired_a", "nt_overnight_v0_open_a", "nt_volmanaged_v0_final_m1", "nt_dtsmom_v0_ts1")
COST_RUNS = {"nt_za_v0_repaired_a": {}, "nt_volmanaged_v0_final_m1": {0: "nt_volmanaged_v0_final_m0",
                                                                     2: "nt_volmanaged_v0_final_m2"},
             "nt_dtsmom_v0_ts1": {0: "nt_dtsmom_v0_ts0", 2: "nt_dtsmom_v0_ts2"}}  # same fills at 0 and 2 ticks
GROUPINGS = ("hour", "weekday", "month")
TRADE_METRICS = ("n", "win_rate", "avg_win", "avg_loss", "max_win", "max_loss", "expectancy", "mean_pnl",
                 "total_pnl", "profit_factor", "payoff",
                 *(f"by_{g}_{s}" for g in GROUPINGS for s in ("n", "mean", "ci_lo", "ci_hi")))
LADDER = (0, 1, 2, 3, 4)
COST_METRICS = ("gross", "commissions", "slippage", "net", "costs_total", *(f"ladder_net_{t}" for t in LADDER),
                "break_even_ticks")
EXPOSURE_METRICS = ("exposure_gross", "exposure_net", "turnover_daily", "turnover_annualised")
NQ_TICK, NQ_POINT = "0.25", "20.0"  # one NQ contract (intraday runs); the MNQ multiplier comes from the venue


def real_runs():
    from nq_lab.config import ROOT
    from nq_terminal.services.runs import RunService
    return RunService(data_root=ROOT, project_root=ROOT)


def section_rows(runs, run_id: str, section: str, total: int) -> list[dict]:
    """Every row of a paged runs-service section as a plain dict."""
    fetch = {"trades": runs.trades, "fills": runs.fills}.get(section)
    rows: list[dict] = []
    while len(rows) < total:
        page = (fetch(run_id, len(rows), 5000) if fetch else runs.log(run_id, section, len(rows), 5000)).items
        assert page, f"{run_id} {section}: served {len(rows)} of {total} rows"
        rows.extend(row.model_dump() if hasattr(row, "model_dump") else dict(row) for row in page)
    return rows


def _ns(stamp: str) -> int:
    return int(pd.Timestamp(stamp).value)


def _missing(names, reason: str) -> dict:
    return {name: reason for name in names}


def _ours_trades(mod, rows: list[dict], summary: dict) -> dict:
    stats = mod.trade_tiles(rows, summary)["stats"]
    out = {key: stats[key] for key in TRADE_METRICS if key in stats}
    for grouping in GROUPINGS:
        table = mod.by_entry(rows, grouping)["rows"]
        for stat in ("n", "mean", "ci_lo", "ci_hi"):
            out[f"by_{grouping}_{stat}"] = {str(row["key"]): float(row[stat]) for row in table}
    return out


def _nautilus_trades(pnl: list[float]) -> dict:
    from nautilus_trader.analysis import AvgLoser, AvgWinner, Expectancy, MaxLoser, MaxWinner, ProfitFactor, WinRate
    stats = {"win_rate": WinRate, "avg_win": AvgWinner, "avg_loss": AvgLoser, "max_win": MaxWinner,
             "max_loss": MaxLoser, "expectancy": Expectancy}
    out = {key: cls().calculate_from_realized_pnls(pnl) for key, cls in stats.items()}
    out["profit_factor"] = ProfitFactor().calculate_from_returns(dict(enumerate(pnl)))
    return out


def trades_doc(runs, run_id: str, loader=None) -> dict:
    detail = runs.detail(run_id)
    rows = section_rows(runs, run_id, "trades", detail.counts.trades)
    pnl = [float(row["pnl_usd"]) for row in rows]
    summary = dict(detail.summary_stats)
    ours, missing = {}, {}
    mod, reason = (loader or load_family)("trades")
    try:
        ours = _ours_trades(mod, rows, summary) if mod is not None else {}
    except Exception as exc:  # noqa: BLE001 - a raising metric is reported in the dump, not hidden
        reason = f"nq_terminal.analytics.trades raised {type(exc).__name__}: {exc}"
    missing = _missing([m for m in TRADE_METRICS if m not in ours], reason or "not returned")
    stored = {"win_rate": summary.get("hit_rate"), "n": detail.summary.n_trades, "total_pnl": detail.summary.pnl_total}
    return _clean({"schema": SCHEMA, "kind": "trades", "case": f"{run_id}_trades", "run_id": run_id,
                   "source": f"backtests/output/{run_id}/result.json trades (net P&L per trade)",
                   "inputs": {"pnl": pnl, "entry_ts": [row["entry_ts"] for row in rows]},
                   "values": {"ours": ours, "nautilus": _nautilus_trades(pnl), "stored": stored},
                   "missing": missing})


def cost_model(detail) -> tuple[list[dict], int]:
    """The run's instruments and ticks, read here from venue and data (independent of analytics.exposure)."""
    venue, data = detail.venue, detail.data
    if isinstance(venue.get("instruments"), list):
        by_name = {i["instrument"]: {"name": i["instrument"], "multiplier": repr(float(i["multiplier"])),
                                     "tick_size": i["price_increment"], "cost_per_side": i["cost_per_side"]}
                   for i in venue["instruments"]}
        return [by_name[name] for name in detail.log_meta["instruments"]], int(data["ticks"])
    if venue.get("instrument"):
        return [{"name": venue["instrument"], "multiplier": repr(float(venue["multiplier"])), "tick_size": NQ_TICK,
                 "cost_per_side": data["cost_per_contract_side_usd"]}], int(data["ticks"])
    return [{"name": "NQ", "multiplier": NQ_POINT, "tick_size": NQ_TICK,
             "cost_per_side": repr(float(venue["fee_per_contract_side_usd"]))}], 0


def _fill_inputs(rows: list[dict], names: list[str]) -> dict | None:
    if not rows:
        return None
    index = {name: i for i, name in enumerate(names)}
    return {"instrument": [index[row["instrument"]] if row.get("instrument") else 0 for row in rows],
            "signed_qty": [int(row["qty"]) * (1 if row["side"] == "BUY" else -1) for row in rows],
            "commission": [row["commission"] for row in rows], "ts_ns": [_ns(row["ts"]) for row in rows]}


def _snapshot_inputs(snaps: list[dict], closes: list[dict]) -> dict | None:
    """The snapshot grid with the price the terminal values positions at (the run's raw close where it has one)."""
    if not snaps:
        return None
    raw = {row["date"]: row["raw"] for row in closes if isinstance(row.get("raw"), (int, float))}
    vector = lambda v: v if isinstance(v, list) else [v]  # noqa: E731 - one-line reshaper
    price = [[raw[s["date"]]] for s in snaps] if raw else [vector(s["px"]) for s in snaps]
    return {"date": [s["date"] for s in snaps], "ts_ns": [_ns(s["ts"]) for s in snaps],
            "net_qty": [vector(s["net_qty"]) for s in snaps], "price": price,
            "equity": [float(s["equity"]) for s in snaps],
            "price_basis": "raw close recorded by the run" if raw else "snapshot price (back adjusted)"}


def cost_inputs(runs, run_id: str) -> dict:
    detail = runs.detail(run_id)
    instruments, ticks = cost_model(detail)
    trades = section_rows(runs, run_id, "trades", detail.counts.trades)
    sections = detail.log_sections
    snaps = section_rows(runs, run_id, "snapshots", sections.get("snapshots", 0))
    closes = section_rows(runs, run_id, "closes", sections.get("closes", 0))
    return {"instruments": instruments, "ticks": ticks, "starting_usd": detail.balance_check["starting_usd"],
            "trade_pnl": [repr(float(t["pnl_usd"])) for t in trades],
            "trade_commission": [repr(float(t["commissions_usd"])) for t in trades],
            "fills": _fill_inputs(section_rows(runs, run_id, "fills", detail.counts.fills),
                                  [i["name"] for i in instruments]),
            "snapshots": _snapshot_inputs(snaps, closes)}


def _ours_costs(mod, runs, run_id: str) -> dict:
    from nq_terminal.services.run_books import load_book
    book = load_book(runs, run_id)
    fall, ladder = mod.cost_waterfall(book), mod.cost_sensitivity(book, LADDER)
    out = {key: fall[key] for key in ("gross", "commissions", "slippage", "net", "costs_total")}
    out.update({f"ladder_net_{t}": v for t, v in zip(ladder["ticks"], ladder["net_usd"])},
               break_even_ticks=ladder["break_even_ticks_per_side"])
    expo, turn = mod.exposure(book), mod.turnover(book)
    if expo is not None:
        out.update(exposure_gross=expo["gross"], exposure_net=expo["net"], turnover_daily=turn["daily"],
                   turnover_annualised=turn["annualised"], price_basis=expo["price_basis"])
    return out


def _stored_costs(runs, run_id: str, ticks: int) -> dict:
    summary, check = runs.detail(run_id).summary, runs.detail(run_id).balance_check
    out = {"net": summary.pnl_total, "net@delta_usd": check.get("delta_usd"), "costs_total": summary.fees_total,
           f"ladder_net_{ticks}": summary.pnl_total}
    out.update({f"ladder_net_{t}": runs.detail(other).summary.pnl_total for t, other in COST_RUNS[run_id].items()})
    return out


def costs_doc(runs, run_id: str, loader=None) -> dict:
    inputs = cost_inputs(runs, run_id)
    wanted = COST_METRICS + (EXPOSURE_METRICS if inputs["snapshots"] else ())
    ours = {}
    mod, reason = (loader or load_family)("exposure")
    try:
        ours = _ours_costs(mod, runs, run_id) if mod is not None else {}
    except Exception as exc:  # noqa: BLE001 - a raising metric is reported in the dump, not hidden
        reason = f"nq_terminal.analytics.exposure raised {type(exc).__name__}: {exc}"
    basis = ours.pop("price_basis", None)
    return _clean({"schema": SCHEMA, "kind": "costs", "case": f"{run_id}_costs", "run_id": run_id,
                   "source": f"backtests/output/{run_id}/result.json trades with its fills and snapshots",
                   "inputs": inputs, "price_basis": basis,
                   "values": {"ours": ours, "stored": _stored_costs(runs, run_id, inputs["ticks"])},
                   "missing": _missing([m for m in wanted if m not in ours], reason or "not returned")})


# ---------- the cached slow routes: fresh, through the cache, and after a restart (D1.4) ----------

CACHED_COMPARE = ("nt_dtsmom_v0_fixture_ts1", "nt_overnight_v0_fixture_open")
CACHED_ROUTES = {  # name -> (path, query), all on the fixture lab (fixture mode, fake serve), every one a 200
    "runs_compare": ("/api/runs/compare", {"ids": ",".join(CACHED_COMPARE)}),
    "ledger": ("/api/ledger", {}),
    "two_day": ("/api/market/two-day", {"symbols": "NQ.V.0,ZN.V.0"}),
    "bootstrap_hypothesis": ("/api/analytics/hypothesis/volmanaged_v0/bootstrap", {"cost": 1}),
    "bootstrap_run": ("/api/analytics/run/nt_overnight_v0_fixture_open/bootstrap", {}),
    "deflated": ("/api/analytics/deflated", {}),
    "seasonality_nq": ("/api/seasonality/instrument/NQ", {"start_year": 2020, "end_year": 2020}),
    "spa": ("/api/analytics/spa", {}),
}
LOCAL, LOOPBACK = "http://127.0.0.1", ("127.0.0.1", 50000)


def _fixture_client(state: Path, log_dir: Path) -> TestClient:
    """The fixture app of the Playwright backend, with its own state folder (so its result cache is its own)."""
    from fakes import FIXTURES
    from fixture_app import create_fixture_app
    env = {"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_STATE_DIR": str(state)}
    return api_client(create_fixture_app(env, log_dir=log_dir), base_url=LOCAL, client=LOOPBACK)


def _cache_stats(client: TestClient):
    """The counters of the app's `ResultCache` (kept on `app.state`, built by the first cached route), or None."""
    from nq_terminal.services.result_cache import ResultCache
    for value in vars(client.app.state)["_state"].values():
        if isinstance(value, ResultCache):
            return value.stats()
    return None


def take_bodies(client: TestClient) -> tuple[dict[str, bytes], dict[str, str]]:
    """Every cached route once: its exact body bytes, and where the cache served it from (memory, disk or computed)."""
    bodies, served = {}, {}
    for name, (path, query) in CACHED_ROUTES.items():
        before = _cache_stats(client)
        response = client.get(path, params=query)
        after = _cache_stats(client)
        assert response.status_code == 200, f"{path}: {response.status_code} {response.text[:200]}"
        assert after is not None, f"{path} did not go through the app's ResultCache (no cache on app.state)"
        bodies[name] = response.content
        hits, disk = (after.hits - (before.hits if before else 0)), (after.disk_hits - (before.disk_hits if before else 0))
        served[name] = "disk" if disk > 0 else "memory" if hits > 0 else "computed"
    return bodies, served


def _b64(body: bytes) -> str:
    return base64.b64encode(body).decode("ascii")


def _sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def repeat_bodies(workdir: Path) -> dict[str, bytes]:
    """Every cached route a second time with the cache switched off, on an app of its own: what a repeat of the
    request answers at the moment the cached take is made (the gate block of two-day and SEAS counts the process's
    reads, so a cold body and a repeat differ there)."""
    from nq_terminal.services.result_cache import ResultCache
    state, log_dir = workdir / "repeat-state", workdir / "repeat-gate-log"
    state.mkdir(), log_dir.mkdir()
    client = _fixture_client(state, log_dir)
    with mock.patch.object(ResultCache, "get", lambda self, route, query, compute, **kw: compute()):
        take_bodies(client)
        return take_bodies(client)[0]


def cached_routes_doc(workdir: Path) -> dict:
    """The eight cached routes taken three times: cold (fresh), again on the same app (cache), and on a new app over
    the same state folder (a restart); plus the repeat with the cache off that the cached take is checked against.
    The state folders and the fake gate's logs are temporary."""
    state, log_dir = workdir / "state", workdir / "gate-log"
    state.mkdir(), log_dir.mkdir()
    first = _fixture_client(state, log_dir)
    fresh, fresh_from = take_bodies(first)
    cached, cached_from = take_bodies(first)
    restart, restart_from = take_bodies(_fixture_client(state, log_dir))
    repeat = repeat_bodies(workdir)
    ours = {}
    for name in CACHED_ROUTES:
        ours.update({f"{name}.cached_recorded": _sha(cached[name]), f"{name}.cache_hit": cached_from[name],
                     f"{name}.restart_recorded": _sha(restart[name])})
    return {"schema": SCHEMA, "kind": "cached", "case": "cached_routes_fixture",
            "source": "the fixture app's eight cached routes (GET), cold, cached and after a restart",
            "inputs": {"routes": list(CACHED_ROUTES),
                       "queries": {n: {"path": path, "params": query} for n, (path, query) in CACHED_ROUTES.items()},
                       "fresh": {n: _b64(b) for n, b in fresh.items()},
                       "cached": {n: _b64(b) for n, b in cached.items()},
                       "restart": {n: _b64(b) for n, b in restart.items()},
                       "repeat": {n: _b64(b) for n, b in repeat.items()},
                       "served_from": {"fresh": fresh_from, "cached": cached_from, "restart": restart_from}},
            "values": {"ours": ours}, "missing": {}}


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)  # before any mkdir or unlink
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case']}.json"
        compact = doc.get("kind") in ("costs", "cached")  # snapshot grids and response bodies
        text = json.dumps(doc, separators=(",", ":")) if compact else json.dumps(doc, indent=1)
        path.write_text(text, encoding="utf-8")
        paths.append(path)
    return paths


# ---------- tests ----------

@pytest.fixture(scope="module")
def inputs() -> list[Input]:
    return build_inputs()


def test_anchor_inputs_reproduce_the_catalogue_sharpe(inputs):
    by_name = {inp.name: inp for inp in inputs}
    for name, anchor in CATALOG_SHARPE.items():
        inp = by_name[name]
        assert sizing_stats.sharpe(inp.r.to_numpy(), inp.periods) == pytest.approx(anchor, rel=1e-12, abs=0)
    assert len(by_name["volmanaged_v0_m1"].r) == 2686 and len(by_name["dtsmom_v0_ts1"].r) == 120


def test_born_failing_a_wrong_annualisation_misses_the_anchor(inputs):
    m1 = next(inp for inp in inputs if inp.name == "volmanaged_v0_m1")
    wrong = sizing_stats.sharpe(m1.r.to_numpy(), 365)
    assert wrong != pytest.approx(CATALOG_SHARPE["volmanaged_v0_m1"], rel=1e-12, abs=0)


def test_a_missing_module_is_recorded_as_a_reason_not_raised(inputs):
    def absent(family):
        return None, f"nq_terminal.analytics.{family} is not available yet (test)"
    doc = series_doc(inputs[0], loader=absent)
    assert doc["values"]["ours"] == {}
    assert set(doc["missing"]) == {m for ms in FAMILIES.values() for m in ms if applicable(m, inputs[0])}
    assert all("not available yet" in reason for reason in doc["missing"].values())


def test_a_raising_metric_is_recorded_with_the_exception(inputs):
    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("boom")
    doc = series_doc(inputs[1], loader=lambda family: (Broken(), None))
    assert "RuntimeError: boom" in doc["missing"]["sharpe"]


def _assigned(tree: ast.Module, name: str) -> ast.expr:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == name:
            return node.value
    pytest.fail(f"{name} not found in terminal/qa/crosscheck/paths.py")


def test_default_dump_folder_matches_the_crosscheck():
    tree = ast.parse(QA_PATHS.read_text(encoding="utf-8"))
    assert ast.literal_eval(_assigned(tree, "DUMP_FOLDER")) == DUMP_FOLDER
    assert ast.unparse(_assigned(tree, "QA_ROOT")) == "Path(__file__).resolve().parents[1]"
    assert ast.unparse(_assigned(tree, "DEFAULT_DUMP_DIR")) == "QA_ROOT / DUMP_FOLDER"
    assert QA_PATHS.resolve().parents[1] / DUMP_FOLDER == DEFAULT_DUMP_DIR  # paths.py sits in terminal/qa/crosscheck
    assert DEFAULT_DUMP_DIR.parent.name == "qa" and "scratchpad" not in str(DEFAULT_DUMP_DIR).lower()
    assert f"{DUMP_FOLDER}/" in (QA_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()


@pytest.mark.parametrize("folder", [ROOT / "results", ROOT / "results" / "qa_dumps", ROOT / "data",
                                    ROOT / "live" / "x", ROOT / "backtests" / "output", ROOT, ROOT.parent])
def test_a_protected_dump_folder_is_refused_before_any_write(monkeypatch, folder):
    """Born failing (security review): NQT_QA_DUMP_DIR pointed at results/ used to be accepted as given."""
    monkeypatch.setenv(ENV, str(folder))
    existed = folder.exists()
    with pytest.raises(ValueError, match="refused dump folder"):
        dump_dir()
    with pytest.raises(ValueError, match="refused dump folder"):
        write_dumps(folder, [])
    assert folder.exists() == existed


def test_market_dump_rv_ends_at_the_universe_value():
    doc = market_doc()
    ours = doc["values"]["ours"]
    assert ours["rv_last"] == pytest.approx(ours["rv_last@universe"], rel=1e-12)
    assert len(ours["rv"]) == len(doc["inputs"]["r"]) and doc["inputs"]["window"] == RV_WINDOW


def test_round_13_and_14_series_carry_their_stored_anchors(inputs):
    by_name = {inp.name: inp for inp in inputs}
    vt, vrp = by_name["served_vt_har_v0_c1"], by_name["served_vrp_eq_v0_c1"]
    assert sizing_stats.max_drawdown(vt.r.to_numpy()) == pytest.approx(stored_values(vt)["max_drawdown"], rel=1e-12)
    assert sizing_stats.sharpe(vrp.r.to_numpy(), MONTHLY) == pytest.approx(stored_values(vrp)["sharpe"], rel=1e-12)
    assert len(vrp.r) == 120 and vrp.periods == MONTHLY


def test_served_inputs_are_the_builders_series(inputs):
    by_name = {inp.name: inp for inp in inputs}
    assert {f"served_{run_id}" for run_id in SERVED_RUNS} <= set(by_name)
    dtsmom = by_name["served_dtsmom_v0_c1"]
    assert dtsmom.r.index[0].strftime("%Y-%m-%d") == "2012-01-31" and len(dtsmom.r) == 120
    assert len(by_name["served_za_v0_c1"].r) == 2825 and by_name["served_za_v0_c1"].bench is None


def test_the_dump_folder_follows_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv(ENV, str(tmp_path))
    assert dump_dir() == tmp_path
    monkeypatch.setenv(ENV, "  ")
    assert dump_dir() == DEFAULT_DUMP_DIR
    monkeypatch.delenv(ENV)
    assert dump_dir() == DEFAULT_DUMP_DIR


@pytest.fixture(scope="module")
def runs():
    return real_runs()


def test_cost_model_is_read_from_the_run_itself(runs):
    sized, ticks = cost_model(runs.detail("nt_volmanaged_v0_final_m1"))
    assert ticks == 1 and sized == [{"name": "MNQ.XCME", "multiplier": "2.0", "tick_size": "0.25",
                                     "cost_per_side": "1.11"}]
    book, _ = cost_model(runs.detail("nt_dtsmom_v0_ts1"))
    assert len(book) == 27 and book[0] == {"name": "ES.XCME", "multiplier": "50.0", "tick_size": "0.25",
                                           "cost_per_side": "15.0"}
    assert cost_model(runs.detail("nt_za_v0_repaired_a")) == ([{"name": "NQ", "multiplier": "20.0",
                                                                "tick_size": "0.25", "cost_per_side": "2.24"}], 0)


def test_a_missing_trades_or_exposure_module_is_recorded_as_a_reason(runs):
    def absent(family):
        return None, f"nq_terminal.analytics.{family} is not available yet (test)"
    trades = trades_doc(runs, "nt_za_v0_repaired_a", loader=absent)
    assert trades["values"]["ours"] == {} and set(trades["missing"]) == set(TRADE_METRICS)
    costs = costs_doc(runs, "nt_volmanaged_v0_final_m1", loader=absent)
    assert costs["values"]["ours"] == {} and set(costs["missing"]) == set(COST_METRICS + EXPOSURE_METRICS)
    assert all("not available yet" in reason for reason in costs["missing"].values())


def _check_bundle(back: dict) -> None:
    if back["kind"] == "cached":
        assert set(back["inputs"]["routes"]) == set(CACHED_ROUTES) and len(CACHED_ROUTES) == 8
        assert all(v == "memory" for v in back["inputs"]["served_from"]["cached"].values())
        return
    if back["kind"] == "market":
        assert len(back["inputs"]["r"]) == len(back["inputs"]["dates"]) == len(back["values"]["ours"]["rv"])
        return
    if back["kind"] == "trades":
        assert len(back["inputs"]["pnl"]) == len(back["inputs"]["entry_ts"]) == back["values"]["stored"]["n"]
        assert set(back["values"]["ours"]) | set(back["missing"]) >= set(TRADE_METRICS)
        assert back["values"]["ours"]["win_rate"] == back["values"]["stored"]["win_rate"]  # summary.hit_rate
    else:
        snaps = back["inputs"]["snapshots"]
        wanted = COST_METRICS + (EXPOSURE_METRICS if snaps else ())
        assert set(back["values"]["ours"]) | set(back["missing"]) >= set(wanted)
        assert back["values"]["ours"]["net"] == back["values"]["stored"]["net"]  # pnl_total
        if snaps:
            assert len(back["values"]["ours"]["exposure_gross"]) == len(snaps["equity"])
            assert snaps["price_basis"].startswith("raw") == back["price_basis"].startswith("raw contract")


def test_dump_for_qa_writes_every_case(inputs, runs, tmp_path):
    docs = ([series_doc(inp) for inp in inputs] + [registry_doc()] + [trades_doc(runs, r) for r in TRADE_RUNS]
            + [costs_doc(runs, r) for r in COST_RUNS] + [market_doc(), cached_routes_doc(tmp_path)])
    paths = write_dumps(dump_dir(), docs)
    assert len(paths) == len(inputs) + 1 + len(TRADE_RUNS) + len(COST_RUNS) + 2
    for path, doc in zip(paths, docs):
        back = json.loads(path.read_text(encoding="utf-8"))
        assert back["schema"] == SCHEMA and back["case"] == doc["case"]
        if back["kind"] == "series":
            assert len(back["r"]) == len(back["dates"])
            assert set(back["values"]["ours"]) | set(back["missing"]) >= {
                m for ms in FAMILIES.values() for m in ms if applicable(m, next(i for i in inputs
                                                                                 if i.name == back["case"]))}
        elif back["kind"] in ("trades", "costs", "market", "cached"):
            _check_bundle(back)


# ---------- the cached routes: the dump, and the cross-check's verdict on it ----------

QA_PYTHON = QA_ROOT / ".venv" / "Scripts" / "python.exe"


@pytest.fixture(scope="module")
def cached_doc(tmp_path_factory) -> dict:
    return cached_routes_doc(tmp_path_factory.mktemp("cached-dump"))


def test_the_second_take_of_every_cached_route_is_a_cache_hit(cached_doc):
    served = cached_doc["inputs"]["served_from"]
    assert served["cached"] == {name: "memory" for name in CACHED_ROUTES}
    assert set(served["fresh"].values()) == {"computed"}


def test_every_cached_body_equals_the_fresh_body_byte_for_byte(cached_doc):
    inputs = cached_doc["inputs"]
    for name in CACHED_ROUTES:
        assert base64.b64decode(inputs["cached"][name]) == base64.b64decode(inputs["repeat"][name]), name
        assert base64.b64decode(inputs["restart"][name]) == base64.b64decode(inputs["fresh"][name]), name


def test_only_the_gate_of_two_day_and_seasonality_differs_between_the_cold_and_the_cached_take(cached_doc):
    inputs = cached_doc["inputs"]
    differing = {name for name in CACHED_ROUTES
                 if inputs["cached"][name] != inputs["fresh"][name]}
    assert differing == {"two_day", "seasonality_nq"}
    for name in differing:
        cold, hit = (json.loads(base64.b64decode(inputs[take][name])) for take in ("fresh", "cached"))
        assert {k: v for k, v in cold.items() if k != "gate"} == {k: v for k, v in hit.items() if k != "gate"}


def test_a_route_on_the_disk_allow_list_is_served_from_disk_after_a_restart(cached_doc):
    from nq_terminal.services.result_cache import PERSIST_ROUTES
    persisted = {name for name, (path, _) in CACHED_ROUTES.items() if path in PERSIST_ROUTES}
    restarted = cached_doc["inputs"]["served_from"]["restart"]
    assert persisted and all(restarted[name] == "disk" for name in persisted), restarted
    assert all(restarted[name] != "disk" for name in CACHED_ROUTES if name not in persisted), restarted


def test_the_dump_uses_a_temporary_state_folder_not_the_terminal_state(tmp_path):
    from nq_terminal.settings import TERMINAL_STATE_DIR
    state = tmp_path / "state"
    state.mkdir()
    assert not state.resolve().is_relative_to(TERMINAL_STATE_DIR.resolve())
    assert _fixture_client(state, tmp_path).app.state.settings.state_dir == state.resolve()


def _crosscheck(folder: Path) -> subprocess.CompletedProcess:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run([str(QA_PYTHON), "-m", "crosscheck", "--dir", str(folder), "--strict"], cwd=QA_ROOT,
                          capture_output=True, text=True, timeout=600, creationflags=flags)


def _perturbed(doc: dict, kind: str | None) -> dict:
    """A copy of the dump with the ledger's cached or restart body one byte longer, or the terminal's recorded
    digest or cache flag of it wrong (`kind` None: nothing changed)."""
    copy = json.loads(json.dumps(doc))
    if kind in ("cached", "restart"):
        copy["inputs"][kind]["ledger"] = _b64(base64.b64decode(copy["inputs"][kind]["ledger"]) + b" ")
    elif kind == "cached_recorded":
        copy["values"]["ours"]["ledger.cached_recorded"] = "0" * 64
    elif kind == "cache_hit":
        copy["values"]["ours"]["ledger.cache_hit"] = "computed"
    elif kind == "stale_gate":  # the hit of a route with a process-state gate answers with the cold take's gate
        copy["inputs"]["cached"]["two_day"] = copy["inputs"]["fresh"]["two_day"]
    return copy


@pytest.mark.skipif(not QA_PYTHON.is_file(), reason="the QA environment (terminal/qa/.venv) is not built")
@pytest.mark.parametrize("kind, expected_exit", [
    (None, 0),  # the real dump: every route byte-equal
    ("cached", 1),  # born failing: a cached body one byte off
    ("restart", 1),  # a body served after the restart one byte off
    ("cached_recorded", 1),  # a wrong digest recorded by the terminal
    ("cache_hit", 1),  # the second take was not a cache hit
    ("stale_gate", 1)])  # a hit that kept the first computation's gate block
def test_the_crosscheck_compares_the_cached_dump_byte_for_byte(cached_doc, tmp_path, kind, expected_exit):
    write_dumps(tmp_path / "dumps", [_perturbed(cached_doc, kind)])
    done = _crosscheck(tmp_path / "dumps")
    assert done.returncode == expected_exit, done.stdout[-3000:] + done.stderr[-1000:]
    if kind is None:
        assert "FAIL 0" in done.stdout and "SKIP 0" in done.stdout
    else:
        route = "two_day" if kind == "stale_gate" else "ledger"
        assert any(line.lstrip().startswith("FAIL") and route in line for line in done.stdout.splitlines())
