// The mirror equality for SV3b and SV8 step 8 (ANALYTICS_CATALOG C8): what the backend serves equals what the browser
// computed before the estimators moved to nq_terminal/analytics/neff.py. The bridge file (qa/golden/p2_neff_served.json,
// written by backend/tests/test_p2_neff_bridge.py from the served views and kept in step by that test) holds the served
// numbers for the seeded golden panel of qa/golden/p12_neff.json and for a few correlation matrices; the browser
// reference (src/quant/neffReference.ts, a test reference only) recomputes them here. Numbers must agree to 1e-12
// relative (the last bits of another maths library), integers, names and cluster labels exactly.
import { describe, expect, it } from 'vitest'
import golden from '../../../../qa/golden/p12_neff.json?raw'
import bridge from '../../../../qa/golden/p2_neff_served.json?raw'
import { referenceEffectiveN, referenceMembers, type ReferenceSeries } from '../../quant/neffReference'
import type { DeflatedView } from './deflatedModel'
import type { EffectiveNServed } from './effectiveNTypes'
import type { SpaEffectiveMembers } from './spaTypes'

const REL = 1e-12
const ABS = 1e-14

interface Bridge {
  readonly sv3b: DeflatedView & { readonly effective_n: EffectiveNServed }
  readonly sv8: readonly {
    readonly name: string
    readonly names: readonly string[]
    readonly correlation: readonly (readonly (number | null)[])[]
    readonly served: SpaEffectiveMembers
  }[]
}
interface Golden {
  readonly panel: { readonly names: readonly string[]; readonly dates: readonly string[]; readonly columns: readonly (readonly number[])[] }
}

const BRIDGE = JSON.parse(bridge) as Bridge
const PANEL = (JSON.parse(golden) as Golden).panel
const SERIES: readonly ReferenceSeries[] = PANEL.names.map((name, i) => ({ name, date: PANEL.dates, r: PANEL.columns[i] as readonly number[] }))

/** The path of the first difference, or null: numbers to REL (or ABS near zero), everything else exactly. */
function firstDifference(got: unknown, want: unknown, path = ''): string | null {
  if (typeof got === 'number' && typeof want === 'number') {
    const close = got === want || Math.abs(got - want) <= Math.max(REL * Math.max(Math.abs(got), Math.abs(want)), ABS)
    return close ? null : path || '<root>'
  }
  if (Array.isArray(got) && Array.isArray(want)) {
    if (got.length !== want.length) return `${path}.length`
    for (let i = 0; i < got.length; i += 1) {
      const found = firstDifference(got[i], want[i], `${path}[${i}]`)
      if (found !== null) return found
    }
    return null
  }
  if (got !== null && want !== null && typeof got === 'object' && typeof want === 'object') {
    const keys = new Set([...Object.keys(got), ...Object.keys(want)])
    for (const key of [...keys].sort()) {
      if (!(key in got) || !(key in want)) return `${path}.${key}`
      const found = firstDifference((got as Record<string, unknown>)[key], (want as Record<string, unknown>)[key], `${path}.${key}`)
      if (found !== null) return found
    }
    return null
  }
  return got === want ? null : path || '<root>'
}

/** The served fields the reference also computes. */
function comparable(served: EffectiveNServed) {
  const { refusal, daily, monthly, window, correlation, eigenvalues, clusters, sequence, estimates, dsr } = served
  return { refusal, daily, monthly, window, correlation, eigenvalues, clusters, sequence, estimates, dsr }
}

describe('SV3b: the served effective number of trials equals the browser reference', () => {
  const served = BRIDGE.sv3b.effective_n
  const reference = referenceEffectiveN(BRIDGE.sv3b, SERIES)

  it('reproduces the matrix, eigenvalues, clusters, window and every estimate and DSR to 1e-12', () => {
    expect(served.refusal).toBeNull()
    expect(firstDifference(reference, comparable(served))).toBeNull()
  })

  it('has integers, names and cluster labels exactly equal', () => {
    expect(reference.clusters).toEqual(served.clusters)
    expect(reference.sequence).toEqual(served.sequence)
    expect(reference.daily).toEqual(served.daily)
    expect(reference.monthly).toEqual(served.monthly)
    expect(reference.window).toEqual(served.window)
    expect(reference.estimates.map((e) => e.id)).toEqual(served.estimates.map((e) => e.id))
    expect(reference.estimates[3]?.n_daily).toBe(served.estimates[3]?.n_daily)
  })

  it('reads the golden numbers: participation 6.349, Li and Ji 8 and 7 clusters on the 9 by 400 panel', () => {
    const by = Object.fromEntries(served.estimates.map((e) => [e.id, e]))
    expect(by.participation?.n_daily).toBeCloseTo(6.349, 3)
    expect(by.li_ji?.n_daily).toBeCloseTo(8, 9)
    expect(by.clusters?.n_daily).toBe(7)
    expect(served.window?.sessions).toBe(400)
  })

  it('born failing: a tampered served number, label or count is found by the comparison', () => {
    const bumped = { ...comparable(served), estimates: served.estimates.map((e, i) => (i === 1 ? { ...e, n_daily: e.n_daily * (1 + 1e-9) } : e)) }
    expect(firstDifference(reference, bumped)).toBe('.estimates[1].n_daily')
    expect(firstDifference(reference, { ...comparable(served), clusters: [...served.clusters].reverse() })).not.toBeNull()
    expect(firstDifference(reference, { ...comparable(served), daily: served.daily.slice(1) })).toBe('.daily.length')
  })
})

describe('SV3b: the refusals the browser also had', () => {
  const view = BRIDGE.sv3b

  it('names no daily trial when the view holds only monthly books', () => {
    const monthly = { ...view, rows: view.rows.filter((r) => r.periods !== 252) }
    expect(referenceEffectiveN(monthly, []).refusal).toEqual({ kind: 'no_daily', name: null, sessions: null })
  })

  it('refuses 251 common sessions and accepts 252', () => {
    const cut = (keep: number): ReferenceSeries[] => SERIES.map((s) => ({ ...s, date: s.date.slice(0, keep), r: s.r.slice(0, keep) }))
    expect(referenceEffectiveN(view, cut(251)).refusal).toEqual({ kind: 'too_few', name: null, sessions: 251 })
    expect(referenceEffectiveN(view, cut(252)).refusal).toBeNull()
  })
})

describe('SV8 step 8: the served effective members equal the browser reference', () => {
  it.each(BRIDGE.sv8.map((c) => [c.name, c] as const))('%s', (name, c) => {
    const ref = referenceMembers(c.names, c.correlation)
    // Every case is compared whole, the identical members included: a matrix of ones has the eigenvalue 3 exactly, the
    // browser's Jacobi returns it and the backend snaps the solver's 2.9999999999999996 to it, so Li and Ji is 1 on both.
    expect(firstDifference(ref, c.served)).toBeNull()
    if (name === 'identical') expect(c.served.li_ji).toBeCloseTo(1, 12)
    expect(ref.clusters).toEqual(c.served.clusters)
    expect(ref.refusal).toEqual(c.served.refusal)
    expect(ref.strongest).toEqual(c.served.strongest)
  })

  it('matches numpy on the four member family: participation 1.9115890083632017, Li and Ji 3', () => {
    const four = BRIDGE.sv8.find((c) => c.name === 'four')?.served
    expect(four?.participation).toBeCloseTo(1.9115890083632017, 12)
    expect(four?.li_ji).toBeCloseTo(3, 12)
    expect(four?.clusters).toEqual([['a_v0', 'b_v0', 'c_v0'], ['d_v0']])
  })

  it('covers both refusals and the tie rule', () => {
    const by = Object.fromEntries(BRIDGE.sv8.map((c) => [c.name, c.served]))
    expect(by.a_member_without_spread?.refusal).toEqual({ kind: 'undefined', name: 'y' })
    expect(by.one_member?.refusal).toEqual({ kind: 'single', name: null })
    expect(by.tie_on_the_strongest_pair?.strongest).toEqual({ a: 'x', b: 'y', rho: -0.7 })
  })

  it('born failing: a changed served participation is found', () => {
    const c = BRIDGE.sv8.find((x) => x.name === 'four')!
    expect(firstDifference(referenceMembers(c.names, c.correlation), { ...c.served, participation: (c.served.participation as number) + 1e-6 })).toBe('.participation')
  })
})
