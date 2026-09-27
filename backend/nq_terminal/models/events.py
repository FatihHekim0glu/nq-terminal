"""Response models for the event study (EVT, ANALYTICS MV8, descriptive, [POST HOC]).

Offsets are integers: NYSE sessions (daily) or minutes (intraday) from the event. Paths are fractions (0.01 is 1%);
undefined numbers are sent as null. No p-value or test statistic is part of any model: the event lists are fixed in
the project's files, but the instrument, event type and window are picked on screen.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel
from nq_terminal.models.data import GateInfo


class EventCalendarEntry(ResponseModel):
    """One announcement date and its releases (type and US Eastern time)."""

    date: str
    types: list[str]
    times_et: list[str]


class EventCalendar(ResponseModel):
    """The fixed event lists the study reads (no price is read here) and the instruments it accepts."""

    label: str
    source: str
    spec_sha256: str
    fomc_check: str
    types: list[str]
    counts: dict[str, int]
    excluded: list[str]
    events: list[EventCalendarEntry]
    daily_symbols: list[str]
    intraday_symbols: list[str]
    daily_default: list[int] = Field(min_length=2, max_length=2)
    intraday_default: list[int] = Field(min_length=2, max_length=2)


class EventRow(ResponseModel):
    """One event: its release, whether its window was complete, and its own path (empty when void)."""

    n: int = Field(ge=1)
    date: str
    types: list[str]
    time_et: str
    t0_utc: str | None
    used: bool
    reason: str | None
    first: float | None
    end: float | None
    path: list[float | None]


class EndStats(ResponseModel):
    """The cross-event distribution of the path at the last offset (descriptive, no test)."""

    n: int = Field(ge=0)
    mean: float | None
    median: float | None
    sd: float | None
    se: float | None
    share_positive: float | None


class EventStudy(ResponseModel):
    """Mean cumulative return path around the chosen events, its cross-event band and every event's row."""

    symbol: str
    event_type: str
    mode: Literal["daily", "intraday"]
    variant: str
    timeframe: str
    label: str
    basis: str
    band_note: str
    source: str
    unit: str
    offset_unit: Literal["session", "minute"]
    pre: int = Field(ge=1)
    post: int = Field(ge=1)
    offsets: list[int]
    mean: list[float | None]
    se: list[float | None]
    lower: list[float | None]
    upper: list[float | None]
    band_z: float
    band_level: float
    n_listed: int = Field(ge=0)
    n_used: int = Field(ge=0)
    n_void: int = Field(ge=0)
    end: EndStats
    events: list[EventRow]
    gate: GateInfo
