// GET /api/hypotheses/{name} fanned out over a list of names (REG's evidence matrix, later cost
// survival), on exactly useHypothesis's own query key so the two share one cache entry per name. Read
// only while its caller says so (needsDetails(view)), so the board view asks for nothing extra.
import { useCallback } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from '../../api/client'
import { apiQueryKey } from '../../api/queries'
import type { Schemas } from '../../api/types'

export type HypothesisDetail = Schemas['HypothesisDetail']

export interface HypothesisDetails {
  readonly byName: ReadonlyMap<string, HypothesisDetail>
  readonly failed: ReadonlyMap<string, string>
  /** Names asked for and neither answered nor failed yet (still loading). 0 while enabled is false,
   *  since nothing is asked then. */
  readonly pending: number
}

const EMPTY: HypothesisDetails = { byName: new Map(), failed: new Map(), pending: 0 }

function detailOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  return error instanceof Error ? error.message : String(error)
}

/**
 * `useHypothesisDetails(names, enabled)`: one GET per name while `enabled`, sharing useHypothesis's
 * cache entry (identical queryKey). `enabled` false builds no query and makes no request at all,
 * whatever `names` holds.
 */
export function useHypothesisDetails(names: readonly string[], enabled: boolean): HypothesisDetails {
  const combine = useCallback(
    (results: ReadonlyArray<UseQueryResult<HypothesisDetail>>): HypothesisDetails => {
      if (!enabled || names.length === 0) return EMPTY
      const byName = new Map<string, HypothesisDetail>()
      const failed = new Map<string, string>()
      let pending = 0
      results.forEach((result, i) => {
        const name = names[i]
        if (name === undefined) return
        if (result.data !== undefined) byName.set(name, result.data)
        else if (result.error) failed.set(name, detailOf(result.error))
        else pending += 1
      })
      return { byName, failed, pending }
    },
    [names, enabled],
  )
  return useQueries({
    // No query at all while disabled: a disabled query still sits in the cache, where the connection
    // supervisor's retry count and every cache-wide read would see it.
    queries: enabled ? names.map((name) => ({
      queryKey: apiQueryKey('/api/hypotheses/{name}', { path: { name } }),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet('/api/hypotheses/{name}', { path: { name } }, { signal }),
      enabled: name.trim() !== '',
    })) : [],
    combine,
  })
}
