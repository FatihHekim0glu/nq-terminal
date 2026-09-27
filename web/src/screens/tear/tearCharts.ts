// Chart inputs for the five tear sheet tabs (look spec 7.5; ANALYTICS_CATALOG PF1, DD1, DD2, RL1,
// RL2, RD1, RD2, RK1, RK2, SV1, SV2). Pure functions over one Analytics response. Arrays go to the
// charts unchanged where no unit change is needed (a chart rebuilds when an array changes identity);
// a fraction series is scaled to percent. Nothing here computes a new statistic: the MRET average row
// is the heat map component's own (mretRows), as TASKS 6.4 directs.
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import type { DistributionInput } from '../../charts/echarts/distributionModel'
import { mretRows, type HeatmapInput } from '../../charts/echarts/heatmapModel'
import type { Callout } from '../../charts/LineStack.draw'
import type { LineStackPane } from '../../charts/LineStack.types'
import { TEAR, TEAR_DD, TEAR_EQ, TEAR_MRET, TEAR_RET, TEAR_RR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { Analytics } from './tearKpis'
import { decimalsForUnit, formatNumber, formatShare, formatValue, isPercentUnit, scaleSeries, summaryDrawdown, toDisplay } from './tearFormat'

export interface StackSpec {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
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

export function eqStack(data: Analytics, name: string): StackSpec {
  const diff = perfDiffPane(data)
  const panes = diff ? [equityPane(data, name, 2), diff] : [equityPane(data, name, 1)]
  return { title: fillCopy(TEAR_EQ.title, { name }), t: data.equity.t, panes }
}

export function ddStack(data: Analytics, name: string): StackSpec {
  const { drawdown } = data
  const series: LineStackPane['series'][number][] = [
    { name: TEAR_DD.underwater, style: 'underwater', values: scaleSeries(drawdown.dd, drawdown.unit) },
  ]
  if (drawdown.bench_dd) {
    series.push({ name: TEAR_DD.benchUnderwater, style: 'benchmark', values: scaleSeries(drawdown.bench_dd, drawdown.unit) })
  }
  const under: LineStackPane = { id: 'underwater', weight: 1.3, zero: 'white', unit: paneUnit(drawdown.unit), decimals: 2, series }
  return { title: fillCopy(TEAR_DD.title, { name }), t: drawdown.t, panes: [equityPane(data, name, 2), under] }
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
  readonly id: 'summary' | 'risk' | 'validity'
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

function riskRows(data: Analytics): StatRow[] {
  const r = data.risk
  const v = (x: number | null) => formatValue(x, r.unit, 2)
  const rows: StatRow[] = [
    { id: 'var95', label: L.var95, value: v(r.var_95) },
    { id: 'cvar95', label: L.cvar95, value: v(r.cvar_95) },
    { id: 'var99', label: L.var99, value: v(r.var_99) },
    { id: 'cvar99', label: L.cvar99, value: v(r.cvar_99) },
  ]
  const tails = r.tails21
  if (!tails) return rows
  const window = tails.window
  return [
    ...rows,
    { id: 'tails5', label: fillCopy(L.tails5, { window }), value: v(tails.shortfall_5pct) },
    { id: 'tails1', label: fillCopy(L.tails1, { window }), value: v(tails.shortfall_1pct) },
    { id: 'tailsN', label: fillCopy(L.tailsN, { window }), value: formatNumber(tails.n, 0, { thousands: true }) },
  ]
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
  return [
    { id: 'summary', title: TEAR_RET.summary, rows: summaryRows(data) },
    { id: 'risk', title: fillCopy(TEAR_RET.risk, { horizon: data.risk.horizon }), rows: riskRows(data) },
    { id: 'validity', title: TEAR_RET.validity, rows: validityRows(data) },
  ]
}
