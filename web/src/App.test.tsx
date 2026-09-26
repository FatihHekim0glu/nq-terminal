// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { layoutFor } from './chrome/WorkspaceLayouts'
import { COMMAND_LINE } from './copy/commands'
import { FRAME_STRIP, KEY_TOOLBAR, NAV_TOOLBAR, TAPE } from './copy/chrome'
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

const OOS_LOG = {
  counts_by_caller: {}, fence_end: '2022-01-01', filters: { caller: null, limit: 3, offset: 0, since: null },
  key_sets: {}, log_present: true, matched: 1, parse_errors: [], partial_tail: false, returned: 1,
  sealed_reads: 0, terminal_reads: 1, total: 1,
  entries: [{
    caller: 'terminal', end: '2022-01-01', end_epoch_s: null, is_sealed: false, key_set: 'v3', line_no: 7,
    past_fence: false, reason: 'terminal display', rows: 10, sealed: false, spec_sha256: null, start: '2019-01-01',
    start_epoch_s: null, symbol: 'NQ.V.0', timeframe: '1d', ts_epoch_s: null, ts_utc: '2021-06-01T18:02:30+00:00', variant: 'vendor',
  }],
}

function bodyFor(url: string): unknown {
  if (url.startsWith('/api/health')) return HEALTH
  if (url.startsWith('/api/commands')) return COMMANDS
  if (url.startsWith('/api/audit/oos-log')) return OOS_LOG
  return null
}

function reply(url: string): Response {
  const body = bodyFor(url)
  return new Response(JSON.stringify(body ?? { detail: 'not found' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } })
}

const HOME_PANELS = layoutFor('HOME').panels.length

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

async function homeLoaded(): Promise<HTMLElement> {
  const main = screen.getByRole('main', { name: 'Workspace' })
  await waitFor(() => expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS))
  await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/commands')).toBe(true))
  return main
}

describe('terminal frame (spec 4.1: frame strip, key toolbar, nav toolbar, command zone)', { timeout: 15_000 }, () => {
  it('stacks the frame strip, key toolbar, nav toolbar and command zone in the banner, in that order', () => {
    render(<App />)
    const bar = screen.getByRole('banner')
    const rows = [
      within(bar).getByRole('navigation', { name: FRAME_STRIP.label }),
      within(bar).getByRole('group', { name: KEY_TOOLBAR.label }),
      within(bar).getByRole('group', { name: NAV_TOOLBAR.label }),
      within(bar).getByRole('combobox', { name: COMMAND_LINE.label }),
    ]
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.compareDocumentPosition(rows[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(bar).getByRole('group', { name: FRAME_STRIP.safetyLabel })).toBeTruthy()
    expect(within(bar).queryByText('nq-lab>')).toBeNull()
  })

  it('opens the HOME layout in the workspace', async () => {
    render(<App />)
    await homeLoaded()
  })

  it('status line reads Screen HOME, READ ONLY, NO ORDER PATH and TWS not monitored', async () => {
    render(<App />)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'Screen HOME')).toBeTruthy())
    expect(within(status).getByText('READ ONLY')).toBeTruthy()
    expect(within(status).getByText('NO ORDER PATH')).toBeTruthy()
    expect(segment(status, 'TWS not monitored')).toBeTruthy()
  })

  it('fetches only same-origin GET /api paths', async () => {
    render(<App />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    for (const [input, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit | undefined]>) {
      expect(String(input)).toMatch(/^\/api\//)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
    }
  })

  // The key toolbar carries the CANCEL key (spec 4.2): it is Esc, and acts on the command line only
  // (closes the list, clears the line). It is the one control allowed to read CANCEL, and it is checked
  // here to do nothing else: no request, no panel change.
  it('has no form and no control that could submit, cancel or modify anything but the CANCEL key', async () => {
    const { container } = render(<App />)
    const main = await homeLoaded()
    expect(container.querySelector('form')).toBeNull()
    const flagged = screen.queryAllByRole('button').filter((b) => /order|submit|cancel|modify/i.test(b.textContent ?? ''))
    expect(flagged.map((b) => b.getAttribute('data-key'))).toEqual(['esc'])
    const headings = within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const calls = fetchSpy.mock.calls.length
    fireEvent.click(flagged[0]!)
    expect(fetchSpy.mock.calls.length).toBe(calls)
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(headings)
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
    await waitFor(() => expect(segment(status, 'KILL off')).toBeTruthy())
    await waitFor(() => expect(segment(status, 'KILL unknown')).toBeTruthy(), { timeout: 8000 })
    expect(segment(status, 'KILL off')).toBeUndefined()
    expect(within(status).getByText('HEALTH unavailable')).toBeTruthy()
  }, 12_000)

  it('born failing: a contextless command uses the focused panel as it is now, not as it was when focused', async () => {
    render(<App />)
    const main = await homeLoaded()
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    // The panel title bar now reads `1-GP [A] ES` (spec 4.3), so the panel is checked by its title.
    const firstTitle = () => main.querySelector('[data-nqt-panel]')?.getAttribute('data-nqt-title')
    await runLine('ES GP')
    await waitFor(() => expect(firstTitle()).toBe('ES GP'))
    await runLine('GIP 2019-03-14')
    await waitFor(() => expect(firstTitle()).toBe('ES GIP 2019-03-14'))
    expect(screen.getByText('Opened ES GIP 2019-03-14.')).toBeTruthy()
  })

  it('seeds the link groups from the HOME layout, so the strip and status bar name what the panels show', async () => {
    render(<App />)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'A NQ1 Index')).toBeTruthy())
    expect(segment(status, 'B volmanaged_v0')).toBeTruthy()
    expect(segment(status, 'C -')).toBeTruthy()
  })

  it('does not save the untouched default layout as the viewer layout', async () => {
    render(<App />)
    await homeLoaded()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
  })

  it('keeps the event tape off by default; NO <GO> turns it on and it reads the gate log', async () => {
    render(<App />)
    await homeLoaded()
    expect(screen.queryByRole('complementary', { name: TAPE.label })).toBeNull()
    await runLine('NO')
    const tape = await screen.findByRole('complementary', { name: TAPE.label })
    await waitFor(() => expect(tape.textContent).toContain('0007 OOS 14:02 gate read terminal 1d NQ.V.0 [IS]'))
    expect(localStorage.getItem('nqt.tape')).toBe('true')
    await runLine('NO')
    expect(screen.queryByRole('complementary', { name: TAPE.label })).toBeNull()
  })

  it('Number <GO> says when the focused screen has no such item', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('42')
    expect(screen.getByText('No item 42 on this screen.')).toBeTruthy()
  })

  it('F10 from a panel puts Index in the command line and the browser does not act on it', async () => {
    render(<App />)
    const main = await homeLoaded()
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    const notPrevented = fireEvent.keyDown(gp, { key: 'F10' })
    expect(notPrevented).toBe(false)
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe(' Index')
  })

  it('born failing: before any panel has focus, the nav toolbar and command zone name panel 1; a command moves them to its panel', async () => {
    render(<App />)
    await homeLoaded()
    const nav = screen.getByRole('group', { name: NAV_TOOLBAR.label })
    await waitFor(() => expect(document.querySelector('.ctx-panel')?.textContent).toBe('1'))
    await waitFor(() => expect(nav.textContent).toContain('NQ1 Index'))
    expect(nav.textContent).toContain('GP')
    await runLine('REG')
    await waitFor(() => expect(nav.textContent).toContain('REG'))
    expect(document.querySelector('.ctx-panel')?.textContent).toBe('1')
  })

  it('Alt+2 focuses the second panel and the command zone shows its number', async () => {
    render(<App />)
    const main = await homeLoaded()
    fireEvent.keyDown(document.body, { key: '2', code: 'Digit2', altKey: true })
    const second = main.querySelectorAll('[data-nqt-panel]')[1]
    await waitFor(() => expect(second?.contains(document.activeElement)).toBe(true))
    await waitFor(() => expect(document.querySelector('.ctx-panel')?.textContent).toBe('2'))
  })

  it('a custom key on the key toolbar runs its screen', async () => {
    render(<App />)
    await homeLoaded()
    fireEvent.click(screen.getByRole('button', { name: KEY_TOOLBAR.custom.REG }))
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'Screen REG')).toBeTruthy())
  })
})
