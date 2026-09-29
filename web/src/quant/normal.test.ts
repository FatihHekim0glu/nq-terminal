// normalCdf (Cody CALERF) and normalQuantile (Wichura AS241) against the scipy golden vectors from
// qa/crosscheck/p12_power.py, plus independent checks that need no golden file: the region borders, a series and a
// continued fraction, the round trip and the symmetry.
import { describe, expect, it } from 'vitest'
import raw from '../../../qa/golden/p12_power.json?raw'
import { normalCdf, normalQuantile } from './normal'

type Golden = {
  cdf: { x: number; value: number }[]
  quantile: { p: number; value: number }[]
}
const GOLDEN = JSON.parse(raw) as Golden

/** Relative distance, with a floor so that values near zero do not divide by nothing. */
function relativeError(got: number, want: number, floor = 1e-300): number {
  return Math.abs(got - want) / Math.max(Math.abs(want), floor)
}

/** Upper tail of the standard normal for x >= 3 by Laplace's continued fraction (independent of Cody's fits). */
function upperTailByFraction(x: number): number {
  let fraction = x
  for (let k = 400; k >= 1; k -= 1) fraction = x + k / fraction
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) / fraction
}

/** Phi(x) for 0 <= x <= 3 by the all-positive series 0.5 + phi(x) (x + x^3/3 + x^5/15 + ...). */
function cdfBySeries(x: number): number {
  let term = x
  let sum = x
  for (let k = 1; k < 200; k += 1) {
    term *= (x * x) / (2 * k + 1)
    sum += term
  }
  return 0.5 + (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * sum
}

describe('golden vectors', () => {
  it('holds the vectors the brief lists', () => {
    expect(GOLDEN.cdf).toHaveLength(16)
    expect(GOLDEN.quantile).toHaveLength(18)
  })

  it.each(GOLDEN.cdf.map((row) => [row.x, row.value] as const))('normalCdf(%s) matches scipy to 1e-13 relative', (x, want) => {
    expect(relativeError(normalCdf(x), want)).toBeLessThanOrEqual(1e-13)
  })

  it.each(GOLDEN.quantile.map((row) => [row.p, row.value] as const))('normalQuantile(%s) matches scipy to 1e-12', (p, want) => {
    expect(Math.abs(normalQuantile(p) - want)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want)))
  })
})

describe('the textbook values are not the rounded ones', () => {
  it('normalQuantile(0.95) is 1.6448536269514722, not 1.645', () => {
    expect(Math.abs(normalQuantile(0.95) - 1.6448536269514722)).toBeLessThanOrEqual(1e-14)
    expect(Math.abs(normalQuantile(0.95) - 1.645)).toBeGreaterThan(1e-4)
  })

  it('normalCdf(1.645) is not 0.95', () => {
    expect(Math.abs(normalCdf(1.645) - 0.95)).toBeGreaterThan(1e-5)
    expect(Math.abs(normalCdf(1.6448536269514722) - 0.95)).toBeLessThanOrEqual(1e-15)
  })

  it('the two-sided 5% point is 1.959963984540054', () => {
    expect(Math.abs(normalQuantile(0.975) - 1.959963984540054)).toBeLessThanOrEqual(1e-14)
    expect(Math.abs(normalCdf(-1.959963984540054) - 0.025)).toBeLessThanOrEqual(1e-16)
  })
})

describe('normalCdf against independent computations', () => {
  it('agrees with the series across the centre, both sides of the 0.67448975 border', () => {
    for (const x of [0, 1e-9, 0.1, 0.5, 0.67448974, 0.67448975, 0.67448976, 0.7, 1, 1.5, 2, 2.5, 3]) {
      expect(Math.abs(normalCdf(x) - cdfBySeries(x)), `x = ${x}`).toBeLessThanOrEqual(2e-16 * 4)
      expect(Math.abs(normalCdf(-x) - (1 - cdfBySeries(x))), `x = -${x}`).toBeLessThanOrEqual(2e-16 * 4)
    }
  })

  it('agrees with the continued fraction in the tail, both sides of the sqrt(32) border', () => {
    for (const x of [3, 3.5, 4, 5, 5.65, 5.656854, 5.656855, 5.7, 6, 7, 8, 9, 10, 20, 30, 37]) {
      expect(relativeError(normalCdf(-x), upperTailByFraction(x)), `x = -${x}`).toBeLessThanOrEqual(1e-13)
    }
  })

  it('is exactly 0.5 at zero and keeps the sign of the tail', () => {
    expect(normalCdf(0)).toBe(0.5)
    expect(normalCdf(-0)).toBe(0.5)
    expect(normalCdf(-1e-300)).toBeCloseTo(0.5, 15)
  })

  it('satisfies Phi(x) + Phi(-x) = 1 to rounding', () => {
    for (const x of [1e-8, 0.3, 1, 2.5, 4, 6, 8]) {
      expect(Math.abs(normalCdf(x) + normalCdf(-x) - 1), `x = ${x}`).toBeLessThanOrEqual(2.3e-16)
    }
  })

  it('is strictly increasing over a fine grid of 20,001 points and stays in [0, 1]', () => {
    let previous = -Infinity
    for (let i = 0; i <= 20000; i += 1) {
      const x = -10 + i / 1000
      const value = normalCdf(x)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      if (x <= 6) expect(value, `x = ${x}`).toBeGreaterThan(previous)
      else expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('reaches the smallest doubles in the far tail and never goes negative', () => {
    expect(normalCdf(-37.5)).toBeGreaterThan(0)
    expect(normalCdf(-37.5)).toBeLessThan(1e-307)
    expect(normalCdf(-38)).toBeGreaterThanOrEqual(0)
    expect(normalCdf(-40)).toBe(0)
    expect(normalCdf(-1e6)).toBe(0)
    expect(normalCdf(1e6)).toBe(1)
    expect(normalCdf(8.5)).toBeLessThanOrEqual(1)
    expect(normalCdf(9)).toBe(1)
  })

  it('handles the edges: infinities, NaN', () => {
    expect(normalCdf(-Infinity)).toBe(0)
    expect(normalCdf(Infinity)).toBe(1)
    expect(normalCdf(Number.NaN)).toBeNaN()
  })
})

describe('normalQuantile against independent computations', () => {
  it('inverts normalCdf across all three AS241 ranges and their borders', () => {
    const borders = [0.075, 0.925, Math.exp(-25)]
    const ps: number[] = []
    for (const border of borders) ps.push(border * (1 - 1e-9), border, border * (1 + 1e-9))
    ps.push(1e-300, 1e-200, 1e-100, 1e-50, 1e-20, 1e-15, 1e-12, 1e-10, 1e-8, 1e-6, 1e-4, 0.001, 0.01, 0.1, 0.3, 0.5)
    for (const p of ps) {
      const z = normalQuantile(p)
      // Phi(z) moves by a factor |z| times any change in z, so the round trip loses about z^2 * 1e-16 in the far tail
      expect(relativeError(normalCdf(z), p), `p = ${p}`).toBeLessThanOrEqual(1e-15 * (1 + z * z))
    }
  })

  it('inverts the upper half through the complement 1 - p, which is exact for p >= 0.5', () => {
    for (const p of [0.5, 0.6, 0.75, 0.9, 0.925, 0.95, 0.99, 0.999, 0.9999999, 1 - 1e-10, 1 - 1e-12]) {
      expect(relativeError(normalCdf(-normalQuantile(p)), 1 - p), `p = ${p}`).toBeLessThanOrEqual(1e-13)
    }
  })

  it('is strictly increasing over a grid of 20,001 probabilities', () => {
    let previous = -Infinity
    for (let i = 1; i <= 20000; i += 1) {
      const value = normalQuantile(i / 20001)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('is exactly 0 at one half and at the smallest and largest interior doubles finite', () => {
    expect(normalQuantile(0.5)).toBe(0)
    expect(normalQuantile(Number.MIN_VALUE)).toBeLessThan(-38)
    expect(normalQuantile(Number.MIN_VALUE)).toBeGreaterThan(-39)
    expect(Number.isFinite(normalQuantile(1 - Number.EPSILON / 2))).toBe(true)
    expect(normalQuantile(1 - Number.EPSILON / 2)).toBeGreaterThan(8)
  })

  it('handles the edges: 0, 1, outside [0, 1], infinities, NaN', () => {
    expect(normalQuantile(0)).toBe(-Infinity)
    expect(normalQuantile(1)).toBe(Infinity)
    expect(normalQuantile(-0)).toBe(-Infinity)
    expect(normalQuantile(-0.1)).toBeNaN()
    expect(normalQuantile(-Number.MIN_VALUE)).toBeNaN()
    expect(normalQuantile(1.1)).toBeNaN()
    expect(normalQuantile(1 + Number.EPSILON)).toBeNaN()
    expect(normalQuantile(Infinity)).toBeNaN()
    expect(normalQuantile(-Infinity)).toBeNaN()
    expect(normalQuantile(Number.NaN)).toBeNaN()
  })
})

// A relative bound cannot hold near zero: x = -1e-8 comes back with about 1e-16 absolute error, so the round trip is
// judged by 1e-12 * max(1, |x|).
describe('round trip and symmetry (v2 tolerances)', () => {
  const grid: number[] = []
  for (let x = -8; x <= 0; x += 0.25) grid.push(x)
  const goldenXs = GOLDEN.cdf.map((row) => row.x).filter((x) => x >= -8 && x <= 0)

  it('has the grid the brief names', () => {
    expect(grid).toHaveLength(33)
    expect(grid[0]).toBe(-8)
    expect(grid[1]).toBe(-7.75)
    expect(grid.at(-1)).toBe(0)
    // every golden x in [-8, 0] is used; -8.3, -10, -20 and -30 lie outside and the positive ones are skipped
    expect(goldenXs).toEqual([-5, -3, -1.959963984540054, -1, -1e-8, 0])
  })

  it('normalQuantile(normalCdf(x)) returns x within 1e-12 * max(1, |x|)', () => {
    for (const x of [...grid, ...goldenXs]) {
      expect(Math.abs(normalQuantile(normalCdf(x)) - x), `x = ${x}`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(x)))
    }
  })

  it('is exactly odd where 1 - p is exact', () => {
    for (const p of [0.5, 0.25, 0.125]) {
      expect(normalQuantile(1 - p) + normalQuantile(p)).toBe(0)
    }
  })

  it('is odd within 1e-6 absolute down to p = 1e-10', () => {
    for (const p of [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10]) {
      expect(Math.abs(normalQuantile(1 - p) + normalQuantile(p)), `p = ${p}`).toBeLessThanOrEqual(1e-6)
    }
  })
})
