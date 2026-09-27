import { describe, expect, it } from 'vitest'
import { exposureCsv, sessionRows, summaryRows, type RunExposure } from './expoModel'

const VIEW = {
  run_id: 'r1', tag: '[POST HOC]', available: true, note: null,
  exposure: {
    run_id: 'r1', basis: 'B', unit: 'notional over equity', label: 'l', price_basis: 'p', positions_reconcile: true,
    t: [1, 2, 3], date: ['2012-01-03', '2012-01-04', '2012-01-05'], gross: [1.2345, 1.5, null], net: [0.5, -0.25, 0.1],
    mean_gross: 1.36725, mean_net: 0.1166, by_instrument: {},
  },
  turnover: {
    run_id: 'r1', basis: 'B', unit: 'u', label: 'l', price_basis: 'p', source: 's', periods: 252,
    t: [2, 3], date: ['2012-01-04', '2012-01-05'], daily: [0.3, 0.05], mean_daily: 0.175, annualised: 44.1,
  },
} as unknown as RunExposure

describe('EXPO (EX1, EX2)', () => {
  it('shows the API means, never its own', () => {
    expect(summaryRows(VIEW).map((r) => [r.id, r.value])).toEqual([
      ['meanGross', '1.37'], ['meanNet', '0.12'], ['sessions', '3'],
      ['meanTurnover', '0.18'], ['annualTurnover', '44.10'], ['periods', '252'],
    ])
  })

  it('pairs sessions with turnover by date, newest first, null where the API has none', () => {
    expect(sessionRows(VIEW)).toEqual([
      { date: '2012-01-05', gross: null, net: 0.1, turnover: 0.05 },
      { date: '2012-01-04', gross: 1.5, net: -0.25, turnover: 0.3 },
      { date: '2012-01-03', gross: 1.2345, net: 0.5, turnover: null },
    ])
  })

  it('has no rows for a run without snapshots, and exports the full values', () => {
    const none = { ...VIEW, available: false, exposure: null, turnover: null } as RunExposure
    expect(summaryRows(none)).toEqual([])
    expect(sessionRows(none)).toEqual([])
    const out = exposureCsv(VIEW)
    expect(out.rows).toBe(3)
    expect(out.csv.split('\r\n')[3]).toBe('2012-01-03,1.2345,0.5,')
  })
})
