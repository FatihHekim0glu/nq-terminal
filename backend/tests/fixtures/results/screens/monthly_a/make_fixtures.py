"""Writes the synthetic fixtures of tests/test_series_monthly_a.py into this folder.

The repository is public, so nothing here is copied from the lab: every file has the column layout of the lab's
screen CSV of the same name, and the values are drawn from a seeded generator (seed 20261011). The JSON of each
row holds only the keys the anchors read, computed from the synthetic CSV with plain pandas and numpy, in the
units the lab's JSON uses (percent where the lab's key says `_pct`, basis points where it says `_bp`).

Run from the repository root:
  python backend/tests/fixtures/results/screens/monthly_a/make_fixtures.py
It needs the lab's NYSE calendar (`nq_lab.sessions`), a calendar and no price.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from nq_lab.sessions import nyse_sessions

HERE = Path(__file__).resolve().parent
SEED = 20261011
FENCE = "2022-01-01 00:00:00+00:00"
RNG = np.random.default_rng(SEED)


def _periods(first: str, last: str) -> pd.PeriodIndex:
    return pd.period_range(first, last, freq="M")


def _calendar(labels: pd.PeriodIndex) -> dict[str, pd.Series]:
    table = nyse_sessions(dt.date(labels.min().year - 1, 11, 1), dt.date(labels.max().year + 1, 2, 28))
    days = pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in table.index]))
    by_month = pd.Series(days, index=days.to_period("M"))
    first, last = by_month.groupby(level=0).min(), by_month.groupby(level=0).max()
    after = first.reindex(labels + 1)
    after.iloc[-1] = last.reindex(labels).iloc[-1]  # the book is liquidated at the last session of the sample
    return {"start": first.reindex(labels), "d": last.reindex(labels - 1), "end": after}


def _text(series: pd.Series) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in series]


def _noise(n: int, scale: float = 0.03, centre: float = 0.0015) -> np.ndarray:
    return RNG.normal(centre, scale, n)


def _ladder(frame: pd.DataFrame, template: str, base: np.ndarray, drag: float) -> None:
    for k in (0, 1, 2):
        frame[template.format(k=k)] = base - drag * k


def _extras(frame: pd.DataFrame, names: list[str]) -> None:
    for name in names:
        frame[name] = RNG.normal(0.0, 1.0, len(frame))


def _guarded(labels: pd.PeriodIndex, with_start: bool, with_d: bool) -> pd.DataFrame:
    cal = _calendar(labels)
    frame = pd.DataFrame({"label": [str(p) for p in labels]})
    if with_d:
        frame["d"] = _text(cal["d"])
        frame["e"] = _text(cal["start"])
    if with_start:
        frame["start"] = _text(cal["start"])
    frame["end"] = _text(cal["end"])
    return frame


def stats(x: np.ndarray) -> dict[str, float]:
    sd = float(np.std(x, ddof=1))
    return {"n": int(len(x)), "mean": float(np.mean(x)), "sd": sd, "sharpe": float(np.mean(x) / sd * math.sqrt(12))}


def span(frame: pd.DataFrame, key: str, first: str, last: str) -> pd.DataFrame:
    return frame[(frame[key] >= first) & (frame[key] <= last)]


def blocks(frame: pd.DataFrame, key: str, column: str, ranges: dict[str, tuple[str, str]],
           scale: float = 100.0, sharpe: bool = False) -> dict:
    out = {}
    for name, (first, last) in ranges.items():
        s = stats(span(frame, key, first, last)[column].to_numpy(dtype=float))
        out[name] = {"n": s["n"], "mean_pct": s["mean"] * scale} | ({"sharpe": s["sharpe"]} if sharpe else {})
    return out


def ols(y: np.ndarray, x: np.ndarray) -> tuple[float, float]:
    design = np.column_stack([np.ones(len(x)), x])
    coef = np.linalg.lstsq(design, y, rcond=None)[0]
    return float(coef[0]), float(coef[1])


HEADERS = {
    "airfx_v0": "label,held,r_air_1tick,r_air_2tick,r_dol,r_carry,r_tsmom,r_illiq,r_trans,air_6E,air_6J,air_6B,air_6A,"
                "air_6C,air_6S,air_6N,air_6M,tr_6E,tr_6J,tr_6B,tr_6A,tr_6C,tr_6S,tr_6N,tr_6M",
    "cmax_v0": "label,start,end,N_m,r_cmax_0,r_lowvar_0,r_cmax_1,r_lowvar_1,r_cmax_2,r_lowvar_2,lo_1,carry_comm_1,"
               "tsmom_comm_1,cskew_1,r_comm_1_carry_file,gross_lev,gross_lev_precap,capped,r_long_leg_1,r_short_leg_1,"
               "r_static_1,r_dynamic_1,roll_cost_1,trade_cost_1",
    "crushdev_v0": "month,r_1tick,r_0tick,r_2tick,const,soy3",
    "eqvrp_xasset_v0": "label,d,e,end,vp,w,vp_missing,r_0,r_1,r_2,cb_1,cfx,tsfx,gross_lev,turnover_x_K,r_6E_1,r_6B_1,"
                       "r_6J_1",
    "fxval_ppp_v0": "label,d,e,end,n_legs,r_0,r_1,r_2,cb_1,carry6_1,tsfx_1,xmom_1,gross_lev,turnover_x_K,a_6E,a_6J,"
                    "a_6B,a_6A,a_6C,a_6S,r_6E_1,r_6J_1,r_6B_1,r_6A_1,r_6C_1,r_6S_1",
    "gotobi6j_v0": "month,lo,held,lo_void,r,n_events",
    "gvzvrp_pm_v0": "label,d,e,end,vrp,w,vrp_missing,r_0,r_1,r_2,cb_1,eqv,tspm,gross_lev,turnover_x_K,r_GC_1,r_SI_1",
    "hi52_v0": "label,start,end,N_m,r_hi52_0,r_hi52_1,r_hi52_2,xsmom12_1_1,xsmom12_0_1,xsmom1_0_1,lowvar_1,lo_1,"
               "carry_comm_1,tsmom_comm_1,cskew_1,gross_lev,gross_lev_precap,capped,r_long_leg_1,r_short_leg_1,"
               "r_static_1,r_dynamic_1,roll_cost_1,trade_cost_1",
    "liqbias_v0": "month,n_events,gross,r0,r1,r2,D,n_D,D_old",
    "metals_eq_ym_v1": "label,void,g,z,y,zy,w,wR,wM,price,N_T,r_T_t0,r_T_t1,r_T_t2,N_C,r_C_t0,r_C_t1,r_C_t2,N_R,"
                       "r_R_t0,r_R_t1,r_R_t2,N_M,r_M_t0,r_M_t1,r_M_t2",
}
FLAGS = {"capped": False, "vp_missing": False, "vrp_missing": False}


def conform(name: str, frame: pd.DataFrame) -> pd.DataFrame:
    """The lab file's columns in the lab file's order; a column nothing reads gets made-up values."""
    header = HEADERS[name].split(",")
    unknown = [c for c in frame.columns if c not in header]
    assert not unknown, f"{name}: {unknown} are not in the lab layout"
    for column in header:
        if column in frame.columns:
            continue
        if column in FLAGS:
            frame[column] = FLAGS[column]
        elif column.startswith(("N_", "n_")):
            frame[column] = RNG.integers(1, 20, len(frame))
        else:
            frame[column] = RNG.normal(0.0, 1.0, len(frame))
    return frame[header]


def write(name: str, frame: pd.DataFrame, document: dict, csv_name: str) -> None:
    conform(name, frame).to_csv(HERE / csv_name, index=False, lineterminator="\n")
    document = {"name": name, "synthetic_fixture": True} | document
    (HERE / f"{name}.json").write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")


CALENDAR_BLOCKS = {"2012-13": ("2012-01", "2013-12"), "2014-17": ("2014-01", "2017-12"),
                   "2018-21": ("2018-01", "2021-12")}
EARLY_BLOCKS = {"2011-13": ("2011-01", "2013-12"), "2014-17": ("2014-01", "2017-12"),
                "2018-21": ("2018-01", "2021-12")}


def _commodity(name: str, csv_name: str, value_template: str, extra_names: list[str], lo: str) -> None:
    labels = _periods("2012-01", "2021-12")
    frame = _guarded(labels, True, False)
    frame["N_m"] = 14
    base = _noise(len(labels))
    _ladder(frame, value_template, base, 0.0004)
    frame[lo] = _noise(len(labels), 0.033, -0.001)
    _extras(frame, extra_names)
    ticks = {str(k): float(np.mean(frame[value_template.format(k=k)])) * 100 for k in (0, 1, 2)}
    head = stats(frame[value_template.format(k=1)].to_numpy())
    doc = {"serve": {"v0_window": ["2010-06-01 00:00:00+00:00", FENCE]},
           "headline": {"n": head["n"], "mean_pct": head["mean"] * 100, "sharpe": head["sharpe"]},
           "cost_stress": {"mean_pct_by_ticks": ticks},
           "blocks": blocks(frame, "label", value_template.format(k=1), CALENDAR_BLOCKS, sharpe=True)}
    write(name, frame, doc, csv_name)


def _fx_like(name: str, csv_name: str, bench: str, extra_names: list[str], bench_doc: str) -> None:
    labels = _periods("2012-01", "2021-12")
    frame = _guarded(labels, False, True)
    _ladder(frame, "r_{k}", _noise(len(labels), 0.018), 0.00012)
    frame[bench] = _noise(len(labels), 0.03, -0.0008)
    _extras(frame, extra_names)
    head = stats(frame["r_1"].to_numpy())
    cost = {"mean_pct": {str(k): float(frame[f"r_{k}"].mean()) * 100 for k in (0, 1, 2)},
            "sharpe": {str(k): stats(frame[f"r_{k}"].to_numpy())["sharpe"] for k in (0, 1, 2)}}
    ctl = stats(frame[bench].to_numpy())
    control = {"constant_basket": {"n": ctl["n"], "mean_pct": ctl["mean"] * 100, "sharpe": ctl["sharpe"]}} \
        if bench_doc == "basket" else {"control_means_pct": {"CB": ctl["mean"] * 100}}
    doc = {"serve": {"serves": [{"end": FENCE}]},
           "headline": {"n": head["n"], "mean_pct": head["mean"] * 100, "sharpe": head["sharpe"]},
           "costs": cost, "blocks": blocks(frame, "label", "r_1", CALENDAR_BLOCKS)} | control
    write(name, frame, doc, csv_name)


def _crushdev() -> None:
    labels = _periods("2011-10", "2021-12")
    frame = pd.DataFrame({"month": [str(p) for p in labels]})
    base = _noise(len(labels), 0.018, 0.001)
    base[:3] = 0.0  # flat months at the start, kept in the headline
    for k, col in ((1, "r_1tick"), (0, "r_0tick"), (2, "r_2tick")):
        frame[col] = np.where(base == 0.0, 0.0, base + 0.0005 * (1 - k))
    frame["const"] = _noise(len(labels), 0.04, -0.0008)
    frame["soy3"] = _noise(len(labels), 0.028, 0.002)
    ladder = {f"{k}_tick": stats(frame[c].to_numpy()) for k, c in ((0, "r_0tick"), (1, "r_1tick"), (2, "r_2tick"))}
    head, const = ladder["1_tick"], stats(frame["const"].to_numpy())
    ranges = {"2011-13": ("2011-10", "2013-12"), "2014-17": ("2014-01", "2017-12"), "2018-21": ("2018-01", "2021-12")}
    doc = {"serve": {"serves": [{"end": FENCE}]}, "headline": {"n": head["n"], "mean": head["mean"],
                                                               "sharpe": head["sharpe"]},
           "cost_ladder": {k: {"n": v["n"], "mean": v["mean"], "sharpe": v["sharpe"]} for k, v in ladder.items()},
           "const_book": {"n": const["n"], "mean": const["mean"], "sharpe": const["sharpe"]},
           "blocks": blocks(frame, "month", "r_1tick", ranges)}
    write("crushdev_v0", frame, doc, "crushdev_v0_monthly.csv")


def _liqbias() -> None:
    labels = _periods("2011-01", "2021-12")
    frame = pd.DataFrame({"month": [str(p) for p in labels], "n_events": 4})
    frame["gross"] = _noise(len(labels), 0.014, 0.0045)
    for k in (0, 1, 2):
        frame[f"r{k}"] = frame["gross"] - 0.0015 * (k + 1) + 0.0008
    frame["D"] = frame["gross"] + RNG.normal(0.0005, 0.003, len(labels))
    frame["n_D"] = 4
    frame["D_old"] = frame["gross"] + RNG.normal(-0.001, 0.004, len(labels))
    head, ctl = stats(frame["r1"].to_numpy()), stats(frame["D"].to_numpy())
    doc = {"serve": {"serves": [{"end": FENCE}]},
           "headline": {"n": head["n"], "mean_pct": head["mean"] * 100, "sharpe_ann": head["sharpe"]},
           "cost_ladder_mean_pct": {f"{k}_tick": float(frame[f"r{k}"].mean()) * 100 for k in (0, 1, 2)},
           "control": {"n": ctl["n"], "mean_pct": ctl["mean"] * 100, "sharpe_ann": ctl["sharpe"]},
           "blocks": blocks(frame, "month", "r1", EARLY_BLOCKS)}
    write("liqbias_v0", frame, doc, "liqbias_v0_monthly.csv")


def _gotobi() -> None:
    labels = _periods("2011-01", "2021-12")
    frame = pd.DataFrame({"month": [str(p) for p in labels]})
    frame["lo"] = RNG.normal(30.0, 240.0, len(labels))
    frame["held"] = "6JH" + pd.Series([str(p.year) for p in labels]).astype(str)
    frame["lo_void"] = ""
    frame["n_events"] = RNG.integers(4, 8, len(labels))
    frame["r"] = RNG.normal(0.7, 1.0, len(labels)) * frame["n_events"] * 6.0
    for i, reason in ((47, "no bar at L_{m-1} or L_m"), (48, "no held contract")):
        frame.loc[i, "lo"] = np.nan
        frame.loc[i, "lo_void"] = reason
    frame = frame[["month", "lo", "held", "lo_void", "r", "n_events"]]
    ok = frame[frame["lo"].notna()]
    a, beta = ols(ok["r"].to_numpy(), ok["lo"].to_numpy())
    drift = {"n": int(len(ok)), "a": a, "beta": beta, "sharpe_monthly_annualised": stats(ok["r"].to_numpy())["sharpe"]}
    per_block = {}
    for key, (first, last) in EARLY_BLOCKS.items():
        part = span(frame, "month", first, last)
        per_block[key] = {"n": int(part["n_events"].sum()), "mean_bp": float(part["r"].sum() / part["n_events"].sum())}
    doc = {"serve": {"serves": [{"end": FENCE}]}, "n_events": int(frame["n_events"].sum()),
           "headline": {"n": int(frame["n_events"].sum()), "mean": float(frame["r"].sum() / frame["n_events"].sum())},
           "blocks": per_block, "drift_P1b": drift}
    write("gotobi6j_v0", frame, doc, "gotobi6j_v0_monthly.csv")


def _metals() -> None:
    labels = _periods("2012-10", "2021-12")
    frame = pd.DataFrame({"label": [str(p) for p in labels], "void": False})
    frame["void"] = frame["label"] == "2016-03"
    _extras(frame, ["g", "z", "y", "zy", "w", "wR", "wM"])
    frame["price"] = RNG.uniform(20000.0, 30000.0, len(labels))
    cols = {"N_T": 900, "N_C": 1000, "N_R": 800, "N_M": 700}
    for k in (0, 1, 2):
        frame[f"r_T_t{k}"] = _noise(len(labels), 0.048, 0.0102) - 0.00005 * k
    frame["N_T"] = cols["N_T"]
    frame["N_C"] = cols["N_C"]
    for k in (0, 1, 2):
        frame[f"r_C_t{k}"] = _noise(len(labels), 0.041, 0.0107) - 0.00004 * k
    for letter in ("R", "M"):
        frame[f"N_{letter}"] = cols[f"N_{letter}"]
        for k in (0, 1, 2):
            frame[f"r_{letter}_t{k}"] = _noise(len(labels), 0.05, 0.01)
    frame = frame[["label", "void", "g", "z", "y", "zy", "w", "wR", "wM", "price", "N_T", "r_T_t0", "r_T_t1",
                   "r_T_t2", "N_C", "r_C_t0", "r_C_t1", "r_C_t2", "N_R", "r_R_t0", "r_R_t1", "r_R_t2", "N_M",
                   "r_M_t0", "r_M_t1", "r_M_t2"]]
    frame.loc[frame["void"], [c for c in frame.columns if c.startswith("r_")]] = 0.0
    live = frame[~frame["void"]]
    a1, b1 = ols(live["r_T_t1"].to_numpy(), live["r_C_t1"].to_numpy())
    a2, _ = ols(live["r_T_t2"].to_numpy(), live["r_C_t2"].to_numpy())
    ranges = {"2012-10..2014-12": ("2012-10", "2014-12"), "2015-01..2018-12": ("2015-01", "2018-12"),
              "2019-01..2021-12": ("2019-01", "2021-12")}
    part = {}
    for key, (first, last) in ranges.items():
        sub = span(live, "label", first, last)
        part[key] = {"n": int(len(sub)), "a": ols(sub["r_T_t1"].to_numpy(), sub["r_C_t1"].to_numpy())[0]}
    doc = {"serve": {"serves": [{"end": FENCE}]}, "headline": {"n": int(len(live)), "a": a1, "b": b1},
           "means_pct_per_month": {str(k): {"T": float(live[f"r_T_t{k}"].mean()) * 100,
                                            "C": float(live[f"r_C_t{k}"].mean()) * 100} for k in (0, 1, 2)},
           "P3_2tick": {"n": int(len(live)), "a": a2}, "P2_blocks": part, "void_months": ["2016-03"]}
    write("metals_eq_ym_v1", frame, doc, "metals_eq_ym_v1_monthly.csv")


def _airfx() -> None:
    labels = _periods("2012-01", "2021-11")
    frame = pd.DataFrame({"label": [str(p) for p in labels], "held": True})
    frame["r_air_1tick"] = _noise(len(labels), 0.029, 0.0014)
    frame["r_air_2tick"] = frame["r_air_1tick"] - 0.0006
    for col in ("r_dol", "r_carry", "r_tsmom", "r_illiq", "r_trans"):
        frame[col] = _noise(len(labels), 0.03, 0.0)
    flat = frame["label"] == "2014-10"
    frame.loc[flat, "held"] = False
    frame.loc[flat, [c for c in frame.columns if c.startswith("r_")]] = 0.0
    held = frame[frame["held"]]
    head = stats(held["r_air_1tick"].to_numpy())
    ranges = {"2012-01_2013-12": ("2012-01", "2013-12"), "2014-01_2017-12": ("2014-01", "2017-12"),
              "2018-01_2021-11": ("2018-01", "2021-11")}
    parts = {key: stats(span(held, "label", first, last)["r_air_1tick"].to_numpy()) for key, (first, last) in ranges.items()}
    write("airfx_v0", frame, {"headline": {"n": head["n"], "mean": head["mean"], "sharpe_ann": head["sharpe"]},
                              "checks": {"mean_2tick": float(held["r_air_2tick"].mean())},
                              "counts": {"held_months": int(frame["held"].sum()), "flat_months": ["2014-10"]},
                              "blocks": {key: {"n": v["n"], "mean": v["mean"]} for key, v in parts.items()}},
          "airfx_v0_monthly.csv")


def main() -> None:
    _commodity("cmax_v0", "cmax_v0_monthly.csv", "r_cmax_{k}", ["carry_comm_1", "tsmom_comm_1", "cskew_1"], "lo_1")
    _commodity("hi52_v0", "hi52_v0_monthly.csv", "r_hi52_{k}", ["xsmom12_1_1", "lowvar_1", "carry_comm_1"], "lo_1")
    _crushdev()
    _fx_like("eqvrp_xasset_v0", "eqvrp_xasset_v0_monthly.csv", "cb_1", ["cfx", "tsfx"], "basket")
    _fx_like("fxval_ppp_v0", "fxval_ppp_v0_monthly.csv", "cb_1", ["carry6_1", "tsfx_1", "xmom_1"], "means")
    _fx_like("gvzvrp_pm_v0", "gvzvrp_pm_v0_monthly.csv", "cb_1", ["eqv", "tspm"], "basket")
    _liqbias()
    _gotobi()
    _metals()
    _airfx()


if __name__ == "__main__":
    main()
