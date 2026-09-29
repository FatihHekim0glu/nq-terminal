// Book composition (roadmap #13, ANALYTICS_CATALOG EX1 by instrument): what the book held in each
// instrument at each shown session, as a heat grid (brightness by value, hue by sector) or as areas
// stacked per instrument and coloured by sector, with the API's own Gross and Net lines over them.
// Every value is the API's, at the sessions the screen chose to show; nothing is summed, averaged or
// signed here. ECharts stacks the areas and scales the value axis itself, so no stacked total exists in
// this file or on the page. The grid is a custom series of whole-pixel rectangles (no cell text: the
// table view carries the numbers), like the heatmap's, so no new ECharts registration is needed.
// Pure functions only; Composition.tsx draws the result. Colours come from ChartTokens alone.
import { COMPOSITION } from '../../copy/composition'
import { fillCopy } from '../../copy/workspace'
import type { ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, interpolateHex, type ChartColorKey, type ChartTokens } from '../theme'
import type { CustomSeriesOption, EChartsOption, LineSeriesOption } from './core'
import { fixed, signed } from './format'
import { bareAxis, baseOption, isFiniteNumber, markLine, refLine, textFont, themeXAxis, themeYAxis, type PlotRect } from './shared'

export type CompositionMode = 'heat' | 'stack'

/** The chart token a sector is drawn in. */
export type SectorTone = Extract<
  ChartColorKey,
  'secEquity' | 'secRates' | 'secFx' | 'secEnergy' | 'secMetals' | 'secGrains' | 'secLivestock' | 'chartVol'
>

/** Sectors the index does not name, or names outside the house sequence, are drawn in the slate. */
const OTHER_TONE: SectorTone = 'chartVol'

const SECTOR_TONES: ReadonlyMap<string, SectorTone> = new Map<string, SectorTone>([
  ['equity', 'secEquity'],
  ['rates', 'secRates'],
  ['fx', 'secFx'],
  ['energy', 'secEnergy'],
  ['metals', 'secMetals'],
  ['grains', 'secGrains'],
  ['livestock', 'secLivestock'],
])

export function toneOfSector(sector: string): SectorTone {
  return SECTOR_TONES.get(sector) ?? OTHER_TONE
}

/** A heading row: draws no cell. */
export interface CompositionInputBand {
  readonly kind: 'band'
  readonly label: string
  readonly tone: SectorTone
}

export interface CompositionInputInstrument {
  readonly kind: 'instrument'
  readonly label: string
  /** The sector's title, for the table's Sector column. */
  readonly sector: string
  readonly tone: SectorTone
  /** One value per column, as the API sent it: |notional| / equity, or null. */
  readonly values: ReadonlyArray<number | null>
}

export type CompositionInputRow = CompositionInputBand | CompositionInputInstrument

export interface CompositionInput {
  /** Names the chart in its summary and table caption. */
  readonly name: string
  readonly unit: string
  readonly decimals: number
  /** Session dates (YYYY-MM-DD), one per shown column. */
  readonly columns: readonly string[]
  /** Top to bottom: each sector's band, then its instruments. */
  readonly rows: readonly CompositionInputRow[]
  /** The API's gross and net series at the shown columns. */
  readonly gross: ReadonlyArray<number | null>
  readonly net: ReadonlyArray<number | null>
  /** The sampling sentence: which sessions the columns are. */
  readonly note: string
}

export interface CompositionCell {
  readonly row: number
  readonly col: number
  readonly value: number | null
  readonly fill: string
}

export interface CompositionKeyItem {
  readonly label: string
  readonly fill: string
}

/** Brightness runs from this share of the sector colour (a small value) to all of it (the largest). */
const BRIGHTNESS_FLOOR = 0.25
/** Gap under each row of cells, and between columns while there are few enough for a gap to show. */
const ROW_GUTTER = 1
const COLUMN_GUTTER = 1
const NO_COLUMN_GUTTER_ABOVE = 60
const LABEL_ROW = 22
const LABEL_CHAR_PX = 7.5
const LABEL_PAD_PX = 20
const LABEL_MIN_PX = 48
const LABEL_MAX_PX = 220
const STACK_ID = 'book'

function checkShape(input: CompositionInput): void {
  const n = input.columns.length
  if (input.rows.some((r) => r.kind === 'instrument' && r.values.length !== n)) {
    throw new Error(`${input.name}: values must be ${n} columns per instrument`)
  }
  if (input.gross.length !== n) throw new Error(`${input.name}: gross must be ${n} columns`)
  if (input.net.length !== n) throw new Error(`${input.name}: net must be ${n} columns`)
}

function instrumentsOf(input: CompositionInput): CompositionInputInstrument[] {
  return input.rows.filter((r): r is CompositionInputInstrument => r.kind === 'instrument')
}

/** The largest served instrument value (its size; the API sends these unsigned). 0 when none is held. */
export function compositionMax(input: CompositionInput): number {
  let max = 0
  for (const row of instrumentsOf(input)) for (const v of row.values) if (isFiniteNumber(v)) max = Math.max(max, Math.abs(v))
  return max
}

function cellFill(value: number | null, tone: SectorTone, max: number, tokens: ChartTokens): string {
  const c = tokens.color
  if (value === null || value === 0 || !(max > 0)) return c.bg
  return interpolateHex(c.bg, c[tone], BRIGHTNESS_FLOOR + ((1 - BRIGHTNESS_FLOOR) * Math.abs(value)) / max)
}

/** The grid's cells, instrument by instrument (a band row has none); zero and missing take the page colour. */
export function compositionCells(input: CompositionInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): CompositionCell[] {
  checkShape(input)
  const max = compositionMax(input)
  return input.rows.flatMap((row, r) =>
    row.kind === 'band'
      ? []
      : row.values.map((raw, col) => {
          const value = isFiniteNumber(raw) ? raw : null
          return { row: r, col, value, fill: cellFill(value, row.tone, max, tokens) }
        }),
  )
}

/** `YYYY` at the first shown column of each year, an empty text at every other column. */
export function yearLabels(columns: readonly string[]): string[] {
  let previous = ''
  return columns.map((column) => {
    const year = /^\d{4}/.exec(column)?.[0] ?? ''
    const label = year !== '' && year !== previous ? year : ''
    if (year !== '') previous = year
    return label
  })
}

function rowLabelWidth(input: CompositionInput): number {
  const longest = input.rows.reduce((n, r) => Math.max(n, r.label.length), 0)
  return Math.round(Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, longest * LABEL_CHAR_PX + LABEL_PAD_PX)))
}

/**
 * The cells as whole-pixel rectangles: every edge is the band edge rounded to a pixel, then the gutter
 * is taken off the right and bottom, so the gaps are exactly 1px of the page colour at any size.
 */
function cellSeries(input: CompositionInput, cells: readonly CompositionCell[]): CustomSeriesOption {
  const rows = input.rows.length
  const cols = input.columns.length
  const columnGutter = cols > NO_COLUMN_GUTTER_ABOVE ? 0 : COLUMN_GUTTER
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
      return {
        type: 'rect',
        shape: { x: x0, y: y0, width: Math.max(0, x1 - x0 - columnGutter), height: Math.max(0, y1 - y0 - ROW_GUTTER) },
        style: { fill: cell.fill },
      }
    },
  }
}

/** The heat grid: instruments down, sessions across; brightness is the value, hue the sector. */
export function compositionHeatOption(input: CompositionInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  const cells = compositionCells(input, tokens)
  const c = tokens.color
  const years = yearLabels(input.columns)
  return {
    ...baseOption(tokens),
    grid: { left: rowLabelWidth(input), right: 8, top: LABEL_ROW, bottom: 2 },
    xAxis: {
      type: 'category',
      position: 'top',
      data: [...input.columns],
      ...bareAxis(),
      axisLabel: { ...textFont(tokens), color: c.white, interval: 0, margin: 6, formatter: (_value: string, index: number) => years[index] ?? '' },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: input.rows.map((r) => r.label),
      ...bareAxis(),
      axisLabel: {
        ...textFont(tokens),
        interval: 0,
        align: 'right',
        margin: 8,
        color: (_value?: string | number, index?: number) => {
          const row = input.rows[index ?? -1]
          return row?.kind === 'band' ? c[row.tone] : c.white
        },
      },
    },
    series: [cellSeries(input, cells)],
  }
}

function pathLine(id: string, name: string, data: ReadonlyArray<number | null>, colour: string): LineSeriesOption {
  return {
    id,
    name,
    type: 'line',
    silent: true,
    showSymbol: false,
    z: 4,
    data: [...data],
    lineStyle: { color: colour, width: CHART_GEOMETRY.primaryWidth },
  }
}

/**
 * The stacked areas: one per instrument in its sector colour, no outline, then the API's Gross and Net
 * (not stacked). The value axis is left to ECharts, which knows the stack; no total is printed.
 */
export function compositionStackOption(input: CompositionInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  checkShape(input)
  const c = tokens.color
  const years = yearLabels(input.columns)
  const x = themeXAxis(tokens)
  const y = themeYAxis(tokens)
  const areas = input.rows.flatMap((row, i): LineSeriesOption[] =>
    row.kind === 'band'
      ? []
      : [
          {
            id: `stack-${i}`,
            name: row.label,
            type: 'line',
            silent: true,
            showSymbol: false,
            stack: STACK_ID,
            // The served values are unsigned, so 'samesign' stacks them the same way and skips a missing value.
            stackStrategy: 'samesign',
            lineStyle: { width: 0 },
            areaStyle: { color: c[row.tone], opacity: 1 },
            data: [...row.values],
          },
        ],
  )
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: CHART_GEOMETRY.axisGutter, top: 16, bottom: 28 },
    xAxis: {
      ...x,
      type: 'category',
      data: [...input.columns],
      boundaryGap: false,
      axisTick: { ...x.axisTick, interval: (index: number) => (years[index] ?? '') !== '' },
      axisLabel: { ...x.axisLabel, ...textFont(tokens), interval: 0, formatter: (_value: string, index: number) => years[index] ?? '' },
    },
    yAxis: {
      ...y,
      type: 'value',
      axisLabel: { ...y.axisLabel, ...textFont(tokens), formatter: (v: number) => fixed(v, input.decimals) },
    },
    series: [
      ...areas,
      pathLine('gross', COMPOSITION.gross, input.gross, c.chartS1),
      pathLine('net', COMPOSITION.net, input.net, c.accent2),
      { id: 'zero', type: 'line', silent: true, data: [], markLine: markLine([refLine({ yAxis: 0 }, c.zeroLine, { dashed: false })], tokens) },
    ],
  }
}

/**
 * The accessible name: how many instruments, sectors and columns, and which sessions the columns are.
 * The summary is the same in both views (the chart name in the input already says which); `mode` keeps
 * the call symmetrical with the option builders.
 */
export function describeComposition(input: CompositionInput, _mode: CompositionMode): string {
  const instruments = instrumentsOf(input).length
  const sectors = input.rows.filter((r) => r.kind === 'band').length
  const columns = input.columns.length
  return fillCopy(COMPOSITION.summary, {
    name: input.name,
    instruments,
    instrumentWord: instruments === 1 ? COMPOSITION.instrument : COMPOSITION.instruments,
    sectors,
    sectorWord: sectors === 1 ? COMPOSITION.sector : COMPOSITION.sectors,
    columns,
    columnWord: columns === 1 ? COMPOSITION.column : COMPOSITION.columns,
    sampling: input.note,
  })
}

/** Each instrument with its sector at each shown session, then the API's Gross and Net; blanks empty. */
export function compositionTable(input: CompositionInput): ChartTable {
  checkShape(input)
  const d = input.decimals
  const line = (values: ReadonlyArray<number | null>, format: (v: number) => string) =>
    Object.fromEntries(values.map((v, i) => [`c${i}`, isFiniteNumber(v) ? format(v) : '']))
  return {
    caption: fillCopy(COMPOSITION.tableCaption, { name: input.name }),
    columns: [
      { key: 'instrument', label: COMPOSITION.colInstrument, rowHeader: true },
      { key: 'sector', label: COMPOSITION.colSector },
      ...input.columns.map((label, i) => ({ key: `c${i}`, label, numeric: true })),
    ],
    rows: [
      ...instrumentsOf(input).map((row) => ({ instrument: row.label, sector: row.sector, ...line(row.values, (v) => fixed(v, d)) })),
      { instrument: COMPOSITION.gross, sector: '', ...line(input.gross, (v) => fixed(v, d)) },
      { instrument: COMPOSITION.net, sector: '', ...line(input.net, (v) => signed(v, d)) },
    ],
  }
}

/** The key under the chart: each sector present in its colour, and the two API lines in the stack view. */
export function compositionKey(input: CompositionInput, mode: CompositionMode, tokens: ChartTokens = DEFAULT_CHART_TOKENS): CompositionKeyItem[] {
  const c = tokens.color
  const sectors = input.rows.flatMap((r): CompositionKeyItem[] => (r.kind === 'band' ? [{ label: r.label, fill: c[r.tone] }] : []))
  if (mode === 'heat') return sectors
  return [...sectors, { label: COMPOSITION.gross, fill: c.chartS1 }, { label: COMPOSITION.net, fill: c.accent2 }]
}

/** What brightness means in the heat view, up to the largest served value; null when nothing is held. */
export function compositionScaleNote(input: CompositionInput): string | null {
  const max = compositionMax(input)
  return max > 0 ? fillCopy(COMPOSITION.scale, { max: fixed(max, input.decimals), unit: input.unit }) : null
}
