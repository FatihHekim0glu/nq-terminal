// The backend connection state (roadmap #7): a state machine driven only by GET /api/health, and a
// supervisor that wires it to the query client. Nothing renders yet (that is wave 4); this module is
// pinned by its own tests so the chrome work later has a state machine and a supervisor already proven.
//
// States: unknown (no health check has settled yet), ok, degraded (a failure that is not an outage, or
// fewer than DOWN_AFTER consecutive outage failures), down (DOWN_AFTER or more consecutive outage
// failures). isOutage tells a network failure or a 5xx that means "nothing is listening" apart from a
// 4xx or a decode error, which only ever degrade.
//
// Vite's dev proxy answers an unreachable backend with an empty text/plain 500 (its own proxy error
// handler, not the backend), which api/client.ts turns into kind 'http', status 500, body null. A
// FastAPI refusal always carries a JSON ErrorDetail body. So a bodiless 500 is treated as an outage and
// a 500 with a body is not: without this, `start.ps1 -Dev` (and a plain `vite`) never reaches 'down'
// when the backend is stopped.
//
// While down, the supervisor sets onlineManager offline, which pauses only a query that opts into
// networkMode 'online'. createApiQueryClient defaults every query to networkMode 'always' (D27), so the
// client default is never paused by this: panels keep their own polling while down.
import { onlineManager, type Query, type QueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, type ApiErrorKind } from './client'
import { apiQueryKey, LIVE_POLL_MS } from './queryKey'

export type ConnectionStatus = 'unknown' | 'ok' | 'degraded' | 'down'

export interface ConnectionError {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly detail: string
}

export interface ConnectionState {
  readonly status: ConnectionStatus
  /** Consecutive outage failures; 0 after an ok or a non-outage failure. */
  readonly failures: number
  /** When the current down period started; null while not down. */
  readonly downSince: number | null
  readonly lastCheckAt: number | null
  readonly lastOkAt: number | null
  readonly lastError: ConnectionError | null
  /** When the state last left down (an ok, or an answer that is not an outage); null until that has
   *  happened once. */
  readonly recoveredAt: number | null
  /** Observed api queries with an error, retried by the last recovery. */
  readonly retried: number
}

export const INITIAL_CONNECTION: ConnectionState = {
  status: 'unknown',
  failures: 0,
  downSince: null,
  lastCheckAt: null,
  lastOkAt: null,
  lastError: null,
  recoveredAt: null,
  retried: 0,
}

/** Consecutive outage failures before the state machine calls it down. */
export const DOWN_AFTER = 3
/** The health poll's interval while down: grows through this table, then holds at the last entry. */
export const HEALTH_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000] as const

/** A failure that means nothing answered, not that the backend refused the request. */
export function isOutage(error: ApiError): boolean {
  if (error.kind === 'network') return true
  if (error.kind !== 'http') return false
  if (error.status === 502 || error.status === 503 || error.status === 504) return true
  return error.status === 500 && error.body === null
}

export type HealthEvent = { readonly kind: 'ok'; readonly at: number } | { readonly kind: 'fail'; readonly at: number; readonly error: ApiError }

/** The state machine's one transition, pure so every path is a table (connection.test.ts). */
export function nextConnection(state: ConnectionState, event: HealthEvent): ConnectionState {
  if (event.kind === 'ok') {
    return {
      ...state,
      status: 'ok',
      failures: 0,
      downSince: null,
      lastCheckAt: event.at,
      lastOkAt: event.at,
      recoveredAt: state.status === 'down' ? event.at : state.recoveredAt,
    }
  }
  const lastError: ConnectionError = { kind: event.error.kind, status: event.error.status, detail: event.error.detail }
  if (isOutage(event.error)) {
    const failures = state.failures + 1
    const down = failures >= DOWN_AFTER
    return {
      ...state,
      status: down ? 'down' : 'degraded',
      failures,
      downSince: down ? (state.downSince ?? event.at) : null,
      lastCheckAt: event.at,
      lastError,
    }
  }
  return {
    ...state,
    status: 'degraded',
    failures: 0,
    downSince: null,
    lastCheckAt: event.at,
    lastError,
    recoveredAt: state.status === 'down' ? event.at : state.recoveredAt,
  }
}

/** The health poll's own interval: LIVE_POLL_MS everywhere but down, where it backs off through the table. */
export function healthIntervalMs(state: ConnectionState): number {
  if (state.status !== 'down') return LIVE_POLL_MS
  const index = Math.min(Math.max(state.failures - DOWN_AFTER + 1, 0), HEALTH_BACKOFF_MS.length - 1)
  return HEALTH_BACKOFF_MS[index] ?? HEALTH_BACKOFF_MS[HEALTH_BACKOFF_MS.length - 1] ?? LIVE_POLL_MS
}

export type ConnectionStore = StoreApi<ConnectionState>

export const connectionStore: ConnectionStore = createStore<ConnectionState>()(() => ({ ...INITIAL_CONNECTION }))

/** The connection state, read only (chrome, wave 4). */
export function useConnection(): ConnectionState {
  return useStore(connectionStore)
}

/** The health query's own poll interval, derived from the connection state. */
export function useHealthInterval(): number {
  return useStore(connectionStore, healthIntervalMs)
}

/** Back to unknown, online reasserted; for tests and for a screen that wants to start clean. */
export function resetConnection(): void {
  connectionStore.setState({ ...INITIAL_CONNECTION }, true)
  onlineManager.setOnline(true)
}

function isHealthQuery(query: Query): boolean {
  return query.queryKey[0] === 'api' && query.queryKey[1] === '/api/health'
}

/** Api queries an observer is currently reading that ended in an error; the recovery retries these.
 *  Counts what invalidateQueries actually refetches (active queries); never the health query itself,
 *  which drives this state machine and already has its own poll. */
function retriableApiQueries(client: QueryClient): number {
  return client.getQueryCache().findAll({
    predicate: (query) => query.queryKey[0] === 'api' && query.state.status === 'error' && query.isActive() && !isHealthQuery(query),
  }).length
}

/** Every api query the recovery refetches: one that errored, or the command index (it may have changed
 *  while the backend was unreachable, and nothing else invalidates it on a timer this short). Never the
 *  health query itself, which already has its own poll. */
function recoveryPredicate(query: Query): boolean {
  return !isHealthQuery(query) && query.queryKey[0] === 'api' && (query.state.status === 'error' || query.queryKey[1] === '/api/commands')
}

/**
 * Feeds the connection state machine from the health query's own cache entry, and drives the query
 * client from it: offline (re-asserted on every failure) while down, online plus one retry of every
 * errored observed api query and the command index on recovery, which happens as soon as the state
 * leaves down (an ok, or an answer that is not an outage: any answer that is not an outage means the
 * backend is back). Returns the uninstaller, which also reasserts online (a component that installed
 * the supervisor should not leave queries paused behind it).
 *
 * Setting onlineManager offline pauses only a query that opts into networkMode 'online'; the client
 * default stays 'always' (D27), so a panel on the client default keeps polling while down.
 */
export function installConnectionSupervisor(client: QueryClient, now: () => number = Date.now): () => void {
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !isHealthQuery(event.query)) return
    const action = event.action
    const healthEvent: HealthEvent | null =
      action.type === 'success'
        ? { kind: 'ok', at: now() }
        : action.type === 'error' && action.error instanceof ApiError
          ? { kind: 'fail', at: now(), error: action.error }
          : null
    if (healthEvent === null) return

    const previous = connectionStore.getState()
    const next = nextConnection(previous, healthEvent)
    if (next.status === 'down') onlineManager.setOnline(false)

    if (previous.status === 'down' && next.status !== 'down') {
      onlineManager.setOnline(true)
      connectionStore.setState({ ...next, retried: retriableApiQueries(client) })
      client.invalidateQueries({ predicate: recoveryPredicate }).catch(() => undefined)
      return
    }
    connectionStore.setState(next)
  })
  return () => {
    unsubscribe()
    onlineManager.setOnline(true)
  }
}

/** Asks for a health check right now (the banner's "Check now"); a rejection is dropped, the cache
 *  update and the connection state come through installConnectionSupervisor as usual. */
export function checkHealthNow(client: QueryClient): void {
  client.refetchQueries({ queryKey: apiQueryKey('/api/health') }).catch(() => undefined)
}
