"""The HOME prewarm wired into the app (04 D1.4; 02 section 4.1 item 2; 05 G02).

`api/home_prewarm.py` builds the task list from the cached route callables and starts `services/prewarm.py` from the
app's lifespan. What is proved here: it starts only in a desktop or launcher process (never in fixture mode, never for
NQT_PREWARM=0, never with no switch); building the list reads nothing; a page request racing the prewarm for the same
key makes one serve call and one gate line; the whole list runs on the fixture lab with caller "terminal" lines only, and
the page's own reads afterwards are hits that log nothing; the port-bound signal reaches the prewarm from the launcher.
"""
from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from nq_terminal import __main__ as launcher
from nq_terminal.api import home_prewarm
from nq_terminal.app import create_app
from nq_terminal.services import prewarm
from nq_terminal.settings import load_settings

from nq_terminal.api import data

from test_result_cache_routes import LOCAL, LOOPBACK, Lab

from conftest import api_client

WAIT_S = 20.0
TASK_NAMES = ["deflated", "ledger", "two_day", "universe", "gp_bars", "eq_bootstrap"]


@pytest.fixture(autouse=True)
def fresh_process(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(prewarm, "_started", False)
    for name in (prewarm.ENV_DESKTOP, prewarm.ENV_PREWARM):
        monkeypatch.delenv(name, raising=False)


def app_stub(*, fixture_mode: bool, ready=None) -> SimpleNamespace:
    state = SimpleNamespace(settings=SimpleNamespace(fixture_mode=fixture_mode))
    if ready is not None:
        setattr(state, prewarm.PORT_BOUND_KEY, ready)
    return SimpleNamespace(state=state)


def named(state, name: str):
    return next(task for task in home_prewarm.home_tasks(state) if task.__name__ == name)


def count_rows(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """One entry per run of the route's own computation (`two_day_row` is called once per symbol by it)."""
    seen: list[int] = []
    real = data.two_day_row

    def spy(*args, **kwargs):
        seen.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(data, "two_day_row", spy)
    return seen


def gate_lines(lab: Lab) -> list[dict]:
    log = lab.app.state.fixture_log
    if not log.exists():
        return []
    return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines() if x.strip()]


def wait_for(predicate, timeout: float = WAIT_S) -> bool:
    event = threading.Event()
    deadline_hit = threading.Timer(timeout, event.set)
    deadline_hit.start()
    try:
        while not event.is_set():
            if predicate():
                return True
            event.wait(0.01)
        return False
    finally:
        deadline_hit.cancel()


# ---------------------------------------------------------------- the task list


def test_the_task_list_is_the_home_layout_in_order_and_builds_without_any_read():
    state = SimpleNamespace()  # no settings, no services: building the list must touch none of them
    tasks = home_prewarm.home_tasks(state)
    assert [t.__name__ for t in tasks] == TASK_NAMES
    assert all(callable(t) for t in tasks)


def test_the_disk_eligible_entries_run_first_and_alone_before_any_price_task():
    names = [t.__name__ for t in home_prewarm.home_tasks(SimpleNamespace())]
    assert names[:2] == ["deflated", "ledger"] and names[2:] == ["two_day", "universe", "gp_bars", "eq_bootstrap"]


# ---------------------------------------------------------------- when it starts


@pytest.mark.parametrize("env", [{}, {"NQT_PREWARM": "0"}, {"NQT_DESKTOP": "0"}, {"NQT_PREWARM": "yes"}])
def test_it_does_not_start_without_a_switch_at_exactly_one(monkeypatch, env):
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    assert prewarm.prewarm_enabled() is False
    assert home_prewarm.start_home_prewarm(app_stub(fixture_mode=False)) is None  # the real start refuses
    assert prewarm._started is False


@pytest.mark.parametrize("switch", ["NQT_DESKTOP", "NQT_PREWARM"])
def test_it_starts_for_either_switch_with_the_task_list_and_the_ready_check(monkeypatch, switch):
    monkeypatch.setenv(switch, "1")
    seen = {}

    def fake_start(tasks, enabled=None, *, ready=None, **kwargs):
        seen.update(tasks=list(tasks), ready=ready)
        return "thread"

    monkeypatch.setattr(home_prewarm, "start_prewarm", fake_start)
    ready = lambda: True  # noqa: E731
    assert home_prewarm.start_home_prewarm(app_stub(fixture_mode=False, ready=ready)) == "thread"
    assert [t.__name__ for t in seen["tasks"]] == TASK_NAMES and seen["ready"] is ready


def test_born_failing_fixture_mode_never_prewarms_even_in_desktop_mode(monkeypatch):
    monkeypatch.setenv("NQT_DESKTOP", "1")
    monkeypatch.setattr(home_prewarm, "start_prewarm", lambda *a, **k: pytest.fail("a fixture app must not prewarm"))
    assert home_prewarm.start_home_prewarm(app_stub(fixture_mode=True)) is None


def test_an_explicit_zero_switches_it_off_even_in_desktop_mode(monkeypatch):
    monkeypatch.setenv("NQT_DESKTOP", "1")
    monkeypatch.setenv("NQT_PREWARM", "0")
    monkeypatch.setattr(home_prewarm, "start_prewarm", lambda *a, **k: pytest.fail("NQT_PREWARM=0 must win"))
    assert home_prewarm.start_home_prewarm(app_stub(fixture_mode=False)) is None


def test_a_failure_while_starting_is_logged_and_never_reaches_the_app(monkeypatch, caplog):
    monkeypatch.setenv("NQT_PREWARM", "1")

    def boom(*a, **k):
        raise RuntimeError("no thread for you")

    monkeypatch.setattr(home_prewarm, "start_prewarm", boom)
    assert home_prewarm.start_home_prewarm(app_stub(fixture_mode=False)) is None
    assert "could not be started" in caplog.text


def test_the_lifespan_starts_the_prewarm_once_the_app_starts(monkeypatch):
    """Born failing before app.py called it: a started app (the lifespan runs) reaches start_prewarm."""
    seen = []
    monkeypatch.setattr("nq_terminal.app.start_home_prewarm", lambda app: seen.append(app))
    app = create_app(load_settings({}))
    assert seen == []  # building the app starts nothing
    with api_client(app, base_url=LOCAL, client=LOOPBACK):
        pass
    assert seen == [app]


# ---------------------------------------------------------------- the launcher's port-bound signal


def test_the_launcher_hands_the_prewarm_a_check_that_follows_the_server_being_started(monkeypatch):
    built = {}

    class FakeServer:
        started = False

        def __init__(self, config):
            built["config"] = config

        def run(self, sockets=None):
            built["during_run"] = built["app"].state.port_bound()
            FakeServer.started = True
            built["after_bind"] = built["app"].state.port_bound()
            for bound in sockets or []:  # the launcher hands over its exclusively bound socket
                bound.close()

    monkeypatch.setattr(launcher.uvicorn, "Server", FakeServer)
    real_create = launcher.create_app
    monkeypatch.setattr(launcher, "create_app", lambda settings: built.setdefault("app", real_create(settings)))
    launcher.main({"NQT_PORT": "9001"})
    assert built["config"].host == "127.0.0.1" and built["config"].port == 9001
    assert (built["during_run"], built["after_bind"]) == (False, True)


# ---------------------------------------------------------------- against the fixture lab


PAGE_QUERY = "/api/market/two-day?symbols=NQ.V.0"  # what MON's TwoDayCell sends: one symbol per request


def race_the_prewarm_task(lab: Lab, *, joined: bool):
    """Hold the prewarm's two-day task inside the serve, send the page's request for the same key, then release."""
    lab.serve.hold = threading.Event()
    thread = prewarm.start_prewarm([named(lab.app.state, "two_day")], True)
    assert thread is not None
    assert lab.serve.entered.wait(WAIT_S), "the prewarm task reached the serve"
    with ThreadPoolExecutor(max_workers=1) as pool:
        request = pool.submit(lambda: lab.client.get(PAGE_QUERY))
        if joined:
            assert wait_for(lambda: lab.cache.stats().waited == 1), "the page request waits for the prewarm"
        else:
            threading.Event().wait(0.5)
        lab.serve.hold.set()
        response = request.result(WAIT_S)
    thread.join(WAIT_S)
    assert not thread.is_alive()
    return response


@pytest.fixture()
def nq_only(monkeypatch: pytest.MonkeyPatch):
    """Narrow the prewarm's two-day universe to the symbol the race requests, so the counts compare with one request."""
    monkeypatch.setattr(home_prewarm, "two_day_symbols", lambda: ["NQ.V.0"])


def test_a_page_request_racing_the_prewarm_task_makes_one_computation_one_serve_call_and_one_gate_line(
        tmp_path, monkeypatch, nq_only):
    rows = count_rows(monkeypatch)
    single = Lab(tmp_path, "single").build()
    assert single.client.get(PAGE_QUERY).status_code == 200
    baseline = (single.serve.calls, len(gate_lines(single)), len(rows))
    assert baseline[0] >= 1 and baseline[1] >= 1 and baseline[2] >= 1
    rows.clear()

    lab = Lab(tmp_path, "race").build()
    response = race_the_prewarm_task(lab, joined=True)
    assert response.status_code == 200
    assert (lab.serve.calls, len(gate_lines(lab)), len(rows)) == baseline, "as for one request on its own"
    assert (lab.cache.stats().misses, lab.cache.stats().waited) == (1, 1)


def test_born_failing_without_single_flight_the_race_computes_twice(tmp_path, monkeypatch, nq_only):
    from nq_terminal.services import result_cache as rc

    rows = count_rows(monkeypatch)
    single = Lab(tmp_path, "single").build()
    single.client.get(PAGE_QUERY)
    one = len(rows)
    rows.clear()
    monkeypatch.setattr(rc.ResultCache, "_join", lambda self, key: (rc._Flight(threading.get_ident()), True))
    lab = Lab(tmp_path, "nojoin").build()
    assert race_the_prewarm_task(lab, joined=False).status_code == 200
    assert len(rows) == 2 * one, "this is what the single-flight prevents"


def test_born_failing_the_two_day_task_warms_the_key_of_each_single_symbol_request_the_page_sends(tmp_path):
    lab = Lab(tmp_path, "keys").build()
    thread = prewarm.start_prewarm([named(lab.app.state, "two_day")], True)
    assert thread is not None
    thread.join(WAIT_S * 3)
    assert not thread.is_alive()
    before, calls = lab.cache.stats(), lab.serve.calls
    assert lab.client.get(PAGE_QUERY).status_code == 200
    after = lab.cache.stats()
    assert (after.misses, after.entries) == (before.misses, before.entries), "the page's request is a result-cache hit"
    assert lab.serve.calls == calls


def test_the_two_day_symbols_are_the_rows_the_home_monitor_shows_on_first_paint_in_its_sector_order():
    from nq_lab.dtsmom_universe import TABLE

    symbols = home_prewarm.two_day_symbols()
    assert len(symbols) == home_prewarm.HOME_MON_ROWS == 19, "the 2x2 HOME at 1920x1080 shows 19 grid rows"
    assert symbols == [f"{c.root}.V.0" for c in TABLE][:19], "the table is already in the monitor's sector order"
    assert symbols[:3] == ["ES.V.0", "NQ.V.0", "YM.V.0"] and "ZM.V.0" not in symbols, "rows below the fold wait"


def test_born_failing_the_two_day_task_reads_only_the_first_paint_rows_and_leaves_the_rest_to_the_page(tmp_path):
    lab = Lab(tmp_path, "fold").build()
    thread = prewarm.start_prewarm([named(lab.app.state, "two_day")], True)
    assert thread is not None
    thread.join(WAIT_S * 3)
    assert not thread.is_alive()
    assert lab.cache.stats().entries == home_prewarm.HOME_MON_ROWS, "one entry per first-paint symbol, none below it"
    before = lab.cache.stats().misses
    assert lab.client.get("/api/market/two-day?symbols=ZM.V.0").status_code == 200
    assert lab.cache.stats().misses == before + 1, "a row below the fold is the page's own first request"


def test_the_whole_list_runs_with_terminal_lines_only_and_the_page_then_reads_nothing_new(tmp_path, monkeypatch):
    escaped: list[BaseException] = []
    monkeypatch.setattr(threading, "excepthook", lambda args: escaped.append(args.exc_value))
    lab = Lab(tmp_path, "full").build()
    thread = prewarm.start_prewarm(home_prewarm.home_tasks(lab.app.state), True)
    assert thread is not None
    thread.join(WAIT_S * 3)
    assert not thread.is_alive() and escaped == []
    lines = gate_lines(lab)
    assert lines and {line["caller"] for line in lines} == {"terminal"}
    before = len(lines)
    client = lab.client
    for symbol in home_prewarm.two_day_symbols():  # one request per MON cell, as TwoDayCell sends them
        assert client.get(f"/api/market/two-day?symbols={symbol}").status_code == 200
    assert client.get("/api/market/universe").status_code == 200
    assert client.get("/api/bars?symbol=NQ.V.0&timeframe=1d").status_code == 200
    assert len(gate_lines(lab)) == before, "the page's reads after the prewarm are hits and log nothing"
    assert Path(lab.state).is_dir()
