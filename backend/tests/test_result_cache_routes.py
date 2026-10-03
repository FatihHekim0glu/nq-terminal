"""The result cache on the eight slow routes (04 D1.3; 03 item 1.2b and section 5) and, since DEC1, the run index
(02 section 4.1 item 3: HOME asks for it on every launch): cached bodies equal fresh ones.

Each route answers in fixture mode (the fixture folder, the fake catalogue, synthetic bars through the real gate with a
temporary log). For every route: the body served through the cache, on a miss and on a hit, equals the body computed
with the cache switched off, byte for byte; a second request runs nothing (no serve call); touching an input (mtime or
size) makes the next request recompute; a refused request (404, 422, 503) is never stored; the module-level callable
the prewarm calls shares the route's key; the contract is unchanged. Live and clock-dependent routes never touch the
cache, and the detector that proves it was itself born failing on a planted cache.
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.testclient import TestClient

from nq_terminal.api import analytics, data, runs, seasonality, spa
from nq_terminal.services import result_cache as rc
from nq_terminal.settings import TERMINAL_DIR

from fakes import FIXTURES
from fixture_app import create_fixture_app

from conftest import api_client, bare_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
CONTRACT = TERMINAL_DIR / "contract" / "openapi.json"
PACKAGE = TERMINAL_DIR / "backend" / "nq_terminal"
RUNS = "nt_volmanaged_v0_fixture_m1,nt_dtsmom_v0_fixture_ts1"
ONE_DAY = 86_400 * 10**9


class CountingServe:
    """The fixture app's serve with a call counter (what the gate sees, one line in its log per call)."""

    def __init__(self, inner: Callable[..., Any]):
        self._inner = inner
        self.calls = 0
        self._lock = threading.Lock()
        self.hold: threading.Event | None = None
        self.entered = threading.Event()

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            self.calls += 1
        self.entered.set()
        if self.hold is not None:
            self.hold.wait(timeout=20)
        return self._inner(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class Lab:
    """A fixture-mode app over its own copy of the fixture folder and its own state folder."""

    def __init__(self, tmp_path: Path, name: str = "lab", *, state: Path | None = None):
        self.root = tmp_path / name / "fixtures"
        if not self.root.exists():
            shutil.copytree(FIXTURES, self.root)
        self.state = state if state is not None else tmp_path / name / "state"
        self.state.mkdir(parents=True, exist_ok=True)
        self.log = tmp_path / name / "log"
        self.app: FastAPI | None = None
        self.serve: CountingServe | None = None

    def build(self) -> "Lab":
        env = {"NQT_FIXTURE_DIR": str(self.root), "NQT_STATE_DIR": str(self.state)}
        self.app = create_fixture_app(env, log_dir=self.log)
        self.serve = CountingServe(self.app.state.serve_fn)
        self.app.state.serve_fn = self.serve
        return self

    @property
    def client(self) -> TestClient:
        return api_client(self.app, base_url=LOCAL, client=LOOPBACK)

    @property
    def cache(self) -> rc.ResultCache:
        return data.get_result_cache(self.app.state)

    def gate_lines(self) -> int:
        log = self.app.state.fixture_log
        return len(log.read_text(encoding="utf-8").splitlines()) if log.exists() else 0

    def touch(self, relative: str, *, size: bool = False) -> None:
        """Move one input's mtime a day on, or (size=True) grow it by one newline and keep its mtime."""
        path = self.root / relative
        before = path.stat().st_mtime_ns
        if size:
            with open(path, "ab") as handle:
                handle.write(b"\n")
            os.utime(path, ns=(before, before))
        else:
            os.utime(path, ns=(before + ONE_DAY, before + ONE_DAY))


# route name -> (URL, the route key the cache uses, files whose change must invalidate it, a series to touch)
CASES: dict[str, dict[str, Any]] = {
    "compare": {"url": f"/api/runs/compare?ids={RUNS}", "route": rc.ROUTE_COMPARE,
                "files": ["backtests/output/nt_volmanaged_v0_fixture_m1/result.json"], "series": None},
    "ledger": {"url": "/api/ledger", "route": rc.ROUTE_LEDGER, "files": ["results/ledger.csv"], "series": None},
    "two_day": {"url": "/api/market/two-day?symbols=NQ.V.0,ZN.V.0", "route": rc.ROUTE_TWO_DAY, "files": [],
                "series": ("NQ.V.0", "1m", "vendor")},
    "hypothesis_bootstrap": {"url": "/api/analytics/hypothesis/overnight_v0/bootstrap?cost=1",
                             "route": rc.ROUTE_HYPOTHESIS_BOOTSTRAP,
                             "files": ["results/screens/overnight_v0_trades.csv"], "series": None},
    "run_bootstrap": {"url": "/api/analytics/run/nt_za_v0_fixture_a/bootstrap", "route": rc.ROUTE_RUN_BOOTSTRAP,
                      "files": ["backtests/output/nt_za_v0_fixture_a/result.json"], "series": None},
    "deflated": {"url": "/api/analytics/deflated", "route": rc.ROUTE_DEFLATED,
                 "files": ["results/registry.csv"], "series": None},
    "seasonality": {"url": "/api/seasonality/instrument/NQ", "route": rc.ROUTE_SEASONALITY, "files": [],
                    "series": ("NQ.V.0", "1d", "vendor")},
    "spa": {"url": "/api/analytics/spa", "route": rc.ROUTE_SPA, "files": ["results/registry.csv"], "series": None},
    "runs": {"url": "/api/runs", "route": rc.ROUTE_RUNS,
             "files": ["backtests/output/nt_za_v0_fixture_a/result.json", "results/ledger.csv"], "series": None},
}
SLOW_ROUTES = 8  # 03 item 1.2b's eight; the run index is the ninth cached route (DEC1)


@pytest.fixture()
def lab(tmp_path: Path) -> Lab:
    return Lab(tmp_path).build()


def uncached(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the cache off: every get runs its computation (the fresh body)."""

    def passthrough(self, route, query, compute, *, clock_dependent=False, price_free=False):  # noqa: ANN001
        return compute()

    monkeypatch.setattr(rc.ResultCache, "get", passthrough)


def fresh_body(tmp_path: Path, url: str, monkeypatch: pytest.MonkeyPatch) -> tuple[int, bytes]:
    with monkeypatch.context() as patch:
        uncached(patch)
        other = Lab(tmp_path, "fresh").build()
        response = other.client.get(url)
        return response.status_code, response.content


# the bodies that end with a gate block describing the process, not the computation (test_result_cache_gate)
GATED = ("two_day", "seasonality")


def fresh_repeat_body(tmp_path: Path, url: str, monkeypatch: pytest.MonkeyPatch) -> bytes:
    """What a repeat of the request answers with the cache off: the body of the second computation in one process."""
    with monkeypatch.context() as patch:
        uncached(patch)
        other = Lab(tmp_path, "fresh_repeat").build()
        assert other.client.get(url).status_code == 200
        return other.client.get(url).content


def minus_gate(body: bytes) -> dict[str, Any]:
    return {key: value for key, value in json.loads(body).items() if key != "gate"}


# ---------------------------------------------------------------- cached equals fresh, byte for byte


@pytest.mark.parametrize("case", sorted(CASES))
def test_cached_body_equals_the_fresh_body_byte_for_byte(case, lab, tmp_path, monkeypatch):
    spec = CASES[case]
    status, fresh = fresh_body(tmp_path, spec["url"], monkeypatch)
    assert status == 200 and fresh
    first = lab.client.get(spec["url"])
    after_miss = lab.cache.stats()
    second = lab.client.get(spec["url"])
    after_hit = lab.cache.stats()
    assert first.status_code == second.status_code == 200
    assert first.content == fresh, "a miss serves the body the computation made"
    expected = fresh_repeat_body(tmp_path, spec["url"], monkeypatch) if case in GATED else fresh
    assert second.content == expected, "a hit serves the same bytes"
    assert (after_miss.misses, after_miss.uncached, after_miss.entries) == (1, 0, 1), "stored on the first request"
    assert after_hit.hits == after_miss.hits + 1 and after_hit.misses == 1, "the second request ran nothing"
    assert first.headers["content-type"] == "application/json"


@pytest.mark.parametrize("case", ["two_day", "seasonality", "spa", "hypothesis_bootstrap"])
def test_a_hit_makes_no_serve_call_and_writes_no_gate_line(case, lab):
    url = CASES[case]["url"]
    assert lab.client.get(url).status_code == 200
    calls, lines = lab.serve.calls, lab.gate_lines()
    assert lab.client.get(url).status_code == 200
    assert (lab.serve.calls, lab.gate_lines()) == (calls, lines)


def test_the_price_routes_really_read_prices_so_the_zero_above_means_something(lab):
    assert lab.client.get(CASES["two_day"]["url"]).status_code == 200
    assert lab.serve.calls >= 1 and lab.gate_lines() >= 1


# ---------------------------------------------------------------- invalidation


@pytest.mark.parametrize("case", [c for c in sorted(CASES) if CASES[c]["files"]])
@pytest.mark.parametrize("by", ["mtime", "size"])
def test_touching_an_input_file_invalidates_the_entry(case, by, lab):
    spec = CASES[case]
    first = lab.client.get(spec["url"])
    assert first.status_code == 200
    for relative in spec["files"]:
        lab.touch(relative, size=by == "size")
    again = lab.client.get(spec["url"])
    stats = lab.cache.stats()
    assert again.status_code == 200 and again.content == first.content
    assert (stats.misses, stats.hits) == (2, 0), f"a change of the {by} of an input must recompute"
    assert lab.client.get(spec["url"]).content == first.content
    assert lab.cache.stats().hits == 1, "and the recomputed entry serves again"


@pytest.mark.parametrize("case", [c for c in sorted(CASES) if CASES[c]["series"]])
def test_a_new_catalogue_version_of_a_served_series_invalidates_the_entry(case, lab):
    spec = CASES[case]
    assert lab.client.get(spec["url"]).status_code == 200
    calls = lab.serve.calls
    lab.app.state.catalog.touch(*spec["series"])
    assert lab.client.get(spec["url"]).status_code == 200
    stats = lab.cache.stats()
    assert (stats.misses, stats.hits) == (2, 0) and lab.serve.calls > calls


def test_a_new_run_folder_invalidates_the_ledger_entry(lab):
    """The ledger joins its rows to the run index, so the folder listing is an input of the entry."""
    first = lab.client.get("/api/ledger")
    assert first.status_code == 200 and [r["run_found"] for r in first.json()["rows"]] == [True]
    output = lab.root / "backtests" / "output"
    shutil.copytree(output / "nt_za_v0_fixture_a", output / "nt_za_v0_fixture_b")
    again = lab.client.get("/api/ledger")
    assert again.status_code == 200
    stats = lab.cache.stats()
    assert (stats.misses, stats.hits) == (2, 0), "a run folder that appeared must not be served from the old entry"


def test_two_data_roots_sharing_a_state_folder_never_share_an_entry(tmp_path):
    """The key holds the data root: the fixture backend and a real one must not answer each other from the disk."""
    first = Lab(tmp_path, "first").build()
    body = first.client.get("/api/ledger").json()
    assert body["rows"], "the first root's ledger has its row"
    second = Lab(tmp_path, "second", state=first.state)
    (second.root / "results" / "ledger.csv").write_text(
        (first.root / "results" / "ledger.csv").read_text(encoding="utf-8").splitlines()[0] + "\n", encoding="utf-8")
    second.build()
    other = second.client.get("/api/ledger").json()
    assert other["rows"] == [], "the second root has no ledger rows, whatever the first root's entry holds"
    assert second.cache.stats().disk_hits == 0
    assert len(list((first.state / rc.CACHE_FOLDER).glob("*.bin"))) == 2, "one entry for each root"


# ---------------------------------------------------------------- what is not stored


@pytest.mark.parametrize("url,status", [
    ("/api/runs/compare?ids=nt_volmanaged_v0_fixture_m1,no_such_run", 404),
    ("/api/runs/compare?ids=only_one", 422),
    ("/api/market/two-day?symbols=bad", 422),
    ("/api/market/two-day?symbols=NQ.V.0,XX.V.0", 404),
    ("/api/analytics/hypothesis/no_such_hypothesis/bootstrap", 404),
    ("/api/analytics/run/no_such_run/bootstrap", 404),
    ("/api/seasonality/instrument/QQ", 404),
])
def test_a_refused_request_is_never_stored(url, status, lab):
    for _ in range(2):
        assert lab.client.get(url).status_code == status
    stats = lab.cache.stats()
    assert stats.entries == 0 and stats.hits == 0 and not (lab.state / rc.CACHE_FOLDER).exists()


def test_a_failed_computation_is_not_stored_and_the_next_request_retries(lab):
    url = "/api/analytics/run/nt_za_v0_fixture_unbalanced/bootstrap"
    assert lab.client.get(url).status_code == 422
    assert lab.client.get(url).status_code == 422
    assert lab.cache.stats().entries == 0


# ---------------------------------------------------------------- the callables the prewarm shares


def _callable_cases() -> list[tuple[str, Callable[..., bytes], dict[str, Any]]]:
    return [
        ("compare", runs.cached_compare, {"ids": RUNS}),
        ("ledger", runs.cached_ledger, {}),
        ("two_day", data.cached_two_day, {"symbols": "NQ.V.0,ZN.V.0"}),
        ("hypothesis_bootstrap", analytics.cached_hypothesis_bootstrap, {"name": "overnight_v0", "cost": 1}),
        ("run_bootstrap", analytics.cached_run_bootstrap, {"run_id": "nt_za_v0_fixture_a", "freq": "D"}),
        ("deflated", analytics.cached_deflated, {}),
        ("seasonality", seasonality.cached_instrument_seasonality,
         {"root": "NQ", "variant": None, "start_year": 2010, "end_year": 2021}),
        ("spa", spa.cached_spa, {}),
        ("runs", runs.cached_runs, {}),
    ]


@pytest.mark.parametrize("case,function,query", _callable_cases(), ids=[c[0] for c in _callable_cases()])
def test_the_prewarm_callable_and_the_route_share_one_key(case, function, query, lab):
    body = function(lab.app.state, query)
    assert isinstance(body, bytes)
    stats = lab.cache.stats()
    assert (stats.misses, stats.entries) == (1, 1)
    response = lab.client.get(CASES[case]["url"])
    assert response.status_code == 200
    assert (minus_gate(response.content) == minus_gate(body)) if case in GATED else response.content == body
    assert lab.cache.stats().hits == 1 and lab.cache.stats().misses == 1, "the route found the prewarmed entry"


def test_the_prewarm_callable_for_two_day_defaults_to_every_symbol_like_the_route(lab):
    body = data.cached_two_day(lab.app.state, {"symbols": None})
    response = lab.client.get("/api/market/two-day")
    assert minus_gate(response.content) == minus_gate(body) and lab.cache.stats().hits == 1


def test_the_eight_routes_use_only_keys_named_in_cached_routes(lab):
    assert rc.CACHED_ROUTES == {spec["route"] for spec in CASES.values()} and len(rc.CACHED_ROUTES) == SLOW_ROUTES + 1
    for case in CASES.values():
        assert case["route"] in rc.CACHED_ROUTES


# ---------------------------------------------------------------- the contract


def test_the_contract_is_unchanged_for_the_eight_routes(lab):
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    served = lab.app.openapi()
    for route in rc.CACHED_ROUTES:
        assert served["paths"][route] == contract["paths"][route], route
    assert served == contract


# ---------------------------------------------------------------- live and clock-dependent routes

NEVER_CACHED = (
    "/api/health", "/api/live/status", "/api/live/routes", "/api/live/log", "/api/live/journal",
    "/api/live/performance", "/api/ib/snapshot", "/api/jobs", "/api/analytics/paper-tracking",
    "/api/analytics/paper-expectation", "/api/market/paper-rolls",
)
NEVER_CACHED_STREAM = "/api/live/stream"  # a server-sent stream: checked on the source, a request would never end
LIVE_MODULES = ("live.py", "live_stream.py", "system.py", "jobs.py", "ib.py", "paper_expectation.py")
CACHED_CALLABLES = {name for module in (runs, data, analytics, seasonality, spa) for name in dir(module)
                    if name.startswith("cached_") and callable(getattr(module, name))}
CACHE_NAMES = {"result_cache", "get_result_cache", "ResultCache", "cache_for", *CACHED_CALLABLES,
               *{f for f in dir(rc) if f.startswith("ROUTE_")}}


def touches_the_cache(client: TestClient, cache: rc.ResultCache, path: str) -> bool:
    """True when one request to `path` moved any counter of the cache (a hit, miss, uncached or wait)."""
    before = cache.stats()
    client.get(path)
    return cache.stats() != before


def test_the_detector_is_born_failing_on_a_planted_cache(lab):
    planted = FastAPI()

    @planted.get("/api/live/status")
    def live_status(request: Request) -> Response:
        body = data.get_result_cache(lab.app.state).get("/api/live/status", {}, lambda: b'{"clock": 1}')
        return Response(body, media_type="application/json")

    plant_client = bare_client(planted, base_url=LOCAL, client=LOOPBACK)  # a planted app with no session routes
    assert touches_the_cache(plant_client, lab.cache, "/api/live/status") is True


@pytest.mark.parametrize("path", NEVER_CACHED)
def test_a_live_or_clock_route_never_touches_the_cache(path, lab):
    client = lab.client
    assert path in lab.app.openapi()["paths"] or path == "/api/health"
    assert touches_the_cache(client, lab.cache, path) is False
    assert lab.cache.stats().entries == 0 and not (lab.state / rc.CACHE_FOLDER).exists()


def test_the_live_modules_never_name_the_cache(lab):
    for name in LIVE_MODULES:
        tree = ast.parse((PACKAGE / "api" / name).read_text(encoding="utf-8"))
        names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
        names |= {a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
        assert not (names & CACHE_NAMES), name
    assert NEVER_CACHED_STREAM in lab.app.openapi()["paths"] and len(CACHED_CALLABLES) == SLOW_ROUTES + 1


def test_the_cached_routes_and_the_never_cached_lists_do_not_overlap():
    assert not set(NEVER_CACHED) & rc.CACHED_ROUTES and NEVER_CACHED_STREAM not in rc.CACHED_ROUTES


# ---------------------------------------------------------------- the fixture backend's own state folder


def test_the_fixture_app_gets_its_own_temporary_state_folder(tmp_path, monkeypatch):
    monkeypatch.delenv("NQT_STATE_DIR", raising=False)
    monkeypatch.delenv("NQT_PREWARM", raising=False)
    app = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES)}, log_dir=tmp_path / "log")
    state = app.state.settings.state_dir
    real = (TERMINAL_DIR / "state").resolve()
    assert state.is_dir() and not state.resolve().is_relative_to(real) and state.resolve() != real
    assert not state.resolve().is_relative_to(TERMINAL_DIR.resolve())
    other = create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES)}, log_dir=tmp_path / "log2")
    assert other.state.settings.state_dir != state, "one folder per app build"


def test_the_fixture_app_refuses_the_real_state_folder(tmp_path):
    real = TERMINAL_DIR / "state"
    if not real.is_dir():
        pytest.skip("the real state folder does not exist on this machine")
    from fixture_app import FixtureHarnessError

    with pytest.raises(FixtureHarnessError):
        create_fixture_app({"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_STATE_DIR": str(real)}, log_dir=tmp_path)


def test_the_fixture_app_turns_the_prewarm_off(tmp_path, monkeypatch):
    import fixture_app

    monkeypatch.delenv("NQT_PREWARM", raising=False)
    env = fixture_app.fixture_environment({"NQT_FIXTURE_DIR": str(FIXTURES)})
    assert env["NQT_PREWARM"] == "0" and Path(env["NQT_STATE_DIR"]).is_dir()
    assert fixture_app.fixture_environment({"NQT_FIXTURE_DIR": str(FIXTURES), "NQT_PREWARM": "1"})["NQT_PREWARM"] == "0"


def test_a_cached_route_writes_only_under_the_fixture_state_folder(lab):
    real = TERMINAL_DIR / "state"
    before = sorted(p.name for p in real.rglob("*")) if real.exists() else None
    for case in ("ledger", "deflated", "compare"):
        assert lab.client.get(CASES[case]["url"]).status_code == 200
    after = sorted(p.name for p in real.rglob("*")) if real.exists() else None
    assert before == after
    assert (lab.state / rc.CACHE_FOLDER).is_dir()
