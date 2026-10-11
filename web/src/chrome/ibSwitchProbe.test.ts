// @vitest-environment jsdom
// The Options probe: does the backend read TWS right now. Only a fresh, well-formed ok snapshot counts; nothing is
// requested when the probe is not enabled, and it asks once and never polls.
import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { DISABLED_SNAPSHOT, LIVE_SNAPSHOT } from '../screens/live/ib/ibSnapshot.fixtures'
import { ibViewState, readIbSnapshot } from '../screens/live/ib/ibSnapshotModel'
import { REFUSED_SNAPSHOT, UNAVAILABLE_SNAPSHOT } from '../screens/live/ib/ibSnapshot.fixtures'
import { isFreshOkSnapshot, useBackendReadsTws } from './ibSwitchProbe'

const fetchSpy = vi.fn()
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ApiProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }), children })

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('useBackendReadsTws', () => {
  it('is false and sends nothing when not enabled', async () => {
    const { result } = renderHook(() => useBackendReadsTws(false), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is false before the answer and true for a fresh ok snapshot', async () => {
    fetchSpy.mockImplementation(async () => json({ ...LIVE_SNAPSHOT, fetched_at_utc: new Date().toISOString() }))
    const { result } = renderHook(() => useBackendReadsTws(true), { wrapper })
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('is false for the disabled body the server answers when IB is not set', async () => {
    fetchSpy.mockImplementation(async () => json(DISABLED_SNAPSHOT))
    const { result } = renderHook(() => useBackendReadsTws(true), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current).toBe(false)
  })
})

// The probe's rule is written out beside the LIVE panel's (see ibSwitchProbe.ts for why); this pins them together.
describe("isFreshOkSnapshot agrees with the LIVE panel's own judgement", () => {
  const RECEIVED = Date.parse('2026-10-01T14:02:10Z')
  const cached = (age: number) => ({ ...LIVE_SNAPSHOT, cached: true, age_s: age })
  const bodies: ReadonlyArray<readonly [string, unknown]> = [
    ['ok, fresh', LIVE_SNAPSHOT],
    ['ok, cached 29 s', cached(29)],
    ['ok, cached 30 s', cached(30)],
    ['ok, cached 31 s', cached(31)],
    ['ok, no read time', { ...LIVE_SNAPSHOT, fetched_at_utc: null }],
    ['ok, unreadable read time', { ...LIVE_SNAPSHOT, fetched_at_utc: 'not a time' }],
    ['ok, negative age', { ...LIVE_SNAPSHOT, age_s: -5 }],
    ['ok, age not a number', { ...LIVE_SNAPSHOT, age_s: 'soon' }],
    ['ok, a list missing', { ...LIVE_SNAPSHOT, positions: undefined }],
    ['ok, no message', { ...LIVE_SNAPSHOT, message: undefined }],
    ['disabled', DISABLED_SNAPSHOT],
    ['unavailable', UNAVAILABLE_SNAPSHOT],
    ['refused', REFUSED_SNAPSHOT],
    ['unknown state', { ...LIVE_SNAPSHOT, state: 'connected' }],
    ['not an object', 'ok'],
    ['null', null],
  ]
  it.each(bodies)('%s', (_name, body) => {
    for (const lateMs of [0, 1_000, 29_000, 31_000, 120_000]) {
      const now = RECEIVED + lateMs
      const snapshot = readIbSnapshot(body)
      const model = ibViewState(snapshot, snapshot === null, now, RECEIVED) === 'live'
      expect(isFreshOkSnapshot(body, now, RECEIVED)).toBe(model)
    }
  })
})
