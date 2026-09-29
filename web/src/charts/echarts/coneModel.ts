// Cone (ANALYTICS_CATALOG SV6 on screen): pointwise percentiles of the stationary-bootstrap paths at each step over
// one year (or 12 months), not a band whole paths stay inside, with the realised last year over them. Two filled
// bands (5 to 95 and 25 to 75) stacked on their lower percentile, the five percentile lines and the realised
// path, named in a key under the chart (coneKey; the 5 and 95 lines are dashed), so neither the band nor a
// colour carries meaning alone. Values are the API's, in display units; nothing is resampled here.
// Optional overlays lay other paths over the cone (the paper book's P&L as a fraction of K, LV6): each is one
// extra line in a token colour, one key swatch, one summary sentence and one table column. The realised line
// is drawn only when it has a finite value, so a cone with nothing realised (an overlay-only cone) shows no
// empty series and no key entry for it. The realised line is accent2 at the same width, so an accent2
// overlay is for a cone whose realised line is not drawn; when it is drawn, an overlay uses cyanChart.
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

/**
 * The chart tokens an overlay line may use: the terminal's second accent and its chart cyan.
 * accent2 is also the realised line's colour, drawn at the same width and solid, so an accent2 overlay
 * cannot be told from the realised line. Give an overlay accent2 only on a cone whose realised line is not
 * drawn (coneHasRealised(input) is false, as on the LIVE expectation cone). When realised is drawn, use
 * cyanChart, and at most one overlay.
 */
export type ConeOverlayTone = 'accent2' | 'cyanChart'

export interface ConeOverlay {
  /** Names the series and the table column; unique within one cone. */
  readonly id: string
  /** Named in the key, the summary and the table. */
  readonly label: string
  /** One value per step in the cone's unit; null where the path has no value. */
  readonly values: ReadonlyArray<number | null>
  /** accent2 matches the realised line (same colour, width and style): use it only when realised is not drawn. */
  readonly tone: ConeOverlayTone
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
  /** Paths laid over the cone; without them every output is what it is without the field. */
  readonly overlays?: readonly ConeOverlay[]
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
const overlaysOf = (input: ConeInput): readonly ConeOverlay[] => input.overlays ?? []
const overlayKey = (o: ConeOverlay) => `overlay-${o.id}`
const OVERLAY_Z = 5
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

/** The realised path is drawn only when at least one of its values is a finite number. */
export function coneHasRealised(input: ConeInput): boolean {
  return input.realised.some(isFiniteNumber)
}

function pathLine(id: string, label: string, data: Array<[number, number | null]>, colour: string, width: number, dashed = false, z = 4): LineSeriesOption {
  return {
    id,
    type: 'line',
    silent: true,
    showSymbol: false,
    z,
    data,
    name: label,
    lineStyle: { color: colour, width, ...(dashed ? { type: [...CHART_GEOMETRY.fenceDash] } : {}) },
  }
}

export interface ConeKeyItem {
  readonly label: string
  readonly fill: string
}

/**
 * The key under the chart: each line's colour with its name (end labels would sit on the value axis). Overlays
 * follow the cone's own entries; `realised` false (see coneHasRealised) leaves out the Realised entry when that
 * line is not drawn.
 */
export function coneKey(tokens: ChartTokens = DEFAULT_CHART_TOKENS, overlays: readonly ConeOverlay[] = [], realised = true): ConeKeyItem[] {
  const c = tokens.color
  return [
    { label: CONE.outer, fill: c.chartVol },
    { label: CONE.inner, fill: c.rollVol },
    { label: CONE.median, fill: c.chartS1 },
    ...(realised ? [{ label: CONE.realised, fill: c.accent2 }] : []),
    ...overlays.map((o) => ({ label: o.label, fill: c[o.tone] })),
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
  const realised = coneHasRealised(input)
    ? [pathLine('realised', CONE.realised, points(input.steps, input.realised), c.accent2, g.primaryWidth)]
    : []
  const overlays = overlaysOf(input).map((o) =>
    pathLine(overlayKey(o), o.label, points(input.steps, o.values), c[o.tone], g.primaryWidth, false, OVERLAY_Z))
  const all = [...input.bands.flatMap((b) => b.values), ...input.realised, ...overlaysOf(input).flatMap((o) => o.values), 0].filter(isFiniteNumber)
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
      ...realised,
      ...overlays,
      { id: 'zero', type: 'line', silent: true, data: [], markLine: markLine([refLine({ yAxis: 0 }, c.zeroLine, { dashed: false })], tokens) },
    ],
  }
}

export function describeCone(input: ConeInput): string {
  const at = input.steps.length - 1
  const lastOf = (p: number) => fmt(bandOf(input, p)[at], input)
  const realised = input.realised[at]
  const base = { name: input.name, label: input.label, horizon: input.steps.length, low: lastOf(5), median: lastOf(MEDIAN), high: lastOf(95) }
  const text = !isFiniteNumber(realised)
    ? fillCopy(CONE.summaryNoRealised, base)
    : fillCopy(CONE.summary, { ...base, realised: fmt(realised, input), realisedDate: input.realisedDates[at] ?? '--' })
  return text + overlaysOf(input).map((o) => overlaySentence(input, o)).join('')
}

/** One sentence per overlay: its last value and the step it is at; nothing for an overlay with no value. */
function overlaySentence(input: ConeInput, overlay: ConeOverlay): string {
  for (let i = Math.min(overlay.values.length, input.steps.length) - 1; i >= 0; i -= 1) {
    const value = overlay.values[i]
    if (isFiniteNumber(value)) return fillCopy(CONE.summaryOverlay, { label: overlay.label, value: fmt(value, input), step: input.steps[i]! })
  }
  return ''
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
      ...overlaysOf(input).map((o) => ({ key: overlayKey(o), label: o.label, numeric: true })),
    ],
    rows: input.steps.map((s, i) => ({
      step: String(s),
      date: input.realisedDates[i] ?? '--',
      ...Object.fromEntries(ps.map((p) => [`p${p}`, fmt(bandOf(input, p)[i], input)])),
      realised: fmt(input.realised[i], input),
      ...Object.fromEntries(overlaysOf(input).map((o) => [overlayKey(o), fmt(o.values[i], input)])),
    })),
  }
}
