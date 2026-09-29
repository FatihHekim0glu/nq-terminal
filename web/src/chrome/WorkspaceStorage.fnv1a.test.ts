import { describe, expect, it } from 'vitest'
import { fnv1a as shared } from '../state/fnv1a'
import { layoutFor } from './WorkspaceLayouts'
import { fnv1a, layoutSignature } from './WorkspaceStorage'
import storageSource from './WorkspaceStorage.ts?raw'

describe('WorkspaceStorage uses the one shared FNV-1a hash (state/fnv1a.ts)', () => {
  it('re-exports the shared function itself, not a copy of it', () => {
    expect(fnv1a).toBe(shared)
  })

  it('holds no hash constants of its own any more', () => {
    expect(storageSource).not.toMatch(/0x811c9dc5/i)
    expect(storageSource).not.toMatch(/0x01000193/i)
    expect(storageSource).not.toContain('Math.imul')
  })

  it('signs a default layout exactly as before: the hash of its JSON text', () => {
    expect(layoutSignature('HOME')).toBe(shared(JSON.stringify(layoutFor('HOME'))))
    expect(layoutSignature('HOME')).toMatch(/^[0-9a-f]{8}$/)
  })

  // Digests worked out apart from this code (a 32 bit FNV-1a over UTF-16 code units in Python).
  it('keeps the known digests, so a layout saved under the old copy still matches', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('HOME')).toBe('10b8c84e')
    expect(fnv1a('volmanaged_v0')).toBe('9d3beeee')
  })
})
