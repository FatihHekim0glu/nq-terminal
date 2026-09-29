// @vitest-environment jsdom
// HL on the command line while GET /api/commands has failed: the command index is null, yet the lazy
// search index (already preloaded) still supplies metrics, instruments and help text.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { buildSearchIndex, type SearchIndex } from '../commands/searchIndex'
import { COMMAND_LINE } from '../copy/commands'
import { SEARCH } from '../copy/search'
import { useLinkGroups } from '../state/linkGroups'
import { LiveCommandLine } from './CommandLine.live'
import { resetMessage } from './MessageLine.store'

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

/** Mounts the live command line with GET /api/commands answering 503; the command index stays null. */
function mountWithoutCommands() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }))
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  render(
    <ApiProvider client={client}>
      <LiveCommandLine focusedGroup={null} onRun={vi.fn()} />
    </ApiProvider>,
  )
  return { input: screen.getByRole('combobox', { name: COMMAND_LINE.label }), fetchSpy }
}

describe('HL on the command line with no command index (GET /api/commands answered 503)', () => {
  it('lists the metric and the instrument from the preloaded search index, with no loading intro', async () => {
    loader.index = buildSearchIndex()
    const { input, fetchSpy } = mountWithoutCommands()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: 'HL calmar' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const list = await screen.findByRole('listbox', { name: 'Search: CALMAR' })
    const options = within(list).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options.some((t) => t.includes('EQ') && t.includes('Calmar ratio (PF6)'))).toBe(true)
    expect(screen.queryByText(SEARCH.loading)).toBeNull()
  })

  it('says the index is loading, and asks the loader again, when the search index is not in yet', async () => {
    const { input, fetchSpy } = mountWithoutCommands()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: 'HL candles' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('listbox', { name: 'Search: CANDLES' })
    expect(screen.getByText(SEARCH.loading)).toBeTruthy()
    expect(loader.load.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
