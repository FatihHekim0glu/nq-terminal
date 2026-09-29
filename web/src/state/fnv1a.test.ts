import { describe, expect, it } from 'vitest'
import { fnv1a as workspaceFnv1a } from '../chrome/WorkspaceStorage'
import { canonicalJson, fnv1a } from './fnv1a'

describe('fnv1a: the same 32 bit hash as the workspace layout signature', () => {
  const samples = ['', 'HOME', 'volmanaged_v0', 'Unicode éü ✓ 🎯', 'x'.repeat(5000)]

  it.each(samples.map((s) => [s.length, s] as const))('equals WorkspaceStorage.fnv1a on a string of length %i', (_length, text) => {
    expect(fnv1a(text)).toBe(workspaceFnv1a(text))
  })

  it('is 8 lower case hex digits, padded', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    for (const s of samples) expect(fnv1a(s)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('tells near strings apart', () => {
    expect(fnv1a('run_1')).not.toBe(fnv1a('run_2'))
  })
})

describe('canonicalJson: JSON with the keys sorted at every depth', () => {
  it('sorts object keys recursively, whatever the insertion sequence', () => {
    const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }
    const b = { a: { c: null, d: [3, { y: 2, z: 1 }] }, b: 1 }
    expect(canonicalJson(a)).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}')
    expect(canonicalJson(b)).toBe(canonicalJson(a))
  })

  it('keeps arrays in their sequence', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalJson({ k: ['b', 'a'] })).toBe('{"k":["b","a"]}')
  })

  it('sorts numeric looking keys as text, so the result never depends on the engine key order', () => {
    expect(canonicalJson({ 2: 'b', 10: 'a', 1: 'c' })).toBe('{"1":"c","10":"a","2":"b"}')
  })

  it('drops undefined properties, keeps null, and writes an undefined array slot as null like JSON', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
    expect(canonicalJson([undefined, 1])).toBe('[null,1]')
  })

  it('writes primitives and escapes strings exactly as JSON does', () => {
    expect(canonicalJson('a"b\n')).toBe(JSON.stringify('a"b\n'))
    expect(canonicalJson(1.5)).toBe('1.5')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson({ 'k"ey': 1 })).toBe('{"k\\"ey":1}')
  })

  it('gives one digest for one entry however its keys were ordered', () => {
    expect(fnv1a(canonicalJson({ opened: '2026-09-26', by: 'user' }))).toBe(fnv1a(canonicalJson({ by: 'user', opened: '2026-09-26' })))
  })
})
