// The tear sheet pointer of a designed gap (analytics.ts evidenceHint) is read from the bodies themselves. A run
// counts as evidence only if the tear sheet can open, and it opens through the run record first (RUN_DETAILS) and
// then the analytics: a run with analytics and no record must not be promised.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evidenceHint, evidenceInDemo } from './analytics'

const held = vi.hoisted(() => ({ ids: new Set<string>() }))

vi.mock('./runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runs')>()),
  RUN_DETAILS: { has: (id: string) => held.ids.has(id) },
}))

beforeEach(() => held.ids.clear())

describe('evidenceInDemo names the runs that have both a record and analytics', () => {
  it('names none while no run has a record, even though two runs have analytics', () => {
    expect(evidenceInDemo().runs).toEqual([])
    expect(evidenceHint()).not.toContain('run tear sheets')
    expect(evidenceHint()).toContain('volmanaged_v0 DES, EQ and RET at 1 tick per side')
  })

  it('names a run once its record is held, and only that one', () => {
    held.ids.add('smoke_2015_01')
    expect(evidenceInDemo().runs).toEqual(['smoke_2015_01'])
    expect(evidenceHint()).toBe('Evidence in this demo: volmanaged_v0 DES, EQ and RET at 1 tick per side; run tear sheets for smoke_2015_01')
  })

  it('never names a run that has a record and no analytics', () => {
    held.ids.add('nt_dtsmom_v0_fixture_ts1')
    expect(evidenceInDemo().runs).toEqual([])
  })

  it('names both once both are held', () => {
    held.ids.add('nt_volmanaged_v0_fixture_m1')
    held.ids.add('smoke_2015_01')
    expect(evidenceInDemo().runs).toEqual(['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01'])
  })
})
