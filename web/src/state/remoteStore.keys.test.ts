import { describe, expect, it } from 'vitest'
import {
  KEY_NAMES, KEY_SPECS, baseName, cleanData, dataFromText, defaultData, hasCopySuffix, keysOf, overlayKeys, specFor, textFromData, textsFromDoc,
} from './remoteStore.keys'

const spec = (key: string) => specFor(key)!
const recipe = { version: 1, panels: [{ line: 'NQ GP 1d', group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }

describe('the ten keys and their documents (03 section 10.2)', () => {
  it('lists the ten keys, five of them in prefs', () => {
    expect(KEY_NAMES).toHaveLength(10)
    expect(keysOf('prefs').map((s) => s.field)).toEqual(['tape', 'cvd', 'theme', 'orientation', 'mon'])
    expect(KEY_SPECS.filter((s) => s.doc !== 'prefs')).toHaveLength(5)
  })

  it('turns a key\'s text into the document\'s piece and back, for every key', () => {
    const samples: Array<[string, string]> = [
      ['nqt.workspaces', JSON.stringify({ version: 1, list: { MINE: recipe }, last: 'MINE' })],
      ['nqt.layouts', JSON.stringify({ version: 1, layouts: { HOME: { grid: 1 } } })],
      ['nqt.linkGroups', JSON.stringify({ version: 1, contexts: { A: null, B: null, C: null } })],
      ['nqt.cmd.history', JSON.stringify(['REG'])],
      ['nqt.tape', 'true'],
      ['nqt.cvd', 'prot'],
      ['nqt.theme', 'amber-classic'],
      ['nqt.orientation', '1'],
      ['nqt.mon.defaults', JSON.stringify({ view: 'returns', heat: false, window: 20 })],
    ]
    for (const [key, text] of samples) {
      const piece = dataFromText(spec(key), text)
      expect(piece, key).not.toBeUndefined()
      expect(textFromData(spec(key), piece), key).toBe(text)
    }
  })

  it('refuses text the page would not accept: another version, a wrong type, an unknown value', () => {
    expect(dataFromText(spec('nqt.workspaces'), '{"version":2,"list":{}}')).toBeUndefined()
    expect(dataFromText(spec('nqt.layouts'), '[]')).toBeUndefined()
    expect(dataFromText(spec('nqt.cmd.history'), '{}')).toBeUndefined()
    expect(dataFromText(spec('nqt.tape'), 'yes')).toBeUndefined()
    expect(dataFromText(spec('nqt.theme'), 'neon')).toBeUndefined()
    expect(dataFromText(spec('nqt.cvd'), 'standardish')).toBeUndefined()
    expect(dataFromText(spec('nqt.mon.defaults'), '{"view":"x"}')).toBeUndefined()
    expect(dataFromText(spec('nqt.watch'), 'not json')).toBeUndefined()
  })

  it('empty documents remove their key; a prefs field that is absent removes its key', () => {
    expect(textFromData(spec('nqt.workspaces'), { list: {}, last: null })).toBeNull()
    expect(textFromData(spec('nqt.layouts'), {})).toBeNull()
    expect(textFromData(spec('nqt.cmd.history'), [])).toBeNull()
    expect(textFromData(spec('nqt.theme'), undefined)).toBeNull()
    const texts = textsFromDoc('prefs', { theme: 'amber-classic' })
    expect(texts.get('nqt.theme')).toBe('amber-classic')
    expect(texts.get('nqt.tape')).toBeNull()
  })

  it('lays a key\'s new value over a document and keeps the rest', () => {
    const base = { theme: 'standard', cvd: 'deut' }
    expect(overlayKeys('prefs', base, new Map([['nqt.theme', 'amber-classic']]))).toEqual({ theme: 'amber-classic', cvd: 'deut' })
    expect(overlayKeys('prefs', base, new Map([['nqt.cvd', null]]))).toEqual({ theme: 'standard' })
    expect(overlayKeys('prefs', base, new Map([['nqt.theme', 'neon']]))).toEqual(base)
    expect(overlayKeys('history', ['a'], new Map([['nqt.cmd.history', JSON.stringify(['a', 'b'])]]))).toEqual(['a', 'b'])
    expect(overlayKeys('history', ['a'], new Map([['nqt.cmd.history', null]]))).toEqual([])
    expect(overlayKeys('history', ['a'], new Map([['nqt.cmd.history', '{}']]))).toEqual(['a'])
  })

  it('cleans a document the way the page loads it, dropping what it would refuse', () => {
    const list = { MINE: recipe, 'MINE (imported)': recipe, 'bad name': recipe, OTHER: { version: 9 } }
    expect(cleanData('workspaces', { list, last: 'MINE' })).toEqual({ list: { MINE: recipe, 'MINE (imported)': recipe }, last: 'MINE' })
    expect(cleanData('layouts', { HOME: { a: 1 }, 'REG (imported)': { a: 2 }, nope: { a: 3 }, GP: 'x' })).toEqual({ HOME: { a: 1 }, 'REG (imported)': { a: 2 } })
    expect(cleanData('linkGroups', { contexts: { A: { kind: 'run', value: 'r 1' }, B: { kind: 'run', value: 'r1' } } })).toEqual({ contexts: { A: null, B: { kind: 'run', value: 'r1' }, C: null } })
    expect(cleanData('history', ['a', '', 7, 'x'.repeat(300)])).toEqual(['a'])
    expect(cleanData('prefs', { theme: 'neon', tape: true, other: 1 })).toEqual({ tape: true })
    expect(cleanData('watch', {})).toEqual({})
    expect(cleanData('watch', { nope: 1 })).toBeNull()
    expect(cleanData('workspaces', 5)).toBeNull()
  })

  it('knows a copy suffix when it sees one, and the defaults match the backend\'s', () => {
    expect(baseName('ONE (conflict)')).toBe('ONE')
    expect(hasCopySuffix('ONE (imported)')).toBe(true)
    expect(hasCopySuffix('ONE')).toBe(false)
    expect(defaultData('linkGroups')).toEqual({ contexts: { A: null, B: null, C: null } })
  })
})
