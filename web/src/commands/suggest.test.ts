import { describe, expect, it } from 'vitest'
import { fuzzy, suggest } from './suggest'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: 'RTY', symbol: 'RTY.V.0', sector: 'equity' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0', 'volmanaged_v0', 'rebal_v0'],
  confirmations: ['rebal_v1_confirm'],
  runs: ['nt_dtsmom_v0_ts1', 'nt_volmanaged_v0'],
  registry_error: null,
}

const values = (line: string, index: CommandIndexData | null = INDEX) => suggest(line, index).map((s) => s.value)

describe('fuzzy (ported from the SIGNAL command palette)', () => {
  it('matches characters in order, with gaps', () => {
    expect(fuzzy('volmanaged_v0', 'vmv')).toBe(true)
    expect(fuzzy('volmanaged_v0', 'vmx')).toBe(false)
    expect(fuzzy('abc', '')).toBe(true)
  })
})

describe('suggestions', () => {
  it('shows nothing for an empty line (Up and Down walk the history there)', () => {
    expect(suggest('', INDEX)).toEqual([])
    expect(suggest('   ', INDEX)).toEqual([])
  })

  it('first token: functions and contexts whose name starts with the prefix come first', () => {
    const first = suggest('r', INDEX)
    expect(first.slice(0, 5).map((s) => s.value)).toEqual(['REG ', 'RUNS ', 'RUN ', 'RET ', 'RR '])
    expect(first.map((s) => s.value)).toContain('rebal_v0 ')
    expect(first.map((s) => s.value)).toContain('RTY ')
  })

  it('groups each suggestion by kind and labels it', () => {
    const [reg] = suggest('RE', INDEX)
    expect(reg).toMatchObject({ value: 'REG ', label: 'REG', group: 'function', detail: 'Registry board' })
    const nq = suggest('nq', INDEX).find((s) => s.label === 'NQ')
    expect(nq).toMatchObject({ group: 'instrument', value: 'NQ ', detail: 'NQ.V.0 equity' })
  })

  it('second token after a context: only functions that accept that context kind', () => {
    const afterNq = values('NQ ')
    expect(afterNq).toContain('NQ GP ')
    expect(afterNq).toContain('NQ GIP ')
    expect(afterNq).toContain('NQ DES ')
    expect(afterNq).not.toContain('NQ RUN ')
    expect(afterNq).not.toContain('NQ REG ')
    expect(values('nt_dtsmom_v0_ts1 R')).toEqual(['nt_dtsmom_v0_ts1 RUN ', 'nt_dtsmom_v0_ts1 RET ', 'nt_dtsmom_v0_ts1 RR '])
    expect(values('27F ')).toEqual(['27F MON ', '27F CORR '])
  })

  it('argument position: timeframes for GP, none for GIP (it takes a typed date)', () => {
    expect(values('NQ GP ')).toEqual(['NQ GP 1m', 'NQ GP 5m', 'NQ GP 1h', 'NQ GP 1d'])
    expect(values('NQ GP 1')).toEqual(['NQ GP 1m', 'NQ GP 1h', 'NQ GP 1d'])
    expect(values('NQ GIP ')).toEqual([])
    expect(values('REG ')).toEqual([])
  })

  it('fuzzy matches follow prefix matches, for prefixes of two or more characters', () => {
    const vm = values('vmv')
    expect(vm).toContain('volmanaged_v0 ')
    expect(vm).toContain('nt_volmanaged_v0 ')
    expect(values('v')).not.toContain('nt_volmanaged_v0 ')
  })

  it('caps the list', () => {
    const many = { ...INDEX, runs: Array.from({ length: 80 }, (_, i) => `run_${i}`) }
    expect(suggest('run_', many).length).toBeLessThanOrEqual(12)
  })

  it('offers only functions while the index has not loaded', () => {
    const groups = new Set(suggest('r', null).map((s) => s.group))
    expect([...groups]).toEqual(['function'])
  })

  it('offers nothing past the argument slot', () => {
    expect(values('NQ GP 1h ')).toEqual([])
  })
})
