"""SV8: White's Reality Check, a non-studentised SPA (arch's form) and Romano-Wolf StepM over a family of models (SV8).

Losses: a model's loss is minus its return, `L_i = -r_i`, and the benchmark's is `L_0 = -r_bh`, on one common index.
The loss differential is `d_i = L_0 - L_i` (arch's `benchmark - models`), so a positive mean says model i beat the
benchmark. The family null is that no model beats the benchmark (every E[d_i] <= 0).

Computed the way arch 8.0.0's `SPA` and `StepM` compute them (`arch/bootstrap/multiple_comparison.py`), step for step,
so every value equals arch's to the last bit under the same seed (checked in `terminal/qa/crosscheck/p2_spa.py`):
- the statistic is `max_i mean(d_i)`. arch 8.0.0 does not studentise it (its `studentize` flag only names the
  method); the variances below enter only the consistent recentring. This is White's (2000) form, not Hansen's
  studentised T^SPA (max_i sqrt(t) dbar_i / omega_i, floored at 0), and the view says so. It favours members with a
  large spread: one with a small mean and a large sd sets the critical value, so a strong quiet member can be hidden
  by a noisy one (`test_the_statistic_is_not_studentised_so_a_noisy_member_hides_a_strong_quiet_one`);
- `var_i = sum(e^2)/t + 2 sum_{k=1}^{t-1} kappa_k sum(e_s e_{s+k})/t` with `e = d - mean(d)`, `p = 1/block` and
  `kappa_k = (1 - k/t)(1 - p)^k + (k/t)(1 - p)^(t-k)` (the stationary bootstrap's kernel, Hansen 2005 eq. 7);
- recentring: upper recentres every model at its mean (White's Reality Check), lower recentres only models at or
  above the benchmark (`max(mean, 0)`), consistent recentres a model only when `mean >= -sqrt(var/t x 2 ln ln t)`;
- per replication `mean(d*) - mu_j` for each recentring j; the p-value is the share of replications whose maximum
  over the models is strictly above the observed maximum; critical values are numpy's linear percentile at
  `100 (1 - size)` of those maxima;
- StepM (Romano and Wolf 2005, as arch runs it): reject every model whose mean exceeds the consistent critical value
  at `size`; while something was rejected and fewer models than the family were rejected at that step, drop every
  rejected model, recompute the critical value over the rest from the same replications, and reject again.
The replications are the stationary bootstrap's indices over the rows of d (`bootstrap.stationary_indices`, arch's
draws in arch's order: per replication `integers(t, size=t)` then `random(t)`).

Block length: Politis and White's (2004) stationary block length with the Patton, Politis and White (2009)
correction (`bootstrap.optimal_block_length`, arch's variant) for each column of d; the family's block is their
mean floored at 1 (a block below 1 makes `p = 1/block` exceed 1: the kernel then alternates in sign, understates the
variance and can overflow), the one number both the draws (`p = 1/block`) and the variance kernel use.
"""
from __future__ import annotations

import math

import numpy as np

from nq_terminal.analytics import bootstrap

SEED = bootstrap.SEED
REPS = bootstrap.REPS
SIZE = 0.05
MIN_N = bootstrap.MIN_N
MIN_BLOCK = 1.0
RECENTRING = ("lower", "consistent", "upper")


def _matrix(bench, models) -> tuple[np.ndarray, np.ndarray]:
    # C order, as arch receives a plain matrix: a column-major input (DataFrame.to_numpy) would sum the columns in
    # another order and move the last bits of every mean and variance
    b = np.ascontiguousarray(bench, dtype=float)
    m = np.ascontiguousarray(models, dtype=float)
    if m.ndim == 1:
        m = m[:, np.newaxis]
    if b.ndim != 1 or m.ndim != 2 or len(b) != m.shape[0]:
        raise ValueError(f"need a benchmark of t values and a t by k model matrix, got {b.shape} and {m.shape}")
    if m.shape[1] < 1:
        raise ValueError("the family needs at least one model")
    if len(b) < MIN_N:
        raise ValueError(f"the family test needs at least {MIN_N} common sessions, got {len(b)}")
    if not (np.isfinite(b).all() and np.isfinite(m).all()):
        raise ValueError("returns contain NaN or infinite values; align the family on its common sessions first")
    return b, m


def loss_differentials(bench, models) -> np.ndarray:
    """`d = L_0 - L_i` with `L = -r`: arch's `benchmark - models` on the loss matrices (t by k)."""
    b, m = _matrix(bench, models)
    return np.asarray((-b)[:, np.newaxis]) - np.asarray(-m)


def long_run_variance(d: np.ndarray, block: float) -> np.ndarray:
    """arch's `_compute_variance` (not nested): the stationary-bootstrap kernel variance of each column of d."""
    t = d.shape[0]
    p = 1.0 / block
    demeaned = d - d.mean(axis=0)
    variances = np.sum(demeaned ** 2, 0) / t
    for i in range(1, t):
        kappa = ((1.0 - (i / t)) * ((1 - p) ** i)) + ((i / t) * ((1 - p) ** (t - i)))
        variances += 2 * kappa * np.sum(demeaned[: (t - i), :] * demeaned[i:, :], 0) / t
    return variances


def consistent_columns(d: np.ndarray, variances: np.ndarray) -> np.ndarray:
    """Models close enough to the benchmark to count for the consistent p-value (Hansen's ln ln t bound)."""
    t = d.shape[0]
    threshold = -1.0 * np.sqrt((variances / t) * 2 * np.log(np.log(t)))
    return d.mean(0) >= threshold


def family_block(d: np.ndarray) -> dict:
    """Each column's Politis-White stationary block length and their mean, the family's block."""
    per_column = [bootstrap.optimal_block_length(d[:, j])["stationary"] for j in range(d.shape[1])]
    mean_block = float(np.mean(np.array(per_column)))
    if not (math.isfinite(mean_block) and mean_block > 0):
        raise ValueError("a loss differential has no spread, so the family has no block length")
    # Politis-White is often below 1 for near-iid series; p = 1/block would then exceed 1 and the kernel's (1 - p)^k
    # would alternate in sign and overflow. A block of 1 is the iid bootstrap (p = 1: kernel variance = sample variance).
    return {"per_column": per_column, "block": max(MIN_BLOCK, mean_block)}


def member_correlation(d: np.ndarray) -> np.ndarray:
    """Pearson correlation of the loss differentials (k by k): the dependence the bootstrap resamples.

    The differentials `d_i = r_i - r_bh` are what the maximum statistic is taken over, so their correlation is the
    dependence that maximum runs over. It is not a count of independent hypotheses: every `d_i` holds `-r_bh`, so for
    a low-exposure member (d_i is about -r_bh on most sessions) it is pulled towards 1, which the members' returns'
    correlation (MT 87's) is not. Against a cash benchmark the two are equal. Centred columns are scaled to unit length and multiplied, then divided by the square root of the diagonal, so identical members come
    out at exactly 1 and the matrix is exactly symmetric. A member that does not vary has no correlation: its row
    and column are NaN (the diagonal included).
    """
    z = d - d.mean(axis=0)
    scale = np.sqrt(np.sum(z ** 2, axis=0))
    with np.errstate(invalid="ignore", divide="ignore"):
        unit = z / scale
        gram = unit.T @ unit
        diag = np.diag(gram).copy()
        corr = gram / np.sqrt(np.outer(diag, diag))
    corr = (corr + corr.T) / 2.0
    corr = np.clip(corr, -1.0, 1.0)
    constant = ~(scale > 0)
    corr[constant, :] = np.nan
    corr[:, constant] = np.nan
    ok = np.flatnonzero(~constant)
    corr[ok, ok] = 1.0
    return corr


def _centres(d: np.ndarray, valid: np.ndarray) -> list[np.ndarray]:
    upper = d.mean(0)
    consistent = upper.copy()
    consistent[np.logical_not(valid)] = 0.0
    lower = upper.copy()
    lower[lower < 0] = 0.0
    return [lower, consistent, upper]


def simulate(d: np.ndarray, centres: list[np.ndarray], block: float, *, reps: int, seed: int) -> np.ndarray:
    """k by reps by 3: each replication's mean differential less each recentring (lower, consistent, upper)."""
    out = np.zeros((d.shape[1], reps, 3))
    i = 0
    for rows in bootstrap.stationary_indices(d.shape[0], block, reps=reps, seed=seed):
        for index in rows:
            star = d[index].mean(0)
            for j, centre in enumerate(centres):
                out[:, i, j] = star - centre
            i += 1
    return out


def _pvalues(d: np.ndarray, sims: np.ndarray, selector: np.ndarray) -> dict:
    max_sims = np.max(sims[selector, :, :], 0)
    observed = np.max(d[:, selector].mean(axis=0))
    values = (max_sims > observed).mean(axis=0)
    return {name: float(values[j]) for j, name in enumerate(RECENTRING)}


def _critical(sims: np.ndarray, selector: np.ndarray, size: float) -> dict:
    values = np.percentile(np.max(sims[selector, :, :], axis=0), 100.0 * (1 - size), axis=0)
    return {name: float(values[j]) for j, name in enumerate(RECENTRING)}


def _better(d: np.ndarray, sims: np.ndarray, selector: np.ndarray, size: float) -> list[int]:
    crit = _critical(sims, selector, size)["consistent"]
    better = np.logical_and(d.mean(0) > crit, selector)
    return [int(i) for i in np.argwhere(better).flatten()]


def stepm(d: np.ndarray, sims: np.ndarray, size: float) -> dict:
    """arch's StepM loop over the fixed replications, stopping on the cumulative count (Romano-Wolf): the rejected models, the steps and each step's rejections."""
    k = d.shape[1]
    selector = np.ones(k, dtype=np.bool_)
    better = _better(d, sims, selector, size)
    rejected, per_step = better[:], [better[:]]
    while better and len(rejected) < k:
        selector = np.ones(k, dtype=np.bool_)
        selector[np.array(rejected)] = False
        better = _better(d, sims, selector, size)
        rejected.extend(better)
        per_step.append(better[:])
    return {"superior": sorted(rejected), "steps": len(per_step), "per_step": per_step}


def _check_size(size: float) -> float:
    if not (isinstance(size, float) and 0.0 < size < 1.0):
        raise ValueError(f"the size must lie strictly between 0 and 1, got {size!r}")
    return size


def family_test(bench, models, *, reps: int = REPS, seed: int = SEED, size: float = SIZE) -> dict:
    """SPA p-values (lower, consistent, upper), the Reality Check p-value, critical values and StepM at `size`.

    `bench` holds the benchmark's returns (t) and `models` the models' returns (t by k), on one common index;
    losses are their negatives. Model positions in the output are the columns of `models`.
    """
    _check_size(size)
    d = loss_differentials(bench, models)
    block = family_block(d)
    variances = long_run_variance(d, block["block"])
    valid = consistent_columns(d, variances)
    sims = simulate(d, _centres(d, valid), block["block"], reps=reps, seed=seed)
    everyone = np.ones(d.shape[1], dtype=np.bool_)
    pvalues = _pvalues(d, sims, everyone)
    return {"t": int(d.shape[0]), "k": int(d.shape[1]), "reps": reps, "seed": seed, "size": size,
            "block": block["block"], "block_per_column": block["per_column"],
            "mean_differential": [float(v) for v in d.mean(0)], "correlation": member_correlation(d).tolist(), "variance": [float(v) for v in variances],
            "consistent_set": [bool(v) for v in valid], "pvalues": pvalues, "reality_check": pvalues["upper"],
            "critical_values": _critical(sims, everyone, size), "stepm": stepm(d, sims, size)}
