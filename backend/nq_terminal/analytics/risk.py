"""Risk (ANALYTICS_CATALOG.md section 5: RK1 historical VaR and CVaR, RK2 21-session loss distribution).

RK1: `VaR = -Q_tail(r)` with numpy's linear quantile and `CVaR = -mean(r | r <= Q_tail(r))`, both 1-day, as
positive loss numbers. `tail` is the tail probability (0.05 for 95%, 0.01 for 99%). This is empyrical's
`value_at_risk`; empyrical's `conditional_value_at_risk` averages a partition by index instead, so the two
CVaR values can differ slightly; the catalogue definition is used. quantstats `value_at_risk` is parametric
and is not a reference.

RK2: overlapping 21-session sums of r and their 1% and 5% mean shortfall (mean of the worst
`max(1, ceil(q * m))` sums), the same code path as `nq_lab.sizing_stats.tails`, which reports the shortfalls
in % (tested to agree). Never square-root-of-time scaled. Values here are fractions (of K for Basis A).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from nq_terminal.analytics._inputs import returns_array, returns_series

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
