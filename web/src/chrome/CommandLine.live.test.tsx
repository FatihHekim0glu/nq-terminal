// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { useLinkGroups } from '../state/linkGroups'
import { COMMAND_LINE } from '../copy/commands'
import { LiveCommandLine } from './CommandLine.live'
import { resetMessage } from './MessageLine.store'

beforeAll(() => {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoResize)
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  cleanup()
  useLinkGroups.getState().clearAll()
  resetMessage()
})

const COMMANDS = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['za_v0'],
  confirmations: [],
  runs: ['nt_fixture_run'],
  registry_error: null,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mount(props: Partial<Parameters<typeof LiveCommandLine>[0]> = {}) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  const onRun = vi.fn()
  render(
    <ApiProvider client={client}>
      <LiveCommandLine focusedGroup={null} onRun={onRun} {...props} />
    </ApiProvider>,
  )
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label })
  return { onRun, input }
}

describe('LiveCommandLine: suggestions from GET /api/commands', () => {
  it('GETs /api/commands and offers its contexts', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(COMMANDS))
    const { input } = mount()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(String(spy.mock.calls[0]?.[0])).toBe('/api/commands')
    expect(spy.mock.calls[0]?.[1]?.method).toBe('GET')
    // Typed in upper case, as the box shows it (spec 3.3): retyping a lowercase line on every retry
    // would change the value each time and keep waitFor's mutation observer busy.
    await waitFor(() => {
      fireEvent.change(input, { target: { value: 'NT_' } })
      expect(within(screen.getByRole('listbox')).getByText('nt_fixture_run')).toBeTruthy()
    })
  })

  it('uses the focused panel group context from the store when the line names none', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(COMMANDS))
    useLinkGroups.getState().setContext('B', { kind: 'instrument', value: 'NQ' })
    const { input, onRun } = mount({ focusedGroup: 'B' })
    fireEvent.change(input, { target: { value: 'GP' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('NQ GP')
  })

  it('prefers the focused panel context read at run time over the store', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(COMMANDS))
    useLinkGroups.getState().setContext('B', { kind: 'instrument', value: 'NQ' })
    const { input, onRun } = mount({ focusedGroup: 'B', resolveFallback: () => ({ kind: 'hypothesis', value: 'za_v0' }) })
    fireEvent.change(input, { target: { value: 'DES' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('za_v0 DES')
  })

  it('an unlinked panel gives no fallback context', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(COMMANDS))
    useLinkGroups.getState().setContext('A', { kind: 'instrument', value: 'NQ' })
    const { input, onRun } = mount({ focusedGroup: '-' })
    fireEvent.change(input, { target: { value: 'GP' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun).not.toHaveBeenCalled()
    // Errors now read in the message line (spec 4.2), a polite status region, not an alert box.
    expect(screen.getByRole('status').textContent).toMatch(/^GP needs an instrument/)
  })

  it('notes a failed index and still offers functions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'down' }, 503))
    const { input } = mount()
    await waitFor(() => {
      fireEvent.change(input, { target: { value: 'RE' } })
      expect(screen.getByText(COMMAND_LINE.indexError)).toBeTruthy()
    })
  })
})
