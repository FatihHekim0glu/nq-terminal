// The PLAN query: GET /api/analytics/plan with the typed design as its query string (api/analytics.py). One request per
// distinct query, kept for the stale time, and the previous answer stays on screen while the next is worked out so the
// tables do not flash as a number is edited. A null query asks nothing. The request is a read: no price and no result
// file is touched by it.
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from '../../api/client'
import { STALE_MS } from '../../api/queries'
import { PLAN } from '../../copy/plan'
import type { PlanQuery, ServedPlan } from './planTypes'

export const PLAN_PATH = '/api/analytics/plan'

function isServedPlan(value: unknown): value is ServedPlan {
  if (value === null || typeof value !== 'object') return false
  const plan = value as Partial<ServedPlan>
  return typeof plan.n === 'number' && Array.isArray(plan.slots) && typeof plan.nominal === 'object' && plan.nominal !== null
}

async function fetchPlan(query: PlanQuery, signal: AbortSignal): Promise<ServedPlan> {
  const body = await apiGet(PLAN_PATH, { query: { ...query } }, { signal })
  if (!isServedPlan(body)) throw new ApiError({ kind: 'decode', path: PLAN_PATH, detail: PLAN.malformed })
  return body
}

export function usePlan(query: PlanQuery | null): UseQueryResult<ServedPlan, ApiError> {
  return useQuery<ServedPlan, ApiError>({
    queryKey: ['api', PLAN_PATH, query ?? {}],
    queryFn: ({ signal }) => fetchPlan(query as PlanQuery, signal),
    enabled: query !== null,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  })
}
