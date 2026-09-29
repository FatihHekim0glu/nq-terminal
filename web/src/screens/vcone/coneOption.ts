// The VCONE chart (TASKS Phase 11, ANALYTICS MV9 over MV3): a volatility cone over the horizons (5 to 252 sessions, a
// category axis so each horizon gets equal room), three bands stacked on their lower bound (min to max,
// 10th to 90th, 25th to 75th percentile), the median line and the latest term structure over them with a
// marker on each horizon. Values are the API's fractions shown in %; nothing is recomputed here. Colours
// come from the chart tokens only; the key under the chart names each mark, so no colour carries meaning alone.
// U23 (WCAG 1.4.11): the fills alone cannot be told apart (three steps of 3:1 would run past white), so every
// band edge is a 1px line of the text token, at least 3:1 on the page and on all three fills, and the fills are
// solid token mixes stepping up toward the middle. The key under the chart uses the same fills.
import type { EChartsOption, LineSeriesOption } from '../../charts/echarts/core'
import { toDecimal } from '../../format/decimal'
import { baseOption, isFiniteNumber, niceAxis, textFont, themeXAxis, themeYAxis } from '../../charts/echarts/shared'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../../charts/theme'
import { fillCopy } from '../../copy/workspace'
import { VCONE } from '../../copy/vcone'
import type { VolConeRow } from './types'

export const PCT = 100
const PCT_DECIMALS = 1
/** Share of the bar-magnitude blue in the outer fill (the rest is the range fill), and of the volume grey in the inner fill (the rest is the blue). */
export const OUTER_MIX = 0.7
export const INNER_MIX = 0.6
/** Above the fills (ECharts default 2), below the median and latest lines (4). */
const EDGE_Z = 3

export interface ConeInput {
  readonly name: string
  readonly asOf: string
  /** Horizons (sessions) that have a cone, in order. */
  readonly steps: readonly number[]
  readonly rows: readonly VolConeRow[]
}

interface BandColours {
  readonly range: string
  readonly outer: string
  readonly inner: string
  /** The 1px line on every band edge. */
  readonly edge: string
}

const HEX6 = /^#([0-9A-Fa-f]{6})$/

/** `a` mixed toward `b` by `t` (sRGB channels, rounded); `b` itself when either is not a 6-digit hex colour. */
function mixHex(a: string, b: string, t: number): string {
  const from = HEX6.exec(a)?.[1]
  const to = HEX6.exec(b)?.[1]
  if (from === undefined || to === undefined) return b
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const out = [0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** The band fills and the edge line, all derived from the chart tokens. */
function bandColours(tokens: ChartTokens = DEFAULT_CHART_TOKENS): BandColours {
  const c = tokens.color
  return {
    range: c.chartArea,
    outer: mixHex(c.chartArea, c.barMag, OUTER_MIX),
    inner: mixHex(c.barMag, c.chartVol, INNER_MIX),
    edge: c.text,
  }
}

type StatKey = 'min' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'max' | 'latest'

const inPct = (v: number | null | undefined): number | null => (isFiniteNumber(v) ? v * PCT : null)
const column = (input: ConeInput, key: StatKey) => input.rows.map((r) => inPct(r[key]))

function band(input: ConeInput, lo: StatKey, hi: StatKey, id: string, fill: string, edge: string): LineSeriesOption[] {
  const low = column(input, lo)
  const high = column(input, hi)
  const width = low.map((l, i) => (l !== null && high[i] !== null ? high[i]! - l : null))
  const common = { type: 'line' as const, silent: true, showSymbol: false, stack: id, stackStrategy: 'all' as const, lineStyle: { width: CHART_GEOMETRY.lineWidth, color: edge } }
  // The base series carries the lower edge; drawn above the fills (z), so the band's own fill never paints over it.
  // The band series carries the upper edge (a stacked line sits on the running total).
  return [
    { ...common, id: `${id}-base`, z: EDGE_Z, data: low },
    { ...common, id: `${id}-band`, data: width, areaStyle: { color: fill, opacity: 1 } },
  ]
}

function line(id: string, name: string, data: Array<number | null>, colour: string, symbol: boolean): LineSeriesOption {
  const width = CHART_GEOMETRY.primaryWidth
  return { id, name, type: 'line', silent: true, z: 4, data, showSymbol: symbol, symbolSize: 6, lineStyle: { color: colour, width }, itemStyle: { color: colour } }
}

export interface ConeKeyItem {
  readonly label: string
  readonly fill: string
}

/** The key under the chart: each band and line with its name. */
export function coneKey(asOf: string, tokens: ChartTokens = DEFAULT_CHART_TOKENS): ConeKeyItem[] {
  const c = tokens.color
  const bands = bandColours(tokens)
  return [
    { label: VCONE.keyRange, fill: bands.range },
    { label: VCONE.keyOuter, fill: bands.outer },
    { label: VCONE.keyInner, fill: bands.inner },
    { label: VCONE.keyMedian, fill: c.chartS1 },
    { label: fillCopy(VCONE.keyLatest, { asOf }), fill: c.accent2 },
  ]
}

export function coneOption(input: ConeInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const c = tokens.color
  const bands = bandColours(tokens)
  const all = [...column(input, 'max'), ...column(input, 'latest'), 0].filter(isFiniteNumber)
  const nice = niceAxis(0, Math.max(...all))
  const x = themeXAxis(tokens)
  const y = themeYAxis(tokens)
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: CHART_GEOMETRY.axisGutter, top: 16, bottom: 28 },
    xAxis: {
      ...x,
      type: 'category',
      boundaryGap: false,
      data: input.steps.map(String),
      name: VCONE.axisSessions,
      nameLocation: 'middle',
      nameGap: 20,
      axisLabel: { ...x.axisLabel, ...textFont(tokens) },
    },
    yAxis: {
      ...y,
      type: 'value',
      position: 'right',
      min: nice.min,
      max: nice.max,
      interval: nice.interval,
      axisLabel: { ...y.axisLabel, ...textFont(tokens), formatter: (v: number) => `${toDecimal(v, PCT_DECIMALS)}%` },
    },
    series: [
      ...band(input, 'min', 'max', 'range', bands.range, bands.edge),
      ...band(input, 'p10', 'p90', 'outer', bands.outer, bands.edge),
      ...band(input, 'p25', 'p75', 'inner', bands.inner, bands.edge),
      line('median', VCONE.keyMedian, column(input, 'p50'), c.chartS1, false),
      line('latest', fillCopy(VCONE.keyLatest, { asOf: input.asOf }), column(input, 'latest'), c.accent2, true),
    ],
  }
}
