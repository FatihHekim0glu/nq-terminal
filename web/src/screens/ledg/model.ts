// Pure helpers for LEDG (look spec 7.9): the weekday-prefixed date, the anchor pair of each run, the
// counts line and the filters. The ledger is shown as the API reads it; nothing is recomputed.
import type { Schemas } from '../../api/types'
import { LEDG } from './copy'

export type LedgerRow = Schemas['LedgerRow']
export type AnchorPair = Schemas['AnchorComparison']

export const BALANCE_FILTERS = ['all', 'OK', 'FAIL'] as const
export type BalanceFilter = (typeof BALANCE_FILTERS)[number]

/** `Sa 2026-09-26` from an ISO timestamp (UTC date), or `--`. */
export function weekdayDate(ts: string | null | undefined): string {
  if (!ts) return '--'
  const day = ts.slice(0, 10)
  const ms = Date.parse(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms)) return '--'
  return `${LEDG.weekdays[new Date(ms).getUTCDay()]} ${day}`
}

/** Each run id that is either side of an anchor pair, mapped to that pair. */
export function anchorsByRun(pairs: readonly AnchorPair[]): ReadonlyMap<string, AnchorPair> {
  const byRun = new Map<string, AnchorPair>()
  for (const pair of pairs) {
    byRun.set(pair.anchor, pair)
    if (pair.base) byRun.set(pair.base, pair)
  }
  return byRun
}

export interface LedgerCounts {
  readonly rows: number
  readonly balanced: number
  readonly matching: number
}

export function ledgerCounts(rows: readonly LedgerRow[]): LedgerCounts {
  return {
    rows: rows.length,
    balanced: rows.filter((r) => r.balance_check === 'OK').length,
    matching: rows.filter((r) => r.matches_result === true).length,
  }
}

/** Case-insensitive substring match on run id, exp id, strategy and variant. */
export function matchesLedgerFilter(row: LedgerRow, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  return [row.run_id, row.exp_id, row.strategy, row.variant].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
}

export function matchesBalance(row: LedgerRow, filter: BalanceFilter): boolean {
  return filter === 'all' || row.balance_check === filter
}

/** Newest first by the ledger timestamp; rows without one last, in file order. */
export function newestFirst(rows: readonly LedgerRow[]): LedgerRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (b.row.ts_utc ?? '').localeCompare(a.row.ts_utc ?? '') || a.i - b.i)
    .map((x) => x.row)
}
