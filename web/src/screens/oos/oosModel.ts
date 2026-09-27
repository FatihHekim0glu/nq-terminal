// OOS screen model (TASKS 7.3; UI_SPEC section 7 OOS; look spec 7.10; ANALYTICS_CATALOG RI2). Pure
// functions over the API's access log and openings: the text each cell shows, the day bands, the
// caller filter, the swimlane input and the openings card. Values are the API's, shown as written:
// the logged UTC time is sliced, never re-zoned, and windows are the logged dates.
import type { Schemas } from '../../api/types'
import type { SwimlaneInput } from '../../charts/echarts/swimlaneModel'
import type { FieldOption } from '../../chrome/Field'
import { OOS, OPENINGS } from '../../copy/oos'
import { fillCopy } from '../../copy/workspace'

export type OosEntry = Schemas['OosLogEntry']
export type OosLog = Schemas['OosLog']
export type Openings = Schemas['Openings']
export type ReadResult = 'served' | 'past' | 'sealed'

const MISSING = '--'
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/

/** The logged UTC time as `YYYY-MM-DD HH:MM:SS`; the raw text when it is not a timestamp. */
export function entryTime(e: OosEntry): string {
  const m = STAMP.exec(e.ts_utc)
  return m ? `${m[1]} ${m[2]}` : e.ts_utc
}

function isoDay(text: unknown): string {
  if (typeof text !== 'string') return MISSING
  const m = /^\d{4}-\d{2}-\d{2}/.exec(text)
  return m ? m[0] : MISSING
}

/** The UTC day of the entry (the band key). */
export function entryDay(e: OosEntry): string {
  return isoDay(e.ts_utc)
}

/** The data window the read asked for, as `start..end` dates. */
export function windowText(e: OosEntry): string {
  return fillCopy(OOS.windowText, { start: isoDay(e.start), end: isoDay(e.end) })
}

export function entryResult(e: OosEntry): ReadResult {
  if (e.is_sealed) return 'sealed'
  return e.past_fence ? 'past' : 'served'
}

export function resultText(result: ReadResult): string {
  if (result === 'sealed') return OOS.resultSealed
  return result === 'past' ? OOS.resultPast : OOS.resultServed
}

/** Newest first, as a copy. */
export function newestFirst(entries: readonly OosEntry[]): OosEntry[] {
  return [...entries].reverse()
}

/**
 * The line numbers on the banded (#1E1E1E) days, for rows in display order: days alternate black and
 * band, the first day black (look spec 7.10).
 */
export function dayBandLines(rows: readonly OosEntry[]): ReadonlySet<number> {
  const banded = new Set<number>()
  let day: string | null = null
  let band = true
  for (const row of rows) {
    const d = entryDay(row)
    if (d !== day) {
      day = d
      band = !band
    }
    if (band) banded.add(row.line_no)
  }
  return banded
}

/** All callers, then each caller by read count (most first) and name. */
export function callerOptions(counts: Readonly<Record<string, number>>): FieldOption[] {
  const callers = Object.entries(counts).sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'en'))
  return [
    { value: '', label: OOS.allCallers },
    ...callers.map(([caller, n]) => ({ value: caller, label: fillCopy(OOS.callerOption, { caller, n }) })),
  ]
}

/** An empty field or a real calendar date as YYYY-MM-DD. */
export function sinceValid(text: string): boolean {
  if (text === '') return true
  const m = ISO_DATE.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export interface SwimlaneData {
  readonly input: SwimlaneInput
  /** Entries left out because their window has no epoch or ends before it starts. */
  readonly skipped: number
}

/** One swimlane span per read, from the logged window epochs; `lanes` fixes the lane order. */
export function swimlaneData(entries: readonly OosEntry[], lanes: readonly string[]): SwimlaneData {
  const reads: SwimlaneInput['reads'][number][] = []
  let skipped = 0
  for (const e of entries) {
    const { start_epoch_s: start, end_epoch_s: end } = e
    if (start === null || end === null || !(end >= start)) {
      skipped += 1
      continue
    }
    reads.push({ caller: e.caller, start, end, sealed: e.is_sealed })
  }
  return { input: { name: OOS.timelineName, reads, lanes }, skipped }
}

// ------------------------------------------------------------------ openings card

export interface OpeningRow {
  readonly key: string
  readonly opened: string
  readonly state: string
  readonly closed: string | null
  readonly caller: string
  readonly window: string
  readonly symbols: string
}

export interface PinStatus {
  readonly text: string
  /** true passes, false fails, null unknown (a file could not be read). */
  readonly ok: boolean | null
}

export interface OpeningsCard {
  readonly rows: readonly OpeningRow[]
  readonly pins: readonly PinStatus[]
  readonly sealedLines: string | null
  readonly label: string
}

const text = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : MISSING)

function openingRow(o: Readonly<Record<string, unknown>>, i: number): OpeningRow {
  const window = Array.isArray(o.window) ? o.window : []
  const symbols = Array.isArray(o.symbols) ? o.symbols.filter((s): s is string => typeof s === 'string') : []
  const closed = o.closed === true
  return {
    key: `${i}-${text(o.caller)}`,
    opened: fillCopy(OPENINGS.opened, { date: isoDay(o.decided_utc), by: text(o.decided_by) }),
    state: closed ? OPENINGS.closedTag : OPENINGS.openTag,
    closed: closed ? fillCopy(OPENINGS.closedAt, { date: isoDay(o.closed_utc) }) : null,
    caller: fillCopy(OPENINGS.caller, { caller: text(o.caller) }),
    window: fillCopy(OPENINGS.window, { start: isoDay(window[0]), end: isoDay(window[1]) }),
    symbols: fillCopy(OPENINGS.symbols, { symbols: symbols.length > 0 ? symbols.join(', ') : MISSING }),
  }
}

function pin(ok: boolean | null, good: string, bad: string, unknown: string): PinStatus {
  return { text: ok === null ? unknown : ok ? good : bad, ok }
}

export function openingsCard(o: Openings): OpeningsCard {
  return {
    rows: o.openings.map(openingRow),
    pins: [
      pin(o.openings_pin_ok, OPENINGS.pinOk, OPENINGS.pinBad, OPENINGS.pinUnknown),
      pin(o.sealed_log_pin_ok, OPENINGS.logPinOk, OPENINGS.logPinBad, OPENINGS.logPinUnknown),
    ],
    sealedLines: o.sealed_log
      ? fillCopy(OPENINGS.sealedLines, { lines: o.sealed_log.lines, pinned: o.pinned.sealed_log_lines })
      : null,
    label: o.label,
  }
}

// ------------------------------------------------------------------ CSV export

const CSV_COLUMNS = ['ts_utc', 'caller', 'reason', 'symbol', 'timeframe', 'variant', 'start', 'end', 'rows', 'result'] as const
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  const safe = FORMULA_START.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

/** The entries as CSV (the shown columns, the log's own values), for 98) Export. */
export function entriesCsv(entries: readonly OosEntry[]): string {
  const rows = entries.map((e) =>
    [e.ts_utc, e.caller, e.reason, e.symbol, e.timeframe, e.variant, e.start, e.end, e.rows, entryResult(e)].map(csvCell).join(','),
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n')
}
