// LIVE and JRNL model (TASKS 7.3; UI_SPEC section 7 LIVE and JRNL; look spec 7.11; ANALYTICS_CATALOG
// LV1 to LV4). Pure functions over /api/live/status, /performance and /journal: the state and guard
// strips, the exposure KPIs, the target-against-actual series with its plumbing guard, the
// reconciliation rows and the JRNL file filter. Every value is the API's, formatted to fixed decimals
// with its unit; nothing is recomputed.
import type { Schemas } from '../../api/types'
import type { FieldOption } from '../../chrome/Field'
import { JRNL, LIVE } from '../../copy/live'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'

export type LiveStatus = Schemas['LiveStatus']
export type Performance = Schemas['Performance']
export type JournalRow = Schemas['JournalRowOut']
export type Kpi = Schemas['Kpi']

export type Tone = 'up' | 'down' | 'warn'

export interface StateItem {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly tone?: Tone
}

const EXPOSURE_DECIMALS = 4
const PX_DECIMALS = 2
const SLIP_DECIMALS = 1
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

const ct = (n: number | null) => (n === null ? LIVE.none : fillCopy(LIVE.contracts, { n }))
const fixedUnit = (n: number | null, decimals: number, unit: string) => (n === null ? LIVE.none : `${n.toFixed(decimals)} ${unit}`)
const yesNo = (b: boolean | null | undefined) => (b === true ? LIVE.yes : b === false ? LIVE.no : LIVE.none)

function item(key: string, label: string, value: string, tone?: Tone): StateItem {
  return tone ? { key, label, value, tone } : { key, label, value }
}

/** The book strip: the last performance close row of the book journal, plus the halted flag. */
export function bookItems(s: LiveStatus): StateItem[] {
  const c = s.last_close
  const slip = c?.slippage_ticks ?? null
  return [
    item('contract', LIVE.contract, s.next.contract),
    item('lastClose', LIVE.lastClose, c ? (c.date ?? LIVE.none) : LIVE.noClose),
    item('target', LIVE.target, ct(c?.target ?? null)),
    item('actual', LIVE.actual, ct(c?.actual ?? null)),
    item('expected', LIVE.expected, ct(c?.expected ?? null)),
    item('exposure', LIVE.exposure, fixedUnit(c?.exposure ?? null, EXPOSURE_DECIMALS, LIVE.exposureUnit)),
    item('slippage', LIVE.slippage, slip === null ? LIVE.none : fillCopy(LIVE.ticks, { n: slip.toFixed(SLIP_DECIMALS) })),
    item('closePx', LIVE.closePx, fixedUnit(c?.close_px ?? null, PX_DECIMALS, LIVE.closePxUnit)),
    item('sent', LIVE.sent, yesNo(c?.sent)),
    item('reconciled', LIVE.reconciled, c?.reconciled_ok === true ? LIVE.ok : c?.reconciled_ok === false ? LIVE.fail : LIVE.none,
      c?.reconciled_ok === false ? 'down' : undefined),
    item('refused', LIVE.refused, str(c?.refused) ?? LIVE.none, str(c?.refused) ? 'warn' : undefined),
    item('blocked', LIVE.blocked, str(c?.blocked) ?? LIVE.none, str(c?.blocked) ? 'warn' : undefined),
    item('error', LIVE.error, str(c?.error) ?? LIVE.none, str(c?.error) ? 'down' : undefined),
    item('halted', LIVE.halted, yesNo(s.halted), s.halted === true ? 'down' : undefined),
  ]
}

function newest(stamps: ReadonlyArray<string | null>): string {
  const known = stamps.filter((x): x is string => x !== null).sort()
  return known.at(-1) ?? LIVE.none
}

/** The guard strip: kill switch, env flags (set or not set only), TWS and the order path. */
export function guardItems(s: LiveStatus): StateItem[] {
  const e = s.env
  const host = e.ib_host === null ? LIVE.unset : e.ib_port === null ? e.ib_host : fillCopy(LIVE.hostPort, { host: e.ib_host, port: e.ib_port })
  return [
    item('kill', LIVE.kill, s.kill_switch_on ? LIVE.killOn : LIVE.killOff, s.kill_switch_on ? 'warn' : undefined),
    item('delayed', LIVE.delayed, e.delayed_flag_set ? LIVE.set : LIVE.unset, e.delayed_flag_set ? 'warn' : undefined),
    item('volmanC', LIVE.volmanC, e.volman_c_set ? LIVE.set : LIVE.unset),
    item('baseRate', LIVE.baseRate, e.base_usd_rate_set ? LIVE.set : LIVE.unset),
    item('ib', LIVE.ib, host),
    item('account', LIVE.account, e.account_masked ?? LIVE.unset),
    item('tws', LIVE.tws, s.tws),
    item('orderPath', LIVE.orderPath, s.order_path),
    item('journalAge', LIVE.lastJournalRow, newest(s.journals.map((j) => j.last_row_utc))),
    item('logAge', LIVE.lastLogLine, newest(s.logs.map((l) => l.modified_utc))),
  ]
}

/** exposure_summary as Basis B tiles; descriptive, so [POST HOC]. Empty without a book journal. */
export function exposureKpis(s: LiveStatus): Kpi[] {
  const x = s.exposure_summary
  if (!x) return []
  const kpi = (key: string, label: string, value: number | null, unit: string): Kpi => ({
    key, label, value, unit, basis: 'B', tag: SPEC.postHoc, note: null,
  })
  return [
    kpi('mean_exposure', LIVE.kpiMeanExposure, x.mean_exposure, LIVE.unitX),
    kpi('sessions', LIVE.kpiSessions, x.sessions, LIVE.unitCount),
    kpi('plumbing_rows_skipped', LIVE.kpiPlumbing, x.plumbing_rows_skipped, LIVE.unitCount),
  ]
}

// ------------------------------------------------------------------ target against actual

/** An ISO date as epoch seconds at 00:00 UTC; null when missing or not a date. */
export function dateSeconds(date: string | null | undefined): number | null {
  const m = typeof date === 'string' ? ISO_DATE.exec(date) : null
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms / 1000 : null
}

export type ChartResult =
  | { readonly kind: 'ok'; readonly t: number[]; readonly target: (number | null)[]; readonly actual: (number | null)[]; readonly exposure: (number | null)[]; readonly skippedNoDate: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty' }

function rowDate(row: JournalRow): string | null {
  return str(row.data.date)
}

/** True when the performance rows are exactly the journal's non-plumbing close rows: the same journal
 * lines (the API's `line_no`) and the same dates, in the same order. */
function matchesJournal(perf: Performance, journal: readonly JournalRow[]): boolean {
  // A backend started before the merge sends no line_no: the dates alone are compared then.
  const lines = (perf as Partial<Performance>).line_no
  if (journal.length !== perf.date.length || (lines && lines.length !== journal.length)) return false
  return journal.every((r, i) => (!lines || r.line_no === lines[i]) && rowDate(r) === perf.date[i])
}

/**
 * The LV2 step series, guarded (LV1): the performance rows must be, line for line and in order, the
 * journal's own non-plumbing close rows (`closeRows` is /api/live/journal?type=close for the same file,
 * `closeTotal` its total). A plumbing row that reached the performance rows makes the lines differ, so
 * nothing is drawn. Points sit on the API's `t` (epoch seconds at 00:00 UTC of each session date).
 */
export function performanceChart(perf: Performance, closeRows: readonly JournalRow[], closeTotal: number): ChartResult {
  if (closeTotal > closeRows.length) return { kind: 'error', message: LIVE.guardUnverified }
  const journal = closeRows.filter((r) => !r.plumbing)
  if (!matchesJournal(perf, journal)) {
    return { kind: 'error', message: fillCopy(LIVE.guardMismatch, { perf: perf.date.length, journal: journal.length }) }
  }
  if (perf.date.length === 0) return { kind: 'empty' }
  const out = { t: [] as number[], target: [] as (number | null)[], actual: [] as (number | null)[], exposure: [] as (number | null)[] }
  let skippedNoDate = 0
  const served = (perf as Partial<Performance>).t
  perf.date.forEach((d, i) => {
    const t = served ? served[i] ?? null : dateSeconds(d)
    if (t === null) {
      skippedNoDate += 1
      return
    }
    out.t.push(t)
    out.target.push(perf.target[i] ?? null)
    out.actual.push(perf.actual[i] ?? null)
    out.exposure.push(perf.exposure[i] ?? null)
  })
  const outOfOrder = out.t.some((t, i) => {
    const prev = out.t[i - 1]
    return prev !== undefined && t < prev
  })
  if (outOfOrder) return { kind: 'error', message: LIVE.guardOrder }
  return { kind: 'ok', ...out, skippedNoDate }
}

export interface ReconRow {
  readonly key: string
  readonly date: string | null
  readonly contract: string | null
  readonly target: number | null
  readonly expected: number | null
  readonly actual: number | null
  readonly reconciled: boolean | null
  readonly exposure: number | null
  readonly slippage: number | null
  readonly sent: boolean | null
  readonly refused: string | null
  readonly error: string | null
  readonly halted: boolean | null
}

/** The reconciliation table: one row per performance close, as sent. */
export function reconRows(perf: Performance): ReconRow[] {
  return perf.date.map((date, i) => ({
    key: `${i}-${date ?? ''}`,
    date,
    contract: perf.contract[i] ?? null,
    target: perf.target[i] ?? null,
    expected: perf.expected[i] ?? null,
    actual: perf.actual[i] ?? null,
    reconciled: perf.reconciled_ok[i] ?? null,
    exposure: perf.exposure[i] ?? null,
    slippage: perf.slippage_ticks[i] ?? null,
    sent: perf.sent[i] ?? null,
    refused: perf.refused[i] ?? null,
    error: perf.error[i] ?? null,
    halted: perf.halted[i] ?? null,
  }))
}

// ------------------------------------------------------------------ JRNL

/** All journals, each written journal (plumbing marked), then expected files not yet written. */
export function fileOptions(s: LiveStatus): FieldOption[] {
  const written = s.journals.map((j) => ({ value: j.name, label: j.plumbing ? fillCopy(JRNL.plumbingFile, { name: j.name }) : j.name }))
  const names = new Set(written.map((o) => o.value))
  const missing = s.expected.filter((e) => !e.present && !names.has(e.name)).map((e) => ({ value: e.name, label: fillCopy(JRNL.missingFile, { name: e.name }) }))
  return [{ value: '', label: JRNL.allFiles }, ...written, ...missing]
}

/** Whether /api/live/journal has rows to give for `file` ('' is every journal); a missing file is a 404. */
export function journalQueryEnabled(s: LiveStatus, file: string): boolean {
  return file === '' ? s.journals.length > 0 : s.journals.some((j) => j.name === file)
}

/** What an empty table says: the expected file when it is not written yet, else no rows of the type. */
export function journalEmptyText(s: LiveStatus, file: string, type: string): string {
  const missing = s.expected.filter((e) => !e.present && e.empty_state !== null)
  if (file !== '') {
    const expected = missing.find((e) => e.name === file)
    if (expected?.empty_state) return expected.empty_state
  } else if (s.journals.length === 0) {
    return missing.length > 0 ? missing.map((e) => e.empty_state).join('; ') : JRNL.noJournals
  }
  const name = file === '' ? JRNL.allFilesName : file
  return fillCopy(type === '' ? JRNL.noRowsAny : JRNL.noRows, { file: name })
}

/** The offset that makes one page hold the newest rows. */
export function newestOffset(total: number, limit: number): number {
  return Math.max(0, total - limit)
}
