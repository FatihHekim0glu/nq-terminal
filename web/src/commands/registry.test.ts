import { describe, expect, it } from 'vitest'
import constantsPy from '../../../backend/nq_terminal/constants.py?raw'
import { findMnemonic, MNEMONICS, screenNumber } from './registry'

// The backend serves the same table from constants.MNEMONICS (pinned to UI_SPEC section 5 by
// tests/test_mnemonics.py). Read it straight from the source file so the two lists cannot drift.
function backendMnemonics(source: string): Array<[string, string, string, string]> {
  const block = /MNEMONICS[^=]*=\s*\(([\s\S]*?)\n\)/.exec(source)?.[1] ?? ''
  const row = /\(\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"\s*\)/g
  return [...block.matchAll(row)].map((m) => [m[1]!, m[2]!, m[3]!, m[4]!])
}

describe('mnemonic registry (UI_SPEC section 5)', () => {
  it('lists every mnemonic of the spec table, P0 to P2, once each', () => {
    const codes = MNEMONICS.map((m) => m.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toEqual([
      'HOME', 'GP', 'GIP', 'DES', 'REG', 'MT', 'RUNS', 'RUN', 'EQ', 'DD', 'RET', 'RR', 'MRET', 'MON', 'CORR',
      'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP', 'COST', 'BLK', 'EXPO', 'SEAL', 'VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ',
      'JOBS',
    ])
  })

  it('matches the backend table code by code: screen, priority and context', () => {
    const backend = backendMnemonics(constantsPy)
    expect(backend.length).toBe(30)
    expect(MNEMONICS.map((m) => [m.code, m.screen, m.priority, m.context])).toEqual(backend)
  })

  it('gives no name that looks like an order path', () => {
    for (const m of MNEMONICS) expect(`${m.code} ${m.screen}`).not.toMatch(/order|submit|cancel|modify/i)
  })

  it('derives the accepted context kinds from the context text', () => {
    expect(findMnemonic('REG')?.accepts).toEqual([])
    expect(findMnemonic('GP')?.accepts).toEqual(['instrument'])
    expect(findMnemonic('DES')?.accepts).toEqual(['hypothesis', 'instrument'])
    expect(findMnemonic('EQ')?.accepts).toEqual(['run', 'hypothesis'])
    expect(findMnemonic('CORR')?.accepts).toEqual(['universe'])
  })

  it('finds a mnemonic whatever the case, and nothing for an unknown code', () => {
    expect(findMnemonic('gip')?.code).toBe('GIP')
    expect(findMnemonic('ORDER')).toBeUndefined()
    expect(findMnemonic('')).toBeUndefined()
  })

  it('numbers screens by registry order for the status bar (HOME is 00)', () => {
    expect(screenNumber('HOME')).toBe('00')
    expect(screenNumber('REG')).toBe('04')
    expect(screenNumber('JOBS')).toBe('29')
  })
})

describe('born-failing case (rule 5): the drift check sees a changed backend table', () => {
  it('reports a mismatch when one priority differs', () => {
    const source = constantsPy.replace('("GP", "Candles with volume and an indicator pane", "P0"', '("GP", "Candles with volume and an indicator pane", "P1"')
    const backend = backendMnemonics(source)
    expect(MNEMONICS.map((m) => [m.code, m.screen, m.priority, m.context])).not.toEqual(backend)
  })
})
