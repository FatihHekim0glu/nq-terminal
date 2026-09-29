// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { INITIAL_CONNECTION, connectionStore, resetConnection } from '../api/connection'
import { createApiQueryClient } from '../api/queries'
import { emptyDiff } from '../state/recordWatch.schema'
import { useLinkGroups } from '../state/linkGroups'
import { LiveContextStrip } from './ContextStrip.live'
import type { RecordWatchView } from './RecordWatch.live'
import { LiveStatusBar, useHealthState } from './StatusBar.live'

afterEach(() => {
  cleanup()
  useLinkGroups.getState().clearAll()
  resetConnection()
  vi.restoreAllMocks()
})

const HEALTH = {
  now_utc: '2026-09-26T16:00:00Z',
  nautilus_version: '1.231.0',
  pins: { pandas: '2.3.3', pyarrow: '25.0.1', quantpad_data: '0.8.0', nautilus: '1.231.0' },
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  sealed: { openings_pin_ok: true, sealed_log_pin_ok: true, openings_closed: true },
  kill_switch_on: true,
  gate_reads_this_process: 3,
  cache: { series: 0, bytes: 0 },
  fixture_mode: true,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** True when some status-bar segment reads exactly `text` (values sit in their own <b>). */
function hasSegment(text: string): boolean {
  return Array.from(document.querySelectorAll('.seg')).some((el) => el.textContent === text)
}

/** True when the words of some segment end in `text`: the health words open with a screen reader only full stop. */
function hasSegmentEndingIn(text: string): boolean {
  return Array.from(document.querySelectorAll('.seg')).some((el) => el.textContent?.endsWith(text))
}

function mount(node: ReactNode) {
  // A fresh client per test; retries off so an error state shows at once.
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(<ApiProvider client={client}>{node}</ApiProvider>)
}

describe('LiveStatusBar: the status bar on GET /api/health and the link-group store', () => {
  it('shows the kill switch and gate reads from /api/health, with one GET', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(HEALTH))
    mount(<LiveStatusBar screen="HOME" />)
    expect(hasSegment('KILL reading')).toBe(true)
    await waitFor(() => expect(hasSegment('KILL ON')).toBe(true))
    expect(hasSegment('Gate reads 3')).toBe(true)
    expect(screen.getByText('FIXTURE DATA')).toBeTruthy()
    const [url, init] = spy.mock.calls[0]!
    expect(String(url)).toBe('/api/health')
    expect(init?.method).toBe('GET')
  })

  it('says the kill state is unknown when /api/health fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'down' }, 503))
    mount(<LiveStatusBar screen="HOME" />)
    await waitFor(() => expect(hasSegment('KILL unknown')).toBe(true))
    expect(screen.getByText('READ ONLY')).toBeTruthy()
    expect(screen.getByText('NO ORDER PATH')).toBeTruthy()
  })

  it('follows the link-group store', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(HEALTH))
    useLinkGroups.getState().setContext('A', { kind: 'instrument', value: 'NQ' })
    mount(
      <>
        <LiveContextStrip focusedGroup="A" />
        <LiveStatusBar screen="GP" />
      </>,
    )
    expect(hasSegment('A NQ1 Index')).toBe(true)
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('NQ1 Index')
    await waitFor(() => expect(hasSegment('KILL ON')).toBe(true))
  })
})

describe('LiveStatusBar: a stale answer is never shown as current', () => {
  it('drops an earlier KILL: off when a later poll fails', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ ...HEALTH, kill_switch_on: false }))
      .mockResolvedValue(json({ detail: 'down' }, 503))
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    render(
      <ApiProvider client={client}>
        <LiveStatusBar screen="HOME" />
      </ApiProvider>,
    )
    await waitFor(() => expect(hasSegment('KILL off')).toBe(true))
    await client.refetchQueries()
    await waitFor(() => expect(hasSegment('KILL unknown')).toBe(true))
    expect(hasSegment('KILL off')).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('LiveStatusBar: the connection state and the record watch', () => {
  it('names the time the backend went quiet once the connection store says down', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'down' }, 503))
    connectionStore.setState({ ...INITIAL_CONNECTION, status: 'down', failures: 3, downSince: Date.UTC(2026, 8, 29, 14, 5, 7) })
    mount(<LiveStatusBar screen="HOME" />)
    await waitFor(() => expect(hasSegmentEndingIn('API DOWN since 10:05:07 ET')).toBe(true))
    expect(hasSegment('KILL unknown')).toBe(true)
    expect(screen.queryByText('HEALTH unavailable')).toBeNull()
  })

  it('keeps HEALTH unavailable while the store has seen fewer than three outage answers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'down' }, 503))
    connectionStore.setState({ ...INITIAL_CONNECTION, status: 'degraded', failures: 1 })
    mount(<LiveStatusBar screen="HOME" />)
    await waitFor(() => expect(hasSegment('KILL unknown')).toBe(true))
    expect(screen.getByText('HEALTH unavailable')).toBeTruthy()
    expect(document.body.textContent).not.toContain('API DOWN')
  })

  it('shows the watch it is given after the context segments, and no WATCH segment without one', async () => {
    // A fresh Response per call: a body can be read once, and this test makes two mounts.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(HEALTH))
    const view: RecordWatchView = { state: 'clean', diff: emptyDiff(0), since: '20 Sept, 10:00', menu: () => null, accept: () => null }
    const first = mount(<LiveStatusBar screen="HOME" watch={view} />)
    await waitFor(() => expect(hasSegment('KILL ON')).toBe(true))
    expect(hasSegment('WATCH no change')).toBe(true)
    first.unmount()
    mount(<LiveStatusBar screen="HOME" />)
    await waitFor(() => expect(hasSegment('KILL ON')).toBe(true))
    expect(document.body.textContent).not.toContain('WATCH')
  })
})

describe('useHealthState', () => {
  it('is loading before the first answer, then the served health, then error on a failed poll', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(HEALTH)).mockResolvedValue(json({ detail: 'down' }, 503))
    const seen: string[] = []
    function Probe() {
      seen.push(useHealthState().status)
      return null
    }
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    render(
      <ApiProvider client={client}>
        <Probe />
      </ApiProvider>,
    )
    await waitFor(() => expect(seen).toContain('ok'))
    await client.refetchQueries()
    await waitFor(() => expect(seen).toContain('error'))
    expect(seen[0]).toBe('loading')
  })
})
