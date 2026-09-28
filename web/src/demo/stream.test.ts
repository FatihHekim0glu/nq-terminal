// The demo's live stream (src/demo/stream.ts): what the browser's EventSource would give LiveStream on the
// fixture backend, played on timers from the live bodies the demo serves (src/demo/data/live.ts). hello first, then status, then the journal rows,
// then a heartbeat every heartbeat_s; close() stops everything. Only the one stream route opens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveStream, type EventSourceLike, type StreamEvent } from '../api/liveStream'
import { demoLiveJournalRows, demoLiveStatus } from './data/live'
import { DEMO_STREAM, DemoEventSource } from './stream'

const KINDS = ['hello', 'status', 'kill_switch', 'journal_reset', 'journal_row', 'heartbeat', 'bye'] as const

interface Received {
  readonly kind: string
  readonly body: StreamEvent
  readonly id: string
}

/** Listens for every kind LiveStream listens for, as it does (addEventListener per kind). */
function record(source: EventSourceLike): Received[] {
  const got: Received[] = []
  for (const kind of KINDS) {
    source.addEventListener(kind, (event) => got.push({ kind: event.type, body: JSON.parse(event.data) as StreamEvent, id: event.lastEventId }))
  }
  return got
}

const kinds = (got: readonly Received[]) => got.map((r) => r.kind)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T14:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DemoEventSource on /api/live/stream', () => {
  it('is connecting at first, then opens and says hello with its heartbeat', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const onopen = vi.fn()
    source.onopen = onopen
    const got = record(source)
    expect(source.url).toBe('/api/live/stream')
    expect(source.readyState).toBe(DemoEventSource.CONNECTING)
    expect(got).toEqual([])
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(source.readyState).toBe(DemoEventSource.OPEN)
    expect(onopen).toHaveBeenCalledTimes(1)
    expect(got[0]?.kind).toBe('hello')
    expect(got[0]?.body).toMatchObject({
      kind: 'hello', heartbeat_s: DEMO_STREAM.heartbeatS, resumed: false, resume_note: null, read_only: true, order_path: 'none',
    })
    source.close()
  })

  it('sends status and then every journal row, in order: the bodies of GET /api/live/status and /api/live/journal', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const got = record(source)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(demoLiveJournalRows.length).toBeGreaterThan(0)
    expect(kinds(got)).toEqual(['hello', 'status', ...demoLiveJournalRows.map(() => 'journal_row')])
    expect(got[1]?.body).toEqual({ kind: 'status', status: demoLiveStatus })
    expect(got.slice(2).map((r) => r.body)).toEqual(demoLiveJournalRows.map((row) => ({ kind: 'journal_row', row })))
    // Event ids count up, as the server's cursor ids move on with each event.
    expect(new Set(got.map((r) => r.id)).size).toBe(got.length)
    source.close()
  })

  it('then sends a heartbeat every heartbeat_s, and nothing in between', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const got = record(source)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    const opening = got.length
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.heartbeatS * 1000 - 1)
    expect(got).toHaveLength(opening)
    await vi.advanceTimersByTimeAsync(1)
    expect(kinds(got.slice(opening))).toEqual(['heartbeat'])
    expect(got.at(-1)?.body).toEqual({ kind: 'heartbeat', interval_s: DEMO_STREAM.heartbeatS, utc: expect.any(String) })
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.heartbeatS * 1000 * 3)
    expect(kinds(got.slice(opening))).toEqual(['heartbeat', 'heartbeat', 'heartbeat', 'heartbeat'])
    source.close()
  })

  it('close() stops every timer and every event', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const got = record(source)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs + DEMO_STREAM.heartbeatS * 1000)
    const before = got.length
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    source.close()
    expect(source.readyState).toBe(DemoEventSource.CLOSED)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.heartbeatS * 1000 * 10)
    expect(got).toHaveLength(before)
    source.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closed before it opens, it never opens and leaves no timer', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const onopen = vi.fn()
    source.onopen = onopen
    const got = record(source)
    source.close()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onopen).not.toHaveBeenCalled()
    expect(got).toEqual([])
  })

  it('closed by a handler during the opening, it sends nothing more and starts no heartbeat', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const got = record(source)
    source.addEventListener('hello', () => source.close())
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(kinds(got)).toEqual(['hello'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removeEventListener stops that listener only', async () => {
    const source = new DemoEventSource('/api/live/stream')
    const kept = vi.fn()
    const dropped = vi.fn()
    source.addEventListener('hello', kept)
    source.addEventListener('hello', dropped)
    source.removeEventListener('hello', dropped)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
    source.close()
  })
})

describe('DemoEventSource keeps dispatching when a listener throws', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a throwing hello listener and still sends the rest of the opening plus the heartbeat', async () => {
    const spy = vi.fn()
    vi.stubGlobal('reportError', spy)
    const source = new DemoEventSource('/api/live/stream')
    source.addEventListener('hello', () => {
      throw new Error('boom')
    })
    const got = record(source)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(got.filter((r) => r.kind === 'journal_row')).toHaveLength(demoLiveJournalRows.length)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.heartbeatS * 1000)
    expect(kinds(got).at(-1)).toBe('heartbeat')
    source.close()
  })

  it('reports a throwing onopen and still sends the opening events and the heartbeat', async () => {
    const spy = vi.fn()
    vi.stubGlobal('reportError', spy)
    const source = new DemoEventSource('/api/live/stream')
    source.onopen = () => {
      throw new Error('open boom')
    }
    const got = record(source)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(kinds(got)).toEqual(['hello', 'status', ...demoLiveJournalRows.map(() => 'journal_row')])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.heartbeatS * 1000)
    expect(kinds(got).at(-1)).toBe('heartbeat')
    source.close()
  })
})

describe('DemoEventSource refuses any other URL', () => {
  it.each(['/api/live/status', '/api/live/stream?from=0', '/api/live/stream/x', 'http://evil.example/api/live/stream', '//evil.example/api/live/stream'])(
    'errors on %s: closed, onerror called, no events, no timer left',
    async (url) => {
      const source = new DemoEventSource(url)
      const onerror = vi.fn()
      const onopen = vi.fn()
      source.onerror = onerror
      source.onopen = onopen
      const got = record(source)
      await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
      expect(source.readyState).toBe(DemoEventSource.CLOSED)
      expect(onerror).toHaveBeenCalledTimes(1)
      expect(onopen).not.toHaveBeenCalled()
      expect(got).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('accepts the stream route spelt as an absolute URL of this page', async () => {
    vi.stubGlobal('location', new URL('http://127.0.0.1:5174/'))
    try {
      const source = new DemoEventSource(new URL('http://127.0.0.1:5174/api/live/stream'))
      const got = record(source)
      await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
      expect(got[0]?.kind).toBe('hello')
      source.close()
      const other = new DemoEventSource('http://127.0.0.1:8765/api/live/stream')
      await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
      expect(other.readyState).toBe(DemoEventSource.CLOSED)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('LiveStream over DemoEventSource', () => {
  function liveStream() {
    const events: StreamEvent[] = []
    const opened: DemoEventSource[] = []
    const stream = new LiveStream({
      open: (url) => {
        const source = new DemoEventSource(url)
        opened.push(source)
        return source
      },
      onEvent: (e) => events.push(e),
      now: () => Date.now(),
    })
    return { stream, events, opened }
  }

  it('opens, counts the fixture rows, and stays open on the heartbeats (no stall, no reconnect)', async () => {
    const { stream, events, opened } = liveStream()
    stream.start()
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'open', heartbeatS: DEMO_STREAM.heartbeatS, rows: demoLiveJournalRows.length })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(stream.getSnapshot().mode).toBe('open')
    expect(opened).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'hello')).toHaveLength(1)
    stream.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives a StrictMode double mount: start, stop, start leaves one open stream and no stray timer', async () => {
    const { stream, events, opened } = liveStream()
    stream.start()
    stream.stop()
    stream.start()
    await vi.advanceTimersByTimeAsync(DEMO_STREAM.openDelayMs)
    expect(opened).toHaveLength(2)
    expect(opened[0]?.readyState).toBe(DemoEventSource.CLOSED)
    expect(events.filter((e) => e.kind === 'hello')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'journal_row')).toHaveLength(demoLiveJournalRows.length)
    stream.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
