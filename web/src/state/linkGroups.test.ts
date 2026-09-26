import { describe, expect, it } from 'vitest'
import { LINK_GROUPS, LINK_GROUPS_KEY, createLinkGroupsStore, isLinkContext } from './linkGroups'
import { createSafeStorage, memoryStorage } from './safeStorage'

function setup(initial?: string) {
  const backing = memoryStorage()
  if (initial !== undefined) backing.setItem(LINK_GROUPS_KEY, initial)
  const store = createLinkGroupsStore(createSafeStorage(() => backing))
  return { backing, store }
}

describe('link groups (UI_SPEC section 2)', () => {
  it('has groups A, B and C, all empty at first', () => {
    const { store } = setup()
    expect(LINK_GROUPS).toEqual(['A', 'B', 'C'])
    expect(store.getState().contexts).toEqual({ A: null, B: null, C: null })
  })

  it('setting a context retargets that group only, with a new state object (no mutation)', () => {
    const { store } = setup()
    const before = store.getState().contexts
    expect(store.getState().setContext('A', { kind: 'instrument', value: 'NQ' })).toBe(true)
    const after = store.getState().contexts
    expect(after).toEqual({ A: { kind: 'instrument', value: 'NQ' }, B: null, C: null })
    expect(after).not.toBe(before)
    expect(before.A).toBeNull()
  })

  it('refuses a malformed context and leaves the group as it was', () => {
    const { store } = setup()
    store.getState().setContext('B', { kind: 'run', value: 'nt_dtsmom_v0_ts1' })
    const bad = [
      { kind: 'ticket', value: 'x' },
      { kind: 'run', value: '' },
      { kind: 'run', value: '../results' },
      { kind: 'run', value: 'x'.repeat(200) },
    ]
    for (const context of bad) expect(store.getState().setContext('B', context as never)).toBe(false)
    expect(store.getState().contexts.B).toEqual({ kind: 'run', value: 'nt_dtsmom_v0_ts1' })
  })

  it('clears one group or all of them', () => {
    const { store } = setup()
    store.getState().setContext('A', { kind: 'instrument', value: 'NQ' })
    store.getState().setContext('C', { kind: 'universe', value: '27F' })
    store.getState().setContext('A', null)
    expect(store.getState().contexts.A).toBeNull()
    store.getState().clearAll()
    expect(store.getState().contexts).toEqual({ A: null, B: null, C: null })
  })

  it('syncs a crosshair time per group, never persisted', () => {
    const { store, backing } = setup()
    store.getState().setCrosshair('A', 1_600_000_000)
    expect(store.getState().crosshair).toEqual({ A: 1_600_000_000, B: null, C: null })
    expect(backing.getItem(LINK_GROUPS_KEY) ?? '').not.toContain('1600000000')
  })

  it('persists contexts and restores them in a new store (a per-viewer convenience)', () => {
    const { store, backing } = setup()
    store.getState().setContext('B', { kind: 'hypothesis', value: 'volmanaged_v0' })
    const restored = createLinkGroupsStore(createSafeStorage(() => backing))
    expect(restored.getState().contexts.B).toEqual({ kind: 'hypothesis', value: 'volmanaged_v0' })
  })

  it('starts empty when the stored value is corrupt or tampered with', () => {
    expect(setup('{"half": ').store.getState().contexts).toEqual({ A: null, B: null, C: null })
    const tampered = JSON.stringify({ version: 1, contexts: { A: { kind: 'ticket', value: 'x' }, B: 5 } })
    expect(setup(tampered).store.getState().contexts).toEqual({ A: null, B: null, C: null })
  })

  it('keeps working in memory when storage throws', () => {
    const store = createLinkGroupsStore(
      createSafeStorage(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
    )
    expect(store.getState().setContext('A', { kind: 'instrument', value: 'ZN' })).toBe(true)
    expect(store.getState().contexts.A).toEqual({ kind: 'instrument', value: 'ZN' })
  })

  it('isLinkContext accepts the command parser shape {kind, value}', () => {
    expect(isLinkContext({ kind: 'hypothesis', value: 'za_v0_C3_gao_momentum' })).toBe(true)
    expect(isLinkContext({ kind: 'hypothesis' })).toBe(false)
  })
})
