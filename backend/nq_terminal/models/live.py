"""Response models for the read-only live endpoints (ARCHITECTURE s4 "Live", s7; ANALYTICS_CATALOG LV1 to LV4).

The status carries `read_only`, `order_path` ("none") and `tws` ("not monitored", DL15) so the UI shows the same
facts the backend enforces. Journal rows keep the book's own fields under `data` (sanitised: NaN to null, ns ints
to ISO plus `*_epoch_s`); the terminal's fields (`file`, `line_no`, `plumbing`, `banner`) sit beside it, so a
journal key can never collide with them.
"""
from __future__ import annotations

from typing import Any

from pydantic import Field

from nq_terminal.models.common import ResponseModel


class JournalInfo(ResponseModel):
    name: str
    path: str
    rows: int = Field(ge=0)
    plumbing_rows: int = Field(ge=0)
    performance_rows: int = Field(ge=0)
    plumbing: bool  # every row is plumbing (and there is at least one)
    bad_lines: int = Field(ge=0)
    partial_line_pending: bool
    last_type: str | None
    last_date: str | None
    last_row_utc: str | None  # the file's modification time: when the last row was written
    last_halted: bool | None


class ExpectedJournal(ResponseModel):
    name: str
    path: str
    present: bool
    empty_state: str | None


class ExposureSummary(ResponseModel):
    """`paper_plumbing.exposure_summary` of the book journal: plumbing rows excluded and counted."""

    journal: str
    sessions: int = Field(ge=0)
    mean_exposure: float | None
    plumbing_rows_skipped: int = Field(ge=0)


class LiveEnv(ResponseModel):
    ib_host: str | None
    ib_port: int | None
    account_masked: str | None
    delayed_flag_set: bool
    volman_c_set: bool
    base_usd_rate_set: bool


class NextTimes(ResponseModel):
    decision_et: str
    order_et: str
    contract: str
    roll_date: str
    today_et: str


class LogFileInfo(ResponseModel):
    """One Nautilus log under live/logs: the `file` value `/api/live/log` accepts."""

    name: str
    path: str
    size_bytes: int = Field(ge=0)
    modified_utc: str | None
    plumbing: bool


class LastClose(ResponseModel):
    """The book journal's latest performance close row (plumbing rows dropped, LV1).

    The typed fields are read as in `Performance`: `expected` and `actual` are the total contracts held across the
    position maps, numbers are finite or null, and a field of an odd type is null. A close that failed its
    reconciliation records only `date`, `contract`, `error` and `halted`. `data` is the whole row, sanitised (NaN to
    null), for the fields the card does not type (fills, prices by contract, sizing inputs).
    """

    date: str | None
    contract: str | None
    target: float | None
    expected: float | None
    actual: float | None
    reconciled_ok: bool | None
    exposure: float | None
    slippage_ticks: float | None
    close_px: float | None
    sent: bool | None
    refused: str | None
    blocked: str | None
    error: str | None
    halted: bool | None
    data: dict[str, Any]


class LiveStatus(ResponseModel):
    journals: list[JournalInfo]
    logs: list[LogFileInfo]
    expected: list[ExpectedJournal]
    kill_switch_on: bool
    kill_switch_path: str
    exposure_summary: ExposureSummary | None
    last_close: LastClose | None
    halted: bool | None = Field(description="the book journal's latest performance close row; per-journal flags "
                                            "are in journals[].last_halted")
    env: LiveEnv
    next: NextTimes
    banner: str
    read_only: bool
    order_path: str
    tws: str


class JournalRowOut(ResponseModel):
    file: str
    line_no: int = Field(ge=1)
    plumbing: bool
    banner: str | None  # the exact plumbing BANNER on plumbing rows, else None
    data: dict[str, Any]


class LogLineOut(ResponseModel):
    line_no: int = Field(ge=1)
    ts: str | None
    ts_epoch_s: int | None
    level: str | None
    trader: str | None
    component: str | None
    message: str


class LogTail(ResponseModel):
    file: str
    path: str
    total_lines: int = Field(ge=0)
    lines: list[LogLineOut]
    note: str


class Performance(ResponseModel):
    """Target against actual over the book journal's performance rows only (plumbing rows dropped, LV1, LV2)."""

    journal: str
    present: bool
    empty_state: str | None
    basis: str
    banner: str
    plumbing_rows_skipped: int = Field(ge=0)
    t: list[int | None] = Field(description="epoch seconds at 00:00 UTC of each row's session date (chart axis)")
    line_no: list[int] = Field(description="the journal line of each close row, to match it to /api/live/journal")
    date: list[str | None]
    contract: list[str | None]
    target: list[float | None]
    expected: list[float | None]
    actual: list[float | None]
    reconciled_ok: list[bool | None]
    exposure: list[float | None]
    slippage_ticks: list[float | None]
    sent: list[bool | None]
    refused: list[str | None]
    error: list[str | None]
    halted: list[bool | None]
