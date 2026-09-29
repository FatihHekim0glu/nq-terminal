// participationRatio, liJiCount, expectedMaxSr0, probabilisticSharpe and sessionSharpe against the golden vectors from
// qa/crosscheck/p12_neff.py (numpy and scipy.stats.norm), the paper example (SR0 0.1132, DSR 0.9004) and the served SV3
// view at N = 21 (DEFLATED_REAL): SR0 to 1e-12 and every dsr_null to 1e-9. Plus the inputs that give null and the
// variants that must stay wrong (V instead of V0, N 15, excess kurtosis, n instead of n - 1).
import { describe, expect, it } from 'vitest'
import raw from '../../../qa/golden/p12_neff.json?raw'
import { DEFLATED_REAL } from '../screens/reg/deflatedFixtures'
import { pearsonMatrix, symmetricEigenvalues } from './linalg'
import { expectedMaxSr0, liJiCount, participationRatio, probabilisticSharpe, sessionSharpe } from './trials'

type Sv3Row = {
  name: string
  periods: number
  n: number
  sr: number
  skew: number
  kurt: number
  sr0_null_own_period: number
  dsr_null: number
}
type Golden = {
  panel: { columns: number[][] }
  eigenvalues: number[]
  participation_ratio: number
  li_ji: number
  eigen_cases: { name: string; eigenvalues: number[]; participation_ratio: number; li_ji: number }[]
  sr0_cases: { n_trials: number; variance: number; gamma: number; value: number | null }[]
  psr_cases: { sr: number; sr0: number; n: number; skew: number; kurt: number; value: number | null }[]
  session_sharpe: { name: string; value: number }[]
  paper_example: {
    n_trials: number
    variance: number
    sessions: number
    skew: number
    kurt: number
    sr: number
    gamma: number
    sr0: number
    dsr: number
    reported: { sr0: number; dsr: number }
  }
  sv3_anchor: {
    n_trials: number
    variance: number
    sr0_session: number
    variance_null: number
    sr0_null_session: number
    euler_gamma: number
    rows: Sv3Row[]
  }
}
const GOLDEN = JSON.parse(raw) as Golden
const PAPER = GOLDEN.paper_example

/** A number the served fixture must hold: DeflatedView types its numbers as nullable, the real view has none missing. */
function present(value: number | null | undefined): number {
  if (value === null || value === undefined) throw new Error('the DEFLATED_REAL fixture lacks a number')
  return value
}
const SERVED = {
  nTrials: DEFLATED_REAL.n_trials,
  gamma: present(DEFLATED_REAL.euler_gamma),
  variance: present(DEFLATED_REAL.variance),
  varianceNull: present(DEFLATED_REAL.variance_null),
  sr0: present(DEFLATED_REAL.sr0_session),
  sr0Null: present(DEFLATED_REAL.sr0_null_session),
  rows: DEFLATED_REAL.rows.map((row) => ({
    name: row.name,
    periods: row.periods,
    n: row.n,
    sr: present(row.sr),
    skew: present(row.skew),
    kurt: present(row.kurt),
    sr0NullOwn: present(row.sr0_null_own_period),
    dsr: present(row.dsr),
    dsrNull: present(row.dsr_null),
  })),
}

function relativeError(got: number, want: number): number {
  return Math.abs(got - want) / Math.max(Math.abs(want), 1e-300)
}

describe('participationRatio and liJiCount', () => {
  it('match the golden values of the 9 x 9 panel through the whole chain (panel, correlation, eigenvalues)', () => {
    const eigenvalues = symmetricEigenvalues(pearsonMatrix(GOLDEN.panel.columns))
    expect(Math.abs((participationRatio(eigenvalues) as number) - GOLDEN.participation_ratio)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(liJiCount(eigenvalues) - GOLDEN.li_ji)).toBeLessThanOrEqual(1e-12)
  })

  it('match the golden values on the golden eigenvalues themselves', () => {
    expect(Math.abs(participationRatio(GOLDEN.eigenvalues) - GOLDEN.participation_ratio)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(liJiCount(GOLDEN.eigenvalues) - GOLDEN.li_ji)).toBeLessThanOrEqual(1e-12)
    expect(GOLDEN.li_ji).toBeCloseTo(8, 10)
  })

  it.each(GOLDEN.eigen_cases.map((c) => [c.name, c] as const))('hand case %s matches numpy', (_name, c) => {
    expect(Math.abs(participationRatio(c.eigenvalues) - c.participation_ratio)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(liJiCount(c.eigenvalues) - c.li_ji)).toBeLessThanOrEqual(1e-12)
  })

  it('participation ratio by hand: (sum)^2 / sum of squares', () => {
    expect(participationRatio([3, 1])).toBeCloseTo(1.6, 14) // 16 / 10
    expect(participationRatio([1, 1, 1])).toBe(3) // M equal eigenvalues
    expect(participationRatio([2, 1, 0])).toBeCloseTo(1.8, 14) // 9 / 5
    expect(participationRatio([1.8, 0.6, 0.6])).toBeCloseTo(9 / 3.96, 14)
    expect(participationRatio([4, 0, 0, 0])).toBe(1) // one direction carries everything
    expect(participationRatio([7])).toBe(1)
  })

  it('Li and Ji by hand: 1 for each |l| >= 1 plus its fractional part', () => {
    expect(liJiCount([3, 1])).toBe(2)
    expect(liJiCount([1, 1, 1])).toBe(3)
    expect(liJiCount([2, 1, 0])).toBe(2)
    expect(liJiCount([1.8, 0.6, 0.6])).toBeCloseTo(3, 14) // 1 + 0.8 + 0.6 + 0.6
    expect(liJiCount([2, 0.5, 0.5])).toBe(2) // 1 + 0 + 0.5 + 0.5
    expect(liJiCount([2.5, 0.5])).toBeCloseTo(2, 14) // 1 + 0.5 + 0.5
    expect(liJiCount([0.25])).toBe(0.25)
  })

  it('Li and Ji uses the size of a negative eigenvalue', () => {
    expect(liJiCount([-1.5, 0.25])).toBe(1.75)
    expect(liJiCount([1.5, 0.25])).toBe(liJiCount([-1.5, 0.25]))
  })

  it('Li and Ji jumps at an integer eigenvalue of 2 or more, as the formula says (2 counts 1, just under 2 counts nearly 2)', () => {
    expect(liJiCount([2])).toBe(1)
    expect(liJiCount([1.9999999])).toBeCloseTo(1.9999999, 12)
    expect(liJiCount([1])).toBe(1)
    expect(liJiCount([0.9999999])).toBeCloseTo(0.9999999, 12)
  })

  it('refuse an empty spectrum, a value that is not finite and a spectrum of zeros', () => {
    expect(() => participationRatio([])).toThrow('eigenvalue')
    expect(() => participationRatio([1, Number.NaN])).toThrow('eigenvalue')
    expect(() => participationRatio([1, Infinity])).toThrow('eigenvalue')
    expect(() => participationRatio([0, 0])).toThrow('eigenvalue')
    expect(() => liJiCount([])).toThrow('eigenvalue')
    expect(() => liJiCount([1, Number.NaN])).toThrow('eigenvalue')
  })
})

describe('expectedMaxSr0 against scipy.stats.norm.ppf', () => {
  it('holds the cases the brief lists: N of 21, 12.3, 9.4, 2 and 1.5 at the served V0 and gamma', () => {
    const at = GOLDEN.sr0_cases.filter((c) => c.variance === SERVED.varianceNull)
    expect(at.map((c) => c.n_trials)).toEqual(expect.arrayContaining([21, 12.3, 9.4, 2, 1.5]))
  })

  it.each(GOLDEN.sr0_cases.map((c) => [c.n_trials, c.variance, c] as const))('N %s, V %s matches scipy to 1e-12', (_n, _v, c) => {
    const got = expectedMaxSr0(c.variance, c.n_trials, c.gamma)
    if (c.value === null) expect(got).toBeNull()
    else expect(Math.abs((got as number) - c.value)).toBeLessThanOrEqual(1e-12)
  })

  it('rises with N, fractional N included, and scales with the square root of V', () => {
    const v = SERVED.varianceNull
    const g = SERVED.gamma
    const bars = [1.5, 2, 9.4, 12.3, 21, 100, 1000].map((n) => expectedMaxSr0(v, n, g) as number)
    expect(bars).toEqual([...bars].sort((a, b) => a - b))
    expect(new Set(bars).size).toBe(bars.length)
    expect(relativeError(expectedMaxSr0(4 * v, 21, g) as number, 2 * (expectedMaxSr0(v, 21, g) as number))).toBeLessThanOrEqual(1e-14)
  })

  it('N = 2 is gamma times the quantile at 1 - 1/(2e): the median term vanishes', () => {
    const g = SERVED.gamma
    const bar = expectedMaxSr0(1, 2, g) as number
    expect(bar).toBeGreaterThan(0)
    expect(Math.abs(bar / g - 0.9004525966377902)).toBeLessThanOrEqual(1e-13) // Phi^-1(1 - 1/(2e)) = Phi^-1(0.81606)
  })

  it('is null for N <= 1, a negative or non-finite V, and a non-finite N or gamma; zero V gives zero', () => {
    const g = SERVED.gamma
    for (const n of [1, 0.5, 0, -3, Number.NaN, Infinity]) expect(expectedMaxSr0(0.001, n, g), `N ${n}`).toBeNull()
    for (const v of [-1e-9, Number.NaN, Infinity, -Infinity]) expect(expectedMaxSr0(v, 21, g), `V ${v}`).toBeNull()
    expect(expectedMaxSr0(0.001, 21, Number.NaN)).toBeNull()
    expect(expectedMaxSr0(0, 21, g)).toBe(0)
  })

  it('stays finite just above N = 1', () => {
    const bar = expectedMaxSr0(0.001, 1 + 1e-9, SERVED.gamma) as number
    expect(Number.isFinite(bar)).toBe(true)
    expect(bar).toBeLessThan(0)
  })
})

describe('probabilisticSharpe against scipy.stats.norm.cdf', () => {
  it.each(GOLDEN.psr_cases.map((c, i) => [i, c] as const))('case %s matches scipy to 1e-10 relative', (_i, c) => {
    const got = probabilisticSharpe(c.sr, c.sr0, c.n, c.skew, c.kurt)
    if (c.value === null) expect(got).toBeNull()
    else expect(relativeError(got as number, c.value)).toBeLessThanOrEqual(1e-10)
  })

  it('is one half on the bar and moves with the sign of SR - SR0', () => {
    expect(probabilisticSharpe(0.05, 0.05, 250, 0, 3)).toBe(0.5)
    expect(probabilisticSharpe(0.06, 0.05, 250, 0, 3) as number).toBeGreaterThan(0.5)
    expect(probabilisticSharpe(0.04, 0.05, 250, 0, 3) as number).toBeLessThan(0.5)
  })

  it('by hand for normal returns: Phi(SR sqrt(n - 1) / sqrt(1 + SR^2 / 2))', () => {
    const sr = 0.05
    const z = (sr * Math.sqrt(249)) / Math.sqrt(1 + (sr * sr) / 2)
    const want = 0.5 * (1 + erf(z / Math.SQRT2))
    expect(Math.abs((probabilisticSharpe(sr, 0, 250, 0, 3) as number) - want)).toBeLessThanOrEqual(1e-9)
  })

  it('is null for n <= 1, a variance term that is not positive, and inputs that are not finite', () => {
    expect(probabilisticSharpe(0.05, 0.01, 1, 0, 3)).toBeNull()
    expect(probabilisticSharpe(0.05, 0.01, 0.5, 0, 3)).toBeNull()
    expect(probabilisticSharpe(0.05, 0.01, 0, 0, 3)).toBeNull()
    expect(probabilisticSharpe(2, 0.5, 100, 2, 1)).toBeNull() // 1 - 4 + 0 < 0
    expect(probabilisticSharpe(1, 0.5, 100, 1, 1)).toBeNull() // 1 - 1 + 0 = 0
    for (const bad of [Number.NaN, Infinity]) {
      expect(probabilisticSharpe(bad, 0.01, 250, 0, 3)).toBeNull()
      expect(probabilisticSharpe(0.05, bad, 250, 0, 3)).toBeNull()
      expect(probabilisticSharpe(0.05, 0.01, bad, 0, 3)).toBeNull()
      expect(probabilisticSharpe(0.05, 0.01, 250, bad, 3)).toBeNull()
      expect(probabilisticSharpe(0.05, 0.01, 250, 0, bad)).toBeNull()
    }
  })

  it('accepts the shortest series, n = 2', () => {
    expect(probabilisticSharpe(0.03, 0.01, 2, 0, 3)).not.toBeNull()
  })
})

/** The error function by its Maclaurin series, enough for |x| < 4: an independent check of the normal CDF. */
function erf(x: number): number {
  let term = x
  let sum = x
  for (let k = 1; k < 200; k += 1) {
    term *= (-x * x) / k
    sum += term / (2 * k + 1)
  }
  return (2 / Math.sqrt(Math.PI)) * sum
}

describe('the paper example (Bailey and Lopez de Prado 2014, SV3a step 8)', () => {
  const sr0 = expectedMaxSr0(PAPER.variance, PAPER.n_trials, PAPER.gamma) as number
  const dsr = probabilisticSharpe(PAPER.sr, sr0, PAPER.sessions, PAPER.skew, PAPER.kurt) as number

  it('reads N = 100, V = 1/500, T = 1250, skew -3, kurtosis 10, SR = 2.5 / sqrt(250)', () => {
    expect(PAPER).toMatchObject({ n_trials: 100, sessions: 1250, skew: -3, kurt: 10 })
    expect(PAPER.variance).toBeCloseTo(1 / 500, 15)
    expect(PAPER.sr).toBeCloseTo(2.5 / Math.sqrt(250), 15)
  })

  it('gives SR0 = 0.1132 and DSR = 0.9004 to four decimals', () => {
    expect(Number(sr0.toFixed(4))).toBe(0.1132)
    expect(Number(dsr.toFixed(4))).toBe(0.9004)
    expect(PAPER.reported).toEqual({ sr0: 0.1132, dsr: 0.9004 })
  })

  it('agrees with scipy to 1e-12', () => {
    expect(Math.abs(sr0 - PAPER.sr0)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(dsr - PAPER.dsr)).toBeLessThanOrEqual(1e-12)
  })

  it('born failing: excess kurtosis in place of raw kurtosis, or n in place of n - 1, misses 0.9004', () => {
    const excess = probabilisticSharpe(PAPER.sr, sr0, PAPER.sessions, PAPER.skew, PAPER.kurt - 3) as number
    expect(Number(excess.toFixed(4))).not.toBe(0.9004)
    const n = PAPER.sessions
    const nNotNMinusOne = probabilisticSharpe(PAPER.sr, sr0, n + 1, PAPER.skew, PAPER.kurt) as number // sqrt(n) for sqrt(n - 1)
    expect(Number(nNotNMinusOne.toFixed(4))).not.toBe(0.9004)
  })
})

describe('the served SV3 view at N = 21 (DEFLATED_REAL)', () => {
  it('has the copies in the golden file: the golden anchor is the served view', () => {
    const a = GOLDEN.sv3_anchor
    expect(a.n_trials).toBe(SERVED.nTrials)
    expect(a.variance).toBe(SERVED.variance)
    expect(a.variance_null).toBe(SERVED.varianceNull)
    expect(a.sr0_session).toBe(SERVED.sr0)
    expect(a.sr0_null_session).toBe(SERVED.sr0Null)
    expect(a.euler_gamma).toBe(SERVED.gamma)
    for (const row of a.rows) {
      const served = SERVED.rows.find((r) => r.name === row.name)
      expect(served, row.name).toBeDefined()
      expect(served).toMatchObject({ periods: row.periods, n: row.n, sr: row.sr, skew: row.skew, kurt: row.kurt })
      expect(served?.sr0NullOwn).toBe(row.sr0_null_own_period)
      expect(served?.dsrNull).toBe(row.dsr_null)
    }
  })

  it('reproduces SR0 under V0 to 1e-12 and under V to 1e-12', () => {
    const under0 = expectedMaxSr0(SERVED.varianceNull, SERVED.nTrials, SERVED.gamma) as number
    expect(Math.abs(under0 - SERVED.sr0Null)).toBeLessThanOrEqual(1e-12)
    const underV = expectedMaxSr0(SERVED.variance, SERVED.nTrials, SERVED.gamma) as number
    expect(Math.abs(underV - SERVED.sr0)).toBeLessThanOrEqual(1e-12)
  })

  it('reproduces every served dsr_null to 1e-9 from its own moments and SR0 moved to its period', () => {
    expect(SERVED.rows).toHaveLength(21)
    const bar = expectedMaxSr0(SERVED.varianceNull, SERVED.nTrials, SERVED.gamma) as number
    for (const row of SERVED.rows) {
      const own = bar * Math.sqrt(252 / row.periods) // a monthly book: x sqrt(252 / 12)
      expect(Math.abs(own - row.sr0NullOwn), `${row.name} bar`).toBeLessThanOrEqual(1e-12)
      const got = probabilisticSharpe(row.sr, own, row.n, row.skew, row.kurt)
      expect(got, row.name).not.toBeNull()
      expect(Math.abs((got as number) - row.dsrNull), row.name).toBeLessThanOrEqual(1e-9)
    }
  })

  it('reproduces the empirical-V dsr of every row that is above 1e-300 to 1e-9 relative', () => {
    const bar = expectedMaxSr0(SERVED.variance, SERVED.nTrials, SERVED.gamma) as number
    let checked = 0
    for (const row of SERVED.rows) {
      const got = probabilisticSharpe(row.sr, bar * Math.sqrt(252 / row.periods), row.n, row.skew, row.kurt) as number
      if (row.dsr >= 1e-300) {
        expect(relativeError(got, row.dsr), row.name).toBeLessThanOrEqual(1e-9)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(15)
  })

  it('born failing: V in place of V0, or N 15 in place of 21, does not reproduce the served bar', () => {
    const wrongV = expectedMaxSr0(SERVED.variance, 21, SERVED.gamma) as number
    const wrongN = expectedMaxSr0(SERVED.varianceNull, 15, SERVED.gamma) as number
    expect(Math.abs(wrongV - SERVED.sr0Null)).toBeGreaterThan(1e-3)
    expect(Math.abs(wrongN - SERVED.sr0Null)).toBeGreaterThan(1e-3)
    const row = SERVED.rows.find((r) => r.name === 'volmanaged_v0')
    expect(row).toBeDefined()
    if (row === undefined) return
    for (const bar of [wrongV, wrongN]) {
      const got = probabilisticSharpe(row.sr, bar, row.n, row.skew, row.kurt) as number
      expect(Math.abs(got - row.dsrNull)).toBeGreaterThan(1e-3)
    }
  })
})

describe('sessionSharpe against numpy mean / std(ddof=1)', () => {
  it.each(GOLDEN.session_sharpe.map((row, i) => [row.name, i, row.value] as const))('%s matches numpy to 1e-12', (_name, i, want) => {
    const got = sessionSharpe(GOLDEN.panel.columns[i] as number[]) as number
    expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12)
  })

  it('by hand: [1, 2, 3, 4] has mean 2.5 and sample sd sqrt(5/3)', () => {
    expect(sessionSharpe([1, 2, 3, 4]) as number).toBeCloseTo(2.5 / Math.sqrt(5 / 3), 14)
  })

  it('born failing: the population sd (ddof 0) gives a larger ratio', () => {
    const r = GOLDEN.panel.columns[0] as number[]
    const mean = r.reduce((s, x) => s + x, 0) / r.length
    const population = mean / Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length)
    expect(Math.abs(population - (sessionSharpe(r) as number))).toBeGreaterThan(1e-4 * Math.abs(population))
  })

  it('matches the served sr_session of a row from its own moments only when given the same series (scale free)', () => {
    const r = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02]
    expect(sessionSharpe(r.map((x) => x * 1000)) as number).toBeCloseTo(sessionSharpe(r) as number, 12)
  })

  it('is null for fewer than two values, no spread, and a value that is not finite', () => {
    expect(sessionSharpe([])).toBeNull()
    expect(sessionSharpe([0.01])).toBeNull()
    expect(sessionSharpe([0.01, 0.01, 0.01])).toBeNull()
    expect(sessionSharpe([0, 0, 0, 0])).toBeNull()
    expect(sessionSharpe([0.01, Number.NaN, 0.02])).toBeNull()
    expect(sessionSharpe([0.01, Infinity, 0.02])).toBeNull()
  })

  it('does not change its input and copes with a large offset', () => {
    const r = [1e8 + 0.5, 1e8 + 1.5, 1e8 + 1, 1e8 + 2]
    const before = [...r]
    const shifted = sessionSharpe(r.map((x) => x - 1e8)) as number
    const got = sessionSharpe(r) as number
    expect(r).toEqual(before)
    const sd = Math.sqrt(1.25 / 3) // the deviations are -0.75, 0.25, -0.25 and 0.75
    expect(relativeError(got, (1e8 + 1.25) / sd)).toBeLessThanOrEqual(1e-12)
    expect(relativeError(shifted, 1.25 / sd)).toBeLessThanOrEqual(1e-12)
  })
})
