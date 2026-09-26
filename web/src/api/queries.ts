// react-query hooks for the P0 endpoints (ARCHITECTURE section 4). Every hook is a GET through apiGet.
// Hooks that take an id stay idle (no request) until the id is non-empty, so a panel whose link group has
// no context yet fetches nothing. Live endpoints poll every LIVE_POLL_MS (P0 uses polling; SSE is P1).
import { QueryClient, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from './client'
import type { ApiPath, GetArgs, RequestOf, Schemas, SuccessOf } from './types'

export const LIVE_POLL_MS = 2000
export const STALE_MS = 30_000
export const RETRY_DELAY_MS = 500
/** The command index is re-read this often, so a run or hypothesis added on disk becomes a context. */
export const COMMANDS_POLL_MS = 60_000
const MAX_RETRIES = 1

export type ApiQueryKey<P extends ApiPath> = readonly ['api', P, RequestOf<P> | Record<string, never>]

export interface ApiQueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number | false
  readonly staleTime?: number
}

export interface PageQuery {
  readonly offset?: number
  readonly limit?: number
}

export function apiQueryKey<P extends ApiPath>(path: P, request?: RequestOf<P>): ApiQueryKey<P> {
  return ['api', path, request ?? {}]
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
  })
}

const live: ApiQueryOptions = { refetchInterval: LIVE_POLL_MS, staleTime: 0 }
const hasId = (...ids: ReadonlyArray<string>): boolean => ids.every((id) => id.trim() !== '')

// System
export const useHealth = () => useApiQuery('/api/health', {}, live)
export const useCommands = () => useApiQuery('/api/commands', {}, { refetchInterval: COMMANDS_POLL_MS })

// Research
export const useRegistry = () => useApiQuery('/api/registry', {})
export const useHypotheses = () => useApiQuery('/api/hypotheses', {})
export const useHypothesis = (name: string) =>
  useApiQuery('/api/hypotheses/{name}', { path: { name } }, { enabled: hasId(name) })
export const useHypothesisSeries = (name: string, cost: number) =>
  useApiQuery('/api/hypotheses/{name}/series', { path: { name }, query: { cost } }, { enabled: hasId(name) })
export const useMultipleTesting = () => useApiQuery('/api/multiple-testing', {})
export const useConfirmations = () => useApiQuery('/api/confirmations', {})
export const useSealedIndex = () => useApiQuery('/api/sealed', {})
export const useSealedFile = (name: string) =>
  useApiQuery('/api/sealed/{name}', { path: { name } }, { enabled: hasId(name) })

// Runs and ledger
export const useRuns = () => useApiQuery('/api/runs', {})
export const useRun = (runId: string) =>
  useApiQuery('/api/runs/{run_id}', { path: { run_id: runId } }, { enabled: hasId(runId) })
export const useRunEquity = (runId: string) =>
  useApiQuery('/api/runs/{run_id}/equity', { path: { run_id: runId } }, { enabled: hasId(runId) })
export const useRunTrades = (runId: string, page: PageQuery = {}) =>
  useApiQuery('/api/runs/{run_id}/trades', { path: { run_id: runId }, query: page }, { enabled: hasId(runId) })
export const useRunFills = (runId: string, page: PageQuery = {}) =>
  useApiQuery('/api/runs/{run_id}/fills', { path: { run_id: runId }, query: page }, { enabled: hasId(runId) })
export const useRunLog = (runId: string, section: Schemas['LogSection'], page: PageQuery = {}) =>
  useApiQuery(
    '/api/runs/{run_id}/log/{section}',
    { path: { run_id: runId, section }, query: page },
    { enabled: hasId(runId) },
  )
export const useRunSidecar = (runId: string, name: string) =>
  useApiQuery('/api/runs/{run_id}/sidecar/{name}', { path: { run_id: runId, name } }, { enabled: hasId(runId, name) })
export const useRunsCompare = (runIds: ReadonlyArray<string>) =>
  useApiQuery(
    '/api/runs/compare',
    { query: { ids: runIds.join(',') } },
    { enabled: runIds.length > 0 && hasId(...runIds) },
  )
export const useLedger = () => useApiQuery('/api/ledger', {})

// Market data (every price read goes through the backend's gate)
export type BarsQuery = NonNullable<RequestOf<'/api/bars'>['query']>
export const useBars = (query: BarsQuery) => useApiQuery('/api/bars', { query }, { enabled: hasId(query.symbol) })
export const useCatalog = () => useApiQuery('/api/data/catalog', {})
export const useUniverse = (window?: number) => useApiQuery('/api/market/universe', { query: { window } })
export const usePairCorr = (a: string, b: string, window?: number) =>
  useApiQuery('/api/market/pair-corr', { query: { a, b, window } }, { enabled: hasId(a, b) })
export const useQaIndex = () => useApiQuery('/api/qa', {})
export const useQaReport = (name: string) =>
  useApiQuery('/api/qa/{name}', { path: { name } }, { enabled: hasId(name) })

// Audit
export type OosLogQuery = NonNullable<RequestOf<'/api/audit/oos-log'>['query']>
export const useOosLog = (query: OosLogQuery = {}) => useApiQuery('/api/audit/oos-log', { query })
export const useOpenings = () => useApiQuery('/api/audit/openings', {})
export const useSpecHashes = () => useApiQuery('/api/audit/spec-hashes', {})

// Live (read only, polled)
export type JournalQuery = NonNullable<RequestOf<'/api/live/journal'>['query']>
export const useLiveStatus = () => useApiQuery('/api/live/status', {}, live)
export const useLiveJournal = (query: JournalQuery = {}) => useApiQuery('/api/live/journal', { query }, live)
export const useLiveLog = (file: string, tail?: number) =>
  useApiQuery('/api/live/log', { query: { file, tail } }, { ...live, enabled: hasId(file) })
export const useLivePerformance = (file?: string) =>
  useApiQuery('/api/live/performance', { query: { file } }, live)
