// PScatter (UI_SPEC 7 MT, 8; look spec 6.3): sorted p-values against rank with the three multiple-
// testing boundaries, Bonferroni (alpha/m, flat), Holm (alpha/(m-k+1), a step) and Benjamini-Hochberg
// (k alpha/m, a straight line), each in its house colour with a text label. Points are white; a point
// that BH does not pass is drawn hollow, so the result is not carried by colour alone. The p axis is
// logarithmic by default because the boundaries sit near zero.
import { P_SCATTER } from '../../copy/echarts'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, echartsPresets, type ChartTokens } from '../theme'
import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from './core'
import { formatP } from './format'
import { baseOption, textFont, themeXAxis, themeYAxis } from './shared'

export interface PPoint {
  readonly label: string
  readonly p: number
}

export interface PScatterInput {
  readonly name: string
  readonly alpha: number
  readonly points: readonly PPoint[]
  readonly scale?: 'log' | 'linear'
}

export interface Passes {
  readonly bonferroni: boolean
  readonly holm: boolean
  readonly bh: boolean
}

export interface TestedPoint extends PPoint {
  readonly rank: number
  readonly bonferroni: number
  readonly holm: number
  readonly bh: number
  readonly passes: Passes
}

const POINT_SIZE = 8
const POINT_BORDER = 1.5
/** Room right of the last rank's half step, in rank units, for the boundary end labels. */
const LABEL_ROOM_SHARE = 0.1
const LABEL_ROOM_MIN = 1
/** Vertical offsets that keep the Holm and BH labels apart where their lines end close together. */
const LABEL_OFFSET = { bonferroni: [4, 0], holm: [4, 8], bh: [4, -8] } as const

function check(points: readonly PPoint[], alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) throw new Error(`alpha must be in (0, 1), got ${alpha}`)
  const bad = points.find((pt) => !(pt.p >= 0 && pt.p <= 1))
  if (bad) throw new Error(`p-value for ${bad.label} must be in [0, 1], got ${bad.p}`)
}

/** Ranks, boundaries and which rules pass each hypothesis (Holm steps down, BH steps up). */
export function multipleTests(points: readonly PPoint[], alpha: number): TestedPoint[] {
  check(points, alpha)
  const m = points.length
  const sorted = [...points].sort((a, b) => a.p - b.p)
  const bounds = sorted.map((pt, i) => {
    const k = i + 1
    return { pt, k, bonferroni: alpha / m, holm: alpha / (m - k + 1), bh: (k * alpha) / m }
  })
  const holmStop = bounds.findIndex((b) => b.pt.p > b.holm)
  const holmPassing = holmStop === -1 ? m : holmStop
  let bhPassing = 0
  bounds.forEach((b) => {
    if (b.pt.p <= b.bh) bhPassing = b.k
  })
  return bounds.map((b) => ({
    label: b.pt.label,
    p: b.pt.p,
    rank: b.k,
    bonferroni: b.bonferroni,
    holm: b.holm,
    bh: b.bh,
    passes: { bonferroni: b.pt.p <= b.bonferroni, holm: b.k <= holmPassing, bh: b.k <= bhPassing },
  }))
}

/**
 * The flat Bonferroni line as a two-point markLine, not a line series: ECharts snaps markLines to a
 * pixel centre, so a 1px line is one row of the full colour instead of two dull half rows.
 */
function bonferroniLine(level: number, from: number, to: number, colour: string, tokens: ChartTokens): LineSeriesOption {
  return {
    id: 'bonferroni',
    type: 'line',
    silent: true,
    data: [],
    markLine: {
      silent: true,
      symbol: ['none', 'none'],
      animation: false,
      label: textFont(tokens),
      data: [[
        {
          coord: [from, level],
          lineStyle: { color: colour, width: CHART_GEOMETRY.lineWidth, type: 'solid' },
          label: { show: true, formatter: P_SCATTER.bonferroni, color: colour, position: 'end', distance: LABEL_OFFSET.bonferroni[0] },
        },
        { coord: [to, level] },
      ]],
    },
  }
}

function boundary(id: 'holm' | 'bh', label: string, colour: string, data: number[][], tokens: ChartTokens): LineSeriesOption {
  return {
    id,
    type: 'line',
    silent: true,
    showSymbol: false,
    data,
    lineStyle: { color: colour, width: CHART_GEOMETRY.lineWidth },
    endLabel: { show: true, ...textFont(tokens), formatter: label, color: colour, offset: [...LABEL_OFFSET[id]] },
    ...(id === 'holm' ? { step: 'middle' as const } : {}),
  }
}

/** A log floor one decade below the smallest value that must show (a value on a decade gets room). */
function logFloor(values: readonly number[]): number {
  const lowest = Math.min(...values.filter((v) => v > 0))
  return 10 ** Math.floor(Math.log10(lowest) - 1e-9)
}

/** The rank axis: ticks and labels on ranks 1 to m only, then room for the boundary end labels. */
function rankAxis(m: number, right: number, tokens: ChartTokens) {
  const x = themeXAxis(tokens)
  const ranks = Array.from({ length: m }, (_, i) => i + 1)
  return {
    ...x,
    type: 'value' as const,
    min: 0,
    max: right + Math.max(LABEL_ROOM_MIN, m * LABEL_ROOM_SHARE),
    interval: 1,
    axisTick: { ...x.axisTick, customValues: ranks },
    axisLabel: {
      ...x.axisLabel,
      ...textFont(tokens),
      customValues: ranks,
      formatter: (v: number) => (Number.isInteger(v) && v >= 1 && v <= m ? String(v) : ''),
    },
  }
}

export function pScatterOption(input: PScatterInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const rows = multipleTests(input.points, input.alpha)
  const m = rows.length
  const c = tokens.color
  const p = echartsPresets(tokens).pScatter
  const left = 0.5
  const right = m + 0.5
  const points: ScatterSeriesOption = {
    id: 'points',
    type: 'scatter',
    silent: true,
    z: 4,
    symbolSize: POINT_SIZE,
    data: rows.map((r) => ({
      value: [r.rank, r.p],
      name: r.label,
      itemStyle: { color: r.passes.bh ? p.point : c.bg, borderColor: p.point, borderWidth: POINT_BORDER },
    })),
  }
  const holm = rows.map((r) => [r.rank, r.holm])
  const series = [
    bonferroniLine(input.alpha / m, left, right, p.bonferroni, tokens),
    boundary('holm', P_SCATTER.holm, p.holm, [[left, rows[0]?.holm ?? input.alpha], ...holm, [right, input.alpha]], tokens),
    boundary('bh', P_SCATTER.bh, p.bh, [[left, (left * input.alpha) / m], [right, (right * input.alpha) / m]], tokens),
    points,
  ]
  const y = themeYAxis(tokens)
  const logAxis = input.scale !== 'linear'
  const floor = logFloor([...rows.map((r) => r.p), input.alpha / m, (left * input.alpha) / m])
  return {
    ...baseOption(tokens),
    grid: { left: 8, right: CHART_GEOMETRY.axisGutter, top: 12, bottom: 28 },
    xAxis: rankAxis(m, right, tokens),
    yAxis: logAxis
      ? { ...y, axisLabel: { ...y.axisLabel, ...textFont(tokens) }, type: 'log', logBase: 10, min: floor, max: 1 }
      : { ...y, axisLabel: { ...y.axisLabel, ...textFont(tokens) }, type: 'value', min: 0, max: 1 },
    series,
  }
}

export function describePScatter(input: PScatterInput): string {
  const rows = multipleTests(input.points, input.alpha)
  if (rows.length === 0) return fillCopy(P_SCATTER.summaryEmpty, { name: input.name })
  const count = (rule: keyof Passes) => rows.filter((r) => r.passes[rule]).length
  return fillCopy(P_SCATTER.summary, {
    name: input.name,
    m: rows.length,
    alpha: String(input.alpha),
    pmin: formatP(rows[0]!.p),
    pminAt: rows[0]!.label,
    bonferroni: count('bonferroni'),
    holm: count('holm'),
    bh: count('bh'),
  })
}

export function pScatterTable(input: PScatterInput): ChartTable {
  const rows = multipleTests(input.points, input.alpha)
  const passed = (r: TestedPoint) => {
    const all: readonly [boolean, string][] = [
      [r.passes.bonferroni, P_SCATTER.bonferroni],
      [r.passes.holm, P_SCATTER.holm],
      [r.passes.bh, P_SCATTER.bh],
    ]
    const names = all.filter(([ok]) => ok).map(([, name]) => name)
    return names.length === 0 ? P_SCATTER.passesNone : names.join(', ')
  }
  return {
    caption: input.name,
    columns: [
      { key: 'rank', label: P_SCATTER.colRank, numeric: true },
      { key: 'label', label: P_SCATTER.colName },
      { key: 'p', label: P_SCATTER.colP, numeric: true },
      { key: 'bonferroni', label: P_SCATTER.colBonferroni, numeric: true },
      { key: 'holm', label: P_SCATTER.colHolm, numeric: true },
      { key: 'bh', label: P_SCATTER.colBh, numeric: true },
      { key: 'passes', label: P_SCATTER.colPasses },
    ],
    rows: rows.map((r) => ({
      rank: r.rank, label: r.label, p: formatP(r.p), bonferroni: formatP(r.bonferroni), holm: formatP(r.holm), bh: formatP(r.bh), passes: passed(r),
    })),
  }
}
