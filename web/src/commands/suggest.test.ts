import { describe, expect, it } from 'vitest'
import { MNEMONIC_SCREENS } from '../copy/commands'
import { BUILT_CODES } from './built'
import { MNEMONICS } from './registry'
import { fuzzy, sheetGroups, suggest } from './suggest'
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
    // Instruments show as their generic ticker and sector (spec 5.1 item 2).
    expect(first.map((s) => s.value)).toContain('RTY1 Index ')
  })

  it('groups each suggestion by kind and labels it', () => {
    const [reg] = suggest('RE', INDEX)
    expect(reg).toMatchObject({ value: 'REG ', label: 'REG', group: 'function', detail: 'Registry board' })
    const nq = suggest('nq', INDEX).find((s) => s.label === 'NQ1 Index')
    expect(nq).toMatchObject({ group: 'instrument', value: 'NQ1 Index ', detail: 'NQ.V.0 back-adj' })
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

  it('finds an instrument by its root or its generic ticker', () => {
    expect(values('zn')).toContain('TY1 Comdty ')
    expect(values('ty')).toContain('TY1 Comdty ')
  })

  it('after a generic ticker and its sector key, offers the functions for it', () => {
    expect(values('NQ1 Index ')).toContain('NQ1 Index GP ')
    expect(values('TY1 Comdty G')).toEqual(['TY1 Comdty GP ', 'TY1 Comdty GIP '])
  })

  it('offers the chrome words with the functions', () => {
    expect(values('LA')).toContain('LAST ')
    expect(values('ME')).toContain('MENU ')
  })

  it('labels a built P1 function with its screen title: VC suggests VCONE, not "not built yet"', () => {
    const [vcone] = suggest('VC', INDEX)
    expect(vcone).toMatchObject({ value: 'VCONE ', label: 'VCONE', group: 'function', detail: MNEMONIC_SCREENS.VCONE })
    expect(vcone?.detail).not.toContain('not built yet')
    expect(suggest('NQ ', INDEX).find((s) => s.label === 'DQ')?.detail).toBe(MNEMONIC_SCREENS.DQ)
  })

  it('titles JOBS, the P2 backtest queue, with its screen name now that it is built', () => {
    const [jobs] = suggest('JOBS', INDEX)
    expect(jobs).toMatchObject({ value: 'JOBS ', group: 'function', detail: MNEMONIC_SCREENS.JOBS })
    expect(jobs?.detail).not.toContain('not built yet')
  })

  it('titles every built function and flags only the others, the index loaded or not', () => {
    for (const index of [INDEX, null]) {
      for (const m of MNEMONICS) {
        const detail = suggest(m.code, index).find((s) => s.label === m.code)?.detail
        if (BUILT_CODES.has(m.code)) expect(detail, m.code).toBe(m.screen)
        else expect(detail, m.code).toMatch(/, not built yet$/)
      }
    }
  })

  it('ends a first-token list of two or more letters with a SEARCH row that runs HL', () => {
    const list = suggest('reb', INDEX)
    expect(list.at(-1)).toMatchObject({ group: 'search', value: 'HL reb', label: 'HL reb' })
    expect(suggest('r', INDEX).some((s) => s.group === 'search')).toBe(false)
  })
})

describe('sheet groups (spec 4.2 autocomplete)', () => {
  const many = { ...INDEX, runs: Array.from({ length: 80 }, (_, i) => `run_${i}`) }

  it('shows at most 6 rows per group when several groups match, with the rest behind More', () => {
    const groups = sheetGroups(suggest('r', many), null)
    for (const g of groups) expect(g.items.length).toBeLessThanOrEqual(6)
    const runs = groups.find((g) => g.group === 'run')
    expect(runs?.more).toBe(80 - 6)
  })

  it('shows 9 rows when only one group matches', () => {
    const groups = sheetGroups(suggest('run_', many).filter((s) => s.group === 'run'), null)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items).toHaveLength(9)
    expect(groups[0]?.more).toBe(71)
  })

  it('shows every row of an expanded group', () => {
    const groups = sheetGroups(suggest('r', many), 'run')
    expect(groups.find((g) => g.group === 'run')?.items).toHaveLength(80)
    expect(groups.find((g) => g.group === 'run')?.more).toBe(0)
  })

  it('offers only functions while the index has not loaded', () => {
    const groups = new Set(suggest('r', null).map((s) => s.group))
    expect([...groups]).toEqual(['function'])
  })

  it('offers nothing past the argument slot', () => {
    expect(values('NQ GP 1h ')).toEqual([])
  })
})
