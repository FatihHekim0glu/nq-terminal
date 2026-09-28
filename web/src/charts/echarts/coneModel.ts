// Cone (ANALYTICS_CATALOG SV6 on screen): pointwise percentiles of the stationary-bootstrap paths at each step over
// one year (or 12 months), not a band whole paths stay inside, with the realised last year over them. Two filled
// bands (5 to 95 and 25 to 75) stacked on their lower percentile, the five percentile lines and the realised
// path, named in a key under the chart (coneKey; the 5 and 95 lines are dashed), so neither the band nor a
// colour carries meaning alone. Values are the API's, in display units; nothing is resampled here.
import { CONE } from '../../copy/echartsP1'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../theme'
import type { EChartsOption, LineSeriesOption } from './core'
import { signed, withUnit } from './format'
import { baseOption, isFiniteNumber, markLine, niceAxis, refLine, textFont, themeXAxis, themeYAxis } from './shared'

export interface ConeBand {
  /** The percentile (5, 25, 50, 75, 95). */
  readonly p: number
  readonly values: ReadonlyArray<number | null>
}

export interface ConeInput {
  readonly name: string
  readonly label: string
  readonly unit?: string
  readonly decimals?: number
  readonly steps: readonly number[]
  readonly bands: readonly ConeBand[]
  readonly realised: ReadonlyArray<number | null>
  readonly realisedDates: readonly string[]
}

const DEFAULT_DECIMALS = 2
const OUTER = [5, 95] as const
const INNER = [25, 75] as const
const MEDIAN = 50
const OUTER_OPACITY = 1
const INNER_OPACITY = 0.9

const dec = (input: ConeInput) => input.decimals ?? DEFAULT_DECIMALS
const fmt = (v: number | null | undefined, input: ConeInput) => (isFiniteNumber(v) ? withUnit(signed(v, dec(input)), input.unit) : '--')
const bandOf = (input: ConeInput, p: number) => input.bands.find((b) => b.p === p)?.values ?? []
const pLabel = (p: number) => (p === MEDIAN ? CONE.median : fillCopy(CONE.percentile, { p }))

function points(steps: readonly number[], values: ReadonlyArray<number | null>): Array<[number, number | null]> {
  return steps.map((s, i) => [s, isFiniteNumber(values[i]) ? values[i]! : null])
}

function bandPair(input: ConeInput, [lo, hi]: readonly [number, number], id: string, fill: string, opacity: number): LineSeriesOption[] {
  const low = bandOf(input, lo)
  const high = bandOf(input, hi)
  const width = input.steps.map((_, i) => (isFiniteNumber(low[i]) && isFiniteNumber(high[i]) ? high[i]! - low[i]! : null))
  const common = { type: 'line' as const, silent: true, showSymbol: false, stack: id, stackStrategy: 'all' as const, lineStyle: { width: 0 } }
  return [
    { ...common, id: `${id}-base`, data: points(input.steps, low) },
    { ...common, id: `${id}-band`, data: points(input.steps, width), areaStyle: { color: fill, opacity } },
  ]
}

function pathLine(id: string, label: string, data: Array<[number, number | null]>, colour: string, width: number, dashed = false): LineSeriesOption {
  return {
    id,
    type: 'line',
    silent: true,
    showSymbol: false,
    z: 4,
    data,
    name: label,
    lineStyle: { color: colour, width, ...(dashed ? { type: [...CHART_GEOMETRY.fenceDash] } : {}) },
  }
}

export interface ConeKeyItem {
  readonly label: string
  readonly fill: string
}

/** The key under the chart: each line's colour with its name (end labels would sit on the value axis). */
export function coneKey(tokens: ChartTokens = DEFAULT_CHART_TOKENS): ConeKeyItem[] {
  const c = tokens.color
  return [
    { label: CONE.outer, fill: c.chartVol },
    { label: CONE.inner, fill: c.rollVol },
    { label: CONE.median, fill: c.chartS1 },
    { label: CONE.realised, fill: c.accent2 },
  ]
}

export function coneOption(input: ConeInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const c = tokens.color
  const g = CHART_GEOMETRY
  const style: Readonly<Record<number, readonly [string, number, boolean]>> = {
    5: [c.chartVol, g.lineWidth, true], 25: [c.rollVol, g.lineWidth, false], 50: [c.chartS1, g.primaryWidth, false],
    75: [c.rollVol, g.lineWidth, false], 95: [c.chartVol, g.lineWidth, true],
  }
  const lines = [5, 25, MEDIAN, 75, 95].map((p) => {
    const [colour, width, dashed] = style[p]!
    return pathLine(`p${p}`, pLabel(p), points(input.steps, bandOf(input, p)), colour, width, dashed)
  })
  const realised = pathLine('realised', CONE.realised, points(input.steps, input.realised), c.accent2, g.primaryWidth)
  const all = [...input.bands.flatMap((b) => b.values), ...input.realised, 0].filter(isFiniteNumber)
  const nice = niceAxis(Math.min(...all), Math.max(...all))
  const y = themeYAxis(tokens)
  const x = themeXAxis(tokens)
  const last = input.steps.at(-1) ?? 1
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: g.axisGutter, top: 16, bottom: 28 },
    xAxis: { ...x, type: 'value', min: input.steps[0] ?? 0, max: last, axisLabel: { ...x.axisLabel, ...textFont(tokens) } },
    yAxis: {
      ...y, type: 'value', min: nice.min, max: nice.max, interval: nice.interval,
      axisLabel: { ...y.axisLabel, ...textFont(tokens), formatter: (v: number) => withUnit(signed(v, dec(input)), input.unit) },
    },
    series: [
      ...bandPair(input, OUTER, 'outer', c.chartArea, OUTER_OPACITY),
      ...bandPair(input, INNER, 'inner', c.barMag, INNER_OPACITY),
      ...lines,
      realised,
      { id: 'zero', type: 'line', silent: true, data: [], markLine: markLine([refLine({ yAxis: 0 }, c.zeroLine, { dashed: false })], tokens) },
    ],
  }
}

export function describeCone(input: ConeInput): string {
  const at = input.steps.length - 1
  const lastOf = (p: number) => fmt(bandOf(input, p)[at], input)
  const realised = input.realised[at]
  const base = { name: input.name, label: input.label, horizon: input.steps.length, low: lastOf(5), median: lastOf(MEDIAN), high: lastOf(95) }
  if (!isFiniteNumber(realised)) return fillCopy(CONE.summaryNoRealised, base)
  return fillCopy(CONE.summary, { ...base, realised: fmt(realised, input), realisedDate: input.realisedDates[at] ?? '--' })
}

export function coneTable(input: ConeInput): ChartTable {
  const ps = [5, 25, MEDIAN, 75, 95]
  return {
    caption: fillCopy(CONE.caption, { name: input.name }),
    columns: [
      { key: 'step', label: CONE.colStep, numeric: true },
      { key: 'date', label: CONE.colDate, rowHeader: true },
      ...ps.map((p) => ({ key: `p${p}`, label: pLabel(p), numeric: true })),
      { key: 'realised', label: CONE.realised, numeric: true },
    ],
    rows: input.steps.map((s, i) => ({
      step: String(s),
      date: input.realisedDates[i] ?? '--',
      ...Object.fromEntries(ps.map((p) => [`p${p}`, fmt(bandOf(input, p)[i], input)])),
      realised: fmt(input.realised[i], input),
    })),
  }
}
