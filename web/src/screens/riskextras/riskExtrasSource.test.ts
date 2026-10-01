// The risk extras GET path as the image caption and the dossier name it (tearSource.ts keeps the other tear sheet
// paths): the run at its freq, the hypothesis at its cost, encoded by the client's own builder.
import { describe, expect, it } from 'vitest'
import { riskExtrasPath } from './riskExtrasSource'

describe('riskExtrasPath', () => {
  it('names a run at its freq', () => {
    expect(riskExtrasPath({ kind: 'run', name: 'nt_za_v0_ts1' }, { cost: null, freq: 'M' })).toBe('/api/analytics/run/nt_za_v0_ts1/risk-extras?freq=M')
  })

  it('names a hypothesis at its cost, and without one when it has none', () => {
    expect(riskExtrasPath({ kind: 'hypothesis', name: 'volmanaged_v0' }, { cost: 1, freq: 'D' })).toBe('/api/analytics/hypothesis/volmanaged_v0/risk-extras?cost=1')
    expect(riskExtrasPath({ kind: 'hypothesis', name: 'volmanaged_v0' }, { cost: null, freq: 'D' })).toBe('/api/analytics/hypothesis/volmanaged_v0/risk-extras')
  })

  it('born failing: a name is encoded, never spliced into the path', () => {
    expect(riskExtrasPath({ kind: 'run', name: 'a/b' }, { cost: null, freq: 'D' })).not.toContain('a/b')
  })
})
