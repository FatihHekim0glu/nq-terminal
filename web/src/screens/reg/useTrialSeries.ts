// The daily trials' series for MT 87) Effective trials (ANALYTICS_CATALOG SV3b): one GET per trial,
// /api/analytics/hypothesis/{name} at cost 1 (the one cost every screen records, TRIAL_COST), read on the tear
// sheet's own query key { path: { name }, query: { cost } } so a tear sheet already open (or opened later) shares the
// cache entry instead of asking twice. Only distribution.series (date, r) is kept. Nothing is asked until `enabled`
// (the panel enables it once the SV3 view has named its daily trials, and the panel itself mounts only after 87 is
// selected). A failed read keeps its reason; a body without session returns, or with dates and returns of unequal
// length, is failed with EFFECTIVE_N.malformed. GET only, through src/api.
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, apiGet } from '../../api/client'
import { apiQueryKey } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { TRIAL_COST, type TrialSeries } from './effectiveNModel'

const PATH = '/api/analytics/hypothesis/{name}' as const

interface SeriesBody {
  readonly date: readonly string[]
  readonly r: readonly (number | null)[]
}

/** The session returns of a served body, or null when it holds none (or its dates and returns do not pair up). */
function bodyOf(analytics: Schemas['Analytics']): SeriesBody | null {
  const distribution = (analytics as { distribution?: Schemas['DistributionView'] } | null)?.distribution
  const series = distribution?.series
  if (series === undefined || !Array.isArray(series.date) || !Array.isArray(series.r)) return null
  if (series.date.length !== series.r.length) return null
  return { date: series.date, r: series.r }
}

type Item =
  | { readonly state: 'pending' }
  | { readonly state: 'ok'; readonly body: SeriesBody }
  | { readonly state: 'failed'; readonly detail: string }

const PENDING: Item = { state: 'pending' }
const MALFORMED: Item = { state: 'failed', detail: EFFECTIVE_N.malformed }

function detailOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  return error instanceof Error ? error.message : String(error)
}

/**
 * Data comes before error: a background refetch that fails keeps the series it had (TanStack sets isError and keeps
 * data), and those cached series are still valid. The panel's anchor, basis and Sharpe checks run against the current
 * SV3 view, so a stale series cannot slip through.
 */
function itemOf(result: UseQueryResult<SeriesBody | null, Error>): Item {
  if (result.data !== undefined) return result.data === null ? MALFORMED : { state: 'ok', body: result.data }
  if (result.isError) return { state: 'failed', detail: detailOf(result.error) }
  return PENDING
}

/** Module scope, so useQueries keeps one combined result until a query changes. */
function combine(results: UseQueryResult<SeriesBody | null, Error>[]): readonly Item[] {
  return results.map(itemOf)
}

export interface TrialSeriesResult {
  /** The series that were read, in the order of `names`. */
  readonly series: readonly TrialSeries[]
  /** The trials whose series could not be read, in the order of `names`, with the reason. */
  readonly failed: ReadonlyMap<string, string>
  /** Trials answered so far (read or failed). */
  readonly done: number
  /** Trials asked for. */
  readonly total: number
}

export function useTrialSeries(names: readonly string[], enabled: boolean): TrialSeriesResult {
  const items = useQueries({
    queries: names.map((name) => {
      const request = { path: { name }, query: { cost: TRIAL_COST } }
      return {
        queryKey: apiQueryKey(PATH, request),
        queryFn: ({ signal }: { signal: AbortSignal }) => apiGet(PATH, request, { signal }),
        select: bodyOf,
        enabled,
      }
    }),
    combine,
  })
  return useMemo(() => {
    const series: TrialSeries[] = []
    const failed = new Map<string, string>()
    let done = 0
    items.forEach((item, i) => {
      const name = names[i] as string
      if (item.state === 'pending') return
      done += 1
      if (item.state === 'ok') series.push({ name, date: item.body.date, r: item.body.r })
      else failed.set(name, item.detail)
    })
    return { series, failed, done, total: names.length }
  }, [items, names])
}
