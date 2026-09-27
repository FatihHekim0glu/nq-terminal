import { describe, expect, it } from 'vitest'
import type { ScreenLayout } from '../../chrome/WorkspaceLayouts'
import { MNEMONICS } from '../../commands/registry'
import { DEFAULT_LAYOUTS, HOME_PANEL_IDS, SCREEN_PHASES, layoutFor } from './layouts'
import { layoutProblems } from './validate'

describe('default layouts (UI_SPEC sections 2 and 7, look spec 7.1)', () => {
  it('has a layout for every mnemonic in the registry, keyed by its code', () => {
    expect(Object.keys(DEFAULT_LAYOUTS).sort()).toEqual(MNEMONICS.map((m) => m.code).sort())
    for (const m of MNEMONICS) expect(layoutFor(m.code).screen).toBe(m.code)
  })

  it('every layout passes the checks: unique ids, earlier refs, accepted contexts, valid groups', () => {
    const problems = Object.values(DEFAULT_LAYOUTS).flatMap((layout) => layoutProblems(layout))
    expect(problems).toEqual([])
  })

  it('HOME is the 2x2 launchpad: GP [A] NQ 1d, MON [A] 27F, EQ [B] volmanaged_v0, REG unlinked', () => {
    const home = layoutFor('HOME')
    const byId = new Map(home.panels.map((p) => [p.id, p]))
    expect(home.panels).toHaveLength(4)
    expect(byId.get(HOME_PANEL_IDS.gp)).toMatchObject({ code: 'GP', context: { kind: 'instrument', value: 'NQ' }, args: { timeframe: '1d' }, group: 'A' })
    expect(byId.get(HOME_PANEL_IDS.mon)).toMatchObject({ code: 'MON', context: { kind: 'universe', value: '27F' }, group: 'A' })
    expect(byId.get(HOME_PANEL_IDS.eq)).toMatchObject({ code: 'EQ', context: { kind: 'hypothesis', value: 'volmanaged_v0' }, group: 'B' })
    expect(byId.get(HOME_PANEL_IDS.reg)).toMatchObject({ code: 'REG', context: null, group: '-' })
  })

  it('HOME builds the left column first, then splits each row to the right, so reading order is GP, MON, EQ, REG', () => {
    const home = layoutFor('HOME')
    expect(home.panels.map((p) => [p.id, p.position?.ref ?? null, p.position?.direction ?? null])).toEqual([
      [HOME_PANEL_IDS.gp, null, null],
      [HOME_PANEL_IDS.eq, HOME_PANEL_IDS.gp, 'below'],
      [HOME_PANEL_IDS.mon, HOME_PANEL_IDS.gp, 'right'],
      [HOME_PANEL_IDS.reg, HOME_PANEL_IDS.eq, 'right'],
    ])
  })

  it('LIVE and OOS are not in HOME; they open with Shift+Enter (look spec 7.1)', () => {
    const codes = layoutFor('HOME').panels.map((p) => p.code)
    expect(codes).not.toContain('LIVE')
    expect(codes).not.toContain('OOS')
  })

  it('REG sits beside MT and LIVE above JRNL, unlinked', () => {
    expect(layoutFor('REG').panels.map((p) => [p.code, p.group, p.position?.direction ?? null])).toEqual([
      ['REG', '-', null],
      ['MT', '-', 'right'],
    ])
    expect(layoutFor('LIVE').panels.map((p) => [p.code, p.group, p.position?.direction ?? null])).toEqual([
      ['LIVE', '-', null],
      ['JRNL', '-', 'below'],
    ])
  })

  it('every other screen opens as one unlinked panel with no context', () => {
    const multi = new Set(['HOME', 'REG', 'LIVE'])
    for (const m of MNEMONICS.filter((x) => !multi.has(x.code))) {
      expect(layoutFor(m.code).panels).toEqual([{ id: `${m.code.toLowerCase()}-main`, code: m.code, context: null, args: {}, group: '-' }])
    }
  })

  it('panel ids are unique across every layout, so a stored panel never matches two defaults', () => {
    const ids = Object.values(DEFAULT_LAYOUTS).flatMap((l) => l.panels.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('round-trips through JSON unchanged (dockview keeps the params in its serialised layout)', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_LAYOUTS))).toEqual(DEFAULT_LAYOUTS)
  })

  it('is frozen, so no caller can edit a default in place', () => {
    expect(Object.isFrozen(DEFAULT_LAYOUTS)).toBe(true)
    expect(Object.isFrozen(layoutFor('HOME'))).toBe(true)
    expect(Object.isFrozen(layoutFor('HOME').panels)).toBe(true)
  })

  it('names a build phase for every P0 screen, and none for P1 or P2', () => {
    for (const m of MNEMONICS) {
      if (m.priority === 'P0') expect(SCREEN_PHASES[m.code], m.code).toMatch(/^\d+$/)
      else expect(SCREEN_PHASES[m.code], m.code).toBeUndefined()
    }
    expect(SCREEN_PHASES.HOME).toBe('7')
  })
})

describe('layoutProblems, born failing (rule 5): each check catches what it bans', () => {
  const good: ScreenLayout = {
    screen: 'REG',
    panels: [
      { id: 'a', code: 'REG', context: null, args: {}, group: '-' },
      { id: 'b', code: 'MT', context: null, args: {}, group: '-', position: { ref: 'a', direction: 'right' } },
    ],
  }

  it('passes a sound layout', () => {
    expect(layoutProblems(good)).toEqual([])
  })

  it('flags an empty layout', () => {
    expect(layoutProblems({ screen: 'REG', panels: [] })).toEqual(['REG: no panels'])
  })

  it('flags a repeated id', () => {
    const bad = { ...good, panels: [good.panels[0]!, { ...good.panels[1]!, id: 'a' }] }
    expect(layoutProblems(bad)).toContain('REG: panel id a repeats')
  })

  it('flags a position on the first panel and a ref to a later or unknown panel', () => {
    const first = { ...good, panels: [{ ...good.panels[0]!, position: { ref: 'b', direction: 'right' as const } }, { ...good.panels[1]!, position: undefined }] }
    expect(layoutProblems(first)).toContain('REG: the first panel a has a position')
    expect(layoutProblems(first)).toContain('REG: panel b has no position')
    const later = { ...good, panels: [good.panels[0]!, { ...good.panels[1]!, position: { ref: 'zz', direction: 'right' as const } }] }
    expect(layoutProblems(later)).toContain('REG: panel b refers to zz, which is not an earlier panel')
  })

  it('flags a context the function does not take, and a missing context on a linked panel', () => {
    const wrongKind = { ...good, panels: [{ ...good.panels[0]!, code: 'GP' as const, context: { kind: 'hypothesis' as const, value: 'za_v0' } }] }
    expect(layoutProblems(wrongKind)).toContain('REG: panel a (GP) does not take a hypothesis context')
    const noneTaken = { ...good, panels: [{ ...good.panels[0]!, context: { kind: 'instrument' as const, value: 'NQ' } }] }
    expect(layoutProblems(noneTaken)).toContain('REG: panel a (REG) does not take a instrument context')
    const linkedEmpty = { ...good, panels: [{ ...good.panels[0]!, code: 'EQ' as const, group: 'B' as const }] }
    expect(layoutProblems(linkedEmpty)).toContain('REG: panel a (EQ) is in link group B with no context')
  })

  it('flags an unknown mnemonic, a bad link group and a bad argument', () => {
    const unknown = { ...good, panels: [{ ...good.panels[0]!, code: 'ZZZ' as never }] }
    expect(layoutProblems(unknown)).toContain('REG: panel a has an unknown function ZZZ')
    const group = { ...good, panels: [{ ...good.panels[0]!, group: 'D' as never }] }
    expect(layoutProblems(group)).toContain('REG: panel a has an unknown link group D')
    const arg = { ...good, panels: [{ ...good.panels[0]!, code: 'GP' as const, context: { kind: 'instrument' as const, value: 'NQ' }, args: { timeframe: '2m' } }] }
    expect(layoutProblems(arg)).toContain('REG: panel a (GP) has a bad argument')
  })
})
