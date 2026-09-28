import { describe, expect, it } from 'vitest'
import { BUILT_SCREENS, builtScreens } from '../chrome/WorkspaceScreens'
import { BUILT_CODES, isBuilt } from './built'
import { MNEMONICS } from './registry'

/** The codes one side holds and the other lacks, both ways, sorted. */
function drift(codes: ReadonlySet<string>, screens: ReadonlySet<string>): { readonly listedOnly: string[]; readonly screenOnly: string[] } {
  return {
    listedOnly: [...codes].filter((c) => !screens.has(c)).sort(),
    screenOnly: [...screens].filter((c) => !codes.has(c)).sort(),
  }
}

describe('the built mnemonic codes (one set for suggestions and menus)', () => {
  it('equal the keys of BUILT_SCREENS exactly', () => {
    expect(drift(BUILT_CODES, builtScreens(BUILT_SCREENS))).toEqual({ listedOnly: [], screenOnly: [] })
    expect(BUILT_CODES.size).toBe(Object.keys(BUILT_SCREENS).length)
  })

  it('hold every P0 and P1 mnemonic and leave JOBS, the P2 slot, unbuilt', () => {
    for (const m of MNEMONICS) expect(isBuilt(m.code), m.code).toBe(m.priority !== 'P2')
    expect(isBuilt('JOBS')).toBe(false)
    expect(isBuilt('VCONE')).toBe(true)
  })

  it('answer false for a code the registry does not know', () => {
    expect(isBuilt('NOPE')).toBe(false)
    expect(isBuilt('')).toBe(false)
    expect(isBuilt('vcone')).toBe(false)
  })

  it('born failing: a screen registry missing one code, or holding an extra one, is reported', () => {
    const { VCONE: _dropped, ...rest } = BUILT_SCREENS
    expect(drift(BUILT_CODES, builtScreens(rest))).toEqual({ listedOnly: ['VCONE'], screenOnly: [] })
    expect(drift(BUILT_CODES, new Set([...BUILT_CODES, 'JOBS']))).toEqual({ listedOnly: [], screenOnly: ['JOBS'] })
  })
})
