"""Response models for the analytics endpoints (ARCHITECTURE s4 Analytics; TASKS 3.3; UI_SPEC s7 tear sheet).

Every response names its basis ("A" screen, "B" account; ANALYTICS_CATALOG C1) and its unit, and every KPI tile
carries its own basis and unit plus a tag (C7: "[PRE-REG]" for a value read from a registered result, "[POST HOC]" for a
value the terminal computes). A value that is not defined (a Sharpe without spread, CAGR without a capital K) is
null, never NaN. Time axes: `t` is epoch seconds at 00:00 UTC of the session date and `date` is the session date.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel

Basis = Literal["A", "B"]
Tag = Literal["[POST HOC]", "[PRE-REG]"]
Freq = Literal["D", "M"]
Num = float | None


class Context(ResponseModel):
    kind: Literal["hypothesis", "run"]
    name: str
    cost: int | None = Field(description="ticks per side (hypotheses only)")
    freq: Freq = Field(description="D: the series as built; M: runs only, sessions compounded into months")


class Kpi(ResponseModel):
    key: str
    label: str
    value: Num
    unit: str
    basis: Basis
    tag: Tag
    note: str | None = Field(description="why the value is null, or where a stored value was read")


class SharpeInterval(ResponseModel):
    """PF4: annualised Sharpe with the Mertens (2002) 95% interval."""

    basis: Basis
    unit: str
    sharpe: Num
    lo: Num
    hi: Num
    z: float
    periods_per_year: int


class EquityView(ResponseModel):
    """EQ: equity after each session, the benchmark on the same axis (null where it has no value)."""

    unit: str
    t: list[int]
    date: list[str]
    equity: list[Num]
    bench: list[Num] | None


class DrawdownView(ResponseModel):
    """DD1: underwater series of the strategy and the benchmark, and their deepest points."""

    unit: str
    t: list[int]
    date: list[str]
    dd: list[Num]
    bench_dd: list[Num] | None
    max_drawdown: Num
    bench_max_drawdown: Num


class DrawdownRow(ResponseModel):
    """DD2: one episode; `peak` is null when the peak is the starting value, `recovery` null while it is open."""

    peak: str | None
    trough: str
    recovery: str | None
    depth: float
    peak_to_trough: int
    trough_to_recovery: int | None
    length: int
    open: bool


class RollingView(ResponseModel):
    """RL1 and RL2 over a short and a long window (`windows`, in `window_unit`): 63 and 252 sessions for a daily
    series, 12 and 36 months for a monthly one (P = 12)."""

    sharpe_unit: str
    vol_unit: str
    windows: list[int]
    window_unit: Literal["sessions", "months"]
    t: list[int]
    date: list[str]
    sharpe_short: list[Num]
    sharpe_long: list[Num]
    vol_short: list[Num]
    vol_long: list[Num]
    full_sharpe: Num
    full_vol: Num


class YearValue(ResponseModel):
    year: int
    value: Num


class MonthlyView(ResponseModel):
    """RD2: one row per year, columns January to December (null where a month has no session)."""

    basis: Basis
    unit: str
    aggregation: str
    years: list[int]
    months: list[int]
    grid: list[list[Num]]
    yearly: list[YearValue]


class HistogramView(ResponseModel):
    """RD1: Freedman-Diaconis bins (Sturges when the interquartile range is 0; `bin_rule` names the rule), the
    fitted normal as expected counts, and the VaR lines."""

    unit: str
    bin_rule: str
    edges: list[Num]
    counts: list[int]
    centres: list[Num]
    normal: list[Num]
    mean: Num
    sd: Num
    var_95: Num
    var_99: Num


class QqView(ResponseModel):
    """RD3: `scipy.stats.probplot` against the normal: ordered returns against theoretical quantiles."""

    label: str
    theoretical: list[Num]
    ordered: list[Num]
    slope: Num
    intercept: Num
    r: Num


class StatsTable(ResponseModel):
    """PF10. Day values are null for a monthly book; month values are its rows."""

    unit: str
    n: int
    years: Num
    hit_rate: Num
    best_day: Num
    worst_day: Num
    skew: Num
    excess_kurtosis: Num
    best_month: Num
    worst_month: Num
    pct_positive_months: Num


class DistributionView(ResponseModel):
    histogram: HistogramView
    qq: QqView
    stats: StatsTable


class Tails(ResponseModel):
    """RK2: overlapping 21-session sums and their 1% and 5% mean shortfall."""

    window: int
    n: int
    shortfall_1pct: Num
    shortfall_5pct: Num


class RiskView(ResponseModel):
    """RK1 (1 period, positive numbers are losses) and RK2 (daily series only; null for a monthly book)."""

    basis: Basis
    unit: str
    horizon: str
    var_95: Num
    cvar_95: Num
    var_99: Num
    cvar_99: Num
    tails21: Tails | None


class AlphaFit(ResponseModel):
    """BR1 fit, `sizing_stats.spanning_alpha`: r = a + b * r_b + e; t by Newey-West lag; t_min gates."""

    n: int
    a: Num
    b: Num
    alpha_annual_pct: Num
    t: dict[str, Num]
    t_b: dict[str, Num]
    t_min: Num


class RelativeView(ResponseModel):
    """BR1 and BR2 against the spec benchmark (C6), computed by the terminal on the aligned rows."""

    tag: Tag
    basis: Basis
    unit: str
    bench_label: str
    n: int
    periods_per_year: int
    lags: list[int]
    information_ratio: Num
    tracking_error: Num
    alpha: AlphaFit
    blocks: dict[str, AlphaFit]


class StoredAlphaBlock(ResponseModel):
    block: str
    n: int | None
    a: Num
    alpha_annual_pct: Num
    t_min: Num


class StoredAlpha(ResponseModel):
    """BR1 read from the screen JSON at a fixed path (`services/stored_alpha.py`), never recomputed."""

    tag: Tag = "[PRE-REG]"
    basis: Basis = "A"
    path: str
    against: str
    a_unit: str
    n: int | None
    a: Num
    b: Num
    alpha_annual_pct: Num
    t: dict[str, Num]
    t_min: Num
    p: Num
    blocks: list[StoredAlphaBlock]
    raw: dict[str, Any]


class Moments(ResponseModel):
    """Per-period Sharpe (ddof 1), population skewness and raw kurtosis (normal 3), as fed to PSR and MinTRL."""

    n: int
    sr: Num
    skew: Num
    kurt: Num


class PsrView(ResponseModel):
    at_zero: Num
    at_benchmark: Num
    benchmark_sr_per_period: Num
    at_benchmark_note: str | None = Field(description="what PSR at the benchmark does and does not test")


class TrackRecord(ResponseModel):
    """SV2: null sessions and years when the threshold is not reachable (Sharpe at or below it) or the moments
    leave it undefined; `reason` says which."""

    sessions: Num
    years: Num
    reachable: bool
    reason: Literal["reachable", "below_threshold", "undefined"]
    actual_sessions: int
    actual_years: float
    sr_star_per_period: Num
    alpha: float


class MinTrlView(ResponseModel):
    at_zero: TrackRecord
    at_benchmark: TrackRecord | None


class RegistryEntry(ResponseModel):
    """SV4 for one hypothesis: the stored registry columns and the terminal's recomputation over the family."""

    tag: Tag
    name: str
    registered: bool
    p: Num
    family_k: int | None
    stored_bonferroni_p: Num
    stored_holm_p: Num
    stored_bh_q: Num
    computed_bonferroni_p: Num
    computed_holm_p: Num
    computed_bh_q: Num
    max_abs_diff: dict[str, Num]
    matches: bool


class ValidityView(ResponseModel):
    """SV1 and SV2 at SR* = 0 and at the benchmark Sharpe; SV4 from the registry; SV7 copied from the screen."""

    basis: Basis
    unit: str
    psr: PsrView
    min_trl: MinTrlView
    moments: Moments
    registry: RegistryEntry | None
    sharpe_difference_tests: dict[str, Any]


class SeriesInfo(ResponseModel):
    """What the numbers are computed on (shared by the tear sheet and the HOME panel)."""

    context: Context
    basis: Basis
    basis_label: str
    unit: str
    on_capital: bool
    capital: Num
    periods_per_year: int
    n: int
    kind: str
    source: str
    label: str
    tag: Tag
    first: str
    last: str
    dropped: list[str]
    bench_label: str | None


class Analytics(SeriesInfo):
    """The tear sheet (EQ, DD, RET, RR, MRET) for one run or hypothesis."""

    kpis: list[Kpi]
    ci: SharpeInterval
    equity: EquityView
    drawdown: DrawdownView
    drawdown_table: list[DrawdownRow]
    rolling: RollingView
    monthly: MonthlyView
    distribution: DistributionView
    risk: RiskView
    relative: RelativeView | None
    stored_alpha: StoredAlpha | None
    validity: ValidityView


class HomePanel(SeriesInfo):
    """HOME [B]: equity against the benchmark, with the underwater curve and the rolling Sharpe over the long
    window (252 sessions, or 36 months for a monthly series)."""

    equity_unit: str
    t: list[int]
    date: list[str]
    equity: list[Num]
    bench_equity: list[Num] | None
    underwater: list[Num]
    bench_underwater: list[Num] | None
    rolling_sharpe: list[Num]
    rolling_window: int
    rolling_unit: Literal["sessions", "months"]
    rolling_unit_label: str = Field(description="unit of the rolling Sharpe values (the tear sheet's ratio unit)")
    drawdown_unit: str = Field(description="unit of the underwater series (the tear sheet's drawdown unit)")
    sharpe: Num
    bench_sharpe: Num
    max_drawdown: Num
    bench_max_drawdown: Num
    alpha: list[Kpi] = Field(description="the tear sheet's two alpha tiles, alpha_annual then alpha_t, unchanged")
