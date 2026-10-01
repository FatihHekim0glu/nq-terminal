"""EX5 capacity of a Nautilus run (ANALYTICS_CATALOG section 9). Descriptive, [POST HOC].

Participation per session: contracts traded on the session over the session's volume, `ratio = contracts / v`.
- Contracts: the fills' quantities (every side counts: a roll trades the old and the new contract), grouped by the
  New York date of each fill's time stamp (the daily books stamp a fill at 00:00 UTC, the evening of its session in
  New York; the sized books at 20:00 UTC, the close). Runs without fills (za_orb, overnight) trade one NQ contract per
  trade: one contract at the entry and one at the exit, each on its own session, as EX3 counts their sides.
- Instruments map to the continuous series whose volume is the denominator (`volume_source`): `ES.XCME` to ES; a
  per-contract name such as eomtsy's `ZTU2010.XCME` to its root ZT (the volume of the volume-rolled series, the most
  traded contract, not of the contract held, and said so); a micro contract to its parent in full contracts
  (MNQ x its multiplier / NQ's multiplier, a tenth). A root outside the frozen futures universe has no series and is
  listed without ratios.
- Volume: the vendor 1d bar of the root's continuous series dated on the session (the caller serves it through the
  gate). A traded session without a bar, or with a volume of zero or less, is void and counted, never dropped.
Per root: sessions traded, sessions with a volume, void sessions, contracts in total and per traded session, and the
mean, median, 95th percentile (numpy linear) and maximum of the ratio with the session of the maximum; across roots
the sessions with the largest ratios. Everything is descriptive: capacity is not a test.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

ET = "America/New_York"
ONE_NQ = "NQ (one contract per trade)"  # exposure.ONE_NQ: the intraday runs' one instrument
MICRO = {"MNQ": "NQ"}  # a micro contract counts in full contracts of its parent
OUTRIGHT = re.compile(r"^([0-9A-Z]{2})[FGHJKMNQUVXZ]\d{4}$")
PLAIN_ROOT = re.compile(r"^[0-9A-Z]{1,6}$")
PERCENTILE = 0.95
WORST = 10
TAG = "[POST HOC]"
LABEL = ("capacity: contracts traded per session over that session's volume (the vendor 1d bar of the continuous "
         "series); descriptive, in-sample")
PER_CONTRACT_NOTE = "volume of the continuous series (the most traded contract), not of the contract held"
MICRO_NOTE = "{micro} counted in full {parent} contracts ({factor:g} each), over {parent} volume"
OUTSIDE_NOTE = "not in the futures universe: no volume series"


class CapacityError(ValueError):
    """A fill or trade row, or an instrument's multiplier, cannot be counted."""


@dataclass(frozen=True)
class VolumeSource:
    instrument: str
    root: str | None
    factor: float
    note: str | None


@dataclass(frozen=True)
class Leg:
    instrument: str
    session: str
    qty: float


def _head(instrument: str) -> str:
    return "NQ" if instrument == ONE_NQ else str(instrument).split(".")[0]


def volume_source(instrument: str, multiplier: float | None, full_multipliers: Mapping[str, float],
                  roots: frozenset[str]) -> VolumeSource:
    """The continuous root whose volume measures `instrument`, and full contracts per traded contract."""
    head = _head(instrument)
    outright = OUTRIGHT.fullmatch(head)
    if outright is not None:
        root, factor, note = outright.group(1), 1.0, PER_CONTRACT_NOTE
    elif head in MICRO:
        parent = MICRO[head]
        if multiplier is None or not math.isfinite(multiplier) or multiplier <= 0 or parent not in full_multipliers:
            raise CapacityError(f"{instrument}: no multiplier to count it in full {parent} contracts")
        factor = float(multiplier) / float(full_multipliers[parent])
        root, note = parent, MICRO_NOTE.format(micro=head, parent=parent, factor=factor)
    else:
        root, factor, note = head, 1.0, None
    if root not in roots or not PLAIN_ROOT.fullmatch(root):
        return VolumeSource(instrument, None, factor, OUTSIDE_NOTE)
    return VolumeSource(instrument, root, factor, note)


def session_of(ts: Any) -> str:
    """The New York date of a time stamp (ISO text, epoch seconds or a Timestamp)."""
    stamp = pd.Timestamp(ts, unit="s", tz="UTC") if isinstance(ts, (int, float)) else pd.Timestamp(ts)
    if stamp is pd.NaT:
        raise CapacityError(f"not a time stamp: {ts!r}")
    stamp = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp
    return stamp.tz_convert(ET).strftime("%Y-%m-%d")


def _qty(row: Mapping[str, Any], number: int) -> float:
    value = row.get("qty")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise CapacityError(f"fill {number} has no positive quantity ({value!r})")
    return float(value)


def _stamp(row: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    raise CapacityError(f"a row has none of {', '.join(keys)}")


def fill_legs(fills: Iterable[Mapping[str, Any]], default_instrument: str) -> list[Leg]:
    """One leg per fill: its instrument (the run's one instrument when the fill names none), session and size."""
    return [Leg(str(row.get("instrument") or default_instrument), session_of(_stamp(row, "ts_epoch_s", "ts")),
                _qty(row, number)) for number, row in enumerate(fills)]


def trade_legs(trades: Iterable[Mapping[str, Any]], instrument: str) -> list[Leg]:
    """Runs without fills: one contract at each trade's entry and one at its exit."""
    legs = []
    for row in trades:
        legs.append(Leg(instrument, session_of(_stamp(row, "entry_ts_epoch_s", "entry_ts")), 1.0))
        legs.append(Leg(instrument, session_of(_stamp(row, "exit_ts_epoch_s", "exit_ts")), 1.0))
    return legs


def contracts_by_session(legs: Sequence[Leg], sources: Mapping[str, VolumeSource]) -> pd.DataFrame:
    """Traded and full-size contracts per (root, session), roots with no volume series left out."""
    rows = []
    for leg in legs:
        source = sources.get(leg.instrument)
        if source is None:
            raise CapacityError(f"no volume source for {leg.instrument!r}")
        if source.root is not None:
            rows.append((source.root, leg.session, leg.qty, leg.qty * source.factor))
    frame = pd.DataFrame(rows, columns=["root", "session", "traded", "contracts"])
    if frame.empty:
        return frame
    return frame.groupby(["root", "session"], as_index=False, sort=True)[["traded", "contracts"]].sum()


def _root_row(root: str, part: pd.DataFrame, volume: pd.Series | None) -> tuple[dict, list[dict]]:
    v = (volume.reindex(part["session"]) if volume is not None else pd.Series(np.nan, index=part["session"]))
    v = v.to_numpy(dtype=float)
    ok = np.isfinite(v) & (v > 0)
    contracts = part["contracts"].to_numpy(dtype=float)
    ratios = contracts[ok] / v[ok]
    sessions = part["session"].to_numpy()[ok]
    top = int(np.argmax(ratios)) if len(ratios) else None
    row = {"root": root, "sessions": len(part), "sessions_with_volume": int(ok.sum()), "void": int((~ok).sum()),
           "contracts_total": float(contracts.sum()), "contracts_mean": float(contracts.mean()),
           "ratio_mean": float(ratios.mean()) if len(ratios) else math.nan,
           "ratio_median": float(np.median(ratios)) if len(ratios) else math.nan,
           "ratio_p95": float(np.quantile(ratios, PERCENTILE)) if len(ratios) else math.nan,
           "ratio_max": float(ratios[top]) if top is not None else math.nan,
           "ratio_max_session": str(sessions[top]) if top is not None else None,
           "volume_median": float(np.median(v[ok])) if ok.any() else math.nan}
    worst = [{"root": root, "session": str(s), "contracts": float(c), "volume": float(x), "ratio": float(q)}
             for s, c, x, q in zip(sessions, contracts[ok], v[ok], ratios)]
    return row, worst


def capacity_table(contracts: pd.DataFrame, volume: Mapping[str, pd.Series], worst: int = WORST) -> dict:
    """EX5 per root and the sessions with the largest ratios; `volume` maps a root to its 1d volume by session."""
    rows, sessions = [], []
    groups = contracts.groupby("root", sort=True) if not contracts.empty else ()
    for root, part in groups:
        row, found = _root_row(str(root), part, volume.get(str(root)))
        rows.append(row)
        sessions.extend(found)
    sessions.sort(key=lambda s: (-s["ratio"], s["session"], s["root"]))
    top = sessions[0] if sessions else None
    return {"rows": rows, "worst": sessions[:worst], "max_ratio": top["ratio"] if top else math.nan,
            "max_root": top["root"] if top else None, "tag": TAG, "label": LABEL}
