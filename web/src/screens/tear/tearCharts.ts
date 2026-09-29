// Chart inputs for the five tear sheet tabs (look spec 7.5; ANALYTICS_CATALOG PF1, DD1, DD2, RL1,
// RL2, RD1, RD2, RK1, RK2, SV1, SV2). Pure functions over one Analytics response. Arrays go to the
// charts unchanged where no unit change is needed (a chart rebuilds when an array changes identity);
// a fraction series is scaled to percent. Nothing here computes a new statistic: the MRET average row
// is the heat map component's own (mretRows), as TASKS 6.4 directs.
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import type { DistributionInput } from '../../charts/echarts/distributionModel'
import { mretRows, type HeatmapInput } from '../../charts/echarts/heatmapModel'
import type { Callout } from '../../charts/LineStack.draw'
import type { LaneEpisode, LanesSpec, LineStackPane, RibbonSpec, RibbonState, StackSpan } from '../../charts/LineStack.types'
import { TEAR, TEAR_CONTEXT, TEAR_DD, TEAR_EQ, TEAR_MRET, TEAR_RET, TEAR_RR } from '../../copy/tear'
import { TEAR_P1 } from '../../copy/tearP1'
import { fillCopy } from '../../copy/workspace'
import type { Analytics } from './tearKpis'
import type { Extended } from './tearQueries'
import { decimalsForUnit, formatNumber, formatShare, formatValue, isPercentUnit, MISSING, scaleSeries, summaryDrawdown, toDisplay } from './tearFormat'

export interface StackSpec {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
  /** EQ and DD with the market context: the RK5 stress windows as bands. Absent without them. */
  readonly spans?: readonly StackSpan[]
  /** EQ and DD with the market context: the RG1 regime strip. Absent without it. */
  readonly ribbon?: RibbonSpec
}

const paneUnit = (unit: string): '' | '%' => (isPercentUnit(unit) ? '%' : '')

/** `Basis B: account (compounded from K). Unit: <section unit>.` */
export function basisLine(data: Analytics, unit: string): string {
  return fillCopy(TEAR.basisLine, { basis: data.basis, label: data.basis_label, unit })
}

function equityPane(data: Analytics, name: string, weight: number): LineStackPane {
  const { equity, drawdown } = data
  const series: LineStackPane['series'][number][] = [{ name: fillCopy(TEAR_EQ.strategy, { name }), style: 'primary', values: equity.equity }]
  if (equity.bench) series.push({ name: TEAR_EQ.benchmark, style: 'benchmark', values: equity.bench })
  const dd = summaryDrawdown(drawdown.max_drawdown, drawdown.unit, data.basis)
  return { id: 'equity', weight, series, decimals: decimalsForUnit(equity.unit), logAllowed: data.on_capital, ...(dd ? { summaryDrawdown: dd } : {}) }
}

/** EQ's lower pane (look spec 7.5): strategy minus benchmark as an area from 0, a white zero line. */
function perfDiffPane(data: Analytics): LineStackPane | null {
  const { perf_diff: diff, perf_diff_unit: unit } = data.equity
  if (!diff || !unit) return null
  return {
    id: 'perfDiff', weight: 1, zero: 'white', unit: paneUnit(unit), decimals: 2, signed: true,
    series: [{ name: TEAR_EQ.perfDiff, style: 'perfDiff', values: scaleSeries(diff, unit) }],
  }
}

export function eqStack(data: Analytics, name: string, ext: Extended | null = null): StackSpec {
  const diff = perfDiffPane(data)
  const panes = diff ? [equityPane(data, name, 2), diff] : [equityPane(data, name, 1)]
  const t = data.equity.t
  return { title: fillCopy(TEAR_EQ.title, { name }), t, panes, ...stackContext(ext, t) }
}

/**
 * DD: equity over the underwater curve, then (last, so it carries the time axis and the regime strip) the
 * lanes of the served DD2 rows. Without a drawable row there is no lanes pane and the stack is what it was.
 */
export function ddStack(data: Analytics, name: string, ext: Extended | null = null): StackSpec {
  const { drawdown } = data
  const series: LineStackPane['series'][number][] = [
    { name: TEAR_DD.underwater, style: 'underwater', values: scaleSeries(drawdown.dd, drawdown.unit) },
  ]
  if (drawdown.bench_dd) {
    series.push({ name: TEAR_DD.benchUnderwater, style: 'benchmark', values: scaleSeries(drawdown.bench_dd, drawdown.unit) })
  }
  const under: LineStackPane = { id: 'underwater', weight: 1.3, zero: 'white', unit: paneUnit(drawdown.unit), decimals: 2, series }
  const lanes = drawdownLanes(data)
  const panes = [equityPane(data, name, 2), under, ...(lanes ? [lanesPane(lanes)] : [])]
  return { title: fillCopy(TEAR_DD.title, { name }), t: drawdown.t, panes, ...stackContext(ext, drawdown.t) }
}

// ---------------------------------------------------------------------------------------------
// Drawdown episode lanes (roadmap 10, phase 1). The served DD2 rows drawn as they came: one lane per row,
// deepest first, from its peak to its trough and on to its recovery, or to the last session while open.
// Nothing here is derived from the rows (no longest, median or total): DD3 is not served, and the note
// under the table says so.

/** Number <GO> 11 to 20 pins the episode of rank 1 to 10; 1 to 5 are the tabs and 95 to 99 the function bar. */
const LANE_NUMBER_BASE = 10

/** The Number <GO> that pins the episode of this rank. */
export const laneNumber = (rank: number): number => LANE_NUMBER_BASE + rank

/** The lanes pane's share of the stack: 0.16 per row, never under 0.8 (equity is 2, underwater 1.3). */
export const laneWeight = (n: number): number => Math.max(0.8, 0.16 * n)

interface ReadLanes {
  readonly episodes: readonly LaneEpisode[]
  readonly dropped: number
}

/**
 * The lane of each served row that can be placed. Its rank is its place in the served table (so it matches
 * the table's # column even when an earlier row is left out). A null peak is the series' first session; an
 * unrecovered row runs to the last session of the underwater series. A row with a date that is not real, or
 * with no session to stand for its start or its end, is dropped and counted. The table's dates and the
 * chart's `t` come from one index (the API's axis: 00:00 UTC of each session date, month-end sessions
 * included), so a date maps to its `t` exactly and no lane shifts.
 */
function readLanes(data: Analytics): ReadLanes {
  const { t, unit } = data.drawdown
  const first = t[0]
  const last = t[t.length - 1]
  const episodes: LaneEpisode[] = []
  let dropped = 0
  data.drawdown_table.forEach((row, i) => {
    const peak = row.peak === null ? (first ?? Number.NaN) : epochOfDate(row.peak)
    const trough = epochOfDate(row.trough)
    const end = row.recovery === null ? (last ?? Number.NaN) : epochOfDate(row.recovery)
    if (![peak, trough, end].every(Number.isFinite)) {
      dropped += 1
      return
    }
    episodes.push({ rank: i + 1, peak, trough, end, open: row.open, depth: formatValue(row.depth, unit, 2) })
  })
  return { episodes, dropped }
}

/** The lanes of the served DD2 rows; null when there is no row to draw. */
export function drawdownLanes(data: Analytics): LanesSpec | null {
  const { episodes } = readLanes(data)
  return episodes.length === 0 ? null : { name: TEAR_DD.lanesName, episodes }
}

/** How many served rows are left out of the lanes for a date that is not real. */
export function lanesDropped(data: Analytics): number {
  return readLanes(data).dropped
}

function lanesPane(lanes: LanesSpec): LineStackPane {
  return { id: 'lanes', weight: laneWeight(lanes.episodes.length), series: [], lanes }
}

/** The lanes in words, under the table: what they are, what they are not, and any row left out. Empty with no rows. */
export function laneNotes(data: Analytics): string[] {
  const served = data.drawdown_table.length
  const dropped = lanesDropped(data)
  return [
    ...(served - dropped > 0 ? [fillCopy(served === 1 ? TEAR_DD.lanesNoteOne : TEAR_DD.lanesNote, { n: served })] : []),
    ...(dropped > 0 ? [fillCopy(dropped === 1 ? TEAR_DD.laneDroppedOne : TEAR_DD.laneDropped, { n: dropped })] : []),
  ]
}

// ---------------------------------------------------------------------------------------------
// Market context (roadmap 12, part B). The served RK5 windows and RG1 labels, drawn as they came:
// nothing here computes a statistic. Both are the terminal's [POST HOC] descriptions and each line of
// words below carries the tag the API sent.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The UTC epoch second of a session date (`YYYY-MM-DD`): the tear sheet's `t` are 00:00 UTC sessions.
 * NaN for anything that is not a real calendar date, which no chart draws.
 */
export function epochOfDate(date: string): number {
  const m = ISO_DATE.exec(date)
  if (m === null) return Number.NaN
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(Date.UTC(year, month - 1, day))
  // A date that rolls over (2011-02-30, month 13) is not a date.
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return Number.NaN
  return at.getTime() / 1000
}

/** The `YYYY-MM-DD` of an epoch second. */
function dateOfEpoch(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * The RK5 frozen windows as bands, in the order served: each runs from its peak to its recovery, or to its
 * trough while it has not recovered. A spent window (the 2022 row) carries [SPENT] on its chip. A row with
 * a date that is not real is left out, since no band can be placed for it.
 */
export function stressSpans(ext: Extended | null): StackSpan[] {
  if (ext === null) return []
  const spans: StackSpan[] = []
  for (const row of ext.stress.rows) {
    const from = epochOfDate(row.peak)
    const to = epochOfDate(row.recovery ?? row.trough)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const label = row.spent ? fillCopy(TEAR_CONTEXT.spentLabel, { label: row.label, tag: TEAR_P1.stress.spentTag }) : row.label
    spans.push({ from, to, label })
  }
  return spans
}

const RIBBON_STATES: RibbonSpec['states'] = {
  low: { label: TEAR_CONTEXT.states.low, glyph: TEAR_CONTEXT.glyphs.low },
  mid: { label: TEAR_CONTEXT.states.mid, glyph: TEAR_CONTEXT.glyphs.mid },
  high: { label: TEAR_CONTEXT.states.high, glyph: TEAR_CONTEXT.glyphs.high },
}

const isState = (value: unknown): value is RibbonState => value === 'low' || value === 'mid' || value === 'high'

/**
 * The RG1 regime of each session of `t`, aligned by exact time: a session the served block does not hold,
 * or holds without a label, is null and draws nothing. Null without the extended body or a served block.
 */
export function regimeRibbon(ext: Extended | null, t: readonly number[]): RibbonSpec | null {
  const served = ext?.regimes
  if (!served) return null
  const byTime = new Map<number, RibbonState>()
  served.t.forEach((time, i) => {
    const state: unknown = served.regime[i]
    if (isState(state)) byTime.set(time, state)
  })
  return { name: TEAR_CONTEXT.ribbonName, values: t.map((time) => byTime.get(time) ?? null), states: RIBBON_STATES, missing: TEAR_CONTEXT.unlabelled }
}

/**
 * The market context for a stack over `t`: spans when RK5 serves any window, a ribbon when RG1 is served.
 * Empty without the extended body, so a stack built without it is exactly what it was before.
 */
export function stackContext(ext: Extended | null, t: readonly number[]): Pick<StackSpec, 'spans' | 'ribbon'> {
  if (ext === null) return {}
  const spans = stressSpans(ext)
  const ribbon = regimeRibbon(ext, t)
  return { ...(spans.length > 0 ? { spans } : {}), ...(ribbon ? { ribbon } : {}) }
}

/** How many of the served windows touch the series (its first to its last session, ends included), in words. */
function spansLine(ext: Extended, t: readonly number[]): string {
  const n = ext.stress.rows.length
  const first = t[0]
  const last = t[t.length - 1]
  if (n === 0) {
    const range = first !== undefined && last !== undefined ? { first: dateOfEpoch(first), last: dateOfEpoch(last) } : { first: MISSING, last: MISSING }
    return fillCopy(TEAR_CONTEXT.spansNone, range)
  }
  const touching = (s: StackSpan) => first !== undefined && last !== undefined && s.to >= first && s.from <= last
  return fillCopy(TEAR_CONTEXT.spansNote, { inside: stressSpans(ext).filter(touching).length, n, frozen: ext.stress.frozen, tag: ext.stress.tag })
}

/** How many sessions carry a regime label, in words; or the reason RG1 is not served. */
function ribbonLine(ext: Extended, t: readonly number[]): string {
  const ribbon = regimeRibbon(ext, t)
  if (ribbon === null || !ext.regimes) return fillCopy(TEAR_CONTEXT.ribbonNone, { note: ext.regimes_note || TEAR_CONTEXT.noReason })
  return fillCopy(TEAR_CONTEXT.ribbonNote, {
    labelled: formatNumber(ribbon.values.filter((v) => v !== null).length, 0, { thousands: true }),
    n: formatNumber(t.length, 0, { thousands: true }),
    label: ext.regimes.label,
    tag: ext.regimes.tag,
  })
}

/**
 * The context layers in words, under the basis line: how many frozen windows touch the series and how many
 * sessions carry a regime label, each with the API's own frozen-list text, label and tag; or, where a layer
 * is not served, the reason. Empty without the extended body.
 */
export function contextLines(ext: Extended | null, t: readonly number[]): string[] {
  return ext === null ? [] : [spansLine(ext, t), ribbonLine(ext, t)]
}

type Band = Analytics['rolling']['sharpe_bands'][number]
type DrawnBand = Band & { readonly lo: number; readonly hi: number }

/** RL1 bands to draw: one per window that has a rolling value and a defined range, in window order. */
function drawnBands(data: Analytics): DrawnBand[] {
  const r = data.rolling
  const lines = [r.sharpe_short, r.sharpe_long]
  return r.sharpe_bands.filter((b, i): b is DrawnBand =>
    typeof b.lo === 'number' && typeof b.hi === 'number' && (lines[i] ?? []).some((v) => typeof v === 'number'))
}

function bandSeries(band: DrawnBand, unit: string, n: number): LineStackPane['series'][number][] {
  const words = { n: band.window, unit }
  return [
    { name: fillCopy(TEAR_P1.band.low, words), style: 'ciBound', values: Array<number>(n).fill(band.lo) },
    { name: fillCopy(TEAR_P1.band.high, words), style: 'ciBound', values: Array<number>(n).fill(band.hi) },
  ]
}

/** The RL1 bands in words under RR's chart; null when no band is drawn. */
export function rrBandNote(data: Analytics): string | null {
  const r = data.rolling
  const bands = drawnBands(data)
  if (bands.length === 0) return null
  const one = TEAR_RR.one[r.window_unit]
  const windows = bands.map((b) => fillCopy(TEAR_P1.band.window, { n: b.window, one, lo: formatNumber(b.lo, 2), hi: formatNumber(b.hi, 2) }))
  return fillCopy(TEAR_P1.band.note, { windows: windows.join(TEAR_P1.band.join), sharpe: formatNumber(r.full_sharpe, 2) })
}

export function rrStack(data: Analytics, name: string): StackSpec {
  const r = data.rolling
  const [short = 0, long = 0] = r.windows
  const unit = TEAR_RR.units[r.window_unit]
  const sharpe: LineStackPane = {
    id: 'sharpe', zero: 'grey', decimals: 2,
    series: [
      { name: fillCopy(TEAR_RR.sharpe, { n: short, unit }), style: 'rollShort', values: r.sharpe_short },
      { name: fillCopy(TEAR_RR.sharpe, { n: long, unit }), style: 'rollLong', values: r.sharpe_long },
      ...drawnBands(data).flatMap((b) => bandSeries(b, unit, r.t.length)),
    ],
  }
  const vol: LineStackPane = {
    id: 'vol', decimals: 2, unit: paneUnit(r.vol_unit), callouts: volCallouts(data),
    series: [
      { name: fillCopy(TEAR_RR.vol, { n: short, unit }), style: 'rollVol', values: scaleSeries(r.vol_short, r.vol_unit) },
      { name: fillCopy(TEAR_RR.vol, { n: long, unit }), style: 'rollLong', values: scaleSeries(r.vol_long, r.vol_unit) },
    ],
  }
  return { title: fillCopy(TEAR_RR.title, { name }), t: r.t, panes: [sharpe, vol] }
}

type Extremes = Analytics['rolling']['vol_extremes'][number]

/** GV-style callouts on the short-window volatility line: its highest and lowest value, in display units. */
export function volCallouts(data: Analytics): Callout[] {
  const e: Extremes | undefined = data.rolling.vol_extremes[0]
  if (!e) return []
  const out: Callout[] = []
  const hi = toDisplay(e.hi, e.unit)
  const lo = toDisplay(e.lo, e.unit)
  if (hi !== null && e.hi_t !== null) out.push({ t: e.hi_t, value: hi, label: fillCopy(TEAR_RR.hi, { value: formatNumber(hi, 2) }) })
  if (lo !== null && e.lo_t !== null) out.push({ t: e.lo_t, value: lo, label: fillCopy(TEAR_RR.lo, { value: formatNumber(lo, 2) }) })
  return out
}

/** Each window's volatility extremes in words (the callouts' text equivalent). */
export function rrExtremes(data: Analytics): string[] {
  const unit = TEAR_RR.units[data.rolling.window_unit]
  return data.rolling.vol_extremes.map((e) => {
    if (e.hi === null || e.lo === null) return fillCopy(TEAR_RR.extremesNone, { window: e.window, unit })
    return fillCopy(TEAR_RR.extremes, {
      window: e.window, unit,
      hi: formatValue(e.hi, e.unit, 2), hiDate: e.hi_date ?? '--',
      lo: formatValue(e.lo, e.unit, 2), loDate: e.lo_date ?? '--',
    })
  })
}

export interface RrEmpty {
  /** Panes with nothing to draw, each replaced by its note (empty when the chart has values). */
  readonly panes: ReadonlyArray<{ readonly id: 'sharpe' | 'vol'; readonly title: string; readonly text: string }>
  /** The long-window lines when only they are empty. */
  readonly longNote: string | null
}

const hasValue = (values: ReadonlyArray<number | null>) => values.some((v) => typeof v === 'number' && Number.isFinite(v))

/** What RR says instead of an empty scale: a series shorter than a rolling window has no rolling value. */
export function rrEmpty(data: Analytics): RrEmpty {
  const r = data.rolling
  const [short = 0, long = 0] = r.windows
  const unit = TEAR_RR.units[r.window_unit]
  const n = formatNumber(data.n, 0, { thousands: true })
  if (!hasValue(r.sharpe_short) && !hasValue(r.sharpe_long) && !hasValue(r.vol_short) && !hasValue(r.vol_long)) {
    const text = fillCopy(TEAR_RR.needs, { window: short, unit, n })
    return { panes: [{ id: 'sharpe', title: TEAR_RR.sharpePane, text }, { id: 'vol', title: TEAR_RR.volPane, text }], longNote: null }
  }
  const longEmpty = !hasValue(r.sharpe_long) && !hasValue(r.vol_long)
  const longNote = longEmpty ? fillCopy(TEAR_RR.longNeeds, { window: long, one: TEAR_RR.one[r.window_unit], unit, n }) : null
  return { panes: [], longNote }
}

export interface DrawdownRowView {
  readonly rank: number
  readonly peak: string
  readonly trough: string
  readonly recovery: string
  readonly depth: string
  readonly toTrough: string
  readonly toRecovery: string
  readonly length: string
}

export function drawdownRows(data: Analytics): DrawdownRowView[] {
  const unit = data.drawdown.unit
  return data.drawdown_table.map((row, i) => ({
    rank: i + 1,
    peak: row.peak ?? TEAR_DD.start,
    trough: row.trough,
    recovery: row.recovery ?? TEAR_DD.open,
    depth: formatValue(row.depth, unit, 2),
    toTrough: formatNumber(row.peak_to_trough, 0),
    toRecovery: formatNumber(row.trough_to_recovery, 0),
    length: formatNumber(row.length, 0),
  }))
}

export function mretHeatmap(data: Analytics, name: string): HeatmapInput {
  const m = data.monthly
  const grid = m.grid.map((row) => scaleSeries(row, m.unit))
  const { rows, values } = mretRows({ years: m.years, grid })
  const columns = m.months.map((month) => TEAR_MRET.months[month - 1] ?? String(month))
  return { kind: 'mret', name: fillCopy(TEAR_MRET.heatmapName, { name }), columns, rows, values, unit: paneUnit(m.unit), decimals: 2, derivedRows: 1 }
}

export function yearlyLadder(data: Analytics, name: string): BarLadderInput {
  const m = data.monthly
  return {
    name: fillCopy(TEAR_MRET.yearlyName, { name }),
    unit: paneUnit(m.unit),
    decimals: 2,
    bars: m.yearly.map((y) => ({ label: String(y.year), value: toDisplay(y.value, m.unit) })),
  }
}

/** The RET histogram input, or null when an edge or a moment is missing (nothing honest to draw). */
export function distributionInput(data: Analytics, name: string): DistributionInput | null {
  const h = data.distribution.histogram
  const scale = (v: number | null) => toDisplay(v, h.unit)
  const edges = h.edges.map(scale)
  const mean = scale(h.mean)
  const sd = scale(h.sd)
  if (edges.some((e) => e === null) || mean === null || sd === null) return null
  const risk = data.risk
  const riskValue = (v: number | null) => toDisplay(v, risk.unit)
  const s = data.distribution.series
  return {
    name: fillCopy(TEAR_RET.histogramName, { name }),
    unit: paneUnit(h.unit),
    decimals: 2,
    edges: edges as number[],
    counts: h.counts,
    normal: h.normal,
    mean,
    sd,
    risk: { var95: riskValue(risk.var_95), cvar95: riskValue(risk.cvar_95), var99: riskValue(risk.var_99), cvar99: riskValue(risk.cvar_99) },
    ...(s.t.length > 0 ? { series: { t: s.t, v: scaleSeries(s.r, s.unit) } } : {}),
  }
}

export interface StatRow {
  readonly id: string
  readonly label: string
  readonly value: string
}

export interface StatSection {
  readonly id: 'summary' | 'risk' | 'tails' | 'validity'
  readonly title: string
  readonly rows: readonly StatRow[]
}

const L = TEAR_RET.rows

function summaryRows(data: Analytics): StatRow[] {
  const s = data.distribution.stats
  const v = (x: number | null, signed = false) => formatValue(x, s.unit, 2, signed)
  return [
    { id: 'n', label: L.n, value: formatNumber(s.n, 0, { thousands: true }) },
    { id: 'years', label: L.years, value: formatNumber(s.years, 2) },
    { id: 'hitRate', label: L.hitRate, value: formatShare(s.hit_rate) },
    { id: 'bestDay', label: L.bestDay, value: v(s.best_day, true) },
    { id: 'worstDay', label: L.worstDay, value: v(s.worst_day, true) },
    { id: 'bestMonth', label: L.bestMonth, value: v(s.best_month, true) },
    { id: 'worstMonth', label: L.worstMonth, value: v(s.worst_month, true) },
    { id: 'pctPositiveMonths', label: L.pctPositiveMonths, value: formatShare(s.pct_positive_months) },
    { id: 'skew', label: L.skew, value: formatNumber(s.skew, 2) },
    { id: 'excessKurtosis', label: L.excessKurtosis, value: formatNumber(s.excess_kurtosis, 2) },
  ]
}

/** VaR and CVaR only (G16): positive values are losses, the horizon's own sign convention. The 21-session
 * tail rows are a different convention (negative = loss) and get their own section, tailsRows() below. */
function riskRows(data: Analytics): StatRow[] {
  const r = data.risk
  const v = (x: number | null) => formatValue(x, r.unit, 2)
  return [
    { id: 'var95', label: L.var95, value: v(r.var_95) },
    { id: 'cvar95', label: L.cvar95, value: v(r.cvar_95) },
    { id: 'var99', label: L.var99, value: v(r.var_99) },
    { id: 'cvar99', label: L.cvar99, value: v(r.cvar_99) },
  ]
}

type Tails21 = NonNullable<Analytics['risk']['tails21']>

/** The 21-session overlapping-sum tail rows (G16): shown only once there is at least one window, in
 * their own section (its title states the sign convention), never mixed into the 1-session risk rows. */
function tailsRows(data: Analytics, tails: Tails21): StatRow[] {
  const r = data.risk
  const v = (x: number | null) => formatValue(x, r.unit, 2)
  const window = tails.window
  return [
    { id: 'tails5', label: fillCopy(L.tails5, { window }), value: v(tails.shortfall_5pct) },
    { id: 'tails1', label: fillCopy(L.tails1, { window }), value: v(tails.shortfall_1pct) },
    { id: 'tailsN', label: fillCopy(L.tailsN, { window }), value: formatNumber(tails.n, 0, { thousands: true }) },
  ]
}

function tailsSection(data: Analytics): StatSection | null {
  const tails = data.risk.tails21
  if (!tails || tails.n === 0) return null
  return { id: 'tails', title: fillCopy(TEAR_RET.tailsTitle, { window: tails.window }), rows: tailsRows(data, tails) }
}

/** G16: with too few 21-session windows, the 5% and 1% tails fall on the same worst window (19 windows
 * round both quantiles to 1), so the two figures are not independent estimates; said once, not silently
 * shown as if they were. */
export function tailsNote(data: Analytics): string | null {
  const tails = data.risk.tails21
  if (!tails || tails.n === 0) return null
  if (tails.shortfall_1pct === null || tails.shortfall_5pct === null) return null
  if (tails.shortfall_1pct !== tails.shortfall_5pct) return null
  return fillCopy(TEAR_RET.tailsNote, { n: tails.n })
}

type TrackRecord = Analytics['validity']['min_trl']['at_zero']

function minTrlText(record: TrackRecord, unit: string): string {
  if (record.reason !== 'reachable' || record.sessions === null) return TEAR_RET.reasons[record.reason]
  return fillCopy(TEAR_RET.periods, { n: formatNumber(record.sessions, 0, { thousands: true }), unit })
}

function validityRows(data: Analytics): StatRow[] {
  const { psr, min_trl: trl } = data.validity
  const periods = data.rolling.window_unit
  const ci = data.ci
  const rows: StatRow[] = [
    { id: 'sharpe', label: L.sharpe, value: formatNumber(ci.sharpe, 2) },
    { id: 'ci', label: L.ci, value: fillCopy(TEAR_RET.ciValue, { lo: formatNumber(ci.lo, 2), hi: formatNumber(ci.hi, 2) }) },
    { id: 'psrZero', label: L.psrZero, value: formatNumber(psr.at_zero, 3) },
    { id: 'minTrlZero', label: L.minTrlZero, value: minTrlText(trl.at_zero, periods) },
    { id: 'actual', label: L.actual, value: fillCopy(TEAR_RET.periods, { n: formatNumber(trl.at_zero.actual_sessions, 0, { thousands: true }), unit: periods }) },
  ]
  // U24: the annualised benchmark Sharpe PSR (benchmark Sharpe) and MinTRL (benchmark Sharpe) test
  // against, so the threshold itself is on screen (HOME shows the same figure from bench_sharpe).
  if (psr.benchmark_sr_per_period !== null) {
    const annualised = psr.benchmark_sr_per_period * Math.sqrt(data.periods_per_year)
    rows.push({ id: 'benchSharpe', label: L.benchSharpe, value: formatNumber(annualised, 2) })
  }
  if (psr.at_benchmark !== null) rows.push({ id: 'psrBench', label: L.psrBench, value: formatNumber(psr.at_benchmark, 3) })
  if (trl.at_benchmark) rows.push({ id: 'minTrlBench', label: L.minTrlBench, value: minTrlText(trl.at_benchmark, periods) })
  return rows
}

/** The reason behind each MinTRL row that shows no length, once per reason, under the stats table. */
export function statsNotes(data: Analytics): string[] {
  const { min_trl: trl } = data.validity
  const records: Array<[string, TrackRecord | null]> = [[L.minTrlZero, trl.at_zero], [L.minTrlBench, trl.at_benchmark]]
  const byReason = new Map<Exclude<TrackRecord['reason'], 'reachable'>, string[]>()
  for (const [label, record] of records) {
    if (!record || record.reason === 'reachable') continue
    byReason.set(record.reason, [...(byReason.get(record.reason) ?? []), label])
  }
  return [...byReason].map(([reason, rows]) => fillCopy(TEAR_RET.reasonNotes[reason], { rows: rows.join(', ') }))
}

export function statsSections(data: Analytics): StatSection[] {
  const tails = tailsSection(data)
  return [
    { id: 'summary', title: TEAR_RET.summary, rows: summaryRows(data) },
    { id: 'risk', title: fillCopy(TEAR_RET.risk, { horizon: data.risk.horizon }), rows: riskRows(data) },
    ...(tails ? [tails] : []),
    { id: 'validity', title: TEAR_RET.validity, rows: validityRows(data) },
  ]
}
