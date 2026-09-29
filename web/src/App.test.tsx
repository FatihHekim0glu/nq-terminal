// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetConnection } from './api/connection'
import { resetRecordWatchBoot, resetRecordWatchView } from './chrome/RecordWatch.live'
import { layoutFor } from './chrome/WorkspaceLayouts'
import { COMMAND_LINE } from './copy/commands'
import { CONNECTION } from './copy/connection'
import { FRAME_STRIP, KEY_TOOLBAR, NAV_TOOLBAR, STATUS_BAR, TAPE } from './copy/chrome'
import { LAYOUT } from './copy/layout'
import { WATCH } from './copy/watch'
import { WATCH_DETAIL } from './copy/watchDetail'
import { WORKSPACE, fillCopy } from './copy/workspace'
import { CONFIRMATIONS, REGISTRY } from './screens/reg/regFixtures'
import { LEDGER, RUNS } from './screens/runs/runs.fixtures'
import type { WatchSnapshot } from './state/recordWatch.schema'
import { useRecordWatchStore } from './state/recordWatch.store'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'
import { resetMessage, useMessage } from './chrome/MessageLine.store'

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
  resetMessage()
  useRecordWatchStore.setState({ checkpoint: null })
  resetRecordWatchView()
  resetRecordWatchBoot()
})

// The connection state is one store for the whole page, so every test leaves it as it found it; the idle
// callback a test installs is removed again.
afterEach(() => {
  cleanup()
  resetConnection()
  Reflect.deleteProperty(window, 'requestIdleCallback')
  Reflect.deleteProperty(window, 'cancelIdleCallback')
})

/** The status-bar segment whose whole text is `text` (values sit in their own <b>). */
function segment(root: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('.seg')).find((el) => el.textContent === text)
}

/** The Screen segment of the status line, whatever it shows after the key. */
function screenSegment(status: HTMLElement): HTMLElement | undefined {
  return Array.from(status.querySelectorAll<HTMLElement>('.seg')).find((el) => el.querySelector('b')?.textContent === STATUS_BAR.screen)
}

/** What the eye reads in `el`: its text without the screen reader only words. */
function visibleText(el: HTMLElement | undefined): string {
  if (!el) return ''
  const copy = el.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove())
  return (copy.textContent ?? '').trim()
}

/** The frame strip (tabs and Options), apart from the key toolbar's own buttons. */
function frameStrip() {
  return within(document.querySelector<HTMLElement>('[data-chrome="frame"]')!)
}

async function runLine(line: string): Promise<void> {
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label })
  fireEvent.change(input, { target: { value: line } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
}

/** Alt+N, as the key toolbar documents it: focus panel N and wait until focus is inside it. */
async function focusPanel(main: HTMLElement, n: number): Promise<void> {
  fireEvent.keyDown(document.body, { key: String(n), code: `Digit${n}`, altKey: true })
  const panel = main.querySelectorAll('[data-nqt-panel]')[n - 1]
  await waitFor(() => expect(panel?.contains(document.activeElement)).toBe(true))
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
    expect(input.value).toBe('Index')
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

  it('refreshes the nav toolbar context after a context-only line retargets the link group (D04)', async () => {
    render(<App />)
    const main = await homeLoaded()
    const nav = screen.getByRole('group', { name: NAV_TOOLBAR.label })
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Context NQ1 Index/ })).toBeTruthy())
    await runLine('ES')
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Context ES1 Index/ })).toBeTruthy())
    fireEvent.click(within(nav).getByRole('button', { name: /Context ES1 Index/ }))
    expect(useLinkGroups.getState().contexts.A?.value).toBe('ES')
  })

  it('keeps a customised HOME layout when the HOME frame tab is clicked afterwards (D16)', async () => {
    render(<App />)
    const main = await homeLoaded()
    act(() => within(main).getByRole('group', { name: 'REG content' }).focus())
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    expect(localStorage.getItem('nqt.layouts')).not.toBeNull()
    // The HOME tab is the layout owner and still active after LEDG (a replace leaves the owner alone), so
    // its name now carries the title and the edited word: matched by its mnemonic, inside the frame strip.
    fireEvent.click(frameStrip().getByRole('button', { name: /^HOME/ }))
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    expect(visibleText(screenSegment(screen.getByRole('contentinfo')))).toBe('Screen HOME*')
    const stored: { readonly layouts?: Readonly<Record<string, unknown>> } = JSON.parse(localStorage.getItem('nqt.layouts') ?? '{}')
    expect(stored.layouts).toHaveProperty('HOME')
  })

  it('Alt+4 then LEDG: the HOME tab and the Screen segment carry the edited mark, and there is no LEDG tab', async () => {
    render(<App />)
    const main = await homeLoaded()
    const status = screen.getByRole('contentinfo')
    expect(visibleText(screenSegment(status))).toBe('Screen HOME')
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(visibleText(screenSegment(status))).toBe('Screen HOME*'))
    expect(screenSegment(status)?.querySelector('.sr-only')?.textContent?.trim()).toBe(LAYOUT.editedLabel)
    const nav = screen.getByRole('navigation', { name: FRAME_STRIP.label })
    const tabs = within(nav).getAllByRole('button')
    expect(tabs.map((t) => t.getAttribute('data-tab'))).toEqual(['HOME', 'RESEARCH', 'LIVE', 'new'])
    expect(within(nav).queryByRole('button', { name: /LEDG/ })).toBeNull()
    const home = tabs[0]!
    expect(home.getAttribute('aria-current')).toBe('page')
    expect(home.querySelector('[aria-hidden="true"]')?.textContent).toBe(LAYOUT.editedMark)
    expect(within(home).getByText(LAYOUT.editedLabel, { exact: false })).toBeTruthy()
  })

  it('shows what <GO> and <Shift+GO> would do before Enter, under the command line', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 4)
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'LEDG' } })
    const expected = '<GO> replaces 4-REG with LEDG | <Shift+GO> adds LEDG in a new panel right of 4-REG'
    await waitFor(() => expect(document.querySelector('.cmd-preview')?.textContent).toBe(expected))
    // Previewing changes nothing: the panels, the saved layouts and the mark stay as they were.
    expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull()
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
    expect(visibleText(screenSegment(screen.getByRole('contentinfo')))).toBe('Screen HOME')
  })

  it('answers the <GO> preview on the first keystrokes after the Workspace has rendered', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 4)
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'LEDG' } })
    // No waitFor: the preview module is loaded together with the Workspace, so the first line already has its row.
    expect(document.querySelector('.cmd-preview')?.textContent).toBe('<GO> replaces 4-REG with LEDG | <Shift+GO> adds LEDG in a new panel right of 4-REG')
  })

  it('RESET puts HOME back to its default and UNDO brings the customised panels back', async () => {
    render(<App />)
    const main = await homeLoaded()
    const status = screen.getByRole('contentinfo')
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await runLine('RESET')
    expect(screen.getByText(fillCopy(LAYOUT.reset, { screen: 'HOME' }))).toBeTruthy()
    await waitFor(() => expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull())
    await waitFor(() => expect(visibleText(screenSegment(status))).toBe('Screen HOME'))
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: FRAME_STRIP.label })).getAllByRole('button')[0]?.textContent).toBe('HOME Home view')
    await runLine('UNDO')
    expect(screen.getByText(fillCopy(LAYOUT.undone, { screen: 'HOME' }))).toBeTruthy()
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(visibleText(screenSegment(status))).toBe('Screen HOME*'))
    expect(localStorage.getItem('nqt.layouts')).not.toBeNull()
  })

  it('RESET on a default layout and UNDO with nothing behind it say so, and change nothing', async () => {
    render(<App />)
    const main = await homeLoaded()
    await runLine('RESET')
    expect(screen.getByText(fillCopy(LAYOUT.resetDefault, { screen: 'HOME' }))).toBeTruthy()
    await runLine('UNDO')
    expect(screen.getByText(LAYOUT.undoNone)).toBeTruthy()
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS)
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
  })

  it('the Options entries run UNDO and RESET, name the result in the message line and hand focus to the command line', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    fireEvent.click(frameStrip().getByRole('button', { name: FRAME_STRIP.options }))
    fireEvent.click(frameStrip().getByRole('button', { name: LAYOUT.resetOption }))
    expect(screen.getByText(fillCopy(LAYOUT.reset, { screen: 'HOME' }))).toBeTruthy()
    await waitFor(() => expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull())
    expect(document.activeElement?.id).toBe('cmd')
    fireEvent.click(frameStrip().getByRole('button', { name: FRAME_STRIP.options }))
    fireEvent.click(frameStrip().getByRole('button', { name: LAYOUT.undoOption }))
    expect(screen.getByText(fillCopy(LAYOUT.undone, { screen: 'HOME' }))).toBeTruthy()
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    expect(document.activeElement?.id).toBe('cmd')
  })

  it('before the lazy Workspace has loaded: RESET says the layout is not ready, UNDO has nothing to undo, no preview row', async () => {
    vi.resetModules()
    vi.doMock('./chrome/Workspace', () => new Promise(() => {}))
    try {
      const { default: FreshApp } = await import('./App')
      render(<FreshApp />)
      const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
      fireEvent.change(input, { target: { value: 'LEDG' } })
      expect(document.querySelector('.cmd-preview')).toBeNull()
      await runLine('RESET')
      expect(screen.getByText(COMMAND_LINE.layoutUnavailable)).toBeTruthy()
      await runLine('UNDO')
      expect(screen.getByText(LAYOUT.undoNone)).toBeTruthy()
      expect(localStorage.getItem('nqt.layouts')).toBeNull()
    } finally {
      vi.doUnmock('./chrome/Workspace')
      vi.resetModules()
    }
  })

  it('announces a saved layout dropped for an older default, shows the default, and UNDO restores the saved panels', async () => {
    const first = render(<App />)
    const firstMain = await homeLoaded()
    await focusPanel(firstMain, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(firstMain).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    const saved = useLayouts.getState().layouts.HOME as { readonly dock: unknown }
    first.unmount()
    cleanup()
    resetMessage()
    // The same dock, saved from a default that no longer exists.
    useLayouts.getState().saveLayout('HOME', { base: '00000000', dock: saved.dock })
    render(<App />)
    const main = await homeLoaded()
    expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull()
    expect(screen.getByText(fillCopy(LAYOUT.dropped, { screen: 'HOME' }))).toBeTruthy()
    expect(visibleText(screenSegment(screen.getByRole('contentinfo')))).toBe('Screen HOME')
    await runLine('UNDO')
    expect(screen.getByText(fillCopy(LAYOUT.undone, { screen: 'HOME' }))).toBeTruthy()
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(visibleText(screenSegment(screen.getByRole('contentinfo')))).toBe('Screen HOME*'))
  })

  it('drops a command typed before the lazy Workspace finishes loading, without reporting it ran (D18)', async () => {
    vi.resetModules()
    vi.doMock('./chrome/Workspace', () => new Promise(() => {}))
    try {
      const { default: FreshApp } = await import('./App')
      render(<FreshApp />)
      // Not runLine(): it waits for the box to clear, and the not-ready path now keeps the line
      // (below) so the user can simply press Enter again once the Workspace is ready.
      const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
      fireEvent.change(input, { target: { value: 'REG' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText(WORKSPACE.notReady)).toBeTruthy())
      expect(input.value).toBe('REG')
      expect(screen.queryByText('Opened REG.')).toBeNull()
      expect(localStorage.getItem('nqt.cmd.history') ?? '').not.toContain('REG')
    } finally {
      vi.doUnmock('./chrome/Workspace')
      vi.resetModules()
    }
  })
})

function health503(): Response {
  return new Response('{"detail":"down"}', { status: 503, headers: { 'content-type': 'application/json' } })
}

/** What Vite's dev proxy answers when nothing listens on the backend port: an empty text 500. */
function proxy500(): Response {
  return new Response(null, { status: 500 })
}

const strips = () => document.querySelectorAll('[data-chrome="connection"][role="alert"]')

/** The status-bar segment whose text matches `pattern`. */
function segmentLike(root: HTMLElement, pattern: RegExp): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('.seg')).find((el) => pattern.test(el.textContent ?? ''))
}

describe('connection supervisor and strip (roadmap 7)', { timeout: 20_000 }, () => {
  it.each([
    ['three 503 health answers', health503],
    ['three bodiless 500 health answers (the dev proxy with no backend)', proxy500],
  ])('%s give one API DOWN strip under the header and API DOWN since in the status line', async (_name, failure) => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      return url.startsWith('/api/health') ? failure() : reply(url)
    })
    render(<App />)
    await waitFor(() => expect(strips()).toHaveLength(1), { timeout: 10_000 })
    const strip = strips()[0]!
    expect(strip.textContent).toContain(CONNECTION.lead)
    const banner = screen.getByRole('banner')
    expect(banner.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.compareDocumentPosition(screen.getByRole('main', { name: 'Workspace' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segmentLike(status, /API DOWN since \d{2}:\d{2}:\d{2} ET$/)).toBeTruthy())
    expect(within(status).queryByText(STATUS_BAR.healthDown)).toBeNull()
    expect(segment(status, 'KILL unknown')).toBeTruthy()
    // One strip, however many checks fail after the third.
    expect(strips()).toHaveLength(1)
  }, 20_000)

  it('drops the strip and says the backend is back when a health check answers again', async () => {
    let up = false
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      return url.startsWith('/api/health') && !up ? health503() : reply(url)
    })
    render(<App />)
    await waitFor(() => expect(strips()).toHaveLength(1), { timeout: 10_000 })
    up = true
    await waitFor(() => expect(strips()).toHaveLength(0), { timeout: 10_000 })
    expect(useMessage.getState().text).toMatch(/^Backend back at \d{2}:\d{2}:\d{2} ET; \d+ requests retried\.$/)
    const status = screen.getByRole('contentinfo')
    await waitFor(() => expect(segment(status, 'KILL off')).toBeTruthy())
    expect(status.textContent).not.toContain('API DOWN')
  }, 25_000)

  it('shows no strip and no alert of its own while the backend answers', async () => {
    render(<App />)
    await homeLoaded()
    expect(strips()).toHaveLength(0)
    expect(screen.getByRole('contentinfo').textContent).not.toContain('API DOWN')
  })
})

const OPENINGS = { label: 'openings', openings: [{ opened_utc: '2026-09-26T10:00:00Z', by: 'user' }], openings_closed: true }
const WATCH_OOS = { entries: [{ line_no: 1, caller: 'terminal' }, { line_no: 2, caller: 'terminal' }, { line_no: 3, caller: 'sealed' }], total: 3 }
const GATE_LOG_READ = '/api/audit/oos-log?limit=5000'
const WATCH_BODIES: Readonly<Record<string, unknown>> = {
  '/api/registry': REGISTRY,
  '/api/confirmations': CONFIRMATIONS,
  '/api/audit/openings': OPENINGS,
  '/api/ledger': LEDGER,
  [GATE_LOG_READ]: WATCH_OOS,
  '/api/runs': RUNS,
}

/** The app's usual answers, with the six records of the watch answered from the fixtures. */
function replyWithRecords(url: string): Response {
  const body = WATCH_BODIES[url]
  return body === undefined ? reply(url) : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** jsdom has no requestIdleCallback: install one the test fires by hand (RecordWatch.live falls back to a 2 s timer). */
function holdIdle(): { readonly fire: () => void; readonly requested: () => number } {
  let waiting: (() => void) | null = null
  const request = vi.fn((callback: () => void) => {
    waiting = callback
    return 1
  })
  Object.assign(window, { requestIdleCallback: request, cancelIdleCallback: vi.fn() })
  return {
    fire: () => act(() => waiting?.()),
    requested: () => request.mock.calls.length,
  }
}

type Loose = { sources: Record<string, { count: number; records: Record<string, Record<string, unknown>> }> }

/** A checkpoint the browser "kept earlier", taken from the fixtures and then edited by `change`. */
async function keepCheckpoint(change: (s: Loose) => void = () => undefined): Promise<void> {
  const lazy = await import('./chrome/RecordWatch.lazy')
  const snapshot = lazy.snapshotOf({ registry: REGISTRY, confirmations: CONFIRMATIONS, openings: OPENINGS, ledger: LEDGER, oos: WATCH_OOS, runs: RUNS }, Date.UTC(2026, 8, 20, 14, 0))
  const copy = JSON.parse(JSON.stringify(snapshot)) as Loose
  change(copy)
  expect(useRecordWatchStore.getState().setCheckpoint(copy as unknown as WatchSnapshot)).toBe(true)
}

const gateLogReads = () => fetchSpy.mock.calls.filter(([url]) => String(url) === GATE_LOG_READ)

describe('record watch in the chrome (roadmap 16)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => replyWithRecords(String(input)))
  })

  it('starts no watch read before the first idle moment, then reads the gate log and shows WATCH from now', async () => {
    const idle = holdIdle()
    render(<App />)
    await homeLoaded()
    const status = screen.getByRole('contentinfo')
    expect(idle.requested()).toBe(1)
    expect(gateLogReads()).toHaveLength(0)
    expect(segmentLike(status, /^WATCH /)).toBeUndefined()
    idle.fire()
    await waitFor(() => expect(gateLogReads()).toHaveLength(1))
    await waitFor(() => expect(segment(status, 'WATCH from now')).toBeTruthy())
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit | undefined]>
    expect(calls.every(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET')).toBe(true)
  })

  it('reads WATCH no change on a later visit with the same records', async () => {
    await keepCheckpoint()
    const idle = holdIdle()
    render(<App />)
    await homeLoaded()
    idle.fire()
    await waitFor(() => expect(segment(screen.getByRole('contentinfo'), 'WATCH no change')).toBeTruthy())
  })

  it('WATCH and WATCH SEEN post the unavailable line while the six reads have not been made', async () => {
    holdIdle()
    render(<App />)
    await homeLoaded()
    await runLine('WATCH')
    expect(screen.getByText(COMMAND_LINE.watchUnavailable)).toBeTruthy()
    resetMessage()
    await runLine('WATCH SEEN')
    expect(screen.getByText(COMMAND_LINE.watchUnavailable)).toBeTruthy()
    expect(screen.queryByRole('listbox', { name: WATCH_DETAIL.menuTitle })).toBeNull()
  })

  it('shows WATCH 1 changed in amber, WATCH <GO> lists it, choosing it opens the record and WATCH SEEN restores no change', async () => {
    // volmanaged_v0 is in the command index of this file's fake backend, so choosing its row can run.
    const name = 'volmanaged_v0'
    await keepCheckpoint((s) => void (s.sources.registry!.records[name]!.p = 0.987654))
    const idle = holdIdle()
    render(<App />)
    await homeLoaded()
    const status = screen.getByRole('contentinfo')
    idle.fire()
    await waitFor(() => expect(segmentLike(status, /^WATCH 1 changed/)).toBeTruthy())
    expect(segmentLike(status, /^WATCH 1 changed/)?.className).toMatch(/\bwarn\b/)

    await runLine('WATCH')
    const list = await screen.findByRole('listbox', { name: WATCH_DETAIL.menuTitle })
    const rows = within(list).getAllByRole('option')
    expect(rows[0]?.textContent).toContain(`${name} DES`)
    expect(rows.at(-1)?.textContent).toContain('WATCH SEEN')
    fireEvent.click(rows[0]!)
    await waitFor(() => expect(screen.getByText(`Opened ${name} DES.`)).toBeTruthy())

    await runLine('WATCH SEEN')
    expect(useMessage.getState().text).toMatch(/^Marked as seen at .+ ET\.$/)
    await waitFor(() => expect(segment(status, 'WATCH no change')).toBeTruthy())
    expect(segmentLike(status, /^WATCH 1 changed/)).toBeUndefined()
  })

  it('posts the start-up line once when a record differs from the kept checkpoint', async () => {
    const runId = RUNS[0]?.run_id ?? ''
    await keepCheckpoint((s) => void delete s.sources.runs?.records[runId])
    const idle = holdIdle()
    render(<App />)
    await homeLoaded()
    idle.fire()
    await waitFor(() => expect(segment(screen.getByRole('contentinfo'), 'WATCH 1 new')).toBeTruthy())
    expect(useMessage.getState().text).toMatch(/^Since .+ ET: 1 run\. WATCH <GO> lists them\.$/)
    expect(WATCH.news).toBe('{n} new')
  })
})
