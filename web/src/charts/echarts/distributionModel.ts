// Distribution (UI_SPEC 8; look spec 7.5 RET): a horizontal histogram of returns that shares its
// return axis with an optional daily-return series on the left (the HS and GV side-panel layout). Bars
// are bar-pos at or above zero and bar-neg below; the fitted normal is a curve in the distribution
// colour with dashed mean and one-sigma lines; VaR and CVaR 95 and 99 are amber dashed lines. Input
// follows the API (ARCHITECTURE 4: distribution.histogram and risk): VaR and CVaR are positive losses.
import { DISTRIBUTION } from '../../copy/echarts'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, echartsPresets, type ChartTokens } from '../theme'
import type { CustomSeriesOption, EChartsOption, LineSeriesOption } from './core'
import { fixed, signed, withUnit } from './format'
import {
  baseOption, fenceLine, FENCE_SECONDS, isFiniteNumber, markLine, niceAxis, refLine, spreadLabels, textFont, themeXAxis,
  themeYAxis, type MarkLineItem, type NiceAxis, type PlotRect,
} from './shared'

export interface DistributionRisk {
  readonly var95: number | null
  readonly cvar95: number | null
  readonly var99: number | null
  readonly cvar99: number | null
}

export interface DistributionInput {
  readonly name: string
  readonly unit?: string
  readonly decimals?: number
  /** Bin edges, one more than counts. */
  readonly edges: readonly number[]
  readonly counts: readonly number[]
  /** Expected count per bin under the fitted normal (null where it is undefined). */
  readonly normal?: readonly (number | null)[]
  readonly mean: number
  readonly sd: number
  readonly risk: DistributionRisk
  /** Daily returns drawn on the left against the same return axis; times in epoch seconds. */
  readonly series?: { readonly t: readonly number[]; readonly v: readonly (number | null)[] }
}

export interface HistogramBar {
  readonly lo: number
  readonly hi: number
  readonly count: number
  readonly fill: string
}

const DEFAULT_DECIMALS = 2
/** A 1px black gap between neighbouring bins. */
const BIN_GAP = 1
/** With a series: the series pane ends at 66% of the width, the histogram starts at 70%. */
const SERIES_RIGHT = '34%'
const HIST_LEFT = '70%'
/** A gutter right of the histogram (and of its value axis, when it has one) holds the line labels. */
const LABEL_GUTTER = 64
/** Gap between the pane's right edge and a gutter label (ECharts' own markLine label distance). */
const GUTTER_LABEL_PAD = 5
/** Pixels added to the font size as the least distance between two gutter label centres. */
const LABEL_SPACING = 1

export function histogramBars(input: DistributionInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): HistogramBar[] {
  if (input.edges.length !== input.counts.length + 1) {
    throw new Error(`${input.name}: edges must be one longer than counts`)
  }
  const colours = echartsPresets(tokens).distribution
  return input.counts.map((count, i) => {
    const lo = input.edges[i]!
    const hi = input.edges[i + 1]!
    return { lo, hi, count, fill: (lo + hi) / 2 >= 0 ? colours.pos : colours.neg }
  })
}

function riskValues(risk: DistributionRisk): number[] {
  return [risk.var95, risk.cvar95, risk.var99, risk.cvar99].filter(isFiniteNumber)
}

/** The shared return range: the bins, every risk line, one sigma either side and the series. */
function yExtent(input: DistributionInput): NiceAxis {
  const candidates = [
    input.edges[0]!,
    input.edges[input.edges.length - 1]!,
    ...riskValues(input.risk).map((v) => -v),
    ...(isFiniteNumber(input.sd) ? [input.mean - input.sd, input.mean + input.sd] : []),
    ...(input.series?.v.filter(isFiniteNumber) ?? []),
  ]
  return niceAxis(Math.min(...candidates), Math.max(...candidates))
}

function histSeries(bars: readonly HistogramBar[], axes: { x: number; y: number }): CustomSeriesOption {
  return {
    id: 'hist',
    type: 'custom',
    xAxisIndex: axes.x,
    yAxisIndex: axes.y,
    silent: true,
    encode: { x: 0, y: [1, 2] },
    data: bars.map((b) => [b.count, b.lo, b.hi]),
    renderItem: (params, api) => {
      const bar = bars[params.dataIndex]!
      const base = api.coord([0, bar.lo])
      const end = api.coord([bar.count, bar.hi])
      // Whole-pixel edges: neighbouring bins round to the same edge, so the gap is pure black.
      const top = Math.round(Math.min(base[1]!, end[1]!))
      const bottom = Math.round(Math.max(base[1]!, end[1]!))
      const x = Math.round(base[0]!)
      const height = Math.max(0, bottom - top - BIN_GAP)
      return { type: 'rect', shape: { x, y: top, width: Math.round(end[0]!) - x, height }, style: { fill: bar.fill } }
    },
  }
}

function curveSeries(input: DistributionInput, colour: string, axes: { x: number; y: number }): LineSeriesOption {
  const points = (input.normal ?? []).flatMap((n, i) => {
    if (!isFiniteNumber(n)) return []
    return [[n, (input.edges[i]! + input.edges[i + 1]!) / 2]]
  })
  return {
    id: 'normal', type: 'line', xAxisIndex: axes.x, yAxisIndex: axes.y, silent: true, smooth: 0.3,
    showSymbol: false, data: points, lineStyle: { color: colour, width: CHART_GEOMETRY.primaryWidth },
  }
}

/** One reference line: its return value, label and colour. */
interface RefSpec {
  readonly value: number
  readonly label: string
  readonly colour: string
}

/** Mean, one sigma, VaR and CVaR, in that order (VaR and CVaR are losses, so drawn at -v). */
function refSpecs(input: DistributionInput, tokens: ChartTokens): RefSpec[] {
  const p = echartsPresets(tokens).distribution
  const specs: RefSpec[] = [{ value: input.mean, label: DISTRIBUTION.mean, colour: p.curve }]
  if (isFiniteNumber(input.sd)) {
    specs.push({ value: input.mean + input.sd, label: DISTRIBUTION.plusSigma, colour: p.curve })
    specs.push({ value: input.mean - input.sd, label: DISTRIBUTION.minusSigma, colour: p.curve })
  }
  const risk: readonly [number | null, string][] = [
    [input.risk.var95, DISTRIBUTION.var95],
    [input.risk.cvar95, DISTRIBUTION.cvar95],
    [input.risk.var99, DISTRIBUTION.var99],
    [input.risk.cvar99, DISTRIBUTION.cvar99],
  ]
  for (const [v, label] of risk) {
    if (isFiniteNumber(v)) specs.push({ value: -v, label, colour: p.risk })
  }
  return specs
}

/**
 * The dashed lines, with no label of their own: gutterLabels() draws the labels in a gutter, so the
 * mean and one-sigma lines of a narrow distribution (a tiny sd) never print over each other, and no
 * label sits inside a histogram bar.
 */
function riskLines(specs: readonly RefSpec[]): MarkLineItem[] {
  return specs.map((s) => ({ ...refLine({ yAxis: s.value }, s.colour), name: s.label }))
}

/**
 * The gutter labels, right of the histogram pane (past its value axis when the pane has one), each
 * level with its line. Placed in pixels at draw time, so lines closer than a text line get labels that
 * do not touch: a crowded run is spread to one text line apart.
 */
function gutterLabels(specs: readonly RefSpec[], axes: { x: number; y: number }, tokens: ChartTokens, offset: number): CustomSeriesOption {
  const font = textFont(tokens)
  return {
    id: 'lineLabels',
    type: 'custom',
    xAxisIndex: axes.x,
    yAxisIndex: axes.y,
    silent: true,
    clip: false,
    z: 5,
    data: [[0, 0]],
    renderItem: (params, api) => {
      const plot = params.coordSys as unknown as PlotRect
      const ys = spreadLabels(specs.map((s) => api.coord([0, s.value])[1]!), font.fontSize + LABEL_SPACING, plot.y + plot.height)
      return {
        type: 'group',
        children: specs.map((s, i) => ({
          type: 'text' as const,
          x: plot.x + plot.width + offset + GUTTER_LABEL_PAD,
          y: Math.round(ys[i]!),
          style: { text: s.label, fill: s.colour, align: 'left' as const, verticalAlign: 'middle' as const, font: `${font.fontSize}px ${font.fontFamily}` },
        })),
      }
    },
  }
}

function linesSeries(lines: MarkLineItem[], axes: { x: number; y: number }, tokens: ChartTokens): LineSeriesOption {
  return { id: 'lines', type: 'line', xAxisIndex: axes.x, yAxisIndex: axes.y, silent: true, data: [], markLine: markLine(lines, tokens) }
}

function returnsSeries(input: DistributionInput, tokens: ChartTokens): LineSeriesOption {
  const s = input.series!
  const data = s.t.map((t, i) => [t * 1000, isFiniteNumber(s.v[i]) ? s.v[i]! : null])
  const crossesFence = s.t.some((t) => t >= FENCE_SECONDS)
  return {
    id: 'returns', type: 'line', xAxisIndex: 0, yAxisIndex: 0, silent: true, showSymbol: false,
    sampling: 'lttb', connectNulls: false, data,
    lineStyle: { color: tokens.color.chartS1, width: CHART_GEOMETRY.lineWidth },
    ...(crossesFence ? { markLine: markLine([fenceLine(tokens)], tokens) } : {}),
  }
}

export function distributionOption(input: DistributionInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const bars = histogramBars(input, tokens)
  const colours = echartsPresets(tokens).distribution
  const { min, max, interval } = yExtent(input)
  const font = textFont(tokens)
  const theme = { y: themeYAxis(tokens), x: themeXAxis(tokens) }
  // The return axis names its unit on every label (a percent axis reads 1.5%, as the bar ladders do).
  const y = { ...theme.y, axisLabel: { ...theme.y.axisLabel, ...font, formatter: (value: number) => withUnit(String(value), input.unit) } }
  const x = { ...theme.x, axisLabel: { ...theme.x.axisLabel, ...font } }
  const countAxis = (gridIndex: number) => ({ ...x, type: 'value' as const, gridIndex, min: 0 })
  const hasSeries = input.series !== undefined
  const axes = hasSeries ? { x: 1, y: 1 } : { x: 0, y: 0 }
  const specs = refSpecs(input, tokens)
  // Without a series the histogram carries the value axis on its right, so the labels go past it.
  const labelOffset = hasSeries ? 0 : CHART_GEOMETRY.axisGutter
  const series = [
    histSeries(bars, axes),
    curveSeries(input, colours.curve, axes),
    linesSeries(riskLines(specs), axes, tokens),
    gutterLabels(specs, axes, tokens, labelOffset),
  ]
  if (!hasSeries) {
    return {
      ...baseOption(tokens),
      grid: [{ left: 8, right: CHART_GEOMETRY.axisGutter + LABEL_GUTTER, top: 8, bottom: 24 }],
      xAxis: [countAxis(0)],
      yAxis: [{ ...y, type: 'value', gridIndex: 0, min, max, interval }],
      series,
    }
  }
  return {
    ...baseOption(tokens),
    grid: [
      { left: 8, right: SERIES_RIGHT, top: 8, bottom: 24 },
      { left: HIST_LEFT, right: LABEL_GUTTER, top: 8, bottom: 24 },
    ],
    xAxis: [{ ...x, type: 'time', gridIndex: 0, axisLabel: { ...x.axisLabel, formatter: '{yyyy}' } }, countAxis(1)],
    yAxis: [
      { ...y, type: 'value', gridIndex: 0, min, max, interval },
      { type: 'value', gridIndex: 1, min, max, interval, show: false },
    ],
    series: [returnsSeries(input, tokens), ...series],
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function describeDistribution(input: DistributionInput): string {
  const d = input.decimals ?? DEFAULT_DECIMALS
  const u = (text: string) => withUnit(text, input.unit)
  const loss = (v: number | null) => (isFiniteNumber(v) ? u(fixed(v, d)) : DISTRIBUTION.notAvailable)
  return fillCopy(DISTRIBUTION.summary, {
    name: input.name,
    n: sum(input.counts),
    bins: input.counts.length,
    lo: u(signed(input.edges[0] ?? 0, d)),
    hi: u(signed(input.edges[input.edges.length - 1] ?? 0, d)),
    mean: u(signed(input.mean, d)),
    sd: isFiniteNumber(input.sd) ? u(fixed(input.sd, d)) : DISTRIBUTION.notAvailable,
    varFive: loss(input.risk.var95),
    cvarFive: loss(input.risk.cvar95),
    varOne: loss(input.risk.var99),
    cvarOne: loss(input.risk.cvar99),
  })
}

export function distributionTable(input: DistributionInput): ChartTable {
  const d = input.decimals ?? DEFAULT_DECIMALS
  const bars = histogramBars(input)
  return {
    caption: fillCopy(DISTRIBUTION.caption, { name: input.name }),
    columns: [
      { key: 'from', label: DISTRIBUTION.colFrom, numeric: true },
      { key: 'to', label: DISTRIBUTION.colTo, numeric: true },
      { key: 'count', label: DISTRIBUTION.colCount, numeric: true },
      { key: 'normal', label: DISTRIBUTION.colNormal, numeric: true },
    ],
    rows: bars.map((b, i) => {
      const n = input.normal?.[i]
      return { from: fixed(b.lo, d), to: fixed(b.hi, d), count: b.count, normal: isFiniteNumber(n) ? fixed(n, 1) : '' }
    }),
  }
}
