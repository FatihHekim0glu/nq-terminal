// LEDG helpers (look spec 7.9): weekday dates, anchor pairs by run, counts, filters and order.
import { describe, expect, it } from 'vitest'
import { LEDGER } from '../runs/runs.fixtures'
import { anchorsByRun, ledgerCounts, matchesBalance, matchesLedgerFilter, newestFirst, weekdayDate, type AnchorPair, type LedgerRow } from './model'

const BASE = LEDGER.rows[0] as LedgerRow
const pair = (anchor: string, base: string | null): AnchorPair => ({
  anchor, base, base_source: 'name', base_found: base !== null, n_trades_equal: true, pnl_total_equal: true,
  fees_total_equal: true, sharpe_anchor: 1, sharpe_base: 1, sharpe_equal: true, verdict: 'IDENTICAL', regress_check_identical: null,
})

describe('weekdayDate', () => {
  it('prefixes the UTC weekday', () => {
    expect(weekdayDate('2026-09-26T00:00:00+00:00')).toBe('Sa 2026-09-26')
    expect(weekdayDate('2026-09-25T23:59:59+00:00')).toBe('Fr 2026-09-25')
  })

  it('shows -- for a missing or malformed timestamp', () => {
    expect(weekdayDate(null)).toBe('--')
    expect(weekdayDate('not a date')).toBe('--')
  })
})

describe('anchorsByRun', () => {
  it('maps both runs of a pair, and an orphan anchor alone', () => {
    const map = anchorsByRun([pair('a1', 'a0'), pair('b1', null)])
    expect(map.get('a1')?.verdict).toBe('IDENTICAL')
    expect(map.get('a0')?.anchor).toBe('a1')
    expect(map.get('b1')?.base).toBeNull()
    expect(map.size).toBe(3)
  })
})

describe('counts, filters and order', () => {
  const failed: LedgerRow = { ...BASE, run_id: 'r2', ts_utc: '2026-09-27T00:00:00+00:00', balance_check: 'FAIL', matches_result: null }
  it('counts balanced rows and rows that match result.json', () => {
    expect(ledgerCounts([BASE, failed])).toEqual({ rows: 2, balanced: 1, matching: 1 })
  })

  it('filters on the balance and on text', () => {
    expect(matchesBalance(failed, 'FAIL')).toBe(true)
    expect(matchesBalance(BASE, 'FAIL')).toBe(false)
    expect(matchesBalance(BASE, 'all')).toBe(true)
    expect(matchesLedgerFilter(BASE, 'OVERNIGHT')).toBe(true)
    expect(matchesLedgerFilter(BASE, 'dtsmom')).toBe(false)
  })

  it('puts the newest row first', () => {
    expect(newestFirst([BASE, failed]).map((r) => r.run_id)).toEqual(['r2', BASE.run_id])
  })
})
