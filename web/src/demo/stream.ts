// The demo's live stream (demo builds only; src/demo/boot.tsx installs it as the page's EventSource). It
// plays what the fixture backend's GET /api/live/stream would send, on timers and in the browser: `hello`,
// then `status`, then the fixture journal rows as `journal_row`, then a `heartbeat` every heartbeat_s. The
// status and the rows are the bodies the demo serves at GET /api/live/status and /api/live/journal
// (src/demo/data/live.ts), so the stream and the GETs agree. It has only the surface src/api/liveStream.ts
// uses (readyState, onopen, onerror, addEventListener per event kind, close), and like the browser's it
// answers asynchronously and reports a refused URL through onerror with readyState CLOSED, so LiveStream
// falls back to polling.
// Each instance owns its timers and close() clears them all, so a StrictMode mount, unmount and mount
// leaves exactly one stream running.
import { LIVE_STREAM, type StreamEvent } from '../api/liveStream'
import { demoLiveJournalRows, demoLiveStatus } from './data/live'

export const DEMO_STREAM = {
  /** From construction to `open` and the opening events, as a local server would take. */
  openDelayMs: 50,
  /** The backend's default (backend/nq_terminal/api/live_stream.py StreamLimits). */
  heartbeatS: 10,
} as const

type Listener = (event: MessageEvent<string>) => void

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

/** Reports a listener's error the way the browser's EventSource would, without stopping the stream. */
function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
  else queueMicrotask(() => { throw error })
}

/** The one stream route, relative or as an absolute URL of this page; nothing else opens. */
function isStreamUrl(url: string | URL): boolean {
  const text = String(url)
  if (text === LIVE_STREAM.path) return true
  const origin = globalThis.location?.origin
  if (origin === undefined) return false
  try {
    const parsed = new URL(text, `${origin}/`)
    return parsed.origin === origin && parsed.pathname === LIVE_STREAM.path && parsed.search === '' && parsed.hash === ''
  } catch {
    return false
  }
}

/**
 * What the stream sends on connect, in order: the fixture backend's opening, then its journal replay. Exported
 * for src/demo/serve.ts, which plays the same events over HTTP for the offline Playwright project.
 */
export function demoStreamOpening(): StreamEvent[] {
  const hello: StreamEvent = {
    kind: 'hello',
    schema_version: 1,
    resumed: false,
    resume_note: null,
    poll_s: 1,
    heartbeat_s: DEMO_STREAM.heartbeatS,
    // The demo stream has no lifetime: it runs until closed and never sends `bye`.
    lifetime_s: 0,
    retry_ms: 2000,
    banner: demoLiveStatus.banner,
    basis: 'demo data: the fixture journal rows replayed once, then heartbeats; status is the body of /api/live/status',
    read_only: true,
    order_path: 'none',
  }
  const rows: StreamEvent[] = demoLiveJournalRows.map((row) => ({ kind: 'journal_row', row }))
  return [hello, { kind: 'status', status: demoLiveStatus }, ...rows]
}

export class DemoEventSource {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSED = CLOSED

  readonly url: string
  readonly withCredentials = false
  readyState: number = CONNECTING
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastId = 0

  constructor(url: string | URL, _init?: EventSourceInit) {
    this.url = String(url)
    if (isStreamUrl(url)) this.later(DEMO_STREAM.openDelayMs, () => this.open())
    else this.later(0, () => this.fail())
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.readyState = CLOSED
    for (const timer of this.timeouts) clearTimeout(timer)
    this.timeouts.clear()
    if (this.heartbeat !== null) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timeouts.delete(timer)
      run()
    }, ms)
    this.timeouts.add(timer)
  }

  private open(): void {
    this.readyState = OPEN
    try {
      this.onopen?.(new Event('open'))
    } catch (error) {
      report(error)
    }
    for (const event of demoStreamOpening()) this.send(event)
    // A handler may have closed the stream already; a heartbeat then would outlive close().
    if (this.readyState !== OPEN) return
    this.heartbeat = setInterval(() => {
      this.send({ kind: 'heartbeat', interval_s: DEMO_STREAM.heartbeatS, utc: new Date().toISOString() })
    }, DEMO_STREAM.heartbeatS * 1000)
  }

  /** A refused URL: the browser fails the connection for good and does not reconnect. */
  private fail(): void {
    this.close()
    try {
      this.onerror?.(new Event('error'))
    } catch (error) {
      report(error)
    }
  }

  /** One named event, as the browser hands it over: its kind as the type, JSON text as the data. A
   * throwing listener is reported like a browser's uncaught handler error; dispatch to the rest continues. */
  private send(event: StreamEvent): void {
    if (this.readyState !== OPEN) return
    this.lastId += 1
    const message = new MessageEvent<string>(event.kind, { data: JSON.stringify(event), lastEventId: String(this.lastId) })
    for (const listener of [...(this.listeners.get(event.kind) ?? [])]) {
      try {
        listener(message)
      } catch (error) {
        report(error)
      }
    }
  }
}
