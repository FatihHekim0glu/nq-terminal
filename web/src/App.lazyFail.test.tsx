// @vitest-environment jsdom
// When an on-demand chunk cannot be fetched (a flaky network, a deploy that replaced the file names), the
// terminal stays up: the key map overlay and the event tape sit behind an error boundary that posts a line on
// the message line and renders nothing. The chunks are mocked to fail here, so this is a file of its own
// (vi.mock is hoisted per file; the working chunks are covered in App.lazy.test.tsx and App.test.tsx).
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetConnection } from './api/connection'
import { resetTapeCache, setTapeOn } from './chrome/EventTape.store'
import { resetMessage } from './chrome/MessageLine.store'
import { resetRecordWatchBoot, resetRecordWatchView } from './chrome/RecordWatch.live'
import { CHROME, KEYMAP, MESSAGES, TAPE } from './copy/chrome'
import { COMMAND_LINE } from './copy/commands'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'
import { useRecordWatchStore } from './state/recordWatch.store'

vi.mock('./chrome/KeyToolbar.overlay', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
vi.mock('./chrome/EventTape.live', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

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
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

function reply(url: string): Response {
  const body = url.startsWith('/api/health') ? HEALTH : url.startsWith('/api/commands') ? COMMANDS : null
  return new Response(JSON.stringify(body ?? { detail: 'not found' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } })
}

beforeAll(async () => {
  await import('./chrome/Workspace')
}, 30_000)

beforeEach(() => {
  // React logs a caught render error with console.error; the boundary is the behaviour under test, not the log.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => reply(String(input))))
  Element.prototype.scrollIntoView = () => {}
  useLinkGroups.getState().clearAll()
  useLayouts.getState().resetAll()
  localStorage.clear()
  resetTapeCache()
  resetMessage()
  useRecordWatchStore.setState({ checkpoint: null })
  resetRecordWatchView()
  resetRecordWatchBoot()
})

afterEach(() => {
  cleanup()
  resetConnection()
  localStorage.clear()
  resetTapeCache()
  vi.restoreAllMocks()
})

function expectFrameUp(): void {
  expect(screen.getByRole('combobox', { name: COMMAND_LINE.label })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1, name: CHROME.appTitle })).toBeTruthy()
}

describe('a key map overlay chunk that cannot load', { timeout: 15_000 }, () => {
  it('keeps the frame and the command line, says so on the message line, and survives a second Alt+K', async () => {
    render(<App />)
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label })
    input.focus()
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', altKey: true })
    await screen.findByText(MESSAGES.keymapFailed)
    expectFrameUp()
    expect(screen.queryByRole('dialog', { name: KEYMAP.title })).toBeNull()

    resetMessage()
    expect(() => fireEvent.keyDown(screen.getByRole('combobox', { name: COMMAND_LINE.label }), { key: 'k', code: 'KeyK', altKey: true })).not.toThrow()
    await screen.findByText(MESSAGES.keymapFailed)
    expectFrameUp()
  })
})

describe('an event tape chunk that cannot load', { timeout: 15_000 }, () => {
  it('keeps the frame and the command line, says so on the message line, and leaves the saved switch on', async () => {
    setTapeOn(true)
    render(<App />)
    await screen.findByText(MESSAGES.tapeFailed)
    expectFrameUp()
    expect(screen.queryByRole('complementary', { name: TAPE.label })).toBeNull()
    await waitFor(() => expect(screen.getByRole('main')).toBeTruthy())
    // A persisted "on" must still work after a reload: the failure never switches the tape off.
    expect(localStorage.getItem('nqt.tape')).toBe('true')
  })
})
