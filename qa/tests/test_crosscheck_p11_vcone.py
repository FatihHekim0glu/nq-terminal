"""Tests for the VCONE cross-check reference (TASKS Phase 11). In memory only; hand values and born-failing cases."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from crosscheck.compare import FAIL, PASS, judge
from crosscheck.p11_vcone import P11_VCONE_INPUTS, cone_stats, log_returns, vcone_references, windows

RNG_SEED = 11
N_SESSIONS = 400


def synthetic_inputs() -> dict:
    rng = np.random.default_rng(RNG_SEED)
    r = [None, *rng.normal(0.0003, 0.012, N_SESSIONS - 1).tolist()]
    dates = [str(d.date()) for d in pd.bdate_range("2019-01-01", periods=N_SESSIONS)]
    return {"dates": dates, "r": r, "horizons": [5, 21, 63], "percentiles": [10, 25, 50, 75, 90], "min_windows": 20}


def numpy_cone(inputs: dict, h: int) -> dict:
    """A second path (pandas rolling, numpy linear percentiles), as the terminal computes it."""
    r = np.array([np.nan if v is None else v for v in inputs["r"]], dtype=float)
    logs = np.where(np.isfinite(r) & (r > -1), np.log1p(np.where(r > -1, r, 0.0)), np.nan)
    line = pd.Series(logs).rolling(h, min_periods=h).std(ddof=1).to_numpy() * math.sqrt(252)
    values = line[np.isfinite(line)]
    cuts = np.percentile(values, inputs["percentiles"])
    out = {"n": len(values), "min": values.min(), "max": values.max(), "latest": line[-1],
           "latest_rank": 100.0 * np.sum(values <= line[-1]) / len(values)}
    return out | {f"p{q}": c for q, c in zip(inputs["percentiles"], cuts)}


def test_the_bundle_kind_is_declared():
    assert P11_VCONE_INPUTS["vcone"] == ("dates", "r", "horizons", "percentiles", "min_windows")


def test_log_returns_leave_undefined_values_out():
    logs = log_returns([None, 0.01, -1.0, -2.0, 0.02])
    assert math.isnan(logs[0]) and math.isnan(logs[2]) and math.isnan(logs[3])
    assert logs[1] == pytest.approx(math.log1p(0.01)) and logs[4] == pytest.approx(math.log1p(0.02))


def test_windows_need_every_return_defined():
    line = windows([0.01, -0.02, 0.03, math.nan, 0.01, 0.02, -0.01], 3)
    assert line[:2] == [None, None] and line[3:6] == [None, None, None]
    assert line[2] == pytest.approx(np.std([0.01, -0.02, 0.03], ddof=1) * math.sqrt(252), rel=1e-12)


def test_hand_percentiles():
    stats = cone_stats([float(v) for v in range(1, 11)], [10, 25, 50, 75, 90], 2)
    assert (stats["p10"], stats["p25"], stats["p50"], stats["p75"], stats["p90"]) == pytest.approx(
        (1.9, 3.25, 5.5, 7.75, 9.1))
    assert stats["latest"] == 10.0 and stats["latest_rank"] == 100.0 and stats["n"] == 10


def test_short_history_gives_no_cone():
    stats = cone_stats([0.1, 0.2, None, 0.3], [50], 20)
    assert stats["p50"] is None and stats["min"] is None and stats["latest_rank"] is None and stats["n"] == 3


def test_reference_agrees_with_the_pandas_and_numpy_path():
    inputs = synthetic_inputs()
    refs = vcone_references(inputs)
    for h in inputs["horizons"]:
        other = numpy_cone(inputs, h)
        for key, value in other.items():
            diff, ok = judge(float(value), refs[f"h{h}.{key}"].value, 1e-9)
            assert ok, (h, key, diff)


def test_born_failing_simple_returns_or_365_fail_the_comparison():
    inputs = synthetic_inputs()
    refs = vcone_references(inputs)
    simple = dict(inputs, r=[None if v is None else math.expm1(v) for v in inputs["r"]])
    moved = vcone_references(simple)["h21.p50"].value  # log1p of expm1(r) is r: the terminal would have used r
    status = PASS if judge(moved, refs["h21.p50"].value, 1e-9)[1] else FAIL
    assert status == FAIL
    wrong = refs["h21.p50"].value * math.sqrt(365 / 252)
    assert not judge(wrong, refs["h21.p50"].value, 1e-9)[1]
