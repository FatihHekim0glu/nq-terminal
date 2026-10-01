"""The terminal's one IB client: read-only by construction (ARCHITECTURE s8 and s9; PRD U3, DL6).

This is the only module under `terminal/` that imports the IB library (the safety scan sanctions this path and no
other). It reads an account summary, positions, working orders (view only) and the day's executions, and nothing
else. Four layers keep it from ever sending an order, none of them a TWS setting (TWS "Read-Only API" would also block
the paper book's own orders, so it cannot be the control):

1. The class overrides every order-style call the library has (six names and their six `ProtoBuf` twins, all on the
   safety scan's ban list; the tests derive the set from the library) to raise `OrderPathError`, whatever the
   arguments.
2. `sendMsg` and `sendMsgProtoBuf`, the two doors every outgoing frame goes through, refuse any message id that is
   not on `ALLOWED_REQUEST_IDS` (start, current time, account summary and its cancel, positions and its cancel, all
   open orders, executions).
3. The API client id is fixed at 95 and `check_client_id` refuses 0 (which would bind to the book's own orders) and
   every id another process uses (11, 21, 91, 93).
4. Before any request is sent, every account TWS reports must pass the caller's check (the service passes
   `live_guards.check_account`: paper `DU...` only); one that fails ends the read at once.

`fetch_raw` does one read: connect, wait for the account list, check it, send the requests, wait for the five replies
(each with its own end marker), cancel the two subscriptions, disconnect. Every wait has a deadline; a TWS that is not
there, or is there but silent, ends as `IbUnavailable` and never leaves a thread or socket behind.
"""
from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from ibapi.client import EClient
from ibapi.common import PROTOBUF_MSG_ID
from ibapi.execution import ExecutionFilter
from ibapi.message import OUT
from ibapi.wrapper import EWrapper

from nq_lab.live_guards import LiveGuardError

CLIENT_ID = 95
RESERVED_CLIENT_IDS = frozenset({0, 11, 21, 91, 93})  # 0 binds to the book's orders; the rest belong to other processes
ALLOWED_REQUEST_IDS = frozenset({
    OUT.START_API, OUT.REQ_CURRENT_TIME, OUT.REQ_ACCOUNT_SUMMARY, OUT.CANCEL_ACCOUNT_SUMMARY, OUT.REQ_POSITIONS,
    OUT.CANCEL_POSITIONS, OUT.REQ_ALL_OPEN_ORDERS, OUT.REQ_EXECUTIONS,
})
SUMMARY_TAGS = ("NetLiquidation,TotalCashValue,BuyingPower,AvailableFunds,ExcessLiquidity,GrossPositionValue,"
                "InitMarginReq,MaintMarginReq,Cushion,Leverage,AccountType")
SUMMARY_GROUP = "All"
SUMMARY_REQ_ID, EXECUTIONS_REQ_ID = 9001, 9002
MAX_ROWS = 1000  # per section; more is dropped and `truncated` is set
MAX_NOTES = 10
NOTE_CHARS = 160
UNSET_LIMIT = 1e30  # the library's "unset" doubles and decimals are far above any real value
INFO_CODE_RANGE = range(2100, 2200)  # data farm and similar notices: information, not problems
CLIENT_ID_IN_USE, NOT_RUNNING, NOT_CONNECTED = 326, 502, 504
FATAL_CODES = frozenset({CLIENT_ID_IN_USE, NOT_RUNNING, NOT_CONNECTED})
SECTIONS = ("summary", "positions", "open_orders", "executions")
JOIN_SECONDS = 1.5
NO_ORDERS = "this client is read-only: it has no order path"


class OrderPathError(RuntimeError):
    """Raised by every order-style call and by the sending guard: the terminal never trades."""


class IbUnavailable(RuntimeError):
    """No usable TWS or Gateway answered: not running, API off, client id taken, silent, or too slow."""


@dataclass(frozen=True)
class Timeouts:
    connect_s: float = 4.0  # to the end of the handshake and the account list
    reply_s: float = 5.0  # from the requests to the last end marker


@dataclass(frozen=True)
class RawSnapshot:
    accounts: tuple[str, ...]
    summary: tuple[dict[str, Any], ...]
    positions: tuple[dict[str, Any], ...]
    open_orders: tuple[dict[str, Any], ...]
    executions: tuple[dict[str, Any], ...]
    server_time_epoch_s: int | None
    incomplete: tuple[str, ...]
    truncated: bool
    notes: tuple[str, ...]


def check_client_id(client_id: object) -> int:
    if isinstance(client_id, bool) or not isinstance(client_id, int) or client_id < 0:
        raise ValueError(f"the API client id must be a whole number, got {client_id!r}")
    if client_id in RESERVED_CLIENT_IDS:
        raise ValueError(f"API client id {client_id} is reserved "
                         "(0, 11, 21, 91 and 93 belong to the book or other tools)")
    return client_id


def check_outgoing(message_id: int) -> None:
    """Refuse any outgoing message id that is not a read-only request (a protobuf id is the base id plus 200)."""
    base = message_id - PROTOBUF_MSG_ID if message_id > PROTOBUF_MSG_ID else message_id
    if base not in ALLOWED_REQUEST_IDS:
        raise OrderPathError(f"outgoing message {base} is not on the read-only list")


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, ArithmeticError):
        return None
    return number if math.isfinite(number) and abs(number) < UNSET_LIMIT else None


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _contract_fields(contract: Any) -> dict[str, Any]:
    return {
        "symbol": _text(contract.symbol), "local_symbol": _text(contract.localSymbol),
        "sec_type": _text(contract.secType), "exchange": _text(contract.exchange),
        "currency": _text(contract.currency), "expiry": _text(contract.lastTradeDateOrContractMonth),
    }


class ReadOnlyClient(EWrapper, EClient):
    """Collects one read's replies; every order-style method raises, every outgoing frame is checked."""

    def __init__(self) -> None:
        EClient.__init__(self, self)
        self._cond = threading.Condition()
        self.accounts: tuple[str, ...] | None = None
        self.acknowledged = False
        self.closed = False
        self.fatal: tuple[int, str] | None = None
        self.server_time: int | None = None
        self.ended: set[str] = set()
        self.truncated = False
        self.notes: list[str] = []
        self._summary: list[dict[str, Any]] = []
        self._positions: list[dict[str, Any]] = []
        self._orders: dict[int, dict[str, Any]] = {}
        self._executions: list[dict[str, Any]] = []
        self.loop_error: str | None = None

    # ---- the order path does not exist ----
    def placeOrder(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def cancelOrder(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqGlobalCancel(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def exerciseOptions(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqAutoOpenOrders(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqOpenOrders(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    # the library's protobuf twin of each call above (it frames and sends the order on its own)
    def placeOrderProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def cancelOrderProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqGlobalCancelProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def exerciseOptionsProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqAutoOpenOrdersProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    def reqOpenOrdersProtoBuf(self, *args: Any, **kwargs: Any) -> None:
        raise OrderPathError(NO_ORDERS)

    # ---- every outgoing frame goes through one of these two ----
    def sendMsg(self, msgId: int, msg: str) -> None:
        check_outgoing(msgId)
        return super().sendMsg(msgId, msg)

    def sendMsgProtoBuf(self, msgId: int, msg: bytes) -> None:
        check_outgoing(msgId)
        return super().sendMsgProtoBuf(msgId, msg)

    # ---- connection events ----
    def connectAck(self) -> None:
        with self._cond:
            self.acknowledged = True
            self._cond.notify_all()

    def connectionClosed(self) -> None:
        with self._cond:
            self.closed = True
            self._cond.notify_all()

    def nextValidId(self, orderId: int) -> None:
        with self._cond:
            self._cond.notify_all()

    def managedAccounts(self, accountsList: str) -> None:
        with self._cond:
            self.accounts = tuple(a.strip() for a in accountsList.split(",") if a.strip())
            self._cond.notify_all()

    def currentTime(self, time: int) -> None:
        with self._cond:
            self.server_time = int(time)
            self.ended.add("time")
            self._cond.notify_all()

    def error(self, reqId: int, *args: Any) -> None:
        # ibapi 10.45: (reqId, errorTime, errorCode, errorString, advancedOrderRejectJson); older: (reqId, code, text)
        code, text = (args[1], args[2]) if len(args) >= 3 else (args[0], args[1])
        code = int(code)
        with self._cond:
            if code in FATAL_CODES and self.fatal is None:
                self.fatal = (code, str(text)[:NOTE_CHARS])
            elif code not in FATAL_CODES and code not in INFO_CODE_RANGE and len(self.notes) < MAX_NOTES:
                self.notes.append(f"{code}: {str(text)[:NOTE_CHARS]}")
            self._cond.notify_all()

    # ---- the four sections ----
    def _add(self, rows: list[dict[str, Any]], row: dict[str, Any]) -> None:
        if len(rows) >= MAX_ROWS:
            self.truncated = True
        else:
            rows.append(row)

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:
        with self._cond:
            self._add(self._summary, {"account": account, "tag": tag, "value": value, "currency": currency})

    def accountSummaryEnd(self, reqId: int) -> None:
        self._end("summary")

    def position(self, account: str, contract: Any, position: Any, avgCost: float) -> None:
        row = {"account": account, **_contract_fields(contract), "quantity": _number(position),
               "average_cost": _number(avgCost)}
        with self._cond:
            self._add(self._positions, row)

    def positionEnd(self) -> None:
        self._end("positions")

    def openOrder(self, orderId: int, contract: Any, order: Any, orderState: Any) -> None:
        quantity, filled = _number(order.totalQuantity), _number(order.filledQuantity)
        row = {
            "order_id": int(orderId), "perm_id": int(order.permId or 0), "client_id": int(order.clientId or 0),
            "account": _text(order.account), **_contract_fields(contract), "action": _text(order.action),
            "order_type": _text(order.orderType), "quantity": quantity, "limit_price": _number(order.lmtPrice),
            "stop_price": _number(order.auxPrice), "tif": _text(order.tif), "status": _text(orderState.status),
            "filled": filled, "remaining": None if quantity is None or filled is None else max(quantity - filled, 0.0),
        }
        key = row["perm_id"] or row["order_id"]
        with self._cond:
            if key in self._orders or len(self._orders) < MAX_ROWS:
                self._orders[key] = {**self._orders.get(key, {}), **row}
            else:
                self.truncated = True

    def orderStatus(self, orderId: int, status: str, filled: Any, remaining: Any, *rest: Any) -> None:
        perm_id = int(rest[1]) if len(rest) > 1 and rest[1] else 0
        with self._cond:
            row = self._orders.get(perm_id or int(orderId))
            if row is not None:
                row.update({"status": _text(status), "filled": _number(filled), "remaining": _number(remaining)})

    def openOrderEnd(self) -> None:
        self._end("open_orders")

    def execDetails(self, reqId: int, contract: Any, execution: Any) -> None:
        row = {
            "exec_id": _text(execution.execId), "time": _text(execution.time), "account": _text(execution.acctNumber),
            **{k: v for k, v in _contract_fields(contract).items() if k != "expiry"},
            "exchange": _text(execution.exchange) or _text(contract.exchange), "side": _text(execution.side),
            "shares": _number(execution.shares), "price": _number(execution.price),
            "cumulative_quantity": _number(execution.cumQty), "average_price": _number(execution.avgPrice),
            "order_id": int(execution.orderId or 0), "perm_id": int(execution.permId or 0),
            "client_id": int(execution.clientId or 0),
        }
        with self._cond:
            self._add(self._executions, row)

    def execDetailsEnd(self, reqId: int) -> None:
        self._end("executions")

    def _end(self, section: str) -> None:
        with self._cond:
            self.ended.add(section)
            self._cond.notify_all()

    # ---- the session thread ----
    def serve(self, host: str, port: int, client_id: int) -> None:
        """Connect and run the message loop; meant for a worker thread. Any failure is recorded, never raised."""
        try:
            self.connect(host, port, client_id)
            if self.isConnected():
                self.run()
        except Exception as exc:  # the socket is closed from the other thread on a deadline; that lands here
            with self._cond:
                self.loop_error = type(exc).__name__
        finally:
            with self._cond:
                self.closed = True
                self._cond.notify_all()

    def wait_for(self, predicate: Callable[[], bool], deadline: float) -> bool:
        """Block until `predicate` (read under the lock) holds, a fatal error comes, the link closes or time is up."""
        with self._cond:
            while not (predicate() or self.fatal is not None or self.closed):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._cond.wait(timeout=min(remaining, 0.25))
            return predicate()

    def request_reads(self) -> None:
        self.reqCurrentTime()
        self.reqAccountSummary(SUMMARY_REQ_ID, SUMMARY_GROUP, SUMMARY_TAGS)
        self.reqPositions()
        self.reqAllOpenOrders()
        self.reqExecutions(EXECUTIONS_REQ_ID, ExecutionFilter())

    def cancel_subscriptions(self) -> None:
        self.cancelAccountSummary(SUMMARY_REQ_ID)
        self.cancelPositions()

    def collected(self) -> tuple[tuple, tuple, tuple, tuple, tuple[str, ...], tuple[str, ...]]:
        with self._cond:
            missing = tuple(s for s in SECTIONS if s not in self.ended)
            return (tuple(self._summary), tuple(self._positions), tuple(self._orders.values()),
                    tuple(self._executions), missing, tuple(self.notes))


def _unavailable(client: ReadOnlyClient, what: str) -> IbUnavailable:
    if client.fatal is not None:
        code, text = client.fatal
        if code == CLIENT_ID_IN_USE:
            return IbUnavailable(f"API client id {CLIENT_ID} is already in use; "
                                 "close the other connection that uses it")
        if code == NOT_RUNNING:
            return IbUnavailable("no TWS or Gateway is listening on the configured port")
        return IbUnavailable(f"TWS reported error {code}: {text}")
    return IbUnavailable(f"TWS did not answer in time ({what})")


def _close(client: ReadOnlyClient, thread: threading.Thread, subscribed: bool) -> None:
    try:
        if subscribed and client.isConnected():
            client.cancel_subscriptions()
    except Exception:  # the link may already be gone; closing is all that is left to do
        pass
    try:
        client.disconnect()
    except Exception:  # the worker thread may be resetting the same connection
        pass
    thread.join(timeout=JOIN_SECONDS)


def fetch_raw(host: str, port: int, *, timeouts: Timeouts, check_accounts: Callable[[Sequence[str]], None],
              client_id: int = CLIENT_ID) -> RawSnapshot:
    """One read-only pass over TWS. Raises `IbUnavailable`, or whatever `check_accounts` raises (before any request)."""
    check_client_id(client_id)
    client = ReadOnlyClient()
    thread = threading.Thread(target=client.serve, args=(host, port, client_id), daemon=True, name="ib-readonly")
    thread.start()
    subscribed = False
    try:
        ready = client.wait_for(lambda: client.accounts is not None, time.monotonic() + timeouts.connect_s)
        if not ready or client.accounts is None:
            raise _unavailable(client, "no account list after the handshake")
        if not client.accounts:
            raise LiveGuardError("TWS reported no account, so none can be checked as a paper one")
        check_accounts(client.accounts)
        subscribed = True
        client.request_reads()
        client.wait_for(lambda: set(SECTIONS) <= client.ended, time.monotonic() + timeouts.reply_s)
        summary, positions, orders, executions, missing, notes = client.collected()
        if len(missing) == len(SECTIONS):
            raise _unavailable(client, "connected, but none of the requests was answered")
        return RawSnapshot(
            accounts=client.accounts, summary=summary, positions=positions, open_orders=orders,
            executions=executions, server_time_epoch_s=client.server_time, incomplete=missing,
            truncated=client.truncated, notes=notes)
    finally:
        _close(client, thread, subscribed)
