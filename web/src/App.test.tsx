// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { COMMAND_LINE } from './copy/commands'
import { FRAME } from './copy/frame'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'

// The Workspace (and dockview) is a lazy chunk: the first import in a test run takes a moment.
configure({ asyncUtilTimeout: 5000 })

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const HEALTH = {
  now_utc: '2026-09-26T12:00:00Z',
  nautilus_version: '1.231.0',
  pins: { pandas: '2.3.3', pyarrow: '25.0.1', quantpad_data: '0.8.0', nautilus: '1.231.0' },
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  sealed: { openings_pin_ok: true, sealed_log_pin_ok: true, openings_closed: true },
  kill_switch_on: false,
  gate_reads_this_process: 0,
  cache: { series: 0, bytes: 0 },
  fixture_mode: true,
}

const COMMANDS = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
  ],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: [],
  registry_error: null,
}

function reply(url: string): Response {
  const body = url.startsWith('/api/health') ? HEALTH : url.startsWith('/api/commands') ? COMMANDS : { detail: 'not found' }
  return new Response(JSON.stringify(body), { status: body === HEALTH || body === COMMANDS ? 200 : 404, headers: { 'content-type': 'application/json' } })
}

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => reply(String(input)))

// Warm the lazy Workspace chunk once, so each test measures the app rather than the transform.
beforeAll(async () => {
  await import('./chrome/Workspace')
}, 30_000)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.stubGlobal('fetch', fetchSpy)
  Element.prototype.scrollIntoView = () => {}
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => reply(String(input)))
  useLinkGroups.getState().clearAll()
  useLayouts.getState().resetAll()
  localStorage.clear()
})

afterEach(cleanup)

/** The status-bar segment whose whole text is `text` (values sit in their own <b>). */
function segment(root: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('.seg')).find((el) => el.textContent === text)
}

async function runLine(line: string): Promise<void> {
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label })
  fireEvent.change(input, { target: { value: line } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
}

describe('terminal frame (UI_SPEC section 2)', { timeout: 15_000 }, () => {
  it('shows the command-line bar with the nq-lab prompt and a labelled input', () => {
    render(<App />)
    const bar = screen.getByRole('banner')
    expect(within(bar).getByText(COMMAND_LINE.prompt)).toBeTruthy()
    expect(within(bar).getByRole('combobox', { name: COMMAND_LINE.label })).toBeTruthy()
    expect(within(bar).getByRole('group', { name: FRAME.safetyLabel })).toBeTruthy()
  })

  it('opens the HOME layout in the workspace', async () => {
    render(<App />)
    const main = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(6))
  })

  it('status bar reads SCR 00 HOME, READ ONLY, NO ORDER PATH and TWS: not monitored', async () => {
    render(<App />)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'SCR 00 HOME')).toBeTruthy())
    expect(within(status).getByText('READ ONLY')).toBeTruthy()
    expect(within(status).getByText('NO ORDER PATH')).toBeTruthy()
    expect(within(status).getByText('TWS: not monitored')).toBeTruthy()
  })

  it('fetches only same-origin GET /api paths', async () => {
    render(<App />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    for (const [input, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit | undefined]>) {
      expect(String(input)).toMatch(/^\/api\//)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
    }
  })

  it('has no form and no control that could submit, cancel or modify anything', async () => {
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0))
    expect(container.querySelector('form')).toBeNull()
    for (const control of screen.queryAllByRole('button')) {
      expect(control.textContent ?? '').not.toMatch(/order|submit|cancel|modify/i)
    }
  })

  it('born failing: a failed health poll after a good one shows KILL: unknown, never the stale answer', async () => {
    let healthCalls = 0
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.startsWith('/api/health')) return reply(url)
      healthCalls += 1
      return healthCalls === 1 ? reply(url) : new Response('{"detail":"down"}', { status: 503 })
    })
    render(<App />)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(within(status).getByText('KILL: off')).toBeTruthy())
    await waitFor(() => expect(within(status).getByText('KILL: unknown')).toBeTruthy(), { timeout: 8000 })
    expect(within(status).queryByText('KILL: off')).toBeNull()
    expect(within(status).getByText('HEALTH: unavailable')).toBeTruthy()
  }, 12_000)

  it('born failing: a contextless command uses the focused panel as it is now, not as it was when focused', async () => {
    render(<App />)
    const main = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(6))
    await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/commands')).toBe(true))
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    await runLine('ES GP')
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })[0]?.textContent).toBe('ES GP'))
    await runLine('GIP 2019-03-14')
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })[0]?.textContent).toBe('ES GIP 2019-03-14'))
    expect(screen.getByText('Opened ES GIP 2019-03-14.')).toBeTruthy()
  })

  it('seeds the link groups from the HOME layout, so the strip and status bar name what the panels show', async () => {
    render(<App />)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'A NQ')).toBeTruthy())
    expect(segment(status, 'B volmanaged_v0')).toBeTruthy()
    expect(segment(status, 'C -')).toBeTruthy()
  })

  it('does not save the untouched default layout as the viewer layout', async () => {
    render(<App />)
    const main = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(6))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
  })
})
