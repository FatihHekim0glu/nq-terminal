// @vitest-environment jsdom
// v04 w1 home-window (startup.md 7.3): the run list belongs to GP's Fills picker only, and HOME's ready condition does
// not wait for it, so GP asks useGpData to defer /api/runs (deferRuns) until the picker is opened or a run is already
// chosen (the picker shows its name). A caller that does not defer (the DES preview, the demo's read check) asks at mount as before. The record watch's reader asks once the page has gone quiet and shares the cache entry, so
// the picker's list is usually there before it is opened. Before 0.3.4 GP asked at mount, which put the cold run index
// (1.06 s on a first launch) inside the HOME window.
import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { useGpData, type GpRequest } from './useGpData'
import { rangeWindow } from './model'

const RUNS = [{ run_id: 'nt_volmanaged_v0_fixture_m1' }, { run_id: 'nt_dtsmom_v0_fixture_ts1' }]
/** Long enough for any mount-time request to have been sent. */
const SETTLE_MS = 1200

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let urls: string[] = []

function serve() {
  urls = []
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    urls.push(`${url.pathname}${url.search}`)
    return url.pathname === '/api/runs' ? json(RUNS) : json({ detail: 'not found' }, 404)
  })
}

function request(over: Partial<GpRequest> = {}): GpRequest {
  return { root: 'NQ', symbol: 'NQ.V.0', tf: '1d', variant: 'vendor', window: rangeWindow('Max'), runId: null, ...over }
}

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client: QueryClient = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return ({ children }) => createElement(ApiProvider, { client, children })
}

const runRequests = () => urls.filter((u) => u.startsWith('/api/runs') && !u.includes('/fills'))

afterEach(() => vi.restoreAllMocks())

describe('useGpData: the run list for the Fills picker', () => {
  it('born failing: asks for no run list at mount, and none later while the request defers it', async () => {
    serve()
    const { result } = renderHook(() => useGpData(request({ deferRuns: true })), { wrapper: wrapper() })
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/bars'))).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    expect(runRequests()).toEqual([])
    expect(result.current.runs).toEqual([])
  })

  it('shows the list another reader (the record watch) loaded into the shared cache entry, without asking itself', async () => {
    serve()
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    const shared = ({ children }: { children: ReactNode }) => createElement(ApiProvider, { client, children })
    const { result } = renderHook(() => useGpData(request({ deferRuns: true })), { wrapper: shared })
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/bars'))).toBe(true))
    client.setQueryData(['api', '/api/runs', {}], RUNS)
    await waitFor(() => expect(result.current.runs).toEqual(['nt_volmanaged_v0_fixture_m1', 'nt_dtsmom_v0_fixture_ts1']))
    expect(runRequests()).toEqual([])
  })

  it('regression guard: asks at once when the request does not defer it (the picker is open, or a caller that never deferred; cannot fail on the 0.3.3 tree)', async () => {
    serve()
    const { result } = renderHook(() => useGpData(request()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.runs).toHaveLength(2), { timeout: 400 })
    expect(runRequests()).toEqual(['/api/runs'])
  })

  it('regression guard: asks at once when a run is already chosen, so the picker can name it', async () => {
    serve()
    const { result } = renderHook(() => useGpData(request({ deferRuns: true, runId: 'nt_volmanaged_v0_fixture_m1' })), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.runs).toHaveLength(2), { timeout: 400 })
    expect(runRequests()).toEqual(['/api/runs'])
  })

  it('regression guard: asks once, not once per render, and the shared query key is the one the other screens use', async () => {
    serve()
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    const shared = ({ children }: { children: ReactNode }) => createElement(ApiProvider, { client, children })
    const { rerender } = renderHook(() => useGpData(request()), { wrapper: shared })
    await waitFor(() => expect(client.getQueryData(['api', '/api/runs', {}])).toBeDefined(), { timeout: 400 })
    rerender()
    rerender()
    expect(runRequests()).toEqual(['/api/runs'])
  })
})
