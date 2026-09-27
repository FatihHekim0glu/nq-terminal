"""Response model for SEAS, seasonality (TASKS Phase 11). Descriptive and [POST HOC]: no field carries a test
statistic or a p-value. Undefined numbers are sent as null; dates are YYYY-MM-DD session dates."""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel
from nq_terminal.models.data import GateInfo

PanelId = Literal["month", "weekday", "week_of_month", "intraday"]


class SeasonBucket(ResponseModel):
    """One calendar group: n values, their mean, one standard error of the mean and the share above zero."""

    key: int
    label: str
    n: int = Field(ge=0)
    mean: float | None
    se: float | None
    hit_rate: float | None = Field(ge=0, le=1)


class SeasonPanel(ResponseModel):
    """One grouping. `observation` says what one value is (a month, a session, a 30-minute bucket of a session).
    An unavailable panel has no buckets and a note saying why."""

    id: PanelId
    observation: str
    available: bool
    note: str | None
    buckets: list[SeasonBucket]
    excluded_sessions: int | None = Field(ge=0)
    source: str | None


class SeasonHeatmap(ResponseModel):
    """Monthly values, years down and months across; `sessions` counts the returns behind each cell."""

    years: list[int]
    months: list[str]
    values: list[list[float | None]]
    sessions: list[list[int]]


class Seasonality(ResponseModel):
    subject: str
    kind: Literal["instrument", "hypothesis"]
    label: str
    basis: str
    unit: str
    fraction: bool
    aggregation: Literal["compound", "sum"]
    error_bar: str
    first: str | None
    last: str | None
    sessions: int = Field(ge=0)
    start_year: int
    end_year: int
    variant: str | None
    cost: int | None
    panels: list[SeasonPanel]
    heatmap: SeasonHeatmap
    gate: GateInfo | None
