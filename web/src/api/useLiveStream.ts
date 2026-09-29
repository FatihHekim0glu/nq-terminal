// The live stream in React (TASKS 9.2): one LiveStream for the whole page, opened while LIVE or JRNL is on
// screen (useLiveStream) and closed a moment after the last of them goes, so swapping one for the other keeps
// the connection and its Last-Event-ID. Events feed the query cache:
//   status           written straight into GET /api/live/status's cache entry (no request);
//   journal rows,    one refresh of the journal-derived GETs (journal, performance, routes, paper tracking,
//   resets, kill     logs) after a burst settles, so a burst of rows costs one request per view;
//   hello            a fresh (not resumed) connection refreshes them too.
// While the stream is open nothing polls; useLivePollInterval gives the P0 interval back when it is not.
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { openEventStream } from './client'
import { LiveStream, OFF_SNAPSHOT, type StreamEvent, type StreamSnapshot } from './liveStream'
import { setStreamMode } from './liveMode'
import { apiQueryKey } from './queryKey'
import type { ApiPath, Schemas } from './types'

/** The GETs that read the journals: refreshed when the stream reports a change. */
export const LIVE_DERIVED_PATHS: readonly ApiPath[] = [
  '/api/live/journal', '/api/live/performance', '/api/live/routes', '/api/live/log', '/api/analytics/paper-tracking',
]

/** A burst of rows is refreshed once, this long after the last row (and at most maxWait after the first). */
const REFRESH_SETTLE_MS = 400
const REFRESH_MAX_WAIT_MS = 1500
/** A screen swap (LIVE to JRNL) releases and acquires within one commit; the stream outlives it by this much. */
const RELEASE_LINGER_MS = 1000

export interface LiveEventEffect {
  readonly status: Schemas['LiveStatus'] | null
  readonly refresh: boolean
}

/** What one stream event does to the cache: a status to write, and whether the journal views refresh. */
export function liveEventEffect(event: StreamEvent): LiveEventEffect {
  switch (event.kind) {
    case 'status':
      return { status: event.status, refresh: false }
    case 'journal_row':
    case 'journal_reset':
    case 'kill_switch':
      return { status: null, refresh: true }
    case 'hello':
      return { status: null, refresh: !event.resumed }
    default:
      return { status: null, refresh: false }
  }
}

const DERIVED: ReadonlySet<unknown> = new Set(LIVE_DERIVED_PATHS)

class LiveStreamHub {
  private stream: LiveStream | null = null
  private client: QueryClient | null = null
  private users = 0
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private firstPending: number | null = null
  /** The last kill_switch value seen, across reconnects (D29): the server resends kill_switch on every
   *  opening even when nothing changed, so a refresh on its bare presence would undo the resumed-hello
   *  optimisation about every 2 minutes (StreamLimits.lifetime_s). null until the first one arrives. */
  private lastKill: boolean | null = null
  private readonly listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): StreamSnapshot => this.stream?.getSnapshot() ?? OFF_SNAPSHOT

  acquire(client: QueryClient): () => void {
    this.users += 1
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer)
    this.lingerTimer = null
    if (this.stream === null || this.client !== client) this.open(client)
    let released = false
    return () => {
      if (released) return
      released = true
      this.users -= 1
      if (this.users > 0) return
      this.lingerTimer = setTimeout(() => {
        this.lingerTimer = null
        if (this.users === 0) this.close()
      }, RELEASE_LINGER_MS)
    }
  }

  /** Closes everything and forgets every user (tests). */
  reset(): void {
    this.users = 0
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer)
    this.lingerTimer = null
    this.lastKill = null
    this.close()
  }

  private open(client: QueryClient): void {
    this.close()
    this.client = client
    const stream = new LiveStream({ open: openEventStream, onEvent: (e) => this.onEvent(e), now: () => Date.now() })
    this.stream = stream
    this.unsubscribe = stream.subscribe(() => this.notify())
    stream.start()
    this.notify()
  }

  /** A refresh still waiting for its burst to settle runs now rather than being lost with the stream. */
  private close(): void {
    if (this.settleTimer !== null) this.refreshNow()
    this.unsubscribe?.()
    this.unsubscribe = null
    const had = this.stream !== null
    this.stream?.stop()
    this.stream = null
    this.client = null
    if (had) this.notify()
  }

  private notify(): void {
    // The shell's live hooks poll by this mode (liveMode.ts), so it is written before anyone else is told.
    setStreamMode(this.getSnapshot().mode)
    for (const listener of [...this.listeners]) listener()
  }

  private onEvent(event: StreamEvent): void {
    const effect = liveEventEffect(event)
    if (effect.status !== null) this.client?.setQueryData(apiQueryKey('/api/live/status'), effect.status)
    const refresh = event.kind === 'kill_switch' ? this.killChanged(event.on) : effect.refresh
    if (refresh) this.scheduleRefresh()
  }

  /** True the first time a kill_switch value is seen, or when it differs from the last one remembered;
   *  false on a bare resend of the value already known (D29). */
  private killChanged(on: boolean): boolean {
    const changed = this.lastKill === null || this.lastKill !== on
    this.lastKill = on
    return changed
  }

  private scheduleRefresh(): void {
    const now = Date.now()
    this.firstPending ??= now
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    const wait = Math.max(0, Math.min(REFRESH_SETTLE_MS, this.firstPending + REFRESH_MAX_WAIT_MS - now))
    this.settleTimer = setTimeout(() => this.refreshNow(), wait)
  }

  private refreshNow(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.firstPending = null
    // A failed refetch already lands in its own query's error state (the screens show it); the returned promise
    // adds nothing, so its rejection is dropped on purpose rather than left unhandled.
    this.client?.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'api' && DERIVED.has(q.queryKey[1]) }).catch(() => undefined)
  }
}

export const liveStreamHub = new LiveStreamHub()

/** The stream's state without asking for it (the status line, polling decisions). */
export function useLiveStreamState(): StreamSnapshot {
  return useSyncExternalStore(liveStreamHub.subscribe, liveStreamHub.getSnapshot, liveStreamHub.getSnapshot)
}

/** Opens the stream while the calling screen is mounted (LIVE, JRNL) and returns its state. */
export function useLiveStream(): StreamSnapshot {
  const client = useQueryClient()
  useEffect(() => liveStreamHub.acquire(client), [client])
  return useLiveStreamState()
}

// The live queries' polling interval reads the mode from liveMode.ts, which the shell holds; it is exported
// here too, where the stream's own hooks and tests have always found it.
export { useLivePollInterval } from './liveMode'
