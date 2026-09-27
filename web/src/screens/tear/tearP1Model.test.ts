import { describe, expect, it } from 'vitest'
import { TEAR_P1 } from '../../copy/tearP1'
import {
  bootstrapLine, captureRows, cfRows, coneInput, intervalRows, jarqueBeraRows, qqInput, ratioTiles, regimeRows, relativeEmpty, relativeStack,
  scatterInput, stressMonthlyNote, stressRows, unlabelledLine, welchLine,
} from './tearP1Model'
import { HYP_ANALYTICS, HYP_BOOTSTRAP, HYP_EXTENDED, RUN_EXTENDED } from './tearP1.fixtures'

describe('SV5 and SV6', () => {
  it('lists the Sharpe, CAGR and max drawdown intervals in their own units', () => {
    const rows = intervalRows(HYP_BOOTSTRAP)
    expect(rows.map((r) => r.label)).toEqual(['Sharpe', 'CAGR', 'Max drawdown'])
    const [sharpe, cagr, dd] = rows
    expect(sharpe).toMatchObject({ point: '-3.72', interval: '-8.67 to +1.26', median: '-3.75', sd: '2.51', undefinedNote: null })
    expect(cagr).toMatchObject({ point: '-41.66%', interval: '-73.74% to +17.29%' })
    expect(dd).toMatchObject({ point: '-9.49%', interval: '-19.61% to -3.40%' })
  })

  it('says how many replications left a statistic undefined, only when some did', () => {
    const some = { ...HYP_BOOTSTRAP, intervals: HYP_BOOTSTRAP.intervals.map((i) => (i.statistic === 'cagr' ? { ...i, undefined: 12 } : i)) }
    expect(intervalRows(some)[1]!.undefinedNote).toBe('CAGR: 12 replications where it is not defined, left out and counted.')
  })

  it('born failing: prints the undefined count once when the API already says it in its own note', () => {
    const noted = { ...HYP_BOOTSTRAP, intervals: HYP_BOOTSTRAP.intervals.map((i) => (i.statistic === 'sharpe' ? { ...i, undefined: 321, note: '321 replications without a defined value were left out' } : i)) }
    const sharpe = intervalRows(noted)[0]!
    expect(sharpe.note).toBe('321 replications without a defined value were left out')
    expect(sharpe.undefinedNote).toBeNull()
  })

  it('states the method, the block length, the replications and the seed', () => {
    expect(bootstrapLine(HYP_BOOTSTRAP)).toBe(
      `${HYP_BOOTSTRAP.method}. Block length 1.04 (stationary, Politis-White), 10,000 replications, seed 20260927, 95% percentile interval.`,
    )
  })

  it('turns the cone into display units, with the realised path and its dates', () => {
    const cone = coneInput(HYP_BOOTSTRAP, 'volmanaged_v0')
    expect(cone.label).toBe('resampled history, not a forecast; pointwise percentiles at each horizon, not a band that whole paths stay inside')
    expect(cone.unit).toBe('%')
    expect(cone.steps).toHaveLength(39)
    expect(cone.bands.map((b) => b.p)).toEqual([5, 25, 50, 75, 95])
    expect(cone.bands[0]!.values[0]).toBeCloseTo(HYP_BOOTSTRAP.cone.quantiles['5']![0]! * 100, 12)
    expect(cone.realised[0]).toBeCloseTo(HYP_BOOTSTRAP.cone.realised[0]! * 100, 12)
    expect(cone.realisedDates[0]).toBe('2011-04-25')
  })

})

describe('RET additions', () => {
  it('shows PF7 to PF9 as tiles in the API order with their basis and tag', () => {
    const tiles = ratioTiles(HYP_EXTENDED)
    expect(tiles.map((t) => [t.kpi.key, t.kpi.label, t.kpi.tag, t.kpi.basis])).toEqual([
      ['omega', 'Omega (0)', '[POST HOC]', 'A'], ['tail_ratio', 'Tail ratio', '[POST HOC]', 'A'], ['gain_to_pain', 'Gain to pain (monthly)', '[POST HOC]', 'A'],
    ])
    expect(tiles[0]!.kpi.value).toBe(HYP_EXTENDED.ratios[0]!.value)
  })

  it('born failing: outside its monotone domain Cornish-Fisher is not defined and the historical VaR stands beside it', () => {
    const rows = cfRows(HYP_EXTENDED.cornish_fisher_var)
    expect(rows.map((r) => r.level)).toEqual(['95%', '99%'])
    const [r95] = rows
    const l95 = HYP_EXTENDED.cornish_fisher_var.levels[0]!
    expect(l95.in_domain).toBe(false)
    expect(l95.value).toBe(l95.historical)
    expect(r95).toMatchObject({ cornishFisher: TEAR_P1.cf.notDefined, historical: '1.76%', value: '1.76%', normal: '1.63%', greyed: true, used: TEAR_P1.cf.usedHistorical })
    expect(r95!.value).not.toBe(r95!.normal)
    expect(r95!.raw).toBe('1.73%')
  })

  it('uses the Cornish-Fisher value inside the domain', () => {
    const cf = HYP_EXTENDED.cornish_fisher_var
    const inside = { ...cf, levels: cf.levels.map((l) => ({ ...l, in_domain: true, cornish_fisher: 0.02, value: 0.02 })) }
    expect(cfRows(inside)[0]).toMatchObject({ cornishFisher: '2.00%', value: '2.00%', greyed: false, used: TEAR_P1.cf.usedCf })
  })

  it('gives Jarque-Bera on the whole series with its p-value and n', () => {
    expect(jarqueBeraRows(HYP_EXTENDED).map((r) => [r.id, r.value])).toEqual([
      ['statistic', '1.25'], ['p', '0.5354'], ['n', '39'],
    ])
  })

  it('names the QQ fit slope unit, so a reader comparing it with the API sees why it is 100 times larger', () => {
    const qq = qqInput(HYP_ANALYTICS, 'volmanaged_v0')!
    expect(qq.line!.slopeUnit).toBe('% per unit z')
  })

  it('draws RD3 from the P0 QQ data in display units with the probplot line', () => {
    const qq = qqInput(HYP_ANALYTICS, 'volmanaged_v0')!
    const q = HYP_ANALYTICS.distribution.qq
    expect(qq.points).toHaveLength(q.theoretical.length)
    expect(qq.points[0]!.x).toBe(q.theoretical[0])
    expect(qq.points[0]!.y).toBeCloseTo(q.ordered[0]! * 100, 12)
    expect(qq.line!.slope).toBeCloseTo(q.slope! * 100, 12)
    expect(qq.y.unit).toBe('%')
  })

  it('lists the frozen stress windows with the strategy, NQ and the benchmark, never a p-value', () => {
    const rows = stressRows(HYP_EXTENDED)
    expect(rows.map((r) => r.label)).toEqual(HYP_EXTENDED.stress.rows.map((r) => r.label))
    expect(rows[0]).toMatchObject({ window: '2020-02-19 to 2020-03-20', nq: '-28.85%', strategy: '--', n: '0', covered: '--', spent: false })
    expect(Object.keys(rows[0]!)).not.toContain('p')
    expect(stressMonthlyNote(HYP_EXTENDED)).toBeNull()
  })

  it('names the rows a window covers, and says so for a monthly book (every month it overlaps)', () => {
    const covid = { ...HYP_EXTENDED.stress.rows[0]!, n: 2, covered_from: '2020-02-28', covered_to: '2020-03-31', strategy_return: 0.01 }
    const monthly = { ...HYP_EXTENDED.stress, monthly_note: 'monthly book: each window holds every month it overlaps', rows: [covid] }
    const ext = { ...HYP_EXTENDED, stress: monthly }
    expect(stressRows(ext)[0]!.covered).toBe('2020-02-28 to 2020-03-31')
    expect(stressMonthlyNote(ext)).toBe('monthly book: each window holds every month it overlaps.')
  })

  it('marks a spent row', () => {
    const spent = { ...HYP_EXTENDED.stress.rows[0]!, label: '2022 bear market', spent: true, n: 250, strategy_return: -0.05, bench_return: -0.2, strategy_max_drawdown: -0.159 }
    const rows = stressRows({ ...HYP_EXTENDED, stress: { ...HYP_EXTENDED.stress, rows: [spent] } })
    expect(rows[0]).toMatchObject({ spent: true, strategy: '-5.00%', bench: '-20.00%', maxDd: '-15.90%', n: '250' })
  })
})

describe('RR additions', () => {
  it('draws rolling beta and rolling correlation on the strategy sessions', () => {
    const spec = relativeStack(HYP_EXTENDED, 'volmanaged_v0')!
    expect(spec.t).toBe(HYP_EXTENDED.rolling_relative!.t)
    expect(spec.panes.map((p) => p.id)).toEqual(['beta', 'correlation'])
    expect(spec.panes[0]!.series[0]!.values).toBe(HYP_EXTENDED.rolling_relative!.beta)
    expect(relativeStack(RUN_EXTENDED, 'nt_volmanaged_v0_fixture_m1')).toBeNull()
  })

  it('says why the rolling panes are empty when the series is shorter than the window', () => {
    expect(relativeEmpty(HYP_EXTENDED)).toBe(
      'Rolling beta and correlation need 126 sessions with a benchmark; this series has 39, so there is no rolling value to draw.',
    )
    const r = HYP_EXTENDED.rolling_relative!
    expect(relativeEmpty({ ...HYP_EXTENDED, rolling_relative: { ...r, beta: r.beta.map((_, i) => (i === 5 ? 1 : null)) } })).toBeNull()
    expect(relativeEmpty(RUN_EXTENDED)).toBeNull()
  })

  it('shows up and down capture with the sessions behind each', () => {
    expect(captureRows(HYP_EXTENDED).map((r) => [r.id, r.value])).toEqual([
      ['up', '0.991'], ['down', '1.002'], ['upN', '17'], ['downN', '22'],
    ])
    expect(captureRows(RUN_EXTENDED)).toEqual([])
  })

  it('scatters strategy against benchmark with BR1 line in display units', () => {
    const s = scatterInput(HYP_EXTENDED, 'volmanaged_v0')!
    const src = HYP_EXTENDED.scatter!
    expect(s.points).toHaveLength(src.n)
    expect(s.points[0]).toMatchObject({ label: src.date[0] })
    expect(s.points[0]!.x).toBeCloseTo(src.x[0]! * 100, 12)
    expect(s.line!.slope).toBeCloseTo(src.slope!, 12)
    expect(s.line!.intercept).toBeCloseTo(src.intercept! * 100, 12)
    expect(scatterInput(RUN_EXTENDED, 'x')).toBeNull()
  })

  it('lists the regimes with Welch t and no p-value', () => {
    const rows = regimeRows(HYP_EXTENDED)
    expect(rows.map((r) => r.regime)).toEqual(['low', 'mid', 'high'])
    expect(rows[0]).toMatchObject({ n: '0', mean: '--', sharpe: '--', hit: '--' })
    expect(welchLine(HYP_EXTENDED)).toContain(TEAR_P1.regimes.noP)
  })
})

describe('RG1 counts', () => {
  it('groups thousands in the unlabelled count, as the Observations row does', () => {
    const g = { ...HYP_EXTENDED.regimes!, unlabelled: 2825 }
    expect(unlabelledLine({ ...HYP_EXTENDED, regimes: g })).toBe('Sessions without a regime (fewer than 252 earlier values): 2,825.')
  })
})
