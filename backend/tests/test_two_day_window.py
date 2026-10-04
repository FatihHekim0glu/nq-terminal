"""The two-day sparkline reads its exact window in desktop mode (W5C D1).

In the app (desktop mode) `/api/market/two-day` serves `[last_sessions()[0] - SESSION_SHIFT, IS_END)` for each symbol
once and keeps no 1m year in the bar cache: a 1m 2021 year was about 24 MB a symbol, read for a sparkline of two
sessions and never reused. A year frame that is already cached is still used (a hit, no serve). The serve keeps the
year's cache key, so the reason the gate logs is unchanged. The browser and launcher forms keep the year-aligned read
(PRD DL1), so their behaviour and budgets do not change.

What is proved here: the desktop app holds no 1m frame after the two-day reads and its bar bytes stay small; each
symbol is served once over the exact window with caller "terminal" and the year's reason; a cached year is used; the
desktop body equals the browser body byte for byte outside the gate's process fields, with the same years served and
the same number of gate lines per symbol; the hourly closes do not depend on which frame they came from, even for rows
whose raw close is missing; the browser form still caches the year. Every price comes from the fake serve over the real
gate with a temporary log.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import IS_END
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.api import data
from nq_terminal.services import bars as bars_module
from nq_terminal.services import result_cache
from nq_terminal.services.bars import BarService, CacheKey, counted_serve

from fakes import make_fake_serve
from fixture_app import create_fixture_app
from test_result_cache_routes import CountingServe, Lab

DESKTOP_TEST_PORT = "8799"  # a number for the session origin only; the test client never binds a port
MAX_DESKTOP_BAR_BYTES = 16 * 1024**2
TWO_DAY = "/api/market/two-day"
NQ = "NQ.V.0"
SINGLES = ("NQ.V.0", "ZN.V.0", "CL.V.0")
GATE_MEMBER = b',"gate":'


class FormLab(Lab):
    """A fixture lab in desktop mode (the app) or in the browser form (the default `Lab`)."""

    def __init__(self, tmp_path: Path, name: str, *, desktop: bool):
        super().__init__(tmp_path, name)
        self.desktop = desktop

    def build(self) -> "FormLab":
        env = {"NQT_FIXTURE_DIR": str(self.root), "NQT_STATE_DIR": str(self.state)}
        if self.desktop:
            env.update({"NQT_DESKTOP": "1", "NQT_PORT": DESKTOP_TEST_PORT})
        self.app = create_fixture_app(env, log_dir=self.log)
        self.serve = CountingServe(self.app.state.serve_fn)
        self.app.state.serve_fn = self.serve
        return self

    @property
    def fake(self):
        return self.serve._inner.base  # CountingServe -> ChainServe -> FakeServe (the call log)

    def bar_service(self) -> BarService:
        return data.services_for(self.app.state).bars

    def minute_keys(self) -> list[CacheKey]:
        return [key for key in self.bar_service()._entries if key.timeframe == "1m"]

    def log_lines(self) -> list[dict]:
        log = self.app.state.fixture_log
        if not log.exists():
            return []
        return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines() if x.strip()]


@pytest.fixture
def desktop(tmp_path: Path) -> FormLab:
    return FormLab(tmp_path, "desktop", desktop=True).build()


@pytest.fixture
def browser(tmp_path: Path) -> FormLab:
    return FormLab(tmp_path, "browser", desktop=False).build()


def two_day_body(lab: FormLab, symbols: str | None = None) -> bytes:
    client = lab.client
    response = client.get(TWO_DAY, params={} if symbols is None else {"symbols": symbols})
    assert response.status_code == 200, response.text
    return response.content


def outside_gate(body: bytes) -> bytes:
    cut = body.rfind(GATE_MEMBER)
    assert cut > 0
    return body[:cut]


def gate_of(body: bytes) -> dict:
    return json.loads(body)["gate"]


def expected_reason(symbol: str) -> str:
    return f"terminal display: {symbol} 1m vendor 2021 (chart only, not a registered test)"


def window_start() -> pd.Timestamp:
    return data.last_sessions()[0] - data.SESSION_SHIFT


def universe() -> list[str]:
    return [f"{c.root}.V.0" for c in TABLE]


# ---------------------------------------------------------------- the desktop app keeps no minute year


def test_desktop_two_day_keeps_no_minute_year(desktop):
    two_day_body(desktop, NQ)
    two_day_body(desktop)
    assert desktop.app.state.settings.mode == "desktop"
    assert desktop.minute_keys() == [], "a two-day read kept a 1m year in the bar cache"
    health = desktop.client.get("/api/health").json()
    assert health["cache"]["bytes"] < MAX_DESKTOP_BAR_BYTES


def test_desktop_two_day_serves_exact_window(desktop):
    two_day_body(desktop)
    minute_calls = [c for c in desktop.fake.calls if c.timeframe == "1m"]
    per_symbol = Counter(c.symbol for c in minute_calls)
    assert set(per_symbol) == set(universe()) and set(per_symbol.values()) == {1}
    for call in minute_calls:
        assert call.start == window_start() and call.end == IS_END
        assert call.caller == "terminal" and call.refused is None
        assert call.reason == expected_reason(call.symbol)


def test_desktop_two_day_uses_cached_year_on_hit(desktop):
    warm = desktop.client.get("/api/bars", params={"symbol": NQ, "timeframe": "1m", "variant": "vendor",
                                                   "start": "2021-06-01", "end": "2021-06-02"})
    assert warm.status_code == 200
    calls_before = len(desktop.fake.calls)
    body = two_day_body(desktop, NQ)
    assert len(desktop.fake.calls) == calls_before, "a cached year was served again"
    assert gate_of(body)["cached"] is True


def test_desktop_bars_route_still_keeps_the_year(desktop):
    """The exception is the two-day read alone: GP's own 1m reads in the app stay year-aligned and cached (DL1)."""
    params = {"symbol": NQ, "timeframe": "1m", "variant": "vendor", "start": "2021-06-01", "end": "2021-06-02"}
    assert desktop.client.get("/api/bars", params=params).status_code == 200
    assert [(k.symbol, k.year) for k in desktop.minute_keys()] == [(NQ, 2021)]


def test_desktop_two_day_repeat_is_a_result_cache_hit_with_no_serve(desktop):
    two_day_body(desktop, NQ)
    calls_before = len(desktop.fake.calls)
    two_day_body(desktop, NQ)
    assert len(desktop.fake.calls) == calls_before


# ---------------------------------------------------------------- the two forms agree (guards)


@pytest.mark.parametrize("symbols", [None, *SINGLES, ",".join(SINGLES)])
def test_two_day_body_equal_across_forms(tmp_path, symbols):
    app_form = FormLab(tmp_path, "desktop", desktop=True).build()
    page_form = FormLab(tmp_path, "browser", desktop=False).build()
    desktop_body, browser_body = two_day_body(app_form, symbols), two_day_body(page_form, symbols)
    assert outside_gate(desktop_body) == outside_gate(browser_body)
    assert gate_of(desktop_body)["served_years"] == gate_of(browser_body)["served_years"]
    assert gate_of(desktop_body)["caller"] == gate_of(browser_body)["caller"] == "terminal"
    lines_desktop = Counter(line["symbol"] for line in app_form.log_lines())
    lines_browser = Counter(line["symbol"] for line in page_form.log_lines())
    assert lines_desktop == lines_browser and sum(lines_desktop.values()) > 0


class GappedServe:
    """The fake serve with the raw close and offset of some 1m rows removed, as the repaired file stores them for the
    sessions rebuilt from trades: every row of one contract inside the two-day window, and every seventh minute of
    the rest of December. The back-adjusted prices stay as served."""

    def __init__(self, inner):
        self.inner = inner
        self.calls = 0

    def __call__(self, start, end, **kwargs):
        self.calls += 1
        frame = self.inner(start, end, **kwargs).copy()
        if frame.empty or kwargs.get("timeframe") != "1m":
            return frame
        ts = frame["ts"]
        in_window = (ts >= window_start()).to_numpy()
        target = frame.loc[in_window, "instrument_id"].iloc[0] if in_window.any() else None
        december = (ts >= pd.Timestamp("2021-12-01", tz="UTC")).to_numpy()
        minute = (ts.dt.minute % 7 == 0).to_numpy()
        gap = (in_window & (frame["instrument_id"] == target).to_numpy()) | (december & ~in_window & minute)
        frame.loc[gap, ["raw_c", "offset"]] = np.nan
        return frame


def test_two_day_vendor_close_unchanged_by_window(tmp_path):
    fake = make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")
    year_service = BarService(counted_serve(GappedServe(fake)), cache_bytes=2 * 1024**3)
    narrow_service = BarService(counted_serve(GappedServe(fake)), cache_bytes=2 * 1024**3)
    sessions = data.last_sessions()
    kwargs = {"symbol": NQ, "variant": "vendor", "start": window_start(), "end": IS_END, "version": (1, 1)}
    year_bars = year_service.bars(timeframe=data.TWO_DAY_TF, **kwargs)
    narrow_bars = narrow_service.bars(timeframe=data.TWO_DAY_TF, keep=False, **kwargs)
    assert narrow_bars.t == year_bars.t and narrow_bars.c == year_bars.c
    assert narrow_bars.o == year_bars.o and narrow_bars.h == year_bars.h and narrow_bars.l == year_bars.l
    assert narrow_bars.years == year_bars.years == (2021,)
    assert data.two_day_row(narrow_bars, NQ, sessions) == data.two_day_row(year_bars, NQ, sessions)
    # The scenario is real: the year frame fills raw closes from the contract's offset elsewhere in the year, the
    # narrow frame cannot, and the closes above are equal all the same.
    year_frame = year_service.frame(NQ, "1m", "vendor", window_start(), IS_END, version=(1, 1)).frame
    narrow_frame = narrow_service.frame(NQ, "1m", "vendor", window_start(), IS_END, version=(1, 1), keep=False).frame
    assert narrow_frame["c"].tolist() == year_frame["c"].tolist()
    assert int(narrow_frame["raw_c"].isna().sum()) > int(year_frame["raw_c"].isna().sum())


def test_browser_two_day_still_caches_year(browser):
    two_day_body(browser, NQ)
    assert browser.app.state.settings.mode == "browser"
    assert [(k.symbol, k.year) for k in browser.minute_keys()] == [(NQ, 2021)]
    [call] = [c for c in browser.fake.calls if c.timeframe == "1m"]
    assert call.start == pd.Timestamp("2021-01-01", tz="UTC") and call.end == IS_END
    assert call.reason == expected_reason(NQ)


# ---------------------------------------------------------------- the non-retaining read in the service


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl")


@pytest.fixture
def svc(fake) -> BarService:
    return BarService(counted_serve(fake), cache_bytes=2 * 1024**3)


def narrow(service: BarService, **overrides):
    args = {"symbol": NQ, "source_tf": "1m", "variant": "vendor", "start": window_start(), "end": IS_END,
            "version": (1, 1), **overrides}
    return service.frame(args.pop("symbol"), args.pop("source_tf"), args.pop("variant"), args.pop("start"),
                         args.pop("end"), keep=False, **args)


def test_the_narrow_read_on_a_miss_serves_the_window_stores_nothing_and_reports_a_miss(svc, fake):
    served = narrow(svc)
    assert served.cached is False and served.years == (2021,)
    assert svc.stats() == (1, 0, 0)
    [call] = fake.calls
    assert (call.start, call.end, call.reason) == (window_start(), IS_END, expected_reason(NQ))
    assert not served.frame.empty and served.frame["ts"].min() >= window_start()
    assert served.frame["ts"].max() < IS_END


def test_the_narrow_read_equals_the_year_read_sliced(svc, fake):
    narrow_frame = narrow(svc).frame.reset_index(drop=True)
    year_frame = svc.frame(NQ, "1m", "vendor", window_start(), IS_END, version=(1, 1)).frame.reset_index(drop=True)
    pd.testing.assert_frame_equal(narrow_frame, year_frame)


def test_the_narrow_read_uses_a_cached_year_and_serves_nothing(svc, fake):
    svc.frame(NQ, "1m", "vendor", pd.Timestamp("2021-03-01", tz="UTC"), pd.Timestamp("2021-03-02", tz="UTC"),
              version=(1, 1))
    served = narrow(svc)
    assert served.cached is True and len(fake.calls) == 1


def test_a_second_narrow_read_serves_again_because_nothing_was_kept(svc, fake):
    narrow(svc)
    narrow(svc)
    assert len(fake.calls) == 2 and svc.stats()[1:] == (0, 0)


def test_the_narrow_read_records_the_gate_read_and_moves_the_serve_counter(fake, monkeypatch):
    recorded, bumps = [], []
    real_record, real_bump = result_cache.record_gate_read, result_cache.bump_serve_count
    monkeypatch.setattr(result_cache, "record_gate_read", lambda *a: (recorded.append(a), real_record(*a)))
    monkeypatch.setattr(result_cache, "bump_serve_count", lambda: (bumps.append(1), real_bump()))
    narrow(BarService(counted_serve(fake), cache_bytes=2 * 1024**3))
    narrow_bumps = len(bumps)
    BarService(counted_serve(fake), cache_bytes=2 * 1024**3).frame(NQ, "1m", "vendor", window_start(), IS_END,
                                                                    version=(1, 1))
    assert recorded == [(NQ, "1m", "vendor", (1, 1))] * 2
    assert narrow_bumps == len(bumps) - narrow_bumps >= 6  # entry and exit of the read, the load and the serve
    assert narrow_bumps % 2 == 0


def test_the_narrow_read_never_stores(svc, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the narrow read stored a frame")

    monkeypatch.setattr(svc, "_store", refuse)
    narrow(svc)


def test_the_narrow_read_is_refused_past_the_fence_before_any_serve(svc, fake):
    with pytest.raises(bars_module.GateRefusal):
        narrow(svc, end=IS_END + pd.Timedelta(days=1))
    assert fake.calls == ()


def test_bars_with_keep_false_report_a_miss_then_the_default_keeps_the_year(svc, fake):
    first = svc.bars(NQ, "1h", "vendor", window_start(), IS_END, version=(1, 1), keep=False)
    assert first.cached is False and svc.stats()[1] == 0
    kept = svc.bars(NQ, "1h", "vendor", window_start(), IS_END, version=(1, 1))
    assert kept.cached is False and svc.stats()[1] == 1 and kept.c == first.c
