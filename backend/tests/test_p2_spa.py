"""SV8 family tests (ANALYTICS_CATALOG SV8; TASKS Phase 12): White's Reality Check, Hansen's SPA and Romano-Wolf StepM
as arch 8.0.0 computes them, on losses `-r_i` against the benchmark's `-r_bh`.

Pure functions only (no file, no gate). The exact agreement with arch's `SPA` and `StepM` under the fixed seed is the
QA cross-check's job (`terminal/qa/crosscheck/p2_spa.py`); the golden values below were produced by arch 8.0.0 in the
QA environment on the seeded synthetic family `_golden_family()` and are pinned here so the backend alone catches a
drift in the draw order or the recentring.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from nq_terminal.analytics import bootstrap, spa

T, K = 400, 4


def _family(seed: int = 11, t: int = T, edges=(0.0, 0.0, 0.0, 0.0), scale: float = 1.0):
    rng = np.random.default_rng(seed)
    bench = rng.standard_normal(t) * scale
    models = rng.standard_normal((t, len(edges))) * scale + bench[:, None] * 0.3 + np.asarray(edges) * scale
    return bench, models


def _golden_family():
    return _family(seed=20260927, t=300, edges=(0.25, 0.1, 0.0, -0.05))


# ---------------------------------------------------------------- the pieces


def test_loss_differentials_are_benchmark_loss_minus_model_loss():
    bench, models = _family()
    d = spa.loss_differentials(bench, models)
    np.testing.assert_array_equal(d, (-bench)[:, None] - (-models))
    assert d.shape == (T, K)


def test_born_failing_differentials_on_returns_not_losses_flip_the_sign():
    bench, models = _family(edges=(0.5, 0.0, 0.0, 0.0))
    right = spa.loss_differentials(bench, models).mean(axis=0)
    wrong = (bench[:, None] - models).mean(axis=0)  # returns taken as losses
    assert right[0] > 0 > wrong[0]


def test_long_run_variance_is_the_stationary_kernel_written_out():
    bench, models = _family(t=40)
    d = spa.loss_differentials(bench, models)
    block = 3.7
    got = spa.long_run_variance(d, block)
    t, p = len(d), 1 / block
    e = d - d.mean(axis=0)
    want = np.zeros(d.shape[1])
    for col in range(d.shape[1]):
        acc = sum(e[s, col] ** 2 for s in range(t)) / t
        for lag in range(1, t):
            kappa = (1 - lag / t) * (1 - p) ** lag + lag / t * (1 - p) ** (t - lag)
            acc += 2 * kappa * sum(e[s, col] * e[s + lag, col] for s in range(t - lag)) / t
        want[col] = acc
    np.testing.assert_allclose(got, want, rtol=1e-12)


def test_the_consistent_set_drops_only_models_far_below_the_benchmark():
    d = np.zeros((100, 3))
    d[:, 0] = 1.0 + np.sin(np.arange(100))
    d[:, 1] = -5.0 + np.sin(np.arange(100))
    d[:, 2] = -1e-3 + np.sin(np.arange(100))
    var = spa.long_run_variance(d, 5.0)
    valid = spa.consistent_columns(d, var)
    bound = -np.sqrt(var / 100 * 2 * np.log(np.log(100)))
    assert valid.tolist() == (d.mean(axis=0) >= bound).tolist() == [True, False, True]


def test_the_block_is_the_mean_of_the_per_column_politis_white_lengths():
    bench, models = _family()
    d = spa.loss_differentials(bench, models)
    blocks = [bootstrap.optimal_block_length(d[:, j])["stationary"] for j in range(K)]
    got = spa.family_block(d)
    assert got["per_column"] == blocks
    assert got["block"] == float(np.mean(np.array(blocks)))


def _iid_family_with_short_blocks():
    """Three near-iid members against an iid benchmark: Politis-White blocks of 0.36, 0.34 and 0.12 (mean 0.27)."""
    rng = np.random.default_rng(393)
    bench = rng.standard_normal(2500)
    models = bench[:, None] + rng.normal(-0.02, 0.5, (2500, 3))
    return bench, models


def test_born_failing_the_family_block_is_never_below_one_session():
    """Politis-White comes out below 1 for near-iid series (0.27 here); p = 1/block then exceeds 1, so the kernel's
    (1 - p)^k alternates in sign and grows. The family block is floored at 1, the per-column lengths stay as arch's."""
    bench, models = _iid_family_with_short_blocks()
    d = spa.loss_differentials(bench, models)
    raw = [bootstrap.optimal_block_length(d[:, j])["stationary"] for j in range(3)]
    got = spa.family_block(d)
    assert float(np.mean(np.array(raw))) < 1.0  # the premise: the unfloored mean is below 1
    assert got["per_column"] == raw
    assert got["block"] == 1.0


def test_born_failing_a_block_below_one_neither_overflows_nor_shrinks_the_kernel_variance():
    """Born failing: family_test raised OverflowError (34, 'Result too large') on this family. With p = 1 the kernel
    is the sample variance (kappa_k = 0 for every k >= 1), so the variance equals the population variance."""
    bench, models = _iid_family_with_short_blocks()
    out = spa.family_test(bench, models, reps=50, seed=1)
    d = spa.loss_differentials(bench, models)
    assert out["block"] == 1.0
    np.testing.assert_allclose(out["variance"], d.var(axis=0), rtol=1e-12)


def test_the_block_of_one_gives_the_sample_variance_whatever_the_series():
    d = np.random.default_rng(8).standard_normal((300, 2))
    np.testing.assert_allclose(spa.long_run_variance(d, 1.0), d.var(axis=0), rtol=1e-12)


# ---------------------------------------------------------------- SPA and StepM


def test_pvalues_are_ordered_lower_consistent_upper_and_the_reality_check_is_the_upper():
    bench, models = _family(edges=(0.05, 0.0, -0.3, -0.6))
    out = spa.family_test(bench, models, reps=500, seed=5)
    p = out["pvalues"]
    assert 0 <= p["lower"] <= p["consistent"] <= p["upper"] <= 1
    assert out["reality_check"] == p["upper"]


def test_a_model_with_a_clear_edge_is_rejected_and_the_null_models_are_not():
    bench, models = _family(edges=(0.5, 0.0, 0.0, 0.0))
    out = spa.family_test(bench, models, reps=1000, seed=3)
    assert out["pvalues"]["consistent"] < 0.01
    assert out["stepm"]["superior"] == [0]


def test_born_failing_the_same_family_as_returns_rejects_nothing():
    bench, models = _family(edges=(0.5, 0.0, 0.0, 0.0))
    out = spa.family_test(-bench, -models, reps=1000, seed=3)  # losses passed where returns belong
    assert out["pvalues"]["consistent"] > 0.05 and out["stepm"]["superior"] == [] and out["mean_differential"][0] < 0


def test_nothing_rejected_when_no_model_beats_the_benchmark():
    bench, models = _family(edges=(0.0, -0.1, -0.1, -0.1))
    out = spa.family_test(bench, models, reps=1000, seed=3)
    assert out["stepm"]["superior"] == [] and out["stepm"]["steps"] == 1


def test_stepm_steps_down_after_the_first_rejections():
    # model 0: a large edge on a noisy series, which sets the first critical value; model 1: a small edge on a quiet one
    rng = np.random.default_rng(4)
    t = 600
    bench = rng.standard_normal(t)
    noise = rng.standard_normal((t, 6)) * np.array([5, 1, 1, 1, 1, 1])
    models = bench[:, None] + noise + np.array([2.0, 0.15, 0, 0, 0, 0])
    out = spa.family_test(bench, models, reps=2000, seed=9)
    assert out["stepm"]["per_step"] == [[0], [1], []]  # the step down, without model 0, rejects model 1 too
    assert out["stepm"]["superior"] == [0, 1] and out["stepm"]["steps"] == 3
    assert out["mean_differential"][1] < out["critical_values"]["consistent"]  # below the first step's bar


def test_born_failing_stepm_stops_when_every_member_is_rejected_over_two_steps():
    # step 1 rejects model 0, step 2 rejects the one remaining model: nothing is left for a third step
    t = 300
    bench = np.random.default_rng(3).standard_normal(t)
    rng = np.random.default_rng(5)
    quiet = rng.standard_normal(t)
    models = np.column_stack([bench + 1.0 + rng.standard_normal(t), bench + 0.1025 + (quiet - quiet.mean())])
    out = spa.family_test(bench, models, reps=1000, seed=7)
    assert out["stepm"]["superior"] == [0, 1] and out["stepm"]["steps"] == 2
    assert out["stepm"]["per_step"] == [[0], [1]]


def test_a_column_major_matrix_gives_the_same_bits_as_a_row_major_one():
    """Born failing before the fix: DataFrame.to_numpy() is column major, and numpy then sums each column pairwise,
    which moved the last bits of the variances and the consistent critical value away from arch's."""
    bench, models = _family(t=500, edges=(0.1, 0.0, 0.0, 0.0))
    c_order = spa.family_test(bench, np.ascontiguousarray(models), reps=200, seed=1)
    f_order = spa.family_test(bench, np.asfortranarray(models), reps=200, seed=1)
    assert f_order == c_order


def test_a_fixed_seed_gives_the_same_replications_and_another_seed_does_not():
    bench, models = _family(edges=(0.1, 0.05, 0.0, 0.0))
    a = spa.family_test(bench, models, reps=300, seed=1)
    b = spa.family_test(bench, models, reps=300, seed=1)
    c = spa.family_test(bench, models, reps=300, seed=2)
    assert a == b
    assert a["critical_values"] != c["critical_values"]


def test_golden_values_from_arch_under_the_seed():
    """arch 8.0.0 (QA env): SPA(-bench, -models, block_size=<family block>, reps=1000, seed=7) and StepM at 0.05."""
    bench, models = _golden_family()
    out = spa.family_test(bench, models, reps=1000, seed=7)
    assert out["block"] == GOLDEN["block"]
    assert out["pvalues"] == GOLDEN["pvalues"]
    assert out["critical_values"] == GOLDEN["critical_values"]
    assert out["stepm"]["superior"] == GOLDEN["superior"]


# arch 8.0.0 in the QA environment on `_golden_family()` (2026-09-27): the family block is the mean of arch's
# `optimal_block_length(DataFrame(d))["stationary"]`; SPA and StepM(size=0.05) with that block, reps 1000, seed 7.
GOLDEN: dict = {"block": 1.2124145316194057,
                "pvalues": {"lower": 0.004, "consistent": 0.005, "upper": 0.005},
                "critical_values": {"lower": 0.15029795372658575, "consistent": 0.15367312508657652,
                                    "upper": 0.15367312508657652},
                "superior": [0, 1, 2]}


# ---------------------------------------------------------------- input checks


@pytest.mark.parametrize("bad", ["nan", "short", "shape", "empty"])
def test_refuses_inputs_it_cannot_test(bad):
    bench, models = _family()
    if bad == "nan":
        models = models.copy()
        models[3, 1] = math.nan
    elif bad == "short":
        bench, models = bench[:20], models[:20]
    elif bad == "shape":
        bench = bench[:-1]
    else:
        models = models[:, :0]
    with pytest.raises(ValueError):
        spa.family_test(bench, models, reps=10, seed=1)


def test_refuses_a_size_outside_zero_and_one():
    bench, models = _family()
    with pytest.raises(ValueError):
        spa.family_test(bench, models, reps=10, seed=1, size=1.5)


# ---------------------------------------------------------------- the members' dependence (MT 88, effective members)


def test_the_correlation_is_the_pearson_correlation_of_the_loss_differentials():
    import pandas as pd

    bench, models = _family(t=500, edges=(0.1, 0.0, 0.0, 0.0))
    d = spa.loss_differentials(bench, models)
    got = spa.member_correlation(d)
    np.testing.assert_allclose(got, pd.DataFrame(d).corr().to_numpy(), rtol=0, atol=1e-12)
    assert got.shape == (K, K) and (got == got.T).all() and (np.diag(got) == 1.0).all()
    assert np.abs(got).max() <= 1.0


def test_born_failing_the_correlation_of_returns_is_not_the_correlation_of_the_differentials():
    """Members that hold the market (high exposure) correlate strongly in returns, while their differentials against
    the benchmark (the series the bootstrap resamples) do not: the two measure different things."""
    rng = np.random.default_rng(5)
    bench = rng.standard_normal(600)
    models = bench[:, None] + rng.standard_normal((600, 3)) * 0.2
    d = spa.loss_differentials(bench, models)
    on_returns = np.corrcoef(models, rowvar=False)[0, 1]
    on_differentials = spa.member_correlation(d)[0, 1]
    assert on_returns > 0.9 and abs(on_differentials) < 0.5


def test_sparse_members_have_uncorrelated_returns_but_differentials_pulled_towards_one():
    """Every d_i holds -r_bh: members trading on disjoint 5% of sessions are uncorrelated in returns, yet their
    differentials correlate near 1, so corr(d) is the dependence the maximum runs over, not the independent bets."""
    rng = np.random.default_rng(9)
    t, k = 2500, 6
    width = t // 20
    bench = rng.normal(97.0, 1500.0, t)
    models = np.zeros((t, k))
    for j in range(k):
        models[j * width:(j + 1) * width, j] = bench[j * width:(j + 1) * width]
    on_returns = np.corrcoef(models, rowvar=False)
    on_differentials = spa.member_correlation(spa.loss_differentials(bench, models))
    off = ~np.eye(k, dtype=bool)
    assert abs(on_returns[off].mean()) < 0.1
    assert on_differentials[off].mean() > 0.8


def test_a_member_that_does_not_vary_has_no_correlation():
    d = np.random.default_rng(1).standard_normal((50, 3))
    d[:, 1] = 2.5
    got = spa.member_correlation(d)
    assert np.isnan(got[1]).all() and np.isnan(got[:, 1]).all()
    assert got[0, 0] == 1.0 and got[2, 2] == 1.0 and math.isfinite(got[0, 2])


def test_identical_members_correlate_at_exactly_one():
    column = np.random.default_rng(2).standard_normal((80, 1))
    got = spa.member_correlation(np.hstack([column, column, -column]))
    assert got[0, 1] == 1.0 and got[0, 2] == -1.0


def test_the_family_test_carries_the_correlation_of_its_differentials():
    bench, models = _family(edges=(0.2, 0.0, 0.0, 0.0))
    out = spa.family_test(bench, models, reps=50, seed=1)
    want = spa.member_correlation(spa.loss_differentials(bench, models))
    np.testing.assert_array_equal(np.array(out["correlation"]), want)


# ------------------------------------------- the statistic is arch's, not studentised: a documented limit

def _noisy_and_strong_family():
    """Member 0: mean 0.08, sd 1 (t-stat 4.0); member 1: mean -0.02, sd 3. Benchmark 0, so d = the member's returns."""
    t = 2500
    z = np.random.default_rng(1).standard_normal((t, 2))
    return np.zeros(t), z * np.array([1.0, 3.0]) + np.array([0.08, -0.02])


def test_the_statistic_is_not_studentised_so_a_noisy_member_hides_a_strong_quiet_one():
    # arch's max_i mean(d_i): the noisy member sets the critical value, so the family does not reject the strong one,
    # although that member alone clearly beats the benchmark (a studentised statistic would reject it)
    bench, models = _noisy_and_strong_family()
    family = spa.family_test(bench, models, reps=2000, seed=5)
    alone = spa.family_test(bench, models[:, :1], reps=2000, seed=5)
    unit_sd = spa.family_test(bench, models / models.std(axis=0), reps=2000, seed=5)
    assert family["pvalues"]["consistent"] > 0.05 and family["pvalues"]["upper"] > 0.05
    assert family["stepm"]["superior"] == []
    assert alone["pvalues"]["consistent"] < 0.01 and alone["stepm"]["superior"] == [0]
    assert unit_sd["pvalues"]["consistent"] < 0.01 and unit_sd["stepm"]["superior"] == [0]
