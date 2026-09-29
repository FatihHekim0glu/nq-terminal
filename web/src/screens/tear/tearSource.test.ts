// @vitest-environment jsdom
// tearAnalyticsPath is the single source of the analytics GET path (W8 tearGrab and the dossier both name
// it as their source). It must equal, byte for byte, the request the tear sheet's own hook sends, so the
// test runs that hook against a stubbed fetch and compares the URLs.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { createApiQueryClient } from '../../api/queries'
import { HYP_ANALYTICS, RUN_ANALYTICS } from './tear.fixtures'
import { useTearAnalytics, type Freq, type TearTarget } from './tearQueries'
import { tearAnalyticsPath } from './tearSource'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/runs/')) return json({ summary: { strategy: 'x', balance_ok: true } })
    if (url.startsWith('/api/analytics/run/')) return json(RUN_ANALYTICS)
    return json(HYP_ANALYTICS)
  })
})
afterEach(() => {
  cleanup()
  fetchSpy.mockRestore()
})

const requested = (): string[] =>
  fetchSpy.mock.calls.map((call: unknown[]) => String(call[0])).filter((url: string) => url.startsWith('/api/analytics/'))

/** The analytics URL the tear sheet's own hook asks for. */
async function sentBy(target: TearTarget, freq: Freq, cost: number | null): Promise<string> {
  const client = createApiQueryClient()
  const wrapper = ({ children }: { readonly children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const { result } = renderHook(() => useTearAnalytics(target, freq, cost), { wrapper })
  await waitFor(() => expect(result.current.data).toBeDefined())
  const urls = requested()
  expect(urls).toHaveLength(1)
  return urls[0] ?? ''
}

describe('tearAnalyticsPath: the request the tear sheet sends', () => {
  it('names a run at its frequency, equal to the hook request for D and M', async () => {
    const target: TearTarget = { kind: 'run', name: 'nt_volmanaged_v0_fixture_m1' }
    const daily = tearAnalyticsPath(target, { cost: null, freq: 'D' })
    expect(daily).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
    expect(daily).toBe(await sentBy(target, 'D', null))
    fetchSpy.mockClear()
    cleanup()
    const monthly = tearAnalyticsPath(target, { cost: null, freq: 'M' })
    expect(monthly).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=M')
    expect(monthly).toBe(await sentBy(target, 'M', null))
  })

  it('names a hypothesis at its cost, equal to the hook request', async () => {
    const target: TearTarget = { kind: 'hypothesis', name: 'volmanaged_v0' }
    const path = tearAnalyticsPath(target, { cost: 1, freq: 'D' })
    expect(path).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1')
    expect(path).toBe(await sentBy(target, 'D', 1))
  })

  it('keeps a zero cost, which is a recorded cost and not a missing one', () => {
    expect(tearAnalyticsPath({ kind: 'hypothesis', name: 'volmanaged_v0' }, { cost: 0, freq: null })).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=0')
  })

  it('leaves the cost out for a hypothesis when none is known, and the frequency out for a run without one', () => {
    expect(tearAnalyticsPath({ kind: 'hypothesis', name: 'volmanaged_v0' }, { cost: null, freq: 'D' })).toBe('/api/analytics/hypothesis/volmanaged_v0')
    expect(tearAnalyticsPath({ kind: 'run', name: 'r1' }, { cost: 1, freq: null })).toBe('/api/analytics/run/r1')
  })

  it('ignores the setting that belongs to the other kind', () => {
    expect(tearAnalyticsPath({ kind: 'run', name: 'r1' }, { cost: 2, freq: 'M' })).toBe('/api/analytics/run/r1?freq=M')
    expect(tearAnalyticsPath({ kind: 'hypothesis', name: 'h1' }, { cost: 2, freq: 'M' })).toBe('/api/analytics/hypothesis/h1?cost=2')
  })

  it('reads the context an Analytics answer carries', () => {
    expect(tearAnalyticsPath({ kind: 'hypothesis', name: 'volmanaged_v0' }, HYP_ANALYTICS.context)).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1')
    expect(tearAnalyticsPath({ kind: 'run', name: 'nt_volmanaged_v0_fixture_m1' }, RUN_ANALYTICS.context)).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
  })

  it('encodes the name as one path segment', () => {
    expect(tearAnalyticsPath({ kind: 'run', name: 'a b/c?d' }, { cost: null, freq: 'D' })).toBe('/api/analytics/run/a%20b%2Fc%3Fd?freq=D')
  })

  it('refuses a name that would climb out of the route, and an empty name', () => {
    for (const name of ['..', '.', '']) {
      expect(() => tearAnalyticsPath({ kind: 'run', name }, { cost: null, freq: 'D' })).toThrow(ApiError)
    }
  })
})
