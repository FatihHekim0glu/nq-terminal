import { describe, expect, it } from 'vitest'
import { MNEMONICS } from '../commands/registry'
import { SCREEN_PHASES } from './WorkspaceLayouts'
import { BUILT_SCREENS, builtScreens } from './WorkspaceScreens'

describe('the screen registry after phases 6 and 7', () => {
  it('registers a built screen for every P0 mnemonic with a delivery phase', () => {
    const built = builtScreens(BUILT_SCREENS)
    const phased = Object.keys(SCREEN_PHASES)
    expect(phased.length).toBeGreaterThanOrEqual(20)
    expect(phased.filter((code) => !built.has(code))).toEqual([])
  })

  it('registers only mnemonics the command registry knows', () => {
    const known = new Set(MNEMONICS.map((m) => m.code))
    expect(Object.keys(BUILT_SCREENS).filter((code) => !known.has(code as never))).toEqual([])
  })

  it('born failing: a registry missing one phased screen is reported', () => {
    const { MT: _dropped, ...rest } = BUILT_SCREENS
    const built = builtScreens(rest)
    expect(Object.keys(SCREEN_PHASES).filter((code) => !built.has(code))).toEqual(['MT'])
  })
})
