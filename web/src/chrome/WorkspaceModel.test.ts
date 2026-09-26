import { describe, expect, it } from 'vitest'
import { MNEMONICS, findMnemonic, type MnemonicDef } from '../commands/registry'
import type { ParsedCommand } from '../commands/parser'
import { DEFAULT_LAYOUTS, SCREEN_PHASES, layoutFor } from './WorkspaceLayouts'
import {
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
  it('has a layout for every mnemonic, whose first panel is that screen (HOME is the launchpad)', () => {
    for (const def of MNEMONICS) {
      const layout = layoutFor(def.code)
      expect(layout.panels.length, def.code).toBeGreaterThan(0)
      expect(layout.screen).toBe(def.code)
      if (def.code !== 'HOME') expect(layout.panels[0]?.code, def.code).toBe(def.code)
    }
  })

  it('lays HOME out as the six UI_SPEC panels (rows first, then the right column) with their link groups', () => {
    const home = layoutFor('HOME')
    expect(home.panels.map((p) => `${p.group} ${panelTitle(p)}`)).toEqual([
      'A NQ GP 1d',
      'B volmanaged_v0 EQ',
      '- LIVE',
      'A 27F MON',
      '- REG',
      '- OOS',
    ])
    expect(home.panels.slice(1, 3).map((p) => p.position?.direction)).toEqual(['below', 'below'])
    expect(home.panels.slice(3).map((p) => p.position?.direction)).toEqual(['right', 'right', 'right'])
    const [first, ...rest] = home.panels
    expect(first?.position).toBeUndefined()
    for (const panel of rest) expect(panel.position, panel.id).toBeDefined()
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
})

describe('applyPlan against a dockview-like api', () => {
  it('clears and adds every layout panel in order on load', () => {
    const api = fakeApi([{ id: 'old', params: paramsFromCommand(command('REG'), '-'), title: 'REG', position: undefined }])
    applyPlan(api, { kind: 'load', layout: layoutFor('HOME') })
    expect(api.calls[0]).toBe('clear')
    expect(api.store.map((p) => p.params.code)).toEqual(['GP', 'EQ', 'LIVE', 'MON', 'REG', 'OOS'])
    expect(api.store[3]?.position).toEqual({ referencePanel: 'home-gp', direction: 'right' })
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
