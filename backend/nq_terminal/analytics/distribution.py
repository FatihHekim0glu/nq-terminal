"""Return distributions (ANALYTICS_CATALOG.md section 4: RD1 histogram, RD2 monthly heatmap and yearly bars).

RD1: Freedman-Diaconis edges (`numpy.histogram_bin_edges(bins="fd")`), counts, and a fitted normal overlay
given as the expected count per bin, `n * width * pdf(centre; mean, sd ddof=1)`, plus the RK1 VaR 95 and 99
lines. When the interquartile range is 0 (a one-contract series that is flat on 95% of its sessions) the
Freedman-Diaconis width is 0 and numpy falls back to a single bin, so Sturges' rule is used instead and
`bin_rule` says which rule made the edges.

RD2, per basis (C1): Basis A sums the returns in each month (or year); Basis B compounds them,
`prod(1 + r) - 1` (Nautilus `_aggregate_period_returns(compounding=True)`). Months are calendar months of the
session dates as given (a UTC index groups on UTC dates). Months with no session are absent (NaN in the grid).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_terminal.analytics._inputs import check_basis, dated_series, returns_array
from nq_terminal.analytics.risk import VAR_TAILS, historical_var

MONTHS = list(range(1, 13))
FD_RULE = "Freedman-Diaconis"
STURGES_RULE = "Sturges (the interquartile range is 0, so Freedman-Diaconis would give one bin)"


def histogram(r) -> dict:
    """RD1: edges, counts, bin centres, the normal overlay (expected counts) and the VaR lines."""
    values = returns_array(r)
    if not len(values):
        raise ValueError("a histogram needs at least one return")
    rule = FD_RULE
    edges = np.histogram_bin_edges(values, bins="fd")
    if len(values) > 1 and np.subtract(*np.percentile(values, [75, 25])) == 0:
        rule, edges = STURGES_RULE, np.histogram_bin_edges(values, bins="sturges")
    counts, _ = np.histogram(values, bins=edges)
    centres = (edges[:-1] + edges[1:]) / 2
    mean = float(values.mean())
    sd = float(values.std(ddof=1)) if len(values) > 1 else math.nan
    if sd > 0:
        normal = len(values) * np.diff(edges) * sps.norm.pdf(centres, mean, sd)
    else:
        normal = np.full(len(centres), math.nan)
    return {"edges": edges, "counts": counts, "centres": centres, "normal": normal, "mean": mean, "sd": sd,
            "bin_rule": rule,
            "var_95": historical_var(values, VAR_TAILS["95"]), "var_99": historical_var(values, VAR_TAILS["99"])}


def _aggregate(r, basis: str, by_month: bool) -> pd.Series:
    check_basis(basis)
    series = dated_series(r)
    idx = series.index
    year, month = idx.year.rename("year"), idx.month.rename("month")
    keys = [year, month] if by_month else [year]
    if basis == "A":
        return series.groupby(keys).sum()
    return (1.0 + series).groupby(keys).prod() - 1.0


def monthly_returns(r, basis: str) -> pd.Series:
    """RD2 month returns on a (year, month) MultiIndex."""
    return _aggregate(r, basis, by_month=True)


def yearly_returns(r, basis: str) -> pd.Series:
    """RD2 yearly bars, indexed by year."""
    return _aggregate(r, basis, by_month=False)


def monthly_heatmap(r, basis: str) -> pd.DataFrame:
    """RD2 grid: one row per year, columns 1 to 12, NaN where a month has no session."""
    grid = monthly_returns(r, basis).unstack("month")
    return grid.reindex(columns=MONTHS)
