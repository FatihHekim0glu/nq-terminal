// Heatmap (UI_SPEC 8; look spec 6.3, 7.5 MRET, 7.7 MON, 7.8 CORR): a grid of cells on two category
// axes, each filled from the heat scales in src/charts/theme/scales.ts and printed with its signed
// value in the text colour the scale chose. Three scales: MRET (the SEAG ramp, months across and years
// down with the N-year average first), CORR (the MOVERS steps, grey diagonal, amber row headers) and
// MON (four steps with a threshold per column). Pure functions only; Heatmap.tsx draws the result.
import { fillCopy } from '../../copy/workspace'
import { HEATMAP } from '../../copy/echarts'
import type { ChartTable } from '../ChartA11y'
import { corrHeat, DEFAULT_CHART_TOKENS, monHeat, seagHeat, type ChartTokens, type HeatCell } from '../theme'
import type { CustomSeriesOption, EChartsOption } from './core'
import { signed, withUnit } from './format'
import { bareAxis, baseOption, isFiniteNumber, textFont, type PlotRect } from './shared'

export type HeatKind = 'mret' | 'corr' | 'mon'

export interface HeatmapInput {
  readonly kind: HeatKind
  /** Names the chart in its summary and table caption. */
  readonly name: string
  readonly columns: readonly string[]
  /** Row labels, top to bottom. */
  readonly rows: readonly string[]
  /** values[row][column]; null for a blank cell (a month not reached, or behind the fence). */
  readonly values: ReadonlyArray<ReadonlyArray<number | null>>
  /** Appended to values in the summary: '%' gives -4.00%. */
  readonly unit?: string
  readonly decimals?: number
  /** MON only: the strong step starts at this |value|, one threshold per column. */
  readonly strongAt?: readonly number[]
}

export interface HeatCellView {
  readonly row: number
  readonly col: number
  readonly value: number | null
  readonly fill: string
  readonly text: string
  readonly label: string
}

const DEFAULT_DECIMALS = 2
/** 2px black gutters between cells: each cell is inset 1px from its band edge on every side. */
const GUTTER = 2
const MRET_LABEL_WIDTH = 70
const LABEL_CHAR_PX = 7.5
const LABEL_PAD_PX = 20
const LABEL_MIN_PX = 48
const LABEL_MAX_PX = 220

function checkShape(input: HeatmapInput): void {
  if (input.values.length !== input.rows.length || input.values.some((r) => r.length !== input.columns.length)) {
    throw new Error(`${input.name}: values must be ${input.rows.length} rows of ${input.columns.length} columns`)
  }
}

function isDiagonal(input: HeatmapInput, row: number, col: number): boolean {
  return input.kind === 'corr' && input.rows[row] === input.columns[col]
}

function maxAbs(input: HeatmapInput): number {
  let max = 0
  for (const r of input.values) for (const v of r) if (isFiniteNumber(v)) max = Math.max(max, Math.abs(v))
  return max
}

function scaleCell(input: HeatmapInput, row: number, col: number, v: number | null, ramp: number, tokens: ChartTokens): HeatCell {
  if (input.kind === 'mret') return seagHeat(v, ramp, tokens)
  if (input.kind === 'corr') return corrHeat(v, { diagonal: isDiagonal(input, row, col) }, tokens)
  const strongAt = input.strongAt?.[col] ?? Infinity
  return monHeat(v, strongAt, tokens)
}

/** Every cell with its fill, text colour and printed label, row by row. */
export function heatmapCells(input: HeatmapInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): HeatCellView[] {
  checkShape(input)
  const ramp = maxAbs(input)
  const decimals = input.decimals ?? DEFAULT_DECIMALS
  return input.values.flatMap((r, row) =>
    r.map((raw, col) => {
      const value = isFiniteNumber(raw) ? raw : null
      const { fill, text } = scaleCell(input, row, col, value, ramp, tokens)
      return { row, col, value, fill, text, label: value === null ? '' : signed(value, decimals) }
    }),
  )
}

/** MRET rows from the API's monthly block: the N-year average first, then the years descending. */
export function mretRows(monthly: {
  readonly years: readonly number[]
  readonly grid: ReadonlyArray<ReadonlyArray<number | null>>
}): { rows: string[]; values: (number | null)[][] } {
  const width = monthly.grid[0]?.length ?? 0
  const average = Array.from({ length: width }, (_, m) => {
    const vals = monthly.grid.map((r) => r[m]).filter(isFiniteNumber)
    return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length
  })
  const order = monthly.years.map((y, i) => ({ y, i })).sort((a, b) => b.y - a.y)
  return {
    rows: [fillCopy(HEATMAP.averageRow, { n: monthly.years.length }), ...order.map((o) => String(o.y))],
    values: [average, ...order.map((o) => [...(monthly.grid[o.i] ?? [])])],
  }
}

function rowLabelWidth(input: HeatmapInput): number {
  if (input.kind === 'mret') return MRET_LABEL_WIDTH
  const longest = input.rows.reduce((n, r) => Math.max(n, r.length), 0)
  return Math.round(Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, longest * LABEL_CHAR_PX + LABEL_PAD_PX)))
}

/** Row labels: white years (MRET), amber names (MON), amber-filled symbols with black text (CORR). */
function rowLabel(input: HeatmapInput, tokens: ChartTokens) {
  const c = tokens.color
  const common = { ...textFont(tokens), interval: 0, align: 'right' as const, margin: 8 }
  if (input.kind === 'corr') return { ...common, color: c.bg, backgroundColor: c.data, padding: [1, 4], margin: 6 }
  return { ...common, color: input.kind === 'mret' ? c.white : c.data }
}

/**
 * The cells as a custom series rather than ECharts' heatmap, which draws each cell half a pixel over
 * its band with a centred border, so gutters blend into the fills. Here every cell edge is the band
 * edge rounded to a whole pixel and inset by half the gutter, so each gutter is exactly GUTTER px of
 * the page colour at any size.
 */
function cellSeries(input: HeatmapInput, cells: readonly HeatCellView[], tokens: ChartTokens): CustomSeriesOption {
  const font = textFont(tokens)
  const inset = GUTTER / 2
  const rows = input.rows.length
  const cols = input.columns.length
  return {
    id: 'cells',
    type: 'custom',
    silent: true,
    encode: { x: 0, y: 1 },
    data: cells.map((cell) => [cell.col, cell.row]),
    renderItem: (params) => {
      const cell = cells[params.dataIndex]!
      const plot = params.coordSys as unknown as PlotRect
      const colEdge = (i: number) => Math.round(plot.x + (plot.width * i) / cols)
      const rowEdge = (i: number) => Math.round(plot.y + (plot.height * i) / rows)
      const [x0, x1] = [colEdge(cell.col), colEdge(cell.col + 1)]
      const [y0, y1] = [rowEdge(cell.row), rowEdge(cell.row + 1)]
      const rect = { x: x0 + inset, y: y0 + inset, width: Math.max(0, x1 - x0 - GUTTER), height: Math.max(0, y1 - y0 - GUTTER) }
      const children: CustomElement[] = [{ type: 'rect', shape: rect, style: { fill: cell.fill } }]
      if (cell.label !== '') {
        children.push({
          type: 'text',
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          style: { text: cell.label, fill: cell.text, align: 'center', verticalAlign: 'middle', font: `${font.fontSize}px ${font.fontFamily}` },
        })
      }
      return { type: 'group', children }
    },
  }
}

type CustomElement =
  | { type: 'rect'; shape: { x: number; y: number; width: number; height: number }; style: { fill: string } }
  | {
      type: 'text'
      x: number
      y: number
      style: { text: string; fill: string; align: 'center'; verticalAlign: 'middle'; font: string }
    }

export function heatmapOption(input: HeatmapInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const cells = heatmapCells(input, tokens)
  const c = tokens.color
  const series = cellSeries(input, cells, tokens)
  return {
    ...baseOption(tokens),
    grid: { left: rowLabelWidth(input), right: 8, top: 22, bottom: 2 },
    xAxis: {
      type: 'category',
      position: 'top',
      data: [...input.columns],
      ...bareAxis(),
      axisLabel: { ...textFont(tokens), color: c.white, interval: 0, margin: 6 },
    },
    yAxis: { type: 'category', inverse: true, data: [...input.rows], ...bareAxis(), axisLabel: rowLabel(input, tokens) },
    series: [series],
  }
}

export type HeatScale =
  | { readonly kind: 'steps'; readonly steps: readonly { readonly fill: string; readonly label: string }[]; readonly low?: string; readonly high?: string }
  | { readonly kind: 'ramp'; readonly stops: readonly { readonly at: number; readonly fill: string }[]; readonly low: string; readonly high: string }
  | { readonly kind: 'none' }

function extremes(input: HeatmapInput): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  input.values.forEach((r) => r.forEach((v) => {
    if (!isFiniteNumber(v)) return
    min = Math.min(min, v)
    max = Math.max(max, v)
  }))
  return min === Infinity ? null : { min, max }
}

function mretRamp(input: HeatmapInput, tokens: ChartTokens): HeatScale {
  const e = extremes(input)
  if (e === null) return { kind: 'none' }
  const ramp = Math.max(Math.abs(e.min), Math.abs(e.max))
  const fill = (v: number) => seagHeat(v, ramp, tokens).fill
  const span = e.max - e.min
  const zeroAt = span > 0 ? -e.min / span : 0
  const stops = e.min < 0 && e.max >= 0
    ? [
        { at: 0, fill: fill(e.min) },
        { at: zeroAt, fill: tokens.color.seagDnFloor },
        { at: zeroAt, fill: fill(0) },
        { at: 1, fill: fill(e.max) },
      ]
    : [{ at: 0, fill: fill(e.min) }, { at: 1, fill: fill(e.max) }]
  const decimals = input.decimals ?? DEFAULT_DECIMALS
  return { kind: 'ramp', stops, low: signed(e.min, decimals), high: signed(e.max, decimals) }
}

/** The legend under the grid: CORR and MON steps, or the MRET ramp from min to max. */
export function heatScale(input: HeatmapInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): HeatScale {
  const c = tokens.color
  if (input.kind === 'mret') return mretRamp(input, tokens)
  if (input.kind === 'corr') {
    const fills = [c.corrDn2, c.corrDn1, c.corr0, c.corrUp1, c.corrUp2]
    return { kind: 'steps', steps: fills.map((fill, i) => ({ fill, label: HEATMAP.corrScale[i]! })), ...HEATMAP.corrEnds }
  }
  const fills = [c.heatDn2, c.heatDn1, c.heatUp1, c.heatUp2]
  return { kind: 'steps', steps: fills.map((fill, i) => ({ fill, label: HEATMAP.monScale[i]! })) }
}

interface Extreme {
  readonly value: number
  readonly at: string
}

function extremeCells(input: HeatmapInput): { min: Extreme; max: Extreme; blank: number } | null {
  let min: Extreme | null = null
  let max: Extreme | null = null
  let blank = 0
  input.values.forEach((r, row) => r.forEach((v, col) => {
    if (!isFiniteNumber(v)) {
      blank += 1
      return
    }
    if (isDiagonal(input, row, col)) return
    const at = fillCopy(HEATMAP.at, { row: input.rows[row] ?? '', column: input.columns[col] ?? '' })
    if (min === null || v < min.value) min = { value: v, at }
    if (max === null || v > max.value) max = { value: v, at }
  }))
  return min === null || max === null ? null : { min, max, blank }
}

/** The accessible name: size, the lowest and highest cells (CORR diagonal left out) and the blanks. */
export function describeHeatmap(input: HeatmapInput): string {
  const size = { name: input.name, rows: input.rows.length, columns: input.columns.length }
  const e = extremeCells(input)
  if (e === null) return fillCopy(HEATMAP.summaryEmpty, size)
  const d = input.decimals ?? DEFAULT_DECIMALS
  const fmt = (v: number) => withUnit(signed(v, d), input.unit)
  return fillCopy(HEATMAP.summary, { ...size, min: fmt(e.min.value), minAt: e.min.at, max: fmt(e.max.value), maxAt: e.max.at, blank: e.blank })
}

/** The same numbers as a table: one row per heatmap row, blank cells empty. */
export function heatmapTable(input: HeatmapInput): ChartTable {
  checkShape(input)
  const d = input.decimals ?? DEFAULT_DECIMALS
  const columns = [
    { key: 'row', label: HEATMAP.rowHeader[input.kind] },
    ...input.columns.map((label, i) => ({ key: `c${i}`, label, numeric: true })),
  ]
  const rows = input.values.map((r, i) => ({
    row: input.rows[i] ?? '',
    ...Object.fromEntries(r.map((v, j) => [`c${j}`, isFiniteNumber(v) ? signed(v, d) : ''])),
  }))
  return { caption: input.name, columns, rows }
}
