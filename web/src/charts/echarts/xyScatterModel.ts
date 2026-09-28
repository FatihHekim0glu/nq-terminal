// XyScatter (TASKS Phase 10 on screen): one value against another with an optional fitted line. Used for
// BR4 (strategy against benchmark with BR1's OLS line), RD3 (ordered returns against normal quantiles with
// the probplot line) and TA2 (MAE or MFE against the final P&L). Points are white; a second kind (a losing
// trade) is drawn hollow, so the kind is never carried by colour alone. The line is the API's fit, drawn
// from the lowest to the highest x; nothing here fits anything. A point with a missing coordinate is left
// out, never drawn at zero.
import { XY_SCATTER } from '../../copy/echartsP1'
import { fillCopy } from '../../copy/workspace'
import type { ChartColumn, ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../theme'
import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from './core'
import { fixed, signed, withUnit } from './format'
import { baseOption, isFiniteNumber, markLine, niceAxis, refLine, textFont, themeXAxis, themeYAxis } from './shared'

export interface XyPoint {
  readonly x: number
  readonly y: number
  /** Drawn hollow: the second kind (for example a losing trade). */
  readonly hollow?: boolean
  /** A name for the table view (a date, a trade). */
  readonly label?: string
}

export interface XyAxis {
  readonly label: string
  /** '%' attaches to the value; any other unit follows it. */
  readonly unit?: string
  readonly decimals?: number
}

export interface XyScatterInput {
  readonly name: string
  readonly x: XyAxis
  readonly y: XyAxis
  readonly points: readonly XyPoint[]
  /** The API's fitted line y = intercept + slope x, in the plotted units. */
  readonly line?: {
    readonly slope: number
    readonly intercept: number
    readonly label: string
    /** The slope's unit, written straight after it (RD3: `% per unit z`); none for a unit-free slope. */
    readonly slopeUnit?: string
  } | null
  /** What solid and hollow points are; left out when every point is one kind. */
  readonly kinds?: { readonly solid: string; readonly hollow: string }
}

const POINT_SIZE = 5
const POINT_BORDER = 1
const DEFAULT_DECIMALS = 2
const SLOPE_DECIMALS = 4

/** The points with both coordinates finite, in their order. */
export function cleanPoints(points: readonly XyPoint[]): XyPoint[] {
  return points.filter((p) => isFiniteNumber(p.x) && isFiniteNumber(p.y))
}

const dec = (axis: XyAxis) => axis.decimals ?? DEFAULT_DECIMALS
const show = (value: number, axis: XyAxis, sign = true) => withUnit(sign ? signed(value, dec(axis)) : fixed(value, dec(axis)), axis.unit)

function extent(values: readonly number[]): readonly [number, number] {
  return [Math.min(...values), Math.max(...values)]
}

function axisFor(values: readonly number[], base: ReturnType<typeof themeXAxis> | ReturnType<typeof themeYAxis>, axis: XyAxis, tokens: ChartTokens) {
  const [lo, hi] = values.length > 0 ? extent([...values, 0]) : [-1, 1]
  const nice = niceAxis(lo, hi)
  return {
    ...base,
    type: 'value' as const,
    name: axis.label,
    nameTextStyle: textFont(tokens),
    min: nice.min,
    max: nice.max,
    interval: nice.interval,
    axisLabel: { ...base.axisLabel, ...textFont(tokens), formatter: (v: number) => withUnit(fixed(v, dec(axis)), axis.unit === '%' ? '%' : undefined) },
  }
}

export function xyScatterOption(input: XyScatterInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const points = cleanPoints(input.points)
  const c = tokens.color
  const scatter: ScatterSeriesOption = {
    id: 'points',
    type: 'scatter',
    silent: true,
    z: 4,
    symbolSize: POINT_SIZE,
    data: points.map((p) => ({
      value: [p.x, p.y],
      itemStyle: { color: p.hollow ? c.bg : c.chartS1, borderColor: c.chartS1, borderWidth: POINT_BORDER },
    })),
  }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const series: Array<ScatterSeriesOption | LineSeriesOption> = [scatter]
  const fit = input.line
  if (fit && points.length > 0 && isFiniteNumber(fit.slope) && isFiniteNumber(fit.intercept)) {
    const [x0, x1] = extent(xs)
    series.push({
      id: 'line',
      type: 'line',
      silent: true,
      showSymbol: false,
      z: 5,
      data: [[x0, fit.intercept + fit.slope * x0], [x1, fit.intercept + fit.slope * x1]],
      lineStyle: { color: c.accent2, width: CHART_GEOMETRY.primaryWidth },
      endLabel: { show: true, ...textFont(tokens), formatter: fit.label, color: c.accent2 },
    })
    ys.push(fit.intercept + fit.slope * x0, fit.intercept + fit.slope * x1)
  }
  series.push({
    id: 'zero',
    type: 'line',
    silent: true,
    data: [],
    markLine: markLine([refLine({ xAxis: 0 }, c.zeroLine, { dashed: false }), refLine({ yAxis: 0 }, c.zeroLine, { dashed: false })], tokens),
  })
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: CHART_GEOMETRY.axisGutter, top: 24, bottom: 40 },
    xAxis: { ...axisFor(xs, themeXAxis(tokens), input.x, tokens), nameLocation: 'middle', nameGap: 24 },
    yAxis: { ...axisFor(ys, themeYAxis(tokens), input.y, tokens), nameLocation: 'end' },
    series,
  }
}

export function describeXyScatter(input: XyScatterInput): string {
  const points = cleanPoints(input.points)
  if (points.length === 0) return fillCopy(XY_SCATTER.summaryEmpty, { name: input.name })
  const [xmin, xmax] = extent(points.map((p) => p.x))
  const [ymin, ymax] = extent(points.map((p) => p.y))
  const fit = input.line
  const line = fit && isFiniteNumber(fit.slope) && isFiniteNumber(fit.intercept)
    ? fillCopy(XY_SCATTER.summaryLine, { label: fit.label, slope: `${fixed(fit.slope, SLOPE_DECIMALS)}${fit.slopeUnit ?? ''}`, intercept: show(fit.intercept, input.y) })
    : ''
  const hollowN = points.filter((p) => p.hollow).length
  const kinds = input.kinds
    ? fillCopy(XY_SCATTER.summaryKinds, { solidN: points.length - hollowN, solid: input.kinds.solid, hollowN, hollow: input.kinds.hollow })
    : ''
  return fillCopy(XY_SCATTER.summary, {
    name: input.name,
    n: points.length,
    x: input.x.label,
    xmin: show(xmin, input.x),
    xmax: show(xmax, input.x),
    y: input.y.label,
    ymin: show(ymin, input.y),
    ymax: show(ymax, input.y),
    line: `${line}${kinds}`,
  })
}

export function xyScatterTable(input: XyScatterInput): ChartTable {
  const points = cleanPoints(input.points)
  const labelled = points.some((p) => p.label !== undefined)
  const columns: ChartColumn[] = [
    ...(labelled ? [{ key: 'label', label: XY_SCATTER.colPoint, rowHeader: true }] : []),
    { key: 'x', label: input.x.label, numeric: true },
    { key: 'y', label: input.y.label, numeric: true },
    ...(input.kinds ? [{ key: 'kind', label: XY_SCATTER.colKind }] : []),
  ]
  const rows = points.map((p) => ({
    ...(labelled ? { label: p.label ?? '' } : {}),
    x: show(p.x, input.x),
    y: show(p.y, input.y),
    ...(input.kinds ? { kind: p.hollow ? input.kinds.hollow : input.kinds.solid } : {}),
  }))
  return { caption: fillCopy(XY_SCATTER.caption, { name: input.name }), columns, rows }
}
