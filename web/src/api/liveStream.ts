// The live stream client (TASKS 9.2; ARCHITECTURE section 4, Live): GET /api/live/stream as Server-Sent
// Events, replacing the LIVE and JRNL polling. Read only: the stream is a GET and there is no order path.
//
// States, shown on screen by StreamState:
//   connecting    the first request is on its way (no polling yet);
//   open          hello arrived; events flow and nothing polls;
//   reconnecting  the browser is reconnecting on its own (after the server's `bye` at the end of the stream's
//                 lifetime, a dropped connection or a server restart), sending the last event id back as
//                 Last-Event-ID, so the server resumes after the last row it sent;
//   polling       the fallback: no EventSource, the server refused the stream (503 when too many are open,
//                 403), or a reconnect took longer than openTimeoutMs. The screens poll as in P0 until a new
//                 hello arrives; a refused stream is opened again after a growing backoff;
//   off           nothing on screen wants the stream.
// A stream silent for stallHeartbeats heartbeats counts as stalled and is replaced. This module holds no React
// and no query client: it hands each parsed event to `onEvent` (src/api/useLiveStream.ts wires those).
import type { Schemas } from './types'

export const LIVE_STREAM = {
  path: '/api/live/stream',
  /** A connection that has not said hello by then polls meanwhile (the browser keeps trying). */
  openTimeoutMs: 8000,
  /** No event for this many heartbeats: the stream is stalled and replaced. */
  stallHeartbeats: 3,
  /** Backoff before a refused stream is opened again: doubles from min to max. */
  retryMinMs: 5000,
  retryMaxMs: 60_000,
} as const

export type StreamMode = 'off' | 'connecting' | 'open' | 'reconnecting' | 'polling'
export type StreamReason = 'unsupported' | 'refused' | 'timeout' | 'stalled' | 'dropped' | 'bye' | null

export type StreamEvent =
  | Schemas['StreamHello']
  | Schemas['StreamStatus']
  | Schemas['StreamKillSwitch']
  | Schemas['StreamJournalReset']
  | Schemas['StreamJournalRow']
  | Schemas['StreamHeartbeat']
  | Schemas['StreamBye']

export type StreamKind = StreamEvent['kind']

const KINDS: readonly StreamKind[] = ['hello', 'status', 'kill_switch', 'journal_reset', 'journal_row', 'heartbeat', 'bye']

export interface StreamSnapshot {
  readonly mode: StreamMode
  readonly reason: StreamReason
  /** Date.now() of the last event; null before the first. */
  readonly lastEventAt: number | null
  /** Whether the server resumed after the last event id the browser sent. */
  readonly resumed: boolean
  /** Why the server did not resume (an id it did not write), else null. */
  readonly resumeNote: string | null
  readonly heartbeatS: number | null
  /** Refusals or stalls since the stream was last open. */
  readonly attempt: number
  /** Journal rows received since the page opened the stream. */
  readonly rows: number
}

export const OFF_SNAPSHOT: StreamSnapshot = Object.freeze({
  mode: 'off', reason: null, lastEventAt: null, resumed: false, resumeNote: null, heartbeatS: null, attempt: 0, rows: 0,
})

/** What LiveStream needs of an EventSource (the browser's, or a test's stand-in). */
export interface EventSourceLike {
  readonly readyState: number
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export interface LiveStreamOptions {
  /** Opens the stream at `url`; null where the browser has none (the client's openEventStream). */
  readonly open: (url: typeof LIVE_STREAM.path) => EventSourceLike | null
  readonly onEvent: (event: StreamEvent) => void
  readonly now: () => number
}

const CLOSED = 2

/** Milliseconds before the n-th new stream after a refusal (n from 1). */
export function retryDelay(attempt: number): number {
  const steps = Math.max(0, Math.min(attempt - 1, 16))
  return Math.min(LIVE_STREAM.retryMinMs * 2 ** steps, LIVE_STREAM.retryMaxMs)
}

// pollIntervalFor (whether the live queries poll) sits in liveMode.ts with the mode the shell reads, so the
// shell need not load this file for it.
export { pollIntervalFor } from './liveMode'

function parse(kind: StreamKind, text: string): StreamEvent | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    return (value as { kind?: unknown }).kind === kind ? (value as StreamEvent) : null
  } catch {
    return null
  }
}

export class LiveStream {
  private snapshot: StreamSnapshot = OFF_SNAPSHOT
  private source: EventSourceLike | null = null
  private readonly listeners = new Set<() => void>()
  private openTimer: ReturnType<typeof setTimeout> | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private lastKind: StreamKind | null = null

  private readonly options: LiveStreamOptions

  constructor(options: LiveStreamOptions) {
    this.options = options
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): StreamSnapshot => this.snapshot

  start(): void {
    if (this.snapshot.mode !== 'off') return
    this.connect(false)
  }

  stop(): void {
    this.clearTimers()
    this.source?.close()
    this.source = null
    this.lastKind = null
    this.set(OFF_SNAPSHOT)
  }

  private set(next: StreamSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }

  private patch(changes: Partial<StreamSnapshot>): void {
    this.set({ ...this.snapshot, ...changes })
  }

  private connect(again: boolean): void {
    const source = this.options.open(LIVE_STREAM.path)
    if (source === null) {
      this.patch({ mode: 'polling', reason: 'unsupported' })
      return
    }
    this.source = source
    for (const kind of KINDS) source.addEventListener(kind, (event) => this.onMessage(source, kind, event.data))
    source.onerror = () => this.onError(source)
    this.patch({ mode: again ? 'reconnecting' : 'connecting' })
    this.armOpenTimer()
  }

  private onMessage(source: EventSourceLike, kind: StreamKind, data: string): void {
    if (source !== this.source) return
    const event = parse(kind, data)
    if (event === null) return
    this.lastKind = kind
    const now = this.options.now()
    if (event.kind === 'hello') {
      this.clearOpenTimer()
      this.patch({
        mode: 'open', reason: null, lastEventAt: now, resumed: event.resumed, resumeNote: event.resume_note,
        heartbeatS: event.heartbeat_s, attempt: 0,
      })
    } else {
      this.patch({ lastEventAt: now, rows: this.snapshot.rows + (event.kind === 'journal_row' ? 1 : 0) })
    }
    this.armStallTimer()
    this.options.onEvent(event)
  }

  private onError(source: EventSourceLike): void {
    if (source !== this.source) return
    this.clearStallTimer()
    if (source.readyState === CLOSED) {
      source.close()
      this.source = null
      this.clearOpenTimer()
      const attempt = this.snapshot.attempt + 1
      this.patch({ mode: 'polling', reason: 'refused', attempt })
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.connect(true)
      }, retryDelay(attempt))
      return
    }
    // The browser reconnects by itself and sends Last-Event-ID; poll only if that takes too long.
    if (this.snapshot.mode !== 'polling') this.patch({ mode: 'reconnecting', reason: this.lastKind === 'bye' ? 'bye' : 'dropped' })
    this.armOpenTimer()
  }

  private armOpenTimer(): void {
    if (this.openTimer !== null) return
    this.openTimer = setTimeout(() => {
      this.openTimer = null
      if (this.snapshot.mode !== 'open') this.patch({ mode: 'polling', reason: 'timeout' })
    }, LIVE_STREAM.openTimeoutMs)
  }

  private armStallTimer(): void {
    this.clearStallTimer()
    const heartbeat = this.snapshot.heartbeatS
    if (heartbeat === null || !(heartbeat > 0)) return
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null
      this.source?.close()
      this.source = null
      this.clearOpenTimer()
      this.patch({ mode: 'reconnecting', reason: 'stalled', attempt: this.snapshot.attempt + 1 })
      this.connect(true)
    }, heartbeat * 1000 * LIVE_STREAM.stallHeartbeats)
  }

  private clearOpenTimer(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer)
    this.openTimer = null
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) clearTimeout(this.stallTimer)
    this.stallTimer = null
  }

  private clearTimers(): void {
    this.clearOpenTimer()
    this.clearStallTimer()
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
