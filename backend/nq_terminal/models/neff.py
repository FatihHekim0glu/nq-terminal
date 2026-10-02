"""Response models for SV3b (the effective number of trials, on `DeflatedView.effective_n`) and SV8 step 8 (the
effective number of members, on `SpaView.effective_members`), ANALYTICS_CATALOG SV3b and SV8.

Both were computed in the browser under the C8 client-phase exception; they are served now (`analytics/neff.py`) and
the browser shows what is sent. Same conventions as `models/analytics_p1.py`: an undefined value is null, and a
refusal is a field of its own (a status line on screen, never an error): nothing else of the view is filled then.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Num
from nq_terminal.models.common import ResponseModel

EstimateId = Literal["registered", "participation", "li_ji", "clusters"]


class EffectiveNRefusal(ResponseModel):
    kind: Literal["no_daily", "too_few", "degenerate"] = Field(
        description="no_daily: the view names no daily trial; too_few: fewer sessions than the minimum are common to "
                    "every daily trial (`sessions` says how many); degenerate: a daily trial does not vary on the "
                    "common window (`name` says which)")
    name: str | None
    sessions: int | None


class EffectiveNWindow(ResponseModel):
    first: str = Field(description="first session on which every daily trial has a return")
    last: str
    sessions: int


class EffectiveNEstimate(ResponseModel):
    id: EstimateId
    n_daily: float = Field(description="the estimated number of daily trials (the registered count for `registered`)")
    n_total: float = Field(description="n_daily plus the monthly books, counted as independent trials")
    sr0_session: Num = Field(description="SR0 per session at n_total under the served null variance V0")
    sr0_annual: Num
    served: bool = Field(description="true for the registered row, the N and SR0 SV3 itself serves")


class EffectiveNDsr(ResponseModel):
    name: str
    periods: int
    served: Num = Field(description="the served DSR under V0 at the registered N")
    participation: Num = Field(description="DSR under V0 at the participation-ratio N")
    li_ji: Num
    clusters: Num


class EffectiveNView(ResponseModel):
    """SV3b: the effective number of trials from the registered daily trials' own return correlations, and the SR0
    and DSR each N would set, beside the served N. An extra view: it never overrides a frozen pass bar."""

    construction: str
    note: str
    cluster_cut: float = Field(description="the cut on 1 - rho of the average-linkage tree")
    min_common_sessions: int
    daily: list[str] = Field(description="the daily trials (P = 252) in the served order: the rows of `correlation`")
    monthly: list[str] = Field(description="the monthly books, counted as independent trials")
    refusal: EffectiveNRefusal | None
    window: EffectiveNWindow | None
    correlation: list[list[float]] = Field(description="Pearson, daily trials on the common window; empty when refused")
    eigenvalues: list[float] = Field(description="largest first")
    clusters: list[list[int]] = Field(
        description="flat clusters at the cut as indexes into `daily`: members ascending, ordered by first member")
    sequence: list[int] = Field(description="`daily` indexes grouped by cluster, the largest cluster first")
    estimates: list[EffectiveNEstimate]
    dsr: list[EffectiveNDsr] = Field(description="one row per registered trial, in the SV3 row order")


class SpaStrongestPair(ResponseModel):
    a: str
    b: str
    rho: float


class SpaEffectiveRefusal(ResponseModel):
    kind: Literal["single", "undefined"] = Field(
        description="single: one member only; undefined: a member does not vary on the common index, so it has no "
                    "correlation (`name` says which)")
    name: str | None


class SpaEffectiveMembers(ResponseModel):
    """SV8 step 8: the effective number of members from the correlation of the loss differentials. It describes the
    dependence the maximum statistic ran over and does not adjust any p-value."""

    k: int
    cut: float
    refusal: SpaEffectiveRefusal | None
    participation: Num = Field(description="(sum of eigenvalues)^2 / sum of squared eigenvalues")
    li_ji: Num = Field(description="Li and Ji (2005)")
    clusters: list[list[str]] = Field(
        description="UPGMA clusters at 1 - rho = `cut` as member names (family order inside a cluster), the largest "
                    "cluster first")
    strongest: SpaStrongestPair | None = Field(description="the most correlated pair of differentials")
