"""Response model for `GET /api/instruments/{root}`: the instrument DES tabs (the look spec, section 7.3).

Every value names where it comes from (`source`); a fact nq-lab does not record (a listing cycle for most roots,
trading hours) is null, never filled in by the terminal. No value here is a price.
"""
from __future__ import annotations

from pydantic import Field

from nq_terminal.models.common import Fence, ResponseModel


class ContractSpec(ResponseModel):
    root: str
    symbol: str
    sector: str
    venue: str
    units: str = Field(description="the served price's units")
    tick: float
    tick_usd: float
    point_value_usd: float = Field(description="USD per 1.0 of the served price, one contract")
    cost_per_side_1tick_usd: float = Field(description="one tick plus the frozen fee per side")
    source: str


class MonthCode(ResponseModel):
    month: int = Field(ge=1, le=12)
    name: str
    code: str
    active: bool | None = Field(description="in the recorded listing cycle; null where nq-lab records none")


class NamedValue(ResponseModel):
    label: str
    value: str
    source: str


class RelatedDates(ResponseModel):
    last_trading_rule: str | None = Field(description="the rule id in nq_lab.carry_expiry.RULES")
    first_notice_rule: str | None
    roll_rule: str | None = Field(description="the paper book's MNQ roll rule (NQ and MNQ only)")
    next_contract: str | None
    next_roll: str | None
    as_of_et: str | None
    source: str


class CoverageSeries(ResponseModel):
    root: str
    timeframe: str
    variant: str
    file: str
    rows: int | None
    first_ts: str | None
    extends_past_fence: bool | None = Field(description="the file holds rows after the fence (the gate refuses them)")
    error: str | None


class Coverage(ResponseModel):
    fence: Fence
    in_sample_from: str | None = Field(description="the later of the fence start and the first bar on file")
    in_sample_to: str = Field(description="the last in-sample day")
    series: list[CoverageSeries] = Field(description="processed series of this root, from parquet footers only")
    gate_reads_logged: int = Field(ge=0, description="lines in the OOS log with caller terminal for this symbol")
    gate_reads_this_process: int = Field(ge=0)


class InstrumentNote(ResponseModel):
    title: str
    text: str
    source: str


class InstrumentDes(ResponseModel):
    root: str
    symbol: str
    in_universe: bool = Field(description="one of the 27 futures of the frozen dtsmom table")
    contract: ContractSpec | None
    month_codes: list[MonthCode]
    cycle_source: str | None
    hours: list[NamedValue]
    hours_note: str
    related: RelatedDates
    coverage: Coverage
    notes: list[InstrumentNote]
    label: str
