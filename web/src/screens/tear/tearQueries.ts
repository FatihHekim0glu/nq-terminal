// The tear sheet's GETs (ARCHITECTURE section 4, Analytics). src/api/queries.ts has no analytics hooks
// yet, so they are built here on its useApiQuery; each stays idle until its id is known, so a panel
// fetches only what it shows. A hypothesis first reads its recorded costs (the card's series_costs)
// and asks for 1 tick when the screen recorded it, else the first recorded cost. A run first reads its
// own record (GET /api/runs/{id}): when its balance check failed (rule 4) the analytics route is never
// asked, since it would only answer 422.
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApiError } from '../../api/client'
import { useApiQuery, useRun } from '../../api/queries'
import { useHypothesis } from '../../api/queries.screens'
import type { Schemas } from '../../api/types'
import type { Analytics } from './tearKpis'

export type Freq = 'D' | 'M'
export type TearKind = 'run' | 'hypothesis'

export interface TearTarget {
  readonly kind: TearKind
  readonly name: string
}

/** The project's standard cost, 1 tick per side, when the screen recorded it. */
export const DEFAULT_COST = 1

export function defaultCost(costs: readonly number[]): number | null {
  if (costs.includes(DEFAULT_COST)) return DEFAULT_COST
  return costs[0] ?? null
}

const NO_COSTS: readonly number[] = []

export type HypothesisCard = Schemas['HypothesisCard']

export interface RecordedCosts {
  readonly costs: readonly number[]
  /** The hypothesis card the costs were read from (its spec hash goes on GRAB's caption); null until it arrives, and for a run. */
  readonly card: HypothesisCard | null
  readonly error: ApiError | null
  /** The card arrived and records no series: the analytics route is never asked, nothing is pending. */
  readonly noSeries: boolean
  /** For a check row (a check inside another spec, with no series of its own), the spec it belongs to. */
  readonly parent: string | null
}

/** The costs a hypothesis recorded, from its card; empty until the card arrives. */
export function useRecordedCosts(target: TearTarget): RecordedCosts {
  const query = useHypothesis(target.kind === 'hypothesis' ? target.name : '')
  const card = query.data?.card
  const noSeries = card !== undefined && card.series_costs.length === 0
  const parent = noSeries && card.tag === 'check' && card.spec !== '' && card.spec !== card.name ? card.spec : null
  return { costs: card?.series_costs ?? NO_COSTS, card: card ?? null, error: query.error, noSeries, parent }
}

export interface TearAnalytics {
  readonly data: Analytics | undefined
  readonly error: ApiError | null
  /** The run's own record says its balance check failed (rule 4); nothing was asked of analytics. */
  readonly unusable: boolean
}

export function useTearAnalytics(target: TearTarget, freq: Freq, cost: number | null): TearAnalytics {
  const isRun = target.kind === 'run'
  const record = useRun(isRun ? target.name : '')
  const unusable = isRun && record.data?.summary.balance_ok === false
  const known = record.data !== undefined && !unusable
  const run = useApiQuery(
    '/api/analytics/run/{run_id}',
    { path: { run_id: target.name }, query: { freq } },
    { enabled: isRun && target.name !== '' && known },
  )
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: !isRun && target.name !== '' && cost !== null },
  )
  if (!isRun) return { data: hypothesis.data, error: hypothesis.error, unusable: false }
  return { data: run.data, error: record.error ?? run.error, unusable }
}

export interface RunBooks {
  readonly trades: UseQueryResult<Schemas['RunTrades'], ApiError>
  readonly costs: UseQueryResult<Schemas['RunCosts'], ApiError>
  readonly exposure: UseQueryResult<Schemas['RunExposure'], ApiError>
}

/** Trades, costs and exposure of a run; asked for only once its tear sheet has answered. */
export function useRunBooks(runId: string, enabled: boolean): RunBooks {
  const on = { enabled: enabled && runId !== '' }
  const path = { path: { run_id: runId } }
  return {
    trades: useApiQuery('/api/analytics/run/{run_id}/trades', path, on),
    costs: useApiQuery('/api/analytics/run/{run_id}/costs', path, on),
    exposure: useApiQuery('/api/analytics/run/{run_id}/exposure', path, on),
  }
}

// ---------------------------------------------------------------- P1 (TASKS Phase 10 on screen)

export type Extended = Schemas['ExtendedAnalytics']
export type Bootstrap = Schemas['BootstrapView']

export interface TearP1Query<T> {
  readonly data: T | undefined
  readonly error: ApiError | null
}

/** One P1 view of the tear sheet's own series (the run at its Freq, the hypothesis at its Cost); idle until on. */
function useTearP1<T>(
  run: UseQueryResult<T, ApiError>,
  hypothesis: UseQueryResult<T, ApiError>,
  target: TearTarget,
): TearP1Query<T> {
  const q = target.kind === 'run' ? run : hypothesis
  return { data: q.data, error: q.error }
}

/** PF7 to PF9, RK3, RL3, RL4, BR3, BR4, RD4, RK5 and RG1 of the series the tab shows. */
export function useTearExtended(target: TearTarget, freq: Freq, cost: number | null, enabled: boolean): TearP1Query<Extended> {
  const isRun = target.kind === 'run'
  const run = useApiQuery('/api/analytics/run/{run_id}/extended', { path: { run_id: target.name }, query: { freq } }, { enabled: enabled && isRun && target.name !== '' })
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}/extended',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: enabled && !isRun && target.name !== '' && cost !== null },
  )
  return useTearP1(run, hypothesis, target)
}

/**
 * The fewest observations the bootstrap routes accept (the backend's analytics.bootstrap.MIN_N; a backend test,
 * test_p1_web_bootstrap_minimum.py, keeps the two equal). Below it the API answers 422, so the tear sheet does
 * not ask and says why instead.
 */
export const BOOTSTRAP_MIN_N = 30

/** Whether a series of n observations can have a bootstrap. */
export function bootstrapPossible(n: number): boolean {
  return n >= BOOTSTRAP_MIN_N
}

/** SV5 intervals and the SV6 cone of the series the tab shows. */
export function useTearBootstrap(target: TearTarget, freq: Freq, cost: number | null, enabled: boolean): TearP1Query<Bootstrap> {
  const isRun = target.kind === 'run'
  const run = useApiQuery('/api/analytics/run/{run_id}/bootstrap', { path: { run_id: target.name }, query: { freq } }, { enabled: enabled && isRun && target.name !== '' })
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}/bootstrap',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: enabled && !isRun && target.name !== '' && cost !== null },
  )
  return useTearP1(run, hypothesis, target)
}

export type TrendRegime = Schemas['TrendRegimeView']

/**
 * RG2 of the series the tab shows. A hypothesis is asked at its cost (a monthly book answers `available: false` with
 * the reason); a run is asked only at the daily frequency, since the route has no monthly view.
 */
export function useTearTrend(target: TearTarget, freq: Freq, cost: number | null, enabled: boolean): TearP1Query<TrendRegime> {
  const isRun = target.kind === 'run'
  const run = useApiQuery('/api/analytics/run/{run_id}/trend-regime', { path: { run_id: target.name } }, { enabled: enabled && isRun && target.name !== '' && freq === 'D' })
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}/trend-regime',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: enabled && !isRun && target.name !== '' && cost !== null },
  )
  return useTearP1(run, hypothesis, target)
}

/** EX5 of a run (contracts per session over the session's volume); the route refuses an unbalanced run (422). */
export function useRunCapacity(runId: string, enabled: boolean) {
  return useApiQuery('/api/analytics/run/{run_id}/capacity', { path: { run_id: runId } }, { enabled: enabled && runId !== '' })
}

/** TA2 (MAE and MFE over the run's own gated 1m bars) and TA4, TA5 (holding times, streaks) of a run. */
export function useRunPaths(runId: string, enabled: boolean) {
  const on = { enabled: enabled && runId !== '' }
  const path = { path: { run_id: runId } }
  return {
    excursions: useApiQuery('/api/analytics/run/{run_id}/excursions', path, on),
    paths: useApiQuery('/api/analytics/run/{run_id}/trade-paths', path, on),
  }
}
