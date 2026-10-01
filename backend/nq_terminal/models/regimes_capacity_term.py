"""Response models for the P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12;
ANALYTICS_CATALOG sections 9, 10 and 11).

Same conventions as `models/analytics_p1.py`: computed values carry "[POST HOC]", an undefined value is null (never
NaN), `t` is epoch seconds at 00:00 UTC of the session date, and no view shows a p-value (RG2 reports Welch's t on a
fixed split only). Prices come through the gate with caller `terminal`; `gate` says how.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Context, Num, Tag
from nq_terminal.models.common import ResponseModel
from nq_terminal.models.data import GateInfo

TrendName = Literal["above", "below"]

# ---------------------------------------------------------------- RG2


class TrendRegimeRow(ResponseModel):
    regime: TrendName
    n: int = Field(ge=0)
    mean: Num
    sharpe: Num
    hit_rate: Num = Field(description="share of the non-zero sessions above zero")


class TrendRegimeView(ResponseModel):
    """RG2: NQ's back-adjusted close at the session before, above or below its 200-session mean; Welch's t, no
    p-value. `available` is false (with `note`) for a monthly book, which has no daily sessions to split."""

    context: Context
    tag: Tag
    label: str
    basis: str
    source: str
    unit: str
    window: int
    available: bool
    note: str | None
    rows: list[TrendRegimeRow]
    welch_t: Num
    welch_df: Num
    unlabelled: int = Field(ge=0)
    t: list[int]
    date: list[str]
    regime: list[TrendName | None]
    close: list[float | None] = Field(description="NQ's back-adjusted close at the session before each date")
    mean_close: list[float | None] = Field(description="its 200-session mean at the same session")
    gate: GateInfo | None


# ---------------------------------------------------------------- EX5


class CapacityInstrument(ResponseModel):
    """One traded instrument and the continuous series whose volume measures it (null when outside the universe)."""

    instrument: str
    symbol: str | None
    factor: float = Field(description="full-size contracts of `symbol` per traded contract (MNQ: 0.1)")
    note: str | None


class CapacityRow(ResponseModel):
    symbol: str
    sessions: int = Field(ge=0, description="sessions with at least one contract traded")
    sessions_with_volume: int = Field(ge=0)
    void: int = Field(ge=0, description="traded sessions without a volume bar or with volume <= 0")
    contracts_total: float
    contracts_mean: float = Field(description="full-size contracts per traded session")
    ratio_mean: Num
    ratio_median: Num
    ratio_p95: Num
    ratio_max: Num
    ratio_max_date: str | None
    volume_median: Num


class CapacitySession(ResponseModel):
    date: str
    symbol: str
    contracts: float
    volume: float
    ratio: float


class RunCapacity(ResponseModel):
    """EX5: contracts per session over the session's volume, per continuous series, with the largest sessions."""

    run_id: str
    tag: Tag
    label: str
    basis: str
    unit: str
    source: Literal["fills", "trades"]
    instruments: list[CapacityInstrument]
    rows: list[CapacityRow]
    worst: list[CapacitySession]
    max_ratio: Num
    max_symbol: str | None
    gate: GateInfo | None


# ---------------------------------------------------------------- MV6


class TermPoint(ResponseModel):
    rank: int = Field(ge=0)
    contract: str
    expiry: str
    days_to_expiry: int
    close: float
    volume: float
    thin: bool = Field(description="volume under 10 or high not above low (carry_v0's liquidity rule)")


class TermCurve(ResponseModel):
    date: str | None
    points: list[TermPoint]
    missing_ranks: list[int]


class TermVoid(ResponseModel):
    missing_front: int = Field(ge=0)
    missing_next: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    order: int = Field(ge=0)
    thin: int = Field(ge=0)
    price: int = Field(ge=0)


class TermSummary(ResponseModel):
    n: int = Field(ge=0)
    mean: Num
    median: Num
    min: Num
    max: Num
    share_backwardation: Num
    last: Num
    last_date: str | None


class TermStructure(ResponseModel):
    """MV6: the front (C.0) to next (C.1) spread per session, annualised by the days between the pinned CME expiries,
    and the latest curve over every chain rank."""

    root: str
    symbol: str
    sector: str
    units: str
    tag: Tag
    label: str
    basis: str
    unit: str
    expiry_source: str
    ranks: list[int]
    sessions: int = Field(ge=0)
    fenced: int = Field(ge=0)
    void: TermVoid
    summary: TermSummary
    t: list[int]
    date: list[str]
    front: list[str]
    next: list[str]
    f1: list[float]
    f2: list[float]
    expiry_front: list[str]
    expiry_next: list[str]
    spread: list[float]
    carry: list[float]
    curve: TermCurve
    gate: GateInfo
