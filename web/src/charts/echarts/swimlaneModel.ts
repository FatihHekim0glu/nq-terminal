// Swimlane (UI_SPEC 7 OOS, 8; look spec 6.3 and 7.10; ANALYTICS_CATALOG RI2): the gate access log
// as one lane per caller, each read's data window drawn as a span against the 2022-01-01 fence.
// Lane labels are amber at the left with read counts at the right; reads are white spans; sealed
// reads are taller spans in the marker yellow (shape and colour); the fence is amber and dashed with
// its honesty label, and the time axis always reaches past it.
import { SWIMLANE } from '../../copy/echarts'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { DEFAULT_CHART_TOKENS, echartsPresets, type ChartTokens } from '../theme'
import type { CustomSeriesOption, EChartsOption } from './core'
import { isoDate } from './format'
import { bareAxis, baseOption, fenceLine, FENCE_SECONDS, markLine, nextYearStartMs, textFont, themeXAxis, yearStartMs } from './shared'

export interface SwimlaneRead {
  readonly caller: string
  /** Data window, epoch seconds, [start, end). */
  readonly start: number
  readonly end: number
  readonly sealed?: boolean
}

export interface SwimlaneInput {
  readonly name: string
  readonly reads: readonly SwimlaneRead[]
  /** Lane order; callers not listed follow in order of first appearance. */
  readonly lanes?: readonly string[]
}

export interface LaneStat {
  readonly caller: string
  readonly reads: number
  readonly sealed: number
  readonly start: number
  readonly end: number
}

/** Share of a lane's band a span fills: sealed reads are taller. */
const SPAN_SHARE = { read: 0.5, sealed: 0.8 } as const
const MIN_SPAN_PX = 1
const LABEL_CHAR_PX = 7.5
const LABEL_PAD_PX = 16
const COUNT_GUTTER = 48

export function laneStats(input: SwimlaneInput): LaneStat[] {
  const byCaller = new Map<string, { reads: number; sealed: number; start: number; end: number }>()
  for (const caller of input.lanes ?? []) byCaller.set(caller, { reads: 0, sealed: 0, start: Infinity, end: -Infinity })
  for (const r of input.reads) {
    if (!(r.end >= r.start)) throw new Error(`read by ${r.caller}: the window ends before it starts`)
    const lane = byCaller.get(r.caller) ?? { reads: 0, sealed: 0, start: Infinity, end: -Infinity }
    byCaller.set(r.caller, {
      reads: lane.reads + 1,
      sealed: lane.sealed + (r.sealed ? 1 : 0),
      start: Math.min(lane.start, r.start),
      end: Math.max(lane.end, r.end),
    })
  }
  return [...byCaller.entries()].map(([caller, s]) => ({ caller, ...s }))
}

type SpanItem = readonly [startMs: number, endMs: number, lane: number, sealed: 0 | 1]

function spanSeries(items: readonly SpanItem[], tokens: ChartTokens): CustomSeriesOption {
  const colours = echartsPresets(tokens).swimlane
  return {
    id: 'reads',
    type: 'custom',
    silent: true,
    clip: true,
    encode: { x: [0, 1], y: 2 },
    data: items.map((i) => [...i]),
    renderItem: (params, api) => {
      const [start, end, lane, sealed] = items[params.dataIndex]!
      const from = api.coord([start, lane])
      const to = api.coord([end, lane])
      const band = (api.size?.([0, 1]) as number[] | undefined)?.[1] ?? 0
      // Whole-pixel edges, so a span has no blended fringe.
      const height = Math.round(band * (sealed ? SPAN_SHARE.sealed : SPAN_SHARE.read))
      const x = Math.round(from[0]!)
      const y = Math.round(from[1]! - height / 2)
      return {
        type: 'rect',
        z2: sealed ? 2 : 1,
        shape: { x, y, width: Math.max(MIN_SPAN_PX, Math.round(to[0]!) - x), height },
        style: { fill: sealed ? colours.sealed : tokens.color.chartS1 },
      }
    },
    // The lane axis is inverted, so the fence runs top down and its label belongs at the start.
    markLine: markLine([fenceLine(tokens, 'start')], tokens),
  }
}

export function swimlaneOption(input: SwimlaneInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const lanes = laneStats(input)
  const index = new Map(lanes.map((l, i) => [l.caller, i]))
  const items: SpanItem[] = input.reads.map((r) => [r.start * 1000, r.end * 1000, index.get(r.caller)!, r.sealed ? 1 : 0])
  const first = Math.min(...input.reads.map((r) => r.start), FENCE_SECONDS)
  const last = Math.max(...input.reads.map((r) => r.end), FENCE_SECONDS)
  const x = themeXAxis(tokens)
  const labelWidth = Math.round(lanes.reduce((n, l) => Math.max(n, l.caller.length), 0) * LABEL_CHAR_PX + LABEL_PAD_PX)
  const laneAxis = { type: 'category' as const, inverse: true, ...bareAxis() }
  return {
    ...baseOption(tokens),
    grid: { left: labelWidth, right: COUNT_GUTTER, top: 24, bottom: 28 },
    xAxis: {
      ...x,
      type: 'time',
      min: yearStartMs(first),
      max: nextYearStartMs(last),
      axisLabel: { ...x.axisLabel, ...textFont(tokens), formatter: '{yyyy}' },
    },
    yAxis: [
      { ...laneAxis, position: 'left', data: lanes.map((l) => l.caller), axisLabel: { ...textFont(tokens), color: echartsPresets(tokens).swimlane.label, interval: 0 } },
      { ...laneAxis, position: 'right', data: lanes.map((l) => String(l.reads)), axisLabel: { ...textFont(tokens), color: tokens.color.text, interval: 0 } },
    ],
    series: [spanSeries(items, tokens)],
  }
}

export function describeSwimlane(input: SwimlaneInput): string {
  if (input.reads.length === 0) return fillCopy(SWIMLANE.summaryEmpty, { name: input.name })
  const lanes = laneStats(input).filter((l) => l.reads > 0)
  return fillCopy(SWIMLANE.summary, {
    name: input.name,
    count: input.reads.length,
    lanes: lanes.length,
    start: isoDate(Math.min(...lanes.map((l) => l.start))),
    end: isoDate(Math.max(...lanes.map((l) => l.end))),
    sealed: input.reads.filter((r) => r.sealed).length,
  })
}

export function swimlaneTable(input: SwimlaneInput): ChartTable {
  return {
    caption: fillCopy(SWIMLANE.caption, { name: input.name }),
    columns: [
      { key: 'caller', label: SWIMLANE.colCaller },
      { key: 'reads', label: SWIMLANE.colReads, numeric: true },
      { key: 'sealed', label: SWIMLANE.colSealed, numeric: true },
      { key: 'start', label: SWIMLANE.colStart },
      { key: 'end', label: SWIMLANE.colEnd },
    ],
    rows: laneStats(input).map((l) => ({
      caller: l.caller,
      reads: l.reads,
      sealed: l.sealed,
      start: l.reads > 0 ? isoDate(l.start) : '',
      end: l.reads > 0 ? isoDate(l.end) : '',
    })),
  }
}
