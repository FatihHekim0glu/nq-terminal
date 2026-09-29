// trackYears, minimumDetectableSharpe and powerAtSharpe against the scipy golden vectors from
// qa/crosscheck/p12_power.py, the anchors in the brief, and the two variants that must stay wrong: annualising with
// 365 and testing two-sided.
import { describe, expect, it } from 'vitest'
import raw from '../../../qa/golden/p12_power.json?raw'
import { normalCdf, normalQuantile } from './normal'
import { minimumDetectableSharpe, powerAtSharpe, trackYears } from './power'

type MdeRow = { n: number; periods: number; alpha: number; power: number; value: number }
type PowerRow = { sharpe: number; n: number; periods: number; alpha: number; value: number }
const GOLDEN = JSON.parse(raw) as { mde: MdeRow[]; power: PowerRow[] }

const BONFERRONI = 0.05 / 21

function relativeError(got: number, want: number): number {
  return Math.abs(got - want) / Math.max(Math.abs(want), 1e-300)
}

describe('golden vectors', () => {
  it('holds 24 (n, periods) pairs at two alphas with two powers and four Sharpe ratios', () => {
    expect(GOLDEN.mde).toHaveLength(24 * 2 * 2)
    expect(GOLDEN.power).toHaveLength(24 * 2 * 4)
  })

  it('minimumDetectableSharpe matches scipy to 1e-12 on every row', () => {
    for (const row of GOLDEN.mde) {
      const got = minimumDetectableSharpe(row.n, row.periods, row.alpha, row.power)
      expect(relativeError(got, row.value), JSON.stringify(row)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('powerAtSharpe matches scipy to 1e-12 on every row', () => {
    for (const row of GOLDEN.power) {
      const got = powerAtSharpe(row.sharpe, row.n, row.periods, row.alpha)
      expect(relativeError(got, row.value), JSON.stringify(row)).toBeLessThanOrEqual(1e-12)
    }
  })
})

describe('anchors', () => {
  it('2836 sessions at 252 a year: 0.7412 at 5% and 1.0923 (not 1.0922) at 5% / 21', () => {
    expect(minimumDetectableSharpe(2836, 252, 0.05, 0.8).toFixed(4)).toBe('0.7412')
    expect(minimumDetectableSharpe(2836, 252, BONFERRONI, 0.8).toFixed(4)).toBe('1.0923')
    expect(minimumDetectableSharpe(2836, 252, BONFERRONI, 0.8)).not.toBeCloseTo(1.0922, 4)
  })

  it('volmanaged_v0 (2686 sessions): 0.7616 and 1.1224', () => {
    expect(minimumDetectableSharpe(2686, 252, 0.05, 0.8).toFixed(4)).toBe('0.7616')
    expect(minimumDetectableSharpe(2686, 252, BONFERRONI, 0.8).toFixed(4)).toBe('1.1224')
  })

  it('agrees with the hand formula (z(0.95) + z(0.8)) / sqrt(n / periods)', () => {
    const byHand = (1.6448536269514722 + 0.8416212335729143) / Math.sqrt(2836 / 252)
    expect(relativeError(minimumDetectableSharpe(2836, 252, 0.05, 0.8), byHand)).toBeLessThanOrEqual(1e-14)
  })

  it('power at Sharpe 0 is alpha, and 50% power sits at z(1 - alpha) / sqrt(years)', () => {
    expect(relativeError(powerAtSharpe(0, 2836, 252, 0.05), 0.05)).toBeLessThanOrEqual(1e-13)
    const half = minimumDetectableSharpe(2836, 252, 0.05, 0.5)
    expect(relativeError(half, 1.6448536269514722 / Math.sqrt(2836 / 252))).toBeLessThanOrEqual(1e-14)
    expect(relativeError(powerAtSharpe(half, 2836, 252, 0.05), 0.5)).toBeLessThanOrEqual(1e-13)
  })

  it('keeps the digits of a tiny alpha, where 1 - alpha would round to 1 (z(1e-20) = 9.262340089798409 from scipy)', () => {
    expect(relativeError(minimumDetectableSharpe(4, 1, 1e-20, 0.5), 9.262340089798409 / 2)).toBeLessThanOrEqual(1e-14)
    expect(Number.isFinite(minimumDetectableSharpe(2836, 252, 1e-300, 0.8))).toBe(true)
    expect(powerAtSharpe(0, 2836, 252, 1e-20)).toBeCloseTo(1e-20, 30)
  })

  it('power at Sharpe 0.5 on 2836 sessions is about 0.513, by hand', () => {
    const byHand = normalCdf(0.5 * Math.sqrt(2836 / 252) - normalQuantile(0.95))
    expect(powerAtSharpe(0.5, 2836, 252, 0.05)).toBeCloseTo(byHand, 14)
    expect(powerAtSharpe(0.5, 2836, 252, 0.05)).toBeCloseTo(0.513, 3)
  })
})

describe('trackYears', () => {
  it('is n / periods', () => {
    expect(trackYears(2836, 252)).toBeCloseTo(11.253968253968255, 12)
    expect(trackYears(120, 12)).toBe(10)
    expect(trackYears(252, 252)).toBe(1)
    expect(trackYears(0, 252)).toBe(0)
  })

  it('is NaN for a negative or non-finite n and for periods that are not positive and finite', () => {
    for (const [n, periods] of [[-1, 252], [Number.NaN, 252], [Infinity, 252], [100, 0], [100, -12], [100, Number.NaN], [100, Infinity]]) {
      expect(trackYears(n as number, periods as number), `${n}, ${periods}`).toBeNaN()
    }
  })
})

describe('round trip and monotony', () => {
  it('powerAtSharpe inverts minimumDetectableSharpe on every golden row', () => {
    for (const row of GOLDEN.mde) {
      const back = powerAtSharpe(minimumDetectableSharpe(row.n, row.periods, row.alpha, row.power), row.n, row.periods, row.alpha)
      expect(relativeError(back, row.power), JSON.stringify(row)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('the detectable Sharpe falls as observations grow and rises with power and with a stricter alpha', () => {
    const sizes = [2, 10, 60, 120, 500, 2836, 10000].map((n) => minimumDetectableSharpe(n, 252, 0.05, 0.8))
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]!).toBeLessThan(sizes[i - 1]!)
    const powers = [0.1, 0.5, 0.8, 0.95, 0.99].map((power) => minimumDetectableSharpe(2836, 252, 0.05, power))
    for (let i = 1; i < powers.length; i += 1) expect(powers[i]!).toBeGreaterThan(powers[i - 1]!)
    const alphas = [0.2, 0.05, 0.05 / 21, 1e-6].map((alpha) => minimumDetectableSharpe(2836, 252, alpha, 0.8))
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]!).toBeGreaterThan(alphas[i - 1]!)
  })

  it('120 sessions span under half a year and need a larger Sharpe ratio than 120 months (ten years)', () => {
    expect(minimumDetectableSharpe(120, 252, 0.05, 0.8)).toBeGreaterThan(minimumDetectableSharpe(120, 12, 0.05, 0.8))
    expect(minimumDetectableSharpe(120, 12, 0.05, 0.8)).toBeCloseTo(0.7863, 4)
  })

  it('power rises with the Sharpe ratio and with observations, and falls with a stricter alpha', () => {
    const sharpes = [-1, -0.25, 0, 0.25, 0.5, 1, 2].map((s) => powerAtSharpe(s, 2836, 252, 0.05))
    for (let i = 1; i < sharpes.length; i += 1) expect(sharpes[i]!).toBeGreaterThan(sharpes[i - 1]!)
    const sizes = [10, 100, 1000, 10000].map((n) => powerAtSharpe(0.5, n, 252, 0.05))
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!)
    const alphas = [0.2, 0.05, 0.05 / 21, 1e-6].map((alpha) => powerAtSharpe(0.5, 2836, 252, alpha))
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]!).toBeLessThan(alphas[i - 1]!)
    expect(powerAtSharpe(-0.5, 2836, 252, 0.05)).toBeLessThan(0.05)
  })

  it('stays inside [0, 1] and finite on extreme but valid input', () => {
    expect(powerAtSharpe(50, 10000, 252, 0.05)).toBe(1)
    const low = powerAtSharpe(-50, 10000, 252, 0.05)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(low).toBeLessThan(1e-300)
    expect(Number.isFinite(minimumDetectableSharpe(2, 252, 1e-12, 0.999999))).toBe(true)
  })
})

describe('born failing: the two wrong set-ups', () => {
  const mde = minimumDetectableSharpe(2836, 252, 0.05, 0.8)

  it('annualising with sqrt(365) instead of the periods per year gives a different (wrong) number', () => {
    const sqrt365 = (normalQuantile(0.95) + normalQuantile(0.8)) / Math.sqrt(2836 / 365)
    expect(sqrt365).toBeCloseTo(0.8921, 3)
    expect(Math.abs(mde - sqrt365)).toBeGreaterThan(0.1)
    expect(powerAtSharpe(0.5, 2836, 252, 0.05)).not.toBeCloseTo(normalCdf(0.5 * Math.sqrt(2836 / 365) - normalQuantile(0.95)), 2)
  })

  it('a two-sided test (z(1 - alpha / 2)) gives a different (wrong) number', () => {
    const twoSided = (normalQuantile(0.975) + normalQuantile(0.8)) / Math.sqrt(2836 / 252)
    expect(twoSided).toBeCloseTo(0.8351, 3)
    expect(Math.abs(mde - twoSided)).toBeGreaterThan(0.05)
    expect(powerAtSharpe(0.5, 2836, 252, 0.05)).not.toBeCloseTo(normalCdf(0.5 * Math.sqrt(2836 / 252) - normalQuantile(0.975)), 2)
  })

  it('the anchors stay tied to the one-sided, periods-based set-up', () => {
    expect(mde.toFixed(4)).toBe('0.7412')
    expect(mde.toFixed(4)).not.toBe('0.8921')
    expect(mde.toFixed(4)).not.toBe('0.8351')
  })
})

describe('NaN on invalid input', () => {
  it('minimumDetectableSharpe: n <= 1, periods <= 0, alpha or power outside (0, 1), non-finite', () => {
    const bad: [number, number, number, number][] = [
      [1, 252, 0.05, 0.8],
      [0, 252, 0.05, 0.8],
      [-5, 252, 0.05, 0.8],
      [Number.NaN, 252, 0.05, 0.8],
      [Infinity, 252, 0.05, 0.8],
      [2836, 0, 0.05, 0.8],
      [2836, -252, 0.05, 0.8],
      [2836, Number.NaN, 0.05, 0.8],
      [2836, Infinity, 0.05, 0.8],
      [2836, 252, 0, 0.8],
      [2836, 252, 1, 0.8],
      [2836, 252, -0.05, 0.8],
      [2836, 252, 1.5, 0.8],
      [2836, 252, Number.NaN, 0.8],
      [2836, 252, 0.05, 0],
      [2836, 252, 0.05, 1],
      [2836, 252, 0.05, -0.1],
      [2836, 252, 0.05, 1.2],
      [2836, 252, 0.05, Number.NaN],
    ]
    for (const args of bad) expect(minimumDetectableSharpe(...args), args.join(', ')).toBeNaN()
  })

  it('minimumDetectableSharpe accepts the smallest valid input', () => {
    expect(Number.isFinite(minimumDetectableSharpe(1.5, 252, 0.05, 0.8))).toBe(true)
    expect(Number.isFinite(minimumDetectableSharpe(2, 1, 1e-300, 1 - 1e-12))).toBe(true)
  })

  it('powerAtSharpe: a non-finite Sharpe ratio, n <= 1, periods <= 0, alpha outside (0, 1), non-finite', () => {
    const bad: [number, number, number, number][] = [
      [Number.NaN, 2836, 252, 0.05],
      [Infinity, 2836, 252, 0.05],
      [-Infinity, 2836, 252, 0.05],
      [0.5, 1, 252, 0.05],
      [0.5, 0, 252, 0.05],
      [0.5, Number.NaN, 252, 0.05],
      [0.5, Infinity, 252, 0.05],
      [0.5, 2836, 0, 0.05],
      [0.5, 2836, -12, 0.05],
      [0.5, 2836, Number.NaN, 0.05],
      [0.5, 2836, 252, 0],
      [0.5, 2836, 252, 1],
      [0.5, 2836, 252, -0.05],
      [0.5, 2836, 252, 2],
      [0.5, 2836, 252, Number.NaN],
    ]
    for (const args of bad) expect(powerAtSharpe(...args), args.join(', ')).toBeNaN()
  })
})
