// DQ universe model (research_ux item 3): the matrix of roots by years, as plain rows of cells, the screen-reader
// text of each cell, the keyboard step over the grid and the CSV. Pure functions; UniverseMatrix draws the result.
// The response types are written out here and mirror Schemas['DqUniverse'] of the generated contract (GET /api/dq/universe);
// the generated types are assignable to these, which tsc checks where useDqUniverse feeds the matrix.
import { toCsv } from '../../chrome/exportCsv'
import { DQ } from '../../copy/dq'
import { fillCopy } from '../../copy/workspace'

export type UniverseVariant = 'vendor' | 'repaired'
export type RepairStatus = 'nq' | 'v1' | 'v2' | 'vendor_only' | 'not_assessed'

export interface UniverseCounts {
  readonly sessions: number
  readonly usable: number
  readonly gated_out: number
  readonly unrepairable: number
  readonly rejected: number
  readonly usable_share: number | null
}
export interface UniverseCell extends UniverseCounts { readonly year: number }
export interface UniverseRow {
  readonly timeframe: '1m'
  readonly variant: UniverseVariant
  readonly cells: readonly UniverseCell[]
  readonly total: UniverseCounts
}
export interface UniverseDaily {
  readonly source: string
  readonly rows: number | null
  readonly first_bar: string | null
  readonly last_bar: string | null
  readonly last_sealed: boolean
  readonly missing_nyse_sessions: number | null
}
export interface UniverseRoot {
  readonly root: string
  readonly symbol: string
  readonly repair_status: RepairStatus
  readonly source: string
  readonly qa_source: string | null
  readonly first_bar: string | null
  readonly last_bar: string | null
  readonly last_sealed: boolean
  readonly rows: readonly UniverseRow[]
  readonly daily: UniverseDaily | null
  readonly blocks: readonly string[]
}
export interface DqUniverse {
  readonly label: string
  readonly fence: string
  readonly years: readonly number[]
  readonly roots: readonly UniverseRoot[]
  readonly missing: readonly string[]
}

/** How a cell is drawn: a row header, plain text, a year's usable share (with its bar), or free words. */
export type CellKind = 'root' | 'text' | 'share' | 'words'

export interface MatrixCell {
  readonly kind: CellKind
  /** What is printed. */
  readonly text: string
  /** What the readout and a screen reader say for the cell. */
  readonly description: string
  /** 0 to 1, for the bar under a share; null when the cell has no bar. */
  readonly share: number | null
}

export interface MatrixRow {
  readonly id: string
  readonly cells: readonly MatrixCell[]
}

const TENTH = 1000
const EPSILON = 1e-9

/** The share as a percentage with one decimal, cut down and never rounded up, so 99.96% never reads 100.0%. */
export function percentText(share: number): string {
  return (Math.floor(share * TENTH + EPSILON) / (TENTH / 100)).toFixed(1)
}

const DATE_START = /^\d{4}-\d{2}-\d{2}/

/** A bar date for display: a date up to the fence stays, anything later (or a bar the API flags as sealed) is only
 *  ever the sealed text, so a date past the fence can never reach the screen. */
export function barText(value: string | null, fence: string, sealed: boolean): string | null {
  if (value === null) return null
  const date = DATE_START.exec(value)?.[0]
  return sealed || (date !== undefined && date > fence) ? DQ.universe.sealedLast : value
}

/** The grid years that end on or before the fence. */
export function visibleYears(universe: DqUniverse): readonly number[] {
  const fenceYear = Number(universe.fence.slice(0, 4))
  return universe.years.filter((y) => y <= fenceYear)
}

const text = (value: string, description: string = value, kind: CellKind = 'text'): MatrixCell => ({ kind, text: value, description, share: null })

function countsFields(root: string, series: string, counts: UniverseCounts): Record<string, string | number> {
  const pct = counts.usable_share === null ? DQ.universe.none : percentText(counts.usable_share)
  return {
    root, series, pct, usable: counts.usable.toLocaleString('en-GB'), sessions: counts.sessions.toLocaleString('en-GB'),
    gated: counts.gated_out, unrep: counts.unrepairable, rej: counts.rejected,
  }
}

function shareCell(root: string, series: string, year: number | null, counts: UniverseCounts): MatrixCell {
  const base = countsFields(root, series, counts)
  const fields = { ...base, year: year ?? '' }
  if (counts.sessions === 0 || counts.usable_share === null) {
    return { kind: 'share', text: DQ.universe.none, description: fillCopy(DQ.universe.cellEmpty, fields), share: null }
  }
  const template = year === null ? DQ.universe.total : DQ.universe.cell
  return { kind: 'share', text: fillCopy(DQ.universe.pct, { pct: base['pct'] ?? '' }), description: fillCopy(template, fields), share: counts.usable_share }
}

function bound(root: string, series: string, column: string, value: string | null): MatrixCell {
  const shown = value ?? DQ.universe.none
  return text(shown, fillCopy(DQ.universe.field, { root, series, column, value: value ?? DQ.universe.noBounds }))
}

function leading(root: UniverseRoot, series: string, repair: string, first: string | null, last: string | null): MatrixCell[] {
  const r = root.root
  return [
    text(r, r, 'root'),
    text(series, `${r} ${series}`),
    text(repair, fillCopy(DQ.universe.field, { root: r, series, column: DQ.universe.cols.repair, value: repair })),
    bound(r, series, DQ.universe.cols.first, first),
    bound(r, series, DQ.universe.cols.last, last),
  ]
}

function oneMinuteRow(root: UniverseRoot, row: UniverseRow, years: readonly number[], fence: string): MatrixRow {
  const series = DQ.universe.series[row.variant]
  const byYear = new Map(row.cells.map((c) => [c.year, c]))
  const blocks = row.variant === 'vendor' ? root.blocks.join('; ') : ''
  const empty: UniverseCounts = { sessions: 0, usable: 0, gated_out: 0, unrepairable: 0, rejected: 0, usable_share: null }
  return {
    id: `${root.root}|${row.variant}`,
    cells: [
      ...leading(root, series, DQ.universe.repairStatus[root.repair_status], root.first_bar, barText(root.last_bar, fence, root.last_sealed)),
      ...years.map((y) => shareCell(root.root, series, y, byYear.get(y) ?? empty)),
      shareCell(root.root, series, null, row.total),
      words(root.root, series, blocks),
    ],
  }
}

function words(root: string, series: string, value: string): MatrixCell {
  return { kind: 'words', text: value, description: value === '' ? fillCopy(DQ.universe.field, { root, series, column: DQ.universe.cols.blocks, value: DQ.universe.none }) : value, share: null }
}

function dailyRow(root: UniverseRoot, years: readonly number[], fence: string): MatrixRow {
  const r = root.root
  const series = DQ.universe.series.daily
  const d = root.daily
  const rows = d?.rows ?? null
  const yearCell = (y: number): MatrixCell => text(DQ.universe.none, fillCopy(DQ.universe.dailyYear, { root: r, year: y }))
  const totalText = rows === null ? DQ.universe.none : fillCopy(DQ.universe.dailyBars, { rows: rows.toLocaleString('en-GB') })
  const totalWords = rows === null ? fillCopy(DQ.universe.field, { root: r, series, column: DQ.universe.cols.total, value: DQ.universe.noDaily })
    : fillCopy(DQ.universe.dailyTotal, { root: r, rows: rows.toLocaleString('en-GB') })
  const note = d === null ? DQ.universe.noDaily
    : d.missing_nyse_sessions === null ? '' : fillCopy(DQ.universe.dailyMissing, { n: d.missing_nyse_sessions })
  return {
    id: `${r}|1d`,
    cells: [
      ...leading(root, series, DQ.universe.none, d?.first_bar ?? null, barText(d?.last_bar ?? null, fence, d?.last_sealed ?? false)),
      ...years.map(yearCell),
      text(totalText, totalWords),
      words(r, series, note),
    ],
  }
}

/** One row per root and series: 1m vendor, 1m repaired where the repair passed, and 1d where the 1d QA has the root. */
export function matrixRows(universe: DqUniverse): MatrixRow[] {
  const years = visibleYears(universe)
  return universe.roots.flatMap((root) => [
    ...root.rows.map((row) => oneMinuteRow(root, row, years, universe.fence)),
    dailyRow(root, years, universe.fence),
  ])
}

/** The column headers, in cell order. */
export function matrixColumns(universe: DqUniverse): string[] {
  const c = DQ.universe.cols
  return [c.root, c.series, c.repair, c.first, c.last, ...visibleYears(universe).map(String), c.total, c.blocks]
}

export function universeSummary(universe: DqUniverse): string {
  const years = visibleYears(universe)
  return fillCopy(DQ.universe.summary, { roots: universe.roots.length, first: years[0] ?? '', last: years[years.length - 1] ?? '' })
}

export interface GridPos { readonly row: number; readonly col: number }

/** The cell a key moves to, or null for a key the grid does not use. Arrows stop at the edges (the panel's roving
 *  focus is not handed a key the grid can still use); Home and End go to the ends of the row, Page Up and Page
 *  Down to the first and last row of the column. */
export function gridStep(pos: GridPos, key: string, rows: number, cols: number): GridPos | null {
  if (rows === 0 || cols === 0) return null
  const lastRow = rows - 1
  const lastCol = cols - 1
  switch (key) {
    case 'ArrowLeft': return { row: pos.row, col: Math.max(0, pos.col - 1) }
    case 'ArrowRight': return { row: pos.row, col: Math.min(lastCol, pos.col + 1) }
    case 'ArrowUp': return { row: Math.max(0, pos.row - 1), col: pos.col }
    case 'ArrowDown': return { row: Math.min(lastRow, pos.row + 1), col: pos.col }
    case 'Home': return { row: pos.row, col: 0 }
    case 'End': return { row: pos.row, col: lastCol }
    case 'PageUp': return { row: 0, col: pos.col }
    case 'PageDown': return { row: lastRow, col: pos.col }
    default: return null
  }
}

/** One CSV row per root, series and year, with the counts the matrix prints as shares (1m rows only). */
export function universeCsv(universe: DqUniverse): string {
  const header = ['root', 'series', 'year', 'sessions', 'usable', 'gated_out', 'unrepairable', 'rejected', 'usable_share']
  const years = visibleYears(universe)
  const body = universe.roots.flatMap((root) => root.rows.flatMap((row) => row.cells.filter((c) => years.includes(c.year)).map((c) => [
    root.root, DQ.universe.series[row.variant], c.year, c.sessions, c.usable, c.gated_out, c.unrepairable, c.rejected,
    c.usable_share === null ? '' : c.usable_share,
  ])))
  return toCsv(header, body)
}
