"""The read-only IB client (ARCHITECTURE s8): client id, order methods that raise, the outgoing allowlist, one read.

Only a fake IB server on a loopback socket is used (`ib_fake_server.py`); no test connects to a real TWS or Gateway.
The order call names are never written in this file: they are taken from the client class itself (the names the
library's `EClient` has and the safety scan bans), so this file stays clean under the order-name ban.
"""
from __future__ import annotations

import threading
import time

import pytest

from nq_lab.live_guards import LiveGuardError
from nq_terminal.services import ib_readonly_client as ibc
from nq_terminal.services.ib_readonly_client import (
    ALLOWED_REQUEST_IDS,
    CLIENT_ID,
    IbUnavailable,
    OrderPathError,
    RESERVED_CLIENT_IDS,
    ReadOnlyClient,
    Timeouts,
    check_client_id,
    check_outgoing,
    fetch_raw,
)

from ib_fake_server import FakeIbServer, PAPER, SERVER_EPOCH_S
from safety_names import ib_order_names

FAST = Timeouts(connect_s=2.0, reply_s=2.0)
START_API, REQ_EXECUTIONS, REQ_CURRENT_TIME = 71, 7, 49
REQ_ACCOUNT_SUMMARY, CANCEL_ACCOUNT_SUMMARY = 62, 63
REQ_POSITIONS, CANCEL_POSITIONS, REQ_ALL_OPEN_ORDERS = 61, 64, 16


def paper_only(accounts):
    for account in accounts:
        if not account.startswith("DU"):
            raise LiveGuardError(f"account {account} is not a paper account")


def wait_until(predicate, seconds: float = 2.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


class TestClientId:
    def test_the_terminal_uses_client_id_95(self):
        assert CLIENT_ID == 95

    def test_taken_ids_are_reserved(self):
        assert RESERVED_CLIENT_IDS == frozenset({0, 11, 21, 91, 93})
        assert CLIENT_ID not in RESERVED_CLIENT_IDS

    @pytest.mark.parametrize("taken", sorted(RESERVED_CLIENT_IDS))
    def test_a_reserved_id_is_refused(self, taken: int):
        with pytest.raises(ValueError, match="client id"):
            check_client_id(taken)

    def test_95_passes_and_a_non_integer_does_not(self):
        assert check_client_id(95) == 95
        for bad in (True, "95", 95.0, None, -1):
            with pytest.raises(ValueError):
                check_client_id(bad)


class TestOrderMethodsRaise:
    def test_the_client_library_has_the_six_order_style_calls_and_their_protobuf_twins(self):
        # The names come from the library; if it drops or adds one, this test says the list moved.
        assert len(ib_order_names()) == 12

    def test_every_one_raises_before_anything_is_sent(self):
        names = ib_order_names()
        with FakeIbServer() as server:
            client = ReadOnlyClient()
            client.connect("127.0.0.1", server.port, CLIENT_ID)
            try:
                assert client.isConnected()
                assert wait_until(lambda: START_API in server.message_ids())
                for name in names:
                    with pytest.raises(OrderPathError):
                        getattr(client, name)(1, 2, 3)
                    with pytest.raises(OrderPathError):
                        getattr(client, name)()
                time.sleep(0.2)
            finally:
                client.disconnect()
            assert server.message_ids() == [START_API]

    def test_the_overrides_take_any_arguments(self):
        client = ReadOnlyClient()
        for name in ib_order_names():
            with pytest.raises(OrderPathError):
                getattr(client, name)(*range(9), key="value")


class TestOutgoingAllowlist:
    def test_the_allowlist_is_exactly_the_documented_calls(self):
        assert ALLOWED_REQUEST_IDS == frozenset({
            START_API, REQ_ACCOUNT_SUMMARY, CANCEL_ACCOUNT_SUMMARY, REQ_POSITIONS, CANCEL_POSITIONS,
            REQ_ALL_OPEN_ORDERS, REQ_EXECUTIONS, REQ_CURRENT_TIME})

    @pytest.mark.parametrize("message_id", [1, 2, 3, 4, 5, 15, 21, 58, 66, 100, 150])
    def test_a_text_frame_outside_the_list_is_refused(self, message_id: int):
        client = ReadOnlyClient()
        with pytest.raises(OrderPathError):
            client.sendMsg(message_id, "")

    @pytest.mark.parametrize("message_id", [1, 3, 4, 5, 15, 21, 58])
    def test_a_protobuf_frame_outside_the_list_is_refused(self, message_id: int):
        client = ReadOnlyClient()
        with pytest.raises(OrderPathError):
            client.sendMsgProtoBuf(message_id + 200, b"")

    @pytest.mark.parametrize("message_id", sorted(ALLOWED_REQUEST_IDS))
    def test_a_listed_id_passes_the_guard(self, message_id: int):
        assert check_outgoing(message_id) is None
        assert check_outgoing(message_id + 200) is None  # the protobuf form of the same message

    def test_an_id_outside_the_list_fails_the_guard(self):
        with pytest.raises(OrderPathError):
            check_outgoing(3)
        with pytest.raises(OrderPathError):
            check_outgoing(203)


class TestFetchRaw:
    def test_one_read_returns_every_section(self):
        with FakeIbServer() as server:
            raw = fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
        assert raw.accounts == (PAPER,)
        assert raw.server_time_epoch_s == SERVER_EPOCH_S
        assert {row["tag"] for row in raw.summary} >= {"NetLiquidation", "TotalCashValue", "BuyingPower"}
        assert raw.positions[0]["local_symbol"] == "MNQZ6"
        assert raw.positions[0]["quantity"] == 3.0
        assert raw.open_orders[0]["order_id"] == 17
        assert raw.executions[0]["exec_id"] == "0000e0d5.65f0a1b2.01.01"
        assert raw.incomplete == ()
        assert raw.truncated is False

    def test_only_allowed_requests_reach_the_wire_and_the_id_is_95(self):
        with FakeIbServer() as server:
            fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
            assert wait_until(lambda: CANCEL_POSITIONS in server.message_ids())
            sent = server.message_ids()
            assert server.client_ids == [95]
        assert set(sent) <= ALLOWED_REQUEST_IDS
        assert {START_API, REQ_CURRENT_TIME, REQ_ACCOUNT_SUMMARY, REQ_POSITIONS, REQ_ALL_OPEN_ORDERS,
                REQ_EXECUTIONS} <= set(sent)

    def test_the_summary_and_positions_subscriptions_are_cancelled(self):
        with FakeIbServer() as server:
            fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
            assert wait_until(lambda: {CANCEL_ACCOUNT_SUMMARY, CANCEL_POSITIONS} <= set(server.message_ids()))

    def test_a_non_paper_account_stops_the_read_before_any_request(self):
        with FakeIbServer(accounts=("U7654321",)) as server:
            with pytest.raises(LiveGuardError):
                fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
            time.sleep(0.2)
            assert server.message_ids() == [START_API]

    def test_one_live_account_among_paper_ones_refuses_the_whole_read(self):
        with FakeIbServer(accounts=(PAPER, "U7654321")) as server:
            with pytest.raises(LiveGuardError):
                fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)

    def test_no_account_list_is_a_refusal_not_a_read(self):
        with FakeIbServer(accounts=()) as server:
            with pytest.raises((LiveGuardError, IbUnavailable)):
                fetch_raw("127.0.0.1", server.port, timeouts=Timeouts(connect_s=0.6, reply_s=0.6),
                          check_accounts=paper_only)
            assert not (set(server.message_ids()) - {START_API})

    def test_nothing_listening_is_unavailable_and_quick(self):
        with FakeIbServer() as server:
            port = server.port
        started = time.monotonic()
        with pytest.raises(IbUnavailable):
            fetch_raw("127.0.0.1", port, timeouts=Timeouts(connect_s=1.0, reply_s=1.0), check_accounts=paper_only)
        assert time.monotonic() - started < 4.0

    def test_a_server_that_never_answers_times_out_cleanly(self):
        with FakeIbServer(mode="silent") as server:
            started = time.monotonic()
            with pytest.raises(IbUnavailable) as caught:
                fetch_raw("127.0.0.1", server.port, timeouts=Timeouts(connect_s=0.8, reply_s=0.8),
                          check_accounts=paper_only)
            elapsed = time.monotonic() - started
        assert elapsed < 4.0
        assert "answer" in str(caught.value) or "time" in str(caught.value)

    def test_a_client_id_already_in_use_is_reported(self):
        with FakeIbServer(mode="client_id_in_use") as server:
            with pytest.raises(IbUnavailable, match="client id"):
                fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)

    def test_a_section_without_its_end_marker_is_listed_as_incomplete(self):
        with FakeIbServer(mode="no_executions_end") as server:
            raw = fetch_raw("127.0.0.1", server.port, timeouts=Timeouts(connect_s=2.0, reply_s=0.8),
                            check_accounts=paper_only)
        assert raw.incomplete == ("executions",)
        assert raw.positions and raw.open_orders and raw.summary

    def test_the_rows_are_capped(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(ibc, "MAX_ROWS", 1)
        extra = tuple({**{"orderId": 20 + i, "permId": 1 + i, "clientId": 21, "symbol": "MNQ", "secType": "FUT",
                          "localSymbol": "MNQZ6", "exchange": "CME", "currency": "USD", "action": "SELL",
                          "orderType": "LMT", "quantity": "1", "limit": 1.0, "stop": None, "tif": "DAY",
                          "status": "Submitted", "filled": "0"}} for i in range(3))
        with FakeIbServer(open_orders=extra) as server:
            raw = fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
        assert len(raw.open_orders) == 1
        assert raw.truncated is True

    def test_no_reader_thread_outlives_the_read(self):
        with FakeIbServer() as server:
            fetch_raw("127.0.0.1", server.port, timeouts=FAST, check_accounts=paper_only)
            assert wait_until(lambda: not [t for t in threading.enumerate() if type(t).__name__ == "EReader"])
