// The fixtures of MT 87) Effective trials are copies of served numbers, so they are pinned to their sources:
// effectiveN.fixtures.ts (the synthetic served view) to `sv3b` of qa/golden/p2_neff_served.json, which the backend test
// keeps equal to what the route serves, and effectiveN.real.fixtures.ts (the captured real effective_n over the 21 rows
// of DEFLATED_REAL) to the SV3 rows it sits beside.
import { describe, expect, it } from 'vitest'
import bridge from '../../../../qa/golden/p2_neff_served.json?raw'
import { DEFLATED_REAL } from './deflatedFixtures'
import { SYNTHETIC_VIEW } from './effectiveN.fixtures'
import { EFFECTIVE_N_REAL } from './effectiveN.real.fixtures'

describe('effectiveN.fixtures', () => {
  it('is the served synthetic view of the bridge file, number for number', () => {
    expect(SYNTHETIC_VIEW).toEqual((JSON.parse(bridge) as { sv3b: unknown }).sv3b)
  })

  it('is labelled synthetic where the gallery shows it and holds nine daily trials and two monthly books', () => {
    expect(SYNTHETIC_VIEW.effective_n.daily).toHaveLength(9)
    expect(SYNTHETIC_VIEW.effective_n.monthly).toHaveLength(2)
    expect(SYNTHETIC_VIEW.n_trials).toBe(11)
  })
})

describe('effectiveN.real.fixtures', () => {
  it('names the 15 daily trials and 6 monthly books of DEFLATED_REAL, in its row order', () => {
    const daily = DEFLATED_REAL.rows.filter((r) => r.periods === 252).map((r) => r.name)
    const monthly = DEFLATED_REAL.rows.filter((r) => r.periods === 12).map((r) => r.name)
    expect(EFFECTIVE_N_REAL.daily).toEqual(daily)
    expect(EFFECTIVE_N_REAL.monthly).toEqual(monthly)
    expect(EFFECTIVE_N_REAL.dsr.map((d) => d.name)).toEqual(DEFLATED_REAL.rows.map((r) => r.name))
  })

  it('serves, as the registered row, the N and SR0 DEFLATED_REAL serves', () => {
    const registered = EFFECTIVE_N_REAL.estimates[0]!
    expect(registered).toMatchObject({ id: 'registered', served: true, n_total: DEFLATED_REAL.n_trials, n_daily: 15 })
    expect(registered.sr0_session).toBeCloseTo(DEFLATED_REAL.sr0_null_session as number, 12)
  })

  it('serves, as each served DSR, the dsr_null DEFLATED_REAL serves (the same series, so the same number)', () => {
    EFFECTIVE_N_REAL.dsr.forEach((d, i) => {
      const want = DEFLATED_REAL.rows[i]!.dsr_null as number
      expect(Math.abs((d.served as number) - want)).toBeLessThanOrEqual(1e-9 * Math.max(want, 1e-300) + 1e-12)
    })
  })

  it('has no refusal: a window of at least 252 sessions and a matrix of 15 by 15', () => {
    expect(EFFECTIVE_N_REAL.refusal).toBeNull()
    expect(EFFECTIVE_N_REAL.window!.sessions).toBeGreaterThanOrEqual(252)
    expect(EFFECTIVE_N_REAL.correlation).toHaveLength(15)
    for (const row of EFFECTIVE_N_REAL.correlation) expect(row).toHaveLength(15)
  })
})
