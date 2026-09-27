"""Response models for ROLL, the roll calendar (TASKS Phase 11; ANALYTICS MV10, gaps as MV2), and the MNQ paper book's roll
schedule. Dates are ISO `YYYY-MM-DD` session dates; `t` is the epoch second of the first bar on the new contract
(the `/api/bars` roll marker's `t`). Undefined numbers are sent as null.
"""
from __future__ import annotations

from pydantic import ConfigDict, Field

from nq_terminal.models.common import ResponseModel
from nq_terminal.models.data import GateInfo


class RollEvent(ResponseModel):
    """One instrument_id change: `from` and `to` are the vendor's instrument ids."""

    model_config = ConfigDict(populate_by_name=True)

    date: str
    t: int
    last_date: str
    from_id: int = Field(serialization_alias="from", validation_alias="from")
    to_id: int = Field(serialization_alias="to", validation_alias="to")
    close_before: float | None
    gap_pts: float | None
    gap_pct: float | None


class MarketRolls(ResponseModel):
    """One market's in-sample rolls; `qa_rolls_total` is the universe QA report's count (null when the report or
    the root is absent) and `qa_match` whether it equals `count`."""

    symbol: str
    root: str
    sector: str
    units: str
    tick: float
    first_date: str | None
    last_date: str | None
    rolls: list[RollEvent]
    per_year: dict[str, int]
    count: int = Field(ge=0)
    mean_abs_gap_pct: float | None
    max_abs_gap_pct: float | None
    qa_rolls_total: int | None
    qa_match: bool | None


class RollCalendar(ResponseModel):
    as_of: str
    label: str
    basis: str
    unit_note: str
    months: list[str]
    markets: list[MarketRolls]
    missing: list[str]
    qa_source: str
    gate: GateInfo


class PaperRoll(ResponseModel):
    """One MNQ contract: its expiry, the date the book rolls out of it (at that session's close) and into what."""

    contract: str
    expiry: str
    roll_date: str
    into: str
    status: str = Field(description="past, held (after today's close) or upcoming")


class PaperRollSchedule(ResponseModel):
    label: str
    rule: str
    source: str
    today_et: str
    held: str
    next_roll: str
    roll_today: bool
    rows: list[PaperRoll]
