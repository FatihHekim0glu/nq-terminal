import { describe, expect, it } from 'vitest'
import { PIVOT } from '../copy/perspective'
import { DATASETS, isoToMs, presetProblems, type Dataset } from './datasets'
import { toColumnar, toSchema } from './schema'

const fill = {
  ts: '2012-01-04T21:00:00.000000000Z', ts_epoch_s: 1_325_710_800, instrument: 'NQH2.XCME', side: 'BUY', qty: 3, px: 2301.25,
  commission: '7.5000 USD', commission_float: 7.5, position_id: 'P-1', order_id: 'O-1', tags: 'REBAL',
}

const trade = {
  date: '2019-03-14', direction: -1, entry_ts: 'e', entry_ts_epoch_s: 1_552_570_200, entry_px: 7000.5, exit_ts: 'x', exit_ts_epoch_s: 1_552_593_600,
  exit_px: 6990.25, reason: 'stop', pnl_pts: 10.25, pnl_usd: 205, commissions_usd: 4.1, net_r: 0.8,
}

describe('pivot datasets (TASKS 9.1)', () => {
  it('shows every datetime column in UTC, as its "(UTC)" name says, whatever the browser zone (born failing)', () => {
    // Perspective formats a datetime in the browser's zone unless the column's date_format names one: the OOS
    // grid showed 10:00:00 for a 09:00 UTC read in British Summer Time and 05:00:00 in New York
    for (const [name, dataset] of Object.entries(DATASETS)) {
      const datetimes = dataset.columns.filter((c) => c.type === 'datetime').map((c) => c.name)
      expect(datetimes.length, name).toBeGreaterThan(0)
      for (const column of datetimes) expect(dataset.preset.columns_config?.[column], `${name} ${column}`).toEqual({ date_format: { timeZone: 'UTC' } })
      const others = dataset.columns.filter((c) => c.type !== 'datetime').map((c) => c.name)
      for (const column of others) expect(dataset.preset.columns_config?.[column]).toBeUndefined()
    }
  })

  it('reads an ISO time as epoch milliseconds, a date as UTC midnight, and nothing else', () => {
    expect(isoToMs('2012-01-04T21:00:00.000000000Z')).toBe(Date.UTC(2012, 0, 4, 21))
    expect(isoToMs('2019-03-14')).toBe(Date.UTC(2019, 2, 14))
    expect(isoToMs('not a date')).toBeNull()
    expect(isoToMs(null)).toBeNull()
  })

  it('fills: every column of the RUN fills grid, the time in milliseconds, the commission as its number', () => {
    const cols = toColumnar([fill], DATASETS.fills.columns)
    const F = PIVOT.fills
    expect(cols[F.ts]).toEqual([1_325_710_800_000])
    expect(cols[F.instrument]).toEqual(['NQH2.XCME'])
    expect(cols[F.qty]).toEqual([3])
    expect(cols[F.px]).toEqual([2301.25])
    expect(cols[F.commission]).toEqual([7.5])
    expect(cols[F.tags]).toEqual(['REBAL'])
  })

  it('trades: the direction reads Long or Short, prices and P&L pass through unchanged', () => {
    const cols = toColumnar([trade, { ...trade, direction: 1 }, { ...trade, direction: null }], DATASETS.trades.columns)
    const T = PIVOT.trades
    expect(cols[T.side]).toEqual([T.short, T.long, null])
    expect(cols[T.pnlUsd]).toEqual([205, 205, 205])
    expect(cols[T.date]).toEqual([Date.UTC(2019, 2, 14), Date.UTC(2019, 2, 14), Date.UTC(2019, 2, 14)])
  })

  it('ledger and OOS rows carry no p-value column (no p-value on a user-picked slice)', () => {
    for (const d of Object.values(DATASETS) as Dataset<never>[]) {
      expect(Object.keys(toSchema(d.columns)).filter((c) => /(^|\s|\()(p|q|bh q)(\s|\)|$)|p-value|p value/i.test(c))).toEqual([])
    }
  })

  it('every preset names only columns of its own schema', () => {
    for (const [name, d] of Object.entries(DATASETS)) expect(presetProblems(d as Dataset<never>), name).toEqual([])
  })

  it('born failing: a preset naming a column the schema lacks is caught', () => {
    const d = DATASETS.fills as Dataset<never>
    const bad = { ...d, preset: { ...d.preset, group_by: ['Venue'] } }
    expect(presetProblems(bad)).toEqual(['group_by: Venue'])
  })
})
