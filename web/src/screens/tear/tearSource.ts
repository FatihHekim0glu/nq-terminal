// The tear sheet's analytics GET path, in one place. tearQueries.ts sends this request (useTearAnalytics);
// the GRAB caption (W8 tearGrab) and the dossier name it as their source. Pure: it builds a relative URL with
// the client's own builder, so the path is encoded and refused the same way, and makes no request.
import { buildApiUrl } from '../../api/client'
import type { ApiPath } from '../../api/types'
import type { TearTarget } from './tearQueries'

const RUN_ANALYTICS_PATH = '/api/analytics/run/{run_id}' satisfies ApiPath
const HYPOTHESIS_ANALYTICS_PATH = '/api/analytics/hypothesis/{name}' satisfies ApiPath

/** The setting each kind is asked at: a run its frequency, a hypothesis its cost in ticks per side. */
export interface TearSourceContext {
  readonly cost: number | null
  readonly freq: string | null
}

/**
 * The request the tear sheet sends for `target`: a run as `/api/analytics/run/{run_id}` with its freq, a
 * hypothesis as `/api/analytics/hypothesis/{name}` with its cost when it has one. The setting of the other
 * kind is ignored. An Analytics answer's own `context` fits `context`.
 */
export function tearAnalyticsPath(target: TearTarget, context: TearSourceContext): string {
  if (target.kind === 'run') {
    return buildApiUrl(RUN_ANALYTICS_PATH, { path: { run_id: target.name }, query: { freq: context.freq } })
  }
  return buildApiUrl(HYPOTHESIS_ANALYTICS_PATH, {
    path: { name: target.name },
    query: context.cost === null ? {} : { cost: context.cost },
  })
}
