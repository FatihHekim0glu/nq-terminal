// react-query hooks for the P0 endpoints (ARCHITECTURE section 4). Every hook is a GET through apiGet.
// Hooks that take an id stay idle (no request) until the id is non-empty, so a panel whose link group has
// no context yet fetches nothing. Live endpoints follow the live stream (TASKS 9.2, src/api/useLiveStream.ts):
// while it is open they never poll and the stream refreshes them; otherwise they poll every LIVE_POLL_MS as in P0.
import { QueryClient, keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from './client'
import { LIVE_POLL_MS, apiQueryKey, type ApiQueryKey } from './queryKey'
import type { ApiPath, GetArgs, RequestOf, Schemas, SuccessOf } from './types'
import { useLivePollInterval } from './useLiveStream'

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
    ...(options.keepPreviousData ? { placeholderData: keepPreviousData } : {}),
  })
}

const live: ApiQueryOptions = { refetchInterval: LIVE_POLL_MS, staleTime: 0 }
/** A live endpoint: no polling while the stream is open (it refreshes these), P0's polling otherwise. */
function useLive(extra: ApiQueryOptions = {}): ApiQueryOptions {
  return { ...live, ...extra, refetchInterval: useLivePollInterval() }
}
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
/** SV3 over every registered hypothesis on the common Basis A daily construction (SV3a); [POST HOC], no verdict. */
export const useDeflated = (enabled = true) => useApiQuery('/api/analytics/deflated', {}, { enabled })
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
export const useRunStats = (runIds: ReadonlyArray<string>) =>
  useApiQuery('/api/runs/stats', { query: { ids: runIds.join(',') } }, { enabled: runIds.length > 0 && hasId(...runIds) })
export const useLedger = () => useApiQuery('/api/ledger', {})

// Market data (every price read goes through the backend's gate)
export type BarsQuery = NonNullable<RequestOf<'/api/bars'>['query']>
export const useBars = (query: BarsQuery) => useApiQuery('/api/bars', { query }, { enabled: hasId(query.symbol) })
export const useCatalog = () => useApiQuery('/api/data/catalog', {})
export const useUniverse = (window?: number) => useApiQuery('/api/market/universe', { query: { window } })
export const usePairCorr = (a: string, b: string, window?: number) =>
  useApiQuery('/api/market/pair-corr', { query: { a, b, window } }, { enabled: hasId(a, b) })
/** GP's RV22 indicator pane (MV3): one universe symbol's rolling realised volatility to 2021-12-31. */
export const useMarketRv = (symbol: string, window: number) =>
  useApiQuery('/api/market/rv', { query: { symbol, window } }, { enabled: hasId(symbol) })
/** MON's 2Day sparklines: ask only for the symbols on screen (each is one gated 1m read in the backend). */
export const useTwoDay = (symbols: ReadonlyArray<string>) =>
  useApiQuery('/api/market/two-day', { query: { symbols: symbols.join(',') } }, { enabled: symbols.length > 0 && hasId(...symbols) })
/** The instrument DES tabs: contract, month codes, related dates, coverage and notes; no price is read. */
export const useInstrument = (root: string) =>
  useApiQuery('/api/instruments/{root}', { path: { root } }, { enabled: hasId(root) })
export const useQaIndex = () => useApiQuery('/api/qa', {})
export const useQaReport = (name: string) =>
  useApiQuery('/api/qa/{name}', { path: { name } }, { enabled: hasId(name) })

// Audit
export type OosLogQuery = NonNullable<RequestOf<'/api/audit/oos-log'>['query']>
export const useOosLog = (query: OosLogQuery = {}) => useApiQuery('/api/audit/oos-log', { query })
export const useOpenings = () => useApiQuery('/api/audit/openings', {})
export const useSpecHashes = () => useApiQuery('/api/audit/spec-hashes', {})

// Live (read only; streamed while LIVE or JRNL is open, polled otherwise)
export type JournalQuery = NonNullable<RequestOf<'/api/live/journal'>['query']>
export const useLiveStatus = () => useApiQuery('/api/live/status', {}, useLive())
export const useLiveJournal = (query: JournalQuery = {}) => useApiQuery('/api/live/journal', { query }, useLive())
export const useLiveLog = (file: string, tail?: number) =>
  useApiQuery('/api/live/log', { query: { file, tail } }, useLive({ enabled: hasId(file) }))
export const useLivePerformance = (file?: string) =>
  useApiQuery('/api/live/performance', { query: { file } }, useLive())
/** LIVE's Routes and Fills sections from the book journal's close rows (read only: there is no order path). */
export const useLiveRoutes = (file?: string) => useApiQuery('/api/live/routes', { query: { file } }, useLive())
/** LV5: paper P&L against the rule's target on the same closes (performance rows only). */
export const usePaperTracking = (file?: string) =>
  useApiQuery('/api/analytics/paper-tracking', { query: { file } }, useLive())

// Phase 11: VCONE, SEAS, EVT and ROLL read prices only through the backend's gate; DQ reads the QA, repair and
// guard records (no price). Every body is [POST HOC] descriptive, with no p-value.
/** VCONE (MV9): one universe symbol's cone; idle until the symbol is known. */
export const useVolCone = (symbol: string) =>
  useApiQuery('/api/market/vcone', { query: { symbol } }, { enabled: hasId(symbol) })
/** VCONE's 27 futures at one horizon (the small multiples). */
export const useVolConeUniverse = (horizon: number, enabled = true) =>
  useApiQuery('/api/market/vcone/universe', { query: { horizon } }, { enabled })

export type SeasonalityInstrumentQuery = NonNullable<RequestOf<'/api/seasonality/instrument/{root}'>['query']>
export type SeasonalityHypothesisQuery = NonNullable<RequestOf<'/api/seasonality/hypothesis/{name}'>['query']>
/** SEAS (MV7) for a universe root or a registered hypothesis. */
export type SeasonalityRequest =
  | { readonly kind: 'instrument'; readonly root: string; readonly query: SeasonalityInstrumentQuery }
  | { readonly kind: 'hypothesis'; readonly name: string; readonly query: SeasonalityHypothesisQuery }
/** Exactly one of the two GETs is live, by kind; with no request both stay idle. */
export function useSeasonality(request: SeasonalityRequest | null): UseQueryResult<Schemas['Seasonality'], ApiError> {
  const root = request?.kind === 'instrument' ? request.root : ''
  const name = request?.kind === 'hypothesis' ? request.name : ''
  const instrument = useApiQuery(
    '/api/seasonality/instrument/{root}',
    { path: { root }, query: request?.kind === 'instrument' ? request.query : {} },
    { enabled: hasId(root) },
  )
  const hypothesis = useApiQuery(
    '/api/seasonality/hypothesis/{name}',
    { path: { name }, query: request?.kind === 'hypothesis' ? request.query : {} },
    { enabled: hasId(name) },
  )
  return request?.kind === 'hypothesis' ? hypothesis : instrument
}

/** EVT (MV8): the fixed event lists and the instruments the study accepts; no price is read. */
export const useEventCalendar = () => useApiQuery('/api/events/calendar', {})
export type EventStudyQuery = NonNullable<RequestOf<'/api/events/study'>['query']>
export const useEventStudy = (query: EventStudyQuery, enabled = true) =>
  useApiQuery('/api/events/study', { query }, { enabled })

/** ROLL (MV10): every in-sample roll of the 27 futures. */
export const useRollCalendar = () => useApiQuery('/api/market/rolls', {})
export type PaperRollsQuery = NonNullable<RequestOf<'/api/market/paper-rolls'>['query']>
/** The paper book's MNQ roll schedule: calendar arithmetic, dates only. */
export const usePaperRolls = (query: PaperRollsQuery, enabled = true) =>
  useApiQuery('/api/market/paper-rolls', { query }, { enabled })

/** DQ (RI4, RI5): the records only. */
export const useDqSymbols = () => useApiQuery('/api/dq/symbols', {})
export const useDqCalendar = (symbol: string) =>
  useApiQuery('/api/dq/calendar/{symbol}', { path: { symbol } }, { enabled: hasId(symbol) })
export const useDqGuards = (enabled = true) => useApiQuery('/api/dq/guards', {}, { enabled })
