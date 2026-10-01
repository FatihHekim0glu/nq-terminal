"""The IB snapshot service (ARCHITECTURE s8): opt-in, guards, masking, the cache, clean time-outs.

A fake IB server on a loopback socket stands in for TWS; nothing here reaches a real one. Cases that must not touch
a socket at all assert the fake server saw no connection.
"""
from __future__ import annotations

import json
import time

import pytest

from nq_terminal.models.ib import IbSnapshot
from nq_terminal.services import ib_snapshot as svc
from nq_terminal.services.ib_readonly_client import ALLOWED_REQUEST_IDS, Timeouts
from nq_terminal.services.ib_snapshot import (
    CACHE_SECONDS,
    IbConfig,
    IbSnapshotService,
    config_from_env,
    mask_text,
)

from ib_fake_server import FakeIbServer, PAPER, SERVER_TIME_UTC

FAST = Timeouts(connect_s=2.0, reply_s=2.0)
QUICK = Timeouts(connect_s=0.8, reply_s=0.8)
ON = {"NQT_IB_READONLY": "1"}
MASKED = "DU*******"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def service_for(server: FakeIbServer, timeouts: Timeouts = FAST, clock=None) -> IbSnapshotService:
    config = IbConfig(host="127.0.0.1", port=server.port, timeouts=timeouts)
    return IbSnapshotService(config, clock=clock or Clock())


class TestOptIn:
    @pytest.mark.parametrize("env", [{}, {"NQT_IB_READONLY": ""}, {"NQT_IB_READONLY": "0"},
                                     {"NQT_IB_READONLY": "true"}, {"NQT_IB_READONLY": "yes"},
                                     {"NQT_IB_READONLY": " 1"}, {"NQT_IB_READONLY": "11"}])
    def test_only_the_exact_text_1_switches_it_on(self, env):
        assert config_from_env(env) is None

    def test_the_default_endpoint_is_the_paper_tws_on_this_machine(self):
        config = config_from_env(ON)
        assert (config.host, config.port) == ("127.0.0.1", 7497)

    def test_host_and_port_come_from_the_ib_variables(self):
        config = config_from_env({**ON, "IB_HOST": "localhost", "IB_PORT": "4002"})
        assert (config.host, config.port) == ("localhost", 4002)

    def test_disabled_never_touches_a_socket(self):
        with FakeIbServer() as server:
            snapshot = IbSnapshotService.from_env({"IB_PORT": str(server.port)}).snapshot()
            assert server.connections == 0
        assert snapshot.state == "disabled"
        assert "NQT_IB_READONLY=1" in snapshot.message
        assert snapshot.read_only is True and snapshot.order_path == "none"
        assert snapshot.positions == [] and snapshot.summary == [] and snapshot.fetched_at_utc is None


class TestGuards:
    @pytest.mark.parametrize("host", ["192.168.1.20", "10.0.0.5", "example.com", "0.0.0.0", "  "])
    def test_a_host_that_is_not_this_machine_is_refused(self, host):
        service = IbSnapshotService.from_env({**ON, "IB_HOST": host})
        snapshot = service.snapshot()
        assert snapshot.state == "refused"

    def test_the_remote_flag_of_the_live_scripts_is_not_honoured(self):
        service = IbSnapshotService.from_env({**ON, "IB_HOST": "192.168.1.20", "IB_ALLOW_REMOTE": "1"})
        assert service.snapshot().state == "refused"

    @pytest.mark.parametrize("port", ["7496", "4001"])
    def test_the_live_ports_are_refused(self, port):
        snapshot = IbSnapshotService.from_env({**ON, "IB_PORT": port}).snapshot()
        assert snapshot.state == "refused"
        assert "live" in snapshot.message

    @pytest.mark.parametrize("port", ["abc", "0", "70000", "-1", "75 97"])
    def test_an_unusable_port_is_refused_not_a_crash(self, port):
        assert IbSnapshotService.from_env({**ON, "IB_PORT": port}).snapshot().state == "refused"

    def test_a_refused_config_never_connects(self):
        with FakeIbServer() as server:
            IbSnapshotService.from_env({**ON, "IB_HOST": "192.168.1.20", "IB_PORT": str(server.port)}).snapshot()
            assert server.connections == 0

    def test_a_live_account_is_refused_after_the_handshake_and_before_any_request(self):
        with FakeIbServer(accounts=("U7654321",)) as server:
            snapshot = service_for(server).snapshot()
            time.sleep(0.2)
            sent = server.message_ids()
        assert snapshot.state == "refused"
        assert "paper" in snapshot.message
        assert "U7654321" not in json.dumps(snapshot.model_dump())
        assert set(sent) <= {71}
        assert snapshot.positions == [] and snapshot.summary == [] and snapshot.open_orders == []

    def test_one_live_account_among_paper_ones_is_refused(self):
        with FakeIbServer(accounts=(PAPER, "U7654321")) as server:
            snapshot = service_for(server).snapshot()
        assert snapshot.state == "refused"


class TestReading:
    def test_a_paper_account_gives_every_section(self):
        with FakeIbServer() as server:
            snapshot = service_for(server).snapshot()
        assert snapshot.state == "ok"
        assert snapshot.client_id == 95
        assert snapshot.server_time_utc == SERVER_TIME_UTC
        net = next(row for row in snapshot.summary if row.tag == "NetLiquidation")
        assert (net.number, net.currency, net.value) == (1000000.25, "USD", "1000000.25")
        kind = next(row for row in snapshot.summary if row.tag == "AccountType")
        assert kind.number is None and kind.value == "INDIVIDUAL"
        position = snapshot.positions[0]
        assert (position.local_symbol, position.sec_type, position.quantity) == ("MNQZ6", "FUT", 3.0)
        assert position.average_cost == 41234.5 and position.expiry == "20261218"
        order = snapshot.open_orders[0]
        assert (order.order_id, order.perm_id, order.action, order.order_type) == (17, 99001, "BUY", "LMT")
        assert (order.quantity, order.limit_price, order.stop_price) == (2.0, 20100.25, None)
        assert (order.status, order.filled, order.remaining) == ("Submitted", 0.0, 2.0)
        fill = snapshot.executions[0]
        assert (fill.side, fill.shares, fill.price, fill.average_price) == ("BOT", 3.0, 20095.5, 20095.5)
        assert fill.time == "20260921 09:31:07 US/Eastern"
        assert snapshot.incomplete == [] and snapshot.truncated is False and snapshot.cached is False

    def test_the_account_id_is_masked_everywhere(self):
        with FakeIbServer() as server:
            snapshot = service_for(server).snapshot()
        text = json.dumps(snapshot.model_dump())
        assert PAPER not in text and "1234567" not in text
        assert snapshot.accounts_masked == [MASKED]
        assert {row.account_masked for row in snapshot.summary} == {MASKED}
        assert snapshot.positions[0].account_masked == MASKED
        assert snapshot.open_orders[0].account_masked == MASKED
        assert snapshot.executions[0].account_masked == MASKED

    def test_only_allowed_requests_were_sent_with_client_id_95(self):
        with FakeIbServer() as server:
            service_for(server).snapshot()
            time.sleep(0.2)
            sent, ids = server.message_ids(), list(server.client_ids)
        assert set(sent) <= ALLOWED_REQUEST_IDS
        assert ids == [95]

    def test_a_section_that_did_not_finish_is_named(self):
        with FakeIbServer(mode="no_executions_end") as server:
            snapshot = service_for(server, timeouts=Timeouts(connect_s=2.0, reply_s=0.8)).snapshot()
        assert snapshot.state == "ok"
        assert snapshot.incomplete == ["executions"]
        assert "executions" in snapshot.message
        assert snapshot.positions and snapshot.summary

    def test_the_tws_info_notice_is_not_a_note_but_a_real_error_would_be(self):
        with FakeIbServer() as server:
            snapshot = service_for(server).snapshot()
        assert snapshot.notes == []  # the 2104 farm notice is information


class TestUnavailable:
    def test_nothing_listening_is_unavailable_within_the_limit(self):
        with FakeIbServer() as server:
            port = server.port
        service = IbSnapshotService(IbConfig("127.0.0.1", port, QUICK), clock=Clock())
        started = time.monotonic()
        snapshot = service.snapshot()
        assert time.monotonic() - started < 4.0
        assert snapshot.state == "unavailable"
        assert "TWS" in snapshot.message
        assert snapshot.read_only is True

    def test_a_silent_server_times_out_cleanly(self):
        with FakeIbServer(mode="silent") as server:
            started = time.monotonic()
            snapshot = service_for(server, timeouts=QUICK).snapshot()
            elapsed = time.monotonic() - started
        assert snapshot.state == "unavailable"
        assert elapsed < 4.0

    def test_a_client_id_in_use_says_so(self):
        with FakeIbServer(mode="client_id_in_use") as server:
            snapshot = service_for(server).snapshot()
        assert snapshot.state == "unavailable"
        assert "95" in snapshot.message

    def test_an_unexpected_failure_is_unavailable_not_a_500(self):
        def broken(config):
            raise RuntimeError("boom with account DU7654321")

        service = IbSnapshotService(IbConfig("127.0.0.1", 7497, QUICK), clock=Clock(), taker=broken)
        snapshot = service.snapshot()
        assert snapshot.state == "unavailable"
        assert "DU7654321" not in json.dumps(snapshot.model_dump())
        assert "RuntimeError" in snapshot.message


class TestCache:
    def test_a_second_read_inside_the_window_reuses_the_first(self):
        clock = Clock()
        with FakeIbServer() as server:
            service = service_for(server, clock=clock)
            first = service.snapshot()
            clock.now += CACHE_SECONDS - 1.0
            second = service.snapshot()
            connections = server.connections
        assert connections == 1
        assert first.cached is False and second.cached is True
        assert second.age_s == pytest.approx(CACHE_SECONDS - 1.0)
        assert second.fetched_at_utc == first.fetched_at_utc
        assert second.positions == first.positions

    def test_it_reads_again_once_the_window_has_passed(self):
        clock = Clock()
        with FakeIbServer() as server:
            service = service_for(server, clock=clock)
            service.snapshot()
            clock.now += CACHE_SECONDS + 0.1
            again = service.snapshot()
            connections = server.connections
        assert connections == 2
        assert again.cached is False and again.age_s == 0

    def test_the_window_is_a_few_seconds(self):
        assert 2.0 <= CACHE_SECONDS <= 15.0

    def test_a_failure_is_cached_too_so_a_polling_screen_does_not_hammer_tws(self):
        clock = Clock()
        with FakeIbServer() as server:
            port = server.port
        calls = []

        def counting(config):
            calls.append(1)
            return svc.take_snapshot(config)

        service = IbSnapshotService(IbConfig("127.0.0.1", port, QUICK), clock=clock, taker=counting)
        service.snapshot()
        clock.now += 1.0
        again = service.snapshot()
        assert len(calls) == 1
        assert again.cached is True and again.state == "unavailable"

    def test_concurrent_requests_share_one_read(self):
        import threading

        with FakeIbServer() as server:
            service = service_for(server)
            results: list[IbSnapshot] = []
            threads = [threading.Thread(target=lambda: results.append(service.snapshot())) for _ in range(4)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=15)
            assert server.connections == 1
        assert len(results) == 4 and {r.state for r in results} == {"ok"}


class TestConstants:
    def test_the_service_and_the_client_agree_on_the_client_id(self):
        from nq_terminal.services import ib_readonly_client

        assert svc.CLIENT_ID == ib_readonly_client.CLIENT_ID == 95


class TestMaskText:
    def test_account_like_ids_and_known_ids_are_masked(self):
        text = mask_text("order for DU7654321 and U1234567 on X9999999", known=("X9999999",))
        assert "DU7654321" not in text and "U1234567" not in text and "X9999999" not in text
        assert "DU*******" in text

    def test_long_text_is_cut(self):
        assert len(mask_text("x" * 1000)) <= 200
