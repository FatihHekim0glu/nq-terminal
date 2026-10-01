"""MV6 term structure from the calendar chains (ANALYTICS_CATALOG section 11). Descriptive, [POST HOC].

Inputs are the served 1d frames of a root's calendar chain, `<ROOT>.C.k` (k = 0 the nearest expiry, 1 the next),
which the carry round built from the vendor's per-rank continuous series: unadjusted `o h l c`, volume `v` and the
`contract` key of each bar ("NQH2015": root, month code, full year), resolved from the dated symbology; a bar whose
contract could not be resolved carries an empty key. The caller serves them through the gate (caller `terminal`,
the in-sample window); nothing here reads a file.

Per session (the UTC date of the bar; rows on or after the fence 2022-01-01 are dropped first, defence in depth):
- F1 and F2 are the closes of C.0 and C.1 on that session; E1 and E2 their last trading days from the lab's pinned
  CME table (`nq_lab.carry_expiry.last_trading_day`, the table carry_v0 checked against every sampled definition
  record);
- `spread = F1 - F2` in the root's served units; `carry = (F1 - F2) / (F2 x tau)` with `tau = (E2 - E1) days /
  365.25`, the carry_v0 formula (`nq_lab.carry_signal.carry_value`, imported), a fraction per year, positive in
  backwardation (the front above the next), negative in contango.
- A session is void, and counted by reason, when a leg has no bar (`missing_front`, `missing_next`), a key does not
  resolve to this root's contract (`unresolved`), the next leg does not expire after the front (`order`), a leg fails
  carry_v0's liquidity rule, volume at least 10 and high above low (`thin`), or F2 is not a positive finite price
  (`price`). The first reason in that order is the one counted.
The latest curve: every rank's bar on the last session C.0 has, with its contract, expiry, close, volume and days to
expiry (a thin bar is shown and flagged, never dropped). Descriptive only: no test statistic, no p-value.
"""
from __future__ import annotations

import datetime as dt
import math
import re
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab import carry_expiry
from nq_lab.carry_signal import DAYS_PER_YEAR, MIN_VOLUME, carry_value
from nq_lab.config import IS_END, IS_START

KEY = re.compile(r"^([0-9A-Z]{2})([FGHJKMNQUVXZ])(\d{4})$")
VOID_REASONS = ("missing_front", "missing_next", "unresolved", "order", "thin", "price")
TAG = "[POST HOC]"
LABEL = ("term structure: the front and next calendar-chain contracts on each session, their spread annualised by "
         "the days between their pinned CME expiries; descriptive, in-sample, not a registered test")


def contract_month(key: Any, root: str) -> tuple[int, int] | None:
    """(year, month) of a contract key of `root` ("NQH2015" -> (2015, 3)); None for anything else."""
    match = KEY.fullmatch(str(key)) if isinstance(key, str) else None
    if match is None or match.group(1) != root:
        return None
    return int(match.group(3)), carry_expiry.MONTH_CODES.index(match.group(2)) + 1


def expiry_of(key: Any, root: str) -> dt.date | None:
    """The contract's last trading day from the pinned CME table; None when the key does not resolve."""
    month = contract_month(key, root)
    return None if month is None else carry_expiry.last_trading_day(root, *month)


def in_sample(frame: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Rows before the fence keyed by their UTC session date, and how many rows were dropped."""
    if frame.empty:
        return pd.DataFrame(columns=["c", "v", "h", "l", "contract"]), 0
    stamps = pd.to_datetime(frame["ts"], utc=True)
    keep = (stamps >= IS_START) & (stamps < IS_END)
    kept = frame.loc[keep].assign(session=stamps[keep].dt.strftime("%Y-%m-%d"))
    kept = kept.drop_duplicates("session", keep="last").set_index("session").sort_index()
    return kept[["c", "v", "h", "l", "contract"]], int((~keep).sum())


def _liquid(bar: Mapping[str, Any]) -> bool:
    return bool(bar["v"] >= MIN_VOLUME and bar["h"] > bar["l"])


def _void(front: Any, nxt: Any, root: str) -> str | None:
    if front is None:
        return "missing_front"
    if nxt is None:
        return "missing_next"
    e1, e2 = expiry_of(front["contract"], root), expiry_of(nxt["contract"], root)
    if e1 is None or e2 is None:
        return "unresolved"
    if not e2 > e1:
        return "order"
    if not (_liquid(front) and _liquid(nxt)):
        return "thin"
    f1, f2 = float(front["c"]), float(nxt["c"])
    return None if math.isfinite(f1) and math.isfinite(f2) and f2 > 0 else "price"


def _row(session: str, front: Mapping[str, Any], nxt: Mapping[str, Any], root: str) -> dict:
    e1, e2 = expiry_of(front["contract"], root), expiry_of(nxt["contract"], root)
    f1, f2 = float(front["c"]), float(nxt["c"])
    return {"date": session, "t": int(pd.Timestamp(session, tz="UTC").timestamp()), "front": str(front["contract"]),
            "next": str(nxt["contract"]), "f1": f1, "f2": f2, "expiry_front": e1.isoformat(),
            "expiry_next": e2.isoformat(), "tau_years": (e2 - e1).days / DAYS_PER_YEAR, "spread": f1 - f2,
            "carry": carry_value(f1, f2, e1, e2)}


def front_next(c0: pd.DataFrame, c1: pd.DataFrame, root: str) -> dict:
    """The front to next carry on every in-sample session either leg has, with the void sessions counted."""
    front, fenced0 = in_sample(c0)
    nxt, fenced1 = in_sample(c1)
    fronts, nexts = front.to_dict("index"), nxt.to_dict("index")
    void = dict.fromkeys(VOID_REASONS, 0)
    rows = []
    sessions = sorted(set(fronts) | set(nexts))
    for session in sessions:
        a, b = fronts.get(session), nexts.get(session)
        reason = _void(a, b, root)
        if reason is not None:
            void[reason] += 1
            continue
        rows.append(_row(session, a, b, root))
    return {"rows": rows, "void": void, "sessions": len(sessions), "fenced": fenced0 + fenced1, "tag": TAG,
            "label": LABEL}


def summary(rows: Sequence[Mapping[str, Any]]) -> dict:
    """n, mean, median, min, max, the share of sessions in backwardation and the last value of the carry."""
    carry = np.array([r["carry"] for r in rows], dtype=float)
    if not len(carry):
        return {"n": 0, "mean": math.nan, "median": math.nan, "min": math.nan, "max": math.nan,
                "share_backwardation": math.nan, "last": math.nan, "last_date": None}
    return {"n": len(carry), "mean": float(carry.mean()), "median": float(np.median(carry)),
            "min": float(carry.min()), "max": float(carry.max()), "share_backwardation": float((carry > 0).mean()),
            "last": float(carry[-1]), "last_date": str(rows[-1]["date"])}


def latest_curve(frames: Mapping[int, pd.DataFrame], root: str) -> dict:
    """Every rank's bar on the last in-sample session of C.0 (ranks without a bar that day are listed missing)."""
    legs = {rank: in_sample(frame)[0] for rank, frame in sorted(frames.items())}
    front = legs.get(0)
    if front is None or front.empty:
        return {"date": None, "rows": [], "missing": sorted(r for r in legs if r != 0)}
    session = str(front.index[-1])
    day = dt.date.fromisoformat(session)
    rows, missing = [], []
    for rank, leg in legs.items():
        if session not in leg.index or expiry_of(leg.at[session, "contract"], root) is None:
            missing.append(rank)
            continue
        bar = leg.loc[session]
        expiry = expiry_of(bar["contract"], root)
        rows.append({"rank": rank, "contract": str(bar["contract"]), "expiry": expiry.isoformat(),
                     "days_to_expiry": (expiry - day).days, "close": float(bar["c"]), "volume": float(bar["v"]),
                     "thin": not _liquid(bar)})
    return {"date": session, "rows": rows, "missing": missing}
