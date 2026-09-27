// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
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
