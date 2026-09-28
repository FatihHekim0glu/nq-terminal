// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { INITIAL_CONNECTION, connectionStore, nextConnection, resetConnection, type ConnectionState } from './connection'
import {
  LIVE_POLL_MS,
  apiQueryKey,
  createApiQueryClient,
  shouldRetry,
  useApiQuery,
  useHealth,
  useHypothesisSeries,
  useInstrument,
  useLiveRoutes,
  useLiveStatus,
  useMarketRv,
  useRun,
  useRunLog,
  useTwoDay,
} from './queries'

afterEach(cleanup)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function wrapper() {
  const client = createApiQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function urls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]))
}

describe('query keys', () => {
  it('are stable and scoped by path and request', () => {
    expect(apiQueryKey('/api/health')).toEqual(['api', '/api/health', {}])
    expect(apiQueryKey('/api/runs/{run_id}', { path: { run_id: 'a' } })).toEqual([
      'api',
      '/api/runs/{run_id}',
      { path: { run_id: 'a' } },
    ])
  })
})

describe('hooks', () => {
  it('useHealth GETs /api/health and returns the body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ kill_switch_on: true }))
    const { result } = renderHook(() => useHealth(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.kill_switch_on).toBe(true)
    expect(urls(spy)).toEqual(['/api/health'])
  })

  it('does not fetch while a required id is empty (no context in the link group yet)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}))
    const { result } = renderHook(() => useRun(''), { wrapper: wrapper() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current.fetchStatus).toBe('idle')
    expect(spy).not.toHaveBeenCalled()
  })

  it('passes path and query parameters (run log page, hypothesis series cost)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ items: [] }))
    const run = renderHook(() => useRunLog('nt_x', 'decisions', { offset: 500, limit: 500 }), { wrapper: wrapper() })
    const hyp = renderHook(() => useHypothesisSeries('za_v0', 1), { wrapper: wrapper() })
    await waitFor(() => expect(run.result.current.isSuccess && hyp.result.current.isSuccess).toBe(true))
    expect(urls(spy).sort()).toEqual(['/api/hypotheses/za_v0/series?cost=1', '/api/runs/nt_x/log/decisions?offset=500&limit=500'])
  })

  it('reads the Phase 8 routes with their parameters (instrument, RV line, two-day, live routes)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}))
    const hooks = [
      renderHook(() => useInstrument('ZN'), { wrapper: wrapper() }),
      renderHook(() => useMarketRv('NQ.V.0', 22), { wrapper: wrapper() }),
      renderHook(() => useTwoDay(['NQ.V.0']), { wrapper: wrapper() }),
      renderHook(() => useLiveRoutes(), { wrapper: wrapper() }),
    ]
    await waitFor(() => expect(hooks.every((h) => h.result.current.isSuccess)).toBe(true))
    expect(urls(spy).sort()).toEqual([
      '/api/instruments/ZN',
      '/api/live/routes',
      '/api/market/rv?symbol=NQ.V.0&window=22',
      '/api/market/two-day?symbols=NQ.V.0',
    ])
  })

  it('asks for nothing while the instrument, RV symbol or two-day list is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}))
    renderHook(() => useInstrument(''), { wrapper: wrapper() })
    renderHook(() => useMarketRv('', 22), { wrapper: wrapper() })
    renderHook(() => useTwoDay([]), { wrapper: wrapper() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spy).not.toHaveBeenCalled()
  })

  it('surfaces a 404 as an ApiError without retrying', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'unknown run_id' }, 404))
    const { result } = renderHook(() => useApiQuery('/api/runs/{run_id}', { path: { run_id: 'nope' } }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.detail).toBe('unknown run_id')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('polls the live status every LIVE_POLL_MS (ARCHITECTURE section 4: 2 s in P0)', async () => {
    expect(LIVE_POLL_MS).toBe(2000)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ journals: [] }))
      const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper() })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2 + 50)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3)
      expect(new Set(urls(spy))).toEqual(new Set(['/api/live/status']))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the same arrays across a live poll whose values did not change, so a chart is not rebuilt', async () => {
    // CandleChart and LineStack rebuild when their arrays change identity; structural sharing (on by
    // default, and no `select` here) must hand back the previous objects when a poll brings equal data.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let poll = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        poll += 1
        return jsonResponse({ journals: [{ name: 'a', t: [1, 2, 3] }], poll: poll > 2 ? 'changed' : 'same' })
      })
      const { result } = renderHook(() => useLiveStatus(), { wrapper: wrapper() })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      const first = result.current.data as unknown as { journals: unknown[] }
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)
      await waitFor(() => expect(poll).toBeGreaterThanOrEqual(2))
      expect(result.current.data).toBe(first)
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)
      await waitFor(() => expect((result.current.data as unknown as { poll: string }).poll).toBe('changed'))
      // A change elsewhere in the body leaves the unchanged array itself as it was.
      expect((result.current.data as unknown as { journals: unknown[] }).journals).toBe(first.journals)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the loopback backend keeps working when the browser reports offline (D27)', () => {
  afterEach(() => onlineManager.setOnline(true))

  it('sets networkMode always, so react-query never pauses a fetch on the browser online flag', () => {
    expect(createApiQueryClient().getDefaultOptions().queries?.networkMode).toBe('always')
  })

  it('defaults refetchOnReconnect to false (v2 fix 2: the connection supervisor is the only recovery path, never doubled by a plain reconnect refetch)', () => {
    expect(createApiQueryClient().getDefaultOptions().queries?.refetchOnReconnect).toBe(false)
  })

  it('keeps polling health every LIVE_POLL_MS while the browser reports offline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ kill_switch_on: false }))
      const { result } = renderHook(() => useHealth(), { wrapper: wrapper() })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      onlineManager.setOnline(false)
      spy.mockClear()
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2 + 50)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(result.current.fetchStatus).not.toBe('paused')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useHealth (connection state machine, roadmap #7)', () => {
  const outage = (status = 502) => new ApiError({ kind: 'http', path: '/api/health', status, body: null, detail: `${status}` })

  afterEach(() => {
    onlineManager.setOnline(true)
    resetConnection()
  })

  it('never retries a failed health check (its own interval already backs off)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'unavailable' }, 503))
    const { result } = renderHook(() => useHealth(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('always attempts the health check, even while onlineManager reports offline (networkMode always)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ kill_switch_on: false }))
      // The client's own default is 'online' here, so only useHealth's own networkMode: 'always' keeps
      // the check running; the client default of 'always' (D27, pinned above) would let this pass
      // even if useHealth lost its own override.
      const client = new QueryClient({ defaultOptions: { queries: { networkMode: 'online', retry: false, refetchOnWindowFocus: false } } })
      const onlineWrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => useHealth(), { wrapper: onlineWrapper })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      onlineManager.setOnline(false)
      spy.mockClear()
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2 + 50)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(result.current.fetchStatus).not.toBe('paused')
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls every 2000 ms while not down, then backs off to 4000 ms as soon as the connection goes down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ kill_switch_on: false }))
      renderHook(() => useHealth(), { wrapper: wrapper() })
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(2000 + 50)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)

      // Drives the shared connection store down directly (three consecutive outage failures);
      // useHealthInterval reads this store, independently of this hook's own query client.
      let state: ConnectionState = INITIAL_CONNECTION
      for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: outage() })
      connectionStore.setState(state, true)

      spy.mockClear()
      await vi.advanceTimersByTimeAsync(2000 + 50)
      expect(spy).not.toHaveBeenCalled() // still inside the 4000 ms backoff window, not the old 2000 ms one
      await vi.advanceTimersByTimeAsync(2000 + 50)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('retry policy', () => {
  const http = (status: number) => new ApiError({ kind: 'http', path: '/api/x', status, detail: 'x' })

  it('retries a network failure or a 5xx once, never a 4xx, a refusal or a decode error', () => {
    expect(shouldRetry(0, new ApiError({ kind: 'network', path: '/api/x', detail: 'x' }))).toBe(true)
    expect(shouldRetry(0, http(503))).toBe(true)
    expect(shouldRetry(1, http(503))).toBe(false)
    expect(shouldRetry(0, http(404))).toBe(false)
    expect(shouldRetry(0, http(403))).toBe(false)
    expect(shouldRetry(0, new ApiError({ kind: 'refused', path: '/x', detail: 'x' }))).toBe(false)
    expect(shouldRetry(0, new ApiError({ kind: 'decode', path: '/api/x', status: 200, detail: 'x' }))).toBe(false)
    expect(shouldRetry(0, new Error('other'))).toBe(false)
  })
})
