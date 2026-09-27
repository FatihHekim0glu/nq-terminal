"""Response models for the DQ screen (ANALYTICS RI4 data quality calendar, RI5 guard fingerprint status).

No value here is a price. Every day state comes from a QA or repair file under `results/`; every fingerprint is the
sha256 `nq_lab.guards.fingerprint` computes, set against the lab's own record of it.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel

DayState = Literal["vendor", "gated_out", "rejected", "rebuilt", "unrepairable"]
GuardStatus = Literal["OK", "MISMATCH", "NO RECORD"]


class DqCounts(ResponseModel):
    vendor: int = Field(ge=0)
    gated_out: int = Field(ge=0)
    rejected: int = Field(ge=0)
    rebuilt: int = Field(ge=0)
    unrepairable: int = Field(ge=0)
    sessions: int = Field(ge=0)


class DqSymbol(ResponseModel):
    symbol: str
    root: str
    source: str = Field(description="the files the day states come from, relative to the project root")
    repair: str = Field(description="nq, v1 or v2: which repair record applies")
    status: str = Field(description="repaired, not_repaired, or not_assessed (no repair record)")
    why_not_repaired: str | None
    counts: DqCounts
    first: str | None
    last: str | None


class DqIndex(ResponseModel):
    label: str
    fence: str
    symbols: list[DqSymbol]
    missing: list[str] = Field(description="expected files that could not be read")


class DqDay(ResponseModel):
    date: str
    state: DayState
    reason: str | None


class DqQaYear(ResponseModel):
    year: int
    rows: int | None
    ohlc_violations: int | None
    duplicate_ts: int | None
    contract_changes: int | None
    rth_days_with_gaps: int | None


class DqCalendar(ResponseModel):
    label: str
    fence: str
    symbol: DqSymbol
    days: list[DqDay]
    qa_source: str | None
    qa_years: list[DqQaYear]


class GuardGroup(ResponseModel):
    name: str
    keys: int = Field(ge=0)
    live_sha256: str
    recorded_sha256: str | None
    record: str = Field(description="where the recorded fingerprint lives")
    status: GuardStatus
    changed_keys: list[str] = Field(description="keys whose live value differs from the recorded values, where "
                                                "the record keeps the values")


class GuardStatusReport(ResponseModel):
    label: str
    groups: list[GuardGroup]
    ok: int = Field(ge=0)
    mismatch: int = Field(ge=0)
    no_record: int = Field(ge=0)
