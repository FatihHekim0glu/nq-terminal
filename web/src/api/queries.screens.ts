// The screens' react-query hooks (ARCHITECTURE section 4), kept out of queries.ts so the first-paint shell,
// which holds that file, does not carry them: every hook here is read only by a screen that loads with the
// Workspace chunk. Same rules as queries.ts: each is a GET through useApiQuery, and an id-taking hook stays
// idle until its id is non-empty. Nothing in the shell may import this file (scripts/shellBudget.test.ts).
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApiError } from './client'
import { hasId, useApiQuery, useLive, type PageQuery } from './queries'
import type { RequestOf, Schemas } from './types'

// Research
export const useHypothesis = (name: string) =>
  useApiQuery('/api/hypotheses/{name}', { path: { name } }, { enabled: hasId(name) })
export const useHypothesisSeries = (name: string, cost: number) =>
  useApiQuery('/api/hypotheses/{name}/series', { path: { name }, query: { cost } }, { enabled: hasId(name) })
export const useSealedIndex = () => useApiQuery('/api/sealed', {})
export const useSealedFile = (name: string) =>
  useApiQuery('/api/sealed/{name}', { path: { name } }, { enabled: hasId(name) })

// Runs
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
export const useSpecHashes = () => useApiQuery('/api/audit/spec-hashes', {})

// Live (read only; streamed while LIVE or JRNL is open, polled otherwise)
export type JournalQuery = NonNullable<RequestOf<'/api/live/journal'>['query']>
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

/** SV8: the SPA, Reality Check and StepM family test (MT 88), [POST HOC]; asked only once its tab is open. */
export const useSpa = (enabled = true) => useApiQuery('/api/analytics/spa', {}, { enabled })

/** MV6: the term structure of one market from its calendar chains (ROLL 2) Market); [POST HOC], through the gate. */
export const useTermStructure = (root: string, enabled = true) =>
  useApiQuery('/api/market/term-structure/{root}', { path: { root } }, { enabled: enabled && hasId(root) })

/** DQ (RI4, RI5): the records only. */
export const useDqSymbols = () => useApiQuery('/api/dq/symbols', {})
export const useDqCalendar = (symbol: string) =>
  useApiQuery('/api/dq/calendar/{symbol}', { path: { symbol } }, { enabled: hasId(symbol) })
export const useDqGuards = (enabled = true) => useApiQuery('/api/dq/guards', {}, { enabled })
