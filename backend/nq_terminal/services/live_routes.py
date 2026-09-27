"""LIVE's Routes and Fills sections (the look spec, section 7.11), read only from one journal's close rows.

There is no order path and no IB client: the paper book journals each session's close with its decision (`target`,
`sent`, `sent_target`, `refused`, `blocked`, `error`) and the fills it counted (`fills`: `[contract, sign, qty,
price]`, sign +1 for a buy). From those rows alone:
- a route is one close row: its status (`error`, `refused`, `blocked`, `sent`, else `not sent`, in that order),
  the reason text, the decision's sizing price `p`, the close price, and a summary of the row's own fills (net and
  gross filled quantity, side of the net, quantity-weighted fill price, the journal's `slippage_ticks`). The send
  time is the book's rule (`ORDER_TIME_RULE`), not a recorded value;
- a fill is one entry of a close row's `fills`, with its notional at the MNQ point value (`live_guards`) for MNQ
  contracts and null for any other contract;
- every row carries `plumbing` (by row, `paper_plumbing.is_plumbing`) and the exact banner on plumbing rows; the
  totals count performance rows only (through `paper_plumbing.performance_rows`, then `check_no_plumbing`), with the
  plumbing routes and fills counted apart. A malformed fill entry is skipped and counted, never guessed.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Any, Mapping, Sequence

from nq_lab import paper_plumbing
from nq_lab.live_guards import MNQ_POINT_VALUE
from nq_terminal.services.journals import ORDER_ET, JournalRow, check_no_plumbing

ORDER_TIME_RULE = f"{ORDER_ET} ET by the book's rule (market orders at the close minus 30 s); the journal records no " \
                  "send time"
MNQ_PREFIX = "MNQ"
BUY, SELL = "BUY", "SELL"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _text(value: Any) -> str | None:
    return None if value is None else str(value)


def _midnight(date: Any) -> int | None:
    """Epoch seconds at 00:00 UTC of the row's session date (the charts' axis), or None."""
    try:
        day = dt.date.fromisoformat(str(date)[:10])
    except ValueError:
        return None
    return int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())


def status(row: Mapping[str, Any]) -> tuple[str, str | None]:
    """(status, reason) of one close row."""
    for key, name in (("error", "error"), ("refused", "refused"), ("blocked", "blocked")):
        if row.get(key):
            return name, _text(row.get(key))
    return ("sent", None) if row.get("sent") is True else ("not sent", None)


def parse_fill(entry: Any) -> tuple[str, int, int, float] | None:
    """(contract, sign, qty, price) from one `[contract, sign, qty, price]` entry, or None when malformed."""
    if not isinstance(entry, Sequence) or isinstance(entry, (str, bytes)) or len(entry) != 4:
        return None
    contract, sign, qty, price = entry
    ok = (isinstance(contract, str) and sign in (1, -1) and isinstance(qty, int) and not isinstance(qty, bool)
          and qty > 0 and _number(price) is not None)
    return (contract, int(sign), qty, float(price)) if ok else None


def notional(contract: str, qty: int, price: float) -> float | None:
    return qty * price * MNQ_POINT_VALUE if contract.startswith(MNQ_PREFIX) else None


def _labels(row: JournalRow) -> dict[str, Any]:
    return {"file": row.file, "line_no": row.line_no, "plumbing": row.plumbing,
            "banner": paper_plumbing.BANNER if row.plumbing else None, "date": _text(row.data.get("date")),
            "t": _midnight(row.data.get("date"))}


def _fills(row: JournalRow) -> tuple[list[dict[str, Any]], int]:
    raw = row.data.get("fills")
    entries = list(raw) if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)) else []
    parsed = [parse_fill(e) for e in entries]
    out = [{**_labels(row), "contract": c, "side": BUY if s > 0 else SELL, "qty": q, "price": p,
            "notional_usd": notional(c, q, p)} for c, s, q, p in (x for x in parsed if x is not None)]
    return out, sum(x is None for x in parsed)


def _route(row: JournalRow, own: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    state, reason = status(row.data)
    gross = sum(f["qty"] for f in own)
    net = sum(f["qty"] * (1 if f["side"] == BUY else -1) for f in own)
    avg = sum(f["qty"] * f["price"] for f in own) / gross if gross else None
    reconciled = row.data.get("reconciled")
    return {**_labels(row), "contract": _text(row.data.get("contract")), "status": state, "reason": reason,
            "target": _number(row.data.get("target")), "sent_target": _number(row.data.get("sent_target")),
            "decision_px": _number(row.data.get("p")), "close_px": _number(row.data.get("close_px")),
            "side": None if not own or net == 0 else (BUY if net > 0 else SELL),
            "filled_qty": gross if own else None, "net_filled": net if own else None, "avg_fill_px": avg,
            "slippage_ticks": _number(row.data.get("slippage_ticks")),
            "reconciled_ok": reconciled.get("ok") if isinstance(reconciled, Mapping)
            and isinstance(reconciled.get("ok"), bool) else None,
            "halted": row.data.get("halted") if isinstance(row.data.get("halted"), bool) else None}


def _summary(routes: list[dict], fills: list[dict], rows: Sequence[JournalRow], bad: int) -> dict[str, Any]:
    performance = paper_plumbing.performance_rows([row.data for row in rows])
    check_no_plumbing(performance)
    kept = {id(r) for r in performance}
    lines = {row.line_no for row in rows if id(row.data) in kept}
    mine = [f for f in fills if f["line_no"] in lines]
    decided = [r for r in routes if r["line_no"] in lines]
    values = [f["notional_usd"] for f in mine]
    return {"routes": len(decided), "sent": sum(r["status"] == "sent" for r in decided),
            "blocked": sum(r["status"] == "blocked" for r in decided),
            "refused": sum(r["status"] == "refused" for r in decided),
            "errors": sum(r["status"] == "error" for r in decided), "fills": len(mine),
            "filled_contracts": sum(f["qty"] for f in mine),
            "notional_usd": None if any(v is None for v in values) else float(sum(values)),
            "plumbing_routes": len(routes) - len(decided), "plumbing_fills": len(fills) - len(mine),
            "bad_fills": bad}


def routes_and_fills(rows: Sequence[JournalRow]) -> dict[str, Any]:
    """Routes, fills and performance-only totals of one journal's rows (see the module docstring)."""
    closes = [r for r in rows if r.data.get("type") == "close"]
    routes, fills, bad = [], [], 0
    for row in closes:
        own, skipped = _fills(row)
        routes.append(_route(row, own))
        fills.extend(own)
        bad += skipped
    return {"routes": routes, "fills": fills, "summary": _summary(routes, fills, closes, bad)}
