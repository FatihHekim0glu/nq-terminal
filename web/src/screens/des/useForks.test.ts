// @vitest-environment jsdom
// forkRequestPath names, for GRAB's caption, the GET a fork sends. It is built from the same request shapes
// as the hook (screenRequest and runRequest), so the test runs the hook against a stubbed fetch and compares
// the URLs byte for byte.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { createApiQueryClient } from '../../api/queries'
import { HYP_ANALYTICS } from '../tear/tearP1.fixtures'
import type { ForkSpec } from './forkModel'
import { forkRequestPath, useForkPoints } from './useForks'

const screenFork = (cost: number | null, name = 'volmanaged_v0'): ForkSpec => ({
  id: `screen:${cost}`, engine: 'screen', name, cost, freq: null, basis: 'A', registered: false, flags: [],
})
const runFork = (freq: 'D' | 'M' | null, name = 'nt_volmanaged_v0_fixture_m1'): ForkSpec => ({
  id: `run:${name}:${freq}`, engine: 'run', name, cost: null, freq, basis: 'B', registered: false, flags: [],
})

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(HYP_ANALYTICS), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})
afterEach(() => {
  cleanup()
  fetchSpy.mockRestore()
})

describe('forkRequestPath', () => {
  it('names a screen fork at its recorded cost, keeping a zero cost', () => {
    expect(forkRequestPath(screenFork(1))).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1')
    expect(forkRequestPath(screenFork(0))).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=0')
    expect(forkRequestPath(screenFork(2))).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=2')
  })

  it('leaves the query out for a screen fork without a cost', () => {
    expect(forkRequestPath(screenFork(null))).toBe('/api/analytics/hypothesis/volmanaged_v0')
  })

  it('names a run fork at its frequency, daily when it has none', () => {
    expect(forkRequestPath(runFork('D'))).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
    expect(forkRequestPath(runFork('M'))).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=M')
    expect(forkRequestPath(runFork(null))).toBe('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
  })

  it('encodes the name as one path segment and refuses one that climbs out of the route', () => {
    expect(forkRequestPath(runFork('D', 'a b/c'))).toBe('/api/analytics/run/a%20b%2Fc?freq=D')
    expect(() => forkRequestPath(screenFork(1, '..'))).toThrow(ApiError)
  })

  it('equals, byte for byte, the request useForkPoints sends for each fork', async () => {
    const specs = [screenFork(0), screenFork(1), screenFork(null), runFork('D'), runFork('M')]
    const client = createApiQueryClient()
    const wrapper = ({ children }: { readonly children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useForkPoints(specs), { wrapper })
    await waitFor(() => expect(result.current.every((p) => p.sharpe !== null)).toBe(true))
    const sent = fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]))
    expect([...sent].sort()).toEqual(specs.map(forkRequestPath).sort())
  })
})
