"""Response models for the P1 analytics (TASKS Phase 10; ANALYTICS_CATALOG sections 1 to 10 and 13, P1 rows).

Same conventions as `models/analytics.py`: every view names its basis and unit, computed values carry "[POST HOC]",
an undefined value is null (never NaN), and `t` is epoch seconds at 00:00 UTC of the session date. No view here shows
a p-value on a slice the user picked: the only p-values are RD4 (Jarque-Bera) and TA5 (runs test) on the whole series
or trade list, and RG1's fixed terciles report Welch's t without a p-value.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.analytics import Basis, Context, Kpi, Num, Tag
from nq_terminal.models.common import ResponseModel


class _Series(ResponseModel):
    context: Context
    basis: Basis
    unit: str
    periods_per_year: int
    n: int
    tag: Tag


# ---------------------------------------------------------------- RK3


class CornishFisherLevel(ResponseModel):
    level: Literal["95", "99"]
    tail: float
    z: float
    normal: Num = Field(description="Gaussian VaR -(mu + sigma z), a positive loss; shown greyed outside the domain")
    historical: Num = Field(description="RK1's historical VaR at the same tail, the comparator beside it")
    raw_expansion: Num = Field(description="the Cornish-Fisher value even outside its domain (for the record)")
    cornish_fisher: Num = Field(description="null outside the monotone domain")
    value: Num = Field(description="the tile: Cornish-Fisher inside the domain, else the historical VaR")
    in_domain: bool
    method: str


class CornishFisherVarView(ResponseModel):
    """RK3: normal and Cornish-Fisher VaR with PerformanceAnalytics' population moments."""

    basis: Basis
    unit: str
    horizon: str
    mean: Num
    sigma: Num
    skew: Num
    excess_kurtosis: Num
    domain: str = Field(description="the monotone domain the tile is greyed outside of, and the fallback")
    levels: list[CornishFisherLevel]


# ---------------------------------------------------------------- RL3, RL4, BR3, BR4, RD4


class RollingRelativeView(ResponseModel):
    """RL3 rolling beta and RL4 rolling correlation against the benchmark, on the strategy's sessions."""

    window: int
    window_unit: str
    t: list[int]
    date: list[str]
    beta: list[Num]
    correlation: list[Num]
    full_beta: Num
    full_correlation: Num


class CaptureView(ResponseModel):
    """BR3: ratios of geometric annualised returns over benchmark-up and benchmark-down sessions."""

    label: str
    up: Num
    down: Num
    up_n: int
    down_n: int


class ScatterView(ResponseModel):
    """BR4: strategy against benchmark on the aligned rows, with BR1's OLS line."""

    unit: str
    x_label: str
    y_label: str
    date: list[str]
    x: list[float]
    y: list[float]
    slope: Num
    intercept: Num
    n: int


class JarqueBeraView(ResponseModel):
    """RD4 on the whole series (never on a slice the user picks)."""

    statistic: Num
    p: Num
    n: int
    note: str


# ---------------------------------------------------------------- RK5 and RG1


class StressRow(ResponseModel):
    label: str
    peak: str
    trough: str
    recovery: str | None
    nq_depth: Num = Field(description="NQ buy and hold over the window, compounded (a negative fraction)")
    source: str
    spent: bool = Field(description="the 2022 row: from the sealed daily file only, labelled spent")
    n: int
    covered_from: str | None = Field(description="the first row the window holds (a monthly book: its first month-end)")
    covered_to: str | None = Field(description="the last row the window holds (a monthly book: its last month-end)")
    strategy_return: Num
    bench_return: Num
    bench_n: int
    strategy_max_drawdown: Num


class StressView(ResponseModel):
    """RK5: the frozen windows (constants.STRESS_WINDOWS) and, where one exists, the spent 2022 row."""

    tag: Tag
    basis: Basis
    unit: str
    frozen: str
    monthly_note: str | None = Field(description="set for a monthly book: its rows cover every month a window overlaps")
    rows: list[StressRow]
    spent_note: str | None


class RegimeRow(ResponseModel):
    regime: Literal["low", "mid", "high"]
    n: int
    mean: Num
    sharpe: Num
    hit_rate: Num


class RegimeView(ResponseModel):
    """RG1: fixed terciles of NQ's lagged realised variance (expanding, no look-ahead); Welch's t, no p-value."""

    tag: Tag
    label: str
    source: str
    min_history: int
    rows: list[RegimeRow]
    welch_t: Num
    welch_df: Num
    unlabelled: int
    t: list[int]
    date: list[str]
    regime: list[Literal["low", "mid", "high"] | None]


class ExtendedAnalytics(_Series):
    """The P1 additions to one tear sheet: PF7 to PF9 tiles, RK3, RL3, RL4, BR3, BR4, RD4, RK5 and RG1."""

    ratios: list[Kpi]
    cornish_fisher_var: CornishFisherVarView
    jarque_bera: JarqueBeraView
    rolling_relative: RollingRelativeView | None
    capture: CaptureView | None
    scatter: ScatterView | None
    relative_note: str | None
    stress: StressView
    regimes: RegimeView | None
    regimes_note: str | None


# ---------------------------------------------------------------- SV5 and SV6


class BlockLength(ResponseModel):
    stationary: Num
    circular: Num
    m: int | None


class BootstrapInterval(ResponseModel):
    statistic: Literal["sharpe", "cagr", "max_drawdown"]
    label: str
    unit: str
    point: Num
    lo: Num
    hi: Num
    median: Num
    mean: Num
    sd: Num
    undefined: int = Field(description="replications where the statistic is not defined (left out and counted)")
    ruin: int = Field(description="CAGR only: replications whose book touches zero at any point, kept at -1 "
                                  "(total loss)")
    note: str | None


class ConeView(ResponseModel):
    """SV6: pointwise percentiles of resampled paths at each step, not a band whole paths stay inside; realised overlaid."""

    label: str
    unit: str
    how: Literal["summed", "compounded"]
    horizon: int
    steps: list[int]
    percentiles: list[int]
    quantiles: dict[str, list[Num]]
    realised: list[Num]
    realised_dates: list[str]


class BootstrapView(_Series):
    """SV5 percentile intervals and the SV6 cone from one set of stationary bootstrap replications."""

    method: str
    block: BlockLength
    reps: int
    seed: int
    confidence: float
    intervals: list[BootstrapInterval]
    cone: ConeView


# ---------------------------------------------------------------- SV3


class DeflatedRow(ResponseModel):
    name: str
    kind: str
    periods: int
    n: int
    sr: Num = Field(description="Sharpe per period of the trial's own series")
    sr_session: Num = Field(description="per-session Sharpe on the common basis (SV3a step 4)")
    annual_sharpe: Num
    skew: Num
    kurt: Num = Field(description="raw kurtosis (normal 3)")
    sr0_own_period: Num
    dsr: Num = Field(description="PSR at SR0 from the empirical cross-trial variance V (the paper's construction)")
    sr0_null_own_period: Num = Field(description="SR0 from the null variance V0, in the trial's own period")
    dsr_null: Num = Field(description="PSR at the SR0 from V0, the variance the expected maximum assumes (no skill)")


class DeflatedLeaveOneOut(ResponseModel):
    """V without the one trial whose removal lowers it most, N kept at the full count (SV3a step 9)."""

    name: str | None
    variance: Num
    sr0_session: Num
    sr0_annual: Num
    n_trials: int


class DeflatedView(ResponseModel):
    """SV3 over the registered hypotheses on the common Basis A daily construction (SV3a)."""

    tag: Tag
    label: str
    construction: str
    basis: Basis
    cost: int
    monthly_note: str
    n_trials: int
    variance: Num
    sr0_session: Num
    sr0_annual: Num
    variance_null: Num = Field(description="V0: the mean sampling variance of the trials' per-session Sharpe estimates at SR = 0, 1/(n - 1) x P/252")
    sr0_null_session: Num
    sr0_null_annual: Num
    leave_one_out: DeflatedLeaveOneOut
    n_note: str = Field(description="what N assumes: independent registered rows, no pre-registration variants")
    euler_gamma: float
    dominant: str | None = Field(description="the trial farthest from the mean per-session Sharpe, named")
    rows: list[DeflatedRow]


# ---------------------------------------------------------------- TA2


class ExcursionRow(ResponseModel):
    entry_ts: str
    exit_ts: str
    direction: int
    mae_pts: float
    mfe_pts: float
    final_pts: float
    mae_r: Num
    mfe_r: Num
    final_r: Num
    mae_usd: float
    mfe_usd: float
    pnl_usd: Num
    win: bool
    whole_bars: int
    partial_bars: int
    no_bars: bool
    off_basis: bool = Field(description="a fill lies outside every bar it could have happened in, by more than a tick")


class RunExcursions(ResponseModel):
    """TA2 MAE and MFE of an intraday run over its own gated 1-minute bars."""

    run_id: str
    tag: Tag
    available: bool
    note: str | None
    label: str
    unit: str
    symbol: str | None
    variant: str | None
    point_value: Num
    tick: Num = Field(description="the contract's tick in points, the slack of the price basis check")
    n: int
    no_bars: int
    in_r: int
    basis_checked: int = Field(description="trades with at least one fill that has a bar to check it against")
    off_basis: int = Field(description="checked trades with a fill outside its bars (another price basis)")
    rows: list[ExcursionRow]


# ---------------------------------------------------------------- LV5


class PaperTracking(ResponseModel):
    """LV5: daily paper P&L against the rule's target on the same closes, performance rows only."""

    journal: str
    present: bool
    empty_state: str | None
    banner: str
    basis: str
    tag: Tag
    label: str
    unit: str
    multiplier: float
    plumbing_rows_skipped: int = Field(ge=0)
    t: list[int | None]
    date: list[str]
    paper: list[Num]
    model: list[Num]
    difference: list[Num]
    paper_cumulative: list[Num]
    model_cumulative: list[Num]
    n: int
    total_difference: float
    tracking_sd: Num
