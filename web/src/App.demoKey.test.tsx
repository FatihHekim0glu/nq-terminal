// @vitest-environment jsdom
// U01: the DEMO DATA key opens the HELP panel on its HELP page, where the About this demo lines come first, and leaves the
// command line focused like every other frame strip action. This is the whole path (click, App's onDemo, the HELP chunk
// answering the topic request), so it lives apart from App.test.tsx: several tests there call vi.resetModules, after which
// the lazily loaded HELP chunk gets a store of its own and no longer hears App's request.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './chrome/CommandLine.menus.load'
import { loadKeyActions } from './chrome/KeyToolbar.lazy'
import App from './App'
import { resetConnection } from './api/connection'
import { layoutFor } from './chrome/WorkspaceLayouts'
import { DEMO_DATA, FRAME_STRIP } from './copy/chrome'
import { DEMO_TOPIC, HELP_TOPIC } from './copy/helpTopics'
import { fillCopy } from './copy/workspace'
import { useHelpTopic } from './screens/help/helpTopic.store'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'
import { resetMessage } from './chrome/MessageLine.store'
import { useWorkspaces } from './state/workspaces'

// The command line's menus and sheets and the key actions load as chunks of their own; the app has them by its first idle moment.
beforeAll(async () => {
  await Promise.all([loadCommandLineParts(), loadKeyActions()])
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
  const body = url.startsWith('/api/health') ? HEALTH : url.startsWith('/api/commands') ? COMMANDS : null
  return new Response(JSON.stringify(body ?? { detail: 'not found' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } })
}

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => reply(String(input)))
const HOME_PANELS = layoutFor('HOME').panels.length

beforeAll(async () => {
  await import('./chrome/Workspace')
}, 30_000)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.stubGlobal('fetch', fetchSpy)
  Element.prototype.scrollIntoView = () => {}
  useLinkGroups.getState().clearAll()
  useLayouts.getState().resetAll()
  localStorage.clear()
  useWorkspaces.setState({ list: {}, last: null, persisted: true })
  window.history.replaceState(null, '', '/')
  resetMessage()
  useHelpTopic.setState({ request: null })
  document.documentElement.dataset.demo = 'on'
})

afterEach(() => {
  cleanup()
  resetConnection()
  delete document.documentElement.dataset.demo
  useHelpTopic.setState({ request: null })
})

// The first test in a fresh worker renders while the Workspace chunk is still loading: the loading <main> is then replaced
// by the real one, so the element is looked up again on every poll.
const COLD = { timeout: 20_000 }

async function homeLoaded(): Promise<void> {
  const main = () => screen.getByRole('main', { name: 'Workspace' })
  await waitFor(() => expect(within(main()).getAllByRole('heading', { level: 2 })).toHaveLength(HOME_PANELS), COLD)
  await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/commands')).toBe(true), COLD)
}

const safety = () => within(screen.getByRole('group', { name: FRAME_STRIP.safetyLabel }))

describe('the DEMO DATA key opens About this demo', { timeout: 40_000 }, () => {
  it('opens the HELP panel on its HELP page, About this demo first, and leaves the command line focused', async () => {
    render(<App />)
    await homeLoaded()
    const key = safety().getByRole('button', { name: DEMO_DATA.term })
    act(() => key.focus())
    expect(document.activeElement).toBe(key)
    fireEvent.click(key)
    const page = await screen.findByRole('region', { name: fillCopy(HELP_TOPIC.topicLabel, { code: 'HELP' }) })
    expect(within(page).getByText(DEMO_TOPIC.lines[0])).toBeTruthy()
    expect(document.activeElement?.id).toBe('cmd')
  })

  it('opens it again on a second press, after the reader went back to the help index', async () => {
    render(<App />)
    await homeLoaded()
    fireEvent.click(safety().getByRole('button', { name: DEMO_DATA.term }))
    const label = fillCopy(HELP_TOPIC.topicLabel, { code: 'HELP' })
    await screen.findByRole('region', { name: label })
    fireEvent.click(screen.getByRole('button', { name: /Back to the help index/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: label })).toBeNull())
    fireEvent.click(safety().getByRole('button', { name: DEMO_DATA.term }))
    await screen.findByRole('region', { name: label })
    expect(document.activeElement?.id).toBe('cmd')
  })
})
