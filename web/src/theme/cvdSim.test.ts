// The sign colours (gain against loss) must stay apart for the reader each CVD theme is for (section 2.3).
// Each theme is checked under a simulation of its own deficiency (Machado, Oliveira and Fernandes 2009,
// severity 1), and the default red and green bar pair is the born-failing case.
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import { readTokens } from './contrast'
import { CVD_SIGN_PAIRS, MIN_SIGN_DELTA_E, auditCvdSigns, cvdDeltaE, simulateCvd } from './cvdSim'

describe('CVD simulation', () => {
  it('leaves white and black unchanged', () => {
    for (const kind of ['deut', 'prot'] as const) {
      expect(simulateCvd('#FFFFFF', kind).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 1, 1])
      expect(simulateCvd('#000000', kind)).toEqual([0, 0, 0])
    }
  })

  it('collapses the default red and green bars for a deuteranope (the reason the theme exists)', () => {
    expect(cvdDeltaE('#00851C', '#C31834', 'deut')).toBeLessThan(5)
  })
})

describe('tokens.css: sign colours in the CVD themes', () => {
  it('checks the bar, the performance fill and the up and down pairs', () => {
    expect(CVD_SIGN_PAIRS).toEqual(expect.arrayContaining([['bar-pos', 'bar-neg'], ['perf-pos', 'perf-neg'], ['c-up', 'c-down']]))
  })

  it.each(['deut', 'prot'] as const)('keeps every sign pair apart in the %s theme', (kind) => {
    expect(auditCvdSigns(readTokens(tokensCss, kind), kind)).toEqual([])
  })

  it('fails a theme that leaves the bars red and green', () => {
    const plain = readTokens(tokensCss)
    const failed = auditCvdSigns(plain, 'deut').map((f) => f.pair.join('/'))
    expect(failed).toEqual(expect.arrayContaining(['bar-pos/bar-neg', 'perf-pos/perf-neg', 'c-up/c-down']))
    expect(auditCvdSigns(plain, 'prot').every((f) => f.deltaE < MIN_SIGN_DELTA_E)).toBe(true)
    expect(auditCvdSigns(plain, 'prot').map((f) => f.pair.join('/'))).toContain('bar-pos/bar-neg')
  })
})
