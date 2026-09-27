// TA6 (ARCHITECTURE s4, decided in Phase 8): real fill slippage is shown only beside the strategy its
// sample belongs to, and the caption names the sample. The quote check (results/quote_check_v1.json) is
// a za_orb sample, so its rows show on za_orb runs only; the live close rows are the paper book's, which
// trades volmanaged on MNQ, so they show on volmanaged runs only. Any other run shows no rows, and says why.
import { describe, expect, it } from 'vitest'
import { TEAR_BOOKS as B } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { RUN_TRADES } from './tear.fixtures'
import { slippageView } from './tearBooks'

describe('slippageView (TA6)', () => {
  it('on a za_orb run: the quote-check rows only, captioned with the sample', () => {
    const v = slippageView(RUN_TRADES, 'za_orb')
    expect(v.kind).toBe('quote')
    expect(v.rows.map((r) => r.name)).toEqual(['entry', 'close', 'stop', 'target'])
    expect(v.caption).toBe(fillCopy(B.slippageQuote, { unit: RUN_TRADES.slippage.unit }))
    expect(v.caption).toContain('za_orb')
  })

  it('on a volmanaged run: the paper book close rows only, captioned with the journal', () => {
    const v = slippageView(RUN_TRADES, 'volmanaged')
    expect(v.kind).toBe('live')
    expect(v.rows.map((r) => r.name)).toEqual(['live close'])
    expect(v.caption).toBe(fillCopy(B.slippageLive, { unit: RUN_TRADES.slippage.unit, journal: RUN_TRADES.slippage.live_journal }))
  })

  it('born failing: on any other strategy no sample row is shown under its name', () => {
    for (const strategy of ['dtsmom', 'overnight', 'volmanaged_bh', 'eomtsy', null]) {
      const v = slippageView(RUN_TRADES, strategy)
      expect(v.kind).toBe('none')
      expect(v.rows).toEqual([])
      expect(v.caption).toBe(fillCopy(B.slippageNone, { strategy: strategy ?? B.strategyUnknown }))
    }
  })
})
