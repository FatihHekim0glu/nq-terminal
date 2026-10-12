"""Response models for the SV9 power table (`GET /api/analytics/power`) and the pre-registration planner
(`GET /api/analytics/plan`), ANALYTICS_CATALOG SV9 and research_ux.md item 2.

The table was computed in the browser under the C8 client-phase exception and is served now (`analytics/power.py`);
the planner is new. Same conventions as `models/analytics_p1.py`: a figure that does not exist is null, every field is
required in the response, and the wording is SV9's: best case, normal and independent returns, one-sided, never a
verdict and never an override of a frozen pass bar.
"""
from __future__ import annotations

from enum import IntEnum
from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Basis, Num, Tag
from nq_terminal.models.common import ResponseModel

SlotSource = Literal["registry", "typed"]


class PeriodsPerYear(IntEnum):
    """The observations a year the planner takes: sessions, weeks, months or quarters. Never 365."""

    SESSIONS = 252
    WEEKS = 52
    MONTHS = 12
    QUARTERS = 4


class PowerRow(ResponseModel):
    name: str
    kind: str
    periods: int = Field(description="observations a year (252 sessions, 12 months), as the Deflated Sharpe view serves it")
    n: int
    years: Num = Field(description="n / periods")
    sharpe: Num = Field(description="the served annual Sharpe ratio")
    mde_nominal: Num = Field(description="minimum detectable annual Sharpe at the family alpha, power 0.8")
    mde_family: Num = Field(description="the same at alpha / k (Bonferroni)")
    ratio: Num = Field(description="the served Sharpe over mde_family")
    power_nominal: Num = Field(description="power at the reference Sharpe 0.5, at the family alpha")
    power_family: Num = Field(description="power at the reference Sharpe 0.5, at alpha / k")


class PowerTable(ResponseModel):
    """SV9: the power of the registered tests, one row per trial of the Deflated Sharpe view, in its order."""

    tag: Tag
    basis: Basis
    alpha: float = Field(description="the family alpha")
    k: int = Field(description="the registry's k: the registered hypotheses with a p value")
    alpha_family: Num = Field(description="alpha / k, null when k is not positive")
    power_target: float
    reference_sharpe: float = Field(description="a fixed reference, never the trial's own Sharpe")
    note: str
    rows: list[PowerRow]


class PlanBar(ResponseModel):
    alpha: float = Field(description="the one-sided significance bar")
    z: float = Field(description="its critical value, z(1 - alpha)")


class PlanPoint(ResponseModel):
    """The design at one alpha: the minimum detectable Sharpe, the power at the reference and the typed Sharpe, the
    observations each needs for the target power, and the detectable mean per event."""

    alpha: float
    z: float
    mde_sharpe: float = Field(description="minimum detectable annual Sharpe at this alpha, power 0.8")
    power_at_reference: float = Field(description="power at the reference Sharpe 0.5")
    power_at_typed: Num = Field(description="power at the typed Sharpe, null when none was typed")
    observations_for_reference: int | None = Field(description="observations that give power 0.8 at the reference Sharpe")
    observations_for_typed: int | None = Field(description="observations that give power 0.8 at the typed Sharpe; null "
                                                          "when none was typed or it is zero")
    mean_per_event: Num = Field(description="detectable mean per event, in the units of the event standard deviation; "
                                            "null when none was given")


class PlanSlot(ResponseModel):
    """The next slot of a family of k tests: slot k + 1."""

    source: SlotSource = Field(description="registry: the registry's family size; typed: the size the researcher typed")
    k: int = Field(description="tests already in the family")
    slot: int = Field(description="k + 1: the slot the planned test takes")
    bonferroni: PlanBar = Field(description="alpha / slot")
    holm_strictest: PlanBar = Field(description="Holm's bar when the planned test has the smallest p value: alpha / slot")
    holm_loosest: PlanBar = Field(description="Holm's bar when it has the largest and every other hypothesis was "
                                              "rejected first: alpha")
    at_slot: PlanPoint = Field(description="the design at the Bonferroni bar of the slot")


class PlanView(ResponseModel):
    """The pre-registration plan of a design: reads no data. Best case, normal and independent returns (SV9)."""

    basis: Basis
    note: str
    power_target: float
    reference_sharpe: float
    periods: int
    n: int
    years: float
    alpha: float
    typed_sharpe: Num
    event_sd: Num
    family_k_registry: int | None = Field(description="the registry's family size, null when it could not be read")
    registry_note: str | None = Field(description="why the registry's family size is missing, otherwise null")
    nominal: PlanPoint = Field(description="the design at the single-test alpha")
    slots: list[PlanSlot]
