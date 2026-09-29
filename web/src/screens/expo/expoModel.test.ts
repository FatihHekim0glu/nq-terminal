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

describe('EXPO CSV by instrument (roadmap #13)', () => {
  const withInstruments = (by_instrument: Record<string, Array<number | null>>) =>
    ({ ...VIEW, exposure: { ...VIEW.exposure!, by_instrument } }) as unknown as RunExposure
  const lines = (view: RunExposure) => exposureCsv(view).csv.split('\r\n')

  it('appends one column per instrument after Turnover, sorted by key, named by the key', () => {
    const view = withInstruments({ 'ZN.XCME': [0.3, 0.2, 0.1], 'MNQ.XCME': [0.4, 0.3, 0.2], '6E.XCME': [0.9, 0.8, 0.7], 'ES.XCME': [0.6, 0.5, 0.4] })
    expect(lines(view)[0]).toBe('Session,Gross,Net,Turnover,6E.XCME,ES.XCME,MNQ.XCME,ZN.XCME')
  })

  it('writes each served value at full precision, newest first, paired with the session by index', () => {
    const view = withInstruments({ 'MNQ.XCME': [0.123456789012345, null, 0.1 + 0.2], 'ES.XCME': [0, 0.25, 1e-7] })
    expect(lines(view).slice(1)).toEqual([
      '2012-01-05,,0.1,0.05,1e-7,0.30000000000000004',
      '2012-01-04,1.5,-0.25,0.3,0.25,',
      '2012-01-03,1.2345,0.5,,0,0.123456789012345',
    ])
    expect(exposureCsv(view).rows).toBe(3)
  })

  it('leaves a cell empty where an instrument series is shorter than the sessions', () => {
    const view = withInstruments({ 'ES.XCME': [0.5] })
    expect(lines(view).slice(1)).toEqual(['2012-01-05,,0.1,0.05,', '2012-01-04,1.5,-0.25,0.3,', '2012-01-03,1.2345,0.5,,0.5'])
  })

  it('quotes an instrument key that a CSV would misread, and never runs one as a formula', () => {
    const view = withInstruments({ 'A,B': [1, 2, 3], '=SUM(A1)': [4, 5, 6] })
    expect(lines(view)[0]).toBe('Session,Gross,Net,Turnover,\'=SUM(A1),"A,B"')
  })

  it('keeps the four columns when the API sends no instrument, and for a run without snapshots', () => {
    expect(lines(VIEW)[0]).toBe('Session,Gross,Net,Turnover')
    const none = { ...VIEW, available: false, exposure: null, turnover: null } as RunExposure
    expect(exposureCsv(none)).toEqual({ csv: 'Session,Gross,Net,Turnover', rows: 0 })
  })

  it('does not reorder or mutate the served view', () => {
    const view = withInstruments({ 'ZN.XCME': [1, 2, 3], 'ES.XCME': [4, 5, 6] })
    const before = JSON.stringify(view)
    exposureCsv(view)
    expect(JSON.stringify(view)).toBe(before)
    expect(Object.keys(view.exposure!.by_instrument)).toEqual(['ZN.XCME', 'ES.XCME'])
  })
})
