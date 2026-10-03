// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { LAYOUTS_KEY, MAX_LAYOUT_CHARS, createLayoutsStore, layoutFor } from './layouts'
import { createSafeStorage, memoryStorage } from './safeStorage'

const dock = { grid: { root: { type: 'branch', data: [] }, width: 1920, height: 1030 }, panels: {} }

function setup(initial?: string) {
  const backing = memoryStorage()
  if (initial !== undefined) backing.setItem(LAYOUTS_KEY, initial)
  const store = createLayoutsStore(createSafeStorage(() => backing))
  return { backing, store }
}

describe('user layouts (UI_SPEC section 2: localStorage, default layout when storage fails)', () => {
  it('has no saved layout at first, so the screen renders its default', () => {
    const { store } = setup()
    expect(layoutFor(store.getState(), 'HOME')).toBeNull()
  })

  it('saves a layout per screen and restores it in a new store', () => {
    const { store, backing } = setup()
    expect(store.getState().saveLayout('HOME', dock)).toBe(true)
    expect(layoutFor(store.getState(), 'HOME')).toEqual(dock)
    const restored = createLayoutsStore(createSafeStorage(() => backing))
    expect(layoutFor(restored.getState(), 'HOME')).toEqual(dock)
    expect(layoutFor(restored.getState(), 'REG')).toBeNull()
  })

  it('stores a copy, so later changes to the caller object do not leak in', () => {
    const { store } = setup()
    const mine = { panels: { a: 1 } }
    store.getState().saveLayout('REG', mine)
    mine.panels.a = 2
    expect(layoutFor(store.getState(), 'REG')).toEqual({ panels: { a: 1 } })
  })

  it('resets one screen or all screens', () => {
    const { store, backing } = setup()
    store.getState().saveLayout('HOME', dock)
    store.getState().saveLayout('REG', dock)
    store.getState().resetLayout('HOME')
    expect(layoutFor(store.getState(), 'HOME')).toBeNull()
    expect(layoutFor(store.getState(), 'REG')).toEqual(dock)
    store.getState().resetAll()
    expect(store.getState().layouts).toEqual({})
    expect(backing.getItem(LAYOUTS_KEY)).toBeNull()
  })

  it('refuses a bad screen code, a non-object layout, an oversized layout or one JSON cannot encode', () => {
    const { store } = setup()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(store.getState().saveLayout('home', dock)).toBe(false)
    expect(store.getState().saveLayout('__proto__', dock)).toBe(false)
    expect(store.getState().saveLayout('HOME', [] as never)).toBe(false)
    expect(store.getState().saveLayout('HOME', { blob: 'x'.repeat(MAX_LAYOUT_CHARS) })).toBe(false)
    expect(store.getState().saveLayout('HOME', cyclic)).toBe(false)
    expect(store.getState().layouts).toEqual({})
  })

  it('drops tampered entries on load and keeps the valid ones', () => {
    const stored = JSON.stringify({ version: 1, layouts: { HOME: dock, bad: dock, REG: 'x', DES: [1] } })
    const { store } = setup(stored)
    expect(Object.keys(store.getState().layouts)).toEqual(['HOME'])
  })

  it('starts with defaults on corrupt storage and keeps working in memory when storage throws', () => {
    expect(setup('not json').store.getState().layouts).toEqual({})
    const store = createLayoutsStore(
      createSafeStorage(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
    )
    expect(store.getState().saveLayout('HOME', dock)).toBe(true)
    expect(layoutFor(store.getState(), 'HOME')).toEqual(dock)
  })

  it('born failing (D05): two windows saving different screens do not lose each other\'s layout (lost update)', () => {
    const backing = memoryStorage()
    const a = createLayoutsStore(createSafeStorage(() => backing))
    // B "loaded earlier" than A's save, so its in-memory map is still empty when it saves REG.
    const b = createLayoutsStore(createSafeStorage(() => backing))
    expect(a.getState().saveLayout('HOME', dock)).toBe(true)
    expect(b.getState().saveLayout('REG', dock)).toBe(true)
    const fresh = createLayoutsStore(createSafeStorage(() => backing))
    expect(Object.keys(fresh.getState().layouts).sort()).toEqual(['HOME', 'REG'])
  })

  it('born failing (D05): a window still open refreshes from a storage event fired by another window', () => {
    const backing = memoryStorage()
    const a = createLayoutsStore(createSafeStorage(() => backing))
    const b = createLayoutsStore(createSafeStorage(() => backing))
    a.getState().saveLayout('HOME', dock)
    const raw = backing.getItem(LAYOUTS_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: LAYOUTS_KEY, newValue: raw, storageArea: window.localStorage }))
    expect(Object.keys(b.getState().layouts)).toEqual(['HOME'])
  })

  it('D05: a save does not drop another screen already held in memory when storage is blocked', () => {
    const store = createLayoutsStore(
      createSafeStorage(() => {
        throw new Error('blocked')
      }),
    )
    store.getState().saveLayout('HOME', dock)
    store.getState().saveLayout('REG', dock)
    expect(Object.keys(store.getState().layouts).sort()).toEqual(['HOME', 'REG'])
  })

  it('D05: a reset is not a no-op when storage is blocked (it must not just read back what it wrote)', () => {
    const store = createLayoutsStore(
      createSafeStorage(() => {
        throw new Error('blocked')
      }),
    )
    store.getState().saveLayout('REG', dock)
    store.getState().resetLayout('REG')
    expect(layoutFor(store.getState(), 'REG')).toBeNull()
  })
})

describe('copies the workspace store keeps beside a screen (03 section 10.2)', () => {
  it('loads "<code> (imported)" next to its screen, keeps it when another screen is saved, and refuses any other suffix', () => {
    const raw = JSON.stringify({ version: 1, layouts: { HOME: dock, 'HOME (imported)': dock, 'HOME (other)': dock, 'bad (imported)': dock } })
    const { store } = setup(raw)
    expect(Object.keys(store.getState().layouts)).toEqual(['HOME', 'HOME (imported)'])
    expect(layoutFor(store.getState(), 'HOME (imported)')).toEqual(dock)
    expect(store.getState().saveLayout('REG', dock)).toBe(true)
    expect(Object.keys(store.getState().layouts)).toContain('HOME (imported)')
    expect(store.getState().saveLayout('HOME (imported)', dock)).toBe(false)
  })
})
