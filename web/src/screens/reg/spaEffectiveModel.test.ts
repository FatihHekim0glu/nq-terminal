// SV8 on MT: the effective number of family members, in words, over the served `effective_members` of each row
// (ANALYTICS_CATALOG SV8 step 8). The backend computes it from the correlation of the members' loss differentials
// (analytics/neff.py: eigenvalue participation, Li and Ji, UPGMA clusters at 1 - rho = 0.5); the browser only words it.
// The numbers below are the served ones for the four member matrix of numpy and scipy (qa/golden/p2_neff_served.json,
// pinned by backend/tests/test_p2_neff_bridge.py and by neffMirror.test.ts).
import { describe, expect, it } from 'vitest'
import { SPA } from '../../copy/spa'
import { effectiveLines } from './spaEffectiveModel'
import { SPA_HELD, SPA_REJECTS } from './spaFixtures'
import type { SpaEffectiveMembers } from './spaTypes'

const FOUR: SpaEffectiveMembers = {
  k: 4,
  cut: 0.5,
  refusal: null,
  participation: 1.9115890083632017,
  li_ji: 2.9999999999999987,
  clusters: [['a_v0', 'b_v0', 'c_v0'], ['d_v0']],
  strongest: { a: 'a_v0', b: 'b_v0', rho: 0.9 },
}
const SINGLE: SpaEffectiveMembers = { ...FOUR, k: 1, refusal: { kind: 'single', name: null }, participation: null, li_ji: null, clusters: [], strongest: null }
const UNDEFINED: SpaEffectiveMembers = { ...SINGLE, k: 3, refusal: { kind: 'undefined', name: 'y' } }

describe('effective members in words', () => {
  it('states both estimators with the family size, the clusters and the pair, and says where it came from', () => {
    expect(effectiveLines(FOUR)).toEqual([
      'Effective number of members: 1.91 by eigenvalue participation and 3 by Li and Ji (2005), of 4; 2 clusters at 1 - rho 0.5 (average linkage): a_v0, b_v0, c_v0; d_v0.',
      'Most correlated pair of differentials: a_v0 and b_v0, rho 0.90.',
      SPA.effective.source,
    ])
  })

  it('says the figures are served, with no claim that the browser computed them', () => {
    expect(SPA.effective.source).toContain('Served by the backend')
    expect(JSON.stringify(SPA.effective)).not.toMatch(/computed in the browser/i)
    expect(JSON.stringify(SPA.effective)).not.toContain('not a served number')
  })

  it('prints a count that floating point left a hair off as a whole number, and one cluster in the singular', () => {
    const lines = effectiveLines({ ...FOUR, li_ji: 3.0000000000000004, clusters: [['a_v0', 'b_v0', 'c_v0', 'd_v0']] })
    expect(lines[0]).toContain('and 3 by Li and Ji (2005), of 4; 1 cluster at 1 - rho 0.5')
  })

  it('words the served fixtures of both rows', () => {
    expect(effectiveLines(SPA_REJECTS.effective_members)[0]).toMatch(/^Effective number of members: 2\.38 by eigenvalue participation and 3 by Li and Ji/)
    expect(effectiveLines(SPA_HELD.effective_members)[1]).toBe('Most correlated pair of differentials: overnight_v0 and halloween_v0, rho 0.61.')
  })

  it('gives one status line for each served refusal, and no pair, source or numbers', () => {
    expect(effectiveLines(SINGLE)).toEqual(['One member only, so no effective number of members is drawn.'])
    expect(effectiveLines(UNDEFINED)).toEqual(['Not computed: y does not vary on the common index, so it has no correlation.'])
  })

  it('has no line for a malformed matrix: the backend builds it, so that refusal is gone from the copy', () => {
    expect(Object.keys(SPA.effective)).not.toContain('malformed')
  })
})
