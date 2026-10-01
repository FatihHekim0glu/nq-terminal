// The P2 panel models (TASKS Phase 12): RG2 trend regime, EX5 capacity and MV6 term structure. Pure functions from
// the API responses to the text and chart inputs the panels show. Nothing is recomputed: every number is the API's,
// formatted at a fixed precision; the one derivation is the carry as percent a year, and every session dated on or
// after 2022-01-01 is cut first (the API serves none; this is the panel's own fence, UI_SPEC 6). The two charts are
// LineStack stacks: RG2 draws NQ against its mean with the regime as the strip under the time axis (the ribbon of
// the market context), MV6 draws the carry over the spread.
import type { LineStackPane, RibbonSpec, RibbonState } from '../../charts/LineStack.types'
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import { formatNumber, formatShare, formatValue } from '../tear/tearFormat'
import type { GateInfo, RunCapacity, TermStructure, TrendName, TrendRegimeView } from './types'

export const FENCE_DATE = '2022-01-01'
export const FENCE_T = Date.UTC(2022, 0, 1) / 1000
const PERCENT = 100
const MEAN_DECIMALS = 4
const RATIO_DECIMALS = 2
const T_DECIMALS = 2
const PARTICIPATION_DECIMALS = 4
const CARRY_DECIMALS = 2
const PRICE_DECIMALS = 4
const CHART_PRICE_DECIMALS = 1
const CHART_CARRY_DECIMALS = 2
const CHART_SPREAD_DECIMALS = 2
const FACTOR_DECIMALS = 2
const MISSING = RCT.missing

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function gateLine(gate: GateInfo | null): string | null {
  if (!gate) return null
  return fillCopy(RCT.gate, {
    caller: gate.caller,
    years: gate.served_years.length ? `${gate.served_years[0]} to ${gate.served_years.at(-1)}` : MISSING,
    cached: gate.cached ? RCT.gateCached : RCT.gateFresh,
  })
}

// ---------------------------------------------------------------- RG2

export interface TrendRowView {
  readonly regime: string
  readonly name: string
  readonly n: string
  readonly mean: string
  readonly sharpe: string
  readonly hit: string
}

export function trendRows(view: TrendRegimeView): TrendRowView[] {
  return view.rows.map((r) => ({
    regime: r.regime,
    name: RCT.trend.names[r.regime] ?? r.regime,
    n: formatNumber(r.n, 0, { thousands: true }),
    mean: formatValue(r.mean, view.unit, MEAN_DECIMALS, true),
    sharpe: formatNumber(r.sharpe, RATIO_DECIMALS),
    hit: formatShare(r.hit_rate),
  }))
}

export function welchLine(view: TrendRegimeView): string {
  if (!finite(view.welch_t)) return RCT.trend.welchNone
  return fillCopy(RCT.trend.welch, { t: formatNumber(view.welch_t, T_DECIMALS), df: formatNumber(view.welch_df, 1) })
}

export function unlabelledLine(view: TrendRegimeView): string {
  return fillCopy(RCT.trend.unlabelled, { window: view.window, n: formatNumber(view.unlabelled, 0, { thousands: true }) })
}

/** RG2's two states on LineStack's three-state strip: below the mean is the low end, above it the high end. */
const TREND_STATE: Readonly<Record<TrendName, RibbonState>> = { below: 'low', above: 'high' }
const TREND_STATES: RibbonSpec['states'] = {
  low: { label: RCT.trend.names.below ?? '', glyph: RCT.trend.chart.glyphs.below },
  mid: { label: RCT.trend.chart.unused, glyph: RCT.trend.chart.glyphs.unused },
  high: { label: RCT.trend.names.above ?? '', glyph: RCT.trend.chart.glyphs.above },
}

function trendState(regime: TrendName | null | undefined): RibbonState | null {
  return regime === 'above' || regime === 'below' ? TREND_STATE[regime] : null
}

function trendRibbonOf(values: ReadonlyArray<RibbonState | null>): RibbonSpec {
  return { name: RCT.trend.chart.ribbonName, values, states: TREND_STATES, missing: RCT.trend.chart.noRegime }
}

export interface TrendStack {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
  readonly ribbon: RibbonSpec
}

/** Sessions before the fence that the view's arrays all reach (the arrays are aligned; a short one gaps, never shifts). */
function beforeFence(t: readonly number[]): number {
  const cut = t.findIndex((x) => x >= FENCE_T)
  return cut < 0 ? t.length : cut
}

/**
 * RG2 as a LineStack stack: NQ's back-adjusted close at the session before each date and its 200-session mean in one
 * pane, the regime as the strip under the time axis. Null for a view that is not available or has no session before
 * the fence. Nothing is computed: the lines are the served arrays and the strip their served labels.
 */
export function trendStack(view: TrendRegimeView): TrendStack | null {
  if (!view.available) return null
  const n = beforeFence(view.t)
  if (n === 0) return null
  const take = <T>(values: readonly T[]): T[] => values.slice(0, n)
  const series = (name: string, style: 'primary' | 'benchmark', values: ReadonlyArray<number | null>) => ({ name, style, values: take(values) })
  return {
    title: RCT.trend.chart.title,
    t: take(view.t),
    panes: [{
      id: 'trend',
      decimals: CHART_PRICE_DECIMALS,
      summaryAll: true,
      series: [series(RCT.trend.chart.closeName, 'primary', view.close), series(RCT.trend.chart.meanName, 'benchmark', view.mean_close)],
    }],
    ribbon: trendRibbonOf(take(view.regime).map(trendState)),
  }
}

/**
 * RG2's regime as a strip over another series' own sessions (the market context of EQ and DD), aligned by exact time:
 * a session the view does not hold, or holds without a regime, draws nothing. Null for a view that is not available
 * or labels no session.
 */
export function trendRibbon(view: TrendRegimeView, t: readonly number[]): RibbonSpec | null {
  if (!view.available) return null
  const byTime = new Map<number, RibbonState>()
  view.t.forEach((time, i) => {
    const state = trendState(view.regime[i])
    if (state !== null) byTime.set(time, state)
  })
  return byTime.size === 0 ? null : trendRibbonOf(t.map((time) => byTime.get(time) ?? null))
}

/** How many sessions of another series carry the trend label, in words; or the reason none does. */
export function trendStripLine(view: TrendRegimeView, t: readonly number[]): string {
  const ribbon = trendRibbon(view, t)
  if (ribbon === null) return fillCopy(RCT.trend.chart.stripNone, { note: view.note || RCT.trend.chart.noReason })
  return fillCopy(RCT.trend.chart.stripNote, {
    labelled: formatNumber(ribbon.values.filter((v) => v !== null).length, 0, { thousands: true }),
    n: formatNumber(t.length, 0, { thousands: true }),
    label: view.label,
    tag: view.tag,
  })
}

// ---------------------------------------------------------------- EX5

/** A share of the session's volume as a percentage (4 decimals: a participation is often a hundredth of 1%). */
export function formatParticipation(ratio: number | null | undefined): string {
  if (!finite(ratio)) return MISSING
  return `${formatNumber(ratio * PERCENT, PARTICIPATION_DECIMALS)}%`
}

export interface InstrumentRowView {
  readonly instrument: string
  readonly symbol: string
  readonly factor: string
  readonly note: string
}

export function instrumentRows(cap: RunCapacity): InstrumentRowView[] {
  return cap.instruments.map((i) => ({
    instrument: i.instrument,
    symbol: i.symbol ?? RCT.capacity.outside,
    factor: formatNumber(i.factor, FACTOR_DECIMALS),
    note: i.note ?? '',
  }))
}

export interface CapacityRowView {
  readonly symbol: string
  readonly sessions: string
  readonly void: string
  readonly contracts: string
  readonly mean: string
  readonly median: string
  readonly p95: string
  readonly max: string
  readonly maxDate: string
  readonly volume: string
}

export function capacityRows(cap: RunCapacity): CapacityRowView[] {
  return cap.rows.map((r) => ({
    symbol: r.symbol,
    sessions: formatNumber(r.sessions, 0, { thousands: true }),
    void: formatNumber(r.void, 0, { thousands: true }),
    contracts: formatNumber(r.contracts_mean, 2, { thousands: true }),
    mean: formatParticipation(r.ratio_mean),
    median: formatParticipation(r.ratio_median),
    p95: formatParticipation(r.ratio_p95),
    max: formatParticipation(r.ratio_max),
    maxDate: r.ratio_max_date ?? MISSING,
    volume: formatNumber(r.volume_median, 0, { thousands: true }),
  }))
}

export interface WorstRowView {
  readonly date: string
  readonly symbol: string
  readonly contracts: string
  readonly volume: string
  readonly ratio: string
}

export function worstRows(cap: RunCapacity): WorstRowView[] {
  return cap.worst.map((w) => ({
    date: w.date,
    symbol: w.symbol,
    contracts: formatNumber(w.contracts, 2, { thousands: true }),
    volume: formatNumber(w.volume, 0, { thousands: true }),
    ratio: formatParticipation(w.ratio),
  }))
}

export function maxLine(cap: RunCapacity): string {
  if (!finite(cap.max_ratio) || !cap.max_symbol) return RCT.capacity.none
  return fillCopy(RCT.capacity.max, { ratio: formatParticipation(cap.max_ratio), symbol: cap.max_symbol })
}

// ---------------------------------------------------------------- MV6

/** A carry (a fraction a year) as signed percent a year. */
export function formatCarry(value: number | null | undefined): string {
  if (!finite(value)) return MISSING
  return `${formatNumber(value * PERCENT, CARRY_DECIMALS, { signed: true })}%`
}

export interface TermStack {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
}

/** A served number, or null (a gap in the line) when it is not a finite number. */
function gap(value: number | null | undefined): number | null {
  return finite(value) ? value : null
}

/**
 * MV6 as a LineStack stack on one time axis: the carry in percent a year over the front less next spread in the
 * market's units. Sessions on or after the fence are cut first; null when none is left.
 */
export function termStack(term: TermStructure): TermStack | null {
  const n = beforeFence(term.t)
  if (n === 0) return null
  const spread = fillCopy(RCT.term.chart.spreadName, { units: term.units })
  return {
    title: fillCopy(RCT.term.chart.title, { root: term.root }),
    t: term.t.slice(0, n),
    panes: [
      {
        id: 'carry', weight: 2, unit: '%', signed: true, zero: 'white', decimals: CHART_CARRY_DECIMALS,
        series: [{ name: RCT.term.chart.carryName, style: 'primary', values: term.carry.slice(0, n).map((c) => (finite(c) ? c * PERCENT : null)) }],
      },
      {
        id: 'spread', weight: 1, signed: true, zero: 'white', decimals: CHART_SPREAD_DECIMALS,
        series: [{ name: spread, style: 'rollShort', values: term.spread.slice(0, n).map(gap) }],
      },
    ],
  }
}

export function termSummaryLine(term: TermStructure): string {
  const s = term.summary
  if (s.n === 0) return RCT.term.summaryNone
  return fillCopy(RCT.term.summary, {
    n: s.n,
    mean: formatCarry(s.mean),
    median: formatCarry(s.median),
    min: formatCarry(s.min),
    max: formatCarry(s.max),
    share: formatShare(s.share_backwardation),
    last: formatCarry(s.last),
    lastDate: s.last_date ?? MISSING,
  })
}

export function voidLine(term: TermStructure): string {
  const v = term.void
  return fillCopy(RCT.term.void, {
    missingFront: v.missing_front,
    missingNext: v.missing_next,
    unresolved: v.unresolved,
    order: v.order,
    thin: v.thin,
    price: v.price,
  })
}

export interface CurveRowView {
  readonly rank: string
  readonly contract: string
  readonly expiry: string
  readonly days: string
  readonly close: string
  readonly volume: string
  readonly thin: string
}

export function curveRows(term: TermStructure): CurveRowView[] {
  return term.curve.points.map((p) => ({
    rank: String(p.rank),
    contract: p.contract,
    expiry: p.expiry,
    days: String(p.days_to_expiry),
    close: formatNumber(p.close, PRICE_DECIMALS, { thousands: true }),
    volume: formatNumber(p.volume, 0, { thousands: true }),
    thin: p.thin ? RCT.term.thinYes : RCT.term.thinNo,
  }))
}
