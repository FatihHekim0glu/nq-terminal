// @vitest-environment jsdom
import { onlineManager, QueryObserver, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { connectionStore, installConnectionSupervisor, resetConnection } from './connection'
import { createApiQueryClient } from './queries'
import { apiQueryKey } from './queryKey'

function outage(status = 502): ApiError {
  return new ApiError({ kind: 'http', path: '/api/health', status, body: null, detail: `${status}` })
}

/** A bare (non-React) observer: subscribing starts the query and keeps it "observed" (getObserversCount() > 0). */
function observe<T>(client: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<T>, extra: Record<string, unknown> = {}) {
  const observer = new QueryObserver(client, { queryKey, queryFn, retry: false, ...extra })
  const unsubscribe = observer.subscribe(() => undefined)
  return { observer, unsubscribe }
}

/** A health observer whose queryFn is swappable (mockResolvedValueOnce for a later recovery). */
function healthObserver(client: QueryClient) {
  const fn = vi.fn().mockRejectedValue(outage())
  const { observer } = observe(client, apiQueryKey('/api/health'), fn)
  return { observer, fn }
}

async function goDown(observer: QueryObserver): Promise<void> {
  await observer.refetch().catch(() => undefined)
  await observer.refetch().catch(() => undefined)
  await observer.refetch().catch(() => undefined)
  expect(connectionStore.getState().status).toBe('down')
}

describe('installConnectionSupervisor', () => {
  let client: QueryClient
  let uninstall: (() => void) | null = null
  let unsubscribers: Array<() => void> = []

  beforeEach(() => {
    resetConnection()
    client = createApiQueryClient()
    client.mount()
  })

  afterEach(() => {
    for (const unsub of unsubscribers.splice(0)) unsub()
    uninstall?.()
    uninstall = null
    client.unmount()
    client.clear()
    resetConnection()
  })

  it('goes down after three consecutive 502s and pauses only a query that opts into networkMode online', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health } = healthObserver(client)
    await goDown(health)
    expect(onlineManager.isOnline()).toBe(false)

    const pausedFn = vi.fn().mockResolvedValue({ ok: true })
    const { observer: paused, unsubscribe } = observe(client, apiQueryKey('/api/commands'), pausedFn, { networkMode: 'online' })
    unsubscribers.push(unsubscribe)

    expect(paused.getCurrentResult().fetchStatus).toBe('paused')
    expect(pausedFn).not.toHaveBeenCalled()
  })

  it('while down, a query on the client defaults (networkMode always, D27) is not paused', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health } = healthObserver(client)
    await goDown(health)
    expect(onlineManager.isOnline()).toBe(false)

    const fn = vi.fn().mockResolvedValue({ ok: true })
    const { observer, unsubscribe } = observe(client, apiQueryKey('/api/runs'), fn)
    unsubscribers.push(unsubscribe)

    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    expect(observer.getCurrentResult().fetchStatus).not.toBe('paused')
  })

  it('re-asserts offline on every failure while already down', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health } = healthObserver(client)
    await goDown(health)
    onlineManager.setOnline(true)
    expect(onlineManager.isOnline()).toBe(true)
    await health.refetch().catch(() => undefined)
    expect(onlineManager.isOnline()).toBe(false)
  })

  it('recovery sets online, counts and retries each errored observed api query exactly once, and invalidates /api/commands', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health, fn: healthFn } = healthObserver(client)
    await goDown(health)

    // An observed query that failed while down: its second call (from the recovery) succeeds.
    const erroredFn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true })
    const { observer: errored, unsubscribe: stopErrored } = observe(client, apiQueryKey('/api/runs'), erroredFn, { networkMode: 'always' })
    unsubscribers.push(stopErrored)
    await vi.waitFor(() => expect(errored.getCurrentResult().status).toBe('error'))

    // A successful stale query: the recovery must not refetch it.
    const okFn = vi.fn().mockResolvedValue({ ok: true })
    const { observer: ok, unsubscribe: stopOk } = observe(client, apiQueryKey('/api/registry'), okFn, {
      networkMode: 'always',
      staleTime: 0,
    })
    unsubscribers.push(stopOk)
    await vi.waitFor(() => expect(ok.getCurrentResult().status).toBe('success'))
    okFn.mockClear()

    // An unobserved command index entry, seeded directly: the recovery invalidates it by path, not by status.
    client.setQueryData(apiQueryKey('/api/commands'), { commands: [] })

    // Recovery.
    healthFn.mockResolvedValueOnce({ kill_switch_on: false })
    await health.refetch()

    expect(connectionStore.getState().status).toBe('ok')
    expect(connectionStore.getState().retried).toBe(1)
    expect(onlineManager.isOnline()).toBe(true)

    await vi.waitFor(() => expect(errored.getCurrentResult().status).toBe('success'))
    await new Promise((r) => setTimeout(r, 50))
    expect(erroredFn).toHaveBeenCalledTimes(2)
    expect(okFn).not.toHaveBeenCalled()

    const commands = client.getQueryCache().find({ queryKey: apiQueryKey('/api/commands') })
    expect(commands?.state.isInvalidated).toBe(true)
  })

  it('recovers through a non-outage failure (three 502s, a decode error, then ok)', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health, fn: healthFn } = healthObserver(client)
    await goDown(health)

    const erroredFn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true })
    const { observer: errored, unsubscribe: stopErrored } = observe(client, apiQueryKey('/api/runs'), erroredFn, { networkMode: 'always' })
    unsubscribers.push(stopErrored)
    await vi.waitFor(() => expect(errored.getCurrentResult().status).toBe('error'))

    healthFn.mockRejectedValueOnce(
      new ApiError({ kind: 'decode', path: '/api/health', status: 200, detail: 'the response was not valid JSON' }),
    )
    await health.refetch().catch(() => undefined)

    expect(onlineManager.isOnline()).toBe(true)
    expect(connectionStore.getState().status).toBe('degraded')
    expect(connectionStore.getState().recoveredAt).not.toBeNull()
    expect(connectionStore.getState().retried).toBe(1)

    await vi.waitFor(() => expect(errored.getCurrentResult().status).toBe('success'))
    await new Promise((r) => setTimeout(r, 50))
    expect(erroredFn).toHaveBeenCalledTimes(2)

    healthFn.mockResolvedValueOnce({ kill_switch_on: false })
    await health.refetch()
    expect(connectionStore.getState().status).toBe('ok')
    expect(erroredFn).toHaveBeenCalledTimes(2)
  })

  it('does not count an errored query whose observers are all disabled', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health, fn: healthFn } = healthObserver(client)
    await goDown(health)

    const detailKey = apiQueryKey('/api/hypotheses/{name}', { path: { name: 'x' } })
    const detailFn = vi.fn().mockRejectedValue(new Error('boom'))
    const { observer: detail, unsubscribe: stopDetail } = observe(client, detailKey, detailFn, { networkMode: 'always' })
    await vi.waitFor(() => expect(detail.getCurrentResult().status).toBe('error'))
    stopDetail()

    const { unsubscribe: stopDisabledDetail } = observe(client, detailKey, detailFn, { networkMode: 'always', enabled: false })
    unsubscribers.push(stopDisabledDetail)

    const erroredFn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true })
    const { observer: errored, unsubscribe: stopErrored } = observe(client, apiQueryKey('/api/runs'), erroredFn, { networkMode: 'always' })
    unsubscribers.push(stopErrored)
    await vi.waitFor(() => expect(errored.getCurrentResult().status).toBe('error'))

    healthFn.mockResolvedValueOnce({ kill_switch_on: false })
    await health.refetch()

    expect(connectionStore.getState().status).toBe('ok')
    expect(connectionStore.getState().retried).toBe(1)
  })

  it('uninstall unsubscribes (no further connection updates) and sets online true', async () => {
    uninstall = installConnectionSupervisor(client)
    const { observer: health } = healthObserver(client)
    await goDown(health)
    expect(onlineManager.isOnline()).toBe(false)

    uninstall()
    uninstall = null
    expect(onlineManager.isOnline()).toBe(true)

    const before = connectionStore.getState()
    await health.refetch().catch(() => undefined)
    expect(connectionStore.getState()).toEqual(before)
  })
})
