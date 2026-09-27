"""TA2 maximum adverse and favourable excursion (ANALYTICS_CATALOG section 8). Descriptive only.

Inputs: a run's `trades[]` rows (direction +1 or -1, entry and exit times as ISO strings, the entry and exit fill
prices, the exit `reason`, `r_pts` where the strategy sized a risk unit, net `pnl_usd`) and the 1-minute bars the gate
served for the run's own series (bar open times `ts` in UTC, highs `h`, lows `l`, on the same back-adjusted price
basis the run traded). Reading the bars through the gate lives in `services/tearsheet_trades.py`; this module only
computes. A fill is stamped at the close of the bar it happened in (za's first entry at 13:35 is the 13:34 bar's
close), or inside a bar.

Per trade, in points, `dir x (price - entry_px)`:
- a bar that opens at or after the entry and closes at or before the exit counts both its extremes;
- a bar the entry falls strictly inside counts only its adverse extreme: the order of prices inside a bar is unknown,
  so the conservative side is taken (adverse moves assumed to come after the entry, favourable ones not);
- the exit bar is the bar the exit fill happened in: the one ending at the exit stamp or holding it. A stop fills on
  its first touch, so a `stop` exit bar adds nothing (anything past the fill came after the exit: MAE is capped at
  the stop). A `target` fills on its first touch too, so its exit bar adds only its adverse extreme. Any other exit
  (end of day, signal, roll) fills at the close of the bar ending at its stamp, so that bar is whole; an exit stamped
  strictly inside a bar keeps only that bar's adverse extreme;
- a bar opening at or after the exit is not part of the trade;
- the entry and exit prices themselves always count (a trade closed at a profit has MFE at least that profit).
`MAE = min(0, final, counted adverse extremes)`, `MFE = max(0, final, favourable extremes of whole bars)`. In R where
the trade has a positive `r_pts`; in USD at the contract's point value. A trade with no bar in its span keeps the
entry and exit values only and is flagged `no_bars`.

Price basis: each fill must lie inside a bar it could have happened in (the bar ending at its stamp, the bar opening
at it, or the bar holding it), within one tick. A trade with a fill outside is flagged `off_basis`, and the counts
say how many trades were checked and how many failed; bars on another basis (a variant or roll mix-up) would
otherwise give MAE and MFE of thousands of points without a word.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd

MINUTE = pd.Timedelta(minutes=1)
LABEL = ("MAE and MFE over the 1-minute bars from entry to exit, in points from the entry fill: bars inside the trade "
         "count both extremes, the bar the entry falls inside counts only its adverse extreme (the order within a bar "
         "is unknown), a stop's exit bar adds nothing past the fill and a target's only its adverse extreme, and the "
         "entry and exit prices always count")
STOP, TARGET = "stop", "target"  # exits that fill on their first touch inside a bar
MAX_OFF_BASIS_SHARE = 0.05  # above this share of checked trades off their bars, the bars are on another basis


class ExcursionError(ValueError):
    """A trade row lacks what the excursion needs, or its times are reversed."""


def _plain(row: Any) -> Mapping[str, Any]:
    return row.model_dump() if hasattr(row, "model_dump") else row


def _stamp(value: Any, what: str, number: int) -> pd.Timestamp:
    if not isinstance(value, str) or not value:
        raise ExcursionError(f"trade {number} has no {what} ({value!r})")
    stamp = pd.Timestamp(value)
    return stamp.tz_localize("UTC") if stamp.tz is None else stamp.tz_convert("UTC")


def _number(value: Any, what: str, number: int) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ExcursionError(f"trade {number} has no finite {what} ({value!r})")
    return float(value)


def _parse(row: Mapping[str, Any], number: int) -> dict:
    direction = row.get("direction")
    if direction not in (1, -1):
        raise ExcursionError(f"trade {number} has direction {direction!r}, not +1 or -1")
    entry, exit_ = _stamp(row.get("entry_ts"), "entry_ts", number), _stamp(row.get("exit_ts"), "exit_ts", number)
    if exit_ < entry:
        raise ExcursionError(f"trade {number} exits before it enters")
    r_pts, reason = row.get("r_pts"), row.get("reason")
    return {"direction": int(direction), "entry": entry, "exit": exit_,
            "reason": reason if isinstance(reason, str) else None,
            "entry_px": _number(row.get("entry_px"), "entry_px", number),
            "exit_px": _number(row.get("exit_px"), "exit_px", number),
            "r_pts": float(r_pts) if isinstance(r_pts, (int, float)) and not isinstance(r_pts, bool) and r_pts > 0
            else None, "pnl_usd": row.get("pnl_usd")}


def _bar_arrays(bars: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # nanoseconds whatever unit pandas parsed to (pandas 3 gives microseconds), to compare with Timestamp.value
    ns = pd.DatetimeIndex(pd.to_datetime(bars["ts"], utc=True)).as_unit("ns").asi8
    order = np.argsort(ns, kind="stable")
    return ns[order], bars["h"].to_numpy(dtype=float)[order], bars["l"].to_numpy(dtype=float)[order]


def _outside(stamp_ns: int, px: float, opens: np.ndarray, high: np.ndarray, low: np.ndarray,
             tick: float) -> bool | None:
    """Whether a fill lies outside every bar it could have happened in, by more than one tick; None without a bar."""
    lo = int(np.searchsorted(opens, stamp_ns - MINUTE.value, side="left"))
    hi = int(np.searchsorted(opens, stamp_ns, side="right"))
    if lo >= hi:
        return None
    slack = tick * (1 + 1e-9)
    return bool(px < low[lo:hi].min() - slack or px > high[lo:hi].max() + slack)


def _basis(t: dict, opens: np.ndarray, high: np.ndarray, low: np.ndarray, tick: float) -> bool | None:
    """True when a fill lies off its bars, False when every checked fill lies on them, None when none could be."""
    checks = [_outside(t["entry"].value, t["entry_px"], opens, high, low, tick),
              _outside(t["exit"].value, t["exit_px"], opens, high, low, tick)]
    known = [c for c in checks if c is not None]
    return any(known) if known else None


def _extremes(t: dict, opens: np.ndarray, high: np.ndarray, low: np.ndarray) -> tuple[float, float, int, int]:
    """MAE, MFE, whole bars and touched bars of one trade (the module docstring's bar rules)."""
    entry_ns, exit_ns, minute = t["entry"].value, t["exit"].value, MINUTE.value
    first = int(np.searchsorted(opens, entry_ns - minute, side="right"))  # bars whose close is after the entry
    last = int(np.searchsorted(opens, exit_ns, side="left"))  # bars opening before the exit
    span = slice(first, max(first, last))
    d, px, o = t["direction"], t["entry_px"], opens[span]
    up, down = d * (high[span] - px), d * (low[span] - px)
    adverse, favourable = np.minimum(up, down), np.maximum(up, down)
    exit_bar = o >= exit_ns - minute  # the bar the exit fill happened in
    whole = (o >= entry_ns) & (o + minute <= exit_ns)
    if t["reason"] in (STOP, TARGET):
        whole &= ~exit_bar
    counted = ~exit_bar if t["reason"] == STOP else np.ones(o.size, dtype=bool)
    final = d * (t["exit_px"] - px)
    mae = float(min(0.0, final, adverse[counted].min())) if counted.any() else min(0.0, final)
    mfe = float(max(0.0, final, favourable[whole].max())) if whole.any() else max(0.0, final)
    return mae, mfe, int(whole.sum()), int(o.size)


def _one(t: dict, opens: np.ndarray, high: np.ndarray, low: np.ndarray, point_value: float, tick: float) -> dict:
    mae, mfe, whole, touched = _extremes(t, opens, high, low)
    d, final = t["direction"], t["direction"] * (t["exit_px"] - t["entry_px"])
    r, pnl = t["r_pts"], t["pnl_usd"]
    basis = _basis(t, opens, high, low, tick)
    return {"entry_ts": t["entry"].isoformat(), "exit_ts": t["exit"].isoformat(), "direction": d,
            "mae_pts": mae, "mfe_pts": mfe, "final_pts": final,
            "mae_r": mae / r if r else None, "mfe_r": mfe / r if r else None, "final_r": final / r if r else None,
            "mae_usd": mae * point_value, "mfe_usd": mfe * point_value,
            "pnl_usd": float(pnl) if isinstance(pnl, (int, float)) and not isinstance(pnl, bool) else None,
            "win": bool(pnl > 0) if isinstance(pnl, (int, float)) else final > 0,
            "whole_bars": whole, "partial_bars": touched - whole, "no_bars": touched == 0,
            "basis_checked": basis is not None, "off_basis": bool(basis)}


def excursions(trades: Iterable[Any], bars: pd.DataFrame, *, point_value: float, tick: float) -> dict:
    """TA2 per trade and the counts the chart needs (see the module docstring); `tick` in points."""
    if isinstance(tick, bool) or not isinstance(tick, (int, float)) or not (math.isfinite(tick) and tick > 0):
        raise ExcursionError(f"the tick size must be a positive number of points, got {tick!r}")
    parsed = [_parse(_plain(row), number) for number, row in enumerate(trades)]
    opens, high, low = _bar_arrays(bars) if len(bars) else (np.array([], dtype=np.int64), np.array([]), np.array([]))
    checked = [_one(t, opens, high, low, point_value, float(tick)) for t in parsed]
    rows = [{k: v for k, v in r.items() if k != "basis_checked"} for r in checked]
    return {"label": LABEL, "unit": "points from the entry fill", "point_value": point_value, "tick": float(tick),
            "n": len(rows), "no_bars": sum(r["no_bars"] for r in rows),
            "in_r": sum(r["mae_r"] is not None for r in rows),
            "basis_checked": sum(r["basis_checked"] for r in checked),
            "off_basis": sum(r["off_basis"] for r in rows), "rows": rows}
