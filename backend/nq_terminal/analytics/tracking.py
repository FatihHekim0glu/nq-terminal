"""LV5 paper against model tracking (ANALYTICS_CATALOG section 13). Descriptive, read-only, [POST HOC].

Inputs: the paper book journal's close rows in journal order (the caller passes performance rows only, after
`paper_plumbing.performance_rows`; a plumbing row reaching this module is refused all the same) and the contract
multiplier (MNQ: 2 USD per point). For each close row after the first, against the close row before it:
- paper P&L = sum over the contracts actually held after the previous close (`actual`) of
  `held x (close today - close then) x multiplier`, each contract at its own close (`close_px_by_contract`), so a roll
  never mixes two contracts' prices;
- model P&L = the rule's target contracts of the previous row (`target`) on the previous row's contract
  (`contract`) over the same two closes: what the backtest model would have held;
- a value is null when a price it needs is missing on either row, or the row has no position map or target; a move is
  never attributed across a missing close (the next row is null too, since its previous close row has no price).
Totals (`n`, cumulative sums, the total and the sd of the daily difference, ddof 1) run over the days where both
values exist.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

from nq_lab import paper_plumbing

TAG = "[POST HOC]"
LABEL = ("paper P&L (contracts held x change of each contract's close) against the rule's target on the same closes; "
         "descriptive tracking, not strategy evidence")


class TrackingError(ValueError):
    """A plumbing row reached the tracking series, or the multiplier is not a positive number."""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _prices(row: Mapping[str, Any]) -> dict[str, float]:
    found = row.get("close_px_by_contract")
    if not isinstance(found, Mapping):
        return {}
    return {str(k): v for k, v in ((k, _number(v)) for k, v in found.items()) if v is not None}


def _move(contract: str, before: Mapping[str, float], after: Mapping[str, float]) -> float | None:
    if contract not in before or contract not in after:
        return None
    return after[contract] - before[contract]


def paper_pnl(held: Any, before: Mapping[str, float], after: Mapping[str, float], multiplier: float) -> float | None:
    """Held contracts times each contract's own close change; None without a position map or a needed price."""
    if not isinstance(held, Mapping):
        return None
    total = 0.0
    for contract, qty in held.items():
        n = _number(qty)
        if n is None:
            return None
        if n == 0:
            continue
        move = _move(str(contract), before, after)
        if move is None:
            return None
        total += n * move * multiplier
    return total


def model_pnl(target: Any, contract: Any, before: Mapping[str, float], after: Mapping[str, float],
              multiplier: float) -> float | None:
    """The rule's target on the previous row's contract over the same closes; None when either is missing."""
    n = _number(target)
    if n is None or not isinstance(contract, str):
        return None
    if n == 0:
        return 0.0
    move = _move(contract, before, after)
    return None if move is None else n * move * multiplier


def _running(values: Sequence[float | None]) -> list[float | None]:
    total, out = 0.0, []
    for value in values:
        if value is None:
            out.append(None)
            continue
        total += value
        out.append(total)
    return out


def _check(rows: Sequence[Mapping[str, Any]], multiplier: float) -> None:
    leaked = [r for r in rows if paper_plumbing.is_plumbing(r)]
    if leaked:
        raise TrackingError(f"{len(leaked)} plumbing row(s) reached the tracking series; plumbing is never "
                            "strategy performance")
    if _number(multiplier) is None or multiplier <= 0:
        raise TrackingError(f"the multiplier must be a positive number, got {multiplier!r}")


def paper_tracking(rows: Iterable[Mapping[str, Any]], multiplier: float) -> dict:
    """LV5 per close row after the first (see the module docstring)."""
    rows = list(rows)
    _check(rows, multiplier)
    closes = [r for r in rows if r.get("type") == "close"]
    dates, paper, model = [], [], []
    for before, after in zip(closes, closes[1:]):
        p0, p1 = _prices(before), _prices(after)
        dates.append(str(after.get("date")))
        paper.append(paper_pnl(before.get("actual"), p0, p1, multiplier))
        model.append(model_pnl(before.get("target"), before.get("contract"), p0, p1, multiplier))
    both = [p is not None and m is not None for p, m in zip(paper, model)]
    paper = [p if ok else None for p, ok in zip(paper, both)]
    model = [m if ok else None for m, ok in zip(model, both)]
    diff = [p - m if ok else None for p, m, ok in zip(paper, model, both)]
    kept = np.array([d for d in diff if d is not None], dtype=float)
    return {"date": dates, "paper": paper, "model": model, "difference": diff,
            "paper_cumulative": _running(paper), "model_cumulative": _running(model),
            "n": int(len(kept)), "total_difference": float(kept.sum()) if len(kept) else 0.0,
            "tracking_sd": float(kept.std(ddof=1)) if len(kept) > 1 else math.nan,
            "multiplier": float(multiplier), "unit": "USD per session", "tag": TAG, "label": LABEL}
