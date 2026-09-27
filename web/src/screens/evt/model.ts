// EVT model: the screen's pure pieces. Values are the API's; this file only scales fractions to percent for
// display, names the options and builds the export. Nothing here computes a statistic: the mean path, its
// band and the end distribution come from /api/events/study, and no p-value exists anywhere in it.
import { signed } from '../../charts/echarts/format'
import { toCsv } from '../../chrome/exportCsv'
import { EVT } from '../../copy/evt'
import { fillCopy } from '../../copy/workspace'
import type { EventPathInput } from './chartModel'
import type { EventCalendar, EventMode, EventRow, EventStudy, EventType } from './types'

export const PCT = 100
export const DECIMALS = 2
export const DEFAULT_ROOT = 'NQ'
export const EVENT_TYPES: readonly EventType[] = ['CPI', 'PPI', 'NFP', 'FOMC', 'ALL']
export const DEFAULT_EVENT: EventType = 'FOMC'
export const DEFAULT_WINDOW: Readonly<Record<EventMode, readonly [number, number]>> = { daily: [5, 5], intraday: [60, 120] }
const WINDOW_CHOICES: Readonly<Record<EventMode, Readonly<Record<'before' | 'after', readonly number[]>>>> = {
  daily: { before: [1, 2, 3, 5, 10, 20], after: [1, 2, 3, 5, 10, 20] },
  intraday: { before: [15, 30, 60, 120, 240], after: [30, 60, 120, 240, 390] },
}

export interface Option {
  readonly value: string
  readonly label: string
}

export const symbolFor = (root: string): string => `${root}.V.0`
export const rootOf = (symbol: string): string => symbol.replace(/\.V\.0$/, '')

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const toPct = (v: number | null | undefined): number | null => (isNum(v) ? v * PCT : null)

/** A fraction as a signed percent with two decimals (`+1.23%`), `--` for a gap. */
export function formatPct(v: number | null | undefined): string {
  return isNum(v) ? `${signed(v * PCT, DECIMALS)}%` : '--'
}

export function eventOptions(calendar: EventCalendar): Option[] {
  return EVENT_TYPES.map((type) => ({
    value: type,
    label: fillCopy(EVT.eventOption, { type: type === 'ALL' ? EVT.eventAll : type, n: calendar.counts[type] ?? 0 }),
  }))
}

export function intradayAllowed(calendar: EventCalendar | undefined, symbol: string): boolean {
  return calendar?.intraday_symbols.includes(symbol) ?? false
}

export function windowOptions(mode: EventMode, side: 'before' | 'after'): Option[] {
  const template = mode === 'daily' ? EVT.sessionsOption : EVT.minutesOption
  return WINDOW_CHOICES[mode][side].map((n) => ({ value: String(n), label: fillCopy(template, { n }) }))
}

export function statusText(row: EventRow): string {
  return row.used ? EVT.statusUsed : fillCopy(EVT.statusVoid, { reason: row.reason ?? '--' })
}

function chartName(study: EventStudy): string {
  const mode = fillCopy(study.mode === 'daily' ? EVT.chartModeDaily : EVT.chartModeIntraday, { pre: study.pre, post: study.post })
  const event = study.event_type === 'ALL' ? EVT.eventAll : study.event_type
  return fillCopy(EVT.chartName, { root: rootOf(study.symbol), event, mode })
}

export function chartInput(study: EventStudy, selected: EventRow | null): EventPathInput {
  const pick = selected && selected.used && selected.path.length === study.offsets.length ? selected : null
  return {
    name: chartName(study),
    label: study.label,
    unit: '%',
    decimals: DECIMALS,
    xName: study.offset_unit === 'session' ? EVT.xSession : EVT.xMinute,
    offsets: [...study.offsets],
    mean: study.mean.map(toPct),
    lower: study.lower.map(toPct),
    upper: study.upper.map(toPct),
    selected: pick ? { label: `${pick.date} ${pick.types.join('+')}`, values: pick.path.map(toPct) } : null,
    n: study.n_used,
  }
}

/** The mean path and its band as the API sent them (fractions), one line per offset. */
export function pathCsv(study: EventStudy): { readonly csv: string; readonly rows: number } {
  const rows = study.offsets.map((k, i) => [k, study.mean[i], study.se[i], study.lower[i], study.upper[i]])
  return { csv: toCsv(['offset', 'mean', 'se', 'lower', 'upper'], rows), rows: rows.length }
}

export interface EndCell {
  readonly label: string
  readonly value: string
  /** Sign tone for a signed figure (mean and median), so it reads like the grid; null for the others. */
  readonly tone: 'up' | 'down' | null
}

function toneOf(v: number | null | undefined): 'up' | 'down' | null {
  return isNum(v) && v !== 0 ? (v > 0 ? 'up' : 'down') : null
}

/** The units line: the daily path is a sum of daily returns, the intraday one a price ratio. */
export function unitsText(study: Pick<EventStudy, 'mode'>): string {
  return study.mode === 'daily' ? EVT.unitsDaily : EVT.units
}

export function endCells(study: EventStudy): EndCell[] {
  const e = study.end
  const share = isNum(e.share_positive) ? `${Math.round(e.share_positive * PCT)}%` : '--'
  return [
    { label: EVT.endMean, value: formatPct(e.mean), tone: toneOf(e.mean) },
    { label: EVT.endMedian, value: formatPct(e.median), tone: toneOf(e.median) },
    { label: EVT.endSd, value: isNum(e.sd) ? `${signed(e.sd * PCT, DECIMALS).replace(/^\+/, '')}%` : '--', tone: null },
    { label: EVT.endSe, value: isNum(e.se) ? `${signed(e.se * PCT, DECIMALS).replace(/^\+/, '')}%` : '--', tone: null },
    { label: EVT.endShare, value: share, tone: null },
    { label: EVT.endN, value: String(e.n), tone: null },
  ]
}
