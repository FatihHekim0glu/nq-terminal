// react-query hooks for the P0 endpoints (ARCHITECTURE section 4). Every hook is a GET through apiGet.
// Hooks that take an id stay idle (no request) until the id is non-empty, so a panel whose link group has
// no context yet fetches nothing. Live endpoints follow the live stream (TASKS 9.2, src/api/useLiveStream.ts):
// while it is open they never poll and the stream refreshes them; otherwise they poll every LIVE_POLL_MS as in P0.
//
// SHELL RULE (scripts/shellBudget.test.ts): this file is part of the first-paint shell, so it holds only the
// hooks the shell reads, the ones REG, TEAR and LIVE import from here, and useApiQuery itself. Every other
// screen's hooks live in queries.screens.ts, which imports this file and is never imported by the shell.
// The live stream client is not imported here either: useLive reads its mode from liveMode.ts.
import { QueryClient, keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from './client'
import { useHealthInterval } from './connection'
import { LIVE_POLL_MS, apiQueryKey, type ApiQueryKey } from './queryKey'
import type { ApiPath, GetArgs, RequestOf, SuccessOf } from './types'
import { useLivePollInterval } from './liveMode'

export { LIVE_POLL_MS, apiQueryKey, type ApiQueryKey }
export const STALE_MS = 30_000
export const RETRY_DELAY_MS = 500
/** The command index is re-read this often, so a run or hypothesis added on disk becomes a context. */
export const COMMANDS_POLL_MS = 60_000
const MAX_RETRIES = 1

export interface ApiQueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number | false
  readonly staleTime?: number
  /** Keeps the previous query key's data on screen (the grid stays mounted, keyboard focus survives)
   *  while a new key's page loads, e.g. a paged GET whose offset self-corrects (D28). */
  readonly keepPreviousData?: boolean
  /** Overrides the client's retry policy (the health poll never retries: its own interval backs off). */
  readonly retry?: false
  /** Overrides the client's networkMode (the health poll stays 'always', so recovery can be seen). */
  readonly networkMode?: 'online' | 'always'
}

export interface PageQuery {
  readonly offset?: number
  readonly limit?: number
}

/** Retry once on a network failure or a 5xx (a half-written file answers 503); never on a 4xx or a refusal. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError) || failureCount >= MAX_RETRIES) return false
  return error.kind === 'network' || (error.kind === 'http' && error.status >= 500)
}

export function createApiQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: RETRY_DELAY_MS,
        staleTime: STALE_MS,
        refetchOnWindowFocus: false,
        // The backend is loopback only (127.0.0.1:8765): the browser's online/offline flag says
        // nothing about whether it is reachable. Without this, react-query's default networkMode
        // ('online') pauses every fetch as soon as the OS reports no network, even though the
        // loopback server is still up, freezing the health poll, new panels and the live views (D27).
        networkMode: 'always',
        refetchOnReconnect: false,
      },
    },
  })
}

/** Any contract GET as a query. Prefer the named hooks below; this is their common base. */
export function useApiQuery<P extends ApiPath>(
  path: P,
  request: RequestOf<P>,
  options: ApiQueryOptions = {},
): UseQueryResult<SuccessOf<P>, ApiError> {
  return useQuery<SuccessOf<P>, ApiError, SuccessOf<P>, ApiQueryKey<P>>({
    queryKey: apiQueryKey(path, request),
    queryFn: ({ signal }) => apiGet(path, ...([request, { signal }] as unknown as GetArgs<P>)),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
    ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.networkMode === undefined ? {} : { networkMode: options.networkMode }),
    ...(options.keepPreviousData ? { placeholderData: keepPreviousData } : {}),
  })
}

const live: ApiQueryOptions = { refetchInterval: LIVE_POLL_MS, staleTime: 0 }
/** A live endpoint (shared with queries.screens.ts): no polling while the stream is open (it refreshes these), P0's polling otherwise. */
export function useLive(extra: ApiQueryOptions = {}): ApiQueryOptions {
  return { ...live, ...extra, refetchInterval: useLivePollInterval() }
}
export const hasId = (...ids: ReadonlyArray<string>): boolean => ids.every((id) => id.trim() !== '')

// System
/** Polled at the connection state machine's own interval (2 s, backing off while down); never retried
 *  (a fast, frequent probe should fail fast) and always attempted regardless of the browser's online
 *  flag, so a health check can see the backend recover even while onlineManager reports offline. */
export const useHealth = () =>
  useApiQuery('/api/health', {}, { refetchInterval: useHealthInterval(), staleTime: 0, retry: false, networkMode: 'always' })
export const useCommands = () => useApiQuery('/api/commands', {}, { refetchInterval: COMMANDS_POLL_MS })

// Research
export const useRegistry = () => useApiQuery('/api/registry', {})
export const useHypotheses = () => useApiQuery('/api/hypotheses', {})
export const useMultipleTesting = () => useApiQuery('/api/multiple-testing', {})
/** SV3 over every registered hypothesis on the common Basis A daily construction (SV3a); [POST HOC], no verdict. */
export const useDeflated = (enabled = true) => useApiQuery('/api/analytics/deflated', {}, { enabled })
export const useConfirmations = () => useApiQuery('/api/confirmations', {})

// Runs and ledger
export const useRuns = () => useApiQuery('/api/runs', {})
export const useRun = (runId: string) =>
  useApiQuery('/api/runs/{run_id}', { path: { run_id: runId } }, { enabled: hasId(runId) })
export const useLedger = () => useApiQuery('/api/ledger', {})

// Audit
export type OosLogQuery = NonNullable<RequestOf<'/api/audit/oos-log'>['query']>
export const useOosLog = (query: OosLogQuery = {}) => useApiQuery('/api/audit/oos-log', { query })
export const useOpenings = () => useApiQuery('/api/audit/openings', {})

// Live (read only; streamed while LIVE or JRNL is open, polled otherwise): the rest are in queries.screens.ts
export const useLiveStatus = () => useApiQuery('/api/live/status', {}, useLive())
