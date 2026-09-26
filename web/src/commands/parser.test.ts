import { describe, expect, it } from 'vitest'
import { parseCommand, type ParseResult } from './parser'
import type { CommandIndexData } from './types'

// A small index in the shape of GET /api/commands, holding every context the spec examples name.
const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
    { root: 'CL', symbol: 'CL.V.0', sector: 'energy' },
    { root: '6E', symbol: '6E.V.0', sector: 'fx' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0', 'volmanaged_v0', 'rebal_v0'],
  confirmations: ['rebal_v1_confirm'],
  runs: ['nt_dtsmom_v0_ts1', 'nt_volmanaged_v0'],
  registry_error: null,
}

function ok(result: ParseResult) {
  if (!result.ok) throw new Error(`expected a command, got ${result.error.code}`)
  return result.command
}

function err(result: ParseResult) {
  if (result.ok) throw new Error(`expected an error, got ${result.command.canonical}`)
  return result.error
}

describe('UI_SPEC section 5 examples', () => {
  it('NQ GP: instrument context, candles', () => {
    const c = ok(parseCommand('NQ GP', { index: INDEX }))
    expect(c.mnemonic.code).toBe('GP')
    expect(c.context).toEqual({ kind: 'instrument', value: 'NQ' })
    expect(c.contextSource).toBe('typed')
    expect(c.args).toEqual({})
    expect(c.canonical).toBe('NQ GP')
  })

  it('NQ GIP 2019-03-14: one date argument', () => {
    const c = ok(parseCommand('NQ GIP 2019-03-14', { index: INDEX }))
    expect(c.mnemonic.code).toBe('GIP')
    expect(c.context).toEqual({ kind: 'instrument', value: 'NQ' })
    expect(c.args).toEqual({ date: '2019-03-14' })
    expect(c.canonical).toBe('NQ GIP 2019-03-14')
  })

  it('volmanaged_v0 DES: hypothesis context', () => {
    const c = ok(parseCommand('volmanaged_v0 DES', { index: INDEX }))
    expect(c.mnemonic.code).toBe('DES')
    expect(c.context).toEqual({ kind: 'hypothesis', value: 'volmanaged_v0' })
  })

  it('nt_dtsmom_v0_ts1 RUN: run context', () => {
    const c = ok(parseCommand('nt_dtsmom_v0_ts1 RUN', { index: INDEX }))
    expect(c.mnemonic.code).toBe('RUN')
    expect(c.context).toEqual({ kind: 'run', value: 'nt_dtsmom_v0_ts1' })
  })

  it('27F CORR: the universe', () => {
    const c = ok(parseCommand('27F CORR', { index: INDEX }))
    expect(c.mnemonic.code).toBe('CORR')
    expect(c.context).toEqual({ kind: 'universe', value: '27F' })
  })

  it('REG: no context', () => {
    const c = ok(parseCommand('REG', { index: INDEX }))
    expect(c.mnemonic.code).toBe('REG')
    expect(c.context).toBeNull()
    expect(c.contextSource).toBe('none')
    expect(c.canonical).toBe('REG')
  })

  it('rebal_v1_confirm DES: a sealed confirmation resolves as a hypothesis', () => {
    const c = ok(parseCommand('rebal_v1_confirm DES', { index: INDEX }))
    expect(c.context).toEqual({ kind: 'hypothesis', value: 'rebal_v1_confirm' })
  })
})

describe('grammar details', () => {
  it('omitted context: takes the focused panel link-group context', () => {
    const c = ok(parseCommand('GP', { index: INDEX, fallbackContext: 'ZN' }))
    expect(c.context).toEqual({ kind: 'instrument', value: 'ZN' })
    expect(c.contextSource).toBe('link-group')
    expect(c.canonical).toBe('ZN GP')
  })

  it('mnemonics and instruments are case-insensitive and come out canonical', () => {
    const c = ok(parseCommand('  nq   gip   2019-03-14 ', { index: INDEX }))
    expect(c.canonical).toBe('NQ GIP 2019-03-14')
  })

  it('hypothesis and run names match exactly first, then by unique case-insensitive match', () => {
    expect(ok(parseCommand('ZA_V0 DES', { index: INDEX })).context).toEqual({ kind: 'hypothesis', value: 'za_v0' })
    expect(ok(parseCommand('NT_DTSMOM_V0_TS1 RUN', { index: INDEX })).context?.value).toBe('nt_dtsmom_v0_ts1')
  })

  it('an instrument symbol such as NQ.V.0 resolves to its root', () => {
    expect(ok(parseCommand('NQ.V.0 GP', { index: INDEX })).context).toEqual({ kind: 'instrument', value: 'NQ' })
  })

  it('DES takes an instrument as well as a hypothesis', () => {
    expect(ok(parseCommand('CL DES', { index: INDEX })).context).toEqual({ kind: 'instrument', value: 'CL' })
  })

  it('EQ takes a run or a hypothesis', () => {
    expect(ok(parseCommand('nt_volmanaged_v0 EQ', { index: INDEX })).context?.kind).toBe('run')
    expect(ok(parseCommand('volmanaged_v0 EQ', { index: INDEX })).context?.kind).toBe('hypothesis')
  })

  it('GP takes an optional timeframe from 1m, 5m, 1h and 1d', () => {
    expect(ok(parseCommand('NQ GP 1h', { index: INDEX })).args).toEqual({ timeframe: '1h' })
    expect(ok(parseCommand('NQ GP 1D', { index: INDEX })).canonical).toBe('NQ GP 1d')
  })

  it('P1 and P2 mnemonics parse (their screens show a labelled placeholder)', () => {
    expect(ok(parseCommand('JOBS', { index: INDEX })).mnemonic.priority).toBe('P2')
    expect(ok(parseCommand('NQ VCONE', { index: INDEX })).mnemonic.priority).toBe('P1')
  })

  it('a mnemonic-only command works before the index has loaded', () => {
    expect(ok(parseCommand('HELP', { index: null })).mnemonic.code).toBe('HELP')
  })
})

describe('malformed input', () => {
  it('empty and blank lines', () => {
    expect(err(parseCommand('', { index: INDEX })).code).toBe('empty')
    expect(err(parseCommand('   \t ', { index: INDEX })).code).toBe('empty')
  })

  it('an unknown function after a known context', () => {
    expect(err(parseCommand('NQ FOO', { index: INDEX }))).toMatchObject({ code: 'unknown-function', token: 'FOO' })
  })

  it('an unknown context before a known function', () => {
    expect(err(parseCommand('XX GP', { index: INDEX }))).toMatchObject({ code: 'unknown-context', token: 'XX' })
  })

  it('a single token that is neither a function nor a context', () => {
    expect(err(parseCommand('FOO', { index: INDEX }))).toMatchObject({ code: 'unknown-command', token: 'FOO' })
  })

  it('a context with no function', () => {
    expect(err(parseCommand('NQ', { index: INDEX }))).toMatchObject({ code: 'missing-function', token: 'NQ' })
  })

  it('function before context (wrong order) is caught', () => {
    expect(err(parseCommand('GP NQ', { index: INDEX }))).toMatchObject({ code: 'bad-argument', token: 'NQ' })
  })

  it('a function that needs a context, with none typed and no link-group context', () => {
    expect(err(parseCommand('GP', { index: INDEX }))).toMatchObject({ code: 'missing-context', token: 'GP' })
    expect(err(parseCommand('RUN', { index: INDEX, fallbackContext: null })).code).toBe('missing-context')
  })

  it('a context of the wrong kind', () => {
    expect(err(parseCommand('NQ RUN', { index: INDEX }))).toMatchObject({ code: 'context-not-accepted', token: 'NQ' })
    expect(err(parseCommand('za_v0 GP', { index: INDEX })).code).toBe('context-not-accepted')
    expect(err(parseCommand('27F GP', { index: INDEX })).code).toBe('context-not-accepted')
  })

  it('a link-group context of the wrong kind', () => {
    expect(err(parseCommand('RUN', { index: INDEX, fallbackContext: 'NQ' }))).toMatchObject({
      code: 'context-not-accepted',
      token: 'NQ',
    })
  })

  it('a context given to a function that takes none', () => {
    expect(err(parseCommand('NQ REG', { index: INDEX }))).toMatchObject({ code: 'no-context-taken', token: 'NQ' })
  })

  it('GIP without a date, with a bad date and with an impossible date', () => {
    expect(err(parseCommand('NQ GIP', { index: INDEX })).code).toBe('missing-argument')
    expect(err(parseCommand('NQ GIP 14.03.2019', { index: INDEX }))).toMatchObject({ code: 'bad-argument', token: '14.03.2019' })
    expect(err(parseCommand('NQ GIP 14/03/2019', { index: INDEX }))).toMatchObject({ code: 'bad-character', token: '14/03/2019' })
    expect(err(parseCommand('NQ GIP 2019-02-30', { index: INDEX }))).toMatchObject({ code: 'bad-argument', token: '2019-02-30' })
    expect(err(parseCommand('NQ GIP 2019-3-14', { index: INDEX })).code).toBe('bad-argument')
  })

  it('too many arguments', () => {
    expect(err(parseCommand('NQ GIP 2019-03-14 2019-03-15', { index: INDEX }))).toMatchObject({
      code: 'too-many-arguments',
      token: '2019-03-15',
    })
    expect(err(parseCommand('REG extra', { index: INDEX }))).toMatchObject({ code: 'bad-argument', token: 'extra' })
    expect(err(parseCommand('NQ GP 2m', { index: INDEX }))).toMatchObject({ code: 'bad-argument', token: '2m' })
  })

  it('characters outside the command alphabet', () => {
    expect(err(parseCommand('NQ GP <script>', { index: INDEX })).code).toBe('bad-character')
    expect(err(parseCommand('../../etc RUN', { index: INDEX })).code).toBe('bad-character')
    expect(err(parseCommand('NQ; GP', { index: INDEX })).code).toBe('bad-character')
  })

  it('an overlong line', () => {
    expect(err(parseCommand(`NQ GP ${'x'.repeat(300)}`, { index: INDEX })).code).toBe('too-long')
  })

  it('a context that cannot be resolved because the index has not loaded', () => {
    expect(err(parseCommand('NQ GP', { index: null }))).toMatchObject({ code: 'index-unavailable', token: 'NQ' })
  })

  it('an ambiguous case-insensitive name', () => {
    const index = { ...INDEX, runs: ['Run_A', 'run_a'] }
    expect(err(parseCommand('RUN_A RUN', { index }))).toMatchObject({ code: 'unknown-context', token: 'RUN_A' })
    expect(ok(parseCommand('run_a RUN', { index })).context?.value).toBe('run_a')
  })
})
