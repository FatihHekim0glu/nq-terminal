"""BarService (TASKS 2.3): the year-aligned gated cache, the friendly refusal, OHLCV buckets and roll markers.

Every read goes through `fakes.make_fake_serve`, which calls the real `oos_gate.serve_bars` with a temporary log
and a synthetic loader, so the gate's own rules (window, caller, reason) are exercised exactly.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_lab import oos_gate
from nq_lab.config import IS_END, IS_START, MIN_REASON_CHARS
from nq_terminal.services import bars as bars_mod
from nq_terminal.services.bars import CALLER, BarService, GateRefusal, UnknownSeries

from fakes import make_fake_serve, synthetic_loader

UTC = "UTC"
DAY = pd.Timedelta(days=1)
BIG = 2**31


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=UTC)


@pytest.fixture
def fake(tmp_path: Path):
    return make_fake_serve(tmp_path / "oos_access_log.jsonl")


@pytest.fixture
def svc(fake) -> BarService:
    return BarService(fake, cache_bytes=BIG)


def log_lines(fake) -> list[dict]:
    path = fake.log_path
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


# ---------------------------------------------------------------- the year-aligned cache

def test_fifty_requests_inside_one_year_make_exactly_one_serve(svc, fake):
    for i in range(50):
        start = ts("2019-02-01") + i * DAY
        svc.bars("NQ.V.0", "1m", "vendor", start, start + DAY, max_points=4000)
    assert len(fake.calls) == 1
    assert fake.loader_calls == 1
    assert len(log_lines(fake)) == 1
    call = fake.calls[0]
    assert (call.start, call.end) == (ts("2019-01-01"), ts("2020-01-01"))


def test_fifty_concurrent_requests_inside_one_year_make_one_serve(svc, fake):
    starts = [ts("2018-03-01") + i * DAY for i in range(50)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda s: svc.bars("NQ.V.0", "5m", "vendor", s, s + DAY, max_points=4000), starts))
    assert len(fake.calls) == 1 and fake.loader_calls == 1


def test_born_failing_without_the_cache_every_request_serves(fake):
    """A cache too small to hold a year proves the one-serve test above can fail."""
    tiny = BarService(fake, cache_bytes=1)
    for i in range(5):
        start = ts("2019-02-01") + i * DAY
        tiny.bars("NQ.V.0", "1m", "vendor", start, start + DAY, max_points=4000)
    assert len(fake.calls) == 5


def test_a_window_across_new_year_serves_each_year_once(svc, fake):
    svc.bars("NQ.V.0", "1m", "vendor", ts("2016-12-30"), ts("2017-01-04"), max_points=20000)
    svc.bars("NQ.V.0", "1m", "vendor", ts("2016-06-01"), ts("2016-06-02"), max_points=4000)
    svc.bars("NQ.V.0", "1h", "vendor", ts("2017-03-01"), ts("2017-03-09"), max_points=4000)
    assert [(c.start, c.end) for c in fake.calls] == [(ts("2016-01-01"), ts("2017-01-01")),
                                                      (ts("2017-01-01"), ts("2018-01-01"))]


def test_series_and_variants_are_cached_separately(svc, fake):
    for variant in ("vendor", "repaired", "vendor"):
        svc.bars("NQ.V.0", "1m", variant, ts("2015-05-04"), ts("2015-05-05"), max_points=4000)
    svc.bars("ES.V.0", "1m", "vendor", ts("2015-05-04"), ts("2015-05-05"), max_points=4000)
    assert [(c.symbol, c.variant) for c in fake.calls] == [("NQ.V.0", "vendor"), ("NQ.V.0", "repaired"),
                                                           ("ES.V.0", "vendor")]


def test_daily_bars_are_served_once_for_the_whole_in_sample_window(svc, fake):
    svc.bars("NQ.V.0", "1d", "vendor", ts("2012-01-01"), ts("2013-01-01"), max_points=4000)
    svc.bars("NQ.V.0", "1d", "vendor", ts("2019-01-01"), ts("2019-06-01"), max_points=4000)
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert (call.start, call.end, call.timeframe) == (IS_START, IS_END, "1d")


def test_the_lru_evicts_by_bytes(fake):
    one_year = synthetic_loader("NQ.V.0")(ts("2014-01-01"), ts("2015-01-01"))
    size = int(one_year.memory_usage(index=True).sum())
    svc = BarService(fake, cache_bytes=int(size * 1.5))
    for year in (2014, 2015, 2014):
        svc.bars("NQ.V.0", "1m", "vendor", ts(f"{year}-03-03"), ts(f"{year}-03-04"), max_points=4000)
    assert len(fake.calls) == 3  # 2015 evicted 2014
    reads, series, cached = svc.stats()
    assert (reads, series) == (3, 1) and 0 < cached <= size * 1.5


# ---------------------------------------------------------------- caller and reason

def test_every_serve_is_caller_terminal_with_a_reason_of_at_least_eight_characters(svc, fake):
    svc.bars("NQ.V.0", "1m", "vendor", ts("2013-04-01"), ts("2013-04-02"), max_points=4000)
    svc.bars("ZN.V.0", "1d", "vendor", ts("2013-04-01"), ts("2013-05-01"), max_points=4000)
    assert CALLER == "terminal"
    for call in fake.calls:
        assert call.caller == "terminal"
        assert len(call.reason.strip()) >= MIN_REASON_CHARS >= 8
    assert fake.calls[0].reason == "terminal display: NQ.V.0 1m vendor 2013 (chart only, not a registered test)"
    assert fake.calls[1].reason == "terminal display: ZN.V.0 1d vendor 2010-2021 (chart only, not a registered test)"
    assert {line["caller"] for line in log_lines(fake)} == {"terminal"}


def test_born_failing_the_gate_refuses_a_short_reason(fake):
    with pytest.raises(oos_gate.OOSAccessError, match="reason"):
        fake(ts("2013-04-01"), ts("2013-04-02"), caller=CALLER, reason="short")
    assert fake.loader_calls == 0


# ---------------------------------------------------------------- the fence

@pytest.mark.parametrize(("start", "end"), [("2022-01-03", "2022-01-04"), ("2021-12-30", "2022-01-05"),
                                            ("2009-12-30", "2010-01-05"), ("2024-06-03", "2024-06-04")])
def test_a_window_outside_the_fence_is_refused_and_the_loader_is_never_called(svc, fake, start, end):
    with pytest.raises(GateRefusal, match="leaves the in-sample window"):
        svc.bars("NQ.V.0", "1m", "vendor", ts(start), ts(end), max_points=4000)
    assert fake.calls == () and fake.loader_calls == 0
    assert log_lines(fake) == []


def test_daily_windows_past_the_fence_are_refused_too(svc, fake):
    with pytest.raises(GateRefusal):
        svc.bars("NQ.V.0", "1d", "vendor", ts("2021-06-01"), ts("2022-06-01"), max_points=4000)
    assert fake.loader_calls == 0


def test_born_failing_without_the_pre_check_a_straddling_window_is_clipped_and_served(svc, fake, monkeypatch):
    """The year widening clamps to the fence; only the pre-check stops a straddle from being served as 2021."""
    monkeypatch.setattr(bars_mod, "precheck_window", lambda start, end: None)
    result = svc.bars("NQ.V.0", "1m", "vendor", ts("2021-12-30"), ts("2022-01-05"), max_points=20000)
    assert fake.loader_calls == 1 and len(result.t) > 0


def test_the_refusal_carries_the_gate_message(svc):
    with pytest.raises(GateRefusal) as info:
        svc.bars("NQ.V.0", "1m", "vendor", ts("2022-01-03"), ts("2022-01-04"), max_points=4000)
    try:
        oos_gate.check_window(ts("2022-01-03"), ts("2022-01-04"), CALLER, "terminal display pre-check")
    except oos_gate.OOSAccessError as exc:
        assert str(info.value) == str(exc)


def test_a_refusal_raised_by_the_gate_itself_maps_to_a_refusal(svc, monkeypatch):
    monkeypatch.setattr(bars_mod, "precheck_window", lambda start, end: None)

    def refusing(*args, **kwargs):
        raise oos_gate.OOSAccessError("window leaves the in-sample window")

    refusing_svc = BarService(refusing, cache_bytes=BIG)
    with pytest.raises(GateRefusal, match="leaves the in-sample window"):
        refusing_svc.bars("NQ.V.0", "1m", "vendor", ts("2019-01-02"), ts("2019-01-03"), max_points=4000)


def test_an_empty_year_is_cached_and_gives_no_bars(fake):
    calls = []

    def empty_serve(start, end, **kwargs):
        calls.append((start, end))
        raise oos_gate.OOSAccessError(f"empty serve for [{start}, {end}) requested by terminal")

    svc = BarService(empty_serve, cache_bytes=BIG)
    for _ in range(3):
        result = svc.bars("RTY.V.0", "1m", "vendor", ts("2011-02-01"), ts("2011-02-02"), max_points=4000)
        assert result.t == [] and result.rolls == ()
    assert len(calls) == 1


def test_an_unknown_series_raises_unknown_series(svc, fake):
    with pytest.raises(UnknownSeries):
        svc.bars("XX.V.0", "1m", "vendor", ts("2019-01-02"), ts("2019-01-03"), max_points=4000)
    with pytest.raises(UnknownSeries):
        svc.bars("ES.V.0", "1m", "repaired", ts("2019-01-02"), ts("2019-01-03"), max_points=4000)
    with pytest.raises(ValueError):
        svc.bars("NQ.V.0", "2m", "vendor", ts("2019-01-02"), ts("2019-01-03"), max_points=4000)


# ---------------------------------------------------------------- OHLCV buckets

def minute_frame(start: str, end: str, symbol: str = "NQ.V.0") -> pd.DataFrame:
    return synthetic_loader(symbol)(ts(start), ts(end))


def expected_buckets(frame: pd.DataFrame, minutes: int, anchor_ns: int = 0) -> pd.DataFrame:
    ns = frame["ts"].astype("int64")
    key = (ns - anchor_ns) // (minutes * 60 * 10**9)
    return frame.groupby(key.to_numpy()).agg(t=("ts", "first"), o=("o", "first"), h=("h", "max"), l=("l", "min"),
                                              c=("c", "last"), v=("v", "sum"))


@pytest.mark.parametrize(("timeframe", "minutes"), [("5m", 5), ("15m", 15), ("1h", 60), ("4h", 240)])
def test_a_bucket_high_equals_the_max_of_its_one_minute_highs(svc, timeframe, minutes):
    result = svc.bars("NQ.V.0", timeframe, "vendor", ts("2019-05-06"), ts("2019-05-09"), max_points=4000)
    want = expected_buckets(minute_frame("2019-05-06", "2019-05-09"), minutes)
    assert result.bucket == timeframe
    assert result.t == [int(x.timestamp()) for x in want["t"]]
    np.testing.assert_array_equal(result.h, want["h"].to_numpy())
    np.testing.assert_array_equal(result.l, want["l"].to_numpy())
    np.testing.assert_array_equal(result.o, want["o"].to_numpy())
    np.testing.assert_array_equal(result.c, want["c"].to_numpy())
    np.testing.assert_array_equal(result.v, want["v"].to_numpy())


def test_born_failing_decimated_highs_are_not_the_bucket_highs():
    """Picking every fifth 1m bar (a decimation, or LTTB on prices) loses the true high the test above checks."""
    frame = minute_frame("2019-05-06", "2019-05-07")
    decimated = frame["h"].to_numpy()[::5]
    true_high = expected_buckets(frame, 5)["h"].to_numpy()
    assert not np.array_equal(decimated[: len(true_high)], true_high)


def test_one_minute_bars_come_back_unchanged(svc):
    result = svc.bars("NQ.V.0", "1m", "vendor", ts("2019-05-06 14:00"), ts("2019-05-06 15:00"), max_points=4000)
    frame = minute_frame("2019-05-06 14:00", "2019-05-06 15:00")
    assert result.bucket == "1m" and len(result.t) == 60
    np.testing.assert_array_equal(result.h, frame["h"].to_numpy())
    assert result.t[0] == int(ts("2019-05-06 14:00").timestamp())


def test_max_points_widens_the_bucket_and_keeps_true_highs(svc):
    result = svc.bars("NQ.V.0", "1m", "vendor", ts("2019-03-01"), ts("2019-04-01"), max_points=4000)
    assert result.bucket == "15m" and 0 < len(result.t) <= 4000
    want = expected_buckets(minute_frame("2019-03-01", "2019-04-01"), 15)
    np.testing.assert_array_equal(result.h, want["h"].to_numpy())
    np.testing.assert_array_equal(result.l, want["l"].to_numpy())


def test_session_buckets_start_at_the_globex_open(svc):
    result = svc.bars("NQ.V.0", "1h", "vendor", ts("2019-01-01"), ts("2019-12-31"), max_points=100)
    assert result.bucket == "1w" and len(result.t) <= 100
    first_of_week = pd.Timestamp(result.t[1], unit="s", tz=UTC)
    assert (first_of_week.day_name(), first_of_week.hour) == ("Sunday", 22)
    daily = svc.bars("NQ.V.0", "1m", "vendor", ts("2019-05-06"), ts("2019-05-11"), max_points=6)
    assert daily.bucket == "1d" and len(daily.t) == 5
    want = expected_buckets(minute_frame("2019-05-06", "2019-05-11"), 1440, anchor_ns=-2 * 3600 * 10**9)
    np.testing.assert_array_equal(daily.h, want["h"].to_numpy())


def test_daily_bars_use_the_back_adjusted_columns(svc):
    result = svc.bars("ES.V.0", "1d", "vendor", ts("2015-03-02"), ts("2015-03-21"), max_points=4000)
    frame = synthetic_loader("ES.V.0", "1d")(ts("2015-03-02"), ts("2015-03-21"))
    assert result.bucket == "1d" and len(result.t) == len(frame) == 15
    np.testing.assert_array_equal(result.c, frame["c_back"].to_numpy())
    np.testing.assert_array_equal(result.h, frame["h_back"].to_numpy())
    assert result.t == [int(x.timestamp()) for x in frame["ts"]]


def test_no_bar_after_the_fence_is_ever_returned(svc):
    result = svc.bars("NQ.V.0", "1m", "vendor", ts("2021-12-31"), IS_END, max_points=20000)
    assert result.t and max(result.t) < int(IS_END.timestamp())
    daily = svc.bars("NQ.V.0", "1d", "vendor", IS_START, IS_END, max_points=4000)
    assert max(daily.t) < int(IS_END.timestamp())


# ---------------------------------------------------------------- roll markers

def test_roll_markers_come_from_instrument_id_and_offset(svc):
    result = svc.bars("NQ.V.0", "5m", "vendor", ts("2019-06-10"), ts("2019-06-11"), max_points=4000)
    frame = minute_frame("2019-06-10", "2019-06-11")
    at = int(np.flatnonzero(np.diff(frame["instrument_id"].to_numpy()))[0]) + 1
    assert len(result.rolls) == 1
    roll = result.rolls[0]
    assert roll.t == int(ts("2019-06-10 22:00").timestamp()) == int(frame["ts"].iloc[at].timestamp())
    assert (roll.from_id, roll.to_id) == (int(frame["instrument_id"].iloc[at - 1]), int(frame["instrument_id"].iloc[at]))
    gap = frame["offset"].iloc[at] - frame["offset"].iloc[at - 1]
    assert roll.gap_pts == pytest.approx(gap) and roll.gap_pts != 0
    assert roll.gap_pct == pytest.approx(100 * gap / frame["raw_c"].iloc[at - 1])


def test_daily_roll_gaps_use_c_none(svc):
    result = svc.bars("CL.V.0", "1d", "vendor", ts("2016-01-01"), ts("2017-01-01"), max_points=4000)
    frame = synthetic_loader("CL.V.0", "1d")(ts("2016-01-01"), ts("2017-01-01"))
    changes = np.flatnonzero(np.diff(frame["instrument_id"].to_numpy())) + 1
    assert len(result.rolls) == len(changes) == 4
    for roll, at in zip(result.rolls, changes):
        assert roll.gap_pct == pytest.approx(100 * (frame["offset"].iloc[at] - frame["offset"].iloc[at - 1])
                                             / frame["c_none"].iloc[at - 1])


def test_a_window_without_a_roll_has_no_markers(svc):
    assert svc.bars("NQ.V.0", "1m", "vendor", ts("2019-07-01"), ts("2019-07-02"), max_points=4000).rolls == ()


def test_gate_info_reports_years_and_cache_hits(svc):
    first = svc.bars("NQ.V.0", "1m", "vendor", ts("2016-12-30"), ts("2017-01-04"), max_points=20000)
    again = svc.bars("NQ.V.0", "1m", "vendor", ts("2016-12-30"), ts("2017-01-04"), max_points=20000)
    assert first.years == (2016, 2017) and not first.cached
    assert again.cached
    assert svc.stats()[0] == 2
