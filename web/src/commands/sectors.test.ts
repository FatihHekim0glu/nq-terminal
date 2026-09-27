import { describe, expect, it } from 'vitest'
import {
  SECTOR_KEYS,
  displayContext,
  displayInstrument,
  insertSectorWord,
  genericFor,
  mergeGenericTokens,
  rootForGeneric,
  sectorForRoot,
  sectorWord,
} from './sectors'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: '6E', symbol: '6E.V.0', sector: 'fx' },
    { root: 'CL', symbol: 'CL.V.0', sector: 'energy' },
    { root: 'ZC', symbol: 'ZC.V.0', sector: 'grains' },
    { root: 'GC', symbol: 'GC.V.0', sector: 'metals' },
  ],
  universe: ['27F'],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

describe('sector words (spec 5.1)', () => {
  it('accepts each sector key in any case, with the short aliases', () => {
    expect(sectorWord('index')).toBe('INDEX')
    expect(sectorWord('Comdty')).toBe('COMDTY')
    expect(sectorWord('CMDTY')).toBe('COMDTY')
    expect(sectorWord('crncy')).toBe('CURNCY')
    expect(sectorWord('Equity')).toBe('EQUITY')
    expect(sectorWord('GOVT')).toBe('GOVT')
    expect(sectorWord('CORP')).toBe('CORP')
    expect(sectorWord('GP')).toBeNull()
  })

  it('maps F8 to F11 onto Equity, Comdty, Index and Curncy', () => {
    expect(SECTOR_KEYS).toEqual({ EQUITY: 'F8', COMDTY: 'F9', INDEX: 'F10', CURNCY: 'F11' })
  })

  it('gives equity futures INDEX, FX futures CURNCY and every other future COMDTY', () => {
    expect(sectorForRoot('NQ', INDEX)).toBe('INDEX')
    expect(sectorForRoot('ZN', INDEX)).toBe('COMDTY')
    expect(sectorForRoot('6E', INDEX)).toBe('CURNCY')
    expect(sectorForRoot('CL', INDEX)).toBe('COMDTY')
    // Without the index, the known equity roots and the 6x FX roots still resolve.
    expect(sectorForRoot('YM', null)).toBe('INDEX')
    expect(sectorForRoot('6J', null)).toBe('CURNCY')
    expect(sectorForRoot('HE', null)).toBe('COMDTY')
  })
})

describe('generic tickers (spec 5.1, item 2)', () => {
  it('names each root by its generic ticker', () => {
    expect(genericFor('NQ')).toBe('NQ1')
    expect(genericFor('YM')).toBe('DM1')
    expect(genericFor('ZN')).toBe('TY1')
    expect(genericFor('ZC')).toBe('C 1')
    expect(genericFor('6E')).toBe('EC1')
    expect(genericFor('LE')).toBe('LC1')
    // A root with no listed alias falls back to root plus 1 (CL1 is the documented one).
    expect(genericFor('CL')).toBe('CL1')
  })

  it('resolves a generic ticker back to its root, in any case', () => {
    expect(rootForGeneric('nq1', INDEX)).toBe('NQ')
    expect(rootForGeneric('TY1', INDEX)).toBe('ZN')
    expect(rootForGeneric('C 1', INDEX)).toBe('ZC')
    expect(rootForGeneric('ec1', INDEX)).toBe('6E')
    expect(rootForGeneric('CL1', INDEX)).toBe('CL')
    expect(rootForGeneric('GC1', INDEX)).toBe('GC')
    expect(rootForGeneric('XX1', INDEX)).toBeUndefined()
    expect(rootForGeneric('NQ', INDEX)).toBeUndefined()
  })

  it('joins the spaced grain tickers into one token', () => {
    expect(mergeGenericTokens(['C', '1', 'COMDTY', 'GP'])).toEqual(['C 1', 'COMDTY', 'GP'])
    expect(mergeGenericTokens(['s', '1', 'DES'])).toEqual(['s 1', 'DES'])
    expect(mergeGenericTokens(['NQ', '1'])).toEqual(['NQ', '1'])
  })

  it('shows an instrument as its generic ticker and a title-case sector', () => {
    expect(displayInstrument('NQ', INDEX)).toBe('NQ1 Index')
    expect(displayInstrument('ZN', INDEX)).toBe('TY1 Comdty')
    expect(displayInstrument('6E', INDEX)).toBe('EC1 Curncy')
    expect(displayContext({ kind: 'instrument', value: 'NQ' }, null)).toBe('NQ1 Index')
    expect(displayContext({ kind: 'hypothesis', value: 'rebal_v0' }, null)).toBe('rebal_v0')
    expect(displayContext(null, null)).toBe('-')
  })
})

describe('insertSectorWord (F8 to F11 at the caret)', () => {
  it('separates the word from the text before the caret by one space, and adds none at the start', () => {
    expect(insertSectorWord('', 0, 'Comdty')).toEqual({ line: 'Comdty', caret: 6 })
    expect(insertSectorWord('NQ1', 3, 'Index')).toEqual({ line: 'NQ1 Index', caret: 9 })
    expect(insertSectorWord('NQ1 ', 4, 'Index')).toEqual({ line: 'NQ1 Index', caret: 9 })
  })

  it('keeps the text after the caret one space away', () => {
    expect(insertSectorWord('NQ1GP', 3, 'Index')).toEqual({ line: 'NQ1 Index GP', caret: 9 })
    expect(insertSectorWord('NQ1 GP', 3, 'Index')).toEqual({ line: 'NQ1 Index GP', caret: 9 })
  })

  it('trims the word and clamps a caret outside the line', () => {
    expect(insertSectorWord('NQ1', 99, ' Curncy ')).toEqual({ line: 'NQ1 Curncy', caret: 10 })
    expect(insertSectorWord('NQ1', -4, 'Index')).toEqual({ line: 'Index NQ1', caret: 5 })
  })
})
