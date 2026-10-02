"""Response model of LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13): the paper book against its backtest
expectation, served. [POST HOC], descriptive: where the paths sit among resampled history, never a verdict.

Two cones, each with its own placement of the paper and model paths: `backtest` (SV6 of the hypothesis that owns the
paper journal, at its default cost) and `live` (LV6b: SV6's resampling of the paper book's own daily P&L from its
start). A refusal is a code with the values its words need; the browser words it (web/src/copy/expectation.ts).
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Num, Tag
from nq_terminal.models.analytics_p1 import ConeView
from nq_terminal.models.common import ResponseModel

Band = Literal["below5", "p5to25", "p25to50", "p50to75", "p75to95", "above95"]
RefusalCode = Literal["empty", "no_book", "no_cost", "no_run", "no_capital", "unit", "no_bootstrap", "live_short",
                      "live_flat"]


class ExpectationRefusal(ResponseModel):
    """Why a path is not placed, as a code and the values its words name (journal, hypothesis, run, unit, n)."""

    code: RefusalCode
    params: dict[str, str]


class PathPlacement(ResponseModel):
    """One cumulative path on one cone (the browser's `pathOnCone`)."""

    first_index: int | None = Field(description="row of the first finite value; step 1 of the cone is this row")
    fraction: list[Num] = Field(description="one per cone step: cumulative USD / K, null where the row has no value")
    bands: list[Band | None] = Field(description="one per cone step: the band of the fraction, null when unplaced")
    beyond: int = Field(ge=0, description="rows with a value past the cone's horizon: counted, never placed")


class ConePlacement(ResponseModel):
    """The paper and model paths on one cone, with the anchor session and the latest step that has a value."""

    horizon: int = Field(ge=0)
    first_index: int = Field(ge=0, description="the paper path's first row, else the model's, else 0")
    anchor_date: str | None
    paper: PathPlacement
    model: PathPlacement
    latest_step: int = Field(ge=0, description="1-based; 0 when neither path has a value on the cone")
    latest_date: str | None
    beyond: int = Field(ge=0, description="the larger beyond count of the two paths")


class ExpectationCone(ResponseModel):
    """One cone the paths can be placed on: the backtest start (SV6) or the live start (LV6b)."""

    start: Literal["backtest", "live"]
    refusal: ExpectationRefusal | None
    cone: ConeView | None
    source: str = Field(description="the series the cone resamples, in words")
    source_n: int | None = Field(description="sessions resampled")
    source_start: str | None
    source_end: str | None
    block: Num = Field(description="the Politis-White stationary block length on the resampled series")
    reps: int
    seed: int
    placement: ConePlacement | None


class PaperExpectation(ResponseModel):
    """LV6 and LV6b: the paper book's paths as a fraction of K on the backtest-start and the live-start cones."""

    journal: str
    tag: Tag
    label: str
    basis: str
    hypothesis: str | None
    cost: int | None = Field(description="ticks per side the backtest cone is read at")
    run_id: str | None = Field(description="the linked Nautilus reproduction whose served capital is K")
    capital: Num = Field(description="K in USD")
    refusal: ExpectationRefusal | None = Field(description="a refusal that needs no cone; both cones are then null")
    backtest: ExpectationCone | None
    live: ExpectationCone | None
