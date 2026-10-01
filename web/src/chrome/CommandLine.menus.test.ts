import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_CODES } from '../commands/built'
import { withValue } from '../commands/messages'
import { MNEMONICS } from '../commands/registry'
import { buildSearchIndex, type SearchIndex } from '../commands/searchIndex'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import { CHROME_WORDS, COMMAND_LINE, MNEMONIC_SCREENS } from '../copy/commands'
import { SEARCH } from '../copy/search'
import { functionMenu, relatedMenu, searchMenu } from './CommandLine.menus'

// searchMenu asks the loader for the lazy search index; the stand-in lets each test choose whether it
// has loaded (the loader itself is tested in commands/searchIndexLoader.test.ts).
const loader = vi.hoisted(() => ({ index: null as SearchIndex | null, load: vi.fn() }))
vi.mock('../commands/searchIndexLoader', () => ({ loadedSearchIndex: () => loader.index, loadSearchIndex: loader.load }))

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: ['volmanaged_v0_confirm'],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }
const HYP: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }
const RUN: ResolvedContext = { kind: 'run', value: 'nt_dtsmom_v0_ts1' }

const labels = (context: ResolvedContext | null) => relatedMenu(context, INDEX).items.map((i) => i.label)

describe('relatedMenu: the MENU word on the command line (spec 4.7)', () => {
  it('with no context, lists the built screens that take none, in registry order, JOBS (the P2 queue) included', () => {
    const menu = relatedMenu(null, INDEX)
    expect(menu.title).toBe(COMMAND_LINE.menuTitle)
    expect(menu.items.map((i) => i.label)).toEqual(['HOME', 'REG', 'MT', 'RUNS', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP', 'JOBS'])
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

describe('searchMenu before the search index has loaded (today\'s results, a loading intro)', () => {
  beforeEach(() => {
    loader.index = null
    loader.load.mockReset()
  })

  it('shows today\'s functions, words, hypotheses and runs, with the loading intro', () => {
    const gp = searchMenu('candles', INDEX)
    expect(gp.title).toBe('Search: candles')
    expect(gp.intro).toEqual([SEARCH.loading])
    expect(gp.items.map((i) => i.label)).toEqual(['GP', 'GIP'])
    expect(gp.items[0]).toMatchObject({ n: 1, detail: MNEMONIC_SCREENS.GP, act: { kind: 'fill', line: 'GP ' } })
    expect(searchMenu('volmanaged', INDEX).items.map((i) => i.label)).toEqual(['volmanaged_v0', 'volmanaged_v0_confirm'])
  })

  it('asks the loader to load, so the next HL can use the index', () => {
    searchMenu('crude', INDEX)
    expect(loader.load).toHaveBeenCalledTimes(1)
  })

  it('does not find a metric or an instrument yet', () => {
    expect(searchMenu('calmar', INDEX).items).toEqual([])
    expect(searchMenu('crude', INDEX).items).toEqual([])
  })

  it('says nothing matched and that the index is loading, when both are true', () => {
    expect(searchMenu('calmar', INDEX).intro).toEqual([withValue(COMMAND_LINE.searchNone, 'calmar'), SEARCH.loading])
  })
})

describe('searchMenu with the search index loaded (functions, metrics, instruments, help, hypotheses, runs)', () => {
  beforeEach(() => {
    loader.index = buildSearchIndex()
    loader.load.mockReset()
  })

  it('lists a crude oil query\'s instrument first, as its generic ticker, choosing it loads the context', () => {
    const menu = searchMenu('crude', INDEX)
    expect(menu.intro).toEqual([])
    expect(menu.items[0]).toMatchObject({
      n: 1,
      label: 'CL1 Comdty',
      detail: 'Instrument: Crude Oil',
      category: false,
      act: { kind: 'context', context: { kind: 'instrument', value: 'CL' } },
    })
  })

  it('shows an instrument by the index\'s sector key', () => {
    expect(searchMenu('nasdaq', INDEX).items[0]).toMatchObject({ label: 'NQ1 Index', act: { kind: 'context', context: { kind: 'instrument', value: 'NQ' } } })
    expect(searchMenu('yen', INDEX).items[0]).toMatchObject({ label: 'JY1 Curncy' })
  })

  it('finds a metric on the screen that shows it, run as that function', () => {
    const menu = searchMenu('calmar', INDEX)
    expect(menu.items[0]).toMatchObject({ label: 'EQ', detail: 'Metric: Calmar ratio (PF6), Analytics: equity', act: { kind: 'run', line: 'EQ' } })
    expect(searchMenu('RK3', INDEX).items[0]).toMatchObject({ label: 'RET', act: { kind: 'run', line: 'RET' } })
  })

  it('finds help text with the phrase in quotes and opens the help page', () => {
    const help = searchMenu('deflated', INDEX).items.find((i) => i.act.kind === 'run' && i.act.line === 'DES HELP')
    expect(help?.label).toBe('DES HELP')
    expect(help?.detail).toMatch(/^Help: DES, ".*Deflated Sharpe.*"$/)
  })

  it('keeps today\'s function and word results, as fills or runs, with their own details', () => {
    const analytics = searchMenu('analytics', INDEX).items
    expect(analytics.filter((i) => i.detail.startsWith('Analytics')).map((i) => i.label)).toEqual(['DD', 'EQ', 'MRET', 'RET', 'RR'])
    expect(analytics.find((i) => i.label === 'EQ')?.act).toEqual({ kind: 'fill', line: 'EQ ' })
    expect(searchMenu('reg', INDEX).items[0]).toMatchObject({ label: 'REG', act: { kind: 'run', line: 'REG' } })
    expect(searchMenu('undo', INDEX).items[0]).toMatchObject({ label: 'UNDO', detail: expect.stringMatching(/^Command word: Undo the last layout change/), act: { kind: 'fill', line: 'UNDO ' } })
  })

  it('keeps the hypothesis and run drafts, after the index hits', () => {
    const hypothesis = searchMenu('volmanaged', INDEX).items
    expect(hypothesis.slice(-2)).toEqual([
      expect.objectContaining({ label: 'volmanaged_v0', act: { kind: 'run', line: 'volmanaged_v0 DES' } }),
      expect.objectContaining({ label: 'volmanaged_v0_confirm', act: { kind: 'run', line: 'volmanaged_v0_confirm DES' } }),
    ])
    const run = searchMenu('dtsmom', INDEX).items
    expect(run.at(-1)).toMatchObject({ label: 'nt_dtsmom_v0_ts1', act: { kind: 'run', line: 'nt_dtsmom_v0_ts1 RUN' } })
  })

  it('says Nothing matches for a query nothing matches, and asks for no load', () => {
    const menu = searchMenu('flurble', INDEX)
    expect(menu.items).toEqual([])
    expect(menu.intro).toEqual(['Nothing matches flurble.'])
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('falls back to the entry\'s own detail for a help hit that carries no phrase', () => {
    const help = loader.index?.entries.find((e) => e.group === 'help' && e.code === 'GP')
    expect(help).toBeDefined()
    if (!help) return
    loader.index = { entries: [help], search: () => [{ entry: help, rank: 4, phrase: null }] }
    expect(searchMenu('gp', INDEX).items[0]).toMatchObject({ label: 'GP HELP', detail: help.detail, act: { kind: 'run', line: 'GP HELP' } })
  })

  it('numbers the items from 1 and stops at 30', () => {
    for (const query of ['a', 'e', 'ratio', 'return']) {
      const menu = searchMenu(query, INDEX)
      expect(menu.items.length, query).toBeLessThanOrEqual(30)
      expect(menu.items.map((i) => i.n), query).toEqual(menu.items.map((_, i) => i + 1))
    }
    expect(searchMenu('a', INDEX).items).toHaveLength(30)
  })

  it('titles the menu with the query and keys it by the lower-case query', () => {
    const menu = searchMenu('Calmar', INDEX)
    expect(menu.title).toBe('Search: Calmar')
    expect(menu.key).toBe('search:calmar')
  })

  it('offers no item that says a screen is not built yet', () => {
    for (const query of ['jobs', 'queue', 'vcone', 'seas', 'a']) {
      for (const item of searchMenu(query, INDEX).items) expect(item.detail, `${query} ${item.label}`).not.toMatch(/not built yet/i)
    }
  })
})

describe('searchMenu without the command index (HELP\'s own search field passes null)', () => {
  beforeEach(() => {
    loader.index = buildSearchIndex()
    loader.load.mockReset()
  })

  it('keeps to today\'s functions and words, even with the search index loaded, and does not load it', () => {
    expect(searchMenu('calmar', null).items).toEqual([])
    expect(searchMenu('crude', null).items).toEqual([])
    expect(searchMenu('candles', null).items.map((i) => i.label)).toEqual(['GP', 'GIP'])
    expect(searchMenu('undo', null).items.map((i) => i.label)).toEqual(['RESET', 'UNDO'])
    expect(searchMenu('undo', null).items[1]).toMatchObject({ detail: CHROME_WORDS.UNDO, act: { kind: 'fill', line: 'UNDO ' } })
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('has no loading intro either, and says Nothing matches as before', () => {
    loader.index = null
    expect(searchMenu('candles', null).intro).toEqual([])
    expect(searchMenu('flurble', null).intro).toEqual(['Nothing matches flurble.'])
    expect(loader.load).not.toHaveBeenCalled()
  })
})
