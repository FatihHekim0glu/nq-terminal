// Pieces every chart in the ECharts set shares: the base option from the charts theme, writable
// copies of the theme's readonly axes, the 2022-01-01 fence line and plain line styles. Colours come
// only from ChartTokens (src/charts/theme); nothing here writes a colour of its own.
import { ECHARTS } from '../../copy/echarts'
import { CHART_GEOMETRY, echartsPresets, forcedDash, makeEchartsTheme, type ChartTokens, type EchartsTheme } from '../theme'

/** The OOS fence (UI_SPEC section 6): 2022-01-01 00:00 UTC in epoch seconds. */
export const FENCE_SECONDS = Date.UTC(2022, 0, 1) / 1000

export type DeepWritable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? DeepWritable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
      : T

/** A deep copy of a readonly theme value that ECharts' option types accept. */
export function writable<T>(value: T): DeepWritable<T> {
  return structuredClone(value) as DeepWritable<T>
}

export interface BaseOption {
  backgroundColor: string
  animation: boolean
  textStyle: DeepWritable<EchartsTheme['textStyle']>
}

/** Background, text and animation from the charts theme (black, the chart font, no animation). */
export function baseOption(tokens: ChartTokens): BaseOption {
  const theme = makeEchartsTheme(tokens)
  return { backgroundColor: theme.backgroundColor, animation: theme.animation, textStyle: writable(theme.textStyle) }
}

/** The theme's value axis (white line and ticks, minor ticks, grid off) as a writable copy. */
export function themeYAxis(tokens: ChartTokens): DeepWritable<EchartsTheme['yAxis']> {
  return writable(makeEchartsTheme(tokens).yAxis)
}

export function themeXAxis(tokens: ChartTokens): DeepWritable<EchartsTheme['xAxis']> {
  return writable(makeEchartsTheme(tokens).xAxis)
}

/**
 * The second cue for a line at series position `position` under forced colours (theme/chartContrast.ts):
 * its dash as a lineStyle part. Empty in every other mode and for the solid lead line, so the default
 * look is untouched.
 */
export function forcedLineType(tokens: ChartTokens, position: number): { type?: number[] } {
  const dash = forcedDash(tokens, position)
  return dash !== undefined && dash.length > 0 ? { type: dash } : {}
}

/** The chart font at the chart size (ECharts labels default to 12px; the look is 13px). */
export function textFont(tokens: ChartTokens): { fontFamily: string; fontSize: number } {
  return { fontFamily: tokens.font.family, fontSize: tokens.font.size }
}

/** Tick steps per decade: 1, 2 and 5 times a power of ten. */
const NICE_MULTIPLES = [1, 2, 5] as const
/** The most steps a nice axis takes, so labels never crowd. */
const MAX_AXIS_STEPS = 8

export interface NiceAxis {
  readonly min: number
  readonly max: number
  readonly interval: number
}

/**
 * [min, max] rounded out to the smallest 1, 2 or 5 step that spans it in at most eight steps
 * (-6.91..7.43 gives -8..8 by 2). Passing the interval to ECharts keeps every tick evenly spaced:
 * left to itself it picks its own interval and adds the extremes as extra, closer labels.
 */
export function niceAxis(min: number, max: number): NiceAxis {
  if (!(max - min > 0)) return { min: min - 1, max: max + 1, interval: 1 }
  const clean = (v: number) => Number(v.toPrecision(12))
  let magnitude = 10 ** Math.floor(Math.log10((max - min) / MAX_AXIS_STEPS))
  for (;;) {
    for (const m of NICE_MULTIPLES) {
      const interval = clean(m * magnitude)
      const lo = Math.floor(clean(min / interval))
      const hi = Math.ceil(clean(max / interval))
      if (hi - lo <= MAX_AXIS_STEPS) return { min: clean(lo * interval), max: clean(hi * interval), interval }
    }
    magnitude *= 10
  }
}

/** A category axis with no line or ticks: labels only (heatmap rows and columns, swimlane lanes). */
export function bareAxis(): { axisLine: { show: false }; axisTick: { show: false }; splitLine: { show: false } } {
  return { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
}

/** Where a reference line's label sits (ECharts markLine label positions). */
export type LineLabelPosition = 'start' | 'end' | 'middle' | 'insideStartTop' | 'insideStartBottom' | 'insideEndTop' | 'insideEndBottom'

export interface MarkLineItem {
  name?: string
  xAxis?: number
  yAxis?: number
  lineStyle: { color: string; width: number; type: 'solid' | number[] }
  label: { show: boolean; formatter?: string; color?: string; position?: LineLabelPosition }
}

/** A dashed or solid reference line with an optional text label in the line's colour. */
export function refLine(
  at: { readonly xAxis?: number; readonly yAxis?: number },
  colour: string,
  opts: { readonly label?: string; readonly dashed?: boolean; readonly position?: LineLabelPosition } = {},
): MarkLineItem {
  const dash = opts.dashed === false ? 'solid' : [...CHART_GEOMETRY.fenceDash]
  return {
    ...at,
    ...(opts.label === undefined ? {} : { name: opts.label }),
    lineStyle: { color: colour, width: CHART_GEOMETRY.lineWidth, type: dash },
    label: opts.label === undefined
      ? { show: false }
      : { show: true, formatter: opts.label, color: colour, position: opts.position ?? 'insideEndTop' },
  }
}

/**
 * The fence on a time axis: amber, dashed, labelled `IS | 2022+ SPENT` at its top. The label goes at
 * the line's end, or at its start when the value axis is inverted (the line then runs top down).
 */
export function fenceLine(tokens: ChartTokens, labelAt: 'start' | 'end' = 'end'): MarkLineItem {
  const fence = echartsPresets(tokens).fence
  return {
    name: ECHARTS.fence,
    xAxis: FENCE_SECONDS * 1000,
    lineStyle: { color: fence.color, width: fence.width, type: [...fence.type] },
    label: { show: true, formatter: ECHARTS.fence, color: fence.color, position: labelAt },
  }
}

export interface MarkLineOption {
  silent: true
  symbol: ['none', 'none']
  animation: false
  /** Decimals ECharts keeps on each reference value (it rounds to 2 by default, and clamps at 20). */
  precision: number
  label: { fontFamily: string; fontSize: number }
  data: MarkLineItem[]
}

/**
 * markLine settings shared by every reference line: no end symbols, no hover, no animation, chart font.
 * ECharts rounds each xAxis / yAxis value with toFixed(precision), and precision defaults to 2, which
 * would turn alpha / k = 0.05 / 21 into 0 (gone on a log axis). 20 is its maximum and keeps every value
 * drawn here (p values, ratios, the fence in milliseconds) exact.
 */
export function markLine(data: readonly MarkLineItem[], tokens: ChartTokens): MarkLineOption {
  return { silent: true, symbol: ['none', 'none'], animation: false, precision: 20, label: textFont(tokens), data: [...data] }
}

export function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** The plot rectangle a custom series' renderItem receives as params.coordSys (cartesian). */
export interface PlotRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Label centres moved apart so neighbours are at least `gap` pixels apart, in the input order. Each
 * label keeps its own y when it can; a crowded run is pushed down, then back up if it passes `max`.
 */
export function spreadLabels(ys: readonly number[], gap: number, max: number = Infinity): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  const placed = order.map((o) => o.y)
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap)
  const last = placed.length - 1
  if (last >= 0 && placed[last]! > max) {
    placed[last] = max
    for (let k = last - 1; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - gap)
  }
  const out = new Array<number>(ys.length)
  order.forEach((o, k) => {
    out[o.i] = placed[k]!
  })
  return out
}

/** Start of the UTC year that holds `seconds`, in milliseconds. */
export function yearStartMs(seconds: number): number {
  return Date.UTC(new Date(seconds * 1000).getUTCFullYear(), 0, 1)
}

/** Start of the UTC year after the one that holds `seconds`, in milliseconds. */
export function nextYearStartMs(seconds: number): number {
  return Date.UTC(new Date(seconds * 1000).getUTCFullYear() + 1, 0, 1)
}
