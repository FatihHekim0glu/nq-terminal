"""Response models for the read-only live endpoints (ARCHITECTURE s4 "Live", s7; ANALYTICS_CATALOG LV1 to LV4).

The status carries `read_only`, `order_path` ("none") and `tws` ("not monitored", DL15) so the UI shows the same
facts the backend enforces. Journal rows keep the book's own fields under `data` (sanitised: NaN to null, ns ints
to ISO plus `*_epoch_s`); the terminal's fields (`file`, `line_no`, `plumbing`, `banner`) sit beside it, so a
journal key can never collide with them.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

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


class LiveRouteRow(ResponseModel):
    """One close row as a route (`services.live_routes`): the decision's status and the row's own fills."""

    file: str
    line_no: int = Field(ge=1)
    plumbing: bool
    banner: str | None
    date: str | None
    t: int | None = Field(description="epoch seconds at 00:00 UTC of the session date")
    contract: str | None
    status: Literal["sent", "blocked", "refused", "not sent", "error"]
    reason: str | None
    target: float | None
    sent_target: float | None
    decision_px: float | None = Field(description="the decision's sizing price `p`")
    close_px: float | None
    side: Literal["BUY", "SELL"] | None = Field(description="side of the net filled quantity")
    filled_qty: int | None
    net_filled: int | None
    avg_fill_px: float | None
    slippage_ticks: float | None
    reconciled_ok: bool | None
    halted: bool | None


class LiveFillRow(ResponseModel):
    file: str
    line_no: int = Field(ge=1)
    plumbing: bool
    banner: str | None
    date: str | None
    t: int | None
    contract: str
    side: Literal["BUY", "SELL"]
    qty: int = Field(ge=1)
    price: float
    notional_usd: float | None = Field(description="qty x price x the MNQ point value; null for another contract")


class RoutesSummary(ResponseModel):
    """Totals over performance rows only; plumbing routes and fills are counted apart."""

    routes: int = Field(ge=0)
    sent: int = Field(ge=0)
    blocked: int = Field(ge=0)
    refused: int = Field(ge=0)
    errors: int = Field(ge=0)
    fills: int = Field(ge=0)
    filled_contracts: int = Field(ge=0)
    notional_usd: float | None
    plumbing_routes: int = Field(ge=0)
    plumbing_fills: int = Field(ge=0)
    bad_fills: int = Field(ge=0, description="fill entries skipped because they were not [contract, sign, qty, price]")


class LiveRoutes(ResponseModel):
    """LIVE's Routes and Fills from one journal, read only (there is no order path)."""

    journal: str
    present: bool
    empty_state: str | None
    banner: str
    basis: str
    order_time_rule: str
    point_value_usd: float
    routes: list[LiveRouteRow]
    fills: list[LiveFillRow]
    summary: RoutesSummary


# ---------------------------------------------------------------- the live stream (TASKS 9.2, GET /api/live/stream)
# Each SSE event's `event:` name equals its payload's `kind`, and its `id:` is the stream cursor after it (the
# browser sends it back as `Last-Event-ID`). The stream carries no performance figure of its own: rows are
# labelled, and the one status payload is LiveStatus, built on the performance path.

STREAM_SCHEMA_VERSION = 1
ResetReason = Literal["sync", "new", "changed", "backlog", "removed"]


class StreamHello(ResponseModel):
    """First event of every connection: how the stream will behave and whether it resumed a cursor."""

    kind: Literal["hello"] = "hello"
    schema_version: int
    resumed: bool
    resume_note: str | None = Field(description="why a Last-Event-ID was not used, else null")
    poll_s: float
    heartbeat_s: float
    lifetime_s: float = Field(description="the server ends the stream after this long; the browser reconnects")
    retry_ms: int = Field(ge=0)
    banner: str
    basis: str
    read_only: bool
    order_path: str


class StreamStatus(ResponseModel):
    """The same body as GET /api/live/status, sent on connect and whenever it changes."""

    kind: Literal["status"] = "status"
    status: LiveStatus


class StreamKillSwitch(ResponseModel):
    kind: Literal["kill_switch"] = "kill_switch"
    on: bool
    path: str


class StreamJournalReset(ResponseModel):
    """Drop what is held for `file`; the rows that follow start at `first_line_no`.

    sync: the journal as it stands on a fresh connection; new: a journal first seen now; changed: the file no longer
    holds the rows already sent (truncated or replaced); backlog: more rows were waiting than the stream sends in one
    go, so the oldest were skipped (read them from /api/live/journal); removed: the file is gone.
    """

    kind: Literal["journal_reset"] = "journal_reset"
    file: str
    path: str
    reason: ResetReason
    skipped_rows: int = Field(ge=0, description="rows before first_line_no that the stream does not send")
    first_line_no: int | None


class StreamJournalRow(ResponseModel):
    kind: Literal["journal_row"] = "journal_row"
    row: JournalRowOut


class StreamHeartbeat(ResponseModel):
    kind: Literal["heartbeat"] = "heartbeat"
    utc: str
    interval_s: float


class StreamBye(ResponseModel):
    """Last event before the server ends the stream (lifetime reached); reconnect with Last-Event-ID."""

    kind: Literal["bye"] = "bye"
    reason: str
    retry_ms: int = Field(ge=0)


LiveStreamEvent = Annotated[
    StreamHello | StreamStatus | StreamKillSwitch | StreamJournalReset | StreamJournalRow | StreamHeartbeat
    | StreamBye,
    Field(discriminator="kind"),
]
