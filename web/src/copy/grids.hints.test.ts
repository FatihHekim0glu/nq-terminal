// The shared column hints (U03) are keyed by header text, so each key must be a header some grid really
// draws, and each text must follow the house style and say something the header does not.
import { describe, expect, it } from 'vitest'
import { MT_COLUMNS, REG_COLUMNS, REG_COMPACT_COLUMNS } from '../screens/reg/regColumns'
import { findCopyViolations } from './copyRules'
import { COLUMN_HINTS } from './grids'

const HEADERS = new Set([...REG_COLUMNS, ...REG_COMPACT_COLUMNS, ...MT_COLUMNS].map((c) => c.header))

describe('COLUMN_HINTS', () => {
  it('has a hint for the words the dogfood round could not read: Holm, BH q, Hash ok, Amend', () => {
    for (const word of ['Holm', 'BH q', 'Hash ok', 'Amend']) expect(COLUMN_HINTS[word], word).toBeTruthy()
  })

  // The full board may name the family in a header ('Holm (family)', U02); the short word must be drawn either way.
  it('is keyed only by headers the REG and MT grids draw (or their family form)', () => {
    for (const key of Object.keys(COLUMN_HINTS)) expect(HEADERS.has(key) || HEADERS.has(key.replace(/ \(family\)$/, '')), key).toBe(true)
  })

  it('gives the family headers the same reading as the short ones they replace on a wide panel', () => {
    expect(COLUMN_HINTS['Holm (family)']).toBe(COLUMN_HINTS.Holm)
    expect(COLUMN_HINTS['BH q (family)']).toBe(COLUMN_HINTS['BH q'])
    expect(COLUMN_HINTS['Bonf (family)']).toBe(COLUMN_HINTS.Bonf)
  })

  // U02: family-adjusted p never changes PASS or FAIL, so no hint may say that a p "passes" a boundary.
  it('the MT line hints never say a p passes: the boundary is context and PASS or FAIL is the spec\'s own bar', () => {
    for (const key of ['Bonf line', 'Holm line', 'BH line']) {
      const hint = COLUMN_HINTS[key] ?? ''
      expect(hint, key).not.toMatch(/\bpasses\b/i)
      expect(hint, key).toContain('PASS or FAIL is')
      expect(hint, key).toContain('a p under it clears the family correction')
    }
  })

  it('no hint reads "pass" or "passes" except as the words PASS or FAIL (the verdict wording)', () => {
    for (const [header, text] of Object.entries(COLUMN_HINTS)) {
      expect(text.replace(/PASS or FAIL/g, ''), header).not.toMatch(/\bpass(es)?\b/i)
    }
    expect(COLUMN_HINTS['Verdict']).toContain('PASS or FAIL')
  })

  it('reads as sentences in house style: a full stop, no dashes, UK spelling, longer than the header', () => {
    for (const [header, text] of Object.entries(COLUMN_HINTS)) {
      expect(text, header).toMatch(/[.)]$/)
      expect(text.length, header).toBeGreaterThan(header.length + 10)
    }
    expect(findCopyViolations(COLUMN_HINTS)).toEqual([])
  })
})
