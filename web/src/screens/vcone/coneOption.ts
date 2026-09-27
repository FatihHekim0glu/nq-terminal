// The VCONE chart (TASKS Phase 11, ANALYTICS MV9 over MV3): a volatility cone over the horizons (5 to 252 sessions, a
// category axis so each horizon gets equal room), three bands stacked on their lower bound (min to max,
// 10th to 90th, 25th to 75th percentile), the median line and the latest term structure over them with a
// marker on each horizon. Values are the API's fractions shown in %; nothing is recomputed here. Colours
// come from the chart tokens only; the key under the chart names each mark, so no colour carries meaning alone.
import type { EChartsOption, LineSeriesOption } from '../../charts/echarts/core'
import { toDecimal } from '../../format/decimal'
import { baseOption, isFiniteNumber, niceAxis, textFont, themeXAxis, themeYAxis } from '../../charts/echarts/shared'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../../charts/theme'
import { fillCopy } from '../../copy/workspace'
import { VCONE } from '../../copy/vcone'
import type { VolConeRow } from './types'

export const PCT = 100
const PCT_DECIMALS = 1
const OPACITY = { range: 1, outer: 1, inner: 0.9 } as const

export interface ConeInput {
  readonly name: string
  readonly asOf: string
  /** Horizons (sessions) that have a cone, in order. */
  readonly steps: readonly number[]
  readonly rows: readonly VolConeRow[]
}

type StatKey = 'min' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'max' | 'latest'

const inPct = (v: number | null | undefined): number | null => (isFiniteNumber(v) ? v * PCT : null)
const column = (input: ConeInput, key: StatKey) => input.rows.map((r) => inPct(r[key]))

function band(input: ConeInput, lo: StatKey, hi: StatKey, id: string, fill: string, opacity: number): LineSeriesOption[] {
  const low = column(input, lo)
  const high = column(input, hi)
  const width = low.map((l, i) => (l !== null && high[i] !== null ? high[i]! - l : null))
  const common = { type: 'line' as const, silent: true, showSymbol: false, stack: id, stackStrategy: 'all' as const, lineStyle: { width: 0 } }
  return [
    { ...common, id: `${id}-base`, data: low },
    { ...common, id: `${id}-band`, data: width, areaStyle: { color: fill, opacity } },
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
  return [
    { label: VCONE.keyRange, fill: c.chartArea },
    { label: VCONE.keyOuter, fill: c.barMag },
    { label: VCONE.keyInner, fill: c.chartVol },
    { label: VCONE.keyMedian, fill: c.chartS1 },
    { label: fillCopy(VCONE.keyLatest, { asOf }), fill: c.accent2 },
  ]
}

export function coneOption(input: ConeInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const c = tokens.color
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
      ...band(input, 'min', 'max', 'range', c.chartArea, OPACITY.range),
      ...band(input, 'p10', 'p90', 'outer', c.barMag, OPACITY.outer),
      ...band(input, 'p25', 'p75', 'inner', c.chartVol, OPACITY.inner),
      line('median', VCONE.keyMedian, column(input, 'p50'), c.chartS1, false),
      line('latest', fillCopy(VCONE.keyLatest, { asOf: input.asOf }), column(input, 'latest'), c.accent2, true),
    ],
  }
}
