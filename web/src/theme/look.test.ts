// The theme preference (standard or amber-classic): kept per viewer through safeStorage, validated when
// read back, applied as data-theme on the root element. Blocked storage leaves the standard theme.
import { describe, expect, it } from 'vitest'
import { createSafeStorage, memoryStorage } from '../state/safeStorage'
import { LOOKS, LOOK_KEY, THEME_ATTRIBUTE, applyLook, applyStoredLook, isLook, loadLook, saveLook } from './look'

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    root: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    },
  }
}

const throwing = createSafeStorage(() => {
  throw new Error('blocked')
})

describe('theme preference', () => {
  it('offers the standard theme first, then amber-classic', () => {
    expect(LOOKS).toEqual(['standard', 'amber-classic'])
    expect(LOOK_KEY).toBe('nqt.theme')
    expect(THEME_ATTRIBUTE).toBe('data-theme')
  })

  it('reads back what it stored', () => {
    const storage = createSafeStorage(() => memoryStorage())
    const shared = memoryStorage()
    const s = createSafeStorage(() => shared)
    expect(loadLook(storage)).toBe('standard')
    expect(saveLook('amber-classic', s)).toBe(true)
    expect(loadLook(s)).toBe('amber-classic')
    expect(shared.getItem(LOOK_KEY)).toBe('amber-classic')
  })

  it('treats a stored value it does not know as the standard theme', () => {
    const shared = memoryStorage()
    const s = createSafeStorage(() => shared)
    for (const junk of ['dark', 'AMBER-CLASSIC', '', '{"x":1}', 'deut']) {
      shared.setItem(LOOK_KEY, junk)
      expect(loadLook(s), junk).toBe('standard')
    }
    expect(isLook('amber-classic')).toBe(true)
    expect(isLook(42)).toBe(false)
  })

  it('never throws when storage is blocked, and still reports the failed write', () => {
    expect(loadLook(throwing)).toBe('standard')
    expect(saveLook('amber-classic', throwing)).toBe(false)
  })

  it('sets data-theme for amber-classic and removes it for the standard theme', () => {
    const { attrs, root } = fakeRoot()
    applyLook('amber-classic', root)
    expect(attrs.get('data-theme')).toBe('amber-classic')
    applyLook('standard', root)
    expect(attrs.has('data-theme')).toBe(false)
  })
})

describe('theme preference and the other things the viewer keeps', () => {
  it('stores under its own key and never touches the colour scheme, layouts or workspaces', () => {
    const shared = memoryStorage()
    for (const key of ['nqt.cvd', 'nqt.layouts', 'nqt.workspaces', 'nqt.watch']) shared.setItem(key, `kept:${key}`)
    const s = createSafeStorage(() => shared)
    expect(saveLook('amber-classic', s)).toBe(true)
    expect(saveLook('standard', s)).toBe(true)
    for (const key of ['nqt.cvd', 'nqt.layouts', 'nqt.workspaces', 'nqt.watch']) expect(shared.getItem(key)).toBe(`kept:${key}`)
    expect(shared.length).toBe(5)
    expect(LOOK_KEY).not.toBe('nqt.cvd')
  })

  it('leaves the colour scheme attribute alone when the theme is set or cleared', () => {
    const { attrs, root } = fakeRoot()
    attrs.set('data-cvd', 'deut')
    applyLook('amber-classic', root)
    expect(attrs.get('data-cvd')).toBe('deut')
    applyLook('standard', root)
    expect(attrs.get('data-cvd')).toBe('deut')
  })

  it('applyStoredLook sets the stored theme before anything paints, and the standard theme when nothing is stored', () => {
    const shared = memoryStorage()
    const s = createSafeStorage(() => shared)
    const first = fakeRoot()
    expect(applyStoredLook(s, first.root)).toBe('standard')
    expect(first.attrs.has('data-theme')).toBe(false)
    shared.setItem(LOOK_KEY, 'amber-classic')
    const second = fakeRoot()
    expect(applyStoredLook(s, second.root)).toBe('amber-classic')
    expect(second.attrs.get('data-theme')).toBe('amber-classic')
  })

  it('applyStoredLook is quiet when storage is blocked and ignores a tampered value', () => {
    const { attrs, root } = fakeRoot()
    expect(applyStoredLook(throwing, root)).toBe('standard')
    const shared = memoryStorage()
    shared.setItem(LOOK_KEY, '"><script>')
    expect(applyStoredLook(createSafeStorage(() => shared), root)).toBe('standard')
    expect(attrs.has('data-theme')).toBe(false)
  })
})
