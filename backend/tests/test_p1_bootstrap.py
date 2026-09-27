"""SV5 bootstrap confidence intervals and the SV6 cone (TASKS 10.1; ANALYTICS_CATALOG SV5, SV6).

The golden values below were produced by arch 8.0.0 in the QA environment (`terminal/qa`) on 2026-09-27:
`optimal_block_length` on two seeded series and the first three `StationaryBootstrap(3.0, arange(12), seed=7)`
index draws. The terminal's numpy code must reproduce them exactly; the full ten-thousand-replication quantiles are
compared with arch by the cross-check (`crosscheck`, kind `bootstrap`).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from nq_terminal.analytics import bootstrap, drawdown, perf

ARCH_AR1_BLOCK = (7.398826484630309, 8.469542055137115)  # AR(1) phi 0.5, n 600, default_rng(11)
ARCH_IID_BLOCK = (1.3107143615547483, 1.5003933975909178)  # iid normal, n 400, default_rng(12)
ARCH_FIRST_DRAWS = ([11, 0, 1, 2, 6, 9, 10, 11, 0, 1, 2, 3],
                    [8, 9, 10, 11, 0, 1, 2, 1, 10, 7, 8, 0],
                    [8, 9, 10, 11, 7, 8, 9, 10, 11, 0, 11, 0])


def ar1(n: int = 600, seed: int = 11) -> np.ndarray:
    e = np.random.default_rng(seed).standard_normal(n)
    x = np.empty(n)
    x[0] = e[0]
    for i in range(1, n):
        x[i] = 0.5 * x[i - 1] + e[i]
    return x


def daily(n: int = 700, seed: int = 3) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(0.0004 + 0.01 * rng.standard_normal(n), index=pd.bdate_range("2012-01-02", periods=n))


def test_block_length_matches_arch_on_an_ar1_series():
    found = bootstrap.optimal_block_length(ar1())
    assert (found["stationary"], found["circular"]) == pytest.approx(ARCH_AR1_BLOCK, rel=1e-12, abs=0)


def test_block_length_matches_arch_on_an_iid_series():
    found = bootstrap.optimal_block_length(np.random.default_rng(12).standard_normal(400))
    assert (found["stationary"], found["circular"]) == pytest.approx(ARCH_IID_BLOCK, rel=1e-12, abs=0)


def test_indices_reproduce_arch_draws_exactly():
    chunks = list(bootstrap.stationary_indices(12, 3.0, reps=3, seed=7, chunk=2))
    drawn = np.vstack(chunks)
    assert [c.shape[0] for c in chunks] == [2, 1]
    assert drawn.tolist() == [list(row) for row in ARCH_FIRST_DRAWS]


def test_born_failing_a_different_seed_misses_the_arch_draws():
    drawn = np.vstack(list(bootstrap.stationary_indices(12, 3.0, reps=3, seed=8)))
    assert drawn.tolist() != [list(row) for row in ARCH_FIRST_DRAWS]


def test_chunking_never_changes_the_draws():
    a = np.vstack(list(bootstrap.stationary_indices(50, 4.2, reps=7, seed=1, chunk=3)))
    b = np.vstack(list(bootstrap.stationary_indices(50, 4.2, reps=7, seed=1, chunk=100)))
    assert np.array_equal(a, b)


def test_resampled_statistics_equal_the_perf_functions_row_by_row():
    r = daily()
    block = bootstrap.optimal_block_length(r)["stationary"]
    stats = bootstrap.resample_statistics(r, "B", 252, reps=5, seed=4, block=block)
    rows = np.vstack(list(bootstrap.stationary_indices(len(r), block, reps=5, seed=4)))
    for i, idx in enumerate(rows):
        sample = r.to_numpy()[idx]
        assert stats["sharpe"][i] == pytest.approx(perf.sharpe(sample, 252), rel=1e-12)
        assert stats["cagr"][i] == pytest.approx(perf.cagr(sample, "B", 252), rel=1e-12)
        assert stats["max_drawdown"][i] == pytest.approx(drawdown.max_drawdown(sample, "B"), rel=1e-12, abs=1e-15)


def test_basis_a_statistics_sum_and_a_one_contract_series_has_no_cagr():
    r = daily(seed=5)
    stats = bootstrap.resample_statistics(r, "A", 252, reps=4, seed=2, block=3.0, on_capital=False)
    rows = np.vstack(list(bootstrap.stationary_indices(len(r), 3.0, reps=4, seed=2)))
    assert stats["cagr"] is None
    for i, idx in enumerate(rows):
        assert stats["max_drawdown"][i] == pytest.approx(drawdown.max_drawdown(r.to_numpy()[idx], "A"), abs=1e-15)


def test_summary_is_deterministic_and_brackets_the_point_estimate():
    r = daily(seed=9)
    one = bootstrap.bootstrap_summary(r, "B", 252, reps=400)
    two = bootstrap.bootstrap_summary(r, "B", 252, reps=400)
    assert one["stats"]["sharpe"]["lo"] == two["stats"]["sharpe"]["lo"]
    sharpe = one["stats"]["sharpe"]
    assert sharpe["point"] == pytest.approx(perf.sharpe(r, 252), rel=1e-12)
    assert sharpe["lo"] < sharpe["point"] < sharpe["hi"]
    assert one["seed"] == bootstrap.SEED and one["reps"] == 400 and one["confidence"] == 0.95
    assert one["block"]["stationary"] == pytest.approx(bootstrap.optimal_block_length(r)["stationary"])


def test_percentile_interval_is_numpy_linear_on_the_replications():
    r = daily(seed=10)
    summary = bootstrap.bootstrap_summary(r, "A", 252, reps=300)
    stats = bootstrap.resample_statistics(r, "A", 252, reps=300, seed=bootstrap.SEED,
                                          block=summary["block"]["stationary"])
    lo, hi = np.percentile(stats["sharpe"], [2.5, 97.5])
    assert summary["stats"]["sharpe"]["lo"] == lo and summary["stats"]["sharpe"]["hi"] == hi


def test_cone_sums_on_a_and_compounds_on_b_over_one_year():
    r = daily(seed=11)
    block = 5.0
    rows = np.vstack(list(bootstrap.stationary_indices(len(r), block, reps=50, seed=3)))
    for basis in ("A", "B"):
        cone = bootstrap.cone(r, basis, 252, reps=50, seed=3, block=block)
        paths = r.to_numpy()[rows[:, :252]]
        level = np.cumsum(paths, axis=1) if basis == "A" else np.cumprod(1 + paths, axis=1) - 1
        assert cone["horizon"] == 252 and len(cone["quantiles"]["50"]) == 252
        assert np.allclose(cone["quantiles"]["5"], np.percentile(level, 5, axis=0), rtol=0, atol=1e-15)
        tail = r.to_numpy()[-252:]
        realised = np.cumsum(tail) if basis == "A" else np.cumprod(1 + tail) - 1
        assert np.allclose(cone["realised"], realised, rtol=0, atol=1e-15)
        assert cone["realised_dates"][0] == r.index[-252].strftime("%Y-%m-%d")
    assert "not a forecast" in bootstrap.CONE_LABEL
    # The percentiles are taken step by step, so they are not a band whole paths stay inside (statistics review).
    assert "pointwise percentiles at each horizon, not a band that whole paths stay inside" in bootstrap.CONE_LABEL


def test_monthly_cone_spans_twelve_months():
    r = pd.Series(np.random.default_rng(1).normal(0.005, 0.03, 60), index=pd.date_range("2012-01-31", periods=60,
                                                                                          freq="ME"))
    cone = bootstrap.cone(r, "A", 12, reps=20, seed=1, block=2.0)
    assert cone["horizon"] == 12 and len(cone["quantiles"]["95"]) == 12


def test_short_series_and_bad_inputs_are_refused():
    with pytest.raises(ValueError):
        bootstrap.optimal_block_length(np.ones(3))
    with pytest.raises(ValueError):
        list(bootstrap.stationary_indices(10, 0.0, reps=2, seed=1))
    with pytest.raises(ValueError):
        list(bootstrap.stationary_indices(10, math.nan, reps=2, seed=1))
    with pytest.raises(ValueError):
        bootstrap.bootstrap_summary(daily(n=20), "A", 252, reps=10)


def test_a_flat_series_has_no_block_length():
    found = bootstrap.optimal_block_length(np.zeros(300))
    assert math.isnan(found["stationary"])


# ---------------------------------------------------------------- SV5 CAGR: ruin counts as a total loss


def ruinous(n: int = 504, seed: int = 21) -> pd.Series:
    """A Basis A book with a daily sd of 3% of K and a point CAGR near 27%: about 1% of replications lose all of K."""
    rng = np.random.default_rng(seed)
    return pd.Series(0.0012 + 0.03 * rng.standard_normal(n), index=pd.bdate_range("2012-01-02", periods=n))


def test_born_failing_a_book_that_ends_below_zero_is_a_total_loss():
    # growth 1 + (-0.5) + (-0.5001) = -0.0001: the book lost more than K, a CAGR of -100% (the old rule gave NaN
    # and dropped the replication, which pulled the lower bound up); growth exactly 0 is the same total loss
    rows = np.array([[-0.5, -0.5001], [-0.5, -0.5], [0.01, 0.02]])
    cagr = bootstrap._cagr_rows(rows, "A", 252)
    assert cagr[0] == -1.0 and cagr[1] == -1.0 and cagr[2] == pytest.approx(1.03 ** 126 - 1, rel=1e-12)


def test_born_failing_a_basis_a_book_that_touches_zero_on_the_way_is_ruined():
    # Ruin is the path touching zero (equity K(1 + cumsum r) at or below 0 at any point), not only the end: row 0
    # loses all of K on its second step and then recovers to a growth of 1.1; the old end-only rule gave it a
    # positive CAGR. Row 1 touches exactly zero on the way; row 2 dips to 0.0001 of K and survives.
    rows = np.array([[-0.5, -0.6, 1.2], [-1.0, 0.5, 0.6], [-0.9999, 0.5, 0.6]])
    cagr = bootstrap._cagr_rows(rows, "A", 252)
    assert cagr[0] == -1.0 and cagr[1] == -1.0
    assert cagr[2] == pytest.approx(1.1001 ** 84 - 1, rel=1e-12)


def test_born_failing_a_basis_b_book_whose_equity_reaches_zero_is_ruined():
    # Basis B compounds: equity E_0 (1 + r_1)(1 + r_2)... at or below 0 at any point is ruin. Row 0 has two
    # returns below -100%, whose product is positive, 2.2 (the old rule gave a CAGR far above +100%); row 1 hits
    # exactly zero; row 2 loses 99.99% and survives.
    rows = np.array([[-3.0, -2.0, 0.1], [0.2, -1.0, 0.3], [-0.9999, 0.5, 0.5]])
    cagr = bootstrap._cagr_rows(rows, "B", 252)
    assert cagr[0] == -1.0 and cagr[1] == -1.0
    assert cagr[2] == pytest.approx((0.0001 * 1.5 * 1.5) ** 84 - 1, rel=1e-12)


def test_ruin_is_absorbing_in_the_point_cagr_too():
    series = pd.Series([0.2, -1.3, 0.9, 0.9, 0.9], index=pd.bdate_range("2012-01-02", periods=5))
    assert bootstrap._points(series.to_numpy(), "A", 252, True)["cagr"] == -1.0


def test_ruined_replications_stay_in_the_cagr_interval_and_are_counted():
    r = ruinous()
    found = bootstrap.bootstrap_summary(r, "A", 252, reps=2000)
    block = found["block"]["stationary"]
    every = bootstrap.resample_statistics(r, "A", 252, reps=2000, block=block)["cagr"]
    ruined = int(np.sum(every == -1.0))
    assert ruined > 0 and np.isfinite(every).all()
    cagr = found["stats"]["cagr"]
    assert (cagr["ruin"], cagr["undefined"]) == (ruined, 0)
    assert cagr["lo"] == pytest.approx(float(np.percentile(every, 2.5)), rel=1e-14)
    assert cagr["lo"] < float(np.percentile(every[every > -1.0], 2.5))  # dropping the ruined rows pulled it up
    assert found["stats"]["sharpe"]["ruin"] == 0 and found["stats"]["max_drawdown"]["ruin"] == 0


def test_the_ruin_note_says_the_path_touched_zero():
    from nq_terminal.services import tearsheet, tearsheet_extended
    u = tearsheet.Units("fraction of K", "", "", "", "ratio", "sessions")
    found = {"point": 0.1, "lo": -1.0, "hi": 0.4, "median": 0.1, "mean": 0.1, "sd": 0.2, "undefined": 0, "ruin": 3}
    note = tearsheet_extended._interval("cagr", found, None, u).note
    assert note is not None and "3 replications touch zero on the way" in note and "ends" not in note
