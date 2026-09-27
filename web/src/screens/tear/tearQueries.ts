// The tear sheet's GETs (ARCHITECTURE section 4, Analytics). src/api/queries.ts has no analytics hooks
// yet, so they are built here on its useApiQuery; each stays idle until its id is known, so a panel
// fetches only what it shows. A hypothesis first reads its recorded costs (the card's series_costs)
// and asks for 1 tick when the screen recorded it, else the first recorded cost.
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApiError } from '../../api/client'
import { useApiQuery, useHypothesis } from '../../api/queries'
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

export interface RecordedCosts {
  readonly costs: readonly number[]
  readonly error: ApiError | null
}

/** The costs a hypothesis recorded, from its card; empty until the card arrives. */
export function useRecordedCosts(target: TearTarget): RecordedCosts {
  const query = useHypothesis(target.kind === 'hypothesis' ? target.name : '')
  return { costs: query.data?.card.series_costs ?? NO_COSTS, error: query.error }
}

export function useTearAnalytics(target: TearTarget, freq: Freq, cost: number | null): UseQueryResult<Analytics, ApiError> {
  const isRun = target.kind === 'run'
  const run = useApiQuery(
    '/api/analytics/run/{run_id}',
    { path: { run_id: target.name }, query: { freq } },
    { enabled: isRun && target.name !== '' },
  )
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: !isRun && target.name !== '' && cost !== null },
  )
  return isRun ? run : hypothesis
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
