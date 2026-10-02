"""Risk (ANALYTICS_CATALOG.md section 5: RK1 historical VaR and CVaR, RK2 21-session loss distribution).

RK1: `VaR = -Q_tail(r)` with numpy's linear quantile and `CVaR = -mean(r | r <= Q_tail(r))`, both 1-day, as
positive loss numbers. `tail` is the tail probability (0.05 for 95%, 0.01 for 99%). This is empyrical's
`value_at_risk`; empyrical's `conditional_value_at_risk` averages a partition by index instead, so the two
CVaR values can differ slightly; the catalogue definition is used. quantstats `value_at_risk` is parametric
and is not a reference.

RK2: overlapping 21-session sums of r and their 1% and 5% mean shortfall (mean of the worst
`max(1, ceil(q * m))` sums), the same code path as `nq_lab.sizing_stats.tails`, which reports the shortfalls
in % (tested to agree). Never square-root-of-time scaled. Values here are fractions (of K for Basis A).

RK3 (P1): normal VaR `-(mu + sigma z)` and Cornish-Fisher VaR `-(mu + sigma z_cf)`,
`z_cf = z + (z^2 - 1) S/6 + (z^3 - 3z) K/24 - (2z^3 - 5z) S^2/36`, z the normal quantile of the tail, S the skewness,
K the excess kurtosis, with PerformanceAnalytics' moments (`VaR(method="modified")`, `VaR.CornishFisher`): mu the mean,
sigma^2, S and K from the population central moments m2, m3, m4 (`S = m3 / m2^1.5`, `K = m4 / m2^2 - 3`).
The expansion is a quantile function only where it increases in z. Its derivative is the quadratic
`q'(z) = a z^2 + b z + c`, `a = K/8 - S^2/6`, `b = S/3`, `c = 1 - K/8 + 5 S^2/36`, so it is monotone for every z exactly
when `a > 0` and `b^2 - 4ac <= 0` (at S = 0: 0 <= K <= 8), or S = K = 0. Outside that domain the Cornish-Fisher
value is not defined (`in_domain` False, `method` says so) and the shown value is RK1's historical VaR at the same tail:
most registered daily series are fat-tailed far outside the domain, where the normal VaR overstates the historical one
by half or more, so the normal VaR is only reported greyed. The raw expansion is kept for the record.
"""
from __future__ import annotations

import math
from types import ModuleType

import numpy as np
import pandas as pd

from nq_terminal.analytics._inputs import returns_array, returns_series


def _sps() -> ModuleType:
    """`scipy.stats`, imported on first use so the start path does not pay for it (D1.1, 04)."""
    from scipy import stats

    return stats


VAR_TAILS = {"95": 0.05, "99": 0.01}
LOSS_WINDOW = 21
SHORTFALL_TAILS = {"1pct": 0.01, "5pct": 0.05}


def _check_tail(tail: float) -> float:
    if not 0 < tail < 0.5:
        raise ValueError(f"tail must be a tail probability in (0, 0.5), e.g. 0.05 for 95%, got {tail!r}")
    return tail


def historical_var(r, tail: float = 0.05) -> float:
    """RK1 VaR at tail probability `tail` (a positive number is a loss); NaN on an empty series."""
    _check_tail(tail)
    values = returns_array(r)
    return float(-np.quantile(values, tail)) if len(values) else math.nan


def historical_cvar(r, tail: float = 0.05) -> float:
    """RK1 CVaR: minus the mean of the returns at or below the `tail` quantile; NaN on an empty series."""
    _check_tail(tail)
    values = returns_array(r)
    if not len(values):
        return math.nan
    cut = np.quantile(values, tail)
    return float(-values[values <= cut].mean())


def var_table(r) -> dict[str, float]:
    """RK1 tiles: VaR and CVaR at 95% and 99%, 1 day."""
    out: dict[str, float] = {}
    for level, tail in VAR_TAILS.items():
        out[f"var_{level}"] = historical_var(r, tail)
        out[f"cvar_{level}"] = historical_cvar(r, tail)
    return out


def rolling_sums(r, window: int = LOSS_WINDOW) -> pd.Series:
    """Overlapping `window`-session sums, labelled by their last session (first label is session window-1)."""
    if not isinstance(window, int) or window < 1:
        raise ValueError(f"window must be a positive integer, got {window!r}")
    return returns_series(r).rolling(window).sum().dropna()


def mean_shortfall(sums, q: float) -> float:
    """Mean of the worst max(1, ceil(q * m)) of m sums (negative for a loss); NaN when there are none."""
    worst = np.sort(np.asarray(sums, dtype=float))
    if not len(worst):
        return math.nan
    return float(worst[:max(1, math.ceil(q * len(worst)))].mean())


def loss_distribution(r, window: int = LOSS_WINDOW) -> dict:
    """RK2: the overlapping sums (for the histogram) and their 1% and 5% mean shortfall."""
    sums = rolling_sums(r, window)
    out = {"window": window, "n": int(len(sums)), "sums": sums}
    for name, q in SHORTFALL_TAILS.items():
        out[f"shortfall_{name}"] = mean_shortfall(sums, q)
    return out


# ---------------------------------------------------------------- RK3 (P1)


def _population_moments(values: np.ndarray) -> tuple[float, float, float, float]:
    """(mean, sigma, skewness, excess kurtosis) from the population central moments, as PerformanceAnalytics."""
    mu = float(values.mean())
    dev = values - mu
    m2, m3, m4 = (float(np.mean(dev ** k)) for k in (2, 3, 4))
    if not m2 > 0:
        return mu, 0.0, math.nan, math.nan
    return mu, math.sqrt(m2), m3 / m2 ** 1.5, m4 / m2 ** 2 - 3.0


CF_INSIDE = "Cornish-Fisher (inside its monotone domain)"
CF_OUTSIDE = ("not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the "
              "historical VaR (RK1) is shown beside it, the normal VaR only greyed")


def cf_quantile(z, skew: float, exkurt: float):
    """The Cornish-Fisher expansion of the normal quantile z (scalar or array)."""
    z = np.asarray(z, dtype=float) if not np.isscalar(z) else float(z)
    return (z + (z ** 2 - 1) * skew / 6 + (z ** 3 - 3 * z) * exkurt / 24
            - (2 * z ** 3 - 5 * z) * skew ** 2 / 36)


def cf_derivative_coefficients(skew: float, exkurt: float) -> tuple[float, float, float]:
    """(a, b, c) of the expansion's derivative `a z^2 + b z + c`."""
    return exkurt / 8 - skew ** 2 / 6, skew / 3, 1 - exkurt / 8 + 5 * skew ** 2 / 36


def cf_monotone(skew: float, exkurt: float) -> bool:
    """Whether the expansion increases for every z (the domain in the module docstring)."""
    if not (math.isfinite(skew) and math.isfinite(exkurt)):
        return False
    if skew == 0 and exkurt == 0:
        return True
    a, b, c = cf_derivative_coefficients(skew, exkurt)
    return bool(a > 0 and b * b - 4 * a * c <= 0)


def normal_var(r, tail: float = 0.05) -> float:
    """Gaussian VaR with PerformanceAnalytics' moments: `-(mu + sigma z)`; NaN on an empty series."""
    _check_tail(tail)
    values = returns_array(r)
    if not len(values):
        return math.nan
    mu, sigma, _, _ = _population_moments(values)
    return float(-(mu + sigma * _sps().norm.ppf(tail)))


def cornish_fisher_var(r, tail: float = 0.05) -> dict:
    """RK3 at one tail: the Cornish-Fisher VaR inside the monotone domain, else the historical VaR (RK1) with the
    reason; the normal VaR is returned beside it either way."""
    _check_tail(tail)
    values = returns_array(r)
    if len(values) < 4:
        raise ValueError(f"Cornish-Fisher VaR needs at least 4 returns, got {len(values)}")
    mu, sigma, skew, exkurt = _population_moments(values)
    z = float(_sps().norm.ppf(tail))
    normal = float(-(mu + sigma * z))
    raw = float(-(mu + sigma * cf_quantile(z, skew, exkurt))) if math.isfinite(skew) else math.nan
    inside = cf_monotone(skew, exkurt)
    historical = historical_var(values, tail)
    method = CF_INSIDE if inside else CF_OUTSIDE
    return {"tail": tail, "z": z, "mean": mu, "sigma": sigma, "skew": skew, "excess_kurtosis": exkurt,
            "normal": normal, "historical": historical, "raw_expansion": raw,
            "cornish_fisher": raw if inside else None, "in_domain": inside,
            "value": raw if inside else historical, "method": method}


def modified_var_table(r) -> dict[str, dict]:
    """RK3 at 95% and 99%, one period."""
    return {level: cornish_fisher_var(r, tail) for level, tail in VAR_TAILS.items()}
