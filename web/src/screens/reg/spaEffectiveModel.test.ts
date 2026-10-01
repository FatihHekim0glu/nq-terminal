// SV8 on MT: the effective number of family members from the served correlation of their loss differentials, by the
// owner's estimators (src/quant: eigenvalue participation, Li and Ji, UPGMA clusters). The expected values below are
// numpy and scipy's (eigvalsh, linkage 'average', fcluster 'distance' at 0.5) on the same matrices, computed once in
// the QA environment; the estimators themselves are pinned to qa/golden/p12_neff.json by src/quant/*.test.ts.
import { describe, expect, it } from 'vitest'
import { effectiveLines, effectiveMembers } from './spaEffectiveModel'
import { SPA_REJECTS } from './spaFixtures'
import type { SpaView } from './spaTypes'

const NAMES = ['a_v0', 'b_v0', 'c_v0', 'd_v0']
// numpy: eigenvalues 2.70517174, 1.00113822, 0.20446964, 0.0892204; participation 1.9115890083632017;
// Li and Ji 2.9999999999999987; scipy average linkage at 0.5: {a, b, c} and {d}.
const FOUR: readonly (readonly number[])[] = [
  [1, 0.9, 0.85, 0.1],
  [0.9, 1, 0.8, 0.05],
  [0.85, 0.8, 1, 0],
  [0.1, 0.05, 0, 1],
]

function viewWith(correlation: readonly (readonly (number | null)[])[], names: readonly string[] = NAMES): SpaView {
  const template = SPA_REJECTS.members[0]!
  return {
    ...SPA_REJECTS,
    members: names.map((name) => ({ ...template, name })),
    correlation: correlation.map((row) => [...row]),
  }
}

describe('effective members from the served correlation', () => {
  it('matches numpy and scipy on a four member family: participation, Li and Ji and the clusters', () => {
    const got = effectiveMembers(viewWith(FOUR))
    if (!got.ok) throw new Error('expected a result')
    expect(got.k).toBe(4)
    expect(got.participation).toBeCloseTo(1.9115890083632017, 12)
    expect(got.liJi).toBeCloseTo(2.9999999999999987, 12)
    expect(got.clusters).toEqual([['a_v0', 'b_v0', 'c_v0'], ['d_v0']])
  })

  it('names the most correlated pair', () => {
    const got = effectiveMembers(viewWith(FOUR))
    if (!got.ok) throw new Error('expected a result')
    expect(got.strongest).toEqual({ a: 'a_v0', b: 'b_v0', rho: 0.9 })
  })

  it('reads identical members as one: participation 1 for a block of ones', () => {
    const ones = [[1, 1, 1], [1, 1, 1], [1, 1, 1]]
    const got = effectiveMembers(viewWith(ones, ['x', 'y', 'z']))
    if (!got.ok) throw new Error('expected a result')
    expect(got.participation).toBeCloseTo(1, 12)
    expect(got.clusters).toEqual([['x', 'y', 'z']])
  })

  it('reads uncorrelated members as k: participation k for the identity', () => {
    const eye = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    const got = effectiveMembers(viewWith(eye, ['x', 'y', 'z']))
    if (!got.ok) throw new Error('expected a result')
    expect(got.participation).toBeCloseTo(3, 12)
    expect(got.clusters).toEqual([['x'], ['y'], ['z']])
  })

  it('draws nothing for one member, saying why', () => {
    expect(effectiveMembers(viewWith([[1]], ['only']))).toEqual({ ok: false, reason: 'single' })
  })

  it('born failing: a member that does not vary refuses the whole estimate and names it', () => {
    const gap = [[1, null, 0.2], [null, null, null], [0.2, null, 1]]
    expect(effectiveMembers(viewWith(gap, ['x', 'y', 'z']))).toEqual({ ok: false, reason: 'undefined', name: 'y' })
  })

  it('born failing: a matrix that is not k by k, not symmetric, off the unit diagonal or beyond one is refused', () => {
    const bad: ReadonlyArray<readonly (readonly number[])[]> = [
      [[1, 0.5], [0.5, 1]], // 2 by 2 for 3 members
      [[1, 0.5, 0], [0.4, 1, 0], [0, 0, 1]], // not symmetric
      [[0.9, 0.5, 0], [0.5, 1, 0], [0, 0, 1]], // diagonal not 1
      [[1, 1.2, 0], [1.2, 1, 0], [0, 0, 1]], // outside [-1, 1]
    ]
    for (const matrix of bad) {
      expect(effectiveMembers(viewWith(matrix, ['x', 'y', 'z']))).toEqual({ ok: false, reason: 'malformed' })
    }
  })
})

describe('effective members in words', () => {
  it('states both estimators with the family size, the clusters and the pair, and says where it was computed', () => {
    const lines = effectiveLines(effectiveMembers(viewWith(FOUR)))
    expect(lines).toEqual([
      'Effective number of members: 1.91 by eigenvalue participation and 3 by Li and Ji (2005), of 4; 2 clusters at 1 - rho 0.5 (average linkage): a_v0, b_v0, c_v0; d_v0.',
      'Most correlated pair of differentials: a_v0 and b_v0, rho 0.90.',
      'Computed in the browser from the served correlation, with the estimators of MT 87) Effective trials; not a served number, and no verdict.',
    ])
  })

  it('gives one status line for each refusal', () => {
    expect(effectiveLines({ ok: false, reason: 'single' })).toEqual(['One member only, so no effective number of members is drawn.'])
    expect(effectiveLines({ ok: false, reason: 'undefined', name: 'y' })).toEqual([
      'Not computed: y does not vary on the common index, so it has no correlation.',
    ])
    expect(effectiveLines({ ok: false, reason: 'malformed' })).toEqual([
      'Not computed: the served correlation is not a k by k correlation matrix of the members.',
    ])
  })
})
