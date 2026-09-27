"""Response models for VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised).

Volatility values are fractions per year (0.18 is 18%); `latest_rank` is a percent (0 to 100), the share of the
in-sample windows at or below the latest value, descriptive and never a p-value. Undefined numbers are null.
"""
from __future__ import annotations

from pydantic import Field

from nq_terminal.models.common import ResponseModel
from nq_terminal.models.data import GateInfo


class VolConeRow(ResponseModel):
    """One horizon of the cone: the distribution of the rolling realised volatility over the in-sample history."""

    sessions: int = Field(ge=2)
    n: int = Field(ge=0, description="full windows in the history")
    first_date: str | None
    last_date: str | None
    min: float | None
    p10: float | None
    p25: float | None
    p50: float | None
    p75: float | None
    p90: float | None
    max: float | None
    latest: float | None = Field(description="the window ending on the last in-sample session")
    latest_rank: float | None = Field(description="percent of windows at or below the latest (not a p-value)")


class VolCone(ResponseModel):
    """VCONE for one universe symbol: one row per horizon, to 2021-12-31."""

    symbol: str
    root: str
    sector: str
    as_of: str
    label: str
    basis: str
    unit: str
    percentiles: list[int]
    min_windows: int
    undefined_returns: int = Field(ge=0, description="sessions where 1 + r <= 0 (no log return)")
    horizons: list[VolConeRow]
    gate: GateInfo


class VolConeUniverseRow(ResponseModel):
    symbol: str
    root: str
    sector: str
    stats: VolConeRow


class VolConeUniverse(ResponseModel):
    """VCONE's small multiples: every universe contract's cone statistics at one horizon."""

    sessions: int
    horizons: list[int]
    as_of: str
    label: str
    basis: str
    unit: str
    percentiles: list[int]
    rows: list[VolConeUniverseRow]
    missing: list[str]
    gate: GateInfo
