"""Response models for the research endpoints (ARCHITECTURE s4 Research).

Verdicts, n, p and the stored adjusted p values come from `results/registry.csv` (authoritative); the
terminal adds no pass or fail of its own. `spec_sha_ok` is the registry's stored flag; `spec_rehash_ok` is
the live re-hash of the spec file against both the registry and the screen (RI1).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel

VerdictBadge = Literal["PASS", "FAIL", "CHECK"]
RegistryTag = Literal["edge", "overlay", "check"]


class RegistryRow(ResponseModel):
    """One row of results/registry.csv. The tag and amendment columns are read when the file carries them; a
    registry written before them reads as no overlay and no amendments."""

    name: str
    registered: bool
    n: int | None
    p: float | None
    control_p: float | None
    verdict: str
    family_k: int | None
    bonferroni_p: float | None
    holm_p: float | None
    bh_q: float | None
    spec: str
    spec_sha256: str
    spec_sha_ok: bool
    overlay: bool = Field(False, description="a registered risk overlay: in the family, but a PASS is not an edge")
    tag: RegistryTag = Field("edge", description="overlay, else check when not registered, else edge")
    amendments: int = Field(0, ge=0, description="accepted amendment files of the spec, as the registry counts them")
    amendment_files: list[str] = Field(default_factory=list)
    amendments_ok: bool | None = Field(None, description="every amendment binds to its spec and result (registry); "
                                                         "null when the file has no such column")


class RegistryCounts(ResponseModel):
    """Counted from the file at request time (PRD DL12); never a constant."""

    rows: int = Field(ge=0)
    registered: int = Field(ge=0)
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    checks: int = Field(ge=0)
    edges: int = Field(ge=0, description="rows tagged edge")
    overlays: int = Field(ge=0, description="rows tagged overlay")
    passed_edges: int = Field(ge=0, description="edge rows whose verdict is PASS (an overlay PASS is not counted)")


class AcceptedAmendment(ResponseModel):
    """One amendment listed as accepted, re-hashed now against the hash it was accepted at."""

    file: str = Field(description="path under the data root, as the acceptance file writes it")
    spec: str | None = Field(description="the spec it amends (the file name before `_amend`), when it has one")
    sha256_accepted: str
    sha256_now: str | None = Field(description="null when the file is missing or not under experiments/")
    unchanged: bool
    rows: list[str] = Field(description="registry rows that list this file among their amendments")


class AmendmentAcceptances(ResponseModel):
    """`results/amendment_acceptances.md`: the record of accepted amendments (the amendment and result files
    still say pending; this file is the acceptance)."""

    found: bool
    source: str
    accepted_utc: str | None
    all_unchanged: bool
    amendments: list[AcceptedAmendment]


class RegistryView(ResponseModel):
    counts: RegistryCounts
    rows: list[RegistryRow]
    acceptances: AmendmentAcceptances


class PassCheck(ResponseModel):
    """One entry of a screen's `pass_checks`: `passed` for a boolean, else the recorded value."""

    name: str
    passed: bool | None
    value: Any = None


class SpecCheck(ResponseModel):
    name: str
    spec: str
    screen: str | None
    registry_sha256: str
    screen_sha256: str | None
    rehash_sha256: str | None
    ok: bool
    problem: str | None


class HypothesisCard(ResponseModel):
    name: str
    registered: bool
    verdict: str
    verdict_badge: VerdictBadge
    verdict_note: str | None
    n: int | None
    p: float | None
    control_p: float | None
    bonferroni_p: float | None
    holm_p: float | None
    bh_q: float | None
    spec: str
    spec_sha256: str
    spec_sha_ok: bool
    spec_rehash_ok: bool
    tag: RegistryTag
    amendment_files: list[str]
    amendments_ok: bool | None
    screen: str | None
    round: int | None
    pass_checks: list[PassCheck]
    headline_label: str | None = Field(description="dotted path of the headline value in the screen JSON")
    headline_value: float | None
    headline_display: str | None = Field(description="what the headline value is, for a KPI tile")
    headline_unit: str | None
    headline_basis: Literal["A"] = Field("A", description="Basis A: a screen value, never an account value")
    t_stat: float | None
    t_label: str | None
    series_kind: str | None
    series_costs: list[int]
    nautilus_runs: list[str]
    confirmations: list[str] = Field(description="sealed-window confirmations of this hypothesis")
    sealed: list[str] = Field(description="sealed files (by name, as /api/sealed/{name}) that belong to it")


class BlockValue(ResponseModel):
    label: str
    value: float | None


class LadderPoint(ResponseModel):
    ticks_per_side: int
    value: float | None


class DesExtract(ResponseModel):
    """Blocks (RL5) and cost ladder (EX4) read from the screen JSON at fixed paths; never recomputed."""

    basis: Literal["A"] = "A"
    blocks: list[BlockValue]
    blocks_unit: str | None
    cost_ladder: list[LadderPoint]
    cost_ladder_unit: str | None
    break_even_ticks_per_side: float | None


class HypothesisDetail(ResponseModel):
    card: HypothesisCard
    des: DesExtract
    screen: dict[str, Any] | None
    spec: dict[str, Any] | None
    auxiliaries: dict[str, Any]
    history: list[str]
    summary_name: str | None
    summary_md: str | None


class HypothesisSeries(ResponseModel):
    """Basis A (ANALYTICS_CATALOG C1): the recorded values in `unit`, and their arithmetic running sum."""

    name: str
    basis: Literal["A"] = "A"
    cost: int
    unit: str
    kind: str
    source: str
    t: list[int]
    r: list[float]
    equity: list[float]
    r_bench: list[float | None] | None = None
    bench_label: str | None = None


class MultipleTestingRow(ResponseModel):
    name: str
    tag: RegistryTag
    rank: int
    p: float
    bonferroni_p: float | None
    holm_p: float | None
    bh_q: float | None
    computed_bonferroni: float
    computed_holm: float
    computed_bh: float
    bonferroni_line: float
    holm_line: float
    bh_line: float


class Confirmation(ResponseModel):
    """A sealed-window confirmatory test: its own alpha, outside the exploratory family."""

    name: str
    n: int | None
    p: float | None
    alpha: float | None
    verdict: str
    spec: str
    spec_sha256: str | None
    spec_sha_ok: bool
    opening_closed: bool
    label: str
    parent: str | None = Field(description="the in-sample hypothesis this confirmation tested")
    pass_bar: Any = Field(None, description="the confirmation spec's own pass bar, verbatim (text or JSON)")
    hypothesis: Any = Field(None, description="the confirmation spec's hypothesis, verbatim")


class MultipleTesting(ResponseModel):
    alpha: float
    k: int
    rows: list[MultipleTestingRow]
    max_abs_diff: float
    matches_registry: bool
    confirmations: list[Confirmation]


class SealedItem(ResponseModel):
    name: str
    kind: Literal["json", "csv", "markdown"]
    label: str


class SealedView(ResponseModel):
    """One sealed file: JSON without price keys, CSV columns from the allowlist only, or the markdown."""

    name: str
    kind: Literal["json", "csv", "markdown"]
    label: str
    data: Any = None
    columns: list[str] | None = None
    values: dict[str, list[Any]] | None = None
    n_rows: int | None = None
    markdown: str | None = None
