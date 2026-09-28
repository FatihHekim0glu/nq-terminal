// The P1 views of the tear sheet as display rows and chart inputs (TASKS Phase 10 on screen; ANALYTICS_CATALOG
// SV5, SV6, PF7 to PF9, RK3, RD3, RD4, RK5, RL3, RL4, BR3, BR4, RG1). Pure functions over the API's
// ExtendedAnalytics, BootstrapView and Analytics bodies: values are the API's, a fraction shown times 100, and
// nothing new is computed. No p-value is ever shown on a slice the user picked: the only ones here are RD4's,
// on the whole series; RG1 reports Welch's t without one.
import type { Schemas } from '../../api/types'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { formatP } from '../../charts/echarts/format'
import type { XyScatterInput } from '../../charts/echarts/xyScatterModel'
import { TEAR } from '../../copy/tear'
import { TEAR_P1 } from '../../copy/tearP1'
import { fillCopy } from '../../copy/workspace'
import type { StackSpec } from './tearCharts'
import { formatNumber, formatShare, formatValue, isPercentUnit, shortUnit, toDisplay } from './tearFormat'
import type { TileSpec } from './tearKpis'
import type { Bootstrap, Extended } from './tearQueries'

type Analytics = Schemas['Analytics']
type CfView = Schemas['CornishFisherVarView']

export interface KeyValueRow {
  readonly id: string
  readonly label: string
  readonly value: string
}

const pct = (unit: string): '' | '%' => (isPercentUnit(unit) ? '%' : '')
const scaled = (values: ReadonlyArray<number | null>, unit: string) => values.map((v) => toDisplay(v, unit))
const PERCENT = 100

// ---------------------------------------------------------------- SV5 and SV6

export interface IntervalRow {
  readonly id: string
  readonly label: string
  readonly point: string
  readonly interval: string
  readonly median: string
  readonly sd: string
  /** Replications where the statistic is not defined (left out), said in a note when there are any. */
  readonly undefinedNote: string | null
  readonly note: string | null
}

export function intervalRows(boot: Bootstrap): IntervalRow[] {
  return boot.intervals.map((i) => {
    const v = (x: number | null, signed = true) => formatValue(x, i.unit, 2, signed)
    return {
      id: i.statistic,
      label: i.label,
      point: v(i.point),
      interval: fillCopy(TEAR_P1.bootstrap.intervalValue, { lo: v(i.lo), hi: v(i.hi) }),
      median: v(i.median),
      sd: v(i.sd, false),
      // The API's own note already states the count when it sends one; the web note is only the fallback.
      undefinedNote: i.undefined > 0 && !i.note
        ? fillCopy(TEAR_P1.bootstrap.undefinedNote, { label: i.label, n: formatNumber(i.undefined, 0, { thousands: true }) })
        : null,
      note: i.note,
    }
  })
}

export function bootstrapLine(boot: Bootstrap): string {
  return fillCopy(TEAR_P1.bootstrap.line, {
    method: boot.method,
    block: formatNumber(boot.block.stationary, 2),
    reps: formatNumber(boot.reps, 0, { thousands: true }),
    seed: String(boot.seed),
    confidence: `${formatNumber(boot.confidence * PERCENT, 0)}%`,
  })
}

const CONE_PERCENTILES = [5, 25, 50, 75, 95] as const

export function coneInput(boot: Bootstrap, name: string): ConeInput {
  const c = boot.cone
  return {
    name: fillCopy(TEAR_P1.cone.name, { name }),
    label: c.label,
    unit: pct(c.unit) || (shortUnit(c.unit) === 'USD' ? 'USD' : ''),
    decimals: 2,
    steps: c.steps,
    bands: CONE_PERCENTILES.map((p) => ({ p, values: scaled(c.quantiles[String(p)] ?? [], c.unit) })),
    realised: scaled(c.realised, c.unit),
    realisedDates: c.realised_dates,
  }
}

// ---------------------------------------------------------------- PF7 to PF9, RK3, RD3, RD4

export function ratioTiles(ext: Extended): TileSpec[] {
  return ext.ratios.map((kpi) => ({
    kpi: { ...kpi, value: toDisplay(kpi.value, kpi.unit), unit: shortUnit(kpi.unit) },
    decimals: 2,
    signed: false,
    description: fillCopy(TEAR.kpiDescription, { label: kpi.label, unit: kpi.unit, tag: kpi.tag }),
    ci: null,
  }))
}

export interface CfRow {
  readonly level: string
  readonly normal: string
  readonly historical: string
  readonly cornishFisher: string
  readonly raw: string
  readonly value: string
  /** Outside the monotone domain: Cornish-Fisher is not defined, the shown value is the historical VaR (RK1) and
   * the normal VaR is greyed. */
  readonly greyed: boolean
  readonly used: string
  readonly method: string
}

export function cfRows(cf: CfView): CfRow[] {
  const v = (x: number | null) => formatValue(x, cf.unit, 2)
  return cf.levels.map((l) => ({
    level: `${l.level}%`,
    normal: v(l.normal),
    historical: v(l.historical),
    cornishFisher: l.in_domain ? v(l.cornish_fisher) : TEAR_P1.cf.notDefined,
    raw: v(l.raw_expansion),
    value: v(l.value),
    greyed: !l.in_domain,
    used: l.in_domain ? TEAR_P1.cf.usedCf : TEAR_P1.cf.usedHistorical,
    method: l.method,
  }))
}

export function cfMoments(cf: CfView): string {
  return fillCopy(TEAR_P1.cf.moments, {
    mean: formatValue(cf.mean, cf.unit, 4, true),
    sigma: formatValue(cf.sigma, cf.unit, 4),
    skew: formatNumber(cf.skew, 2),
    kurt: formatNumber(cf.excess_kurtosis, 2),
  })
}

export function jarqueBeraRows(ext: Extended): KeyValueRow[] {
  const jb = ext.jarque_bera
  return [
    { id: 'statistic', label: TEAR_P1.jb.statistic, value: formatNumber(jb.statistic, 2, { thousands: true }) },
    { id: 'p', label: TEAR_P1.jb.p, value: typeof jb.p === 'number' && Number.isFinite(jb.p) ? formatP(jb.p) : '--' },
    { id: 'n', label: TEAR_P1.jb.n, value: formatNumber(jb.n, 0, { thousands: true }) },
  ]
}

/** RD3 from the P0 tear sheet's QQ data (distribution.qq_plot), in the histogram's display unit. */
export function qqInput(data: Analytics, name: string): XyScatterInput | null {
  const q = data.distribution.qq
  const unit = data.distribution.histogram.unit
  const factor = isPercentUnit(unit) ? PERCENT : 1
  const points = q.theoretical.flatMap((x, i) => {
    const y = q.ordered[i]
    return typeof x === 'number' && typeof y === 'number' ? [{ x, y: y * factor }] : []
  })
  if (points.length === 0) return null
  const line = typeof q.slope === 'number' && typeof q.intercept === 'number'
    ? { slope: q.slope * factor, intercept: q.intercept * factor, label: TEAR_P1.jb.qqLine, slopeUnit: factor === PERCENT ? TEAR_P1.jb.qqSlopePercent : TEAR_P1.jb.qqSlopeUnit }
    : null
  return {
    name: fillCopy(TEAR_P1.jb.qqName, { name }),
    x: { label: TEAR_P1.jb.qqX, decimals: 2 },
    y: { label: TEAR_P1.jb.qqY, unit: pct(unit), decimals: 2 },
    points,
    line,
  }
}

// ---------------------------------------------------------------- RK5

export interface StressRowView {
  readonly label: string
  readonly window: string
  readonly nq: string
  readonly strategy: string
  readonly bench: string
  readonly maxDd: string
  readonly n: string
  /** The first and last rows the window holds (a monthly book: month-ends), or -- when it holds none. */
  readonly covered: string
  readonly spent: boolean
}

export function stressRows(ext: Extended): StressRowView[] {
  const unit = ext.stress.unit
  return ext.stress.rows.map((r) => ({
    label: r.label,
    window: fillCopy(TEAR_P1.stress.window, { peak: r.peak, trough: r.trough }),
    nq: formatValue(r.nq_depth, 'fraction', 2, true),
    strategy: formatValue(r.strategy_return, unit, 2, true),
    bench: formatValue(r.bench_return, unit, 2, true),
    maxDd: formatValue(r.strategy_max_drawdown, unit, 2, true),
    n: formatNumber(r.n, 0, { thousands: true }),
    covered: r.covered_from && r.covered_to ? fillCopy(TEAR_P1.stress.window, { peak: r.covered_from, trough: r.covered_to }) : '--',
    spent: r.spent,
  }))
}

/** A monthly book's rows cover every month a window overlaps; the API says so, shown as a sentence. */
export function stressMonthlyNote(ext: Extended): string | null {
  const note = ext.stress.monthly_note
  return note ? note.replace(/\.?$/, '.') : null
}

// ---------------------------------------------------------------- RL3, RL4, BR3, BR4, RG1

export function relativeStack(ext: Extended, name: string): StackSpec | null {
  const r = ext.rolling_relative
  if (!r) return null
  const words = { window: r.window, unit: r.window_unit }
  return {
    title: fillCopy(TEAR_P1.relative.name, { name }),
    t: r.t,
    panes: [
      { id: 'beta', zero: 'grey', decimals: 2, series: [{ name: fillCopy(TEAR_P1.relative.beta, words), style: 'rollShort', values: r.beta }] },
      { id: 'correlation', zero: 'grey', decimals: 2, series: [{ name: fillCopy(TEAR_P1.relative.correlation, words), style: 'rollVol', values: r.correlation }] },
    ],
  }
}

/** Why the rolling panes are empty (a series shorter than the window), or null when they have values. */
export function relativeEmpty(ext: Extended): string | null {
  const r = ext.rolling_relative
  if (!r) return null
  const finite = (v: number | null) => typeof v === 'number' && Number.isFinite(v)
  if (r.beta.some(finite) || r.correlation.some(finite)) return null
  return fillCopy(TEAR_P1.relative.needs, { window: r.window, unit: r.window_unit, n: formatNumber(ext.n, 0, { thousands: true }) })
}

export function relativeFull(ext: Extended): string | null {
  const r = ext.rolling_relative
  if (!r) return null
  return fillCopy(TEAR_P1.relative.full, { beta: formatNumber(r.full_beta, 3), correlation: formatNumber(r.full_correlation, 3) })
}

/** The period word the up_n/down_n counts are in: months on a monthly series (run_extended's to_months,
 *  periods_per_year 12), sessions otherwise. rolling_relative.window_unit is the fallback signal when a
 *  series is monthly without P = 12 (D25: the capture card wrongly said "sessions" on every series). */
function capturePeriodUnit(ext: Extended): string {
  const monthly = ext.periods_per_year === 12 || ext.rolling_relative?.window_unit === 'months'
  return monthly ? TEAR_P1.capture.unitMonths : TEAR_P1.capture.unitSessions
}

export function captureRows(ext: Extended): KeyValueRow[] {
  const c = ext.capture
  if (!c) return []
  const unit = capturePeriodUnit(ext)
  return [
    { id: 'up', label: TEAR_P1.capture.up, value: formatNumber(c.up, 3) },
    { id: 'down', label: TEAR_P1.capture.down, value: formatNumber(c.down, 3) },
    { id: 'upN', label: fillCopy(TEAR_P1.capture.upN, { unit }), value: formatNumber(c.up_n, 0, { thousands: true }) },
    { id: 'downN', label: fillCopy(TEAR_P1.capture.downN, { unit }), value: formatNumber(c.down_n, 0, { thousands: true }) },
  ]
}

export function scatterInput(ext: Extended, name: string): XyScatterInput | null {
  const s = ext.scatter
  if (!s) return null
  const factor = isPercentUnit(s.unit) ? PERCENT : 1
  const unit = pct(s.unit) || (shortUnit(s.unit) === 'USD' ? 'USD' : '')
  const points = s.x.map((x, i) => ({ x: x * factor, y: (s.y[i] ?? Number.NaN) * factor, label: s.date[i] ?? '' }))
  const line = typeof s.slope === 'number' && typeof s.intercept === 'number'
    ? { slope: s.slope, intercept: s.intercept * factor, label: TEAR_P1.scatter.line }
    : null
  return {
    name: fillCopy(TEAR_P1.scatter.name, { name }),
    x: { label: TEAR_P1.scatter.x, unit, decimals: 2 },
    y: { label: TEAR_P1.scatter.y, unit, decimals: 2 },
    points,
    line,
  }
}

export interface RegimeRowView {
  readonly regime: 'low' | 'mid' | 'high'
  readonly name: string
  readonly n: string
  readonly mean: string
  readonly sharpe: string
  readonly hit: string
}

export function regimeRows(ext: Extended): RegimeRowView[] {
  const g = ext.regimes
  if (!g) return []
  return g.rows.map((r) => ({
    regime: r.regime,
    name: TEAR_P1.regimes.names[r.regime],
    n: formatNumber(r.n, 0, { thousands: true }),
    mean: formatValue(r.mean, ext.unit, 4, true),
    sharpe: formatNumber(r.sharpe, 2),
    hit: formatShare(r.hit_rate),
  }))
}

export function unlabelledLine(ext: Extended): string {
  const g = ext.regimes
  if (!g) return ''
  return fillCopy(TEAR_P1.regimes.unlabelled, { min: g.min_history, n: formatNumber(g.unlabelled, 0, { thousands: true }) })
}

export function welchLine(ext: Extended): string {
  const g = ext.regimes
  if (!g) return ''
  return `${fillCopy(TEAR_P1.regimes.welch, { t: formatNumber(g.welch_t, 2), df: formatNumber(g.welch_df, 1) })} ${TEAR_P1.regimes.noP}`
}
