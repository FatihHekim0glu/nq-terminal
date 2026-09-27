// The ROLL model (ANALYTICS MV10, gaps as MV2): the calendar strip, the per-market table and gap chart, and the text the
// screen shows, from /api/market/rolls. Pure functions only. Nothing is recomputed from prices: the gaps
// are the API's; the one derivation is bucketing roll dates into months. Every roll dated on or after
// 2022-01-01 is cut first (the API serves none; this is the screen's own fence, UI_SPEC 6).
import type { ChartTable } from '../../charts/ChartA11y'
import { toCsv } from '../../chrome/exportCsv'
import { fillCopy } from '../../copy/workspace'
import { ROLL } from '../../copy/roll'
import { toDecimal } from '../../format/decimal'
import type { MarketRolls, RollCalendar, RollEvent } from './types'

export const FENCE_DATE = '2022-01-01'
/** The first in-sample session's epoch second (2010-01-01); the chart's time axis runs from here to the fence. */
export const AXIS_START_T = Date.UTC(2010, 0, 1) / 1000
export const FENCE_T = Date.UTC(2022, 0, 1) / 1000
/** Rows of the strip are numbered from 11 (Number <GO>), clear of the view tabs 1) to 3). */
export const STRIP_FIRST_NUMBER = 11
/** The paper book's MNQ schedule: two past rolls and eight ahead. */
export const PAPER_WINDOW = { behind: 2, ahead: 8 } as const
const MONTHS = 12
const PCT_DECIMALS = 3
const MAX_TICK_DECIMALS = 8
const MISSING = ROLL.missingValue

export type YearChoice = 'all' | string

export interface StripCell {
  readonly count: number
  /** The roll's gap in percent when the cell holds exactly one roll of a chosen year, else null. */
  readonly gapPct: number | null
  readonly dates: readonly string[]
}

export interface StripRow {
  readonly n: number
  readonly symbol: string
  readonly root: string
  readonly sector: string
  readonly cells: readonly StripCell[]
  readonly total: number
}

export function shownRolls(market: MarketRolls): { readonly rolls: RollEvent[]; readonly fenced: number } {
  const rolls = market.rolls.filter((r) => r.date < FENCE_DATE)
  return { rolls, fenced: market.rolls.length - rolls.length }
}

export function yearsOf(calendar: RollCalendar): string[] {
  return [...new Set(calendar.months.map((m) => m.slice(0, 4)).filter((y) => `${y}-01-01` < FENCE_DATE))].sort()
}

function stripCells(rolls: readonly RollEvent[], year: YearChoice): StripCell[] {
  const dates: string[][] = Array.from({ length: MONTHS }, () => [])
  const gaps: Array<number | null> = Array.from({ length: MONTHS }, () => null)
  for (const roll of rolls) {
    if (year !== 'all' && roll.date.slice(0, 4) !== year) continue
    const month = Number(roll.date.slice(5, 7)) - 1
    dates[month]!.push(roll.date)
    gaps[month] = roll.gap_pct
  }
  return dates.map((d, i) => ({ count: d.length, gapPct: year !== 'all' && d.length === 1 ? gaps[i]! : null, dates: d }))
}

export function stripRows(calendar: RollCalendar, year: YearChoice): StripRow[] {
  return calendar.markets.map((market, i) => {
    const cells = stripCells(shownRolls(market).rolls, year)
    return {
      n: STRIP_FIRST_NUMBER + i,
      symbol: market.symbol,
      root: market.root,
      sector: market.sector,
      cells,
      total: cells.reduce((sum, c) => sum + c.count, 0),
    }
  })
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value >= 0 ? '+' : '-'}${toDecimal(Math.abs(value), PCT_DECIMALS)}%`
}

function absPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? MISSING : `${toDecimal(Math.abs(value), PCT_DECIMALS)}%`
}

/** Decimals of the tick as written (0.25 gives 2, 1/64 gives 6), capped at 8. */
export function tickDecimals(tick: number): number {
  for (let d = 0; d <= MAX_TICK_DECIMALS; d += 1) {
    if (Math.abs(Math.round(tick * 10 ** d) - tick * 10 ** d) < 1e-9) return d
  }
  return MAX_TICK_DECIMALS
}

export function formatPts(value: number | null, tick: number): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  const text = toDecimal(Math.abs(value), tickDecimals(tick))
  return `${value >= 0 ? '+' : '-'}${text}`
}

export function cellText(cell: StripCell, year: YearChoice): string {
  if (cell.count === 0) return ''
  if (year === 'all') return String(cell.count)
  return cell.count === 1 ? formatPct(cell.gapPct) : fillCopy(ROLL.cellManyText, { count: cell.count })
}

export function cellLabel(row: StripRow, month: number, year: YearChoice): string {
  const cell = row.cells[month]!
  const values = { root: row.root, month: ROLL.monthNames[month] ?? '', year, count: cell.count }
  if (year === 'all') return fillCopy(cell.count === 0 ? ROLL.cellNone : ROLL.cellAll, { ...values, year: ROLL.allYears })
  if (cell.count === 0) return fillCopy(ROLL.cellNone, values)
  if (cell.count === 1) return fillCopy(ROLL.cellOne, { ...values, date: cell.dates[0] ?? '', gap: formatPct(cell.gapPct) })
  return fillCopy(ROLL.cellMany, { ...values, dates: cell.dates.join(', ') })
}

/** A strip cell for the CSV: the raw gap in percent (full precision) for one roll of a chosen year, else the count. */
function csvCellValue(cell: StripCell, year: YearChoice): string | number | null {
  if (cell.count === 0) return null
  if (year === 'all') return cell.count
  return cell.count === 1 ? cell.gapPct : fillCopy(ROLL.cellManyText, { count: cell.count })
}

export function stripCsv(rows: readonly StripRow[], year: YearChoice): { readonly text: string; readonly rows: number } {
  const header = ['ticker', ...ROLL.monthNames, 'rolls']
  const body = rows.map((r) => [r.root, ...r.cells.map((c) => csvCellValue(c, year)), r.total])
  return { text: toCsv(header, body), rows: body.length }
}

export function summaryText(market: MarketRolls): string {
  const { rolls } = shownRolls(market)
  return fillCopy(ROLL.summary, {
    root: market.root,
    count: rolls.length,
    first: rolls[0]?.date ?? MISSING,
    last: rolls.at(-1)?.date ?? MISSING,
    mean: absPct(market.mean_abs_gap_pct),
    max: absPct(market.max_abs_gap_pct),
  })
}

export function qaText(market: MarketRolls): string {
  if (market.qa_rolls_total === null) return ROLL.qaAbsent
  const values = { total: market.qa_rolls_total, count: market.count }
  return fillCopy(market.qa_match ? ROLL.qaMatch : ROLL.qaMismatch, values)
}

export interface GapPoint {
  readonly date: string
  /** Position on the time axis, 0 at 2010-01-01 and 1 at the fence. */
  readonly x: number
  readonly value: number
}

export interface GapChart {
  readonly name: string
  readonly label: string
  readonly points: readonly GapPoint[]
  readonly min: number
  readonly max: number
  readonly table: ChartTable
  readonly fenced: number
}

function gapLabel(name: string, points: readonly GapPoint[]): string {
  let lo = points[0]!
  let hi = points[0]!
  for (const p of points) {
    if (p.value < lo.value) lo = p
    if (p.value > hi.value) hi = p
  }
  return fillCopy(ROLL.chartSummary, {
    name,
    first: points[0]!.date,
    last: points.at(-1)!.date,
    min: formatPct(lo.value),
    minDate: lo.date,
    max: formatPct(hi.value),
    maxDate: hi.date,
  })
}

export function gapChart(market: MarketRolls): GapChart {
  const { rolls, fenced } = shownRolls(market)
  const span = FENCE_T - AXIS_START_T
  const points = rolls
    .filter((r): r is RollEvent & { gap_pct: number } => r.gap_pct !== null && Number.isFinite(r.gap_pct))
    .map((r) => ({ date: r.date, x: (r.t - AXIS_START_T) / span, value: r.gap_pct }))
  const name = fillCopy(ROLL.chartName, { root: market.root, count: rolls.length })
  const C = ROLL.rollCols
  const table: ChartTable = {
    caption: fillCopy(ROLL.chartTableCaption, { root: market.root }),
    columns: [{ key: 'date', label: C.date }, { key: 'gapPts', label: C.gapPts, numeric: true }, { key: 'gapPct', label: C.gapPct, numeric: true }],
    rows: rolls.map((r) => ({ date: r.date, gapPts: formatPts(r.gap_pts, market.tick), gapPct: formatPct(r.gap_pct) })),
  }
  const values = points.map((p) => p.value)
  return {
    name,
    label: points.length === 0 ? fillCopy(ROLL.chartEmpty, { root: market.root }) : gapLabel(name, points),
    points,
    min: Math.min(0, ...values),
    max: Math.max(0, ...values),
    table,
    fenced,
  }
}

export function rollsCsv(market: MarketRolls): { readonly text: string; readonly rows: number } {
  const { rolls } = shownRolls(market)
  const header = ['symbol', 'date', 'last_date', 'from', 'to', 'close_before', 'gap_pts', 'gap_pct']
  const body = rolls.map((r) => [market.symbol, r.date, r.last_date, r.from, r.to, r.close_before, r.gap_pts, r.gap_pct])
  return { text: toCsv(header, body), rows: body.length }
}
