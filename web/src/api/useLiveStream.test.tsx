// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiQueryKey } from './queries'
import { LIVE_DERIVED_PATHS, liveEventEffect, liveStreamHub, useLivePollInterval, useLiveStream } from './useLiveStream'

class FakeSource {
  static made: FakeSource[] = []
  readyState = 0
  closed = false
  onerror: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSource.made.push(this)
  }
  addEventListener(type: string, fn: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close(): void {
    this.closed = true
    this.readyState = 2
  }
  emit(kind: string, data: unknown): void {
    this.readyState = 1
    for (const fn of this.listeners.get(kind) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

const HELLO = {
  kind: 'hello', schema_version: 1, resumed: false, resume_note: null, poll_s: 1, heartbeat_s: 10, lifetime_s: 120,
  retry_ms: 2000, banner: 'b', basis: 'rows', read_only: true, order_path: 'none',
}

function Probe({ label }: { readonly label: string }) {
  const state = useLiveStream()
  const poll = useLivePollInterval()
  return <p>{`${label} ${state.mode} ${String(poll)}`}</p>
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  FakeSource.made = []
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeSource)
})

afterEach(() => {
  cleanup()
  liveStreamHub.reset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('liveEventEffect', () => {
  it('puts a status event straight into the status query and refreshes nothing', () => {
    const status = { kill_switch_on: true }
    expect(liveEventEffect({ kind: 'status', status } as never)).toEqual({ status, refresh: false })
  })

  it.each(['journal_row', 'journal_reset', 'kill_switch'])('refreshes the journal views on %s', (kind) => {
    expect(liveEventEffect({ kind } as never)).toEqual({ status: null, refresh: true })
  })

  it.each(['heartbeat', 'bye'])('does nothing on %s', (kind) => {
    expect(liveEventEffect({ kind } as never)).toEqual({ status: null, refresh: false })
  })

  it('refreshes after a hello that did not resume (a fresh connection may have missed rows)', () => {
    expect(liveEventEffect({ ...HELLO, resumed: false } as never).refresh).toBe(true)
    expect(liveEventEffect({ ...HELLO, resumed: true } as never).refresh).toBe(false)
  })
})

describe('useLiveStream', () => {
  it('opens one stream for every screen that wants it and stops polling once it is open', () => {
    const client = new QueryClient()
    render(<><Probe label="live" /><Probe label="jrnl" /></>, { wrapper: wrapper(client) })
    expect(FakeSource.made).toHaveLength(1)
    expect(FakeSource.made[0]!.url).toBe('/api/live/stream')
    expect(screen.getByText('live connecting false')).toBeTruthy()
    act(() => FakeSource.made[0]!.emit('hello', HELLO))
    expect(screen.getByText('live open false')).toBeTruthy()
    expect(screen.getByText('jrnl open false')).toBeTruthy()
  })

  it('writes the streamed status into the query cache', () => {
    const client = new QueryClient()
    render(<Probe label="live" />, { wrapper: wrapper(client) })
    const status = { kill_switch_on: true, journals: [] }
    act(() => {
      FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: true })
      FakeSource.made[0]!.emit('status', { kind: 'status', status })
    })
    expect(client.getQueryData(apiQueryKey('/api/live/status'))).toEqual(status)
  })

  it('refreshes the journal-derived queries once after a burst of rows', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    render(<Probe label="live" />, { wrapper: wrapper(client) })
    act(() => {
      FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: true })
      for (let i = 1; i <= 50; i++) FakeSource.made[0]!.emit('journal_row', { kind: 'journal_row', row: { file: 'a', line_no: i } })
    })
    expect(spy).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    expect(spy).toHaveBeenCalledTimes(1)
    const filters = spy.mock.calls[0]![0] as { predicate: (q: { queryKey: readonly unknown[] }) => boolean }
    for (const path of LIVE_DERIVED_PATHS) expect(filters.predicate({ queryKey: ['api', path, {}] })).toBe(true)
    expect(filters.predicate({ queryKey: ['api', '/api/live/status', {}] })).toBe(false)
    expect(filters.predicate({ queryKey: ['api', '/api/runs', {}] })).toBe(false)
  })

  it('keeps the stream across a quick screen swap and closes it once nothing wants it', () => {
    const client = new QueryClient()
    const view = render(<Probe label="live" />, { wrapper: wrapper(client) })
    view.rerender(<Probe label="jrnl" key="other" />)
    expect(FakeSource.made).toHaveLength(1)
    view.unmount()
    expect(FakeSource.made[0]!.closed).toBe(false)
    act(() => vi.advanceTimersByTime(2000))
    expect(FakeSource.made[0]!.closed).toBe(true)
    expect(liveStreamHub.getSnapshot().mode).toBe('off')
  })

  it('still refreshes a burst that lands just before the stream closes on the last unmount', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const view = render(<Probe label="live" />, { wrapper: wrapper(client) })
    act(() => FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: true }))
    view.unmount()
    act(() => vi.advanceTimersByTime(900))
    act(() => FakeSource.made[0]!.emit('journal_row', { kind: 'journal_row', row: { file: 'a', line_no: 1 } }))
    expect(spy).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(150))
    expect(FakeSource.made[0]!.closed).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('polls where the browser has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined)
    render(<Probe label="live" />, { wrapper: wrapper(new QueryClient()) })
    expect(screen.getByText('live polling 2000')).toBeTruthy()
  })

  it('does not refresh on a kill_switch resend of the same value (D29: undoes the resumed-hello optimisation)', () => {
    // The server resends kill_switch on every opening, even when nothing changed (StreamSession's
    // _kill starts at None each connection, so _kill_events always emits once). A resumed hello
    // deliberately does not refresh; the redundant kill_switch that follows it must not either.
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    render(<Probe label="live" />, { wrapper: wrapper(client) })
    // The first connection establishes the baseline (kill off).
    act(() => {
      FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: false })
      FakeSource.made[0]!.emit('kill_switch', { kind: 'kill_switch', on: false })
    })
    act(() => vi.advanceTimersByTime(2000))
    spy.mockClear()

    // A planned renewal (StreamLimits.lifetime_s): the server answers a resumed hello (deliberately no
    // refresh) followed by the same kill_switch value as before (on: false), even though nothing changed.
    act(() => {
      FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: true })
      FakeSource.made[0]!.emit('kill_switch', { kind: 'kill_switch', on: false })
      FakeSource.made[0]!.emit('status', { kind: 'status', status: { kill_switch_on: false } })
    })
    act(() => vi.advanceTimersByTime(2000))
    expect(spy).not.toHaveBeenCalled()

    // A genuine flip of the kill switch still refreshes.
    act(() => FakeSource.made[0]!.emit('kill_switch', { kind: 'kill_switch', on: true }))
    act(() => vi.advanceTimersByTime(2000))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refreshes on the first kill_switch value ever seen (nothing to compare it against yet)', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    render(<Probe label="live" />, { wrapper: wrapper(client) })
    act(() => {
      FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: false })
      FakeSource.made[0]!.emit('kill_switch', { kind: 'kill_switch', on: false })
    })
    act(() => vi.advanceTimersByTime(2000))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('useLivePollInterval (D30)', () => {
  it('re-renders only on a mode change, not on every streamed row or heartbeat', () => {
    // useLivePollInterval is called through useLive by every live hook (LIVE, JRNL, performance,
    // routes, tracking). Subscribing to the whole StreamSnapshot (as useLiveStreamState does) means
    // LiveStream.onMessage's patch (lastEventAt, rows) on every event re-renders every one of those
    // screen trees, even though the returned interval stays unchanged.
    let renders = 0
    function Opener() {
      useLiveStream()
      return null
    }
    function Counter() {
      useLivePollInterval()
      renders += 1
      return null
    }
    render(<><Opener /><Counter /></>, { wrapper: wrapper(new QueryClient()) })
    act(() => FakeSource.made[0]!.emit('hello', { ...HELLO, resumed: true }))
    const afterHello = renders
    // Each row is its own EventSource message (its own task), so each gets its own commit, as a real
    // backlog of streamed rows would.
    for (let i = 1; i <= 200; i++) {
      act(() => FakeSource.made[0]!.emit('journal_row', { kind: 'journal_row', row: { file: 'a', line_no: i } }))
    }
    expect(renders - afterHello).toBeLessThanOrEqual(1)
  })
})
