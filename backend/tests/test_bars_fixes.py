"""Bars fixes from the Phase 2 QA: rewritten files, session flags, the span cap and the load limit; fixture catalog.

- The year cache key carries the file's (mtime_ns, size), so a processed file rewritten by the repair workflow is
  served again (one logged gate read) instead of the old frame until restart.
- `Bars.sessions` names the sessions `qa.day_gate` rejected (`[GATED]`) and the ones rebuilt from trades
  (`[REPAIRED]`), read from the za_v0 screens' rejected-day files; other symbols say they were not assessed.
- A request may span at most one year of 1m bars and three years of 5m to 4h buckets (422 beyond, before any
  serve); at most `MAX_CONCURRENT_LOADS` gate serves run at once.
- Fixture mode never lists the real processed folder: its catalog is empty unless a harness injects one.
Every price read goes through the fake serve with a temporary log.
"""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.config import RESULTS
from nq_terminal.app import create_app
from nq_terminal.services import bars as bars_mod
from nq_terminal.services.bars import BarService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
UTC = "UTC"
BIG = 2**31


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=UTC)


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


def client_for(env: dict, serve=None, catalog=None) -> TestClient:
    app = create_app(load_settings(env))
    if serve is not None:
        app.state.serve_fn = serve
    if catalog is not None:
        app.state.catalog = catalog
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


def get_bars(client: TestClient, **params):
    return client.get("/api/bars", params={"symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", **params})


# ---------------------------------------------------------------- rewritten files


def test_a_new_file_version_is_served_again(fake):
    svc = BarService(fake, cache_bytes=BIG)
    for _ in range(3):
        svc.frame("NQ.V.0", "1m", "vendor", ts("2019-06-10"), ts("2019-06-11"), version=(1, 100))
    assert len(fake.served) == 1
    served = svc.frame("NQ.V.0", "1m", "vendor", ts("2019-06-10"), ts("2019-06-11"), version=(2, 100))
    assert served.cached is False and len(fake.served) == 2


def test_the_api_passes_the_catalog_version(fake):
    catalog = FakeCatalog()
    c = client_for({"NQT_FIXTURE_DIR": str(FIXTURES)}, fake, catalog)
    assert get_bars(c, start="2019-06-10", end="2019-06-11").json()["gate"]["cached"] is False
    assert get_bars(c, start="2019-06-10", end="2019-06-11").json()["gate"]["cached"] is True
    catalog.touch("NQ.V.0", "1m", "vendor")
    assert get_bars(c, start="2019-06-10", end="2019-06-11").json()["gate"]["cached"] is False
    assert len(fake.served) == 2


# ---------------------------------------------------------------- session flags


def _dates(name: str) -> list[str]:
    return sorted(json.loads((RESULTS / "screens" / name).read_text(encoding="utf-8")))


def test_nq_sessions_carry_gated_and_repaired_flags(fake):
    c = client_for({}, fake)
    vendor = get_bars(c, start="2011-01-01", end="2012-01-01").json()["sessions"]
    gated = [d for d in _dates("za_v0_rejected_days.json") if d.startswith("2011")]
    assert vendor["assessed"] is True and vendor["gated"] == gated and gated and vendor["repaired"] == []
    repaired = get_bars(c, variant="repaired", start="2011-01-01", end="2012-01-01").json()["sessions"]
    still = [d for d in _dates("za_v0_repaired_rejected_days.json") if d.startswith("2011")]
    assert repaired["gated"] == still
    assert repaired["repaired"] == sorted(set(gated) - set(still)) and repaired["repaired"]


def test_other_symbols_are_not_assessed(fake):
    c = client_for({}, fake)
    body = get_bars(c, symbol="ES.V.0", start="2019-06-10", end="2019-06-11").json()["sessions"]
    assert body == {"assessed": False, "source": None, "gated": [], "repaired": []}


# ---------------------------------------------------------------- span cap and load limit


@pytest.mark.parametrize("timeframe, start, end", [("1m", "2017-01-01", "2019-01-02"),
                                                   ("5m", "2012-01-01", "2016-01-01"),
                                                   ("4h", "2010-01-01", "2021-01-01")])
def test_a_span_past_the_cap_is_refused_before_any_serve(fake, timeframe, start, end):
    c = client_for({"NQT_FIXTURE_DIR": str(FIXTURES)}, fake, FakeCatalog())
    r = get_bars(c, timeframe=timeframe, start=start, end=end)
    assert r.status_code == 422 and "span" in r.json()["detail"]
    assert fake.calls == ()


def test_the_daily_series_and_the_default_window_stay_allowed(fake):
    c = client_for({"NQT_FIXTURE_DIR": str(FIXTURES)}, fake, FakeCatalog())
    assert get_bars(c, timeframe="1d").status_code == 200
    assert get_bars(c, timeframe="1m", end="2019-06-11").status_code == 200


def test_gate_serves_run_at_most_two_at_a_time(fake):
    running, peak, lock = [0], [0], threading.Lock()

    def slow(*args, **kwargs):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        time.sleep(0.05)
        try:
            return fake(*args, **kwargs)
        finally:
            with lock:
                running[0] -= 1

    svc = BarService(slow, cache_bytes=BIG)
    years = range(2012, 2018)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda y: svc.frame("NQ.V.0", "1m", "vendor", ts(f"{y}-06-10"), ts(f"{y}-06-11")), years))
    assert peak[0] <= bars_mod.MAX_CONCURRENT_LOADS == 2
    assert len(fake.served) == len(years)


# ---------------------------------------------------------------- fixture catalog


def test_fixture_mode_never_lists_the_real_processed_folder():
    body = client_for({"NQT_FIXTURE_DIR": str(FIXTURES)}).get("/api/data/catalog").json()
    assert body["series"] == [] and body["unrecognised"] == []
