"""Reference values for the trade metrics (TA1, TA3) and the cost and exposure metrics (EX1 to EX4), recomputed
from the raw rows in the dump with independent code: Python `decimal`, numpy, pandas with zoneinfo, scipy, quantstats.

Where the reference path differs from the terminal's on purpose, so that agreement means something:
- EX1 positions are rebuilt from cumulative fills (the terminal reads the snapshots' `net_qty`);
- EX2 turnover comes from snapshot differences (the terminal defaults to the fills);
- EX3 and EX4 are summed in `decimal` from the dumped strings, with sides counted from the fills.

Documented differences (INFO, never failed):
- quantstats `win_rate` divides by the non-zero trades; TA1 (Nautilus `WinRate`) divides by all trades.
- quantstats `payoff_ratio` prepares its input as returns again inside (a USD P&L is not a return), so payoff is
  checked as quantstats `avg_win / abs(avg_loss)` with `prepare_returns=False`.
"""
from __future__ import annotations

import math
import warnings
from bisect import bisect_left
from decimal import Decimal

import numpy as np
import pandas as pd
from scipy import stats as sps

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import quantstats.stats as qs

from crosscheck.reference import DOCUMENTED, Ref

ET = "America/New_York"
GROUPINGS = ("hour", "weekday", "month")
LADDER = (0, 1, 2, 3, 4)
DAILY = 252
CI_LEVEL = 0.95


def _quiet(fn, *args, **kwargs):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


# ---------------------------------------------------------------- TA1 and TA3


def _trade_stats(p: np.ndarray) -> dict:
    s = pd.Series(p)
    wins, losses, nonzero = p[p > 0], p[p < 0], p[p != 0]
    avg_win = float(_quiet(qs.avg_win, s, prepare_returns=False)) if len(wins) else math.nan
    avg_loss = float(_quiet(qs.avg_loss, s, prepare_returns=False)) if len(losses) else math.nan
    return {
        "n": Ref(float(len(p)), "len(pnl)"),
        "win_rate": Ref(float(len(wins) / len(p)), "numpy count(pnl > 0) / n"),
        "win_rate_quantstats": Ref(float(_quiet(qs.win_rate, s, prepare_returns=False)), "quantstats.win_rate",
                                   DOCUMENTED, "quantstats divides by the non-zero trades, TA1 by all trades",
                                   "win_rate"),
        "avg_win": Ref(avg_win, "quantstats.avg_win(prepare_returns=False)"),
        "avg_loss": Ref(avg_loss, "quantstats.avg_loss(prepare_returns=False)"),
        "max_win": Ref(float(wins.max()) if len(wins) else math.nan, "numpy max of winners"),
        "max_loss": Ref(float(losses.min()) if len(losses) else math.nan, "numpy min of losers"),
        "expectancy": Ref(float(nonzero.mean()) if len(nonzero) else 0.0, "numpy mean of the non-zero trades"),
        "mean_pnl": Ref(float(p.mean()), "numpy mean"),
        "total_pnl": Ref(float(math.fsum(p)), "math.fsum"),
        "profit_factor": Ref(float(_quiet(qs.profit_factor, s, prepare_returns=False)),
                             "quantstats.profit_factor(prepare_returns=False)"),
        "payoff": Ref(avg_win / abs(avg_loss) if avg_loss else math.nan,
                      "quantstats avg_win / abs(avg_loss), prepare_returns=False"),
    }


def _key(stamp: pd.Timestamp, grouping: str) -> int:
    return {"hour": stamp.hour, "weekday": stamp.weekday(), "month": stamp.month}[grouping]


def _by_entry(p: np.ndarray, entry_ts: list) -> dict:
    local = pd.to_datetime(pd.Series(entry_ts), utc=True).dt.tz_convert(ET)
    out = {}
    for grouping in GROUPINGS:
        keys = [_key(t, grouping) for t in local]
        frame = pd.DataFrame({"k": keys, "p": p})
        rows = {}
        for k, part in frame.groupby("k"):
            n, m = len(part), float(part["p"].mean())
            half = (float(sps.t.ppf(0.5 + CI_LEVEL / 2, n - 1)) * float(part["p"].std(ddof=1)) / math.sqrt(n)
                    if n > 1 else math.nan)
            rows[str(int(k))] = (float(n), m, m - half, m + half)
        source = f"pandas groupby on the ET entry {grouping}, scipy t interval"
        for i, stat in enumerate(("n", "mean", "ci_lo", "ci_hi")):
            out[f"by_{grouping}_{stat}"] = Ref({k: v[i] for k, v in rows.items()}, source)
    return out


def trades_references(inputs: dict) -> dict:
    p = np.asarray(inputs["pnl"], dtype=float)
    refs = _trade_stats(p) if len(p) else {}
    if len(p) and inputs.get("entry_ts"):
        refs.update(_by_entry(p, inputs["entry_ts"]))
    return refs


# ---------------------------------------------------------------- EX3 and EX4


def _sides(inputs: dict, width: int) -> tuple[list[int], Decimal]:
    fills = inputs.get("fills") or {}
    if fills.get("signed_qty"):
        sides = [0] * width
        for k, q in zip(fills["instrument"], fills["signed_qty"]):
            sides[k] += abs(int(q))
        return sides, sum((Decimal(c) for c in fills["commission"]), Decimal(0))
    return [2 * len(inputs["trade_pnl"])], sum((Decimal(c) for c in inputs["trade_commission"]), Decimal(0))


def _cost_parts(inputs: dict) -> dict:
    insts, ticks = inputs["instruments"], int(inputs["ticks"])
    tick_value = [Decimal(i["tick_size"]) * Decimal(i["multiplier"]) for i in insts]
    fee = [Decimal(i["cost_per_side"]) - ticks * tv for i, tv in zip(insts, tick_value)]
    sides, paid = _sides(inputs, len(insts))
    gross = sum((Decimal(p) + Decimal(c) for p, c in zip(inputs["trade_pnl"], inputs["trade_commission"])),
                Decimal(0))
    commissions = sum((f * s for f, s in zip(fee, sides)), Decimal(0))
    per_tick = sum((tv * s for tv, s in zip(tick_value, sides)), Decimal(0))
    return {"gross": gross, "commissions": commissions, "per_tick": per_tick, "paid": paid, "ticks": ticks}


def costs_references(inputs: dict) -> dict:
    part = _cost_parts(inputs)
    src = "python decimal over the dumped trade and fill strings"
    before = part["gross"] - part["commissions"]
    slippage = part["ticks"] * part["per_tick"]
    refs = {"gross": Ref(float(part["gross"]), src), "commissions": Ref(float(part["commissions"]), src),
            "slippage": Ref(float(slippage), src), "net": Ref(float(before - slippage), src),
            "costs_total": Ref(float(part["paid"]), "python decimal sum of the fill (or trade) commissions")}
    refs.update({f"ladder_net_{t}": Ref(float(before - t * part["per_tick"]), f"{src}, linear at {t} ticks")
                 for t in LADDER})
    refs["break_even_ticks"] = Ref(float(before / part["per_tick"]) if part["per_tick"] else math.nan,
                                   f"{src}: (gross - commissions) / (tick value x sides)")
    if inputs.get("snapshots"):
        refs.update(_exposure_references(inputs))
    return refs


# ---------------------------------------------------------------- EX1 and EX2


def _fill_positions(inputs: dict, n_snap: int, width: int) -> np.ndarray:
    """Positions after each snapshot from cumulative fills (each fill to the first snapshot at or after it)."""
    snap_ts = [int(t) for t in inputs["snapshots"]["ts_ns"]]
    deltas = np.zeros((n_snap, width))
    fills = inputs.get("fills") or {}
    for k, q, ts in zip(fills.get("instrument", ()), fills.get("signed_qty", ()), fills.get("ts_ns", ())):
        row = bisect_left(snap_ts, int(ts))
        if row < n_snap:  # a fill after the last snapshot moves no snapshot position
            deltas[row, k] += q
    return np.cumsum(deltas, axis=0)


def _values(qty: np.ndarray, mult: np.ndarray, price: np.ndarray) -> np.ndarray:
    return np.where(qty != 0, qty * mult * np.nan_to_num(price, nan=0.0), 0.0)


def _exposure_references(inputs: dict) -> dict:
    snaps = inputs["snapshots"]
    mult = np.array([float(Decimal(i["multiplier"])) for i in inputs["instruments"]])
    price = np.array(snaps["price"], dtype=float)
    equity = np.array(snaps["equity"], dtype=float)
    held = _fill_positions(inputs, len(equity), len(mult))
    notional = _values(held, mult, price)
    stated = np.array(snaps["net_qty"], dtype=float)
    change = np.diff(stated, axis=0, prepend=np.zeros((1, stated.shape[1])))
    daily = np.abs(_values(change, mult, price)).sum(axis=1) / equity
    src = "numpy, positions from cumulative fills"
    return {"exposure_gross": Ref((np.abs(notional).sum(axis=1) / equity).tolist(), src),
            "exposure_net": Ref((notional.sum(axis=1) / equity).tolist(), src),
            "turnover_daily": Ref(daily.tolist(), "numpy, snapshot net_qty differences"),
            "turnover_annualised": Ref(float(daily.mean() * DAILY), "numpy, snapshot differences, mean x 252")}
