"""A fake IB server on a loopback socket, for the read-only snapshot tests. It never talks to a real TWS.

It speaks the wire protocol of a modern TWS (server version 213: length-prefixed frames, raw 4-byte message ids,
protobuf bodies for the messages the snapshot uses), built with the client library's own protobuf classes, so the
real `EClient` decodes every frame it sends.

Everything the client sends after the handshake is recorded in `received` (the base message id, 200 taken off
protobuf ids), so a test can assert that nothing outside the read-only allowlist ever reached the wire. `mode`:

- "normal": answers every allowed request.
- "silent": accepts the socket and the handshake bytes, then never answers (a TWS with the API switched off).
- "no_executions_end": answers everything except the end marker of the executions request.
- "client_id_in_use": answers the start with error 326 and closes.
"""
from __future__ import annotations

import socket
import struct
import threading
from dataclasses import dataclass, field
from typing import Any

from ibapi.message import IN, OUT
from ibapi.protobuf.AccountSummaryEnd_pb2 import AccountSummaryEnd as AccountSummaryEndProto
from ibapi.protobuf.AccountSummaryRequest_pb2 import AccountSummaryRequest as AccountSummaryRequestProto
from ibapi.protobuf.AccountSummary_pb2 import AccountSummary as AccountSummaryProto
from ibapi.protobuf.CurrentTime_pb2 import CurrentTime as CurrentTimeProto
from ibapi.protobuf.ErrorMessage_pb2 import ErrorMessage as ErrorMessageProto
from ibapi.protobuf.ExecutionDetailsEnd_pb2 import ExecutionDetailsEnd as ExecutionDetailsEndProto
from ibapi.protobuf.ExecutionDetails_pb2 import ExecutionDetails as ExecutionDetailsProto
from ibapi.protobuf.ExecutionRequest_pb2 import ExecutionRequest as ExecutionRequestProto
from ibapi.protobuf.ManagedAccounts_pb2 import ManagedAccounts as ManagedAccountsProto
from ibapi.protobuf.NextValidId_pb2 import NextValidId as NextValidIdProto
from ibapi.protobuf.OpenOrder_pb2 import OpenOrder as OpenOrderProto
from ibapi.protobuf.OpenOrdersEnd_pb2 import OpenOrdersEnd as OpenOrdersEndProto
from ibapi.protobuf.PositionEnd_pb2 import PositionEnd as PositionEndProto
from ibapi.protobuf.Position_pb2 import Position as PositionProto
from ibapi.protobuf.StartApiRequest_pb2 import StartApiRequest as StartApiRequestProto

SERVER_VERSION = 213
PROTOBUF_OFFSET = 200
HANDSHAKE_TIMEOUT_S = 5.0
SERVER_EPOCH_S = 1_790_000_000  # 2026-09-21T14:13:20Z, what reqCurrentTime answers
SERVER_TIME_UTC = "2026-09-21T14:13:20Z"

PAPER = "DU1234567"
SUMMARY = (
    ("NetLiquidation", "1000000.25", "USD"),
    ("TotalCashValue", "812345.5", "USD"),
    ("BuyingPower", "4000000", "USD"),
    ("Cushion", "0.91", ""),
    ("AccountType", "INDIVIDUAL", ""),
)
POSITIONS = (
    {"conId": 770561201, "symbol": "MNQ", "secType": "FUT", "localSymbol": "MNQZ6", "expiry": "20261218",
     "exchange": "CME", "currency": "USD", "multiplier": 2.0, "position": "3", "avgCost": 41234.5},
)
OPEN_ORDERS = (
    {"orderId": 17, "permId": 99001, "clientId": 21, "symbol": "MNQ", "secType": "FUT", "localSymbol": "MNQZ6",
     "exchange": "CME", "currency": "USD", "action": "BUY", "orderType": "LMT", "quantity": "2",
     "limit": 20100.25, "stop": None, "tif": "DAY", "status": "Submitted", "filled": "0"},
)
EXECUTIONS = (
    {"orderId": 16, "execId": "0000e0d5.65f0a1b2.01.01", "time": "20260921 09:31:07 US/Eastern", "symbol": "MNQ",
     "secType": "FUT", "localSymbol": "MNQZ6", "exchange": "CME", "currency": "USD", "side": "BOT",
     "shares": "3", "price": 20095.5, "permId": 99000, "clientId": 21, "cumQty": "3", "avgPrice": 20095.5},
)


def recv_exact(sock: socket.socket, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("peer closed")
        data += chunk
    return data


def frame(message_id: int, body: bytes) -> bytes:
    payload = message_id.to_bytes(4, "big") + body
    return struct.pack("!I", len(payload)) + payload


def proto_frame(in_id: int, message: Any) -> bytes:
    return frame(PROTOBUF_OFFSET + in_id, message.SerializeToString())


def _contract(message: Any, spec: dict[str, Any]) -> None:
    contract = message.contract
    contract.conId = spec.get("conId", 0)
    contract.symbol = spec["symbol"]
    contract.secType = spec["secType"]
    contract.localSymbol = spec["localSymbol"]
    contract.exchange = spec["exchange"]
    contract.currency = spec["currency"]
    if spec.get("expiry"):
        contract.lastTradeDateOrContractMonth = spec["expiry"]
    if spec.get("multiplier"):
        contract.multiplier = spec["multiplier"]


@dataclass
class FakeIbServer:
    accounts: tuple[str, ...] = (PAPER,)
    summary: tuple[tuple[str, str, str], ...] = SUMMARY
    positions: tuple[dict[str, Any], ...] = POSITIONS
    open_orders: tuple[dict[str, Any], ...] = OPEN_ORDERS
    executions: tuple[dict[str, Any], ...] = EXECUTIONS
    mode: str = "normal"
    received: list[int] = field(default_factory=list)
    client_ids: list[int] = field(default_factory=list)
    connections: int = 0
    port: int = 0
    _listener: socket.socket | None = None
    _thread: threading.Thread | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __enter__(self) -> "FakeIbServer":
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    def start(self) -> None:
        self._listener = socket.socket()
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen(4)
        self._listener.settimeout(0.2)
        self.port = self._listener.getsockname()[1]
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._listener is not None:
            self._listener.close()
        if self._thread is not None:
            self._thread.join(timeout=2)

    def message_ids(self) -> list[int]:
        with self._lock:
            return list(self.received)

    def _accept_loop(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self._lock:
                self.connections += 1
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        conn.settimeout(HANDSHAKE_TIMEOUT_S)
        try:
            self._handshake(conn)
            if self.mode == "silent":
                self._drain(conn)
                return
            self._session(conn)
        except (OSError, ConnectionError):
            pass
        finally:
            conn.close()

    def _handshake(self, conn: socket.socket) -> None:
        if recv_exact(conn, 4) != b"API\0":
            raise ConnectionError("not an API handshake")
        size = struct.unpack("!I", recv_exact(conn, 4))[0]
        recv_exact(conn, size)
        if self.mode == "silent":
            return
        reply = f"{SERVER_VERSION}\0{SERVER_EPOCH_S} UTC\0".encode()
        conn.sendall(struct.pack("!I", len(reply)) + reply)

    def _drain(self, conn: socket.socket) -> None:
        conn.settimeout(0.2)
        while not self._stop.is_set():
            try:
                if not conn.recv(4096):
                    return
            except socket.timeout:
                continue

    def _read_frame(self, conn: socket.socket) -> tuple[int, bytes]:
        size = struct.unpack("!I", recv_exact(conn, 4))[0]
        payload = recv_exact(conn, size)
        return int.from_bytes(payload[:4], "big"), payload[4:]

    def _session(self, conn: socket.socket) -> None:
        conn.settimeout(0.2)
        while not self._stop.is_set():
            try:
                raw_id, body = self._read_frame(conn)
            except socket.timeout:
                continue
            base = raw_id - PROTOBUF_OFFSET if raw_id > PROTOBUF_OFFSET else raw_id
            with self._lock:
                self.received.append(base)
            if not self._answer(conn, base, body):
                return

    def _answer(self, conn: socket.socket, message_id: int, body: bytes) -> bool:
        if message_id == OUT.START_API:
            return self._start(conn, body)
        if message_id == OUT.REQ_CURRENT_TIME:
            conn.sendall(proto_frame(IN.CURRENT_TIME, CurrentTimeProto(currentTime=SERVER_EPOCH_S)))
        elif message_id == OUT.REQ_ACCOUNT_SUMMARY:
            self._send_summary(conn, body)
        elif message_id == OUT.REQ_POSITIONS:
            self._send_positions(conn)
        elif message_id == OUT.REQ_ALL_OPEN_ORDERS:
            self._send_open_orders(conn)
        elif message_id == OUT.REQ_EXECUTIONS:
            self._send_executions(conn, body)
        return True

    def _start(self, conn: socket.socket, body: bytes) -> bool:
        request = StartApiRequestProto()
        request.ParseFromString(body)
        with self._lock:
            self.client_ids.append(request.clientId)
        if self.mode == "client_id_in_use":
            conn.sendall(proto_frame(IN.ERR_MSG, ErrorMessageProto(
                id=-1, errorTime=SERVER_EPOCH_S * 1000, errorCode=326,
                errorMsg="Unable to connect as the client id is already in use.")))
            return False
        conn.sendall(proto_frame(IN.NEXT_VALID_ID, NextValidIdProto(orderId=100)))
        conn.sendall(proto_frame(IN.MANAGED_ACCTS, ManagedAccountsProto(accountsList=",".join(self.accounts))))
        conn.sendall(proto_frame(IN.ERR_MSG, ErrorMessageProto(
            id=-1, errorTime=SERVER_EPOCH_S * 1000, errorCode=2104,
            errorMsg="Market data farm connection is OK:usfuture")))
        return True

    def _send_summary(self, conn: socket.socket, body: bytes) -> None:
        request = AccountSummaryRequestProto()
        request.ParseFromString(body)
        for account in self.accounts:
            for tag, value, currency in self.summary:
                conn.sendall(proto_frame(IN.ACCOUNT_SUMMARY, AccountSummaryProto(
                    reqId=request.reqId, account=account, tag=tag, value=value, currency=currency)))
        conn.sendall(proto_frame(IN.ACCOUNT_SUMMARY_END, AccountSummaryEndProto(reqId=request.reqId)))

    def _send_positions(self, conn: socket.socket) -> None:
        for spec in self.positions:
            message = PositionProto(account=self.accounts[0], position=spec["position"], avgCost=spec["avgCost"])
            _contract(message, spec)
            conn.sendall(proto_frame(IN.POSITION_DATA, message))
        conn.sendall(proto_frame(IN.POSITION_END, PositionEndProto()))

    def _send_open_orders(self, conn: socket.socket) -> None:
        for spec in self.open_orders:
            message = OpenOrderProto(orderId=spec["orderId"])
            _contract(message, spec)
            order = message.order
            order.orderId, order.permId, order.clientId = spec["orderId"], spec["permId"], spec["clientId"]
            order.action, order.orderType, order.tif = spec["action"], spec["orderType"], spec["tif"]
            order.totalQuantity, order.filledQuantity = spec["quantity"], spec["filled"]
            order.account = self.accounts[0]
            if spec["limit"] is not None:
                order.lmtPrice = spec["limit"]
            if spec["stop"] is not None:
                order.auxPrice = spec["stop"]
            message.orderState.status = spec["status"]
            conn.sendall(proto_frame(IN.OPEN_ORDER, message))
        conn.sendall(proto_frame(IN.OPEN_ORDER_END, OpenOrdersEndProto()))

    def _send_executions(self, conn: socket.socket, body: bytes) -> None:
        request = ExecutionRequestProto()
        request.ParseFromString(body)
        for spec in self.executions:
            message = ExecutionDetailsProto(reqId=request.reqId)
            _contract(message, spec)
            execution = message.execution
            execution.orderId, execution.execId, execution.time = spec["orderId"], spec["execId"], spec["time"]
            execution.acctNumber, execution.exchange = self.accounts[0], spec["exchange"]
            execution.side, execution.shares = spec["side"], spec["shares"]
            execution.price, execution.permId = spec["price"], spec["permId"]
            execution.clientId, execution.cumQty = spec["clientId"], spec["cumQty"]
            execution.avgPrice = spec["avgPrice"]
            conn.sendall(proto_frame(IN.EXECUTION_DATA, message))
        if self.mode != "no_executions_end":
            conn.sendall(proto_frame(IN.EXECUTION_DATA_END, ExecutionDetailsEndProto(reqId=request.reqId)))
