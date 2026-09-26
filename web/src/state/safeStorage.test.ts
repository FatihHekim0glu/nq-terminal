import { describe, expect, it, vi } from 'vitest'
import { createSafeStorage, memoryStorage, readJson, writeJson } from './safeStorage'

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  return {
    length: 0,
    clear: fail,
    key: fail,
    getItem: fail,
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError')
    },
    removeItem: fail,
  }
}

describe('safe storage (UI_SPEC section 2: localStorage wrapped in try/catch)', () => {
  it('reads, writes and removes through a working storage', () => {
    const backing = memoryStorage()
    const storage = createSafeStorage(() => backing)
    expect(storage.write('k', 'v')).toBe(true)
    expect(storage.read('k')).toBe('v')
    expect(storage.remove('k')).toBe(true)
    expect(storage.read('k')).toBeNull()
  })

  it('never throws when every storage call throws (blocked site data, quota)', () => {
    const storage = createSafeStorage(() => throwingStorage())
    expect(storage.read('k')).toBeNull()
    expect(storage.write('k', 'v')).toBe(false)
    expect(storage.remove('k')).toBe(false)
  })

  it('never throws when the localStorage accessor itself throws (private window, sandboxed frame)', () => {
    const storage = createSafeStorage(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(storage.read('k')).toBeNull()
    expect(storage.write('k', 'v')).toBe(false)
  })

  it('works with no storage at all (node, thumbnail capture)', () => {
    const storage = createSafeStorage(() => undefined)
    expect(storage.read('k')).toBeNull()
    expect(storage.write('k', 'v')).toBe(false)
  })

  it('born failing: the unwrapped storage does throw, so the wrapper is doing the work', () => {
    expect(() => throwingStorage().getItem('k')).toThrow()
    expect(() => throwingStorage().setItem('k', 'v')).toThrow()
  })
})

describe('JSON helpers', () => {
  const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number')

  it('round-trips a validated value', () => {
    const backing = memoryStorage()
    const storage = createSafeStorage(() => backing)
    expect(writeJson(storage, 'k', [1, 2])).toBe(true)
    expect(readJson(storage, 'k', isNumberList)).toEqual([1, 2])
  })

  it('returns null for corrupt JSON or a value that fails validation (stored data is untrusted)', () => {
    const backing = memoryStorage()
    const storage = createSafeStorage(() => backing)
    backing.setItem('corrupt', '{"half": ')
    backing.setItem('wrong', '{"a": 1}')
    expect(readJson(storage, 'corrupt', isNumberList)).toBeNull()
    expect(readJson(storage, 'wrong', isNumberList)).toBeNull()
  })

  it('refuses a value JSON cannot encode instead of throwing', () => {
    const backing = memoryStorage()
    const setItem = vi.spyOn(backing, 'setItem')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(writeJson(createSafeStorage(() => backing), 'k', cyclic)).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })
})
