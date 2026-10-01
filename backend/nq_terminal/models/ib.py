"""Response model of the read-only IB snapshot (ARCHITECTURE s8; PRD U3, DL6 and DL15).

One document carries everything the view shows, in one of four states:

- `ok`: the account summary, positions, working orders (view only) and today's executions, read from a paper TWS or
  IB Gateway on this machine. `incomplete` names a section whose reply did not finish inside the time limit.
- `disabled`: `NQT_IB_READONLY=1` is not set. Nothing was contacted.
- `unavailable`: no TWS or Gateway answered in time (not running, the API switched off, the client id taken).
- `refused`: a guard stopped the read before any request: a host that is not this machine, a live port, or an
  account that is not a paper one (`DU...`).

`read_only` and `order_path` are constants the backend enforces (the client class has no order methods that work),
so the screen can say so. Account ids are masked everywhere (`DU` plus one star per remaining character); the real
id never leaves the process.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel

IbState = Literal["ok", "disabled", "unavailable", "refused"]


class IbSummaryRow(ResponseModel):
    account_masked: str
    tag: str
    value: str  # as TWS sent it (some tags are text, for example AccountType)
    number: float | None  # the value as a number when it is one
    currency: str


class IbPosition(ResponseModel):
    account_masked: str
    symbol: str
    local_symbol: str
    sec_type: str
    exchange: str
    currency: str
    expiry: str
    quantity: float
    average_cost: float | None  # TWS: per contract, in the contract's currency, multiplier included


class IbWorkingRow(ResponseModel):
    """A working order as TWS lists it (every client's), for viewing only."""

    order_id: int
    perm_id: int
    client_id: int
    account_masked: str
    symbol: str
    local_symbol: str
    sec_type: str
    action: str
    order_type: str
    quantity: float | None
    limit_price: float | None
    stop_price: float | None
    tif: str
    status: str
    filled: float | None
    remaining: float | None


class IbExecution(ResponseModel):
    exec_id: str
    time: str  # as TWS sent it (its own date and time zone text)
    account_masked: str
    symbol: str
    local_symbol: str
    sec_type: str
    exchange: str
    side: str
    shares: float | None
    price: float | None
    cumulative_quantity: float | None
    average_price: float | None
    order_id: int
    perm_id: int
    client_id: int


class IbSnapshot(ResponseModel):
    state: IbState
    message: str  # one plain sentence for the screen: why there is nothing, or what was read
    read_only: Literal[True]
    order_path: Literal["none"]
    client_id: int  # the one API client id the terminal uses (never 0, 11, 21, 91 or 93)
    accounts_masked: list[str]
    server_time_utc: str | None  # TWS's own clock, from reqCurrentTime
    fetched_at_utc: str | None  # when this document was read from TWS (None when nothing was read)
    cached: bool
    age_s: float = Field(ge=0)
    cache_seconds: float = Field(ge=0)
    incomplete: list[str]
    truncated: bool
    notes: list[str]  # TWS error texts worth showing, account ids masked
    summary: list[IbSummaryRow]
    positions: list[IbPosition]
    open_orders: list[IbWorkingRow]
    executions: list[IbExecution]
