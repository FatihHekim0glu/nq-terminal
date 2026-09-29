import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSearchIndex, type SearchIndex } from '../commands/searchIndex'
import { SEARCH } from '../copy/search'
import { searchMenu } from './CommandLine.menus'

// searchMenu asks the loader for the lazy search index; the stand-in lets each test choose whether it
// has loaded (the loader itself is tested in commands/searchIndexLoader.test.ts).
const loader = vi.hoisted(() => ({ index: null as SearchIndex | null, load: vi.fn() }))
vi.mock('../commands/searchIndexLoader', () => ({ loadedSearchIndex: () => loader.index, loadSearchIndex: loader.load }))

// The command line always asks for the lazy index, even while GET /api/commands is pending or has
// failed (the command index is null then). HELP's own field passes no option and keeps today's rows.
describe('searchMenu with { lazy: true } and no command index', () => {
  beforeEach(() => {
    loader.index = null
    loader.load.mockReset()
  })

  it('uses the search index once it has loaded: a metric runs its screen, help text quotes its phrase', () => {
    loader.index = buildSearchIndex()
    const metric = searchMenu('calmar', null, { lazy: true }).items.find((i) => i.label === 'EQ')
    expect(metric).toBeDefined()
    expect(metric?.detail).toContain('Calmar ratio (PF6)')
    expect(metric?.act).toEqual({ kind: 'run', line: 'EQ' })
    const help = searchMenu('deflated', null, { lazy: true }).items.find((i) => i.detail.startsWith('Help: ') && i.detail.includes('"'))
    expect(help).toBeDefined()
    expect(help?.detail).toMatch(/^Help: [A-Z0-9]+, ".*[Dd]eflated.*"$/)
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('shows an instrument by its generic ticker when there is no command index to name its sector', () => {
    loader.index = buildSearchIndex()
    expect(searchMenu('crude', null, { lazy: true }).items[0]).toMatchObject({
      label: 'CL1 Comdty',
      act: { kind: 'context', context: { kind: 'instrument', value: 'CL' } },
    })
  })

  it('says the index is loading, lists today\'s results and asks the loader to start, before it has loaded', () => {
    const menu = searchMenu('candles', null, { lazy: true })
    expect(menu.intro).toContain(SEARCH.loading)
    expect(menu.items.map((i) => i.label)).toEqual(['GP', 'GIP'])
    expect(loader.load).toHaveBeenCalledTimes(1)
    expect(searchMenu('calmar', null, { lazy: true }).intro).toContain(SEARCH.loading)
    expect(loader.load).toHaveBeenCalledTimes(2)
  })
})

describe('searchMenu with no option and no command index (HELP\'s field): unchanged', () => {
  beforeEach(() => {
    loader.index = buildSearchIndex()
    loader.load.mockReset()
  })

  it('finds no metric and does not touch the loader, even with the search index loaded', () => {
    const menu = searchMenu('calmar', null)
    expect(menu.items).toEqual([])
    expect(menu.intro).not.toContain(SEARCH.loading)
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('has no loading intro before the index has loaded either', () => {
    loader.index = null
    const menu = searchMenu('calmar', null)
    expect(menu.items).toEqual([])
    expect(menu.intro).not.toContain(SEARCH.loading)
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('still lists today\'s functions and words', () => {
    expect(searchMenu('candles', null).items.map((i) => i.label)).toEqual(['GP', 'GIP'])
  })
})

describe('searchMenu with a command index and no option: the default stays lazy', () => {
  it('keeps using the search index, as callers did before the option existed', () => {
    loader.index = buildSearchIndex()
    loader.load.mockReset()
    const index = { grammar: '', mnemonics: [], instruments: [], universe: [], hypotheses: [], confirmations: [], runs: [], registry_error: null }
    expect(searchMenu('calmar', index).items.some((i) => i.label === 'EQ' && i.act.kind === 'run')).toBe(true)
    loader.index = null
    expect(searchMenu('calmar', index).intro).toContain(SEARCH.loading)
    expect(loader.load).toHaveBeenCalledTimes(1)
  })
})
