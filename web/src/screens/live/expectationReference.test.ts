// The browser's client-phase placement (expectationReference.ts, a test reference only) is pinned by
// qa/crosscheck/p12_expectation.py: every case of qa/golden/p12_expectation.json (numpy, searchsorted side='right')
// must come out of it within 1e-12 relative, and the bands, the first index and the beyond count exactly. The served
// placement (GET /api/analytics/paper-expectation) is then checked against it on the captured fixtures, in
// expectationModel.test.ts, and against the same golden file in backend/tests/test_lv6_expectation.py.
import { describe, expect, it } from 'vitest'
import golden from '../../../../qa/golden/p12_expectation.json?raw'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import { CONE_BANDS, coneBand, pathOnCone, type ConeBandName, type PathOnConeInput } from './expectationReference'
import { TRACKING_POPULATED } from './trackingFixtures'

interface GoldenCase {
  readonly name: string
  readonly input: { usd: Array<number | null>; capital: number; quantiles: PathOnConeInput['quantiles']; horizon: number }
  readonly expected: { first_index: number | null; fraction: Array<number | null>; bands: Array<ConeBandName | null>; beyond: number }
}

const GOLDEN = JSON.parse(golden) as { source: string; cases: GoldenCase[] }
const CASES = GOLDEN.cases
const caseNamed = (name: string) => CASES.find((c) => c.name === name)!

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b))

const KEYS = ['5', '25', '50', '75', '95'] as const
const level = (value: number, steps: number): number[] => Array<number>(steps).fill(value)
const flat = (steps: number): PathOnConeInput['quantiles'] => ({
  '5': level(-0.1, steps), '25': level(-0.02, steps), '50': level(0, steps), '75': level(0.03, steps), '95': level(0.05, steps),
})
const place = (usd: Array<number | null>, steps: number, capital = 1000, quantiles = flat(steps)) =>
  pathOnCone({ usd, capital, quantiles, horizon: steps })

describe('pathOnCone against the numpy reference (LV6, [POST HOC])', () => {
  it('reads the golden cases the reference wrote', () => {
    expect(GOLDEN.source).toContain('searchsorted')
    expect(CASES.length).toBeGreaterThanOrEqual(7)
    for (const wanted of ['fixture paper', 'fixture model', 'tie on p25 and p95', 'gap', 'long path', 'missing quantile', 'below p5']) {
      expect(CASES.some((c) => c.name.includes(wanted)), wanted).toBe(true)
    }
  })

  it.each(CASES.map((c) => [c.name, c] as const))('matches the reference on %s', (_name, c) => {
    const got = pathOnCone({ usd: c.input.usd, capital: c.input.capital, quantiles: c.input.quantiles, horizon: c.input.horizon })
    expect(got.firstIndex).toBe(c.expected.first_index)
    expect(got.bands).toEqual(c.expected.bands)
    expect(got.beyond).toBe(c.expected.beyond)
    expect(got.fraction).toHaveLength(c.expected.fraction.length)
    got.fraction.forEach((v, i) => {
      const want = c.expected.fraction[i]!
      if (want === null) expect(v, `fraction[${i}]`).toBeNull()
      else expect(close(v!, want), `fraction[${i}] ${v} vs ${want}`).toBe(true)
    })
  })

  it('copies the web fixtures into the fixture cases, so a changed fixture cannot drift from the reference', () => {
    const paper = caseNamed('fixture paper').input
    const model = caseNamed('fixture model').input
    expect(paper.usd).toEqual(TRACKING_POPULATED.paper_cumulative)
    expect(model.usd).toEqual(TRACKING_POPULATED.model_cumulative)
    expect(paper.capital).toBe(RUN_ANALYTICS.capital)
    for (const key of KEYS) {
      expect(paper.quantiles[key]).toEqual(HYP_BOOTSTRAP.cone.quantiles[key]!.slice(0, paper.horizon))
    }
  })

  it('places the fixture paper and model paths at their first two steps in the p50 to p75 band', () => {
    const paper = caseNamed('fixture paper').input
    const got = pathOnCone({ usd: paper.usd, capital: paper.capital, quantiles: paper.quantiles, horizon: paper.horizon })
    expect(got.firstIndex).toBe(3)
    expect(got.fraction).toEqual([12 / 1_000_000, 6 / 1_000_000, null, null, null])
    expect(got.bands).toEqual(['p50to75', 'p50to75', null, null, null])
  })
})

describe('pathOnCone on its own edge cases (the same rules as the reference)', () => {
  it('puts step k at index first + k - 1 and leaves the steps the path has not reached empty', () => {
    const got = place([null, null, 250, -500, 125], 4)
    expect(got.firstIndex).toBe(2)
    expect(got.fraction).toEqual([0.25, -0.5, 0.125, null])
    expect(got.beyond).toBe(0)
  })

  it('puts a value exactly on a percentile in the band above it', () => {
    expect(place([-20, 50], 2).bands).toEqual(['p25to50', 'above95'])
    expect(place([-100, -20, 0, 30, 50], 5).bands).toEqual(['p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('names the tails', () => {
    expect(place([-101, 51, -99], 3).bands).toEqual(['below5', 'above95', 'p5to25'])
  })

  it('gives a gap no fraction and no band, and counts only rows with a value past the horizon', () => {
    const gap = place([null, 10, null, 30, 40], 4)
    expect(gap.fraction).toEqual([0.01, null, 0.03, 0.04])
    expect(gap.bands).toEqual(['p50to75', null, 'p75to95', 'p75to95'])
    expect(place([null, 5, 10, 15, 20, null, 30], 3).beyond).toBe(2)
  })

  it('treats a non-finite value as a gap', () => {
    expect(place([10, Number.NaN, Number.POSITIVE_INFINITY], 3).fraction).toEqual([0.01, null, null])
  })

  it('leaves a step unplaced when a percentile is missing there, short, or the percentiles cross', () => {
    const q = flat(3)
    const missing = { ...q, '50': [0, null, 0], '95': [0.05, 0.05] }
    const got = pathOnCone({ usd: [10, 10, 10], capital: 1000, quantiles: missing, horizon: 3 })
    expect(got.fraction).toEqual([0.01, 0.01, 0.01])
    expect(got.bands).toEqual(['p50to75', null, null])
    const crossing = { ...flat(2), '25': [-0.02, 0.06] }
    expect(pathOnCone({ usd: [10, 10], capital: 1000, quantiles: crossing, horizon: 2 }).bands).toEqual(['p50to75', null])
  })

  it('tolerates a percentile line that is absent altogether', () => {
    const { '75': _dropped, ...rest } = flat(2)
    const got = pathOnCone({ usd: [10, 10], capital: 1000, quantiles: rest as PathOnConeInput['quantiles'], horizon: 2 })
    expect(got.bands).toEqual([null, null])
  })

  it('has no first index and nothing placed for a path with no value, and copes with a zero horizon', () => {
    expect(place([null, null], 3)).toEqual({ firstIndex: null, fraction: [null, null, null], bands: [null, null, null], beyond: 0 })
    expect(place([], 0)).toEqual({ firstIndex: null, fraction: [], bands: [], beyond: 0 })
    expect(place([5], 0)).toEqual({ firstIndex: 0, fraction: [], bands: [], beyond: 1 })
  })

  it.each([0, -1, -1_000_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('throws on a capital of %s', (capital) => {
    expect(() => place([1], 1, capital)).toThrow(/capital/)
  })

  it.each([-1, 1.5, Number.NaN])('throws on a horizon of %s', (horizon) => {
    expect(() => pathOnCone({ usd: [1], capital: 1000, quantiles: flat(1), horizon })).toThrow(/horizon/)
  })

  it('does not change what it is given', () => {
    const usd = [null, 10]
    const quantiles = flat(1)
    const before = JSON.stringify({ usd, quantiles })
    pathOnCone({ usd, capital: 1000, quantiles, horizon: 1 })
    expect(JSON.stringify({ usd, quantiles })).toBe(before)
  })
})

describe('coneBand', () => {
  const q = [-0.1, -0.02, 0, 0.03, 0.05] as const

  it('lists the bands in placement order', () => {
    expect(CONE_BANDS).toEqual(['below5', 'p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('is the count of percentiles at or below the value, named', () => {
    expect(coneBand(-0.2, q)).toBe('below5')
    expect(coneBand(-0.05, q)).toBe('p5to25')
    expect(coneBand(-0.01, q)).toBe('p25to50')
    expect(coneBand(0.01, q)).toBe('p50to75')
    expect(coneBand(0.04, q)).toBe('p75to95')
    expect(coneBand(0.06, q)).toBe('above95')
  })

  it('puts a tie on any percentile in the band above it', () => {
    expect(q.map((p) => coneBand(p, q))).toEqual(['p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('handles percentiles that coincide', () => {
    expect(coneBand(0, [-1, 0, 0, 0, 1])).toBe('p75to95')
    expect(coneBand(-1, [-1, -1, -1, -1, -1])).toBe('above95')
  })

  it('gives null for a value or a percentile that is not a finite number, or percentiles that are not ascending', () => {
    expect(coneBand(Number.NaN, q)).toBeNull()
    expect(coneBand(Number.POSITIVE_INFINITY, q)).toBeNull()
    expect(coneBand(0, [-0.1, Number.NaN, 0, 0.03, 0.05])).toBeNull()
    expect(coneBand(0, [-0.1, 0.02, 0, 0.03, 0.05])).toBeNull()
  })
})
