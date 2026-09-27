// BarLadder (UI_SPEC 8; look spec 6.3): signed bars by category (blocks, the cost ladder, P&L by hour
// or weekday) in bar-pos and bar-neg, white confidence whiskers with caps, a solid zero line and an
// optional dashed reference line (the cost ladder's break-even). Each value is printed under its
// category label with its sign, so colour is never the only cue and no label collides with a whisker.
import { BAR_LADDER } from '../../copy/echarts'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, echartsPresets, type ChartTokens } from '../theme'
import type { BarSeriesOption, CustomSeriesOption, EChartsOption } from './core'
import { signed, withUnit } from './format'
import { baseOption, isFiniteNumber, markLine, refLine, textFont, themeXAxis, themeYAxis, type MarkLineItem, type PlotRect } from './shared'

export interface LadderBar {
  readonly label: string
  readonly value: number | null
  /** Confidence interval; a whisker is drawn only when both ends are given. */
  readonly lo?: number | null
  readonly hi?: number | null
  /** Observations behind the bar (shown in the table view). */
  readonly n?: number
}

export interface BarLadderInput {
  readonly name: string
  readonly unit?: string
  readonly decimals?: number
  /** What the whiskers show, for the summary: '95% confidence interval'. */
  readonly ci?: string
  readonly bars: readonly LadderBar[]
  /** A horizontal dashed line at a value (a benchmark level). */
  readonly reference?: { readonly value: number; readonly label: string }
  /** A vertical dashed line at a fractional category position (the cost ladder's break-even cost). */
  readonly marker?: { readonly at: number; readonly label: string }
}

const DEFAULT_DECIMALS = 2
/** Whisker caps span this share of the category band. */
const CAP_SHARE = 0.2
const BAR_MAX_WIDTH = 64
const LABEL_LINE_HEIGHT = 16

type Whisker = readonly [index: number, lo: number, hi: number]

function whiskers(bars: readonly LadderBar[]): Whisker[] {
  return bars.flatMap((b, i) => (isFiniteNumber(b.lo) && isFiniteNumber(b.hi) ? [[i, b.lo, b.hi] as const] : []))
}

function whiskerSeries(items: readonly Whisker[], colour: string): CustomSeriesOption {
  const line = (x1: number, y1: number, x2: number, y2: number) => ({
    type: 'line' as const,
    shape: { x1, y1, x2, y2 },
    style: { stroke: colour, lineWidth: CHART_GEOMETRY.lineWidth },
  })
  return {
    id: 'whiskers',
    type: 'custom',
    silent: true,
    z: 3,
    encode: { x: 0, y: [1, 2] },
    data: items.map((w) => [...w]),
    renderItem: (params, api) => {
      const [i, lo, hi] = items[params.dataIndex]!
      const top = api.coord([i, hi])
      const bottom = api.coord([i, lo])
      const band = (api.size?.([1, 0]) as number[] | undefined)?.[0] ?? 0
      const half = Math.round((band * CAP_SHARE) / 2)
      // On pixel centres, so each 1px line is one white column or row, not two half-grey ones.
      const snap = (v: number) => Math.floor(v) + 0.5
      const x = snap(top[0]!)
      const [y1, y2] = [snap(top[1]!), snap(bottom[1]!)]
      return {
        type: 'group',
        children: [
          line(x, y1, x, y2),
          line(x - half, y1, x + half, y1),
          line(x - half, y2, x + half, y2),
        ],
      }
    },
  }
}

function barSeries(input: BarLadderInput, tokens: ChartTokens): BarSeriesOption {
  const p = echartsPresets(tokens).barLadder
  const lines: MarkLineItem[] = [refLine({ yAxis: 0 }, tokens.color.zeroLine, { dashed: false })]
  if (input.reference) {
    lines.push(refLine({ yAxis: input.reference.value }, tokens.color.data, { label: input.reference.label }))
  }
  return {
    id: 'bars',
    type: 'bar',
    silent: true,
    barMaxWidth: BAR_MAX_WIDTH,
    data: input.bars.map((b) => ({
      value: isFiniteNumber(b.value) ? b.value : '-',
      itemStyle: { color: isFiniteNumber(b.value) && b.value < 0 ? p.neg : p.pos },
    })),
    markLine: markLine(lines, tokens),
  }
}

/**
 * The marker between categories: a category axis places data only at category centres, so the
 * position is interpolated between the two neighbouring centres and drawn full height, labelled above.
 */
function markerSeries(marker: { readonly at: number; readonly label: string }, tokens: ChartTokens): CustomSeriesOption {
  const base = Math.floor(marker.at)
  const frac = marker.at - base
  const colour = tokens.color.data
  const font = textFont(tokens)
  return {
    id: 'marker',
    type: 'custom',
    silent: true,
    z: 4,
    encode: { x: 0, y: 1 },
    data: [[base, 0]],
    renderItem: (params, api) => {
      const plot = params.coordSys as unknown as PlotRect
      const from = api.coord([base, 0])[0]!
      // On the pixel centre, so the 1px dashed line is not smeared over two columns.
      const x = Math.floor(from + frac * (api.coord([base + 1, 0])[0]! - from)) + 0.5
      return {
        type: 'group',
        children: [
          {
            type: 'line',
            shape: { x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height },
            style: { stroke: colour, lineWidth: CHART_GEOMETRY.lineWidth, lineDash: [...CHART_GEOMETRY.fenceDash] },
          },
          {
            type: 'text',
            x,
            y: plot.y - 2,
            style: { text: marker.label, fill: colour, align: 'center', verticalAlign: 'bottom', font: `${font.fontSize}px ${font.fontFamily}` },
          },
        ],
      }
    },
  }
}

export function barLadderOption(input: BarLadderInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const d = input.decimals ?? DEFAULT_DECIMALS
  const x = themeXAxis(tokens)
  const items = whiskers(input.bars)
  const valueText = (i: number) => {
    const v = input.bars[i]?.value
    return isFiniteNumber(v) ? signed(v, d) : ''
  }
  const series = [
    barSeries(input, tokens),
    ...(items.length > 0 ? [whiskerSeries(items, echartsPresets(tokens).barLadder.whisker)] : []),
    ...(input.marker ? [markerSeries(input.marker, tokens)] : []),
  ]
  const ref = input.reference?.value
  const y = themeYAxis(tokens)
  return {
    ...baseOption(tokens),
    grid: { left: 8, right: CHART_GEOMETRY.axisGutter, top: 16, bottom: 44 },
    xAxis: {
      ...x,
      type: 'category',
      data: input.bars.map((b) => b.label),
      axisTick: { ...x.axisTick, alignWithLabel: true },
      axisLabel: {
        ...x.axisLabel,
        ...textFont(tokens),
        interval: 0,
        lineHeight: LABEL_LINE_HEIGHT,
        formatter: (value: string, index: number) => `${value}\n${valueText(index)}`,
      },
    },
    yAxis: {
      ...y,
      axisLabel: { ...y.axisLabel, ...textFont(tokens) },
      type: 'value',
      // ECharts rounds its own range to nice ticks; a reference line outside the data widens it.
      ...(ref === undefined ? {} : {
        min: (e: { min: number }) => Math.min(e.min, ref),
        max: (e: { max: number }) => Math.max(e.max, ref),
      }),
    },
    series,
  }
}

interface Extreme {
  readonly value: number
  readonly label: string
}

export function describeBarLadder(input: BarLadderInput): string {
  const valued = input.bars.filter((b): b is LadderBar & { value: number } => isFiniteNumber(b.value))
  if (valued.length === 0) return fillCopy(BAR_LADDER.summaryEmpty, { name: input.name })
  const d = input.decimals ?? DEFAULT_DECIMALS
  const fmt = (v: number) => withUnit(signed(v, d), input.unit)
  let max: Extreme = valued[0]!
  let min: Extreme = valued[0]!
  for (const b of valued) {
    if (b.value > max.value) max = b
    if (b.value < min.value) min = b
  }
  const neg = valued.filter((b) => b.value < 0).length
  const text = fillCopy(BAR_LADDER.summary, {
    name: input.name,
    count: input.bars.length,
    pos: valued.length - neg,
    neg,
    max: fmt(max.value),
    maxAt: max.label,
    min: fmt(min.value),
    minAt: min.label,
  })
  return input.ci && whiskers(input.bars).length > 0 ? text + fillCopy(BAR_LADDER.summaryCi, { ci: input.ci }) : text
}

export function barLadderTable(input: BarLadderInput): ChartTable {
  const d = input.decimals ?? DEFAULT_DECIMALS
  const fmt = (v: number | null | undefined) => (isFiniteNumber(v) ? signed(v, d) : '')
  return {
    caption: input.name,
    columns: [
      { key: 'label', label: BAR_LADDER.colLabel },
      { key: 'value', label: BAR_LADDER.colValue, numeric: true },
      { key: 'lo', label: BAR_LADDER.colLo, numeric: true },
      { key: 'hi', label: BAR_LADDER.colHi, numeric: true },
      { key: 'n', label: BAR_LADDER.colN, numeric: true },
    ],
    rows: input.bars.map((b) => ({ label: b.label, value: fmt(b.value), lo: fmt(b.lo), hi: fmt(b.hi), n: b.n ?? '' })),
  }
}
