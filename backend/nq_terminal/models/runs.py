"""Response models for the Nautilus runs endpoints (ARCHITECTURE section 4, Runs; TASKS 2.1).

Values come from `backtests/output/<run_id>/result.json` after the Phase 1 sanitiser: NaN and Inf are None,
nanosecond ints are ISO strings with an `*_epoch_s` sibling, Decimal strings are kept with a `*_float`
sibling. Raw carriers (trade and fill rows, config, data, venue) allow extra keys, because optional keys
vary with the age of the run (ARCHITECTURE section 3.7).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import ConfigDict

from nq_terminal.models.common import ResponseModel

RunKind = Literal["intraday", "sized", "book"]
EquitySource = Literal["mtm_snapshots", "realised_trades"]
AnchorVerdict = Literal["IDENTICAL", "DIFFERENT", "NOT COMPARABLE"]
BaseSource = Literal["regress_check", "sibling_regress_check", "name"]


class LedgerRef(ResponseModel):
    exp_id: str
    ts_utc: str


class RunSummary(ResponseModel):
    """One row of `RUNS`. `readable` is False (and `error` set) when result.json could not be decoded."""

    run_id: str
    readable: bool = True
    error: str | None = None
    strategy: str | None = None
    params: dict[str, Any] = {}
    variant: str | None = None
    start: str | None = None
    end: str | None = None
    created_utc: str | None = None
    elapsed_s: float | None = None
    nautilus_trader: str | None = None
    kind: RunKind | None = None
    n_trades: int | None = None
    pnl_total: float | None = None
    fees_total: float | None = None
    hit_rate: float | None = None
    mean_net_r: float | None = None
    t_net_r: float | None = None
    t_pnl_usd: float | None = None
    balance_ok: bool | None = None
    mtm_ok: bool | None = None
    coverage_ok: bool | None = None
    usable: bool = False
    is_probe: bool = False
    is_anchor: bool = False
    anchor_of: str | None = None
    ledger: LedgerRef | None = None
    sidecars: list[str] = []


class LedgerCommand(ResponseModel):
    """The copy-only `ledger_append` command for an eligible run; the terminal never runs it."""

    eligible: bool
    reasons: list[str]
    command: str | None
    cwd: str
    exp_id: str | None
    exp_id_source: Literal["ledger", "placeholder"] | None


class AnchorComparison(ResponseModel):
    """An anchor run against its base: exact equality on trades, P&L, fees and Sharpe (rule 3).

    NOT COMPARABLE when the base is missing, either run is unusable (no Sharpe, rule 4) or a count is absent:
    a value missing on both sides is never a match."""

    anchor: str
    base: str | None
    base_source: BaseSource | None
    base_found: bool
    n_trades_equal: bool
    pnl_total_equal: bool
    fees_total_equal: bool
    sharpe_anchor: float | None
    sharpe_base: float | None
    sharpe_equal: bool
    verdict: AnchorVerdict
    regress_check_identical: bool | None


class RunCounts(ResponseModel):
    trades: int
    fills: int


class RunDetail(ResponseModel):
    """Everything in result.json except the large arrays (trades, fills, strategy_log lists)."""

    summary: RunSummary
    config: dict[str, Any]
    data: dict[str, Any]
    venue: dict[str, Any]
    summary_stats: dict[str, Any]
    balance_check: dict[str, Any]
    coverage_check: dict[str, Any] | None
    strategy_skipped: list[Any] | None
    counts: RunCounts
    log_sections: dict[str, int]
    log_meta: dict[str, Any]
    anchor: AnchorComparison | None
    ledger_command: LedgerCommand
    run_log_file: bool


class TradeRow(ResponseModel):
    model_config = ConfigDict(extra="allow")

    date: str | None = None
    direction: int | None = None
    entry_ts: str | None = None
    entry_ts_epoch_s: int | None = None
    entry_px: float | None = None
    exit_ts: str | None = None
    exit_ts_epoch_s: int | None = None
    exit_px: float | None = None
    reason: str | None = None
    pnl_pts: float | None = None
    pnl_usd: float | None = None
    commissions_usd: float | None = None
    net_r: float | None = None


class FillRow(ResponseModel):
    model_config = ConfigDict(extra="allow")

    ts: str | None = None
    ts_epoch_s: int | None = None
    instrument: str | None = None
    side: str | None = None
    qty: float | None = None
    px: float | None = None
    commission: str | None = None
    commission_float: float | None = None
    position_id: str | None = None
    order_id: str | None = None
    tags: str | None = None


class EquitySeries(ResponseModel):
    """Basis B equity (ANALYTICS_CATALOG C1): MTM snapshots, or realised P&L on every session of the run.

    `t` is integer epoch seconds (snapshot time, or the NYSE close of the session); `pnl` is equity minus the
    starting balance. An unusable run (balance check failed, rule 4) has empty arrays, so it cannot be drawn.
    `unit` is the account currency of `equity`, `pnl`, `balance` and `unrealized`: USD for every run.
    """

    run_id: str
    source: EquitySource
    basis: Literal["B"] = "B"
    unit: Literal["USD"] = "USD"
    label: str
    usable: bool
    unusable_reason: str | None
    starting_usd: float | None
    final_usd: float | None
    n_sessions: int
    sessions_match: bool | None
    t: list[int]
    date: list[str]
    equity: list[float]
    pnl: list[float]
    balance: list[float] | None = None
    unrealized: list[float] | None = None
    net_qty: list[int | list[int] | dict[str, int]] | None = None  # a mapping by contract in multi-contract books


class CompareSeries(ResponseModel):
    run_id: str
    is_probe: bool
    usable: bool
    source: EquitySource
    rebased: list[float | None]


class CompareStats(ResponseModel):
    """Headline numbers for a compare view, descriptive, on Basis B. Sharpe and max drawdown come from the tear
    sheet's own series (one row per gated session, `analytics.series.run_returns`), so the RUNS table and the
    tear sheet show one value; `stats_note` says why they are null (an unusable run, an account whose equity
    reached zero, gated sessions that cannot be known)."""

    run_id: str
    basis: Literal["B"] = "B"
    n_trades: int | None
    pnl_total: float | None
    fees_total: float | None
    total_return: float | None
    sharpe: float | None
    max_drawdown: float | None
    stats_note: str | None


class RunComparison(ResponseModel):
    """Equity of several runs on one date axis, each divided by its starting balance K (C1), with 1.0 on the day
    before its first session; None where a run has no point. The last point is 1 + total_return."""

    t: list[int]
    date: list[str]
    series: list[CompareSeries]
    stats: list[CompareStats]


class LedgerRow(ResponseModel):
    """One `results/ledger.csv` row, typed, joined to its run folder (read only; rule 2)."""

    run_id: str
    ts_utc: str | None
    exp_id: str | None
    strategy: str | None
    params: dict[str, Any] | None
    params_json: str | None
    variant: str | None
    start: str | None
    end: str | None
    n_trades: int | None
    pnl_total: float | None
    fees_total: float | None
    mean_net_r: float | None
    t_net_r: float | None
    hit_rate: float | None
    balance_check: str | None
    runtime_s: float | None
    result_created_utc: str | None
    run_found: bool
    matches_result: bool | None


class LedgerView(ResponseModel):
    ledger_found: bool
    rows: list[LedgerRow]
    anchor_pairs: list[AnchorComparison]
