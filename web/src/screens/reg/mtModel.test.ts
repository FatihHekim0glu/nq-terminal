// The MT model (TASKS 6.1, ANALYTICS_CATALOG SV4): the p-value scatter input, the check that the
// API's boundary lines are the Bonferroni, Holm and BH lines the chart draws, and the table rows.
import { describe, expect, it } from 'vitest'
import { multipleTests } from '../../charts/echarts/pScatterModel'
import type { Schemas } from '../../api/types'
import { MULTIPLE_TESTING } from './regFixtures'
import { boundaryCheck, buildMtRows, familyLine, mtScatterInput, passesText } from './mtModel'

describe('mtScatterInput', () => {
  it('passes every family p-value and the API alpha to the chart', () => {
    const input = mtScatterInput(MULTIPLE_TESTING, 'log')
    expect(input.alpha).toBe(0.05)
    expect(input.points).toHaveLength(MULTIPLE_TESTING.k)
    expect(input.points.map((p) => p.label)).toEqual(MULTIPLE_TESTING.rows.map((r) => r.name))
    expect(input.points.map((p) => p.p)).toEqual(MULTIPLE_TESTING.rows.map((r) => r.p))
    expect(input.scale).toBe('log')
  })
})

describe('boundaryCheck: the lines on the chart are the lines in the API', () => {
  it('matches Bonferroni alpha/k, Holm alpha/(k-i+1) and BH i alpha/k at every rank', () => {
    const check = boundaryCheck(MULTIPLE_TESTING)
    expect(check.ok).toBe(true)
    expect(check.maxDiff).toBeLessThan(1e-15)
    const drawn = multipleTests(mtScatterInput(MULTIPLE_TESTING, 'log').points, MULTIPLE_TESTING.alpha)
    const k = MULTIPLE_TESTING.k
    MULTIPLE_TESTING.rows.forEach((r, i) => {
      expect(r.bonferroni_line).toBeCloseTo(0.05 / k, 15)
      expect(r.holm_line).toBeCloseTo(0.05 / (k - r.rank + 1), 15)
      expect(r.bh_line).toBeCloseTo((r.rank * 0.05) / k, 15)
      expect(drawn[i]!.label).toBe(r.name)
    })
  })

  it('fails on a changed Holm line (born failing)', () => {
    const rows = MULTIPLE_TESTING.rows.map((r, i) => (i === 3 ? { ...r, holm_line: r.holm_line * 1.01 } : r))
    const check = boundaryCheck({ ...MULTIPLE_TESTING, rows })
    expect(check.ok).toBe(false)
    expect(check.worst).toBe(MULTIPLE_TESTING.rows[3]!.name)
  })

  it('fails when the ranks are out of order or a p-value is out of range', () => {
    const swapped = [MULTIPLE_TESTING.rows[1]!, MULTIPLE_TESTING.rows[0]!, ...MULTIPLE_TESTING.rows.slice(2)]
    expect(boundaryCheck({ ...MULTIPLE_TESTING, rows: swapped }).ok).toBe(false)
    const bad = MULTIPLE_TESTING.rows.map((r, i) => (i === 0 ? { ...r, p: 1.5 } : r))
    expect(boundaryCheck({ ...MULTIPLE_TESTING, rows: bad }).ok).toBe(false)
  })

  it('reads an empty family as matching nothing to check', () => {
    const empty: Schemas['MultipleTesting'] = { ...MULTIPLE_TESTING, k: 0, rows: [] }
    expect(boundaryCheck(empty)).toEqual({ ok: true, maxDiff: 0, worst: null })
  })
})

describe('buildMtRows', () => {
  it('keeps the API order and values and says which rules each p passes', () => {
    const rows = buildMtRows(MULTIPLE_TESTING)
    expect(rows).toHaveLength(MULTIPLE_TESTING.k)
    expect(rows[0]).toMatchObject({ name: 'vt_har_v0', rank: 1, p: MULTIPLE_TESTING.rows[0]!.p, tag: 'overlay' })
    expect(passesText(rows[0]!.passes)).toBe('Bonferroni, Holm, BH')
    // With the family at 21: eomtsy_v0 (rank 2, p 0.00097) sits under Bonferroni 0.05/21 = 0.00238;
    // overnight_v0 (rank 3, p 0.00271) is over Bonferroni and Holm 0.05/19 = 0.00263 but under BH
    // 3 x 0.05/21 = 0.00714, as its stored adjusted values say; preholiday_v0 (rank 4) passes none.
    expect(rows[1]).toMatchObject({ name: 'eomtsy_v0', tag: 'edge' })
    expect(passesText(rows[1]!.passes)).toBe('Bonferroni, Holm, BH')
    expect(rows[2]!.name).toBe('overnight_v0')
    expect(passesText(rows[2]!.passes)).toBe('BH')
    expect(passesText(rows[3]!.passes)).toBe('none')
    expect(rows.filter((r) => r.passes.bh)).toHaveLength(3)
  })
})

describe('familyLine', () => {
  it('names k, alpha and whether the stored adjusted values match the recomputation', () => {
    expect(familyLine(MULTIPLE_TESTING)).toBe('Family k 21, alpha 0.05. Stored adjusted values match the recomputation (max abs diff 0.0e+0).')
    const off = { ...MULTIPLE_TESTING, matches_registry: false, max_abs_diff: 0.0123 }
    expect(familyLine(off)).toBe('Family k 21, alpha 0.05. Stored adjusted values DIFFER from the recomputation (max abs diff 1.2e-2).')
  })
})
