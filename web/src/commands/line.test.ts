import { describe, expect, it } from 'vitest'
import { describeError } from './messages'
import { displayLine, parseLine, type LineResult } from './line'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: '6E', symbol: '6E.V.0', sector: 'fx' },
    { root: 'ZC', symbol: 'ZC.V.0', sector: 'grains' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0', 'rebal_v0'],
  confirmations: [],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

function action(result: LineResult) {
  if (!result.ok) throw new Error(`expected an action, got ${result.error.code}`)
  return result.action
}

function failure(result: LineResult) {
  if (result.ok) throw new Error(`expected an error, got ${result.action.kind}`)
  return result.error
}

const parse = (line: string, fallback: string | null = null) => parseLine(line, { index: INDEX, fallbackContext: fallback })

describe('spec 8.4 parser cases', () => {
  it('NQ1 INDEX GP 1d: generic ticker, sector key, function and timeframe', () => {
    const a = action(parse('NQ1 INDEX GP 1d'))
    expect(a.kind).toBe('run')
    if (a.kind !== 'run') return
    expect(a.command.context).toEqual({ kind: 'instrument', value: 'NQ' })
    expect(a.command.args).toEqual({ timeframe: '1d' })
    expect(a.command.canonical).toBe('NQ GP 1d')
    expect(a.newPanel).toBe(false)
  })

  it('NQ INDEX GP and NQ GP: the sector key is optional', () => {
    const withSector = action(parse('NQ INDEX GP'))
    const without = action(parse('NQ GP'))
    expect(withSector).toEqual(without)
  })

  it('TY1 COMDTY DES resolves to ZN', () => {
    const a = action(parse('TY1 COMDTY DES'))
    expect(a.kind === 'run' && a.command.context).toEqual({ kind: 'instrument', value: 'ZN' })
  })

  it('C 1 COMDTY GP: the spaced grain ticker', () => {
    const a = action(parse('C 1 COMDTY GP'))
    expect(a.kind === 'run' && a.command.canonical).toBe('ZC GP')
  })

  it('INDEX on its own opens the sector menu', () => {
    expect(action(parse('INDEX'))).toEqual({ kind: 'sector', sector: 'INDEX' })
    expect(action(parse('cmdty'))).toEqual({ kind: 'sector', sector: 'COMDTY' })
  })

  it('NQ1 INDEX loads the context and opens its function menu', () => {
    expect(action(parse('NQ1 INDEX'))).toEqual({ kind: 'context', context: { kind: 'instrument', value: 'NQ' }, newPanel: false })
    expect(action(parse('rebal_v0'))).toEqual({ kind: 'context', context: { kind: 'hypothesis', value: 'rebal_v0' }, newPanel: false })
  })

  it('3 selects numbered item 3 (Number <GO>)', () => {
    expect(action(parse('3'))).toEqual({ kind: 'number', n: 3 })
    expect(action(parse(' 42 '))).toEqual({ kind: 'number', n: 42 })
  })

  it('GP HELP opens the help for GP', () => {
    expect(action(parse('GP HELP'))).toEqual({ kind: 'help', code: 'GP' })
    expect(action(parse('NQ GP HELP'))).toEqual({ kind: 'help', code: 'GP' })
    expect(action(parse('gip help'))).toEqual({ kind: 'help', code: 'GIP' })
  })

  it('NXTW NQ GP opens in a new panel', () => {
    const a = action(parse('NXTW NQ GP'))
    expect(a.kind === 'run' && a.newPanel).toBe(true)
    expect(a.kind === 'run' && a.command.canonical).toBe('NQ GP')
  })

  it('LAST, NO, MENU and HL are chrome words', () => {
    expect(action(parse('LAST'))).toEqual({ kind: 'last' })
    expect(action(parse('no'))).toEqual({ kind: 'tape' })
    expect(action(parse('MENU'))).toEqual({ kind: 'menu' })
    expect(action(parse('HL rebal'))).toEqual({ kind: 'search', query: 'rebal' })
    expect(action(parse('HL'))).toEqual({ kind: 'search', query: '' })
  })

  it('born failing (D14): HL takes a query with punctuation, including the screen titles themselves', () => {
    expect(action(parse('HL Analytics: equity'))).toEqual({ kind: 'search', query: 'Analytics: equity' })
    expect(action(parse('hl P&L'))).toEqual({ kind: 'search', query: 'P&L' })
    expect(action(parse('HL [POST HOC]'))).toEqual({ kind: 'search', query: '[POST HOC]' })
    // A plain over-length line is still refused, HL query included.
    expect(failure(parse(`HL ${'x'.repeat(250)}`)).code).toBe('too-long')
  })

  it('MAIN is HOME', () => {
    const a = action(parse('MAIN'))
    expect(a.kind === 'run' && a.command.mnemonic.code).toBe('HOME')
  })

  it('HELP on its own opens the HELP index screen', () => {
    const a = action(parse('HELP'))
    expect(a.kind === 'run' && a.command.mnemonic.code).toBe('HELP')
  })

  it('rejects NQ COMDTY with a message that names F10', () => {
    const error = failure(parse('NQ COMDTY'))
    expect(error.code).toBe('sector-mismatch')
    expect(describeError(error)).toBe('NQ is an Index future: use INDEX (F10).')
    expect(describeError(failure(parse('ZN INDEX GP')))).toBe('ZN is a Comdty future: use COMDTY (F9).')
  })

  it('rejects 27F INDEX CORR: the universe, hypotheses and runs take no sector', () => {
    expect(failure(parse('27F INDEX CORR')).code).toBe('sector-not-taken')
    expect(failure(parse('za_v0 COMDTY DES')).code).toBe('sector-not-taken')
    expect(failure(parse('nt_dtsmom_v0_ts1 INDEX RUN')).code).toBe('sector-not-taken')
  })

  it('rejects chrome words with trailing text and a bare NXTW', () => {
    expect(failure(parse('LAST 3')).code).toBe('extra-after-word')
    expect(failure(parse('NXTW')).code).toBe('missing-command')
  })

  it('keeps the plain grammar and its errors', () => {
    expect(failure(parse('NQ FOO')).code).toBe('unknown-function')
    expect(failure(parse('')).code).toBe('empty')
    const a = action(parse('GP', 'ES'))
    expect(a.kind === 'run' && a.command.canonical).toBe('ES GP')
  })
})

describe('command-line display (spec 3.3)', () => {
  it('shows typed letters in upper case and a sector key in title case', () => {
    expect(displayLine('nq1 index gp 1d')).toBe('NQ1 Index GP 1D')
    expect(displayLine('ty1 cmdty des')).toBe('TY1 Cmdty DES')
    expect(displayLine('za_v0 des')).toBe('ZA_V0 DES')
  })

  it('keeps the length, so the caret does not move', () => {
    for (const line of ['nq1 index gp', '  rebal_v0  des ', 'x']) expect(displayLine(line)).toHaveLength(line.length)
  })
})
