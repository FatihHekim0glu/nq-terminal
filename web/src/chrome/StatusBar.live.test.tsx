// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { useLinkGroups } from '../state/linkGroups'
import { LiveContextStrip } from './ContextStrip.live'
import { LiveStatusBar } from './StatusBar.live'

afterEach(() => {
  cleanup()
  useLinkGroups.getState().clearAll()
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
