import { describe, expect, it } from 'vitest'
import { BUILT_CODES } from '../commands/built'
import { MNEMONICS } from '../commands/registry'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import { COMMAND_LINE, MNEMONIC_SCREENS } from '../copy/commands'
import { functionMenu, relatedMenu } from './CommandLine.menus'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }
const HYP: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }
const RUN: ResolvedContext = { kind: 'run', value: 'nt_dtsmom_v0_ts1' }

const labels = (context: ResolvedContext | null) => relatedMenu(context, INDEX).items.map((i) => i.label)

describe('relatedMenu: the MENU word on the command line (spec 4.7)', () => {
  it('with no context, lists the built screens that take none, in registry order, and never JOBS', () => {
    const menu = relatedMenu(null, INDEX)
    expect(menu.title).toBe(COMMAND_LINE.menuTitle)
    expect(menu.items.map((i) => i.label)).toEqual(['HOME', 'REG', 'MT', 'RUNS', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP'])
    expect(menu.items.every((i) => BUILT_CODES.has(i.label as never))).toBe(true)
    expect(menu.items.map((i) => i.n)).toEqual(menu.items.map((_, i) => i + 1))
    expect(menu.items[0]?.act).toEqual({ kind: 'run', line: 'HOME' })
  })

  it('for an instrument, lists VCONE, SEAS, EVT, ROLL and DQ with their titles, each run for that instrument', () => {
    const menu = relatedMenu(NQ, INDEX)
    expect(menu.breadcrumb).toEqual([COMMAND_LINE.menuTitle, 'NQ1 Index'])
    for (const code of ['VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ'] as const) {
      const item = menu.items.find((i) => i.label === code)
      expect(item, code).toMatchObject({ detail: MNEMONIC_SCREENS[code], act: { kind: 'run', line: `NQ ${code}` } })
    }
    expect(labels(NQ)).toEqual(['GP', 'GIP', 'DES', 'VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ'])
    // GIP needs a date, so it fills the line instead of running it.
    expect(menu.items.find((i) => i.label === 'GIP')?.act).toEqual({ kind: 'fill', line: 'NQ GIP ' })
  })

  it('for a hypothesis, lists COST, BLK, SEAL and SEAS; for a run, COST and EXPO', () => {
    expect(labels(HYP)).toEqual(expect.arrayContaining(['DES', 'EQ', 'COST', 'BLK', 'SEAL', 'SEAS']))
    expect(labels(HYP)).not.toContain('EXPO')
    expect(labels(RUN)).toEqual(expect.arrayContaining(['RUN', 'EQ', 'COST', 'EXPO']))
    expect(labels(RUN)).not.toContain('BLK')
  })

  it('offers only built screens, for every context kind and for none', () => {
    for (const context of [null, NQ, HYP, RUN, { kind: 'universe', value: '27F' } as const]) {
      const offered = labels(context)
      expect(offered.length, context?.kind ?? 'none').toBeGreaterThan(0)
      expect(offered.filter((code) => !BUILT_CODES.has(code as never)), context?.kind ?? 'none').toEqual([])
    }
  })
})

describe('functionMenu: a context line with no function (spec 5.1 item 3)', () => {
  it('numbers every function the context kind takes, in registry order', () => {
    const menu = functionMenu(NQ, INDEX)
    const expected = MNEMONICS.filter((m) => m.accepts.includes('instrument')).map((m) => m.code)
    expect(menu.items.map((i) => i.label)).toEqual(expected)
    expect(menu.items.map((i) => i.n)).toEqual(expected.map((_, i) => i + 1))
  })
})
