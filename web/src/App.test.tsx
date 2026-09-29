// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetConnection } from './api/connection'
import { resetRecordWatchBoot, resetRecordWatchView } from './chrome/RecordWatch.live'
import { layoutFor } from './chrome/WorkspaceLayouts'
import appSource from './App.tsx?raw'
import dispatchSource from './chrome/CommandLine.dispatch.ts?raw'
import frameStripSource from './chrome/FrameStrip.tsx?raw'
import keyActionsSource from './chrome/KeyToolbar.actions.ts?raw'
import deepLinksSource from './chrome/useDeepLinks.ts?raw'
import lineSource from './commands/line.ts?raw'
import { COMMAND_LINE, PARSE_MESSAGES } from './copy/commands'
import { CONNECTION } from './copy/connection'
import { DEMO_DATA, FRAME_STRIP, KEY_TOOLBAR, MESSAGES, NAV_TOOLBAR, STATUS_BAR } from './copy/chrome'
import { TAPE } from './copy/tape'
import { HOME_ORIENTATION } from './copy/home'
import { LAYOUT } from './copy/layout'
import { REG } from './copy/reg'
import { TYPE_HINT } from './copy/typeHint'
import { WATCH } from './copy/watch'
import { WATCH_DETAIL } from './copy/watchDetail'
import { WORKSPACES } from './copy/workspaces'
import { WORKSPACE, fillCopy } from './copy/workspace'
import { CONFIRMATIONS, REGISTRY } from './screens/reg/regFixtures'
import { LEDGER, RUNS } from './screens/runs/runs.fixtures'
import type { WatchSnapshot } from './state/recordWatch.schema'
import { useRecordWatchStore } from './state/recordWatch.store'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'
import { ORIENTATION_KEY } from './screens/home/HomeOrientation'
import { useHelpTopic } from './screens/help/helpTopic.store'
import { useWorkspaces, type Recipe } from './state/workspaces'
import { resetMessage, useMessage } from './chrome/MessageLine.store'
import { numberedItems } from './chrome/NumberedActions'
import { ANSWERS as REG_ANSWERS } from './screens/reg/testHarness'

// GRAB itself (src/export/grab/run.ts) is reached through a dynamic import from the Workspace chunk; the
// tests below check what the frame hands it, so the runner is replaced by a spy.
const grabPanel = vi.hoisted(() => vi.fn<(req: unknown) => Promise<boolean>>(async () => true))
vi.mock('./export/grab/run', () => ({ grabPanel }))

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
  grabPanel.mockClear()
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.stubGlobal('fetch', fetchSpy)
  Element.prototype.scrollIntoView = () => {}
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => reply(String(input)))
  useLinkGroups.getState().clearAll()
  useLayouts.getState().resetAll()
  localStorage.clear()
  useWorkspaces.setState({ list: {}, last: null, persisted: true })
  window.history.replaceState(null, '', '/')
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
  // Looked up again on every poll: while the Workspace chunk loads, the <main> on screen is the loading one, which the real one replaces.
  await waitFor(() => expect(within(screen.getByRole('main', { name: 'Workspace' })).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS))
  await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/commands')).toBe(true))
  return screen.getByRole('main', { name: 'Workspace' })
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

/** homeLoaded() for a test that may render the app first: the lazy Workspace has replaced its loading placeholder. */
async function workspaceLoaded(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('main[aria-busy="true"]')).toBeNull())
  return homeLoaded()
}

describe('GRAB <GO> (roadmap 15)', { timeout: 20_000 }, () => {
  it('with no panel to grab, posts the no-panel message and starts no grab', async () => {
    vi.resetModules()
    vi.doMock('./chrome/Workspace', () => new Promise(() => {}))
    try {
      const { default: FreshApp } = await import('./App')
      render(<FreshApp />)
      await runLine('GRAB')
      // The message line colours its <Key> tokens, so the sentence is split over elements: read its text.
      expect(document.body.textContent).toContain(COMMAND_LINE.grabUnavailable)
      expect(grabPanel).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('./chrome/Workspace')
      vi.resetModules()
    }
  })

  it('with a focused panel, asks the Workspace to grab it as a file, without any request', async () => {
    render(<App />)
    const main = await workspaceLoaded()
    await focusPanel(main, 3)
    // Requests made while GRAB runs: the caption is built from what the page holds, so there must be none.
    const during: string[] = []
    let running = false
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (running) during.push(String(input))
      return reply(String(input))
    })
    running = true
    await runLine('GRAB')
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    running = false
    expect(grabPanel.mock.calls[0]?.[0]).toMatchObject({
      panelId: main.querySelectorAll('[data-nqt-panel]')[2]?.getAttribute('data-nqt-panel'),
      code: 'EQ',
      number: 3,
      group: 'B',
      target: 'file',
    })
    expect(document.body.textContent).not.toContain(COMMAND_LINE.grabUnavailable)
    expect(during).toEqual([])
  })

  it('reads the health answer the status line already holds for the caption', async () => {
    render(<App />)
    const main = await workspaceLoaded()
    await focusPanel(main, 1)
    await waitFor(() => expect(within(screen.getByRole('contentinfo')).getByText(STATUS_BAR.fixture)).toBeTruthy())
    await runLine('GRAB')
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(grabPanel.mock.calls[0]?.[0]).toMatchObject({ code: 'GP', number: 1, health: { now_utc: HEALTH.now_utc, fixture_mode: true } })
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

describe('named workspaces: SAVE, LOAD and FORGET (roadmap 14)', { timeout: 30_000 }, () => {
  const tabOf = (name: string) => frameStrip().getByRole('button', { name: new RegExp(`^${name}`) })
  const workspaceTabs = () => Array.from(document.querySelectorAll<HTMLElement>('[data-chrome="frame"] [data-tab="workspace"]')).map((t) => t.getAttribute('data-workspace'))
  const stored = (): { readonly list: Readonly<Record<string, unknown>>; readonly last?: string } | null => {
    const text = localStorage.getItem('nqt.workspaces')
    return text === null ? null : (JSON.parse(text) as { list: Record<string, unknown>; last?: string })
  }
  const recipeOf = (...lines: string[]): Recipe => ({
    version: 1,
    panels: lines.map((line, i) => ({ line, group: '-' as const, ref: i === 0 ? null : 0, direction: 'right' as const })),
    groups: { A: null, B: null, C: null },
  })
  /** A page reload: the memory of the store and of the layouts is gone, only localStorage is left. */
  const reload = () => {
    cleanup()
    resetConnection()
    useWorkspaces.setState({ list: {}, last: null, persisted: true })
    useLinkGroups.getState().clearAll()
    useLayouts.getState().resetAll()
    resetMessage()
    window.dispatchEvent(new StorageEvent('storage', { key: 'nqt.workspaces' }))
  }

  it('App reaches the workspaces only through the Workspace handle and the store: it never imports the recipe walker', () => {
    expect(appSource).not.toMatch(/WorkspaceRecipe/)
    expect(appSource).toMatch(/saveWorkspace/)
    expect(appSource).toMatch(/loadWorkspace/)
  })

  it('the store and the workspace copy stay out of the shell: the chrome files import them as types or on demand only', () => {
    const shellFiles = { 'App.tsx': appSource, 'CommandLine.dispatch.ts': dispatchSource, 'FrameStrip.tsx': frameStripSource, 'KeyToolbar.actions.ts': keyActionsSource, 'useDeepLinks.ts': deepLinksSource, 'line.ts': lineSource }
    for (const [file, text] of Object.entries(shellFiles)) {
      const staticImports = text.split('\n').filter((l) => /^import .*\/state\/workspaces'/.test(l) && !l.startsWith('import type '))
      expect(staticImports, `${file} imports the store statically`).toEqual([])
      expect(text, `${file} imports the workspace copy`).not.toMatch(/from '[./]+\/copy\/workspaces'/)
    }
    // ... and it is still fetched: beside the Workspace chunk, on demand.
    expect(appSource).toMatch(/import\('\.\/state\/workspaces'\)/)
    expect(deepLinksSource).toMatch(/import\('\.\.\/state\/workspaces'\)/)
  })

  it('SAVE VMREVIEW keeps the panels, adds an active tab after LIVE and remembers it as the last', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('SAVE VMREVIEW')
    expect(screen.getByText(fillCopy(WORKSPACES.saved, { name: 'VMREVIEW', n: HOME_PANELS }))).toBeTruthy()
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    const nav = screen.getByRole('navigation', { name: FRAME_STRIP.label })
    expect(within(nav).getAllByRole('button').map((t) => t.getAttribute('data-tab'))).toEqual(['HOME', 'RESEARCH', 'LIVE', 'workspace', 'new'])
    expect(within(nav).getAllByRole('button')[0]?.getAttribute('aria-current')).toBeNull()
    expect(Object.keys(stored()?.list ?? {})).toEqual(['VMREVIEW'])
    expect(stored()?.last).toBe('VMREVIEW')
    // A workspace owns its layout: nothing is written to the per-screen layouts.
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
  })

  it('SAVE with a name that is a function says so and stores nothing', async () => {
    render(<App />)
    await homeLoaded()
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SAVE REG' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMessage.getState().text).toBe(PARSE_MESSAGES['bad-name'].replace('{token}', 'REG'))
    expect(workspaceTabs()).toEqual([])
    expect(localStorage.getItem('nqt.workspaces')).toBeNull()
  })

  it('edits inside a workspace mark its tab; clicking the tab loads the recipe again and clears the mark', async () => {
    render(<App />)
    const main = await homeLoaded()
    await runLine('SAVE VMREVIEW')
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(tabOf('VMREVIEW').textContent).toContain(LAYOUT.editedLabel))
    expect(localStorage.getItem('nqt.layouts')).toBeNull()
    fireEvent.click(tabOf('VMREVIEW'))
    await waitFor(() => expect(screen.getByText(fillCopy(WORKSPACES.loaded, { name: 'VMREVIEW' }))).toBeTruthy())
    await waitFor(() => expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull())
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS)
    expect(tabOf('VMREVIEW').textContent).not.toContain(LAYOUT.editedLabel)
    expect(document.activeElement?.id).toBe('cmd')
  })

  it('HOME <GO> hands the layout back to the screen; the workspace tab loads it again', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await runLine('SAVE VMREVIEW')
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    await runLine('RESET')
    await runLine('HOME')
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBeNull())
    useLayouts.getState().resetAll()
    fireEvent.click(tabOf('VMREVIEW'))
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
  })

  it('a fresh render restores the last workspace: its panels come back and its tab is active', async () => {
    const first = render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 4)
    await runLine('LEDG')
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await runLine('SAVE VMREVIEW')
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    first.unmount()
    // The reload finds HOME's default layout again: only the workspace holds LEDG.
    localStorage.removeItem('nqt.layouts')
    reload()
    expect(stored()?.last).toBe('VMREVIEW')
    render(<App />)
    const again = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(again).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    expect(screen.getByText(fillCopy(WORKSPACES.loaded, { name: 'VMREVIEW' }))).toBeTruthy()
  })

  it('a #go link wins over the last workspace: the link runs and the workspace is not loaded', async () => {
    useWorkspaces.getState().save('VMREVIEW', recipeOf('LEDG', 'RUNS'))
    useWorkspaces.getState().setLast('VMREVIEW')
    window.history.replaceState(null, '', '/#go=LEDG')
    render(<App />)
    const main = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(screen.queryByText(fillCopy(WORKSPACES.loaded, { name: 'VMREVIEW' }))).toBeNull()
    expect(within(main).queryByRole('group', { name: 'RUNS content' })).toBeNull()
    expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('a link that says SAVE, LOAD or FORGET is refused and touches no workspace', async () => {
    useWorkspaces.getState().save('VMREVIEW', recipeOf('LEDG', 'RUNS'))
    window.history.replaceState(null, '', '/#go=FORGET%20VMREVIEW')
    render(<App />)
    await homeLoaded()
    await waitFor(() => expect(useMessage.getState().text).toContain('FORGET VMREVIEW'))
    expect(useMessage.getState().tone).toBe('error')
    expect(workspaceTabs()).toEqual(['VMREVIEW'])
    expect(Object.keys(useWorkspaces.getState().list)).toEqual(['VMREVIEW'])
  })

  it('a recipe with a line that no longer parses is refused whole, naming the line; nothing changes', async () => {
    useWorkspaces.getState().save('BROKEN', recipeOf('LEDG', 'nt_gone_run RUN'))
    render(<App />)
    const main = await homeLoaded()
    await runLine('LOAD BROKEN')
    const reason = PARSE_MESSAGES['unknown-context'].replace('{token}', 'nt_gone_run').replace(/\.$/, '')
    expect(useMessage.getState().text).toBe(fillCopy(WORKSPACES.lineFailed, { name: 'BROKEN', line: 'nt_gone_run RUN', reason }))
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS)
    expect(within(main).queryByRole('group', { name: 'LEDG content' })).toBeNull()
    expect(tabOf('BROKEN').getAttribute('aria-current')).toBeNull()
    expect(useWorkspaces.getState().last).toBeNull()
  })

  it('a last workspace that no longer parses is refused at the reload too, and HOME stays', async () => {
    useWorkspaces.getState().save('BROKEN', recipeOf('LEDG', 'nt_gone_run RUN'))
    useWorkspaces.getState().setLast('BROKEN')
    render(<App />)
    const main = await homeLoaded()
    await waitFor(() => expect(useMessage.getState().text).toContain('BROKEN could not load'))
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS)
    expect(tabOf('BROKEN').getAttribute('aria-current')).toBeNull()
  })

  it('LOAD on its own lists the saved workspaces; choosing one loads it', async () => {
    useWorkspaces.getState().save('ALPHA', recipeOf('LEDG'))
    useWorkspaces.getState().save('BRAVO', recipeOf('RUNS', 'LEDG'))
    render(<App />)
    const main = await homeLoaded()
    await runLine('LOAD')
    const list = await screen.findByRole('listbox', { name: WORKSPACES.menuTitle })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('ALPHA'), expect.stringContaining('BRAVO')])
    fireEvent.click(within(list).getAllByRole('option')[1]!)
    await waitFor(() => expect(screen.getByText(fillCopy(WORKSPACES.loaded, { name: 'BRAVO' }))).toBeTruthy())
    await waitFor(() => expect(within(main).getByRole('group', { name: 'RUNS content' })).toBeTruthy())
    await waitFor(() => expect(tabOf('BRAVO').getAttribute('aria-current')).toBe('page'))
  })

  it('LOAD on its own with nothing saved says how to save one', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('LOAD')
    expect(await screen.findByText(WORKSPACES.none)).toBeTruthy()
  })

  it('LOAD of a name that was never saved says so', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('LOAD NOPE')
    expect(screen.getByText(fillCopy(WORKSPACES.missing, { name: 'NOPE' }))).toBeTruthy()
  })

  it('FORGET removes the workspace and its tab; the panels on screen stay; a second FORGET says it is gone', async () => {
    render(<App />)
    const main = await homeLoaded()
    await runLine('SAVE VMREVIEW')
    await waitFor(() => expect(tabOf('VMREVIEW').getAttribute('aria-current')).toBe('page'))
    await runLine('FORGET VMREVIEW')
    expect(screen.getByText(fillCopy(WORKSPACES.forgotten, { name: 'VMREVIEW' }))).toBeTruthy()
    await waitFor(() => expect(workspaceTabs()).toEqual([]))
    expect(localStorage.getItem('nqt.workspaces')).toBeNull()
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS)
    // With the workspace gone the screen's tab is the active one again.
    expect(frameStrip().getAllByRole('button')[0]?.getAttribute('aria-current')).toBe('page')
    await runLine('FORGET VMREVIEW')
    expect(screen.getByText(fillCopy(WORKSPACES.missing, { name: 'VMREVIEW' }))).toBeTruthy()
  })

  it('a forgotten workspace is not restored at the next reload', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('SAVE VMREVIEW')
    await runLine('FORGET VMREVIEW')
    reload()
    render(<App />)
    await homeLoaded()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(useMessage.getState().text).toBe('')
  })

  it('the favourites menu lists the saved workspaces after the three layouts', async () => {
    useWorkspaces.getState().save('ALPHA', recipeOf('LEDG'))
    render(<App />)
    await homeLoaded()
    fireEvent.click(screen.getByRole('button', { name: NAV_TOOLBAR.favourites }))
    const list = await screen.findByRole('listbox', { name: NAV_TOOLBAR.favouritesTitle })
    const rows = within(list).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain(FRAME_STRIP.tabs.HOME.label)
    expect(rows[1]).toContain(FRAME_STRIP.tabs.RESEARCH.label)
    expect(rows[2]).toContain(FRAME_STRIP.tabs.LIVE.label)
    expect(rows[3]).toContain('ALPHA')
  })

  it('the + tab says how to keep a layout as a workspace', async () => {
    render(<App />)
    await homeLoaded()
    fireEvent.click(frameStrip().getByRole('button', { name: FRAME_STRIP.newTab }))
    expect(screen.getByText(MESSAGES.newLayout)).toBeTruthy()
    expect(MESSAGES.newLayout).toBe('Type a screen mnemonic, or SAVE NAME to keep this layout as a workspace.')
  })

  it('before the Workspace has loaded, SAVE and LOAD NAME say the workspace is not ready', async () => {
    vi.resetModules()
    vi.doMock('./chrome/Workspace', () => new Promise(() => {}))
    try {
      const { default: FreshApp } = await import('./App')
      render(<FreshApp />)
      await runLine('SAVE VMREVIEW')
      expect(screen.getByText(COMMAND_LINE.layoutUnavailable)).toBeTruthy()
      resetMessage()
      await runLine('LOAD VMREVIEW')
      expect(screen.getByText(COMMAND_LINE.layoutUnavailable)).toBeTruthy()
    } finally {
      vi.doUnmock('./chrome/Workspace')
      vi.resetModules()
    }
  })
})

describe('the HOME orientation strip (N03)', { timeout: 30_000 }, () => {
  const strip = () => screen.queryByRole('note', { name: HOME_ORIENTATION.label })

  it('App loads the strip on demand: it has no static import of screens/home/HomeOrientation', () => {
    const staticImports = appSource.split('\n').filter((l) => /^import\b.*home\/HomeOrientation/.test(l) && !l.startsWith('import type '))
    expect(staticImports).toEqual([])
    expect(appSource).toMatch(/import\('\.\/screens\/home\/HomeOrientation'\)/)
  })

  it('shows on a first run while HOME owns the layout, with the command links and a Dismiss button', async () => {
    render(<App />)
    await homeLoaded()
    const note = await screen.findByRole('note', { name: HOME_ORIENTATION.label })
    expect(note.textContent).toContain(HOME_ORIENTATION.lead)
    for (const line of ['REG', 'OOS', 'HELP']) expect(within(note).getByRole('button', { name: `${line} <GO>` })).toBeTruthy()
    expect(within(note).getByRole('button', { name: HOME_ORIENTATION.dismissLabel })).toBeTruthy()
    expect(localStorage.getItem(ORIENTATION_KEY)).toBeNull()
  })

  it('is gone once REG <GO> loads the layout of another screen', async () => {
    render(<App />)
    await homeLoaded()
    await screen.findByRole('note', { name: HOME_ORIENTATION.label })
    await runLine('REG')
    await waitFor(() => expect(strip()).toBeNull())
    // Nothing was dismissed: it is only not HOME's layout any more.
    expect(localStorage.getItem(ORIENTATION_KEY)).toBeNull()
    await runLine('HOME')
    await screen.findByRole('note', { name: HOME_ORIENTATION.label })
  })

  it('stays hidden after it is dismissed and the page is rendered afresh', async () => {
    const first = render(<App />)
    await homeLoaded()
    const note = await screen.findByRole('note', { name: HOME_ORIENTATION.label })
    fireEvent.click(within(note).getByRole('button', { name: HOME_ORIENTATION.dismissLabel }))
    expect(strip()).toBeNull()
    expect(localStorage.getItem(ORIENTATION_KEY)).toBe('1')
    first.unmount()
    render(<App />)
    await homeLoaded()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(strip()).toBeNull()
  })

  it('does not show while a workspace owns the layout', async () => {
    useWorkspaces.getState().save('DESK', {
      version: 1,
      panels: [{ line: 'LEDG', group: '-', ref: null, direction: 'right' }],
      groups: { A: null, B: null, C: null },
    })
    useWorkspaces.getState().setLast('DESK')
    render(<App />)
    const main = screen.getByRole('main', { name: 'Workspace' })
    await waitFor(() => expect(within(main).getByRole('group', { name: 'LEDG content' })).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(strip()).toBeNull()
  })
})

// Wave 10 chrome polish: Number <GO> in the addressed panel (G03), what a bare DES says it opened (G14), the
// command line focused on load (U05) and End after a link group retarget (U21).
describe('chrome navigation polish', { timeout: 30_000 }, () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = REG_ANSWERS[url]
      return body === undefined ? reply(url) : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  })

  const commandInput = () => screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
  const titles = () => Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')

  it('G03: right after REG loads, 9 <GO> replaces REG in panel 1, MT stays and End returns to REG', async () => {
    render(<App />)
    await homeLoaded()
    await runLine('REG')
    await waitFor(() => expect(titles()).toEqual(['REG', 'MT']))
    const reg = document.querySelector('[data-nqt-panel]')?.getAttribute('data-nqt-panel') ?? ''
    await waitFor(() => expect(numberedItems(reg).find((i) => i.n === 9)?.label).toBe('volmanaged_v0'))
    await runLine('9')
    await waitFor(() => expect(titles()).toEqual(['volmanaged_v0 DES', 'MT']))
    fireEvent.keyDown(commandInput(), { key: 'End' })
    await waitFor(() => expect(titles()).toEqual(['REG', 'MT']))
    expect(useMessage.getState().text).not.toBe(MESSAGES.backNone)
  })

  it('G14: a bare DES after a hypothesis is loaded into link group A says what the panel shows', async () => {
    render(<App />)
    const main = await homeLoaded()
    act(() => {
      useLinkGroups.getState().setContext('A', { kind: 'hypothesis', value: 'volmanaged_v0' })
    })
    await focusPanel(main, 1)
    expect(titles()[0]).toBe('NQ GP 1d')
    await runLine('DES')
    await waitFor(() => expect(titles()[0]).toBe('volmanaged_v0 DES'))
    expect(useMessage.getState().text).toBe('Opened volmanaged_v0 DES.')
    expect(screen.getByText('Opened volmanaged_v0 DES.')).toBeTruthy()
  })

  it('G14: a bare DES where the group holds nothing the screen takes still says the line it ran', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 1)
    await runLine('DES')
    await waitFor(() => expect(titles()[0]).toBe('NQ DES'))
    expect(useMessage.getState().text).toBe('Opened NQ DES.')
  })

  it('U05: the command line has focus on load', async () => {
    render(<App />)
    expect(document.activeElement).toBe(commandInput())
    await homeLoaded()
    expect(document.activeElement).toBe(commandInput())
  })

  it('U05: the first Esc on the empty line keeps focus in it, so "Esc, reg, Enter" is not lost; the second one goes to the panel', async () => {
    render(<App />)
    const main = await homeLoaded()
    fireEvent.keyDown(commandInput(), { key: 'Escape' })
    expect(document.activeElement).toBe(commandInput())
    await runLine('REG')
    await waitFor(() => expect(titles()).toEqual(['REG', 'MT']))
    fireEvent.keyDown(commandInput(), { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  it('U05: under StrictMode (which runs the mount effect twice) it still focuses the line, holds the first Esc, and lets go once focus has been anywhere else', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    const main = await homeLoaded()
    expect(document.activeElement).toBe(commandInput())
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    act(() => gp.blur())
    act(() => commandInput().focus())
    // Nothing to return to: focus was on a panel since load, so this Esc gives the panel back as it always did.
    fireEvent.keyDown(commandInput(), { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  // The hold is for an Esc pressed before any other key since load. A line that never reached onRun (a parse error, a
  // context only line) or a menu used to leave it armed, so a much later Esc on the empty line did nothing at all.
  it('U05: a line that fails to parse ends the hold: after it is cleared with Esc, the next Esc goes to the panel', async () => {
    render(<App />)
    const main = await homeLoaded()
    const input = commandInput()
    fireEvent.change(input, { target: { value: 'zzzz' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The line keeps what was typed (in capitals) beside the error.
    expect(input.value).toBe('ZZZZ')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  it('U05: a context only line ends the hold: after its menu is closed with Esc, the next Esc on the empty line goes to the panel', async () => {
    render(<App />)
    const main = await homeLoaded()
    const input = commandInput()
    await runLine('ES')
    // The first Esc closes the function menu the context opened; it has nothing to do with the boot focus.
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  it('U05: a bare modifier key does not end the hold (Shift or Alt pressed on the way to Esc), any other key does', async () => {
    render(<App />)
    const main = await homeLoaded()
    const input = commandInput()
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) fireEvent.keyDown(input, { key })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    // The hold is spent by that Esc, as it always was: the next one goes to the panel.
    fireEvent.keyDown(input, { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  it('U05: a key other than Esc typed before the first Esc ends the hold, so that Esc goes to the panel', async () => {
    render(<App />)
    const main = await homeLoaded()
    const input = commandInput()
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.keyDown(input, { key: 'Escape' })
    const first = main.querySelectorAll('[data-nqt-panel]')[0]
    await waitFor(() => expect(first?.contains(document.activeElement)).toBe(true))
  })

  it('U05: it takes focus from nothing that already has it', async () => {
    const other = document.createElement('button')
    document.body.append(other)
    other.focus()
    render(<App />)
    expect(document.activeElement).toBe(other)
    other.remove()
  })

  it('U05: a letter typed on a panel is not lost silently: the message line says where typing goes, and the key is left alone', async () => {
    render(<App />)
    const main = await homeLoaded()
    const gp = within(main).getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gp.focus())
    expect(fireEvent.keyDown(gp, { key: 'e' })).toBe(true)
    expect(useMessage.getState().text).toBe(TYPE_HINT)
  })

  it('U05: a letter no grid row starts with is the grid\'s own typeahead miss: it reaches the global handler unprevented and earns no hint', async () => {
    render(<App />)
    const main = await homeLoaded()
    await runLine('REG')
    await waitFor(() => expect(titles()).toEqual(['REG', 'MT']))
    const grid = await within(main).findByRole('grid', { name: REG.gridLabel })
    act(() => grid.focus())
    expect(document.activeElement).toBe(grid)
    resetMessage()
    // No registry name starts with q: the grid finds no row and leaves the key alone, so the global handler sees it.
    expect(fireEvent.keyDown(grid, { key: 'q' })).toBe(true)
    expect(useMessage.getState().text).not.toBe(TYPE_HINT)
    expect(useMessage.getState().text).toBe('')
  })

  it('U05: a letter a grid row starts with is taken by the grid (its typeahead moves the row), and earns no hint either', async () => {
    render(<App />)
    const main = await homeLoaded()
    await runLine('REG')
    await waitFor(() => expect(titles()).toEqual(['REG', 'MT']))
    const grid = await within(main).findByRole('grid', { name: REG.gridLabel })
    act(() => grid.focus())
    resetMessage()
    expect(fireEvent.keyDown(grid, { key: 'z' })).toBe(false)
    expect(useMessage.getState().text).not.toBe(TYPE_HINT)
  })

  it('U05: it stays quiet in the command line itself', async () => {
    render(<App />)
    await homeLoaded()
    resetMessage()
    fireEvent.keyDown(commandInput(), { key: 'e' })
    expect(useMessage.getState().text).toBe('')
  })

  it('U21: End after a context-only line put the link group and its panels back', async () => {
    render(<App />)
    const main = await homeLoaded()
    await focusPanel(main, 2)
    expect(titles()[0]).toBe('NQ GP 1d')
    await runLine('ES')
    await waitFor(() => expect(titles()[0]).toBe('ES GP 1d'))
    fireEvent.keyDown(commandInput(), { key: 'End' })
    await waitFor(() => expect(titles()[0]).toBe('NQ GP 1d'))
    expect(useLinkGroups.getState().contexts.A?.value).toBe('NQ')
    expect(useMessage.getState().text).not.toBe(MESSAGES.backNone)
  })
})

// U01 and the frame strip: the DEMO DATA key is a frame strip action like the tabs and Options, so it ends with the command
// line focused (actions.runAndFocus) instead of leaving focus on the button it was pressed on. That the HELP panel then shows
// the About this demo lines needs the HELP chunk to share its stores with App, which the vi.resetModules tests above break:
// App.demoKey.test.tsx checks that whole path.
describe('the DEMO DATA key', { timeout: 30_000 }, () => {
  beforeEach(() => {
    document.documentElement.dataset.demo = 'on'
  })
  afterEach(() => {
    delete document.documentElement.dataset.demo
    useHelpTopic.setState({ request: null })
  })

  it('opens the HELP screen and leaves the command line focused, not the button', async () => {
    render(<App />)
    await homeLoaded()
    const key = frameStrip().getByRole('button', { name: DEMO_DATA.term })
    act(() => key.focus())
    expect(document.activeElement).toBe(key)
    fireEvent.click(key)
    await waitFor(() => expect(frameStrip().getByRole('button', { name: /HELP/, current: 'page' })).toBeTruthy())
    expect(document.activeElement?.id).toBe('cmd')
  })

  it('is one key in the Safety group and is not on the real terminal', async () => {
    render(<App />)
    await homeLoaded()
    expect(within(screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })).getAllByRole('button')).toHaveLength(1)
    cleanup()
    delete document.documentElement.dataset.demo
    render(<App />)
    expect(within(screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })).queryAllByRole('button')).toHaveLength(0)
  })
})
