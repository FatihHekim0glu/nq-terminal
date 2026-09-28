// @vitest-environment jsdom
// D22 regression: the trades grid's P&L (pts) column must print at the same precision as the entry
// and exit prices (decimalsFor), not a fixed 2 decimals, so a small-tick trade (FX, 6J) does not read
// 0.00 in the down colour while its USD P&L is clearly nonzero.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { stubLayout } from '../../grids/testing'
import { TradesGrid } from './RunTables'

type Trade = Schemas['TradeRow']

function trade(overrides: Partial<Trade>): Trade {
  return {
    date: '2012-01-03',
    direction: -1,
    entry_ts: '2012-01-03 00:00',
    entry_ts_epoch_s: 1325548800,
    entry_px: 0.0130125,
    exit_ts: '2012-01-04 00:00',
    exit_ts_epoch_s: 1325635200,
    exit_px: 0.01285,
    reason: 'signal',
    pnl_pts: -0.0001625,
    pnl_usd: -2031.25,
    commissions_usd: 8.75,
    net_r: null,
    ...overrides,
  }
}

beforeAll(() => stubLayout(400))
afterEach(cleanup)

describe('RUN trades grid pts column (D22)', () => {
  it('prints a 6J trade pts at the price decimals, not rounded to 0.00', () => {
    const t = trade({})
    render(<TradesGrid run="r1" items={[t]} total={1} />)
    expect(screen.getByText('-0.0001625')).toBeTruthy()
    expect(screen.queryByText('0.00')).toBeNull()
  })

  it('still prints an ES trade pts at 2 decimals, matching the entry and exit prices', () => {
    const t = trade({ entry_px: 4500.25, exit_px: 4505.5, pnl_pts: 5.25, pnl_usd: 262.5 })
    render(<TradesGrid run="r1" items={[t]} total={1} />)
    expect(screen.getByText('5.25')).toBeTruthy()
  })
})
