import { describe, expect, it } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { fillCopy } from '../copy/workspace'
import { LAYOUT } from '../copy/layout'
import { layoutFor } from '../screens/layouts'
import type { OpenPlan, PanelParams } from './WorkspaceModel'
import { describePlan, previewText, type PreviewInput, type RunPreview } from './WorkspacePreview'

function mnemonic(code: string) {
  const def = findMnemonic(code)
  if (!def) throw new Error(code)
  return def
}

function cmd(code: string, extra: Partial<ParsedCommand> = {}): ParsedCommand {
  return { mnemonic: mnemonic(code), context: null, contextSource: 'none', args: {}, canonical: code, ...extra }
}

function params(code: string, group: PanelParams['group'] = '-', context: PanelParams['context'] = null): PanelParams {
  return { code: mnemonic(code).code, context, args: {}, group }
}

const HOME_IDS = ['p1', 'p2', 'p3', 'p4']

/** p1 GP (A, instrument), p2 MON (A, universe), p3 EQ (B, hypothesis), p4 REG (unlinked). */
function paramsOfHome(id: string): PanelParams | null {
  const map: Record<string, PanelParams> = {
    p1: params('GP', 'A', { kind: 'instrument', value: 'NQ' }),
    p2: params('MON', 'A', { kind: 'universe', value: '27F' }),
    p3: params('EQ', 'B', { kind: 'hypothesis', value: 'volmanaged_v0' }),
    p4: params('REG'),
  }
  return map[id] ?? null
}

function input(overrides: Partial<PreviewInput> & Pick<PreviewInput, 'plan'>): PreviewInput {
  return {
    command: cmd('GP'),
    order: HOME_IDS,
    paramsOf: paramsOfHome,
    shown: 'HOME',
    hasSaved: () => false,
    ...overrides,
  }
}

describe('describePlan: replace', () => {
  it('names the replaced panel by its current code, and the new code separately', () => {
    const plan: OpenPlan = { kind: 'replace', panelId: 'p1', params: params('GIP', 'A', { kind: 'instrument', value: 'NQ' }) }
    const preview = describePlan(input({ plan, command: cmd('GIP') }))
    expect(preview).toEqual({ kind: 'replace', panel: { number: 1, code: 'GP' }, code: 'GIP', retarget: null })
  })

  it('has no retarget when no other panel of the group accepts the typed kind', () => {
    // Group A here is GP + MON; MON does not accept an instrument, so retargeting it never applies.
    const es = { kind: 'instrument' as const, value: 'ES' }
    const plan: OpenPlan = { kind: 'replace', panelId: 'p1', params: params('GP', 'A', es) }
    const command = cmd('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' })
    expect(describePlan(input({ plan, command }))).toMatchObject({ retarget: null })
  })

  it('retargets other panels of the group whose mnemonic accepts the typed kind', () => {
    const order = ['p1', 'p2', 'p5']
    const paramsOf = (id: string): PanelParams | null => (id === 'p5' ? params('GIP', 'A', { kind: 'instrument', value: 'NQ' }) : paramsOfHome(id))
    const es = { kind: 'instrument' as const, value: 'ES' }
    const plan: OpenPlan = { kind: 'replace', panelId: 'p1', params: params('GP', 'A', es) }
    const command = cmd('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' })
    const preview = describePlan(input({ plan, command, order, paramsOf }))
    expect(preview).toEqual({
      kind: 'replace',
      panel: { number: 1, code: 'GP' },
      code: 'GP',
      retarget: { group: 'A', panels: [{ number: 3, code: 'GIP' }] },
    })
  })

  it('never retargets an unlinked group, or a context that came from the link group rather than typed', () => {
    const es = { kind: 'instrument' as const, value: 'ES' }
    const unlinked: OpenPlan = { kind: 'replace', panelId: 'p4', params: params('DES', '-', es) }
    expect(describePlan(input({ plan: unlinked, command: cmd('DES', { context: es, contextSource: 'typed' }) }))).toMatchObject({ retarget: null })
    const linked: OpenPlan = { kind: 'replace', panelId: 'p1', params: params('GP', 'A', es) }
    expect(describePlan(input({ plan: linked, command: cmd('GP', { context: es, contextSource: 'link-group' }) }))).toMatchObject({ retarget: null })
  })
})

describe('describePlan: add', () => {
  it('names the anchor panel by its current code and number', () => {
    const plan: OpenPlan = { kind: 'add', ref: 'p4', params: params('LEDG') }
    const preview = describePlan(input({ plan, command: cmd('LEDG') }))
    expect(preview).toEqual({ kind: 'add', after: { number: 4, code: 'REG' }, code: 'LEDG', retarget: null })
  })

  it('has no anchor when there is nowhere to add beside', () => {
    const plan: OpenPlan = { kind: 'add', ref: undefined, params: params('LEDG') }
    const preview = describePlan(input({ plan, command: cmd('LEDG'), order: [], paramsOf: () => null }))
    expect(preview).toEqual({ kind: 'add', after: null, code: 'LEDG', retarget: null })
  })

  it('has no anchor when the reference panel no longer exists', () => {
    const plan: OpenPlan = { kind: 'add', ref: 'gone', params: params('LEDG') }
    const preview = describePlan(input({ plan, command: cmd('LEDG') }))
    expect(preview.kind === 'add' && preview.after).toBeNull()
  })

  it('retargets every panel of the group that accepts the typed kind, including the anchor', () => {
    const order = ['p1', 'p2', 'p5']
    const paramsOf = (id: string): PanelParams | null => (id === 'p5' ? params('GIP', 'A', { kind: 'instrument', value: 'NQ' }) : paramsOfHome(id))
    const es = { kind: 'instrument' as const, value: 'ES' }
    const plan: OpenPlan = { kind: 'add', ref: 'p1', params: params('VCONE', 'A', es) }
    const command = cmd('VCONE', { context: es, contextSource: 'typed', canonical: 'ES VCONE' })
    const preview = describePlan(input({ plan, command, order, paramsOf }))
    expect(preview).toEqual({
      kind: 'add',
      after: { number: 1, code: 'GP' },
      code: 'VCONE',
      retarget: { group: 'A', panels: [{ number: 1, code: 'GP' }, { number: 3, code: 'GIP' }] },
    })
  })
})

describe('describePlan: load', () => {
  const regLayout = layoutFor('REG')

  it('source is "context" when the command carries a typed context', () => {
    const plan: OpenPlan = { kind: 'load', layout: regLayout }
    const command = cmd('DES', { context: { kind: 'instrument', value: 'NQ' }, contextSource: 'typed', canonical: 'NQ DES' })
    expect(describePlan(input({ plan, command }))).toEqual({ kind: 'load', screen: 'REG', panels: 2, source: 'context', same: false })
  })

  it('source is "context" when the command carries an argument, even with no context', () => {
    const plan: OpenPlan = { kind: 'load', layout: regLayout }
    const command = cmd('GIP', { args: { date: '2019-03-14' }, canonical: 'GIP 2019-03-14' })
    expect(describePlan(input({ plan, command }))).toMatchObject({ source: 'context' })
  })

  it('source is "saved" for a bare command when a saved layout exists, else "default"', () => {
    const plan: OpenPlan = { kind: 'load', layout: regLayout }
    const saved = describePlan(input({ plan, command: cmd('REG'), hasSaved: (code) => code === 'REG' }))
    expect(saved).toEqual({ kind: 'load', screen: 'REG', panels: 2, source: 'saved', same: false })
    const fresh = describePlan(input({ plan, command: cmd('REG'), hasSaved: () => false }))
    expect(fresh).toEqual({ kind: 'load', screen: 'REG', panels: 2, source: 'default', same: false })
  })

  it('same is true only when the loaded screen equals the shown one', () => {
    const plan: OpenPlan = { kind: 'load', layout: regLayout }
    expect(describePlan(input({ plan, command: cmd('REG'), shown: 'REG' }))).toMatchObject({ same: true })
    expect(describePlan(input({ plan, command: cmd('REG'), shown: 'HOME' }))).toMatchObject({ same: false })
  })
})

describe('previewText', () => {
  it('renders a replace with no retarget', () => {
    const p: RunPreview = { kind: 'replace', panel: { number: 4, code: 'REG' }, code: 'GP', retarget: null }
    expect(previewText(p, 'enter')).toBe(fillCopy(LAYOUT.replace, { panel: '4-REG', code: 'GP' }))
  })

  it('prints panel refs as {number}-{code}, e.g. 4-REG', () => {
    const p: RunPreview = { kind: 'replace', panel: { number: 4, code: 'REG' }, code: 'GP', retarget: null }
    expect(previewText(p, 'enter')).toContain('4-REG')
  })

  it('appends the retarget suffix after the separator', () => {
    const p: RunPreview = {
      kind: 'replace',
      panel: { number: 1, code: 'GP' },
      code: 'GP',
      retarget: { group: 'A', panels: [{ number: 3, code: 'GIP' }] },
    }
    expect(previewText(p, 'enter')).toBe(
      fillCopy(LAYOUT.replace, { panel: '1-GP', code: 'GP' }) + LAYOUT.separator + fillCopy(LAYOUT.retarget, { group: 'A', panels: '3-GIP' }),
    )
  })

  it('joins several retargeted panels with a comma', () => {
    const p: RunPreview = {
      kind: 'add',
      after: null,
      code: 'VCONE',
      retarget: { group: 'A', panels: [{ number: 1, code: 'GP' }, { number: 3, code: 'GIP' }] },
    }
    expect(previewText(p, 'shift')).toBe(
      fillCopy(LAYOUT.addAlone, { code: 'VCONE' }) + LAYOUT.separator + fillCopy(LAYOUT.retarget, { group: 'A', panels: '1-GP, 3-GIP' }),
    )
  })

  it('renders add with an anchor, add alone, and every load source', () => {
    const withAnchor: RunPreview = { kind: 'add', after: { number: 4, code: 'REG' }, code: 'LEDG', retarget: null }
    expect(previewText(withAnchor, 'shift')).toBe(fillCopy(LAYOUT.add, { code: 'LEDG', panel: '4-REG' }))
    const alone: RunPreview = { kind: 'add', after: null, code: 'LEDG', retarget: null }
    expect(previewText(alone, 'shift')).toBe(fillCopy(LAYOUT.addAlone, { code: 'LEDG' }))
    const savedLoad: RunPreview = { kind: 'load', screen: 'HOME', panels: 4, source: 'saved', same: false }
    expect(previewText(savedLoad, 'enter')).toBe(fillCopy(LAYOUT.loadSaved, { screen: 'HOME', n: 4 }))
    const defaultLoad: RunPreview = { kind: 'load', screen: 'HOME', panels: 4, source: 'default', same: true }
    expect(previewText(defaultLoad, 'enter')).toBe(fillCopy(LAYOUT.loadDefault, { screen: 'HOME', n: 4 }))
    const contextLoad: RunPreview = { kind: 'load', screen: 'REG', panels: 2, source: 'context', same: false }
    expect(previewText(contextLoad, 'enter')).toBe(fillCopy(LAYOUT.loadContext, { screen: 'REG', n: 2 }))
  })

  it('is empty for a variant that cannot happen for that kind (a load never follows Shift+Enter)', () => {
    const load: RunPreview = { kind: 'load', screen: 'HOME', panels: 4, source: 'default', same: true }
    expect(previewText(load, 'shift')).toBe('')
    const add: RunPreview = { kind: 'add', after: null, code: 'LEDG', retarget: null }
    expect(previewText(add, 'enter')).toBe('')
    const replace: RunPreview = { kind: 'replace', panel: { number: 1, code: 'GP' }, code: 'GIP', retarget: null }
    expect(previewText(replace, 'shift')).toBe('')
  })

  it('never contains an em or en dash (UK house style, copy/copyRules.ts)', () => {
    const samples: ReadonlyArray<{ p: RunPreview; variant: 'enter' | 'shift' }> = [
      {
        p: { kind: 'replace', panel: { number: 1, code: 'GP' }, code: 'GIP', retarget: { group: 'A', panels: [{ number: 3, code: 'GIP' }] } },
        variant: 'enter',
      },
      { p: { kind: 'add', after: { number: 4, code: 'REG' }, code: 'LEDG', retarget: null }, variant: 'shift' },
      { p: { kind: 'load', screen: 'HOME', panels: 4, source: 'default', same: true }, variant: 'enter' },
    ]
    for (const { p, variant } of samples) expect(previewText(p, variant)).not.toMatch(/[–—]/)
  })
})
