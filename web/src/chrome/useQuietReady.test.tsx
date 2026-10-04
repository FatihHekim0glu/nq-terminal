// @vitest-environment jsdom
// useQuietReady: the record watch's reader starts only once HOME's own queries have gone quiet (W5C, decision D5).
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuietReady } from './useQuietReady'

const QUIET_MS = 500
const MAX_WAIT_MS = 12_000

let client: QueryClient
let idleCallbacks: Array<() => void>

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** A query whose answer arrives after `ms` of fake time; one still pending when the client is cleared is dropped quietly. */
function slowQuery(key: string, ms: number): Promise<string> {
  return client
    .fetchQuery({ queryKey: [key], queryFn: () => new Promise<string>((resolve) => setTimeout(() => resolve(key), ms)), staleTime: 0 })
    .catch(() => 'cancelled')
}

/** Runs every idle callback the hook asked for, as the browser would at its idle moment. */
function fireIdle(): void {
  const waiting = idleCallbacks
  idleCallbacks = []
  act(() => waiting.forEach((callback) => callback()))
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  idleCallbacks = []
  Object.assign(window, {
    requestIdleCallback: (callback: () => void) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    },
    cancelIdleCallback: () => {},
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'requestIdleCallback')
  Reflect.deleteProperty(window, 'cancelIdleCallback')
})

describe('useQuietReady', () => {
  it('is not ready while a query is pending, even after 4 s of idle callbacks', async () => {
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    void slowQuery('home', 60_000)
    await advance(1)
    for (let second = 0; second < 4; second += 1) {
      await advance(1000)
      fireIdle()
    }
    expect(result.current).toBe(false)
  })

  it('is not ready before any query has settled, however quiet the page is', async () => {
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    await advance(QUIET_MS * 4)
    fireIdle()
    expect(result.current).toBe(false)
  })

  it('is ready after the query resolves, 500 ms of quiet and one idle callback', async () => {
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    void slowQuery('home', 200)
    await advance(200)
    expect(result.current).toBe(false)
    await advance(QUIET_MS - 1)
    fireIdle()
    expect(result.current).toBe(false)
    await advance(1)
    expect(result.current).toBe(false)
    expect(idleCallbacks).toHaveLength(1)
    fireIdle()
    expect(result.current).toBe(true)
  })

  it('restarts the quiet period when another fetch begins before the 500 ms are over', async () => {
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    void slowQuery('first', 50)
    await advance(50)
    await advance(QUIET_MS - 100)
    void slowQuery('second', 50)
    await advance(50)
    await advance(QUIET_MS - 100)
    expect(idleCallbacks).toHaveLength(0)
    await advance(100)
    fireIdle()
    expect(result.current).toBe(true)
  })

  it('is ready at 12 s even if a polling query keeps fetching', async () => {
    const observer = new QueryObserver(client, {
      queryKey: ['poll'],
      queryFn: () => new Promise<string>((resolve) => setTimeout(() => resolve('tick'), 300)),
      refetchInterval: 400,
      staleTime: 0,
    })
    const stop = observer.subscribe(() => {})
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    await advance(MAX_WAIT_MS - 1)
    expect(result.current).toBe(false)
    await advance(1)
    expect(result.current).toBe(true)
    stop()
  })

  it('stays true afterwards, whatever fetches follow', async () => {
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    await advance(MAX_WAIT_MS)
    expect(result.current).toBe(true)
    void slowQuery('late', 5000)
    await advance(1)
    expect(result.current).toBe(true)
    await advance(10_000)
    fireIdle()
    expect(result.current).toBe(true)
  })

  it('honours its own quiet period and ceiling', async () => {
    const { result } = renderHook(() => useQuietReady({ quietMs: 100, maxWaitMs: 1000 }), { wrapper })
    void slowQuery('home', 10)
    await advance(10)
    await advance(100)
    fireIdle()
    expect(result.current).toBe(true)
  })

  it('falls back to a timer where the browser has no idle callback', async () => {
    Reflect.deleteProperty(window, 'requestIdleCallback')
    Reflect.deleteProperty(window, 'cancelIdleCallback')
    const { result } = renderHook(() => useQuietReady(), { wrapper })
    void slowQuery('home', 10)
    await advance(10)
    await advance(QUIET_MS)
    expect(result.current).toBe(false)
    await advance(1000)
    expect(result.current).toBe(true)
  })
})
