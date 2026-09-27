// Inputs for a run's trades, costs and exposure panels (ANALYTICS_CATALOG TA1, TA3, TA6, EX1 to EX4;
// ARCHITECTURE section 4, /api/analytics/run/{id}/trades|costs|exposure). Pure functions; every figure
// is the API value at the printed precision, money in USD with thousands separators.
import type { Schemas } from '../../api/types'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { TEAR_BOOKS as B } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { StackSpec } from './tearCharts'
import { MISSING, formatNumber, formatShare } from './tearFormat'

export type RunTrades = Schemas['RunTrades']
export type RunCosts = Schemas['RunCosts']
export type RunExposure = Schemas['RunExposure']
export type Grouping = 'hour' | 'weekday' | 'month'

export interface BookRow {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** Trade panels appear only for a run with closed trades (TASKS 6.4). */
export function hasTrades(trades: RunTrades | undefined): boolean {
  return trades !== undefined && trades.stats.n > 0
}

const usd = (v: number | null | undefined, signed = false) => {
  const text = formatNumber(v, 2, { signed, thousands: true })
  return text === MISSING ? text : `${text} USD`
}

export function tradeStatRows(trades: RunTrades): BookRow[] {
  const s = trades.stats
  const stored = trades.summary
  const R = B.tradeRows
  return [
    { id: 'n', label: R.n, value: formatNumber(s.n, 0, { thousands: true }) },
    { id: 'wins', label: R.wins, value: formatNumber(s.wins, 0, { thousands: true }) },
    { id: 'losses', label: R.losses, value: formatNumber(s.losses, 0, { thousands: true }) },
    { id: 'winRate', label: R.winRate, value: formatShare(s.win_rate) },
    { id: 'hitStored', label: R.hitStored, value: formatShare(stored.hit_rate) },
    { id: 'profitFactor', label: R.profitFactor, value: formatNumber(s.profit_factor, 2) },
    { id: 'expectancy', label: R.expectancy, value: usd(s.expectancy, true) },
    { id: 'avgWin', label: R.avgWin, value: usd(s.avg_win, true) },
    { id: 'avgLoss', label: R.avgLoss, value: usd(s.avg_loss, true) },
    { id: 'payoff', label: R.payoff, value: formatNumber(s.payoff, 2) },
    { id: 'maxWin', label: R.maxWin, value: usd(s.max_win, true) },
    { id: 'maxLoss', label: R.maxLoss, value: usd(s.max_loss, true) },
    { id: 'totalPnl', label: R.totalPnl, value: usd(s.total_pnl, true) },
    { id: 'meanNetR', label: R.meanNetR, value: formatNumber(stored.mean_net_r, 2, { signed: true }) },
    { id: 'tNetR', label: R.tNetR, value: formatNumber(stored.t_net_r, 2) },
  ]
}

function groupsOf(trades: RunTrades, grouping: Grouping): Schemas['EntryGroups'] | null {
  if (grouping === 'hour') return trades.by_hour
  return grouping === 'weekday' ? trades.by_weekday : trades.by_month
}

/** TA3 mean P&L per trade by group with the API's t intervals; null when the run has no such view. */
export function groupLadder(trades: RunTrades, grouping: Grouping, run: string): BarLadderInput | null {
  const groups = groupsOf(trades, grouping)
  if (!groups) return null
  return {
    name: fillCopy(B.groupName, { run, group: B.groups[grouping].toLowerCase() }),
    unit: 'USD',
    decimals: 2,
    ci: groups.ci,
    bars: groups.rows.map((r) => ({ label: r.label, value: r.mean, lo: r.ci_lo, hi: r.ci_hi, n: r.n })),
  }
}

export interface SlippageRowView {
  readonly name: string
  readonly n: string
  readonly mean: string
  readonly p5: string
  readonly p50: string
  readonly p95: string
  readonly source: string
}

type SlippageGroup = RunTrades['slippage']['groups'][number]

function slippageRow(g: SlippageGroup): SlippageRowView {
  const signed = (v: number | null) => formatNumber(v, 2, { signed: true })
  return {
    name: g.name,
    n: formatNumber(g.n, 0, { thousands: true }),
    mean: signed(g.mean),
    p5: signed(g.p5),
    p50: signed(g.p50),
    p95: signed(g.p95),
    source: g.source,
  }
}

export function slippageRows(trades: RunTrades): SlippageRowView[] {
  return trades.slippage.groups.map(slippageRow)
}

/** The quote check's own file: its groups are a za_orb sample (results/quote_check_v1.json). */
const QUOTE_SOURCE = 'results/quote_check_v1.json'
/** The strategies each real-fill sample belongs to (TA6, ARCHITECTURE s4). */
const QUOTE_STRATEGY = 'za_orb'
const LIVE_STRATEGY = 'volmanaged'

export interface SlippageView {
  readonly kind: 'quote' | 'live' | 'none'
  readonly caption: string
  readonly rows: readonly SlippageRowView[]
}

/**
 * TA6: the real-fill rows that belong to this run's strategy, and a caption that names the sample. The
 * quote check's rows show on za_orb runs, the paper book's close rows on volmanaged runs; any other
 * strategy shows none (a sample under the wrong strategy's name would read as that strategy's cost).
 */
export function slippageView(trades: RunTrades, strategy: string | null): SlippageView {
  const s = trades.slippage
  const isQuote = (g: SlippageGroup) => g.source.startsWith(QUOTE_SOURCE)
  if (strategy === QUOTE_STRATEGY) {
    return { kind: 'quote', caption: fillCopy(B.slippageQuote, { unit: s.unit }), rows: s.groups.filter(isQuote).map(slippageRow) }
  }
  if (strategy === LIVE_STRATEGY) {
    return {
      kind: 'live',
      caption: fillCopy(B.slippageLive, { unit: s.unit, journal: s.live_journal }),
      rows: s.groups.filter((g) => !isQuote(g)).map(slippageRow),
    }
  }
  return { kind: 'none', caption: fillCopy(B.slippageNone, { strategy: strategy ?? B.strategyUnknown }), rows: [] }
}

export interface WaterfallRowView {
  readonly step: string
  readonly value: string
  readonly total: boolean
}

/** EX3 as the API lists it; the last step is the net, equal to the run's pnl_total. */
export function waterfallRows(costs: RunCosts): WaterfallRowView[] {
  const rows = costs.waterfall.rows
  return rows.map((r, i) => ({ step: r.step, value: formatNumber(r.value, 2, { thousands: true }), total: i === rows.length - 1 }))
}

/** EX4 net P&L against slippage ticks per side, with the break-even marked where it lies on the ladder. */
export function sensitivityLadder(costs: RunCosts, run: string): BarLadderInput {
  const s = costs.sensitivity
  const bars = s.ticks.map((tick, i) => ({ label: fillCopy(B.tickLabel, { n: tick }), value: s.net_usd[i] ?? null }))
  const first = s.ticks[0] ?? 0
  const last = s.ticks[s.ticks.length - 1] ?? 0
  const be = s.break_even_ticks_per_side
  const input: BarLadderInput = { name: fillCopy(B.sensitivityName, { run }), unit: 'USD', decimals: 2, bars }
  if (be === null || be < first || be > last) return input
  return { ...input, marker: { at: be - first, label: fillCopy(B.breakEven, { ticks: formatNumber(be, 2) }) } }
}

/** EX1 gross and net exposure over EX2 turnover, per session, on the API's `t` (epoch seconds at 00:00 UTC
 * of each session, the equity charts' axis); null when the run has no snapshots. */
export function exposureStack(exposure: RunExposure, run: string): StackSpec | null {
  const e = exposure.exposure
  if (!exposure.available || !e) return null
  const panes: StackSpec['panes'][number][] = [
    {
      id: 'exposure', weight: 2, decimals: 2, zero: 'grey',
      series: [
        { name: B.gross, style: 'primary', values: e.gross },
        { name: B.net, style: 'benchmark', values: e.net },
      ],
    },
  ]
  const turnover = exposure.turnover
  if (turnover) panes.push({ id: 'turnover', weight: 1, decimals: 2, series: [{ name: B.turnover, style: 'rollVol', values: turnover.daily }] })
  // A backend started before the merge sends no `t`: the same axis from the dates.
  const t = (e as Partial<typeof e>).t ?? e.date.map((d) => Date.parse(`${d}T00:00:00Z`) / 1000)
  return { title: fillCopy(B.exposureName, { run }), t, panes }
}
