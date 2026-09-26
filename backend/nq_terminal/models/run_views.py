"""Response models for a run's trade, cost and exposure views (ANALYTICS_CATALOG TA1, TA3, TA6, EX1 to EX4).

Served by `/api/analytics/run/{run_id}/trades`, `/costs` and `/exposure` (ARCHITECTURE s4 Analytics), apart from the
tear sheet so it stays light. Every value is descriptive and computed by the terminal ("[POST HOC]"), except the
run summary's stored numbers, which are copied as they are. A value that is not defined is null, never NaN.
Money is USD; exposure and turnover are notional over equity (Basis B).
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from nq_terminal.models.common import ResponseModel

Num = float | None
Tag = Literal["[POST HOC]"]


class TradeStats(ResponseModel):
    """TA1 over per-trade net P&L (USD, after commissions), with the definitions of the Nautilus statistics."""

    n: int
    wins: int
    losses: int
    flat: int
    win_rate: Num
    avg_win: Num
    avg_loss: Num
    max_win: Num
    max_loss: Num
    expectancy: Num
    mean_pnl: Num
    total_pnl: Num
    profit_factor: Num
    payoff: Num


class StoredTradeSummary(ResponseModel):
    """The run summary's own numbers, as stored (mean net R and its t are never recomputed)."""

    n_trades: int | None
    hit_rate: Num
    mean_net_r: Num
    t_net_r: Num
    gross_mean_r: Num
    mean_pnl_usd: Num
    t_pnl_usd: Num


class EntryGroupRow(ResponseModel):
    key: int
    label: str
    n: int
    mean: Num
    sd: Num
    ci_lo: Num
    ci_hi: Num


class EntryGroups(ResponseModel):
    """TA3: mean net P&L per trade by entry hour (New York time), weekday or month, with its 95% t interval."""

    grouping: Literal["hour", "weekday", "month"]
    timezone: str
    unit: str
    tag: Tag
    ci: str
    rows: list[EntryGroupRow]


class SlippageGroup(ResponseModel):
    """One TA6 distribution: ticks of 0.25 points, positive = adverse; `matches_stored` against the quote check's
    own summary (null for the live rows, which have none)."""

    name: str
    source: str
    n: int
    mean: Num
    values: list[float]
    counts: list[int]
    p5: Num
    p50: Num
    p95: Num
    matches_stored: bool | None


class SlippageView(ResponseModel):
    """TA6: real fills only (a 96-trade quote check of za_v0 NQ trades, and the paper book's close rows); the
    run's own backtest fills are modelled and get no slippage distribution."""

    unit: str
    label: str
    groups: list[SlippageGroup]
    matches_stored: bool
    quote_check_found: bool
    live_journal: str
    live_journal_found: bool
    live_plumbing_rows_skipped: int = Field(description="plumbing rows dropped from the live rows (LV1)")
    plumbing_banner: str


class RunTrades(ResponseModel):
    """TA1, TA3 and TA6 for one run. `by_hour` is null for a book that enters at the session close by rule."""

    run_id: str
    kind: str
    tag: Tag
    unit: str
    stats: TradeStats
    summary: StoredTradeSummary
    hit_rate_matches: bool | None
    by_hour: EntryGroups | None
    hour_note: str | None
    by_weekday: EntryGroups
    by_month: EntryGroups
    slippage: SlippageView


class WaterfallStep(ResponseModel):
    step: str
    value: float


class InstrumentCost(ResponseModel):
    instrument: str
    sides: int
    commissions: float
    slippage: float


class CostWaterfall(ResponseModel):
    """EX3: gross, commissions, modelled slippage and net; net equals the run's `pnl_total` exactly."""

    run_id: str
    unit: str
    label: str
    ticks: int
    sides: int
    gross: float
    commissions: float
    slippage: float
    net: float
    costs_total: float
    rows: list[WaterfallStep]
    by_instrument: list[InstrumentCost]


class CostSensitivity(ResponseModel):
    """EX4: net P&L against ticks of slippage per contract side, fills held fixed (linear), with break-even."""

    run_id: str
    unit: str
    label: str
    run_ticks: int
    ticks: list[int]
    net_usd: list[float]
    net_pct_of_k: list[float]
    cost_per_tick_usd: float
    break_even_ticks_per_side: Num


class RunCosts(ResponseModel):
    run_id: str
    tag: Tag
    waterfall: CostWaterfall
    sensitivity: CostSensitivity


class ExposureView(ResponseModel):
    """EX1: gross and net notional over equity per session, per instrument held, priced at `price_basis` (the raw
    contract close; a back-adjusted snapshot price only where no raw close exists, and then labelled so)."""

    run_id: str
    basis: Literal["B"]
    unit: str
    label: str
    price_basis: str
    date: list[str]
    gross: list[Num]
    net: list[Num]
    by_instrument: dict[str, list[Num]]
    mean_gross: Num
    mean_net: Num
    positions_reconcile: bool


class TurnoverView(ResponseModel):
    """EX2: one-way turnover per session and its annualised mean (x 252)."""

    run_id: str
    basis: Literal["B"]
    unit: str
    label: str
    source: str
    price_basis: str
    periods: int
    date: list[str]
    daily: list[Num]
    mean_daily: Num
    annualised: Num


class RunExposure(ResponseModel):
    """EX1 and EX2 for one run; `available` is false (with `note`) for a run without snapshots."""

    run_id: str
    tag: Tag
    available: bool
    note: str | None
    exposure: ExposureView | None
    turnover: TurnoverView | None
