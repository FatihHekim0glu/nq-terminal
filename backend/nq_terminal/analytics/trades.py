"""Trade analytics (ANALYTICS_CATALOG.md section 8: TA1, TA3, TA6). Descriptive only; nothing here is a verdict.

Inputs are plain rows: a run's `trades[]` as the runs service serves them (mappings, or pydantic rows with
`model_dump`), the run's `summary`, the loaded `results/quote_check_v1.json` and the live close rows'
`slippage_ticks`. No file is read here.

TA1 trade tiles over per-trade net P&L (`pnl_usd`, after commissions), with the definitions of the Nautilus
statistics fed to `calculate_from_realized_pnls` (tests check they agree):
- n; wins (P&L > 0), losses (P&L < 0), flat (P&L = 0);
- win rate = wins / n (`WinRate`); it equals the runner's `summary.hit_rate`, because a trade's net R and its
  net USD share their sign;
- average win and average loss: means over the winners and over the losers (`AvgWinner`, `AvgLoser`); max win,
  the largest winner, and max loss, the most negative loser (`MaxWinner`, `MaxLoser`);
- expectancy = average win x wins / (wins + losses) + average loss x losses / (wins + losses), the mean over the
  trades with a non-zero P&L (`Expectancy`); the plain mean P&L per trade is shown next to it;
- profit factor = sum of winners / abs(sum of losers) (`ProfitFactor`, which Nautilus 1.231.0 implements only
  from returns); payoff = average win / abs(average loss).
Undefined values are NaN (no trades, no winners, no losers), as Nautilus returns them. Mean net R, its t and the
per-trade USD t are read from the run's `summary`, never recomputed.

TA3 mean net P&L per trade by entry hour (US/Eastern, so the clock change is followed), weekday and month of
year: n, mean, sample sd and the 95% t interval mean +/- t(0.975, n - 1) x sd / sqrt(n); NaN below two trades.
Tagged [POST HOC]; no p-values.

TA6 fill slippage in ticks of 0.25 points, positive = adverse (paid), from the quote check rows (entry, and the
exit by reason: close, stop, target) and from the live close rows' `slippage_ticks` (performance rows only; the
caller drops plumbing rows first). Percentiles are linear (numpy's default), as the quote check computed them,
and every quote check group is compared with the stored summary. Backtest fills are modelled, so they get no
slippage distribution.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy import stats as sps

__all__ = ["GROUPINGS", "TradeError", "by_entry", "pnl_values", "slippage_distribution", "summary_values",
           "trade_stats", "trade_tiles"]

ET = "America/New_York"
CI_LEVEL = 0.95
STORED_TOL = 1e-12  # relative, for values read back from a result file (ANALYTICS_CATALOG section 14)
POST_HOC = "[POST HOC]"
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
GROUPINGS = ("hour", "weekday", "month")
STORED_KEYS = ("n_trades", "hit_rate", "mean_net_r", "t_net_r", "gross_mean_r", "mean_pnl_usd", "t_pnl_usd")
PERCENTILES = (5, 50, 95)
EXIT_GROUPS = (("close", "eod"), ("stop", "stop"), ("target", "target"))  # (shown name, quote check reason)
SLIPPAGE_UNIT = "ticks of 0.25 points"
SLIPPAGE_LABEL = ("Fill slippage in ticks, positive = adverse (paid). Quote check: a 96-trade sample of real "
                  "top-of-book quotes; live: close rows of the paper book. Backtest fills are modelled, so they "
                  "have no slippage distribution.")
QUOTE_SOURCE = "results/quote_check_v1.json trades"
LIVE_SOURCE = "live close rows (performance only)"


class TradeError(ValueError):
    """A trade row lacks a value the analytics need (a finite P&L or an entry time)."""


def _plain(row: Any) -> Mapping[str, Any]:
    return row.model_dump() if hasattr(row, "model_dump") else row


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def pnl_values(trades: Iterable[Any]) -> np.ndarray:
    """Per-trade net P&L in USD; a missing or non-finite `pnl_usd` is refused, never dropped."""
    values = []
    for number, row in enumerate(trades):
        value = _plain(row).get("pnl_usd")
        if not _finite(value):
            raise TradeError(f"trade {number} has no finite pnl_usd ({value!r})")
        values.append(float(value))
    return np.asarray(values, dtype=float)


# ---------------------------------------------------------------- TA1


def _mean(values: np.ndarray) -> float:
    return float(values.mean()) if len(values) else math.nan


def _ratio(top: float, bottom: float) -> float:
    return top / bottom if bottom != 0 and math.isfinite(top) and math.isfinite(bottom) else math.nan


def trade_stats(pnls: Sequence[float] | np.ndarray) -> dict:
    """TA1 tiles over per-trade net P&L (definitions in the module docstring)."""
    values = np.asarray(pnls, dtype=float)
    wins, losses = values[values > 0], values[values < 0]
    decided = len(wins) + len(losses)
    avg_win, avg_loss = _mean(wins), _mean(losses)
    if not len(values):
        expectancy = math.nan
    elif decided:
        expectancy = (avg_win if len(wins) else 0.0) * len(wins) / decided + \
            (avg_loss if len(losses) else 0.0) * len(losses) / decided
    else:
        expectancy = 0.0
    return {
        "n": int(len(values)), "wins": int(len(wins)), "losses": int(len(losses)),
        "flat": int(len(values) - decided),
        "win_rate": len(wins) / len(values) if len(values) else math.nan,
        "avg_win": avg_win, "avg_loss": avg_loss,
        "max_win": float(wins.max()) if len(wins) else math.nan,
        "max_loss": float(losses.min()) if len(losses) else math.nan,
        "expectancy": float(expectancy), "mean_pnl": _mean(values),
        "total_pnl": float(values.sum()) if len(values) else math.nan,
        "profit_factor": _ratio(float(wins.sum()), abs(float(losses.sum()))) if len(values) else math.nan,
        "payoff": _ratio(avg_win, abs(avg_loss)),
    }


def summary_values(summary: Mapping[str, Any] | None) -> dict:
    """The run summary's own trade numbers, as stored (mean net R and t are never recomputed here)."""
    source = summary or {}
    return {key: source.get(key) for key in STORED_KEYS}


def trade_tiles(trades: Iterable[Any], summary: Mapping[str, Any] | None) -> dict:
    """TA1: the tiles, the summary's stored values and whether the win rate equals `summary.hit_rate`."""
    stats = trade_stats(pnl_values(trades))
    stored = summary_values(summary)
    hit = stored["hit_rate"]
    matches = None if not _finite(hit) else bool(stats["win_rate"] == hit)
    return {"unit": "USD per trade, net of commissions", "stats": stats, "summary": stored,
            "hit_rate_matches": matches}


# ---------------------------------------------------------------- TA3


def _entry_times(rows: Sequence[Mapping[str, Any]]) -> pd.DatetimeIndex:
    stamps = []
    for number, row in enumerate(rows):
        value = row.get("entry_ts")
        if not isinstance(value, str) or not value:
            raise TradeError(f"trade {number} has no entry_ts ({value!r})")
        stamps.append(pd.Timestamp(value))
    index = pd.DatetimeIndex(stamps)
    index = index.tz_localize("UTC") if index.tz is None else index
    # Daily books stamp entries at 00:00 UTC of the next day; New York time maps them back to the session date,
    # which is what makes the weekday and month groupings right (their hour is only the DST offset).
    return index.tz_convert(ET)


def _keys(times: pd.DatetimeIndex, grouping: str) -> np.ndarray:
    if grouping == "hour":
        return np.asarray(times.hour)
    if grouping == "weekday":
        return np.asarray(times.weekday)
    return np.asarray(times.month)


def _label(grouping: str, key: int) -> str:
    if grouping == "hour":
        return f"{key:02d}:00"
    return WEEKDAYS[key] if grouping == "weekday" else MONTHS[key - 1]


def _group_row(grouping: str, key: int, values: pd.Series) -> dict:
    n, mean = int(len(values)), float(values.mean())
    sd = float(values.std(ddof=1)) if n > 1 else math.nan
    half = float(sps.t.ppf(0.5 + CI_LEVEL / 2, n - 1)) * sd / math.sqrt(n) if n > 1 else math.nan
    return {"key": int(key), "label": _label(grouping, int(key)), "n": n, "mean": mean, "sd": sd,
            "ci_lo": mean - half, "ci_hi": mean + half}


def by_entry(trades: Iterable[Any], grouping: str) -> dict:
    """TA3: mean net P&L per trade by entry hour (ET), weekday or month, with its 95% t interval."""
    if grouping not in GROUPINGS:
        raise ValueError(f"grouping must be one of {GROUPINGS}, got {grouping!r}")
    rows = [_plain(row) for row in trades]
    pnl = pd.Series(pnl_values(rows))
    keys = _keys(_entry_times(rows), grouping) if rows else np.asarray([], dtype=int)
    table = [_group_row(grouping, key, group) for key, group in pnl.groupby(keys, sort=True)]
    return {"grouping": grouping, "timezone": ET, "unit": "USD per trade", "tag": POST_HOC,
            "ci": f"{CI_LEVEL:.0%} t interval, none below two trades", "rows": table}


# ---------------------------------------------------------------- TA6


def _distribution(name: str, source: str, values: Iterable[Any], stored: Mapping[str, Any] | None) -> dict:
    kept = np.asarray([float(v) for v in values if _finite(v)], dtype=float)
    unique, counts = np.unique(kept, return_counts=True)
    group = {"name": name, "source": source, "n": int(len(kept)), "mean": _mean(kept),
             "values": unique.tolist(), "counts": counts.astype(int).tolist()}
    group.update({f"p{q}": float(np.percentile(kept, q)) if len(kept) else math.nan for q in PERCENTILES})
    group["matches_stored"] = None if stored is None else _matches(group, stored)
    return group


def _close(ours: float, stored: Any) -> bool:
    return _finite(stored) and abs(ours - stored) <= STORED_TOL * max(abs(ours), abs(stored), 1.0)


def _matches(group: Mapping[str, Any], stored: Mapping[str, Any]) -> bool:
    mean = stored.get("mean", stored.get("mean_ticks"))
    pct = stored.get("pct") or {}
    count_ok = stored.get("n") in (None, group["n"])
    return bool(count_ok and _close(group["mean"], mean)
                and all(_close(group[f"p{q}"], pct.get(str(q))) for q in PERCENTILES))


def slippage_distribution(quote_check: Mapping[str, Any], live_ticks: Sequence[Any] = ()) -> dict:
    """TA6: slippage by entry and exit reason from the quote check, plus the live close rows."""
    rows = [row for row in quote_check.get("trades") or () if isinstance(row, Mapping)]
    summary = quote_check.get("summary") or {}
    by_reason = summary.get("exit_cost_ticks_by_reason") or {}
    groups = [_distribution("entry", f"{QUOTE_SOURCE}.entry_cost_ticks",
                            [r.get("entry_cost_ticks") for r in rows], summary.get("entry_cost_ticks") or {})]
    for name, reason in EXIT_GROUPS:
        values = [r.get("exit_cost_ticks") for r in rows if r.get("reason") == reason]
        groups.append(_distribution(name, f"{QUOTE_SOURCE}.exit_cost_ticks, reason {reason}", values,
                                    by_reason.get(reason) or {}))
    groups.append(_distribution("live close", LIVE_SOURCE, live_ticks, None))
    checked = [g["matches_stored"] for g in groups if g["matches_stored"] is not None]
    return {"unit": SLIPPAGE_UNIT, "label": SLIPPAGE_LABEL, "groups": groups,
            "matches_stored": bool(checked) and all(checked)}
