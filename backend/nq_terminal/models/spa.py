"""Response model for SV8, the family test over the registered NQ hypotheses (ANALYTICS_CATALOG SV8; TASKS Phase 12).

Same conventions as `models/analytics_p1.py`: the view names its basis and unit, carries "[POST HOC]" (the terminal
computes it; no frozen pass bar uses it), and an undefined value is null. The p-values here are over a family fixed
by a written rule on the registry, never over a slice picked on screen (C7 allows them and the view says so).
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Basis, Num, Tag
from nq_terminal.models.common import ResponseModel
from nq_terminal.models.neff import SpaEffectiveMembers


class SpaPValues(ResponseModel):
    lower: float = Field(description="recentred only where a model is at or above the benchmark")
    consistent: float = Field(description="recentred only within Hansen's ln ln t bound (the SPA p-value)")
    upper: float = Field(description="every model recentred: White's Reality Check")


class SpaCritical(ResponseModel):
    lower: Num
    consistent: Num
    upper: Num


class SpaMember(ResponseModel):
    name: str
    sessions: int = Field(description="rows of the hypothesis's own series before alignment")
    left_out: int = Field(description="own sessions outside the family's common index")
    left_out_with_pnl: int = Field(description="of those, sessions with non-zero P&L")
    mean_return: Num = Field(description="mean r_i on the common index, USD per session, one NQ contract")
    mean_differential: Num = Field(description="mean d_i = L_bh - L_i = r_i - r_bh, USD per session")
    long_run_variance: Num = Field(description="the stationary-bootstrap kernel variance of d_i")
    block: Num = Field(description="Politis-White stationary block length of d_i")
    in_consistent_set: bool = Field(description="within the ln ln t bound, so it counts for the consistent p-value")
    rejected: bool = Field(description="StepM rejects 'no better than the benchmark' at the family's size")
    step: int | None = Field(description="the StepM step that rejected it (1 is the first), null if not rejected")


class SpaExcluded(ResponseModel):
    name: str
    reason: str


class SpaView(ResponseModel):
    """SV8: White's Reality Check, Hansen's SPA and Romano-Wolf StepM over the registered NQ one-contract hypotheses."""

    tag: Tag
    label: str
    family_note: str = Field(description="the family is fixed by a rule on the registry, not picked on screen")
    construction: str
    basis: Basis
    cost: int
    unit: str
    benchmark_id: Literal["cash", "nq_buy_and_hold"] = Field(
        description="the null this view tests: cash (r_0 = 0, so d_i = r_i, 'some member has a positive mean') or "
                    "NQ buy and hold on one contract ('some member beats holding NQ')")
    benchmark: str
    loss: str
    statistic: str
    n_sessions: int
    first: str
    last: str
    bench_missing: int = Field(description="shared sessions left out because the benchmark has no close change")
    block: float
    block_rule: str
    reps: int
    seed: int
    size: float
    pvalues: SpaPValues
    reality_check: float = Field(description="White's Reality Check p-value (the upper SPA p-value)")
    critical_values: SpaCritical = Field(description="percentile 100 (1 - size) of the maximum replicated mean")
    stepm_steps: int
    superior: list[str] = Field(description="the members StepM rejects, in registry order")
    members: list[SpaMember]
    correlation: list[list[Num]] = Field(
        description="Pearson correlation of the members' loss differentials d_i on the common index, k by k in the "
                    "order of `members`; null where a member does not vary")
    correlation_note: str
    effective_members: SpaEffectiveMembers = Field(
        description="SV8 step 8: the effective number of members read from `correlation` (participation ratio, Li and "
                    "Ji, clusters at 1 - rho 0.5, the most correlated pair); it does not adjust any p-value")
    excluded: list[SpaExcluded]
    note: str
    buy_and_hold: SpaView | None = Field(
        description="the same family against NQ buy and hold on one contract, a different and much harder null "
                    "(a second, separately labelled row); null inside that row itself")
