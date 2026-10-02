"""Single-flight per key in the result cache (04 D1.3; 02 section 4.1 item 2; 03 section 15.2).

A request that races another request, or the prewarm, for the same key waits for the one computation: one serve call,
one gate line, one body for both. Different keys never wait for each other. A computation that fails is not stored; its
waiters get the same refusal (an ordinary exception) or run the work again (an interruption of the thread that led).
Each guard was born failing: without `_join` the two-request test makes two serve calls.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from nq_terminal.api import data
from nq_terminal.services import result_cache as rc
from nq_terminal.services.files import FileCache

from test_result_cache_routes import CASES, GATED, Lab, minus_gate

TWO_DAY_URL = "/api/market/two-day?symbols=NQ.V.0"
ROUTE = "/api/analytics/deflated"
WAIT_S = 10.0


@pytest.fixture()
def cache_and_file(tmp_path: Path):
    results, state = tmp_path / "results", tmp_path / "state"
    results.mkdir()
    state.mkdir()
    path = results / "trials.json"
    path.write_text('{"v": 1}', encoding="utf-8")
    return rc.ResultCache(state_dir=state), FileCache(roots=[results]), path


def _wait_for(predicate, timeout: float = WAIT_S) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


class Gate:
    """A computation that blocks until released, and counts how often it ran."""

    def __init__(self, files: FileCache | None = None, path: Path | None = None, body: bytes = b'{"ok": 1}'):
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()
        self._files, self._path, self._body = files, path, body
        self._lock = threading.Lock()

    def __call__(self) -> bytes:
        with self._lock:
            self.calls += 1
        self.entered.set()
        assert self.release.wait(WAIT_S), "the test never released the computation"
        if self._files is not None:
            self._files.read_json(self._path)
        return self._body


def test_racing_requests_for_one_key_run_the_computation_once(cache_and_file):
    cache, files, path = cache_and_file
    gate = Gate(files, path)
    with ThreadPoolExecutor(max_workers=6) as pool:
        first = pool.submit(cache.get, ROUTE, {"a": 1}, gate)
        assert gate.entered.wait(WAIT_S)
        others = [pool.submit(cache.get, ROUTE, {"a": 1}, gate) for _ in range(5)]
        assert _wait_for(lambda: cache.stats().waited == 5), "the five racers wait for the one computation"
        assert gate.calls == 1
        gate.release.set()
        bodies = {first.result(WAIT_S), *(f.result(WAIT_S) for f in others)}
    assert bodies == {b'{"ok": 1}'} and gate.calls == 1
    stats = cache.stats()
    assert (stats.misses, stats.waited, stats.entries) == (1, 5, 1)


def test_born_failing_without_the_join_every_racer_computes(cache_and_file, monkeypatch):
    """The same race with the join switched off: this is the failure the single-flight prevents."""
    cache, files, path = cache_and_file
    gate = Gate(files, path)
    monkeypatch.setattr(rc.ResultCache, "_join", lambda self, key: (rc._Flight(threading.get_ident()), True))
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(cache.get, ROUTE, {"a": 1}, gate) for _ in range(3)]
        assert _wait_for(lambda: gate.calls == 3), "every racer ran the computation itself"
        gate.release.set()
        [f.result(WAIT_S) for f in futures]
    assert gate.calls == 3


def test_a_waiter_that_arrives_after_the_result_is_stored_takes_it_from_memory(cache_and_file):
    cache, files, path = cache_and_file
    gate = Gate(files, path)
    gate.release.set()
    cache.get(ROUTE, {"a": 1}, gate)
    cache.get(ROUTE, {"a": 1}, gate)
    stats = cache.stats()
    assert (gate.calls, stats.hits, stats.waited) == (1, 1, 0)


def test_different_keys_do_not_wait_for_each_other(cache_and_file):
    cache, files, path = cache_and_file
    slow = Gate(files, path, b'{"k": "slow"}')
    with ThreadPoolExecutor(max_workers=2) as pool:
        held = pool.submit(cache.get, ROUTE, {"k": "slow"}, slow)
        assert slow.entered.wait(WAIT_S)
        quick = Gate(files, path, b'{"k": "quick"}')
        quick.release.set()
        assert cache.get(ROUTE, {"k": "quick"}, quick) == b'{"k": "quick"}', "not blocked by the other key"
        assert not held.done()
        slow.release.set()
        assert held.result(WAIT_S) == b'{"k": "slow"}'
    assert cache.stats().waited == 0


def test_an_ordinary_failure_reaches_every_waiter_and_is_not_stored(cache_and_file):
    cache, _, _ = cache_and_file
    entered, release, calls = threading.Event(), threading.Event(), []

    def failing() -> bytes:
        calls.append(1)
        entered.set()
        release.wait(WAIT_S)
        raise ValueError("a source could not be read")

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(cache.get, ROUTE, {"a": 1}, failing)]
        assert entered.wait(WAIT_S)
        futures += [pool.submit(cache.get, ROUTE, {"a": 1}, failing) for _ in range(3)]
        assert _wait_for(lambda: cache.stats().waited == 3)
        release.set()
        for future in futures:
            with pytest.raises(ValueError, match="could not be read"):
                future.result(WAIT_S)
    assert len(calls) == 1 and cache.stats().entries == 0
    with pytest.raises(ValueError):
        cache.get(ROUTE, {"a": 1}, failing)
    assert len(calls) == 2, "the next request starts again"


class Interrupted(BaseException):
    """What ends a thread's work without being an error of the computation (not an Exception)."""


def test_an_interrupted_leader_leaves_the_waiters_to_run_the_work_again(cache_and_file):
    cache, files, path = cache_and_file
    entered, release, calls = threading.Event(), threading.Event(), []

    def compute() -> bytes:
        calls.append(threading.get_ident())
        if len(calls) == 1:
            entered.set()
            release.wait(WAIT_S)
            raise Interrupted()
        files.read_json(path)
        return b'{"again": 1}'

    with ThreadPoolExecutor(max_workers=2) as pool:
        leader = pool.submit(cache.get, ROUTE, {"a": 1}, compute)
        assert entered.wait(WAIT_S)
        waiter = pool.submit(cache.get, ROUTE, {"a": 1}, compute)
        assert _wait_for(lambda: cache.stats().waited == 1)
        release.set()
        with pytest.raises(Interrupted):
            leader.result(WAIT_S)
        assert waiter.result(WAIT_S) == b'{"again": 1}'
    assert len(calls) == 2


def test_the_same_thread_asking_for_its_own_key_does_not_deadlock(cache_and_file):
    cache, files, path = cache_and_file

    def outer() -> bytes:
        files.read_json(path)
        return cache.get(ROUTE, {"a": 1}, lambda: b'{"inner": 1}')  # the same key, from inside its own computation

    result: list[bytes] = []
    worker = threading.Thread(target=lambda: result.append(cache.get(ROUTE, {"a": 1}, outer)), daemon=True)
    worker.start()
    worker.join(WAIT_S)
    assert not worker.is_alive(), "a computation that asks for its own key must not wait for itself"
    assert result == [b'{"inner": 1}']


def test_a_waiter_hands_the_inputs_of_the_shared_computation_to_its_enclosing_one(cache_and_file):
    cache, files, path = cache_and_file
    gate = Gate(files, path)
    other = path.parent / "other.json"
    other.write_text('{"v": 2}', encoding="utf-8")

    def outer() -> bytes:
        files.read_json(other)
        return cache.get(ROUTE, {"inner": 1}, gate)

    with ThreadPoolExecutor(max_workers=2) as pool:
        leader = pool.submit(cache.get, ROUTE, {"inner": 1}, gate)
        assert gate.entered.wait(WAIT_S)
        enclosing = pool.submit(cache.get, "/api/runs", {"outer": 1}, outer)
        assert _wait_for(lambda: cache.stats().waited == 1)
        gate.release.set()
        leader.result(WAIT_S), enclosing.result(WAIT_S)
    path.write_text('{"v": 3}', encoding="utf-8")  # the inner computation's input, read by the leader thread only
    cache.get("/api/runs", {"outer": 1}, lambda: b"fresh")
    assert cache.stats().misses == 3, "the enclosing entry went stale with the input the waiter never read itself"


# ---------------------------------------------------------------- through the routes and the shared callable
#
# The bar service already keeps two loads of one frame apart, so the serve count alone cannot tell a joined computation
# from a repeated one. The proof is the number of times the route's own computation runs (`data.two_day_row` is called
# once per symbol by it) next to the serve count and the gate lines.


def count_rows(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    seen: list[int] = []
    real = data.two_day_row

    def spy(*args, **kwargs):
        seen.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(data, "two_day_row", spy)
    return seen


def one_computation(tmp_path: Path) -> tuple[int, int]:
    """(serve calls, gate lines) of one request for the two-day route on its own."""
    single = Lab(tmp_path, "single").build()
    assert single.client.get(TWO_DAY_URL).status_code == 200
    assert single.serve.calls >= 1 and single.gate_lines() >= 1
    return single.serve.calls, single.gate_lines()


def race_two_requests(lab: Lab, *, joined: bool) -> list:
    lab.serve.hold = threading.Event()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(lambda: lab.client.get(TWO_DAY_URL))
        assert lab.serve.entered.wait(WAIT_S)
        second = pool.submit(lambda: lab.client.get(TWO_DAY_URL))
        if joined:
            assert _wait_for(lambda: lab.cache.stats().waited == 1), "the second request waits for the first"
        else:
            time.sleep(0.5)
        lab.serve.hold.set()
        return [first.result(WAIT_S), second.result(WAIT_S)]


def test_two_requests_for_one_key_make_one_serve_call_and_one_gate_line(tmp_path, monkeypatch):
    calls, lines = one_computation(tmp_path)
    rows = count_rows(monkeypatch)
    lab = Lab(tmp_path, "race").build()
    first, second = race_two_requests(lab, joined=True)
    # the waiter's gate block is made current (test_result_cache_gate); everything before it is the leader's bytes
    assert first.status_code == second.status_code == 200 and minus_gate(first.content) == minus_gate(second.content)
    assert (lab.serve.calls, lab.gate_lines()) == (calls, lines), "one serve call, one gate line"
    assert len(rows) == 1, "one computation of the route for the two requests"
    stats = lab.cache.stats()
    assert (stats.misses, stats.waited) == (1, 1)


def test_born_failing_without_the_join_two_requests_compute_twice(tmp_path, monkeypatch):
    rows = count_rows(monkeypatch)
    monkeypatch.setattr(rc.ResultCache, "_join", lambda self, key: (rc._Flight(threading.get_ident()), True))
    lab = Lab(tmp_path, "race").build()
    first, second = race_two_requests(lab, joined=False)
    assert first.status_code == second.status_code == 200
    assert len(rows) == 2, "this is what the single-flight prevents"


def test_a_request_racing_the_prewarm_callable_waits_for_it(tmp_path, monkeypatch):
    calls, lines = one_computation(tmp_path)
    rows = count_rows(monkeypatch)
    lab = Lab(tmp_path, "race").build()
    lab.serve.hold = threading.Event()
    with ThreadPoolExecutor(max_workers=2) as pool:
        warm = pool.submit(data.cached_two_day, lab.app.state, {"symbols": "NQ.V.0"})
        assert lab.serve.entered.wait(WAIT_S)
        request = pool.submit(lambda: lab.client.get(TWO_DAY_URL))
        assert _wait_for(lambda: lab.cache.stats().waited == 1)
        lab.serve.hold.set()
        body, response = warm.result(WAIT_S), request.result(WAIT_S)
    assert response.status_code == 200 and minus_gate(response.content) == minus_gate(body)
    assert (lab.serve.calls, lab.gate_lines(), len(rows)) == (calls, lines, 1)


@pytest.mark.parametrize("name", ["deflated", "spa", "seasonality", "hypothesis_bootstrap"])
def test_every_route_joins_a_running_computation_of_its_key(name, tmp_path, monkeypatch):
    """Hold the first computation inside the cache (its input read is the pause), send the second request."""
    lab = Lab(tmp_path, f"join-{name}").build()
    url = CASES[name]["url"]
    entered, release = threading.Event(), threading.Event()
    real = rc.ResultCache._compute

    def paused(self, compute, *options):  # noqa: ANN001 - holds the leader before it computes, so the second request must join
        entered.set()
        assert release.wait(WAIT_S)
        return real(self, compute, *options)

    monkeypatch.setattr(rc.ResultCache, "_compute", paused)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(lambda: lab.client.get(url))
        assert entered.wait(WAIT_S)
        second = pool.submit(lambda: lab.client.get(url))
        assert _wait_for(lambda: lab.cache.stats().waited == 1), name
        release.set()
        a, b = first.result(WAIT_S), second.result(WAIT_S)
    assert a.status_code == b.status_code == 200, name
    assert (minus_gate(a.content) == minus_gate(b.content)) if name in GATED else a.content == b.content, name
    stats = lab.cache.stats()
    assert (stats.misses, stats.waited) == (1, 1), name
