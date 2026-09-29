// D13: NXTW opens whatever follows it in a new panel (line.ts), and parseLine accepts the whole grammar
// after it, but suggest() had no NXTW handling, so the sheet stayed empty and Tab did nothing once NXTW
// was a complete token. Regression tests live here, next to suggest.ts, rather than in suggest.test.ts
// (owned by the roadmap wave 2 worker running in parallel).
import { describe, expect, it } from 'vitest'
import { suggest } from './suggest'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0'],
  confirmations: [],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

const values = (line: string, index: CommandIndexData | null = INDEX) => suggest(line, index).map((s) => s.value)

describe('suggest() after a complete NXTW token (D13)', () => {
  it('suggests contexts and instruments for the token after NXTW', () => {
    expect(values('NXTW N')).toContain('NXTW NQ1 Index ')
  })

  it('Tab-completes functions for a context typed after NXTW', () => {
    expect(values('NXTW NQ ')).toContain('NXTW NQ GP ')
  })

  it('matches NXTW in any case, and always completes it in its canonical case (as other suggestions do)', () => {
    expect(values('nxtw N')).toContain('NXTW NQ1 Index ')
    expect(values('NxTw N')).toContain('NXTW NQ1 Index ')
  })

  it('still just Tab-completes the word itself while NXTW is not yet a complete token', () => {
    expect(values('NX')).toContain('NXTW ')
    expect(values('NX').some((v) => v.startsWith('NXTW N'))).toBe(false)
  })

  it('offers argument suggestions two tokens after NXTW', () => {
    expect(values('NXTW NQ GP ')).toEqual(['NXTW NQ GP 1m', 'NXTW NQ GP 5m', 'NXTW NQ GP 1h', 'NXTW NQ GP 1d'])
  })

  it('offers nothing past the argument slot, same as without NXTW', () => {
    expect(values('NXTW NQ GP 1h ')).toEqual([])
  })
})

// D13 (fixer wave): after NXTW, parseLine goes straight to parseRest (line.ts), which never runs
// chromeAction, so HL, NO, MENU, LAST and a second NXTW are not valid there; the suggestion list must
// not offer them, or Tab would complete a line that parseLine then rejects.
describe('suggest() after NXTW no longer offers chrome words parseLine rejects there (D13)', () => {
  it('never suggests a bare chrome word (HL, NO, MENU, LAST, NXTW) as the token right after NXTW', () => {
    const barred = /^NXTW (HL|NO|MENU|LAST|NXTW) $/
    expect(values('NXTW ').some((v) => barred.test(v))).toBe(false)
    expect(values('NXTW N').some((v) => barred.test(v))).toBe(false)
  })

  it("Tab-completing 'NXTW N' no longer lands on the barred chrome word NO", () => {
    expect(values('NXTW N')[0]).toBe('NXTW NQ1 Index ')
  })

  it('still suggests MAIN after NXTW: line.ts aliases it to HOME inside parseRest', () => {
    expect(values('NXTW M')).toContain('NXTW MAIN ')
  })

  it('leaves the top-level suggestion list (not after NXTW) unchanged', () => {
    expect(values('NX')).toContain('NXTW ')
  })
})
