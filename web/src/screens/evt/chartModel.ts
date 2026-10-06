// EVT's chart (ECharts through EchartsFigure): the mean cumulative return path over event time, its pointwise
// band (mean -/+ 1.96 cross-event standard errors) filled and stacked on its lower bound, one picked event's own
// path, the zero line and a dashed line at the event. A key under the chart names each line, so neither the band
// nor a colour carries meaning alone. Values arrive in display units (percent); nothing is computed here.
import type { ChartTable } from '../../charts/ChartA11y'
import type { EChartsOption, LineSeriesOption } from '../../charts/echarts/core'
import { signed, withUnit } from '../../charts/echarts/format'
import { baseOption, forcedLineType, isFiniteNumber, markLine, niceAxis, refLine, textFont, themeXAxis, themeYAxis } from '../../charts/echarts/shared'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../../charts/theme'
import { EVT } from '../../copy/evt'
import { fillCopy } from '../../copy/workspace'

export interface EventPathInput {
  readonly name: string
  readonly label: string
  readonly unit?: string
  readonly decimals?: number
  readonly xName: string
  readonly offsets: readonly number[]
  readonly mean: ReadonlyArray<number | null>
  readonly lower: ReadonlyArray<number | null>
  readonly upper: ReadonlyArray<number | null>
  readonly selected: { readonly label: string; readonly values: ReadonlyArray<number | null> } | null
  /** Complete events behind the mean. */
  readonly n: number
}

export interface EventPathKeyItem {
  readonly label: string
  readonly fill: string
}

const DEFAULT_DECIMALS = 2
const dec = (input: EventPathInput) => input.decimals ?? DEFAULT_DECIMALS
const fmt = (v: number | null | undefined, input: EventPathInput) => (isFiniteNumber(v) ? withUnit(signed(v, dec(input)), input.unit) : '--')

function points(offsets: readonly number[], values: ReadonlyArray<number | null>): Array<[number, number | null]> {
  return offsets.map((k, i) => [k, isFiniteNumber(values[i]) ? values[i]! : null])
}

// U04 (dogfood round): on a small user-picked slice (e.g. 2 FOMC events) this pointwise 1.96 se band
// can read as a significance test, which C7 bans; SEAS's convention is a plain one-SE spread, labelled
// as such (see EVT.band and EVT.caption). Hiding the band below a minimum n, or moving to t(n-1)
// quantiles, would change this function's output for every n the shared EVT fixtures use (n=2 in
// fixtures.ts's makeStudy(), pinned by model.test.ts), so it needs a deliberate decision on that
// fixture (and, if the z itself moves, a backend change plus a qa/crosscheck/p11_evt.py update) rather
// than a silent change here. Tracked in docs/ANALYTICS_CATALOG.md MV8 and left open.
function band(input: EventPathInput, fill: string, edge?: string): LineSeriesOption[] {
  const width = input.offsets.map((_, i) => {
    const lo = input.lower[i]
    const hi = input.upper[i]
    return isFiniteNumber(lo) && isFiniteNumber(hi) ? hi - lo : null
  })
  // Forced colours paint chartArea as Canvas, so the band is outlined at 1px in a system colour instead (as VCONE does).
  const lineStyle = edge === undefined ? { width: 0 } : { width: 1, color: edge }
  const common = { type: 'line' as const, silent: true, showSymbol: false, stack: 'band', stackStrategy: 'all' as const, lineStyle }
  return [
    { ...common, id: 'band-base', data: points(input.offsets, input.lower) },
    { ...common, id: 'band', data: points(input.offsets, width), areaStyle: { color: fill, opacity: 1 } },
  ]
}

function line(id: string, data: Array<[number, number | null]>, colour: string, width: number, dashed = false, cue: { type?: number[] } = {}): LineSeriesOption {
  return { id, type: 'line', silent: true, showSymbol: false, z: 4, data, lineStyle: { color: colour, width, ...(dashed ? { type: [...CHART_GEOMETRY.fenceDash] } : cue) } }
}

export function eventPathKey(input: EventPathInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EventPathKeyItem[] {
  const c = tokens.color
  const key = [
    { label: EVT.mean, fill: c.chartS1 },
    { label: EVT.band, fill: tokens.contrast === 'forced' ? c.chartGrid : c.chartArea },
    { label: EVT.eventLine, fill: c.zeroLine },
  ]
  return input.selected ? [...key, { label: `${EVT.selected} ${input.selected.label}`, fill: c.accent2 }] : key
}

export function eventPathOption(input: EventPathInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const c = tokens.color
  const g = CHART_GEOMETRY
  const values = [...input.mean, ...input.lower, ...input.upper, ...(input.selected?.values ?? []), 0].filter(isFiniteNumber)
  const nice = niceAxis(Math.min(...values), Math.max(...values))
  const x = themeXAxis(tokens)
  const y = themeYAxis(tokens)
  const series: LineSeriesOption[] = [...band(input, c.chartArea, tokens.contrast === 'forced' ? c.chartGrid : undefined), line('mean', points(input.offsets, input.mean), c.chartS1, g.primaryWidth)]
  if (input.selected) series.push(line('selected', points(input.offsets, input.selected.values), c.accent2, g.lineWidth, false, forcedLineType(tokens, 1)))
  const marks = [refLine({ yAxis: 0 }, c.zeroLine, { dashed: false }), refLine({ xAxis: 0 }, c.zeroLine, { label: EVT.eventLine, position: 'end' })]
  series.push({ id: 'marks', type: 'line', silent: true, data: [], markLine: markLine(marks, tokens) })
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: g.axisGutter, top: 16, bottom: 44 },
    xAxis: {
      ...x, type: 'value', min: input.offsets[0] ?? 0, max: input.offsets.at(-1) ?? 1, name: input.xName, nameLocation: 'middle', nameGap: 26,
      nameTextStyle: textFont(tokens), axisLabel: { ...x.axisLabel, ...textFont(tokens) },
    },
    yAxis: {
      ...y, type: 'value', min: nice.min, max: nice.max, interval: nice.interval,
      axisLabel: { ...y.axisLabel, ...textFont(tokens), formatter: (v: number) => withUnit(signed(v, dec(input)), input.unit) },
    },
    series,
  }
}

export function describeEventPath(input: EventPathInput): string {
  const last = input.offsets.length - 1
  if (input.n === 0 || !isFiniteNumber(input.mean[last])) return fillCopy(EVT.summaryEmpty, { name: input.name })
  const text = fillCopy(EVT.summary, {
    name: input.name, n: input.n, first: fmt(input.mean[0], input), from: input.offsets[0] ?? 0, end: fmt(input.mean[last], input),
    to: input.offsets[last] ?? 0, lower: fmt(input.lower[last], input), upper: fmt(input.upper[last], input),
  })
  if (!input.selected) return text
  return text + fillCopy(EVT.summarySelected, { date: input.selected.label, value: fmt(input.selected.values[last], input) })
}

export function eventPathTable(input: EventPathInput): ChartTable {
  const columns = [
    { key: 'offset', label: EVT.colOffset, numeric: true },
    { key: 'mean', label: EVT.colMean, numeric: true },
    { key: 'lower', label: EVT.colLower, numeric: true },
    { key: 'upper', label: EVT.colUpper, numeric: true },
    ...(input.selected ? [{ key: 'selected', label: EVT.colSelected, numeric: true }] : []),
  ]
  const rows = input.offsets.map((k, i) => ({
    offset: String(k),
    mean: fmt(input.mean[i], input),
    lower: fmt(input.lower[i], input),
    upper: fmt(input.upper[i], input),
    ...(input.selected ? { selected: fmt(input.selected.values[i], input) } : {}),
  }))
  return { caption: fillCopy(EVT.caption, { name: input.name }), columns, rows }
}
