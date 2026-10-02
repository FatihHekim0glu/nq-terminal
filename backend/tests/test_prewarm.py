"""The HOME prewarm (02 section 4.1 item 2; 04 D1.4; 05 G02): a once-per-process background run of the cached HOME
computations, on in desktop and launcher mode only.

The prewarm module makes no price read of its own. It calls the zero-argument tasks it is given (the merge builds them
from the cached route callables), so every gated read goes through `BarService` and `serve` with caller "terminal"
and the page's reason, and the gate log gains no new kind of line. These tests drive it with a fake serve over the real
gate (a temporary log) and with the real `ResultCache`.
"""
from __future__ import annotations

import ast
import json
import logging
import threading
from pathlib import Path

import pandas as pd
import pytest

from nq_terminal.services import bars as bars_mod
from nq_terminal.services import prewarm
from nq_terminal.services.bars import BarService, CacheKey
from nq_terminal.services.result_cache import ResultCache

from fakes import FakeServe, make_fake_serve

WAIT = 10.0  # seconds a test waits for the prewarm thread; a pass never comes near it
UTC = "UTC"
START, END = pd.Timestamp("2019-02-01", tz=UTC), pd.Timestamp("2019-02-05", tz=UTC)
BIG = 2**31


@pytest.fixture(autouse=True)
def fresh_process(monkeypatch: pytest.MonkeyPatch):
    """Each test starts as a new process: nothing started yet, neither switch set."""
    monkeypatch.setattr(prewarm, "_started", False)
    monkeypatch.delenv(prewarm.ENV_DESKTOP, raising=False)
    monkeypatch.delenv(prewarm.ENV_PREWARM, raising=False)


@pytest.fixture
def escaped(monkeypatch: pytest.MonkeyPatch) -> list[BaseException]:
    """Exceptions that escaped a thread (threading.excepthook); a prewarm must leave this empty."""
    seen: list[BaseException] = []
    monkeypatch.setattr(threading, "excepthook", lambda args: seen.append(args.exc_value))
    return seen


@pytest.fixture
def fake(tmp_path: Path) -> FakeServe:
    return make_fake_serve(tmp_path / "oos_access_log.jsonl")


def log_lines(fake: FakeServe) -> list[dict]:
    if not fake.log_path.exists():
        return []
    return [json.loads(x) for x in fake.log_path.read_text(encoding="utf-8").splitlines() if x.strip()]


def run_to_end(tasks, enabled=True, **kwargs) -> threading.Thread:
    thread = prewarm.start_prewarm(tasks, enabled, **kwargs)
    assert thread is not None
    thread.join(WAIT)
    assert not thread.is_alive()
    return thread


# ---------------------------------------------------------------- the gate: caller and reason


def test_prewarm_gate_lines_carry_caller_terminal_and_the_pages_reason(fake):
    svc = BarService(fake, cache_bytes=BIG)
    run_to_end([lambda: svc.bars("NQ.V.0", "1m", "vendor", START, END),
                lambda: svc.bars("ZN.V.0", "1d", "vendor", START, END)])
    lines = log_lines(fake)
    assert len(lines) == 2
    assert {line["caller"] for line in lines} == {"terminal"}

    page_fake = make_fake_serve(fake.log_path.with_name("page_log.jsonl"))
    page = BarService(page_fake, cache_bytes=BIG)
    page.bars("NQ.V.0", "1m", "vendor", START, END)
    page.bars("ZN.V.0", "1d", "vendor", START, END)
    assert [line["reason"] for line in lines] == [line["reason"] for line in log_lines(page_fake)]
    assert lines[0]["reason"] == bars_mod.serve_reason(CacheKey("NQ.V.0", "1m", "vendor", 2019))
    assert [c.caller for c in fake.calls] == ["terminal", "terminal"]


def test_a_page_read_after_the_prewarm_through_the_result_cache_makes_no_second_serve(fake):
    svc = BarService(fake, cache_bytes=BIG)
    cache = ResultCache(state_dir=None, gate_version=lambda *_: (1, 1))

    def cached_two_day() -> bytes:
        def compute() -> bytes:
            return str(len(svc.bars("NQ.V.0", "1m", "vendor", START, END, version=(1, 1)).t)).encode("utf-8")

        return cache.get("/api/market/two-day", {"root": "NQ"}, compute)

    run_to_end([cached_two_day])
    served_by_prewarm = len(fake.calls)
    assert served_by_prewarm == 1
    first = cached_two_day()  # the page's request, same callable and key
    assert len(fake.calls) == served_by_prewarm
    assert len(log_lines(fake)) == 1
    assert cache.stats().hits == 1
    assert first.isdigit()


def test_prewarm_itself_never_reads_prices_or_the_gate():
    """No new kind of gate line: the module imports nothing that can reach a price, so only the given tasks can."""
    tree = ast.parse(Path(prewarm.__file__).read_text(encoding="utf-8"))
    imported = {alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import)
                for alias in node.names}
    imported |= {(node.module or "").split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    assert not {"nq_lab", "pandas", "numpy", "pyarrow"} & imported
    source = Path(prewarm.__file__).read_text(encoding="utf-8")
    for banned in ("serve" + "(", "oos" + "_gate", "serve" + "_sealed", "read" + "_parquet"):  # not literals: AST scan
        assert banned not in source


# ---------------------------------------------------------------- once per process


def test_it_runs_at_most_once_per_process():
    calls: list[str] = []
    first = run_to_end([lambda: calls.append("a"), lambda: calls.append("b")])
    assert calls == ["a", "b"]
    assert first.daemon
    assert prewarm.start_prewarm([lambda: calls.append("again")], True) is None
    assert prewarm.start_prewarm([lambda: calls.append("third")], True) is None
    assert calls == ["a", "b"]


def test_a_second_start_while_the_first_is_still_running_does_nothing():
    release, running = threading.Event(), threading.Event()
    calls: list[str] = []

    def slow() -> None:
        running.set()
        assert release.wait(WAIT)
        calls.append("slow")

    first = prewarm.start_prewarm([slow], True)
    assert first is not None and running.wait(WAIT)
    assert prewarm.start_prewarm([lambda: calls.append("second")], True) is None
    release.set()
    first.join(WAIT)
    assert calls == ["slow"]


def test_concurrent_starts_make_one_thread():
    calls: list[int] = []
    gate = threading.Barrier(8)
    started: list[threading.Thread | None] = []

    def attempt() -> None:
        gate.wait(WAIT)
        started.append(prewarm.start_prewarm([lambda: calls.append(1)], True))

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
    real = [t for t in started if t is not None]
    assert len(real) == 1
    real[0].join(WAIT)
    assert calls == [1]


def test_start_returns_at_once_and_the_work_runs_on_a_daemon_thread():
    release = threading.Event()
    seen_thread: list[threading.Thread] = []

    def slow() -> None:
        seen_thread.append(threading.current_thread())
        release.wait(WAIT)

    thread = prewarm.start_prewarm([slow], True)
    try:
        assert thread is not None and thread.daemon and thread.name == prewarm.THREAD_NAME
        assert thread is not threading.current_thread()
    finally:
        release.set()
        thread.join(WAIT)
    assert seen_thread == [thread]


# ---------------------------------------------------------------- errors are logged, never raised


def test_an_exception_in_one_task_does_not_stop_the_others_or_the_app(caplog, escaped):
    calls: list[str] = []

    def boom() -> None:
        raise RuntimeError("two-day failed")

    def refuse() -> None:
        raise bars_mod.GateRefusal("window refused")

    caplog.set_level(logging.INFO, logger=prewarm.LOG.name)
    run_to_end([lambda: calls.append("one"), boom, lambda: calls.append("two"), refuse, lambda: calls.append("three")])
    assert calls == ["one", "two", "three"]
    assert escaped == []
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 2
    assert "two-day failed" in caplog.text and "window refused" in caplog.text


def test_start_prewarm_never_raises_for_bad_tasks(caplog, escaped):
    calls: list[str] = []
    run_to_end([None, "not callable", lambda: calls.append("ok")])
    assert calls == ["ok"]
    assert escaped == []


def test_a_task_that_raises_a_base_exception_subclass_of_exception_is_contained(escaped):
    class Odd(Exception):
        pass

    def odd() -> None:
        raise Odd

    calls: list[str] = []
    run_to_end([odd, lambda: calls.append("after")])
    assert calls == ["after"] and escaped == []


def test_the_task_list_is_copied_at_start():
    calls: list[str] = []
    release = threading.Event()
    tasks = [lambda: (release.wait(WAIT), calls.append("kept"))]
    thread = prewarm.start_prewarm(tasks, True)
    tasks.append(lambda: calls.append("added late"))
    tasks.clear()
    release.set()
    thread.join(WAIT)
    assert calls == ["kept"]


def test_tasks_run_in_order_without_overlap():
    order: list[str] = []
    active, peak = [0], [0]
    lock = threading.Lock()

    def make(name: str):
        def task() -> None:
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            order.append(name)
            with lock:
                active[0] -= 1

        return task

    run_to_end([make("two-day"), make("universe"), make("bars"), make("bootstrap")])
    assert order == ["two-day", "universe", "bars", "bootstrap"] and peak[0] == 1


def test_the_thread_starts_with_an_empty_context():
    """A recorder or other context variable of the caller (a request) never leaks into the prewarm's computations."""
    import contextvars

    marker: contextvars.ContextVar[str] = contextvars.ContextVar("prewarm_test_marker", default="empty")
    seen: list[str] = []
    marker.set("caller's value")
    run_to_end([lambda: seen.append(marker.get())])
    assert seen == ["empty"]


# ---------------------------------------------------------------- off by default


def test_with_neither_switch_set_it_makes_no_calls_and_starts_no_thread():
    """Born failing against a default-on implementation: pytest, the fixture backend and smoke never prewarm."""
    calls: list[str] = []
    before = threading.active_count()
    assert prewarm.start_prewarm([lambda: calls.append("x")]) is None  # no `enabled`: the environment decides
    assert prewarm.start_prewarm([lambda: calls.append("y")], prewarm.prewarm_enabled()) is None
    assert prewarm.start_prewarm([lambda: calls.append("z")], False) is None
    assert calls == []
    assert threading.active_count() == before


def test_disabled_calls_do_not_use_up_the_once_per_process_start():
    calls: list[str] = []
    assert prewarm.start_prewarm([lambda: calls.append("off")], False) is None
    run_to_end([lambda: calls.append("on")])
    assert calls == ["on"]


@pytest.mark.parametrize("name", ["NQT_DESKTOP", "NQT_PREWARM"])
def test_either_switch_turns_it_on_through_the_environment(monkeypatch, name):
    monkeypatch.setenv(name, "1")
    calls: list[str] = []
    thread = prewarm.start_prewarm([lambda: calls.append("ran")])
    assert thread is not None
    thread.join(WAIT)
    assert calls == ["ran"]


@pytest.mark.parametrize("env", [{}, {"NQT_DESKTOP": "0"}, {"NQT_PREWARM": ""}, {"NQT_DESKTOP": "true"},
                                 {"NQT_PREWARM": "yes"}, {"NQT_DESKTOP": " 1"}, {"NQT_PORT": "1"}])
def test_prewarm_enabled_is_false_unless_a_switch_is_exactly_one(env):
    assert prewarm.prewarm_enabled(env) is False


@pytest.mark.parametrize("env", [{"NQT_DESKTOP": "1"}, {"NQT_PREWARM": "1"},
                                 {"NQT_DESKTOP": "1", "NQT_PREWARM": "0"}, {"NQT_DESKTOP": "0", "NQT_PREWARM": "1"}])
def test_prewarm_enabled_is_true_for_either_switch_at_one(env):
    assert prewarm.prewarm_enabled(env) is True


def test_an_explicit_false_wins_over_the_environment(monkeypatch):
    monkeypatch.setenv("NQT_DESKTOP", "1")
    calls: list[str] = []
    assert prewarm.start_prewarm([lambda: calls.append("x")], False) is None
    assert calls == []


def test_nothing_to_warm_starts_no_thread():
    before = threading.active_count()
    assert prewarm.start_prewarm([], True) is None
    assert threading.active_count() == before


# ---------------------------------------------------------------- after the port is bound


def test_tasks_wait_for_the_ready_signal_then_run():
    ready, calls, ran = threading.Event(), [], threading.Event()

    def task() -> None:
        calls.append("ran")
        ran.set()

    thread = prewarm.start_prewarm([task], True, ready=ready.is_set)
    assert thread is not None
    assert not ran.wait(0.3)  # the port is not bound yet: nothing has started
    assert calls == []
    ready.set()
    assert ran.wait(WAIT)
    thread.join(WAIT)
    assert calls == ["ran"]


def test_a_signal_that_never_comes_does_not_block_the_warm_up_for_ever(caplog):
    calls: list[str] = []
    caplog.set_level(logging.WARNING, logger=prewarm.LOG.name)
    run_to_end([lambda: calls.append("ran")], ready=lambda: False, ready_timeout=0.2)
    assert calls == ["ran"]
    assert "not bound" in caplog.text


def test_a_ready_check_that_raises_is_logged_and_the_warm_up_goes_ahead(caplog, escaped):
    def broken() -> bool:
        raise OSError("socket check failed")

    calls: list[str] = []
    run_to_end([lambda: calls.append("ran")], ready=broken, ready_timeout=0.2)
    assert calls == ["ran"] and escaped == []
