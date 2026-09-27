"""Stationary bootstrap (ANALYTICS_CATALOG section 7: SV5 confidence intervals, SV6 cone). Descriptive only.

SV5. Politis and Romano's stationary bootstrap with the Politis and White (2004) block length, as corrected by Patton,
Politis and White (2009), computed the way arch 8.0.0's `optimal_block_length` computes it (its tuning constants and
its autocovariance and autocorrelation sums, reproduced line for line so the value matches arch exactly):
- `b_max = ceil(min(3 sqrt(n), n / 3))`, `k_n = max(5, int(log10 n))`, `m_max = ceil(sqrt(n)) + k_n`,
  band `2 sqrt(log10(n) / n)`; m is twice the first lag after which k_n autocorrelations sit inside the band
  (at least 1), else m_max, capped at m_max;
- this is arch 8.0.0's variant, not Politis and White's rule to the letter: its first window of k_n lags includes
  lag 0, so its m is one lag later than their m-hat (M = 2 (m-hat + 1), not 2 m-hat), and its lag-k autocorrelation
  normalises by the lag k + 1 sums of squares. Politis and White recommend `K_n = max(5, sqrt(log10 n))` where arch
  uses `max(5, int(log10 n))`; both give 5 for n below 100,000. On real series the block lengths differ by about 2%
  (AR(1) with phi 0.3, n 2000: arch 8.976, their rule 8.836) and the intervals barely move; arch is the reference;
- flat-top weights `lambda(k/m)` (1 up to 1/2, then `2 (1 - k/m)`), `g = sum 2 lambda k acv_k`,
  `sigma2 = acv_0 + sum 2 lambda acv_k`; stationary `b = (2 g^2 / (2 sigma2^2))^(1/3) n^(1/3)`, circular with
  4/3 in place of 2; both capped at b_max.
The replications draw the same random numbers arch's `StationaryBootstrap(block, x, seed=SEED)` draws, in the same
order: per replication `integers(n, size=n)` start indices then `random(n)` uniforms from
`numpy.random.default_rng(seed)`; a new block starts where the uniform is at or below `1 / block` (and at position 0),
otherwise the index moves on by one and wraps from n - 1 to 0. So every quantile is exact under the fixed seed and
equals arch's to the last bit.

Statistics per replication (the same functions as the tear sheet, applied row by row): the annualised Sharpe (PF4),
CAGR (PF2; none for a one-contract series, which has no capital) and the maximum drawdown (DD1) on the series' basis.
The interval is the percentile interval: numpy's linear percentiles at 2.5 and 97.5 of the replications. Ruin is
the path touching zero, not only its end: a replication whose book is at or below zero at any point (Basis A: the
running sum has lost all of K, `1 + cumsum r <= 0`; Basis B: equity at or below 0, which in a compounded book means
a period's `1 + r <= 0`) is ruined for good, has a CAGR of -1, the total loss floor, and stays in the percentiles;
the count is reported as `ruin` (dropping those rows would pull the lower bound up: the statistics review found
-41.0% against -47.8% when 0.82% of replications end ruined, under the earlier end-only rule). A statistic still
undefined in a replication (a Sharpe with no spread) is left out and counted as `undefined`.

SV6. The cone: the first H values of each of the same replications (H = one year: 252 sessions, or 12 months, and
never more than n), summed (Basis A, or a one-contract series) or compounded (Basis B) step by step; the 5, 25, 50,
75 and 95 percentiles at each step, with the realised path of the last H periods overlaid. Resampled history, not a
forecast. The percentiles are pointwise: each is taken over the replications at one horizon on its own, so the
5 to 95 region is not a band that whole paths stay inside (on seeded daily series about two thirds of paths leave
it at some step within a year).
"""
from __future__ import annotations

import math
from typing import Iterator

import numpy as np
import pandas as pd

from nq_terminal.analytics._inputs import check_basis, check_periods, returns_array, returns_series

SEED = 20260927
REPS = 10_000
CONFIDENCE = 0.95
CHUNK = 250
MIN_N = 30
CONE_PERCENTILES = (5, 25, 50, 75, 95)
CONE_LABEL = ("resampled history, not a forecast; pointwise percentiles at each horizon, not a band that whole paths "
              "stay inside")
STATISTICS = ("sharpe", "cagr", "max_drawdown")


# ---------------------------------------------------------------- block length (arch's algorithm)


def _optimal_m(eps: np.ndarray, n: int) -> tuple[np.ndarray, int]:
    kn = max(5, int(np.log10(n)))
    m_max = int(np.ceil(np.sqrt(n))) + kn
    band = 2 * np.sqrt(np.log10(n) / n)
    acv, abs_acorr = np.zeros(m_max + 1), np.zeros(m_max + 1)
    opt_m = None
    for i in range(m_max + 1):
        v1 = eps[i + 1:] @ eps[i + 1:]
        v2 = eps[: -(i + 1)] @ eps[: -(i + 1)]
        cross = eps[i:] @ eps[: n - i]
        acv[i] = cross / n
        abs_acorr[i] = np.abs(cross) / np.sqrt(v1 * v2)
        if i >= kn and opt_m is None and np.all(abs_acorr[i - kn:i] < band):
            opt_m = i - kn
    m = 2 * max(opt_m, 1) if opt_m is not None else m_max
    return acv, min(m, m_max)


def optimal_block_length(r) -> dict:
    """Politis-White block lengths {"stationary", "circular", "m"}; NaN lengths for a series without spread."""
    x = returns_array(r)
    n = len(x)
    if n < MIN_N:
        raise ValueError(f"a block length needs at least {MIN_N} observations, got {n}")
    eps = x - x.mean()
    if not np.any(eps):
        return {"stationary": math.nan, "circular": math.nan, "m": None}
    acv, m = _optimal_m(eps, n)
    g, lr_acv = 0.0, acv[0]
    for k in range(1, m + 1):
        lam = 1 if k / m <= 1 / 2 else 2 * (1 - k / m)
        g += 2 * lam * k * acv[k]
        lr_acv += 2 * lam * acv[k]
    b_max = np.ceil(min(3 * np.sqrt(n), n / 3))
    stationary = ((2 * g ** 2) / (2 * lr_acv ** 2)) ** (1 / 3) * n ** (1 / 3)
    circular = ((2 * g ** 2) / (4 / 3 * lr_acv ** 2)) ** (1 / 3) * n ** (1 / 3)
    return {"stationary": float(min(stationary, b_max)), "circular": float(min(circular, b_max)), "m": int(m)}


# ---------------------------------------------------------------- indices (arch's draws)


def _stationary(starts: np.ndarray, u: np.ndarray, p: float) -> np.ndarray:
    """Vectorised arch `stationary_bootstrap_sample` over rows: continue a block where u > p, wrap at n."""
    reps, n = starts.shape
    position = np.arange(n)
    new_block = u <= p
    new_block[:, 0] = True
    last_start = np.maximum.accumulate(np.where(new_block, position, 0), axis=1)
    first = np.take_along_axis(starts, last_start, axis=1)
    return (first + (position - last_start)) % n


def stationary_indices(n: int, block: float, *, reps: int, seed: int = SEED, chunk: int = CHUNK
                       ) -> Iterator[np.ndarray]:
    """Replication indices in chunks of at most `chunk` rows, identical to arch's StationaryBootstrap draws."""
    if not (isinstance(n, int) and n >= 2) or not (isinstance(reps, int) and reps >= 1):
        raise ValueError(f"need n >= 2 and reps >= 1, got n {n!r}, reps {reps!r}")
    if not (math.isfinite(block) and block > 0):
        raise ValueError(f"the block length must be a positive number, got {block!r}")
    rng, p = np.random.default_rng(seed), 1.0 / block
    done = 0
    while done < reps:
        size = min(chunk, reps - done)
        starts, u = np.empty((size, n), dtype=np.int64), np.empty((size, n))
        for row in range(size):
            starts[row] = rng.integers(n, size=n, dtype=np.int64)
            u[row] = rng.random(n)
        yield _stationary(starts, u, p)
        done += size


# ---------------------------------------------------------------- statistics per replication


def _sharpe_rows(x: np.ndarray, periods: int) -> np.ndarray:
    sd = x.std(axis=1, ddof=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(sd > 0, x.mean(axis=1) / sd * math.sqrt(periods), np.nan)


def ruined_rows(x: np.ndarray, basis: str) -> np.ndarray:
    """Rows whose book touches zero at any point: Basis A `1 + cumsum r <= 0`, Basis B a factor `1 + r <= 0`."""
    if basis == "A":
        return np.any(1.0 + np.cumsum(x, axis=1) <= 0.0, axis=1)
    return np.any(1.0 + x <= 0.0, axis=1)


def _cagr_rows(x: np.ndarray, basis: str, periods: int) -> np.ndarray:
    growth = 1.0 + x.sum(axis=1) if basis == "A" else np.prod(1.0 + x, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):  # a book ending at or below zero touched it: ruined
        out = np.where(ruined_rows(x, basis), -1.0, np.abs(growth) ** (periods / x.shape[1]) - 1.0)
    return np.where(np.isnan(growth), np.nan, out)  # ruined on the way: the total loss floor, absorbing


def _max_drawdown_rows(x: np.ndarray, basis: str) -> np.ndarray:
    if basis == "A":
        level = np.cumsum(x, axis=1)
        uw = level - np.maximum(0.0, np.maximum.accumulate(level, axis=1))
    else:
        level = np.cumprod(1.0 + x, axis=1)
        uw = level / np.maximum(1.0, np.maximum.accumulate(level, axis=1)) - 1.0
    return np.minimum(0.0, uw.min(axis=1))


def _replicate(x: np.ndarray, basis: str, periods: int, *, reps: int, seed: int, block: float,
               horizon: int | None) -> tuple[dict, np.ndarray | None]:
    """One pass over the replications: every statistic, and the first `horizon` values of each for the cone."""
    parts: dict[str, list[np.ndarray]] = {name: [] for name in STATISTICS}
    heads: list[np.ndarray] = []
    for rows in stationary_indices(len(x), block, reps=reps, seed=seed):
        sample = x[rows]
        parts["sharpe"].append(_sharpe_rows(sample, periods))
        parts["cagr"].append(_cagr_rows(sample, basis, periods))
        parts["max_drawdown"].append(_max_drawdown_rows(sample, basis))
        if horizon:
            heads.append(sample[:, :horizon])
    return {name: np.concatenate(values) for name, values in parts.items()}, (np.vstack(heads) if heads else None)


def resample_statistics(r, basis: str, periods: int, *, reps: int = REPS, seed: int = SEED, block: float,
                        on_capital: bool = True) -> dict:
    """Sharpe, CAGR (None without capital) and max drawdown of every replication, in replication order."""
    check_basis(basis)
    check_periods(periods)
    out, _ = _replicate(returns_array(r), basis, periods, reps=reps, seed=seed, block=block, horizon=None)
    if not on_capital:
        out["cagr"] = None
    return out


def _interval(values: np.ndarray | None, point: float | None, confidence: float, *, floor: bool = False
              ) -> dict | None:
    """The percentile interval over the defined replications; `floor` counts the ones at the total loss (CAGR)."""
    if values is None:
        return None
    kept = values[np.isfinite(values)]
    tail = round(50 * (1 - confidence), 12)  # 2.5 exactly for 95%, not 2.5000000000000022
    lo, hi = (np.percentile(kept, [tail, 100 - tail]) if len(kept) else (math.nan, math.nan))
    return {"point": point, "lo": float(lo), "hi": float(hi),
            "median": float(np.percentile(kept, 50)) if len(kept) else math.nan,
            "mean": float(kept.mean()) if len(kept) else math.nan,
            "sd": float(kept.std(ddof=1)) if len(kept) > 1 else math.nan,
            "undefined": int(len(values) - len(kept)), "ruin": int(np.sum(kept <= -1.0)) if floor else 0}


def _points(x: np.ndarray, basis: str, periods: int, on_capital: bool) -> dict:
    row = x[np.newaxis, :]
    return {"sharpe": float(_sharpe_rows(row, periods)[0]),
            "cagr": float(_cagr_rows(row, basis, periods)[0]) if on_capital else None,
            "max_drawdown": float(_max_drawdown_rows(row, basis)[0])}


# ---------------------------------------------------------------- SV6 cone


def horizon_for(periods: int, n: int) -> int:
    return min(check_periods(periods), n)


def _levels(paths: np.ndarray, basis: str, on_capital: bool) -> np.ndarray:
    if basis == "A" or not on_capital:
        return np.cumsum(paths, axis=-1)
    return np.cumprod(1.0 + paths, axis=-1) - 1.0


def _cone_view(series: pd.Series, heads: np.ndarray, basis: str, on_capital: bool) -> dict:
    horizon = heads.shape[1]
    levels = _levels(heads, basis, on_capital)
    tail = series.iloc[-horizon:]
    dates = [d.strftime("%Y-%m-%d") for d in tail.index] if isinstance(tail.index, pd.DatetimeIndex) else []
    return {"horizon": horizon, "steps": list(range(1, horizon + 1)),
            "quantiles": {str(q): np.percentile(levels, q, axis=0) for q in CONE_PERCENTILES},
            "realised": _levels(tail.to_numpy(), basis, on_capital), "realised_dates": dates,
            "how": "summed" if basis == "A" or not on_capital else "compounded", "label": CONE_LABEL}


def cone(r, basis: str, periods: int, *, reps: int = REPS, seed: int = SEED, block: float,
         on_capital: bool = True) -> dict:
    """SV6 percentiles per step over one year, from the first H values of each replication, plus the realised path."""
    check_basis(basis)
    series = returns_series(r)
    x = series.to_numpy()
    _, heads = _replicate(x, basis, periods, reps=reps, seed=seed, block=block, horizon=horizon_for(periods, len(x)))
    return _cone_view(series, heads, basis, on_capital)


# ---------------------------------------------------------------- SV5 and SV6 together


def bootstrap_summary(r, basis: str, periods: int, *, on_capital: bool = True, reps: int = REPS, seed: int = SEED,
                      confidence: float = CONFIDENCE) -> dict:
    """SV5 percentile intervals for Sharpe, CAGR and max drawdown, and the SV6 cone, from one set of replications."""
    check_basis(basis)
    check_periods(periods)
    series = returns_series(r)
    x = series.to_numpy()
    block = optimal_block_length(x)
    if not math.isfinite(block["stationary"]):
        raise ValueError("the series has no spread, so it has no block length and no bootstrap")
    stats, heads = _replicate(x, basis, periods, reps=reps, seed=seed, block=block["stationary"],
                              horizon=horizon_for(periods, len(x)))
    if not on_capital:
        stats["cagr"] = None
    points = _points(x, basis, periods, on_capital)
    return {"block": block, "reps": reps, "seed": seed, "confidence": confidence,
            "stats": {name: _interval(stats[name], points[name], confidence, floor=name == "cagr")
                      for name in STATISTICS},
            "cone": _cone_view(series, heads, basis, on_capital)}
