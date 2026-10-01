"""Response models for the P2 risk extras (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5).

Same conventions as `models/analytics.py` and `models/analytics_p1.py`: every view names its basis and unit, every
value is computed by the terminal and carries "[POST HOC]", an undefined value is null (never NaN), and nothing here
is a test: no p-value appears in these views.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Basis, Context, Kpi, Num, Tag
from nq_terminal.models.common import ResponseModel


class CornishFisherEsLevel(ResponseModel):
    level: Literal["95", "99"]
    tail: float
    z: float
    cf_quantile: Num = Field(description="h, the Cornish-Fisher quantile of the tail (RK3's expansion)")
    edgeworth_mean: Num = Field(description="E_G, the Edgeworth expected value of z at or below h over the tail")
    gaussian: Num = Field(description="Gaussian ES -mu + sigma phi(z) / tail, a positive loss; greyed when not used")
    historical: Num = Field(description="RK1's historical CVaR at the same tail, the comparator beside it")
    raw_expansion: Num = Field(description="the modified ES even where it is not defined (for the record)")
    modified: Num = Field(description="null outside the monotone domain or below zero (inverse risk)")
    value: Num = Field(description="the tile: the modified ES where defined, else the historical CVaR")
    in_domain: bool
    floored: bool = Field(description="the operational floor was taken: E_G lies above h, so the ES equals the "
                                      "modified VaR")
    method: str


class CornishFisherEsView(ResponseModel):
    """RK4: modified expected shortfall (Boudt, Peterson and Croux 2008) with PerformanceAnalytics' moments."""

    basis: Basis
    unit: str
    horizon: str
    mean: Num
    sigma: Num
    skew: Num
    excess_kurtosis: Num
    domain: str = Field(description="the monotone domain (RK3's) outside which the value is not defined, and the "
                                    "fallback")
    levels: list[CornishFisherEsLevel]


class TreynorView(ResponseModel):
    """BR5: CAGR over BR1's beta; null without a benchmark, without a capital K or with a beta of 0."""

    tile: Kpi
    cagr: Num = Field(description="PF2 over the whole series on its basis (fraction per year)")
    beta: Num = Field(description="BR1's OLS slope on the rows where both sides have a value")
    n_pairs: int
    bench_label: str | None
    note: str | None = Field(description="how to read the ratio (a negative beta), or why it is null")


class RiskExtras(ResponseModel):
    """RK4, PF11 and BR5 of one tear sheet series, all "[POST HOC]" and descriptive."""

    context: Context
    basis: Basis
    unit: str
    periods_per_year: int
    n: int
    tag: Tag
    descriptive: str
    drawdown_tiles: list[Kpi] = Field(description="PF11: ulcer index and recovery factor (the RET tab)")
    modified_es: CornishFisherEsView = Field(description="RK4 at 95% and 99% (the RET tab)")
    treynor: TreynorView = Field(description="BR5 (the RR tab)")
