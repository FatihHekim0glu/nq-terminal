// @vitest-environment jsdom
// LIVE's IB snapshot panel (PRD U3): a read-only, labelled view of GET /api/ib/snapshot with a clear state for off,
// unreachable, refused, stale, failed and live, no control that could act on an instruction, and the status line's TWS
// value following whether the snapshot is live.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../../api/ApiProvider'
import { IB } from '../../../copy/ib'
import { fillCopy } from '../../../copy/workspace'
import {
  DISABLED_SNAPSHOT,
  INCOMPLETE_SNAPSHOT,
  LIVE_SNAPSHOT,
  NOW_FRESH_MS,
  NOW_STALE_MS,
  REFUSED_SNAPSHOT,
  UNAVAILABLE_SNAPSHOT,
} from './ibSnapshot.fixtures'
import { setIbSnapshotLive, useIbSnapshotLive } from './ibLiveStore'
import IbSnapshotPanel, { IbSnapshotView } from './IbSnapshotPanel'
import { STALE_AFTER_MS, formatAge } from './ibSnapshotModel'
import type { IbSnapshot } from './ibTypes'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  act(() => setIbSnapshotLive(false))
})

const view = (snapshot: IbSnapshot | null, nowMs = NOW_FRESH_MS, failed = false, detail: string | null = null) =>
  render(<IbSnapshotView snapshot={snapshot} failed={failed} detail={detail} nowMs={nowMs} />)

describe('IbSnapshotView states', () => {
  it('loading: says so, as a busy status, and shows no table', () => {
    view(null)
    const busy = screen.getByText(IB.loading)
    expect(busy.getAttribute('role')).toBe('status')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('error: an alert with the reason, no table', () => {
    view(null, NOW_FRESH_MS, true, 'HTTP 500')
    expect(screen.getByRole('alert').textContent).toBe(fillCopy(IB.loadError, { detail: 'HTTP 500' }))
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('disabled: names NQT_IB_READONLY, carries the server message and shows no account, no table', () => {
    view(DISABLED_SNAPSHOT)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain('IB snapshot off (NQT_IB_READONLY not set)')
    expect(state.textContent).toContain(DISABLED_SNAPSHOT.message)
    expect(screen.queryAllByRole('table')).toHaveLength(0)
    expect(screen.queryByText(/Net liquidation/)).toBeNull()
  })

  it('disabled in the desktop app: names the Options switch, not the variable, and drops the backend message', () => {
    render(<IbSnapshotView snapshot={DISABLED_SNAPSHOT} failed={false} detail={null} nowMs={NOW_FRESH_MS} shellIbSnapshot={false} />)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain(IB.stateOffDesktop)
    expect(state.textContent).toContain('Options')
    expect(state.textContent).toContain('IB snapshot (read only)')
    expect(state.textContent).not.toContain('NQT_IB_READONLY')
    expect(state.textContent).not.toContain(DISABLED_SNAPSHOT.message)
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('disabled while the app has it on: says the backend was attached, not started by this app', () => {
    render(<IbSnapshotView snapshot={DISABLED_SNAPSHOT} failed={false} detail={null} nowMs={NOW_FRESH_MS} shellIbSnapshot />)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain(IB.stateOffAttached)
    expect(state.textContent).toMatch(/attached, not started by this app/)
    expect(state.textContent).not.toContain('NQT_IB_READONLY')
  })

  it('disabled in a browser keeps the variable wording and the backend message', () => {
    render(<IbSnapshotView snapshot={DISABLED_SNAPSHOT} failed={false} detail={null} nowMs={NOW_FRESH_MS} shellIbSnapshot={null} />)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain(IB.stateOff)
    expect(state.textContent).toContain(DISABLED_SNAPSHOT.message)
  })

  it('unavailable: says TWS not reachable with the server message, no table', () => {
    view(UNAVAILABLE_SNAPSHOT)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain('TWS not reachable')
    expect(state.textContent).toContain('No TWS or IB Gateway answered on 127.0.0.1:7497 in time.')
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('refused: says a guard stopped the read, with the server message, no table', () => {
    view(REFUSED_SNAPSHOT)
    const state = screen.getByRole('status')
    expect(state.textContent).toContain(IB.stateRefused)
    expect(state.textContent).toContain('the port 7496 is a live port')
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('live: says when it was read and is not marked stale', () => {
    view(LIVE_SNAPSHOT)
    expect(screen.getByRole('status').textContent).toBe(IB.stateLiveWord)
    expect(screen.getByRole('region', { name: IB.title }).textContent).toContain(`${IB.stateLiveWord}: ${fillCopy(IB.stateLiveAge, { age: '8 s' })}`)
    expect(screen.queryByText(/STALE/)).toBeNull()
  })

  it('live: the status region holds only the state, so the ticking age is not announced every tick', () => {
    const { rerender } = view(LIVE_SNAPSHOT, NOW_FRESH_MS)
    const before = screen.getByRole('status').textContent
    rerender(<IbSnapshotView snapshot={LIVE_SNAPSHOT} failed={false} detail={null} nowMs={NOW_FRESH_MS + 10_000} />)
    expect(screen.getByRole('status').textContent).toBe(before)
    expect(screen.getByRole('status').textContent).not.toMatch(/\d/)
    expect(screen.getByRole('region', { name: IB.title }).textContent).toContain(fillCopy(IB.stateLiveAge, { age: '18 s' }))
    expect(screen.getByRole('region', { name: IB.title }).querySelectorAll('[aria-live]')).toHaveLength(0)
  })

  it('stale: the status region holds only the state, the ticking age sits outside it', () => {
    const { rerender } = view(LIVE_SNAPSHOT, NOW_STALE_MS)
    const before = screen.getByRole('status').textContent
    rerender(<IbSnapshotView snapshot={LIVE_SNAPSHOT} failed={false} detail={null} nowMs={NOW_STALE_MS + 10_000} />)
    expect(screen.getByRole('status').textContent).toBe(before)
    expect(screen.getByRole('status').textContent).not.toMatch(/\d/)
  })

  it('stale: says STALE with the age and the limit, and keeps the last values on screen', () => {
    view(LIVE_SNAPSHOT, NOW_STALE_MS)
    const state = screen.getByRole('status')
    expect(state.textContent).toBe(IB.stateStaleWord)
    const region = screen.getByRole('region', { name: IB.title })
    expect(region.textContent).toContain(`${IB.stateStaleWord}: ${fillCopy(IB.stateStaleAge, { age: '5 min', limit: formatAge(STALE_AFTER_MS) })}`)
    expect(region.textContent).toContain(IB.stateStaleNote)
    expect(screen.getAllByRole('table')).toHaveLength(3)
  })

  it('a failed later read over an earlier body is stale and says the read failed', () => {
    view(LIVE_SNAPSHOT, NOW_FRESH_MS, true, 'network down')
    const state = screen.getByRole('status')
    expect(state.textContent).toContain(IB.stateStaleWord)
    expect(screen.getByRole('region', { name: IB.title }).textContent).toContain(IB.stateStaleFailed)
    expect(screen.getAllByRole('table')).toHaveLength(3)
  })
})

describe('IbSnapshotView live content', () => {
  it('is a labelled region with a READ ONLY tag and a heading', () => {
    view(LIVE_SNAPSHOT)
    const region = screen.getByRole('region', { name: IB.title })
    expect(within(region).getByRole('heading', { name: new RegExp(IB.readOnlyTag) })).toBeTruthy()
  })

  it('shows the masked account, net liquidation, both clocks and the client id', () => {
    view(LIVE_SNAPSHOT)
    const strip = screen.getByRole('list', { name: IB.stripLabel })
    expect(within(strip).getByText('DU*******')).toBeTruthy()
    expect(within(strip).getByText('1,000,482.55 USD')).toBeTruthy()
    expect(within(strip).getByText('14:02:00 UTC')).toBeTruthy()
    expect(within(strip).getByText('14:01:59 UTC')).toBeTruthy()
    expect(within(strip).getByText('95')).toBeTruthy()
  })

  it('masks a raw account id the server should not have sent', () => {
    view({ ...LIVE_SNAPSHOT, accounts_masked: ['DU1234567'] })
    expect(screen.queryByText('DU1234567')).toBeNull()
    expect(screen.getByText('DU*******')).toBeTruthy()
  })

  it('positions table: headers, signed quantities, average cost', () => {
    view(LIVE_SNAPSHOT)
    const table = screen.getByRole('table', { name: IB.positionsLabel })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      [IB.colSymbol, IB.colType, IB.colExchange, IB.colCurrency, IB.colExpiry, IB.colPosition, IB.colAvgCost])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('+6')).toBeTruthy()
    expect(within(rows[0]!).getByText('41,250.50')).toBeTruthy()
    expect(within(rows[1]!).getByText('-2')).toBeTruthy()
  })

  it('open orders table is titled view only and lists what TWS reported', () => {
    view(LIVE_SNAPSHOT)
    expect(screen.getByRole('heading', { name: IB.workingTitle })).toBeTruthy()
    const table = screen.getByRole('table', { name: IB.workingLabel })
    const row = within(table).getAllByRole('row')[1]!
    for (const text of ['MNQZ6', 'SELL', 'LMT', '21,900.25', 'Submitted']) expect(within(row).getByText(text)).toBeTruthy()
  })

  it("today's executions table lists the fills with the time TWS sent", () => {
    view(LIVE_SNAPSHOT)
    const table = screen.getByRole('table', { name: IB.executionsLabel })
    const row = within(table).getAllByRole('row')[1]!
    for (const text of ['20261001 09:59:31 US/Eastern', 'BOT', '21,850.50']) expect(within(row).getByText(text)).toBeTruthy()
  })

  it('empty lists say so instead of showing a bare table', () => {
    view({ ...LIVE_SNAPSHOT, positions: [], open_orders: [], executions: [] })
    expect(screen.getByText(IB.positionsEmpty)).toBeTruthy()
    expect(screen.getByText(IB.workingEmpty)).toBeTruthy()
    expect(screen.getByText(IB.executionsEmpty)).toBeTruthy()
  })

  it('says which sections TWS did not finish, that rows were cut, and the notes it sent', () => {
    view(INCOMPLETE_SNAPSHOT)
    const region = screen.getByRole('region', { name: IB.title })
    expect(region.textContent).toContain(fillCopy(IB.incomplete, { sections: 'executions' }))
    expect(region.textContent).toContain(IB.truncated)
    expect(region.textContent).toContain('Market data farm connection is OK:usfarm')
  })

  it('has no control at all: no button, link, input, select or form', () => {
    const { container } = view(LIVE_SNAPSHOT)
    expect(container.querySelectorAll('button, a, input, select, textarea, form, [role="button"]')).toHaveLength(0)
  })

  it('does not rely on colour alone: signs and words carry the side', () => {
    view(LIVE_SNAPSHOT)
    expect(screen.getByText('-2').textContent).toBe('-2')
    expect(screen.getByText('SELL')).toBeTruthy()
    expect(screen.getByText('BOT')).toBeTruthy()
  })
})

describe('IbSnapshotPanel (container)', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fresh = (over: Partial<IbSnapshot> = {}): IbSnapshot => ({ ...LIVE_SNAPSHOT, fetched_at_utc: new Date().toISOString(), ...over })
  const mount = () => render(<ApiProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IbSnapshotPanel /></ApiProvider>)
  function Probe() {
    return <p data-testid="live">{String(useIbSnapshotLive())}</p>
  }

  it('reads GET /api/ib/snapshot only, shows the live state and tells the status line', async () => {
    fetchSpy.mockResolvedValue(json(fresh()))
    const { unmount } = mount()
    await screen.findByRole('table', { name: IB.positionsLabel })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ib/snapshot')
    expect(init.method).toBe('GET')
    await waitFor(() => expect(screen.getByRole('region', { name: IB.title }).textContent).toContain('Live: read'))
    render(<Probe />)
    expect(screen.getByTestId('live').textContent).toBe('true')
    unmount()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('false'))
  })

  describe('a body read after the panel mounted is live, not stale', () => {
    const MOUNT_MS = Date.parse('2026-10-01T12:00:00Z')
    afterEach(() => vi.useRealTimers())

    it('when the clock moved on since the last tick', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(MOUNT_MS)
      fetchSpy.mockImplementation(async () => {
        vi.setSystemTime(MOUNT_MS + 4_000)
        return json(fresh({ fetched_at_utc: new Date(Date.now()).toISOString() }))
      })
      mount()
      await screen.findByRole('table', { name: IB.positionsLabel })
      expect(screen.getByRole('region', { name: IB.title }).textContent).toContain('Live: read')
      expect(screen.queryByText(/STALE/)).toBeNull()
      render(<Probe />)
      expect(screen.getByTestId('live').textContent).toBe('true')
    })

    it('when the server clock is ahead of the browser clock', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(MOUNT_MS)
      fetchSpy.mockImplementation(async () => json(fresh({ fetched_at_utc: new Date(MOUNT_MS + 120_000).toISOString() })))
      mount()
      await screen.findByRole('table', { name: IB.positionsLabel })
      expect(screen.queryByText(/STALE/)).toBeNull()
      render(<Probe />)
      expect(screen.getByTestId('live').textContent).toBe('true')
    })
  })

  it('a disabled body: the status line stays not monitored', async () => {
    fetchSpy.mockResolvedValue(json(DISABLED_SNAPSHOT))
    mount()
    await screen.findByText(/IB snapshot off/)
    render(<Probe />)
    expect(screen.getByTestId('live').textContent).toBe('false')
  })

  it('an unavailable or refused body never marks the status line live', async () => {
    fetchSpy.mockResolvedValue(json({ ...UNAVAILABLE_SNAPSHOT, fetched_at_utc: new Date().toISOString() }))
    mount()
    await screen.findByText(IB.stateUnreachable)
    render(<Probe />)
    expect(screen.getByTestId('live').textContent).toBe('false')
  })

  it('a stale body never marks the status line live', async () => {
    fetchSpy.mockResolvedValue(json({ ...LIVE_SNAPSHOT, cached: true, age_s: 120 }))
    mount()
    await screen.findByText(/STALE/)
    render(<Probe />)
    expect(screen.getByTestId('live').textContent).toBe('false')
  })

  it('an HTTP failure shows an alert and nothing is live', async () => {
    fetchSpy.mockResolvedValue(json({ detail: 'ib snapshot broke' }, 500))
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('ib snapshot broke')
  })

  it('a reply in the wrong shape is refused with the shape message', async () => {
    fetchSpy.mockResolvedValue(json({ hello: 'world' }))
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(IB.badBody)
  })
})
