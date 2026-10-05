import { describe, expect, it } from 'vitest'
import type { Schemas } from '../api/types'
import { anchorCheckView, anchorView } from './anchorModel'

type Pair = Schemas['AnchorComparison']

const SAME: Pair = {
  anchor: 'nt_x_regress_r1',
  base: 'nt_x',
  base_source: 'regress_check',
  base_found: true,
  n_trades_equal: true,
  pnl_total_equal: true,
  fees_total_equal: true,
  sharpe_anchor: 0.4644,
  sharpe_base: 0.4644,
  sharpe_equal: true,
  verdict: 'IDENTICAL',
  regress_check_identical: null,
}

describe('anchorView', () => {
  it('reads IDENTICAL as MATCH with no differing field', () => {
    const view = anchorView(SAME)
    expect(view).toMatchObject({ outcome: 'match', word: 'MATCH', firstDifference: null })
    expect(view.text).toBe('Anchor MATCH: trades, P&L, fees and Sharpe equal those of nt_x.')
    expect(view.detail).toBe('trades, P&L, fees and Sharpe equal those of nt_x.')
  })

  it('reads DIFFERENT as MISMATCH and names the first differing field in the order trades, P&L, fees, Sharpe', () => {
    const all = { ...SAME, verdict: 'DIFFERENT' as const, n_trades_equal: false, pnl_total_equal: false, fees_total_equal: false, sharpe_equal: false }
    expect(anchorView(all)).toMatchObject({ outcome: 'mismatch', word: 'MISMATCH', firstDifference: 'trades' })
    expect(anchorView({ ...all, n_trades_equal: true })).toMatchObject({ firstDifference: 'pnl' })
    expect(anchorView({ ...all, n_trades_equal: true, pnl_total_equal: true })).toMatchObject({ firstDifference: 'fees' })
    expect(anchorView({ ...all, n_trades_equal: true, pnl_total_equal: true, fees_total_equal: true })).toMatchObject({ firstDifference: 'sharpe' })
  })

  it('says the first difference in words, and the two Sharpe values when that is the field', () => {
    const pnl = { ...SAME, verdict: 'DIFFERENT' as const, pnl_total_equal: false }
    expect(anchorView(pnl).text).toBe('Anchor MISMATCH: the first difference against nt_x is total P&L.')
    const sharpe = { ...SAME, verdict: 'DIFFERENT' as const, sharpe_equal: false, sharpe_anchor: 0.4644, sharpe_base: 0.5 }
    expect(anchorView(sharpe).text).toBe('Anchor MISMATCH: the first difference against nt_x is the Sharpe ratio (0.4644 against 0.5000).')
  })

  it('still says MISMATCH when the verdict is DIFFERENT but no flag shows why', () => {
    const view = anchorView({ ...SAME, verdict: 'DIFFERENT' })
    expect(view).toMatchObject({ outcome: 'mismatch', firstDifference: null })
    expect(view.text).toContain('a field this check does not name')
  })

  it('never calls a run that cannot be compared a match', () => {
    const missing = anchorView({ ...SAME, verdict: 'NOT COMPARABLE', base: null, base_found: false, base_source: null })
    expect(missing).toMatchObject({ outcome: 'incomparable', word: 'NOT COMPARABLE', firstDifference: null })
    expect(missing.text).toBe('Anchor NOT COMPARABLE: the base run was not found.')
    const unusable = anchorView({ ...SAME, verdict: 'NOT COMPARABLE', sharpe_anchor: null })
    expect(unusable.text).toBe('Anchor NOT COMPARABLE: a run is unusable or a count is missing.')
  })

  it('reads an unknown verdict from a newer server as not comparable, never as a match', () => {
    const view = anchorView({ ...SAME, verdict: 'SOMETHING NEW' as never })
    expect(view.outcome).toBe('incomparable')
  })
})

type Check = Schemas['AnchorCheck']
const CHECKED: Check = {
  anchor: 't_x_regress_r1', base: 't_x', base_found: true, checks: [], first_difference: null,
  job_state: 'ok', note: 'exact', verdict: 'MATCH',
}

describe('anchorCheckView (the exact comparison)', () => {
  it('reads MATCH as MATCH', () => {
    expect(anchorCheckView(CHECKED)).toMatchObject({ outcome: 'match', word: 'MATCH', text: 'Anchor MATCH: trades, P&L, fees and Sharpe equal those of t_x.' })
  })

  it('names a trade row field when only that differs', () => {
    const view = anchorCheckView({ ...CHECKED, verdict: 'MISMATCH', first_difference: 'trades[1].entry_ts' })
    expect(view).toMatchObject({ outcome: 'mismatch', word: 'MISMATCH', firstDifference: 'trades' })
    expect(view.text).toBe('Anchor MISMATCH: the first difference against t_x is the trade row field trades[1].entry_ts.')
  })

  it('names the scalar fields and the trade count in words', () => {
    const at = (first_difference: string) => anchorCheckView({ ...CHECKED, verdict: 'MISMATCH', first_difference }).detail
    expect(at('n_trades')).toContain('the trade count')
    expect(at('pnl_total')).toContain('total P&L')
    expect(at('fees_total')).toContain('total fees')
    expect(at('trades.length')).toContain('trades.length')
    expect(at('sharpe')).toContain('the Sharpe ratio')
  })

  it('never calls a missing base or an unknown verdict a match', () => {
    expect(anchorCheckView({ ...CHECKED, verdict: 'NOT COMPARABLE', base_found: false, first_difference: 'base' }).text)
      .toBe('Anchor NOT COMPARABLE: the base run was not found.')
    expect(anchorCheckView({ ...CHECKED, verdict: 'NOT COMPARABLE', first_difference: 'sharpe' }).outcome).toBe('incomparable')
    expect(anchorCheckView({ ...CHECKED, verdict: 'SOMETHING NEW' as never }).outcome).toBe('incomparable')
  })
})
