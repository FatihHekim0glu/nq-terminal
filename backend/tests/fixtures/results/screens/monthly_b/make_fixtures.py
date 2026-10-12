"""Writes the synthetic fixtures of tests/test_series_monthly_b.py into this folder.

The repository is public, so nothing here is copied from the lab: every CSV has the column layout (names and order) of
the lab's screen CSV of the same name, and the values come from a seeded generator (seed 20261012). The JSON of each
row holds only the numbers the anchors read, at the paths the lab's JSON uses (percent where the lab's key says
`_pct`), computed from the synthetic CSV with plain numpy. tsydemfx_v0 is one of the lab's three in-sample passes: its
file here is as made up as the others.

Run from the repository root with the lab's interpreter:
  python backend/tests/fixtures/results/screens/monthly_b/make_fixtures.py
It needs the lab's NYSE calendar (`nq_lab.sessions`), a calendar and no price, and the anchor table of the test file.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics.series import RECORDED_COUNTS

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3]))
from test_series_monthly_b import ANCHORS  # noqa: E402  (the one table of columns and JSON paths)

SEED = 20261012
MONTHS = 14
FENCE = "2022-01-01 00:00:00+00:00"
RNG = np.random.default_rng(SEED)

HEADERS = {
    "oigrowth_v0": "label,start,end,N_m,g,z,w,p,x,r_timed_0,r_lo_0,r_timed_1,r_lo_1,r_timed_2,r_lo_2,"
                   "u_beta_adjusted_1,tc_raw_1,tsmom_comm_1,gross_lev,capped",
    "rateamp_tsy_v0": "month,W,Ws,void,gross_x_K,capped,r0,r1,r2,lo1,ts12_1,slope1,eom1,s5_1,ZF_held,ZF_switched,"
                      "ZF_void,ZF_N,ZF_r1,ZN_held,ZN_switched,ZN_void,ZN_N,ZN_r1,ZB_held,ZB_switched,ZB_void,ZB_N,"
                      "ZB_r1",
    "stmomturn_v0": "label,start,end,r_0,r_1,r_2,r_gross,unc_1,lo20_1,carry_comm_fx_1,tsmom_1,n_eligible_comm,"
                    "active_comm,capped_comm,r_comm_1,n_eligible_fx,active_fx,capped_fx,r_fx_1,gross_lev,roll_cost_1,"
                    "trade_cost_1,S2_high_volume_momentum_half_r_1,S2_low_volume_reversal_half_r_1,"
                    "S5_tercile_comm_r_1,S6_no_band_r_1,S7_skip_a_day_r_1,S9_raw_av_r_1,S10_yoy_av_r_1,"
                    "S13_detrended_av_r_1",
    "termprem_cmdty_v0": "label,start,end,r_0,r_1,r_2,r_gross,n_eligible,V,gross_lev,capped,r_lo_1,carry_comm_1,"
                         "tsmom_comm_1,net1_CL,net1_NG,net1_HO,net1_RB,net1_GC,net1_SI,net1_HG,net1_ZC,net1_ZS,"
                         "net1_ZW,net1_ZL,net1_ZM,net1_LE,net1_HE",
    "tsyauction_mid_v0": "month,void,refunding,A_first,A_last,k,n_pre,span,balanced,regular,announced_by_P,n_tenors,"
                         "r0,r1,r2,D,pre_gross,post_gross,pre_net1,post_net1,exposure,drift_term,gross_lev,capped,"
                         + ",".join(f"{t}_{c}" for t in ("ZF", "ZN", "ZB") for c in (
                             "held", "v0_key", "switched", "trigger", "N", "void", "pnl_pre", "pnl_post", "cost1",
                             "cost2", "mu", "drift_notional", "exposure")) + ",lo_void,lo0,lo1,lo2",
    "tsydemfx_v0": "month,r_1tick,r_2tick,r_fee_only,r_gross,ctl_LO,ctl_TS1,ctl_CFX,ctl_UA",
    "xsbreadth_q_v0": "label,start,end,r_ml_0,r_ml_1,r_ml_2,r_ml_gross,lo_1,tsmom_1,carry_1,lin_1,live_tranches,"
                      "gross_lev,capped,flat,zeroed_cells,n_eligible_admitted,roll_cost_1,trade_cost_1,r_lin_2,"
                      "d_ml_minus_lin",
    "xsintra_w_v0": "label,r_ml_0,r_ml_1,r_ml_2,r_ml_gross,lo15_1,tsmom_1,carry_1,cskew_1,rev1w_1,rev1m_1,lin_1,"
                    "roll_cost_1,trade_cost_1",
    "xsml_m_v0": "label,start,end,r_ml_0,r_ml_1,r_ml_2,r_ml_gross,tsmom_1,lo21_1,carry_1,lin_1,gross_lev,capped,flat,"
                 "n_eligible_traded,roll_cost_1,trade_cost_1,r_gbm_1,r_nn_1",
    "zqcut_v0": "E,e,x,R,w,n,key,void,ts,r0,r1,r2,y1_bp,cl,inv",
}
FIRST = {"oigrowth_v0": "2011-10", "rateamp_tsy_v0": "2011-01", "stmomturn_v0": "2012-01",
         "termprem_cmdty_v0": "2012-01", "tsyauction_mid_v0": "2011-01", "tsydemfx_v0": "2011-01",
         "xsbreadth_q_v0": "2014-01", "xsintra_w_v0": "2013-01", "xsml_m_v0": "2014-01", "zqcut_v0": "2011-01"}
FLAGS = ("capped", "balanced", "regular", "refunding", "announced_by_P", "flat")
INTS = ("k", "n_pre", "span", "n_tenors", "n", "live_tranches", "zeroed_cells", "N_m")


def calendar(labels: pd.PeriodIndex) -> dict[str, list[str]]:
    """Per holding month: the session before it, its first session, its last, and the first session after it."""
    table = nyse_sessions(dt.date(labels.min().year - 1, 11, 1), dt.date(labels.max().year + 1, 2, 28))
    days = pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in table.index]))
    by_month = pd.Series(days, index=days.to_period("M"))
    first, last = by_month.groupby(level=0).min(), by_month.groupby(level=0).max()
    text = lambda s: [d.strftime("%Y-%m-%d") for d in s]
    return {"before": text(last.reindex(labels - 1)), "start": text(first.reindex(labels)),
            "last": text(last.reindex(labels)), "end": text(first.reindex(labels + 1))}


def time_columns(name: str, labels: pd.PeriodIndex) -> pd.DataFrame:
    cal, key = calendar(labels), [str(p) for p in labels]
    if name == "zqcut_v0":
        return pd.DataFrame({"E": cal["before"], "e": cal["start"], "x": cal["end"]})
    frame = pd.DataFrame({("month" if "month" in HEADERS[name].split(",")[:1] else "label"): key})
    if "start" in HEADERS[name].split(","):
        frame["start"], frame["end"] = cal["start"], cal["end"]
    if name == "tsyauction_mid_v0":
        frame["A_first"], frame["A_last"] = cal["start"], cal["last"]
    return frame


def value_columns(name: str, n: int) -> dict[str, np.ndarray]:
    """The return and benchmark columns of the truth table: the cost ladder steps down by 6 bp a tick."""
    anchor = ANCHORS[name]
    base = np.round(RNG.normal(0.002, 0.03, n), 8)
    out = {column: np.round(base - 0.0006 * (cost - 1), 8) for cost, column in anchor.values.items()}
    for cost, column in anchor.bench.items():
        out.setdefault(column, np.round(RNG.normal(0.0005, 0.04, n) - 0.0004 * cost, 8))
    if "r_gross" in HEADERS[name].split(","):
        out["r_gross"] = np.round(base + 0.001, 8)
    return out


def fill(name: str, frame: pd.DataFrame, given: dict[str, np.ndarray]) -> pd.DataFrame:
    """The lab file's columns in the lab file's order; a column nothing reads gets made-up values."""
    n = len(frame)
    for column in HEADERS[name].split(","):
        if column in frame.columns:
            continue
        if column in given:
            frame[column] = given[column]
        elif column == "void":
            frame[column] = False if name != "tsyauction_mid_v0" else ""
        elif column in FLAGS or column.endswith(("_switched", "capped_comm", "capped_fx")):
            frame[column] = False
        elif column.endswith(("_void", "_trigger")) or column in ("lo_void",):
            frame[column] = ""
        elif column.endswith(("_held", "_v0_key")) or column == "key":
            frame[column] = [f"SYN{column[:2]}{i}" for i in range(n)]
        elif column.lower().startswith(("n_", "active_")) or column.endswith("_N") or column in INTS:
            frame[column] = RNG.integers(1, 20, n)
        else:
            frame[column] = np.round(RNG.normal(0.0, 1.0, n), 6)
    return frame[HEADERS[name].split(",")]


def set_path(document: dict, path: tuple[str, ...], value: float) -> None:
    for key in path[:-1]:
        document = document.setdefault(key, {})
    document[path[-1]] = value


def solve(y: np.ndarray, columns: list[np.ndarray]) -> tuple[float, list[float]]:
    design = np.column_stack([np.ones(len(y)), *columns])
    beta = np.linalg.lstsq(design, y, rcond=None)[0]
    return float(beta[0]), [float(b) for b in beta[1:]]


def recorded(name: str, frame: pd.DataFrame, labels: pd.PeriodIndex) -> dict:
    """The screen JSON: the numbers the anchors read, at the lab's paths, from the synthetic CSV."""
    anchor, doc = ANCHORS[name], {"name": name, "synthetic_fixture": True}
    doc["serve"] = {"serves": [{"symbol": "SYN.V.0", "timeframe": "1d", "end": FENCE}]}
    doc["facts"] = {"first_label": str(labels[0]), "last_label": str(labels[-1])}
    r = frame[anchor.values[1]].to_numpy(dtype=float)
    sd = float(np.std(r, ddof=1))
    stats = {"n": len(r), "mean": float(r.mean()) * anchor.scale, "sd": sd * anchor.scale,
             "sharpe": float(r.mean() / sd * math.sqrt(12))}
    for key, path in anchor.head.items():
        set_path(doc, path, stats[key])
    if name in RECORDED_COUNTS:  # the count the series builder checks the built length against
        set_path(doc, RECORDED_COUNTS[name], len(r))
    for cost, path in anchor.ladder.items():
        set_path(doc, path, float(frame[anchor.values[cost]].mean()) * anchor.scale)
    for cost, path in anchor.bench_mean.items():
        set_path(doc, path, float(frame[anchor.bench[cost]].mean()) * anchor.scale)
    if anchor.ols is not None:
        a, b = solve(r, [frame[c].to_numpy(dtype=float) for c in anchor.ols.xs])
        set_path(doc, (*anchor.ols.control, "a"), a)
        set_path(doc, (*anchor.ols.control, "b"), b[0] if len(b) == 1 else b)
    return doc


def build(name: str) -> None:
    labels = pd.period_range(FIRST[name], periods=MONTHS, freq="M")
    frame = fill(name, time_columns(name, labels), value_columns(name, MONTHS))
    frame.to_csv(HERE / f"{name}_monthly.csv", index=False, lineterminator="\n")
    written = pd.read_csv(HERE / f"{name}_monthly.csv")  # the numbers the tests will read back
    document = recorded(name, written, labels)
    (HERE / f"{name}.json").write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    for each in ANCHORS:
        build(each)
        print("wrote", each)
