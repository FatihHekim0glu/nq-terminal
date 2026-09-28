import { describe, expect, it } from 'vitest'
import { MNEMONICS, findMnemonic, type MnemonicDef } from '../commands/registry'
import type { ParsedCommand } from '../commands/parser'
import { DEFAULT_LAYOUTS, SCREEN_PHASES, layoutFor } from './WorkspaceLayouts'
import {
  panelSubject,
  applyPlan,
  effectiveContext,
  sanitiseParams,
  paramsFromCommand,
  panelTitle,
  planOpen,
  type DockApiLike,
  type PanelParams,
} from './WorkspaceModel'

function mnemonic(code: string): MnemonicDef {
  const def = findMnemonic(code)
  if (!def) throw new Error(`no mnemonic ${code}`)
  return def
}

function command(code: string, extra: Partial<ParsedCommand> = {}): ParsedCommand {
  return {
    mnemonic: mnemonic(code),
    context: null,
    contextSource: 'none',
    args: {},
    canonical: code,
    ...extra,
  }
}

interface FakePanel {
  id: string
  params: PanelParams
  title: string
  position: unknown
}

function fakeApi(existing: FakePanel[] = []): DockApiLike & { calls: string[]; store: FakePanel[] } {
  const store = [...existing]
  const calls: string[] = []
  return {
    calls,
    store,
    get panels() {
      return store.map((p) => ({ id: p.id, params: p.params }))
    },
    clear() {
      calls.push('clear')
      store.splice(0, store.length)
    },
    addPanel(options) {
      calls.push(`add ${options.id}`)
      store.push({ id: options.id, params: options.params, title: options.title, position: options.position })
    },
    replacePanel(id, params, title) {
      calls.push(`replace ${id}`)
      const panel = store.find((p) => p.id === id)
      if (!panel) throw new Error('missing panel')
      panel.params = params
      panel.title = title
    },
  }
}

describe('default layouts per screen', () => {
  it('has a layout for every mnemonic, whose first panel is that screen (HOME is the home layout)', () => {
    for (const def of MNEMONICS) {
      const layout = layoutFor(def.code)
      expect(layout.panels.length, def.code).toBeGreaterThan(0)
      expect(layout.screen).toBe(def.code)
      if (def.code !== 'HOME') expect(layout.panels[0]?.code, def.code).toBe(def.code)
    }
  })

  it('lays HOME out as the 2x2 home layout (look spec 7.1): left column first, then the right column', () => {
    const home = layoutFor('HOME')
    expect(home.panels.map((p) => `${p.group} ${panelTitle(p)}`)).toEqual([
      'A NQ GP 1d',
      'B volmanaged_v0 EQ',
      'A 27F MON',
      '- REG',
    ])
    expect(home.panels.map((p) => p.position?.direction)).toEqual([undefined, 'below', 'right', 'right'])
    expect(home.panels.map((p) => p.position?.ref)).toEqual([undefined, 'home-gp', 'home-gp', 'home-eq'])
  })

  it('keeps LIVE and OOS out of the default HOME (they open with Shift+Enter)', () => {
    const codes = layoutFor('HOME').panels.map((p) => p.code)
    expect(codes).not.toContain('LIVE')
    expect(codes).not.toContain('OOS')
  })

  it('gives every layout panel a unique id and a reference that exists earlier in the list', () => {
    for (const layout of Object.values(DEFAULT_LAYOUTS)) {
      const seen = new Set<string>()
      for (const panel of layout.panels) {
        expect(seen.has(panel.id), panel.id).toBe(false)
        if (panel.position) expect(seen.has(panel.position.ref), `${panel.id} ref`).toBe(true)
        seen.add(panel.id)
      }
    }
  })

  it('names a build phase for every P0 screen and none for P1 or P2', () => {
    for (const def of MNEMONICS) {
      if (def.priority === 'P0') expect(SCREEN_PHASES[def.code], def.code).toMatch(/^\d+$/)
    }
  })
})

describe('panel titles', () => {
  it('writes context, code and argument like the command line does', () => {
    expect(panelTitle({ code: 'GP', context: { kind: 'instrument', value: 'NQ' }, args: { timeframe: '1d' } })).toBe('NQ GP 1d')
    expect(panelTitle({ code: 'GIP', context: { kind: 'instrument', value: 'NQ' }, args: { date: '2019-03-14' } })).toBe('NQ GIP 2019-03-14')
    expect(panelTitle({ code: 'REG', context: null, args: {} })).toBe('REG')
  })
})

describe('planOpen: Enter replaces, Shift+Enter adds (UI_SPEC section 5)', () => {
  it('loads a multi-panel screen layout on Enter', () => {
    const plan = planOpen({ activePanelId: 'x', activeGroup: 'A', panelCount: 3 }, command('HOME'), false)
    expect(plan.kind).toBe('load')
    if (plan.kind === 'load') expect(plan.layout.screen).toBe('HOME')
  })

  it('replaces the focused panel on Enter and keeps its link group', () => {
    const cmd = command('GP', { context: { kind: 'instrument', value: 'ES' }, contextSource: 'typed' })
    const plan = planOpen({ activePanelId: 'p7', activeGroup: 'B', panelCount: 4 }, cmd, false)
    expect(plan).toEqual({
      kind: 'replace',
      panelId: 'p7',
      params: { code: 'GP', context: { kind: 'instrument', value: 'ES' }, args: {}, group: 'B' },
    })
  })

  it('loads the screen layout when nothing is focused, carrying the typed context', () => {
    const cmd = command('DES', { context: { kind: 'hypothesis', value: 'za_v0' }, contextSource: 'typed' })
    const plan = planOpen({ panelCount: 0 }, cmd, false)
    expect(plan.kind).toBe('load')
    if (plan.kind === 'load') {
      expect(plan.layout.panels[0]).toMatchObject({ code: 'DES', context: { kind: 'hypothesis', value: 'za_v0' } })
    }
  })

  it('adds a panel to the right of the focused one on Shift+Enter', () => {
    const plan = planOpen({ activePanelId: 'p2', activeGroup: 'A', panelCount: 2 }, command('LEDG'), true)
    expect(plan).toMatchObject({ kind: 'add', ref: 'p2', params: { code: 'LEDG', group: 'A' } })
  })

  it('adds an unlinked panel on Shift+Enter into an empty workspace', () => {
    const plan = planOpen({ panelCount: 0 }, command('LEDG'), true)
    expect(plan).toMatchObject({ kind: 'add', ref: undefined, params: { code: 'LEDG', group: '-' } })
  })

  // U20: F1 pressed twice used to replace the focused HOME panel with HELP, joining its link group
  // (A, B or C), as if HELP were a screen tied to that group's instrument. HELP added as its own new
  // panel (F1 twice, Shift+Enter or NXTW) never carries a link chip, regardless of what group was
  // active. HELP replacing a focused panel in place, however, keeps that panel's own link group like
  // any other replace (the module's own 'replaced in place, keeping its link group' contract): a
  // HELP <GO> must not permanently unlink the panel it appeared in from the next command run there.
  // Every other context-free screen (LEDG, above) keeps joining the active group unchanged.
  it('replacing a group-A panel in place with HELP keeps its link group, like any other replace', () => {
    const plan = planOpen({ activePanelId: 'p1', activeGroup: 'A', panelCount: 4 }, command('HELP'), false)
    expect(plan).toMatchObject({ kind: 'replace', panelId: 'p1', params: { code: 'HELP', group: 'A' } })
  })

  it('the command that follows a replaced HELP in the same panel still opens in its old link group', () => {
    const plan1 = planOpen({ activePanelId: 'p1', activeGroup: 'A', panelCount: 4 }, command('HELP'), false)
    expect(plan1.kind).toBe('replace')
    const group1 = plan1.kind === 'replace' ? plan1.params.group : '-'
    const plan2 = planOpen({ activePanelId: 'p1', activeGroup: group1, panelCount: 4 }, command('GP'), false)
    expect(plan2.kind).toBe('replace')
    expect(plan2.kind === 'replace' ? plan2.params.group : null).toBe('A')
  })

  it('never joins a link group for HELP opened as its own new panel (F1 twice, Shift+Enter or NXTW)', () => {
    const plan = planOpen({ activePanelId: 'p1', activeGroup: 'C', panelCount: 4 }, command('HELP'), true)
    expect(plan).toMatchObject({ kind: 'add', ref: 'p1', params: { code: 'HELP', group: '-' } })
  })
})

describe('applyPlan against a dockview-like api', () => {
  it('clears and adds every layout panel in order on load', () => {
    const api = fakeApi([{ id: 'old', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'load', layout: layoutFor('HOME') })
    expect(api.calls[0]).toBe('clear')
    expect(api.store.map((p) => p.params.code)).toEqual(['GP', 'EQ', 'MON', 'REG'])
    expect(api.store[2]?.position).toEqual({ referencePanel: 'home-gp', direction: 'right' })
  })

  it('replaces the params and title of one panel in place', () => {
    const api = fakeApi([{ id: 'p1', params: paramsFromCommand(command('REG'), 'A'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'replace', panelId: 'p1', params: paramsFromCommand(command('LEDG'), 'A') })
    expect(api.calls).toEqual(['replace p1'])
    expect(api.store[0]).toMatchObject({ id: 'p1', title: 'LEDG', params: { code: 'LEDG', group: 'A' } })
  })

  it('adds a new panel with an id no existing panel has', () => {
    const api = fakeApi([{ id: 'nqt-1', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'add', ref: 'nqt-1', params: paramsFromCommand(command('OOS'), '-') })
    const added = api.store[1]
    expect(added?.id).not.toBe('nqt-1')
    expect(added?.position).toEqual({ referencePanel: 'nqt-1', direction: 'right' })
  })

  it('born failing: a replace aimed at a panel that no longer exists falls back to adding', () => {
    const api = fakeApi()
    applyPlan(api, { kind: 'replace', panelId: 'gone', params: paramsFromCommand(command('OOS'), '-') })
    expect(api.calls.some((c) => c.startsWith('replace'))).toBe(false)
    expect(api.store.map((p) => p.params.code)).toEqual(['OOS'])
  })

  it('never opens a panel with no position once others exist, so dockview cannot hide it as a tab (D02)', () => {
    const api = fakeApi([{ id: 'p1', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'add', ref: undefined, params: paramsFromCommand(command('OOS'), '-') })
    const added = api.store[1]
    expect(added?.position).toEqual({ referencePanel: 'p1', direction: 'right' })
  })

  // U28: Shift+Enter from the focused panel (not necessarily the last in reading order) used to
  // insert the new one right beside it, renumbering every panel after it (Alt+N no longer reaching
  // them). It is now always appended after the last panel instead, so every existing number (and its
  // Alt+N) stays put; the new panel simply becomes the next number.
  it('adds the new panel after the last one in reading order, not beside the focused panel (U28)', () => {
    const api = fakeApi([
      { id: 'home-gp', params: paramsFromCommand(command('GP'), 'A'), title: 'NQ GP 1d', position: undefined },
      { id: 'home-eq', params: paramsFromCommand(command('EQ'), 'B'), title: 'EQ', position: { referencePanel: 'home-gp', direction: 'below' } },
      { id: 'home-mon', params: paramsFromCommand(command('MON'), 'A'), title: 'MON', position: { referencePanel: 'home-gp', direction: 'right' } },
      { id: 'home-reg', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: { referencePanel: 'home-eq', direction: 'right' } },
    ])
    // GP (home-gp) is focused: Shift+Enter on DES used to reference it, inserting DES second.
    applyPlan(api, { kind: 'add', ref: 'home-gp', params: paramsFromCommand(command('DES'), 'A') })
    const added = api.store.at(-1)
    expect(added?.params.code).toBe('DES')
    expect(added?.position).toEqual({ referencePanel: 'home-reg', direction: 'right' })
    // Every panel already there keeps its id (and so its reading-order number and Alt+N), untouched.
    expect(api.store.slice(0, 4).map((p) => p.id)).toEqual(['home-gp', 'home-eq', 'home-mon', 'home-reg'])
  })

  it('falls back to the last panel when the requested reference no longer exists (D02)', () => {
    const api = fakeApi([{ id: 'p1', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'add', ref: 'gone', params: paramsFromCommand(command('OOS'), '-') })
    const added = api.store[1]
    expect(added?.position).toEqual({ referencePanel: 'p1', direction: 'right' })
  })
})

describe('sanitiseParams: stored layouts are untrusted input', () => {
  it('keeps well-formed params', () => {
    const good = { code: 'GP', context: { kind: 'instrument', value: 'NQ' }, args: { timeframe: '1d' }, group: 'A' }
    expect(sanitiseParams(good)).toEqual(good)
  })

  it('born failing: refuses an unknown code, a bad group, a malformed context or a bad argument', () => {
    expect(sanitiseParams({ code: 'ORDERS', context: null, args: {}, group: '-' })).toBeNull()
    expect(sanitiseParams({ code: 'REG', context: null, args: {}, group: 'Z' })).toBeNull()
    expect(sanitiseParams({ code: 'GP', context: { kind: 'instrument', value: '<img src=x>' }, args: {}, group: 'A' })).toBeNull()
    expect(sanitiseParams({ code: 'GP', context: { kind: 'file', value: 'NQ' }, args: {}, group: 'A' })).toBeNull()
    expect(sanitiseParams({ code: 'GIP', context: null, args: { date: '2019/03/14' }, group: 'A' })).toBeNull()
    expect(sanitiseParams({ code: 'GP', context: null, args: { timeframe: '7m' }, group: 'A' })).toBeNull()
    expect(sanitiseParams(null)).toBeNull()
    expect(sanitiseParams('REG')).toBeNull()
  })

  it('drops unknown keys instead of passing them on', () => {
    const out = sanitiseParams({ code: 'REG', context: null, args: { extra: 'x' }, group: '-', html: '<b>' })
    expect(out).toEqual({ code: 'REG', context: null, args: {}, group: '-' })
  })
})

describe('effectiveContext: link groups retarget panels that accept the kind', () => {
  const gp = { code: 'GP' as const, context: { kind: 'instrument' as const, value: 'NQ' }, args: {}, group: 'A' as const }

  it('uses the group context when the screen accepts its kind', () => {
    expect(effectiveContext(gp, { kind: 'instrument', value: 'ES' })).toEqual({ kind: 'instrument', value: 'ES' })
  })

  it('keeps the panel context when the group context is another kind or absent', () => {
    expect(effectiveContext(gp, { kind: 'run', value: 'r1' })).toEqual(gp.context)
    expect(effectiveContext(gp, null)).toEqual(gp.context)
  })

  it('never retargets an unlinked panel', () => {
    expect(effectiveContext({ ...gp, group: '-' }, { kind: 'instrument', value: 'ES' })).toEqual(gp.context)
  })
})

describe('panelSubject: the context and argument the title bar shows (look spec 4.3)', () => {
  it('shows an instrument as its generic ticker with the sector, like the status line', () => {
    expect(panelSubject({ context: { kind: 'instrument', value: 'NQ' }, args: { timeframe: '1d' } })).toBe('NQ1 Index 1d')
    expect(panelSubject({ context: { kind: 'instrument', value: 'ZN' }, args: {} })).toBe('TY1 Comdty')
  })

  it('shows other contexts by name, and the argument alone when there is no context', () => {
    expect(panelSubject({ context: { kind: 'hypothesis', value: 'volmanaged_v0' }, args: {} })).toBe('volmanaged_v0')
    expect(panelSubject({ context: null, args: { date: '2019-03-14' } })).toBe('2019-03-14')
  })
})
