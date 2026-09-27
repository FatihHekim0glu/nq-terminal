"""ROLL, the roll calendar (UI_SPEC section 5, P1; ANALYTICS MV10, gaps as MV2; TASKS Phase 11).

For each of the 27 futures in the frozen universe (NQ among them), the in-sample rolls of its volume-rolled
continuous series, read from the served 1d frames (`BarService.frame`, so every price comes through the OOS gate
with caller `terminal`). The service reads nothing itself.

- A roll is a change of `instrument_id` between consecutive served bars. `date` is the session of the first bar on
  the new contract and `last_date` the last session on the old one; `from_id` and `to_id` are the vendor's
  instrument ids (nq-lab records no contract code for them, so none is guessed).
- MV2: `gap_pts = offset_t - offset_{t-1}` in the root's served units and `gap_pct = 100 * gap_pts / c_none` of the
  bar before the roll. The values come from `bars.find_rolls`, the same function that places GP's roll markers,
  so the calendar and the chart never disagree.
- Bars at or after the fence (2022-01-01) are dropped before anything is computed (the gate already refuses
  them; this is defence in depth).
- `per_year` counts rolls by the calendar year of `date`; `months` is the calendar strip's axis, every month from
  the first served month to 2021-12.
- QA reference (ANALYTICS MV2): `results/qa_report_universe.json` records `rolls_total` per root from the same
  vendor files; `qa_counts` reads it, and the API shows whether the counts agree.

The MNQ paper book's roll schedule is calendar arithmetic from `nq_lab.mnq_roll` (dates only, no price): the
contract the book holds after today's close (`front_month`), the ones before and after it, each with its expiry
and the date the book rolls out of it. Everything here is descriptive: `LABEL` marks it post hoc.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab import mnq_roll
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import Contract
from nq_terminal.services.bars import find_rolls
from nq_terminal.services.market import LABEL

ROLL_TF, ROLL_VARIANT = "1d", "vendor"
RAW_CLOSE = "c_none"
QA_REPORT = "qa_report_universe.json"
QA_SOURCE = f"results/{QA_REPORT} (candidates.<root>.qa.rolls_total)"
BASIS = ("a roll is a change of instrument_id between consecutive served 1d bars (vendor, volume-rolled); "
         "gap_pts = offset_t - offset_(t-1) in the root's served units; gap_pct = 100 x gap_pts / c_none of the "
         "bar before the roll; 1d files through the OOS gate, sessions to 2021-12-31")
UNIT_NOTE = ("gap in the root's served units (points) and in percent of the unadjusted close before the roll; the "
             "sign is the offset change, old contract less new, so it is negative when the new contract trades above "
             "the old")
PAPER_LABEL = "paper book roll schedule: calendar rule only, no price is read"
PAPER_SOURCE = "nq_lab.mnq_roll"
PAPER_RULE = (f"expiry on the third Friday of March, June, September and December (the business day before when "
              f"that Friday is not one); the book rolls at the close {mnq_roll.ROLL_BUSINESS_DAYS} business days "
              "before expiry, so on a roll day it already holds the new contract")
PAST, HELD, UPCOMING = "past", "held", "upcoming"
MAX_BEHIND, MAX_AHEAD = 8, 40
LAST_MONTH = (IS_END - pd.Timedelta(days=1)).strftime("%Y-%m")


@dataclass(frozen=True)
class RollEvent:
    date: str
    t: int
    last_date: str
    from_id: int
    to_id: int
    close_before: float | None
    gap_pts: float | None
    gap_pct: float | None


@dataclass(frozen=True)
class MarketRolls:
    symbol: str
    root: str
    sector: str
    units: str
    tick: float
    first_date: str | None
    last_date: str | None
    rolls: tuple[RollEvent, ...]
    per_year: dict[str, int]
    mean_abs_gap_pct: float | None
    max_abs_gap_pct: float | None


@dataclass(frozen=True)
class RollCalendarResult:
    as_of: str
    months: tuple[str, ...]
    markets: tuple[MarketRolls, ...]
    missing: tuple[str, ...]


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(x) else None


def in_sample(frame: pd.DataFrame) -> pd.DataFrame:
    """The rows before the fence, in time order (the gate already refuses later ones; defence in depth)."""
    if frame.empty:
        return frame
    ts = pd.to_datetime(frame["ts"], utc=True)
    kept = frame.loc[(ts >= IS_START) & (ts < IS_END)]
    return kept if kept["ts"].is_monotonic_increasing else kept.sort_values("ts")


def _day(ts: Any) -> str:
    return pd.Timestamp(ts).tz_convert("UTC").date().isoformat()


def roll_events(frame: pd.DataFrame) -> tuple[RollEvent, ...]:
    """Every instrument_id change in one served 1d frame, with its MV2 gap (via `bars.find_rolls`)."""
    frame = in_sample(frame).reset_index(drop=True)
    if len(frame) < 2:
        return ()
    ids = frame["instrument_id"].to_numpy(dtype=np.int64)
    positions = (np.flatnonzero(ids[1:] != ids[:-1]) + 1).tolist()
    markers = find_rolls(frame, ROLL_TF)
    raw = frame[RAW_CLOSE].to_numpy(dtype=np.float64)
    ts = frame["ts"]
    return tuple(RollEvent(date=_day(ts.iloc[at]), t=m.t, last_date=_day(ts.iloc[at - 1]), from_id=m.from_id,
                           to_id=m.to_id, close_before=_finite(float(raw[at - 1])), gap_pts=_finite(m.gap_pts),
                           gap_pct=m.gap_pct)
                 for at, m in zip(positions, markers, strict=True))


def market_rolls(frame: pd.DataFrame, contract: Contract) -> MarketRolls:
    kept = in_sample(frame)
    events = roll_events(kept)
    per_year: dict[str, int] = {}
    for event in events:
        per_year[event.date[:4]] = per_year.get(event.date[:4], 0) + 1
    pcts = [abs(e.gap_pct) for e in events if e.gap_pct is not None]
    return MarketRolls(symbol=f"{contract.root}.V.0", root=contract.root, sector=contract.sector,
                       units=contract.units, tick=float(contract.tick),
                       first_date=_day(kept["ts"].iloc[0]) if len(kept) else None,
                       last_date=_day(kept["ts"].iloc[-1]) if len(kept) else None, rolls=events, per_year=per_year,
                       mean_abs_gap_pct=sum(pcts) / len(pcts) if pcts else None,
                       max_abs_gap_pct=max(pcts) if pcts else None)


def month_axis(first: str | None) -> tuple[str, ...]:
    """Every month from `first` (YYYY-MM-DD, or the in-sample start when None) to 2021-12, as YYYY-MM."""
    start = pd.Period((first or IS_START.date().isoformat())[:7], freq="M")
    return tuple(str(p) for p in pd.period_range(start, pd.Period(LAST_MONTH, freq="M"), freq="M"))


def roll_calendar(frames: Mapping[str, pd.DataFrame], contracts: Sequence[Contract]) -> RollCalendarResult:
    """The roll calendar from served 1d frames keyed by symbol (`<ROOT>.V.0`); absent or empty frames are missing."""
    markets, missing = [], []
    for contract in contracts:
        frame = frames.get(f"{contract.root}.V.0")
        if frame is None or in_sample(frame).empty:
            missing.append(f"{contract.root}.V.0")
            continue
        markets.append(market_rolls(frame, contract))
    firsts = [m.first_date for m in markets if m.first_date is not None]
    lasts = [m.last_date for m in markets if m.last_date is not None]
    return RollCalendarResult(as_of=max(lasts) if lasts else (IS_END - pd.Timedelta(days=1)).date().isoformat(),
                              months=month_axis(min(firsts) if firsts else None), markets=tuple(markets),
                              missing=tuple(missing))


def qa_counts(report: Mapping[str, Any] | None, root: str) -> tuple[int | None, dict[str, int] | None]:
    """(rolls_total, rolls_per_year) the universe QA report recorded for `root`, or (None, None)."""
    candidates = report.get("candidates") if isinstance(report, Mapping) else None
    entry = candidates.get(root) if isinstance(candidates, Mapping) else None
    qa = entry.get("qa") if isinstance(entry, Mapping) else None
    if not isinstance(qa, Mapping):
        return None, None
    total, per_year = qa.get("rolls_total"), qa.get("rolls_per_year")
    if not isinstance(total, int) or isinstance(total, bool):
        return None, None
    years = {str(k): int(v) for k, v in per_year.items()} if isinstance(per_year, Mapping) else None
    return total, years


# ---------------------------------------------------------------- the paper book's MNQ schedule


@dataclass(frozen=True)
class PaperRoll:
    contract: str
    expiry: str
    roll_date: str
    into: str
    status: str


@dataclass(frozen=True)
class PaperSchedule:
    today_et: str
    held: str
    next_roll: str
    roll_today: bool
    rows: tuple[PaperRoll, ...]


def _paper_row(contract: mnq_roll.Contract, status: str) -> PaperRoll:
    return PaperRoll(contract=contract.symbol, expiry=mnq_roll.expiry(contract).isoformat(),
                     roll_date=mnq_roll.roll_date(contract).isoformat(), into=contract.next().symbol, status=status)


def paper_schedule(today: dt.date, *, behind: int = 2, ahead: int = 8) -> PaperSchedule:
    """The MNQ contracts around the one the book holds after `today`'s close, oldest first (dates only)."""
    if not 0 <= behind <= MAX_BEHIND or not 1 <= ahead <= MAX_AHEAD:
        raise ValueError(f"behind must be 0 to {MAX_BEHIND} and ahead 1 to {MAX_AHEAD}, got {behind} and {ahead}")
    held = mnq_roll.front_month(today)
    before, c = [], held
    for _ in range(behind):
        c = c.previous()
        before.append(c)
    after, c = [], held
    for _ in range(ahead):
        c = c.next()
        after.append(c)
    rows = ([_paper_row(x, PAST) for x in reversed(before)] + [_paper_row(held, HELD)]
            + [_paper_row(x, UPCOMING) for x in after])
    return PaperSchedule(today_et=today.isoformat(), held=held.symbol,
                         next_roll=mnq_roll.roll_date(held).isoformat(), roll_today=mnq_roll.is_roll_day(today),
                         rows=tuple(rows))
