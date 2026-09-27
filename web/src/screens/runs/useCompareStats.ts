// Sharpe and max drawdown for the RUNS table (ARCHITECTURE section 4, item c of the Phase 3 improvement
// run): GET /api/runs/stats serves the compare view's stats (the tear sheet's own Basis B series) without
// the equity curves, for any number of runs, so RUNS, the compare view and the tear sheet show one value
// per run. `ids` has a 2000-character limit, so the readable runs are asked for in as few GETs as fit it.
// An unreadable run is left out (it has no series).
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, apiGet } from '../../api/client'
import { apiQueryKey } from '../../api/queries'
import { compareChunks, compareGroups, statsById, type CompareStats, type RunSummary } from './model'

type Stats = readonly CompareStats[]

export interface CompareStatsResult {
  readonly stats: ReadonlyMap<string, CompareStats>
  readonly pending: boolean
  readonly error: { readonly detail: string } | null
}

interface Combined {
  readonly pages: ReadonlyArray<readonly CompareStats[]>
  readonly pending: boolean
  readonly error: { readonly detail: string } | null
}

function detailOf(error: Error | null): { readonly detail: string } | null {
  if (error === null) return null
  return error instanceof ApiError ? error : { detail: error.message }
}

function combine(results: ReadonlyArray<UseQueryResult<Stats>>): Combined {
  return {
    pages: results.map((r) => r.data ?? []),
    pending: results.some((r) => r.isPending),
    error: detailOf(results.find((r) => r.error !== null)?.error ?? null),
  }
}

/** A backend started before `/api/runs/stats` existed answers it as an unknown run (404): the same stats
 * then come from `/api/runs/compare`, in groups of 2 to 8 runs. */
async function olderStats(ids: readonly string[], signal: AbortSignal): Promise<Stats> {
  const pages = await Promise.all(compareGroups(ids).map((group) =>
    apiGet('/api/runs/compare', { query: { ids: group.join(',') } }, { signal })))
  return pages.flatMap((p) => p.stats)
}

function query(ids: readonly string[]) {
  const request = { query: { ids: ids.join(',') } }
  return {
    queryKey: apiQueryKey('/api/runs/stats', request),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Stats> => {
      try {
        return await apiGet('/api/runs/stats', request, { signal })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return olderStats(ids, signal)
        throw error
      }
    },
  }
}

export function useCompareStats(runs: readonly RunSummary[]): CompareStatsResult {
  const chunks = useMemo(() => compareChunks(runs.filter((r) => r.readable).map((r) => r.run_id)), [runs])
  const combined = useQueries({ queries: chunks.map(query), combine })
  const stats = useMemo(() => statsById(combined.pages), [combined.pages])
  return { stats, pending: combined.pending, error: combined.error }
}
