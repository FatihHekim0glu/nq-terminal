// DQ model (ANALYTICS RI4 and RI5): the calendar layout (one block per year, a column per week and a row per
// weekday, Monday on top), per-year counts, the chart summary and table view, the flagged days and their CSV.
// Pure functions; DqScreen and CalendarHeatmap draw the result.
import type { ChartTable } from '../../charts/ChartA11y'
import { toCsv } from '../../chrome/exportCsv'
import { DQ } from '../../copy/dq'
import { fillCopy } from '../../copy/workspace'
import { DAY_STATES, type DayState, type DqCounts, type DqDay } from './types'

export const FENCE = '2021-12-31'
const DAY_MS = 86_400_000
const WEEK = 7
const LETTERS: Readonly<Record<DayState, string>> = { vendor: '', gated_out: 'G', rejected: 'R', rebuilt: 'B', unrepairable: 'U' }

export interface CalendarCell {
  readonly day: DqDay
  /** 0 Monday to 4 Friday. */
  readonly row: number
  /** Week of the year, 0 for the week holding 1 January (weeks start on Monday). */
  readonly col: number
}

export interface CalendarYear {
  readonly year: number
  readonly cells: readonly CalendarCell[]
}

export type YearCountRow = { readonly year: number } & DqCounts

export function stateLetter(state: DayState): string {
  return LETTERS[state]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function utcDay(date: string): number {
  const t = ISO_DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date ? t : Number.NaN
}

/** The day's square, or null for a date that is not a weekday (a weekend or an unreadable date): one bad record
 *  must never stop the calendar (it is listed by offCalendarDays instead). */
function place(day: DqDay): CalendarCell | null {
  const t = utcDay(day.date)
  if (Number.isNaN(t)) return null
  const weekday = (new Date(t).getUTCDay() + 6) % WEEK // Monday 0
  if (weekday > 4) return null
  const jan1 = Date.UTC(new Date(t).getUTCFullYear(), 0, 1)
  const jan1Weekday = (new Date(jan1).getUTCDay() + 6) % WEEK
  const col = Math.floor(((t - jan1) / DAY_MS + jan1Weekday) / WEEK)
  return { day, row: weekday, col }
}

/** The sessions up to the fence, one block per year in ascending order; days that cannot be placed are left out. */
export function calendarLayout(days: readonly DqDay[], fence: string = FENCE): CalendarYear[] {
  const byYear = new Map<number, CalendarCell[]>()
  for (const day of days) {
    if (day.date > fence) continue
    const cell = place(day)
    if (cell === null) continue
    const year = Number(day.date.slice(0, 4))
    byYear.set(year, [...(byYear.get(year) ?? []), cell])
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, cells]) => ({ year, cells }))
}

/** Recorded days up to the fence that the calendar cannot place (weekend or unreadable dates). */
export function offCalendarDays(days: readonly DqDay[], fence: string = FENCE): DqDay[] {
  return days.filter((d) => d.date <= fence && place(d) === null)
}

const OFF_CALENDAR_SHOWN = 5

export function offCalendarText(odd: readonly DqDay[]): string {
  const shown = odd.slice(0, OFF_CALENDAR_SHOWN).map((d) => d.date)
  const more = odd.length > OFF_CALENDAR_SHOWN ? fillCopy(DQ.offCalendarMore, { n: odd.length - OFF_CALENDAR_SHOWN }) : ''
  return fillCopy(DQ.offCalendar, { n: odd.length, dates: shown.join(', ') + more })
}

const WEEK_KEYS: Readonly<Record<string, number>> = { PageUp: -1, PageDown: 1 }
const STEP_KEYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

/** The date a key moves the calendar's readout to (`dates` ascending): arrows one session, Page Up and Page Down
 *  one week (the nearest session on or after, or on or before), Home and End the ends; null for other keys, and
 *  (D37) for an arrow that would step past the first or last date, so the panel's roving focus can take the key. */
export function keyStep(dates: readonly string[], current: string | null, key: string): string | null {
  if (dates.length === 0) return null
  const last = dates.length - 1
  if (key === 'Home') return dates[0]!
  if (key === 'End') return dates[last]!
  const at = current === null ? -1 : dates.indexOf(current)
  if (key in STEP_KEYS) {
    if (at < 0) return dates[0]!
    const next = at + STEP_KEYS[key]!
    return next < 0 || next > last ? null : dates[next]!
  }
  if (!(key in WEEK_KEYS)) return null
  if (at < 0) return dates[0]!
  const sign = WEEK_KEYS[key]!
  const target = new Date(utcDay(dates[at]!) + sign * WEEK * DAY_MS).toISOString().slice(0, 10)
  if (sign > 0) return dates.find((d) => d >= target) ?? dates[last]!
  return [...dates].reverse().find((d) => d <= target) ?? dates[0]!
}

function emptyCounts(): Record<DayState | 'sessions', number> {
  return { vendor: 0, gated_out: 0, rejected: 0, rebuilt: 0, unrepairable: 0, sessions: 0 }
}

export function yearCounts(days: readonly DqDay[]): YearCountRow[] {
  const byYear = new Map<number, Record<DayState | 'sessions', number>>()
  for (const day of days) {
    const year = Number(day.date.slice(0, 4))
    const c = byYear.get(year) ?? emptyCounts()
    c[day.state] += 1
    c.sessions += 1
    byYear.set(year, c)
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, c]) => ({ year, ...c }))
}

export function countsText(counts: DqCounts): string {
  return DAY_STATES.filter((s) => counts[s] > 0)
    .map((s) => fillCopy(DQ.countPart, { label: DQ.states[s], n: counts[s] }))
    .join(', ')
}

export function heatSummary(symbol: string, days: readonly DqDay[], counts: DqCounts): string {
  const first = days[0]?.date ?? ''
  const last = days[days.length - 1]?.date ?? ''
  return fillCopy(DQ.heatSummary, { symbol, first, last, sessions: counts.sessions, counts: countsText(counts) })
}

export function cellTitle(day: DqDay): string {
  const reason = day.reason ? fillCopy(DQ.cellReason, { reason: day.reason }) : ''
  return fillCopy(DQ.cellTitle, { date: day.date, state: DQ.states[day.state], reason })
}

/** The chart's table view: sessions per year and state, then a total row. */
export function yearTable(symbol: string, days: readonly DqDay[]): ChartTable {
  const rows = yearCounts(days)
  const total = rows.reduce((acc, r) => {
    for (const k of [...DAY_STATES, 'sessions'] as const) acc[k] += r[k]
    return acc
  }, emptyCounts())
  return {
    caption: fillCopy(DQ.tableCaption, { symbol }),
    columns: [
      { key: 'year', label: DQ.colYear },
      ...DAY_STATES.map((s) => ({ key: s, label: DQ.states[s], numeric: true })),
      { key: 'sessions', label: DQ.colSessions, numeric: true },
    ],
    rows: [...rows.map((r) => ({ ...r, year: String(r.year) })), { ...total, year: 'Total' }],
  }
}

/** Every day that is not plain vendor data, newest first. */
export function flaggedDays(days: readonly DqDay[]): DqDay[] {
  return days.filter((d) => d.state !== 'vendor').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function flaggedCsv(days: readonly DqDay[]): string {
  return toCsv(['date', 'state', 'reason'], days.map((d) => [d.date, DQ.states[d.state], d.reason ?? '']))
}
