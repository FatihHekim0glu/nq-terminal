// The risk extras GET path (TASKS Phase 12), for the GRAB caption and the dossier's source list: tearSource.ts
// lists the other tear sheet reads, and its `tearSources` adds this one on RET and RR. Pure: it builds a relative URL
// with the client's own builder and makes no request.
import { buildApiUrl } from '../../api/client'
import type { ApiPath } from '../../api/types'
import type { TearSourceContext } from '../tear/tearSource'
import type { TearTarget } from '../tear/tearQueries'

const RUN_RISK_EXTRAS_PATH = '/api/analytics/run/{run_id}/risk-extras' satisfies ApiPath
const HYPOTHESIS_RISK_EXTRAS_PATH = '/api/analytics/hypothesis/{name}/risk-extras' satisfies ApiPath

/** The request RiskExtrasLive sends: a run at its freq, a hypothesis at its cost (none when it has none). */
export function riskExtrasPath(target: TearTarget, context: TearSourceContext): string {
  if (target.kind === 'run') return buildApiUrl(RUN_RISK_EXTRAS_PATH, { path: { run_id: target.name }, query: { freq: context.freq } })
  return buildApiUrl(HYPOTHESIS_RISK_EXTRAS_PATH, { path: { name: target.name }, query: context.cost === null ? {} : { cost: context.cost } })
}
