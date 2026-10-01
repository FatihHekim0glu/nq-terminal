import { describe, expect, it } from 'vitest'
import { benchmarkName, spaBootstrapLine, spaCaption, spaExcluded, spaFacts, spaPValues, spaRows, spaStepM } from './spaModel'
import { SPA_HELD, SPA_NONE, SPA_REJECTS } from './spaFixtures'

describe('SV8 on screen: the family facts', () => {
  it('names the family size, the common sessions, the cost and the loss', () => {
    expect(spaFacts(SPA_REJECTS)).toEqual([
      '3 pre-registered NQ hypotheses on one contract; 2,806 common sessions, 2010-10-26 to 2021-12-31; 1 tick per side; losses -r against cash (zero return each session), in USD per session, one NQ contract.',
    ])
  })

  it('names the benchmark of each row, and counts the sessions the buy and hold row loses to its gaps', () => {
    expect(benchmarkName(SPA_REJECTS)).toBe('cash (zero return each session)')
    expect(benchmarkName(SPA_HELD)).toBe('NQ buy and hold on one contract')
    expect(spaFacts(SPA_HELD)).toEqual([
      '3 pre-registered NQ hypotheses on one contract; 2,806 common sessions, 2010-10-26 to 2021-12-31; 1 tick per side; losses -r against NQ buy and hold on one contract, in USD per session, one NQ contract.',
      '2 shared sessions left out because the benchmark has no close change.',
    ])
  })

  it('gives the two member tables distinct captions that name their benchmarks', () => {
    expect(spaCaption(SPA_REJECTS)).toBe('Family members: mean return and mean differential against cash (zero return each session), USD per session on one contract')
    expect(spaCaption(SPA_HELD)).toContain('against NQ buy and hold on one contract')
    expect(spaCaption(SPA_REJECTS)).not.toBe(spaCaption(SPA_HELD))
  })

  it('states the bootstrap settings', () => {
    expect(spaBootstrapLine(SPA_REJECTS)).toBe('Stationary bootstrap: block 21.37 sessions, 10,000 replications, seed 20260927.')
  })

  it('shows the three SPA p-values and the Reality Check p-value to 4 decimals', () => {
    expect(spaPValues(SPA_REJECTS)).toBe(
      "SPA p-values (non-studentised, arch form): consistent 0.0034, lower 0.0021, upper 0.0052. White's Reality Check p-value 0.0052.",
    )
  })
})

describe('SV8 on screen: StepM', () => {
  it('names the rejected members in registry order with the steps taken', () => {
    expect(spaStepM(SPA_REJECTS)).toBe('StepM at family-wise size 0.05 (3 steps): rejects overnight_v0, halloween_v0.')
  })

  it('born failing: an empty StepM set says none, never an empty list of names', () => {
    const line = spaStepM(SPA_NONE)
    expect(line).toMatch(/rejects none/)
    expect(line).not.toMatch(/rejects \./)
    expect(line).toContain('No member is shown to have a positive mean.')
    expect(spaStepM(SPA_HELD)).toContain('No member is shown to beat NQ buy and hold on one contract.')
  })
})

describe('SV8 on screen: the member table and the excluded rows', () => {
  it('formats every member with its StepM step and its left-out sessions', () => {
    const rows = spaRows(SPA_REJECTS)
    expect(rows.map((r) => r.name)).toEqual(['za_v0', 'overnight_v0', 'halloween_v0'])
    expect(rows[0]).toEqual({
      name: 'za_v0', meanReturn: '12.50', meanDiff: '12.50', block: '21.2', consistent: 'no',
      stepm: 'not rejected', leftOut: '19 (19 with P&L)', rejected: false,
    })
    expect(rows[1]?.stepm).toBe('rejected at step 2')
    expect(rows[2]?.stepm).toBe('rejected at step 1')
  })

  it('lists the registered hypotheses outside the family with their reasons, or says there are none', () => {
    expect(spaExcluded(SPA_REJECTS)).toEqual([
      'volmanaged_v0: its series is in return on capital per session, not USD per session on one NQ contract.',
      'tsmom_v0: a monthly book: its result files hold no daily series.',
    ])
    expect(spaExcluded(SPA_NONE)).toEqual([])
  })
})
