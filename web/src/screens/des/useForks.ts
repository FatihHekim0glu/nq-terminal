// Fork analytics queries (roadmap #4 DES robustness, slice 2 of 3): one GET per fork spec, keyed and
// shaped exactly as tearQueries' own hypothesis and run analytics requests, so a screen fork shares its
// cache with the tear sheet and a Sharpe interval never diverges by request shape. A run id a server
// returned reaches only apiGet's path parameters (buildApiUrl), never a hand-built URL string.
import { useQueries, type QueryFunction } from '@tanstack/react-query'
import { ApiError, apiGet } from '../../api/client'
import { apiQueryKey, type ApiQueryKey } from '../../api/queries'
import type { Analytics } from '../tear/tearKpis'
import { forkPoint, type ForkPoint, type ForkSpec } from './forkModel'

function screenRequest(spec: ForkSpec) {
  return { path: { name: spec.name }, query: spec.cost === null ? {} : { cost: spec.cost } }
}

function runRequest(spec: ForkSpec) {
  return { path: { run_id: spec.name }, query: { freq: spec.freq ?? 'D' } }
}

function analyticsQueryKey(spec: ForkSpec): ApiQueryKey<'/api/analytics/hypothesis/{name}'> | ApiQueryKey<'/api/analytics/run/{run_id}'> {
  if (spec.engine === 'screen') return apiQueryKey('/api/analytics/hypothesis/{name}', screenRequest(spec))
  return apiQueryKey('/api/analytics/run/{run_id}', runRequest(spec))
}

const analyticsQueryFn = (spec: ForkSpec): QueryFunction<Analytics> => ({ signal }) => (
  spec.engine === 'screen'
    ? apiGet('/api/analytics/hypothesis/{name}', screenRequest(spec), { signal })
    : apiGet('/api/analytics/run/{run_id}', runRequest(spec), { signal })
)

function errorOf(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null
}

/**
 * One analytics fetch per fork spec (a screen fork asks the hypothesis route at its cost, a run fork
 * the run route at its frequency), combined into ForkPoints in spec order. Idle work: with no specs,
 * useQueries asks nothing.
 */
export function useForkPoints(specs: readonly ForkSpec[]): readonly ForkPoint[] {
  return useQueries({
    queries: specs.map((spec) => ({
      queryKey: analyticsQueryKey(spec),
      queryFn: analyticsQueryFn(spec),
    })),
    combine: (results): readonly ForkPoint[] =>
      results.map((r, i) => forkPoint(specs[i]!, r.data, errorOf(r.error))),
  })
}
