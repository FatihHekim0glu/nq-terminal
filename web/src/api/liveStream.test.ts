import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_STREAM, LiveStream, OFF_SNAPSHOT, pollIntervalFor, retryDelay, type EventSourceLike, type StreamEvent,
} from './liveStream'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

/** A stand-in EventSource: the test drives its events and its readyState, as the browser would. */
class FakeSource implements EventSourceLike {
  static made: FakeSource[] = []
  readyState = CONNECTING
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
    this.readyState = CLOSED
  }

  emit(kind: string, data: unknown): void {
    this.readyState = OPEN
    const event = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>
    for (const fn of this.listeners.get(kind) ?? []) fn(event)
  }

  fail(state: number): void {
    this.readyState = state
    this.onerror?.(new Event('error'))
  }
}

const HELLO = {
  kind: 'hello', schema_version: 1, resumed: false, resume_note: null, poll_s: 1, heartbeat_s: 10, lifetime_s: 120,
  retry_ms: 2000, banner: 'PLUMBING TEST, DELAYED DATA: not strategy performance', basis: 'rows', read_only: true, order_path: 'none',
}

function setup() {
  const events: StreamEvent[] = []
  const stream = new LiveStream({
    open: (url) => new FakeSource(url),
    onEvent: (e) => events.push(e),
    now: () => Date.now(),
  })
  const latest = () => FakeSource.made.at(-1)!
  return { stream, events, latest }
}

beforeEach(() => {
  FakeSource.made = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T14:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveStream', () => {
  it('connects to the one stream route and is open once hello arrives', () => {
    const { stream, events, latest } = setup()
    stream.start()
    expect(latest().url).toBe('/api/live/stream')
    expect(stream.getSnapshot().mode).toBe('connecting')
    latest().emit('hello', HELLO)
    const s = stream.getSnapshot()
    expect(s.mode).toBe('open')
    expect(s.heartbeatS).toBe(10)
    expect(s.lastEventAt).toBe(Date.now())
    expect(events.map((e) => e.kind)).toEqual(['hello'])
  })

  it('hands every kind of event to the handler and counts journal rows', () => {
    const { stream, events, latest } = setup()
    stream.start()
    latest().emit('hello', HELLO)
    latest().emit('status', { kind: 'status', status: { kill_switch_on: false } })
    latest().emit('kill_switch', { kind: 'kill_switch', on: true, path: 'live/KILL*' })
    latest().emit('journal_reset', { kind: 'journal_reset', file: 'a.jsonl', path: 'live/logs/a.jsonl', reason: 'sync', skipped_rows: 0, first_line_no: 1 })
    latest().emit('journal_row', { kind: 'journal_row', row: { file: 'a.jsonl', line_no: 1 } })
    latest().emit('journal_row', { kind: 'journal_row', row: { file: 'a.jsonl', line_no: 2 } })
    latest().emit('heartbeat', { kind: 'heartbeat', utc: '2026-09-28T14:00:10Z', interval_s: 10 })
    expect(events.map((e) => e.kind)).toEqual(['hello', 'status', 'kill_switch', 'journal_reset', 'journal_row', 'journal_row', 'heartbeat'])
    expect(stream.getSnapshot().rows).toBe(2)
  })

  it('ignores an event that is not valid JSON or names another kind than its event', () => {
    const { stream, events, latest } = setup()
    stream.start()
    latest().emit('hello', HELLO)
    latest().emit('status', '{not json')
    latest().emit('status', { kind: 'journal_row', row: {} })
    expect(events.map((e) => e.kind)).toEqual(['hello'])
  })

  it('shows reconnecting while the browser reconnects, then open again on the next hello', () => {
    const { stream, latest } = setup()
    stream.start()
    const first = latest()
    first.emit('hello', HELLO)
    first.emit('bye', { kind: 'bye', reason: 'stream lifetime reached', retry_ms: 2000 })
    first.fail(CONNECTING)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'reconnecting', reason: 'bye' })
    first.emit('hello', { ...HELLO, resumed: true })
    expect(stream.getSnapshot()).toMatchObject({ mode: 'open', reason: null, resumed: true, attempt: 0 })
    expect(FakeSource.made).toHaveLength(1)
  })

  it('falls back to polling when the reconnect takes too long, and keeps the browser trying', () => {
    const { stream, latest } = setup()
    stream.start()
    latest().emit('hello', HELLO)
    latest().fail(CONNECTING)
    expect(stream.getSnapshot().mode).toBe('reconnecting')
    vi.advanceTimersByTime(LIVE_STREAM.openTimeoutMs)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'polling', reason: 'timeout' })
    expect(latest().closed).toBe(false)
    latest().emit('hello', HELLO)
    expect(stream.getSnapshot().mode).toBe('open')
  })

  it('born failing: a refused stream (closed by the browser) polls, then opens a new stream after a backoff', () => {
    const { stream, latest } = setup()
    stream.start()
    latest().fail(CLOSED)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'polling', reason: 'refused', attempt: 1 })
    expect(FakeSource.made).toHaveLength(1)
    vi.advanceTimersByTime(retryDelay(1) - 1)
    expect(FakeSource.made).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSource.made).toHaveLength(2)
    expect(stream.getSnapshot().mode).toBe('reconnecting')
    latest().emit('hello', HELLO)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'open', attempt: 0 })
  })

  it('backs off longer after each refusal, up to a ceiling', () => {
    expect(retryDelay(1)).toBe(LIVE_STREAM.retryMinMs)
    expect(retryDelay(2)).toBe(LIVE_STREAM.retryMinMs * 2)
    expect(retryDelay(3)).toBeGreaterThan(retryDelay(2))
    expect(retryDelay(50)).toBe(LIVE_STREAM.retryMaxMs)
  })

  it('treats a stream silent for three heartbeats as stalled and opens a new one', () => {
    const { stream, latest } = setup()
    stream.start()
    const first = latest()
    first.emit('hello', HELLO)
    vi.advanceTimersByTime(HELLO.heartbeat_s * 1000 * LIVE_STREAM.stallHeartbeats - 1)
    expect(FakeSource.made).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(first.closed).toBe(true)
    expect(FakeSource.made).toHaveLength(2)
    expect(stream.getSnapshot()).toMatchObject({ mode: 'reconnecting', reason: 'stalled' })
  })

  it('a heartbeat keeps the stream from counting as stalled', () => {
    const { stream, latest } = setup()
    stream.start()
    latest().emit('hello', HELLO)
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(HELLO.heartbeat_s * 1000)
      latest().emit('heartbeat', { kind: 'heartbeat', utc: 'x', interval_s: 10 })
    }
    expect(FakeSource.made).toHaveLength(1)
    expect(stream.getSnapshot().mode).toBe('open')
  })

  it('polls where the browser has no EventSource', () => {
    const stream = new LiveStream({ open: () => null, onEvent: () => undefined, now: () => Date.now() })
    stream.start()
    expect(stream.getSnapshot()).toMatchObject({ mode: 'polling', reason: 'unsupported' })
  })

  it('stops cleanly: the source is closed, no timer fires later and the state is off', () => {
    const { stream, latest } = setup()
    stream.start()
    latest().fail(CLOSED)
    stream.stop()
    vi.advanceTimersByTime(LIVE_STREAM.retryMaxMs * 2)
    expect(FakeSource.made).toHaveLength(1)
    expect(stream.getSnapshot()).toEqual(OFF_SNAPSHOT)
  })

  it('tells subscribers of each change and lets them go', () => {
    const { stream, latest } = setup()
    const seen: string[] = []
    const off = stream.subscribe(() => seen.push(stream.getSnapshot().mode))
    stream.start()
    latest().emit('hello', HELLO)
    off()
    latest().fail(CONNECTING)
    expect(seen).toEqual(['connecting', 'open'])
  })
})

describe('pollIntervalFor', () => {
  it('polls only while no stream is open or on its way', () => {
    expect(pollIntervalFor('open', 2000)).toBe(false)
    expect(pollIntervalFor('connecting', 2000)).toBe(false)
    expect(pollIntervalFor('reconnecting', 2000)).toBe(false)
    expect(pollIntervalFor('polling', 2000)).toBe(2000)
    expect(pollIntervalFor('off', 2000)).toBe(2000)
  })
})
