import { describe, expect, it } from 'vitest'
import { findCopyViolations } from './copyRules'

// Every copy module in this folder (tests and the rules file itself excluded), so a new file is
// checked without anyone remembering to register it.
const modules = import.meta.glob<Record<string, unknown>>(
  ['./*.ts', '!./*.test.ts', '!./copyRules.ts'],
  { eager: true },
)

describe('user-facing copy (UI_SPEC section 10)', () => {
  it('finds at least one copy module to check', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0)
  })

  it('has no em or en dashes and no US spellings in any copy module', () => {
    const violations = Object.entries(modules).flatMap(([file, mod]) =>
      findCopyViolations(mod).map((v) => `${file} ${v.path}: ${v.rule}`),
    )
    expect(violations).toEqual([])
  })
})

describe('born-failing cases (rule 5): the guard must catch what it bans', () => {
  it('flags an em dash and an en dash, at any depth', () => {
    const bad = { a: 'read only \u2014 no orders', nested: { b: ['2010\u20132021'] } }
    const rules = findCopyViolations(bad).map((v) => `${v.path}:${v.rule}`)
    expect(rules).toContain('a:em dash')
    expect(rules).toContain('nested.b.0:en dash')
  })

  it('flags US spellings the spec names', () => {
    const bad = { a: 'Normalize the color', b: 'analyze behavior' }
    const rules = findCopyViolations(bad).map((v) => v.rule)
    expect(rules).toEqual(
      expect.arrayContaining(['US spelling: normalize', 'US spelling: color', 'US spelling: analyze', 'US spelling: behavior']),
    )
  })

  it('passes the UK forms and plain hyphens', () => {
    expect(findCopyViolations({ a: 'normalise the colour, analyse behaviour, 2010-01-01..2021-12-31' })).toEqual([])
  })
})
