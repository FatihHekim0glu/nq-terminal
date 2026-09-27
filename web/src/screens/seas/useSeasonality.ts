// The SEAS query (TASKS Phase 11): the screen's request state mapped onto the shared, typed hook in
// src/api/queries.ts (one GET through apiGet: GET only, same origin, X-NQT-Client header).
import { useSeasonality as useSeasonalityQuery, type SeasonalityRequest } from '../../api/queries'
import type { SeasQuery } from './types'

/** The request for a query: variant only for instruments (null asks for the API's default), cost only for hypotheses. */
export function seasRequest(q: SeasQuery): SeasonalityRequest {
  const years = { start_year: q.startYear, end_year: q.endYear }
  if (q.kind === 'instrument') return { kind: 'instrument', root: q.subject, query: { ...years, variant: q.variant ?? undefined } }
  return { kind: 'hypothesis', name: q.subject, query: { ...years, cost: q.cost } }
}

/** Idle (no request) until there is a subject. */
export function useSeasonality(q: SeasQuery | null) {
  return useSeasonalityQuery(q && q.subject !== '' ? seasRequest(q) : null)
}
