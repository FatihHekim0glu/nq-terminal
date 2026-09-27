import { describe, expect, it } from 'vitest'
import { instrumentRows, runCostsCsv, sensitivityRows, type RunCosts } from './runCosts'

const COSTS: RunCosts = {
  run_id: 'r1',
  tag: '[POST HOC]',
  waterfall: {
    run_id: 'r1', unit: 'USD', label: 'x', ticks: 1, sides: 62, gross: 61539.375, commissions: 155, slippage: 726.25,
    net: 60658.125, costs_total: 881.25,
    rows: [{ step: 'gross', value: 61539.375 }, { step: 'commissions', value: -155 }, { step: 'modelled slippage', value: -726.25 }, { step: 'net', value: 60658.125 }],
    by_instrument: [{ instrument: 'ES.XCME', sides: 20, commissions: 50, slippage: 250 }, { instrument: 'ZN.XCME', sides: 1234, commissions: 1000.5, slippage: 476.25 }],
  },
  sensitivity: {
    run_id: 'r1', unit: 'USD', label: 'y', ticks: [0, 1, 2], net_usd: [61384.375, 60658.125, null as unknown as number],
    net_pct_of_k: [0.0006138, 0.0006066, 0.0005993], run_ticks: 1, cost_per_tick_usd: 726.25, break_even_ticks_per_side: 84.5,
  },
} as unknown as RunCosts

describe('COST for a run (EX3, EX4)', () => {
  it('prints the costs by instrument with thousands separators', () => {
    expect(instrumentRows(COSTS)).toEqual([
      { instrument: 'ES.XCME', sides: '20', commissions: '50.00', slippage: '250.00' },
      { instrument: 'ZN.XCME', sides: '1,234', commissions: '1,000.50', slippage: '476.25' },
    ])
  })

  it('prints each sensitivity rung, marks the run\'s own and shows a missing value as --', () => {
    const rows = sensitivityRows(COSTS)
    expect(rows.map((r) => r.usd)).toEqual(['61,384.38', '60,658.13', '--'])
    expect(rows.map((r) => r.pct)).toEqual(['0.06%', '0.06%', '0.06%'])
    expect(rows.map((r) => r.charged)).toEqual([false, true, false])
    // The run's own rung equals the waterfall's net.
    expect(COSTS.sensitivity.net_usd[1]).toBe(COSTS.waterfall.net)
  })

  it('exports every table at full precision', () => {
    const out = runCostsCsv(COSTS)
    expect(out.rows).toBe(4 + 6 + 3 + 3)
    expect(out.csv.split('\r\n')[1]).toBe('waterfall,gross,61539.375')
    expect(out.csv).toContain('slippage,ZN.XCME,476.25')
    expect(out.csv).toContain('net_usd_at_ticks,2,')
  })
})
