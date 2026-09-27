"""VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised).

For one universe symbol: the rolling realised volatility `sd(log(1 + r) over h sessions, ddof 1) x sqrt(252)` on
the universe's returns (`r = dB / (N - dB)`, the dtsmom_panel convention), for h in 5, 10, 21, 63, 126 and 252
sessions; for each h the min, the 10th, 25th, 50th, 75th and 90th percentiles (numpy linear) and the max over every
full window in the in-sample history, the latest value (the window ending 2021-12-31) and its rank in that history.
The small multiples view gives the same statistics for the 27 futures at one horizon.

The fixture is the synthetic 1d set from `fakes.py` (no gate, no file); the reference below walks the windows one
by one with the standard library, independent of the service's pandas and numpy path.
"""
from __future__ import annotations

import math
import statistics

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.services import vcone
from nq_terminal.services.market import LABEL, last_in_sample_day

from fakes import synthetic_loader

SYMBOL = "NQ.V.0"
PAST_FENCE = pd.Timestamp("2022-03-31", tz="UTC")


def frame_for(symbol: str, end: pd.Timestamp = IS_END) -> pd.DataFrame:
    return synthetic_loader(symbol, "1d")(IS_START, end)


@pytest.fixture(scope="module")
def frames() -> dict[str, pd.DataFrame]:
    return {f"{c.root}.V.0": frame_for(f"{c.root}.V.0") for c in TABLE}


@pytest.fixture(scope="module")
def cone(frames):
    return vcone.volatility_cone(frames[SYMBOL], SYMBOL)


def reference_logs(frame: pd.DataFrame, symbol: str) -> list[float]:
    panel = build_panel({symbol: frame}, master_days(IS_START.date(), last_in_sample_day()))
    return [math.log1p(x) if math.isfinite(x) and x > -1 else math.nan for x in panel.r[:, 0].tolist()]


def reference_windows(logs: list[float], h: int) -> list[float]:
    out = []
    for i in range(h - 1, len(logs)):
        seg = logs[i - h + 1:i + 1]
        if all(math.isfinite(x) for x in seg):
            out.append(statistics.stdev(seg) * math.sqrt(252))
    return out


def test_the_constants_follow_the_task():
    assert vcone.HORIZONS == (5, 10, 21, 63, 126, 252)
    assert vcone.PERCENTILES == (10, 25, 50, 75, 90)
    assert vcone.DEFAULT_HORIZON in vcone.HORIZONS
    assert vcone.LABEL == LABEL and vcone.LABEL.startswith("[POST HOC]")
    assert "log" in vcone.BASIS and "sqrt(252)" in vcone.BASIS


def test_summarise_hand_values():
    stats = vcone.summarise(np.arange(1.0, 11.0), latest=7.0, min_windows=2)
    assert stats["min"] == 1.0 and stats["max"] == 10.0
    assert stats["p10"] == pytest.approx(1.9) and stats["p25"] == pytest.approx(3.25)
    assert stats["p50"] == pytest.approx(5.5) and stats["p75"] == pytest.approx(7.75)
    assert stats["p90"] == pytest.approx(9.1)
    assert stats["latest_rank"] == pytest.approx(70.0)


def test_summarise_is_empty_below_the_minimum_history():
    stats = vcone.summarise(np.arange(1.0, vcone.MIN_WINDOWS), latest=3.0)
    assert all(stats[k] is None for k in ("min", "p10", "p50", "p90", "max", "latest_rank"))


def test_rolling_vol_needs_a_full_window_of_finite_log_returns():
    logs = np.array([0.01, -0.02, 0.03, math.nan, 0.01, 0.02, -0.01])
    rv = vcone.rolling_vol(logs, 3)
    assert np.isnan(rv[:2]).all()
    assert rv[2] == pytest.approx(statistics.stdev([0.01, -0.02, 0.03]) * math.sqrt(252), rel=1e-12)
    assert np.isnan(rv[3:6]).all()  # every window holding the missing return
    assert rv[6] == pytest.approx(statistics.stdev([0.01, 0.02, -0.01]) * math.sqrt(252), rel=1e-12)


def test_log_returns_leave_an_undefined_return_out():
    logs, undefined = vcone.to_log(np.array([0.01, -1.0, -1.5, math.nan, 0.02]))
    assert logs[0] == pytest.approx(math.log1p(0.01)) and logs[4] == pytest.approx(math.log1p(0.02))
    assert np.isnan(logs[1:4]).all()
    assert undefined == 2  # 1 + r <= 0; the leading NaN (no previous close) is not counted


def test_one_row_per_horizon_ending_at_the_fence(cone):
    assert cone.symbol == SYMBOL and cone.as_of == "2021-12-31"
    assert [row.sessions for row in cone.horizons] == list(vcone.HORIZONS)
    assert all(row.last_date == "2021-12-31" for row in cone.horizons)


def test_the_cone_matches_a_window_by_window_reference(frames, cone):
    logs = reference_logs(frames[SYMBOL], SYMBOL)
    for row in cone.horizons:
        values = reference_windows(logs, row.sessions)
        cuts = statistics.quantiles(values, n=100, method="inclusive")
        assert row.n == len(values)
        assert row.min == pytest.approx(min(values), rel=1e-12)
        assert row.max == pytest.approx(max(values), rel=1e-12)
        for p in vcone.PERCENTILES:
            assert getattr(row, f"p{p}") == pytest.approx(cuts[p - 1], rel=1e-12), (row.sessions, p)
        assert row.latest == pytest.approx(values[-1], rel=1e-12)
        rank = 100.0 * sum(v <= values[-1] for v in values) / len(values)
        assert row.latest_rank == pytest.approx(rank, rel=1e-12)


def test_the_cone_is_ordered(cone):
    for row in cone.horizons:
        chain = [row.min, row.p10, row.p25, row.p50, row.p75, row.p90, row.max]
        assert chain == sorted(chain)
        assert row.min <= row.latest <= row.max and 0 < row.latest_rank <= 100


def test_born_failing_simple_returns_or_365_give_other_numbers(frames, cone):
    """The reference check above can fail: simple returns, or sqrt(365), move the 21-session median."""
    panel = build_panel({SYMBOL: frames[SYMBOL]}, master_days(IS_START.date(), last_in_sample_day()))
    row = next(r for r in cone.horizons if r.sessions == 21)
    simple = reference_windows(panel.r[:, 0].tolist(), 21)
    assert statistics.median(simple) != pytest.approx(row.p50, rel=1e-9)
    wrong = [v * math.sqrt(365 / 252) for v in reference_windows(reference_logs(frames[SYMBOL], SYMBOL), 21)]
    assert statistics.median(wrong) != pytest.approx(row.p50, rel=1e-9)


def test_rows_past_the_fence_change_nothing(cone):
    longer = vcone.volatility_cone(frame_for(SYMBOL, PAST_FENCE), SYMBOL)
    assert longer == cone


def test_universe_at_one_horizon_matches_each_cone(frames):
    result = vcone.universe_cone(frames, contracts=TABLE, sessions=21)
    assert result.sessions == 21 and result.as_of == "2021-12-31" and result.missing == ()
    assert [r.symbol for r in result.rows] == [f"{c.root}.V.0" for c in TABLE]
    assert [r.sector for r in result.rows] == [c.sector for c in TABLE]
    for row in result.rows[:3]:
        own = next(h for h in vcone.volatility_cone(frames[row.symbol], row.symbol).horizons if h.sessions == 21)
        assert row.stats == own


def test_universe_lists_missing_symbols(frames):
    partial = {k: v for k, v in frames.items() if k != "CL.V.0"}
    result = vcone.universe_cone(partial, contracts=TABLE, sessions=63)
    assert result.missing == ("CL.V.0",) and len(result.rows) == 26


def test_an_unknown_horizon_is_refused(frames):
    with pytest.raises(ValueError, match="horizon"):
        vcone.universe_cone(frames, contracts=TABLE, sessions=22)
    with pytest.raises(ValueError, match="horizon"):
        vcone.volatility_cone(frames[SYMBOL], SYMBOL, horizons=(1,))
