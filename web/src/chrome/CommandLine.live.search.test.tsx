// @vitest-environment jsdom
// The live command line and the lazy HL search index: it starts the load after mounting, and once the
// index is in, HL finds instruments (and the rest) through the sheet.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './CommandLine.menus.load'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { buildSearchIndex, type SearchIndex } from '../commands/searchIndex'
import { COMMAND_LINE } from '../copy/commands'
import { SEARCH } from '../copy/search'
import { useLinkGroups } from '../state/linkGroups'
import { LiveCommandLine } from './CommandLine.live'
import { resetMessage } from './MessageLine.store'

// The menus and sheets load as chunks of their own; the app has them by its first idle moment, so the tests wait for them.
beforeAll(async () => {
  await loadCommandLineParts()
})

// The loader stands in for the dynamic import: each test chooses whether the index has loaded.
const loader = vi.hoisted(() => ({ index: null as SearchIndex | null, load: vi.fn(async () => null) }))
vi.mock('../commands/searchIndexLoader', () => ({ loadedSearchIndex: () => loader.index, loadSearchIndex: loader.load }))

beforeAll(() => {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoResize)
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  loader.index = null
  loader.load.mockClear()
})
afterEach(() => {
  cleanup()
  useLinkGroups.getState().clearAll()
  resetMessage()
  vi.restoreAllMocks()
})

const COMMANDS = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'CL', symbol: 'CL.V.0', sector: 'energy' }],
  universe: ['27F'],
  hypotheses: ['za_v0'],
  confirmations: [],
  runs: ['nt_fixture_run'],
  registry_error: null,
}

function mount() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(COMMANDS), { status: 200, headers: { 'content-type': 'application/json' } }))
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  render(
    <ApiProvider client={client}>
      <LiveCommandLine focusedGroup={null} onRun={vi.fn()} />
    </ApiProvider>,
  )
  return screen.getByRole('combobox', { name: COMMAND_LINE.label })
}

/** Types `text`, waiting until the command index has loaded (a run name only it can offer is listed). */
async function ready(input: HTMLElement) {
  await waitFor(() => {
    fireEvent.change(input, { target: { value: 'NT_' } })
    expect(within(screen.getByRole('listbox')).getByText('nt_fixture_run')).toBeTruthy()
  })
  fireEvent.change(input, { target: { value: '' } })
}

describe('LiveCommandLine and the HL search index', () => {
  it('starts loading the search index once it has mounted, and only once', async () => {
    const input = mount()
    expect(loader.load).toHaveBeenCalledTimes(1)
    await ready(input)
    fireEvent.change(input, { target: { value: 'NQ' } })
    expect(loader.load).toHaveBeenCalledTimes(1)
  })

  it('lists the crude oil instrument first for HL crude, once the index is in', async () => {
    loader.index = buildSearchIndex()
    const input = mount()
    await ready(input)
    fireEvent.change(input, { target: { value: 'HL crude' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const list = await screen.findByRole('listbox', { name: 'Search: CRUDE' })
    const first = within(list).getAllByRole('option')[0]
    expect(first?.textContent).toContain('CL1 Comdty')
    expect(first?.textContent).toContain('Instrument: Crude Oil')
    expect(screen.queryByText(SEARCH.loading)).toBeNull()
  })

  it('says the index is still loading for HL before it is in, and lists today\'s results', async () => {
    const input = mount()
    await ready(input)
    fireEvent.change(input, { target: { value: 'HL candles' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const list = await screen.findByRole('listbox', { name: 'Search: CANDLES' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('GP')]))
    expect(screen.getByText(SEARCH.loading)).toBeTruthy()
    // The HL asks the loader again, so a failed load is tried once more.
    expect(loader.load.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
