"""Statistical validity (ANALYTICS_CATALOG section 7: SV1, SV2, SV4, SV7) and the PF4 Sharpe interval.

Moments. SR is per period (daily, not annualised): mean / sd(ddof=1), as C2 and `sizing_stats.sharpe`. Skewness
g3 and kurtosis g4 are the population moment ratios (scipy `skew(bias=True)`, `kurtosis(fisher=False,
bias=True)`; g4 is raw, Normal = 3), which is what Bailey and Lopez de Prado's code and PerformanceAnalytics
(`method="moment"`) feed the PSR. PF10's stats table uses the bias-corrected moments instead; the difference is
O(1/n) and the PSR inputs are reported next to the PSR so the number can be reproduced.

- Variance term V(SR) = 1 - g3*SR + (g4-1)/4*SR^2, the same algebra as Mertens (2002),
  1 + SR^2/2 - g3*SR + (g4-3)/4*SR^2.
- Mertens standard error (PF4): SE_d = sqrt(V / (n-1)); 95% CI = SR_ann +/- 1.96*SE_d*sqrt(P).
- PSR (SV1, DSR paper eq. 2): Phi((SR - SR*) * sqrt(n-1) / sqrt(V)).
- MinTRL (SV2, SSRN 1821643 eq. 13): 1 + V * (z_{1-alpha} / (SR - SR*))^2 observations; not reachable when
  SR <= SR*.
- SV4: Bonferroni, Holm (step-down) and Benjamini-Hochberg (step-up) adjusted p over the registered rows of
  `results/registry.csv`, plus the rank boundaries alpha/k, alpha/(k-i+1) and i*alpha/k for the chart.
- SV7: the Ledoit-Wolf and Memmel Sharpe-difference tests are read from the screen JSON, never recomputed.

Everything here is descriptive: it never produces a pass or fail (the verdicts live in the result files).
"""
from __future__ import annotations

import copy
import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_lab.sizing_stats import sharpe
from nq_terminal.analytics._inputs import check_periods
from nq_terminal.analytics.relative import align_pair

PERIODS_PER_YEAR = 252
ALPHA = 0.05
REJECT_TOL = 1e-12  # relative: an adjusted p equal to alpha up to rounding is a rejection, as on the rank line
REACHABLE, BELOW, UNDEFINED = "reachable", "below_threshold", "undefined"
Z95 = 1.96  # PF4: SR +/- 1.96 * SE, as written in the catalogue
SHARPE_DIFF_LABEL = "Sharpe difference (m - BH)"  # C4: the screens' `dsr` field, never the Deflated Sharpe
ADJUSTED_COLUMNS = ("bonferroni_p", "holm_p", "bh_q")


def _clean(r) -> np.ndarray:
    x = np.asarray(r, dtype=float).ravel()
    return x[~np.isnan(x)]


def _check_alpha(alpha: float) -> None:
    if not 0 < alpha < 1:
        raise ValueError(f"alpha must lie in (0, 1), got {alpha}")


# ---------- moments, Mertens, PSR, MinTRL ----------

def moments(r) -> dict:
    """n, per-period SR (ddof=1), population skewness and raw kurtosis of the finite values of r."""
    x = _clean(r)
    n = int(len(x))
    sd = float(x.std(ddof=1)) if n > 1 else math.nan
    sr = float(x.mean() / sd) if sd > 0 else math.nan
    skew = float(sps.skew(x, bias=True)) if n > 2 else math.nan
    kurt = float(sps.kurtosis(x, fisher=False, bias=True)) if n > 3 else math.nan
    return {"n": n, "sr": sr, "skew": skew, "kurt": kurt}


def sr_variance_term(sr: float, skew: float, kurt: float) -> float:
    """1 - g3*SR + (g4-1)/4*SR^2 (g4 raw kurtosis)."""
    return 1.0 - skew * sr + (kurt - 1.0) / 4.0 * sr ** 2


def mertens_se(sr: float, n: float, skew: float, kurt: float) -> float:
    """Standard error of the per-period Sharpe estimate: sqrt(V / (n-1)); NaN when V <= 0 or n <= 1."""
    term = sr_variance_term(sr, skew, kurt)
    if not (n > 1 and term > 0):
        return math.nan
    return math.sqrt(term / (n - 1))


def psr(sr: float, sr_star: float, n: float, skew: float, kurt: float) -> float:
    """Probabilistic Sharpe Ratio, SR and SR* per period; NaN when the variance term is not positive."""
    se = mertens_se(sr, n, skew, kurt)
    if math.isnan(se) or math.isnan(sr) or math.isnan(sr_star):
        return math.nan
    return float(sps.norm.cdf((sr - sr_star) / se))


def psr_from_returns(r, sr_star: float = 0.0) -> float:
    """PSR(SR*) of a return series; SR* per period (for an annual threshold pass SR_ann / sqrt(P))."""
    m = moments(r)
    return psr(m["sr"], sr_star, m["n"], m["skew"], m["kurt"])


def min_trl(sr: float, sr_star: float, skew: float, kurt: float, alpha: float = ALPHA) -> float:
    """Minimum track record length in observations; inf when SR <= SR* (not reachable)."""
    _check_alpha(alpha)
    if not sr > sr_star:
        return math.inf
    term = sr_variance_term(sr, skew, kurt)
    if not term > 0:
        return math.nan
    return float(1.0 + term * (sps.norm.ppf(1.0 - alpha) / (sr - sr_star)) ** 2)


def min_trl_from_returns(r, sr_star: float = 0.0, alpha: float = ALPHA, periods: int = PERIODS_PER_YEAR) -> dict:
    """SV2 for a series: MinTRL in sessions and years next to the actual length; None when not reachable.

    `reason`: "reachable"; "below_threshold" when SR <= SR* (the length is infinite); "undefined" when the moments
    leave it undefined (n <= 3, no spread, or a variance term that is not positive).
    """
    check_periods(periods)
    m = moments(r)
    sessions = min_trl(m["sr"], sr_star, m["skew"], m["kurt"], alpha) if m["n"] > 3 else math.nan
    reachable = math.isfinite(sessions)
    reason = REACHABLE if reachable else BELOW if sessions == math.inf else UNDEFINED
    return {
        "sessions": sessions if reachable else None,
        "years": sessions / periods if reachable else None,
        "reachable": reachable,
        "reason": reason,
        "actual_sessions": m["n"],
        "actual_years": m["n"] / periods,
        "sr_star_per_period": sr_star,
        "alpha": alpha,
    }


def sharpe_ci(r, periods: int = PERIODS_PER_YEAR, z: float = Z95) -> dict:
    """PF4: annualised Sharpe (`sizing_stats.sharpe`) with the Mertens 95% interval, plus its moments.

    The one implementation of the interval: `perf.sharpe_ci` calls this after refusing NaN."""
    check_periods(periods)
    x = _clean(r)
    m = moments(x)
    point = sharpe(x, periods)
    se_annual = mertens_se(m["sr"], m["n"], m["skew"], m["kurt"]) * math.sqrt(periods)
    return {"sharpe": point, "se_annual": se_annual, "lo": point - z * se_annual, "hi": point + z * se_annual,
            "z": z, "n": m["n"], "periods_per_year": periods, "moments": m}


def validity_summary(r, b=None, periods: int = PERIODS_PER_YEAR, alpha: float = ALPHA) -> dict:
    """PF4 interval, PSR and MinTRL at SR* = 0 and, given a benchmark, at the benchmark's per-period Sharpe.

    With a benchmark both series are first aligned (common sessions, NaN rows dropped).
    """
    check_periods(periods)
    if b is not None:
        x, y, index = align_pair(r, b)
        r = pd.Series(x, index) if index is not None else x
        sr_b = moments(y)["sr"]
    out = {"sharpe_ci": sharpe_ci(r, periods),
           "psr": {"at_zero": psr_from_returns(r, 0.0)},
           "min_trl": {"at_zero": min_trl_from_returns(r, 0.0, alpha, periods)}}
    if b is not None:
        out["psr"].update(at_benchmark=psr_from_returns(r, sr_b), benchmark_sr_per_period=sr_b)
        out["min_trl"]["at_benchmark"] = min_trl_from_returns(r, sr_b, alpha, periods)
    return out


# ---------- SV4: multiple testing ----------

def _sorted_finite(p) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(p as float array, positions of the finite values in ascending p order (stable), those p values)."""
    arr = np.asarray(p, dtype=float).ravel()
    finite = np.flatnonzero(np.isfinite(arr))
    order = finite[np.argsort(arr[finite], kind="stable")]
    return arr, order, arr[order]


def bonferroni(p) -> np.ndarray:
    """min(1, k*p), k = number of finite p; NaN passes through."""
    arr, order, _ = _sorted_finite(p)
    out = np.full(arr.shape, np.nan)
    out[order] = np.minimum(1.0, len(order) * arr[order])
    return out


def holm(p) -> np.ndarray:
    """Holm step-down adjusted p: running max of (k - i + 1) * p_(i), capped at 1; NaN passes through."""
    arr, order, ps = _sorted_finite(p)
    k = len(order)
    out = np.full(arr.shape, np.nan)
    out[order] = np.minimum(1.0, np.maximum.accumulate((k - np.arange(k)) * ps))
    return out


def benjamini_hochberg(p) -> np.ndarray:
    """BH q: running min from the top of p_(i) * k / i, capped at 1; NaN passes through."""
    arr, order, ps = _sorted_finite(p)
    k = len(order)
    out = np.full(arr.shape, np.nan)
    out[order] = np.minimum(1.0, np.minimum.accumulate((ps * k / np.arange(1, k + 1))[::-1])[::-1])
    return out


def mt_boundaries(p, alpha: float = ALPHA) -> pd.DataFrame:
    """Sorted finite p against rank with the Bonferroni, Holm and BH lines and each procedure's rejections."""
    _check_alpha(alpha)
    arr, order, ps = _sorted_finite(p)
    k = len(order)
    rank = np.arange(1, k + 1)
    holm_line = alpha / (k - rank + 1)
    bh_line = rank * alpha / k
    # Rejections are read off the adjusted p, so the table and the chart never disagree at a float boundary.
    adjusted = {"bonferroni": bonferroni(arr)[order], "holm": holm(arr)[order], "bh": benjamini_hochberg(arr)[order]}
    limit = alpha * (1.0 + REJECT_TOL)
    return pd.DataFrame({
        "rank": rank, "input_position": order, "p": ps,
        "bonferroni_line": np.full(k, alpha / k) if k else np.empty(0), "holm_line": holm_line, "bh_line": bh_line,
        "bonferroni_p": adjusted["bonferroni"], "holm_p": adjusted["holm"], "bh_q": adjusted["bh"],
        "reject_bonferroni": adjusted["bonferroni"] <= limit,
        "reject_holm": adjusted["holm"] <= limit,
        "reject_bh": adjusted["bh"] <= limit,
    })


def _max_abs_diff(computed: np.ndarray, stored: np.ndarray) -> float:
    """Largest |computed - stored|; a NaN on one side only counts as an infinite difference."""
    c, s = np.asarray(computed, dtype=float), np.asarray(stored, dtype=float)
    if (np.isnan(c) != np.isnan(s)).any():
        return math.inf
    both = ~np.isnan(c)
    return float(np.abs(c[both] - s[both]).max()) if both.any() else 0.0


def registry_adjustments(registry: pd.DataFrame) -> dict:
    """SV4 over the registered rows of a registry frame: recomputed adjusted p and the gap to the stored columns.

    Unregistered rows (checks inside a hypothesis) are outside the family. Sealed confirmations are not in the
    registry CSV and keep their own alpha.
    """
    reg = registry[registry["registered"].astype(str) == "True"]
    p = reg["p"].to_numpy(dtype=float)
    computed = {"bonferroni_p": bonferroni(p), "holm_p": holm(p), "bh_q": benjamini_hochberg(p)}
    k = int(np.isfinite(p).sum())
    rows = pd.DataFrame({"name": reg["name"].to_numpy(), "p": p, **computed})
    return {
        "family_k": k,
        "family_k_ok": bool((pd.to_numeric(reg["family_k"], errors="coerce") == k).all()),
        "rows": rows,
        "max_abs_diff": {col: _max_abs_diff(computed[col], reg[col].to_numpy(dtype=float))
                         for col in ADJUSTED_COLUMNS},
    }


# ---------- SV7: Sharpe difference tests from the screen JSON ----------

def _reported_by_cost(reported: dict) -> dict:
    """Both screen shapes to {cost: {"ledoit_wolf": ..., "memmel": ...}}.

    volmanaged_v0: reported.ledoit_wolf.<cost>, reported.memmel.<cost>; tsmom_v0: reported.<cost>.ledoit_wolf.
    """
    tests = ("ledoit_wolf", "memmel")
    out: dict = {}
    for test in tests:
        for cost, value in (reported.get(test) or {}).items():
            out.setdefault(cost, {})[test] = value
    for cost, value in reported.items():
        if cost not in tests and isinstance(value, dict) and any(t in value for t in tests):
            out.setdefault(cost, {}).update({t: value[t] for t in tests if t in value})
    return out


def sharpe_difference_tests(screen: dict) -> dict:
    """SV7: stored Ledoit-Wolf and Memmel results per cost level, with the headline Sharpe difference (C4).

    Values are copied from the JSON as they are; an absent test is None; a screen without them gives {}.
    """
    reported = screen.get("reported")
    if not isinstance(reported, dict):
        return {}
    headline = screen.get("headline") or {}
    out = {}
    for cost, found in _reported_by_cost(reported).items():
        head = headline.get(cost) if isinstance(headline.get(cost), dict) else {}
        out[cost] = {"label": SHARPE_DIFF_LABEL,
                     "sharpe_difference": head.get("dsr"),
                     "ledoit_wolf": copy.deepcopy(found.get("ledoit_wolf")),
                     "memmel": copy.deepcopy(found.get("memmel"))}
    return out
