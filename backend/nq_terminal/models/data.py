"""Response models for the data API: bars, the catalog, the futures universe and the QA reports.

Times on chart axes are integer epoch seconds (`t`); window bounds and file times are ISO 8601 UTC strings.
Undefined numbers (NaN, infinities) are sent as null.
"""
from __future__ import annotations

from typing import Any

from pydantic import ConfigDict, Field

from nq_terminal.models.common import ResponseModel


class GateInfo(ResponseModel):
    """How the prices were served: always caller `terminal` through the OOS gate."""

    caller: str
    served_years: list[int]
    cached: bool
    reads_this_process: int = Field(ge=0)


class RollMarker(ResponseModel):
    model_config = ConfigDict(populate_by_name=True)

    t: int
    from_id: int = Field(serialization_alias="from", validation_alias="from")
    to_id: int = Field(serialization_alias="to", validation_alias="to")
    gap_pts: float | None
    gap_pct: float | None


class SessionFlags(ResponseModel):
    """Sessions `qa.day_gate` rejected (`[GATED]`) and sessions rebuilt from trades (`[REPAIRED]`) in the window,
    as session dates; `assessed` is False for a symbol with no session QA."""

    assessed: bool
    source: str | None
    gated: list[str]
    repaired: list[str]


class Bars(ResponseModel):
    symbol: str
    timeframe: str
    variant: str
    bucket: str
    ts_convention: str
    start: str
    end: str
    label: str
    t: list[int]
    o: list[float | None]
    h: list[float | None]
    l: list[float | None]  # noqa: E741 (the OHLC field name is part of the contract)
    c: list[float | None]
    v: list[float | None]
    rolls: list[RollMarker]
    sessions: SessionFlags
    gate: GateInfo


class CatalogColumn(ResponseModel):
    name: str
    type: str


class CatalogSeries(ResponseModel):
    symbol: str
    root: str
    timeframe: str
    variant: str
    file: str
    size_bytes: int
    modified_utc: str
    rows: int | None
    row_groups: int | None
    columns: list[CatalogColumn]
    first_ts: str | None
    extends_past_fence: bool | None
    error: str | None


class DataCatalog(ResponseModel):
    source: str
    series: list[CatalogSeries]
    unrecognised: list[str]


class UniverseRow(ResponseModel):
    symbol: str
    root: str
    sector: str
    units: str
    tick: float  # the contract's minimum price step, in `units` (nq_lab.dtsmom_universe.TABLE)
    tick_usd: float  # USD value of one tick on one contract
    last_date: str
    last_close: float | None
    last_close_back: float | None
    stale_last: bool
    returns: dict[str, float | None]
    vol_normalised: dict[str, float | None]
    realised_vol: float | None
    corr_to_nq: float | None
    returns_unit: str  # the unit of `returns` (services.market.RETURNS_UNIT)


class Correlation(ResponseModel):
    sessions: int | None
    symbols: list[str]
    order: list[int]
    matrix: list[list[float | None]]


class Universe(ResponseModel):
    as_of: str
    window: int
    label: str
    basis: str
    horizons: list[str]
    horizon_sessions: dict[str, int]
    rows: list[UniverseRow]
    correlation_window: Correlation
    correlation_full: Correlation
    missing: list[str]
    gate: GateInfo


class QaReportInfo(ResponseModel):
    name: str
    size_bytes: int
    modified_utc: str
    history: bool


class QaIndex(ResponseModel):
    reports: list[QaReportInfo]


class PairCorrelationSeries(ResponseModel):
    """Rolling Pearson correlation of two symbols' daily returns (the universe convention), to 2021-12-31."""

    a: str
    b: str
    window: int
    label: str
    basis: str
    t: list[int]
    date: list[str]
    corr: list[float | None]
    gate: GateInfo


class QaReport(ResponseModel):
    """A QA or repair report with every market time, year key and epoch after the fence removed (fenced_out
    counts them); process write times (`*_utc`) are kept."""

    name: str
    modified_utc: str
    fence_end: str
    fenced_out: int = Field(ge=0)
    content: Any
