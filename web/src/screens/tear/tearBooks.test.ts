import { describe, expect, it } from 'vitest'
import { BOOK_TRADES, NO_EXPOSURE, RUN_COSTS, RUN_EXPOSURE, RUN_TRADES } from './tear.fixtures'
import {
  exposureStack,
  groupLadder,
  hasTrades,
  sensitivityLadder,
  slippageRows,
  tradeStatRows,
  waterfallRows,
} from './tearBooks'

const valueOf = (rows: ReadonlyArray<{ id: string; value: string }>, id: string) => rows.find((r) => r.id === id)?.value

describe('trade panels (TA1, TA3, TA6)', () => {
  it('appear only for a run with closed trades', () => {
    expect(hasTrades(RUN_TRADES)).toBe(true)
    expect(hasTrades({ ...RUN_TRADES, stats: { ...RUN_TRADES.stats, n: 0 } })).toBe(false)
    expect(hasTrades(undefined)).toBe(false)
  })

  it('shows the TA1 figures at the displayed precision, money with separators', () => {
    const rows = tradeStatRows(RUN_TRADES)
    expect(valueOf(rows, 'n')).toBe('6')
    expect(valueOf(rows, 'winRate')).toBe('50.00%')
    expect(valueOf(rows, 'totalPnl')).toBe('+1,053.12 USD')
    expect(valueOf(rows, 'avgLoss')).toBe('-164.48 USD')
    expect(valueOf(rows, 'profitFactor')).toBe('3.13')
    expect(valueOf(rows, 'tNetR')).toBe('1.25')
    expect(valueOf(rows, 'payoff')).toBe('3.13')
  })

  it('keeps a missing figure as --', () => {
    const rows = tradeStatRows(BOOK_TRADES)
    expect(valueOf(rows, 'avgWin')).toBe('--')
    expect(valueOf(rows, 'maxWin')).toBe('--')
  })

  it('draws mean P&L by group with the API t intervals as whiskers', () => {
    const ladder = groupLadder(RUN_TRADES, 'weekday', 'nt_za_v0_fixture_a')!
    const rows = RUN_TRADES.by_weekday.rows
    expect(ladder.bars.map((b) => b.label)).toEqual(rows.map((r) => r.label))
    expect(ladder.bars.map((b) => b.value)).toEqual(rows.map((r) => r.mean))
    expect(ladder.bars.map((b) => b.lo)).toEqual(rows.map((r) => r.ci_lo))
    expect(ladder.bars.map((b) => b.n)).toEqual(rows.map((r) => r.n))
    expect(ladder.ci).toBe(RUN_TRADES.by_weekday.ci)
  })

  it('has no hour chart for a book, which enters at the close by rule', () => {
    expect(groupLadder(BOOK_TRADES, 'hour', 'nt_volmanaged_v0_fixture_m1')).toBeNull()
    expect(groupLadder(RUN_TRADES, 'hour', 'nt_za_v0_fixture_a')).not.toBeNull()
  })

  it('lists the real-fill slippage groups, with -- where a group is empty', () => {
    const rows = slippageRows(RUN_TRADES)
    expect(rows.map((r) => r.name)).toEqual(RUN_TRADES.slippage.groups.map((g) => g.name))
    const live = rows.find((r) => r.name === 'live close')!
    expect(live.mean).toBe('+1.00')
    expect(live.n).toBe('1')
    expect(rows[0]!.mean).toBe('--')
  })
})

describe('costs (EX3, EX4)', () => {
  it('lists the waterfall steps exactly, the net equal to the run P&L', () => {
    const rows = waterfallRows(RUN_COSTS)
    expect(rows.map((r) => r.step)).toEqual(['gross', 'commissions', 'modelled slippage', 'net'])
    expect(rows.map((r) => r.value)).toEqual(['-3,471.50', '-59.78', '-49.00', '-3,580.28'])
    expect(rows[3]!.total).toBe(true)
  })

  it('draws net P&L against ticks per side and leaves out a break-even outside 0 to 4', () => {
    const ladder = sensitivityLadder(RUN_COSTS, 'nt_volmanaged_v0_fixture_m1')
    expect(ladder.bars.map((b) => b.value)).toEqual(RUN_COSTS.sensitivity.net_usd)
    expect(ladder.bars.map((b) => b.label)).toEqual(['0 t', '1 t', '2 t', '3 t', '4 t'])
    expect(ladder.marker).toBeUndefined()
  })

  it('marks a break-even that lies inside the ladder', () => {
    const costs = { ...RUN_COSTS, sensitivity: { ...RUN_COSTS.sensitivity, break_even_ticks_per_side: 1.5 } }
    expect(sensitivityLadder(costs, 'x').marker).toEqual({ at: 1.5, label: 'break-even 1.50 ticks' })
  })
})

describe('exposure (EX1, EX2)', () => {
  it('stacks gross and net exposure over turnover on the API values', () => {
    const stack = exposureStack(RUN_EXPOSURE, 'nt_volmanaged_v0_fixture_m1')!
    expect(stack.t).toBe(RUN_EXPOSURE.exposure!.t)
    expect(stack.t[0]).toBe(Date.UTC(2011, 5, 3) / 1000)
    expect(stack.panes.map((p) => p.id)).toEqual(['exposure', 'turnover'])
    expect(stack.panes[0]!.series[0]!.values).toBe(RUN_EXPOSURE.exposure!.gross)
    expect(stack.panes[0]!.series[1]!.values).toBe(RUN_EXPOSURE.exposure!.net)
    expect(stack.panes[1]!.series[0]!.values).toBe(RUN_EXPOSURE.turnover!.daily)
  })

  it('against a backend without t, puts the sessions at 00:00 UTC of their dates', () => {
    const { t: _t, ...e } = RUN_EXPOSURE.exposure!
    const stack = exposureStack({ ...RUN_EXPOSURE, exposure: e as typeof RUN_EXPOSURE.exposure }, 'nt_volmanaged_v0_fixture_m1')!
    expect(stack.t).toEqual(RUN_EXPOSURE.exposure!.t)
  })

  it('gives no stack when the run has no exposure', () => {
    expect(exposureStack(NO_EXPOSURE, 'nt_za_v0_fixture_a')).toBeNull()
  })
})
