// JournalTable's row model (TASKS 5.4, UI_SPEC section 6, look spec 7.11). A journal row from the API
// (`JournalRowOut`) becomes one display line: date, ET decision time, event, a short summary, the
// source code, and on plumbing rows the exact banner the API sends. The data dict is untrusted file
// content, so every field is read defensively and missing numbers print as `--`.
import type { Schemas } from '../api/types'
import { JOURNAL, PLUMBING_BANNER } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import { etClock } from '../tiles/etTime'

export type JournalRow = Schemas['JournalRowOut']

export interface JournalLine {
  readonly key: string
  readonly date: string
  readonly time: string
  readonly type: string
  readonly summary: string
  readonly source: string
  readonly plumbing: boolean
  /** The plumbing banner, verbatim; null on performance rows. */
  readonly banner: string | null
}

type Data = Readonly<Record<string, unknown>>

const MISSING = '--'
const FALLBACK_FIELDS = 3

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const fixed = (v: unknown, decimals: number) => {
  const n = num(v)
  return n === null ? MISSING : n.toFixed(decimals)
}

/** Contracts held: the per-contract dict summed, or a bare number. */
function held(v: unknown): string {
  if (num(v) !== null) return String(v)
  if (v === null || typeof v !== 'object') return MISSING
  const qty = Object.values(v).map(num)
  return qty.length > 0 && qty.every((q) => q !== null) ? String(qty.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)) : MISSING
}

function flags(data: Data): string[] {
  const out: string[] = []
  const refused = text(data.refused)
  const blocked = text(data.blocked)
  if (refused) out.push(fillCopy(JOURNAL.summaryRefused, { reason: refused }))
  if (blocked) out.push(fillCopy(JOURNAL.summaryBlocked, { reason: blocked }))
  if (data.halted === true) out.push(JOURNAL.summaryHalted)
  return out
}

function closeSummary(data: Data): string {
  const head = fillCopy(JOURNAL.summaryClose, {
    target: held(data.target), actual: held(data.actual), sent: data.sent === true ? JOURNAL.yes : JOURNAL.no, exposure: fixed(data.exposure, 2),
  })
  return [head, ...flags(data)].join('; ')
}

function fallback(data: Data): string {
  const scalars = Object.entries(data).filter(([k, v]) => k !== 'type' && k !== 'date' && (v === null || typeof v !== 'object'))
  return scalars.slice(0, FALLBACK_FIELDS).map(([k, v]) => `${k} ${v === null ? MISSING : String(v)}`).join(', ')
}

/** A one-line summary of a journal row's data, by its `type`. */
export function summarise(data: Data): string {
  switch (data.type) {
    case 'close':
      return closeSummary(data)
    case 'warmup':
      return [fillCopy(JOURNAL.summaryWarmup, { requests: fixed(data.requests, 0), planned: fixed(data.planned, 0), valid: fixed(data.valid_last, 0), window: fixed(data.window, 0) }), ...flags(data)].join('; ')
    case 'delayed_fetch': {
      const head = fillCopy(JOURNAL.summaryDelayed, { bars: fixed(data.bars, 0), lag: fixed(data.lag_secs, 0) })
      const sizing = text(data.sizing_price)
      return [head, ...(sizing ? [sizing] : []), ...flags(data)].join('; ')
    }
    case 'skipped':
      return text(data.reason) ?? fallback(data)
    default:
      return fallback(data)
  }
}

/** The display line of one API journal row. */
export function journalLine(row: JournalRow): JournalLine {
  const data: Data = row.data
  return {
    key: `${row.file}:${row.line_no}`,
    date: text(data.date) ?? MISSING,
    time: etClock(num(data.decided_at_ns_epoch_s)),
    type: text(data.type) ?? MISSING,
    summary: summarise(data),
    source: row.plumbing ? JOURNAL.sourcePlumbing : JOURNAL.sourceLive,
    plumbing: row.plumbing,
    banner: row.plumbing ? (row.banner ?? PLUMBING_BANNER) : null,
  }
}
