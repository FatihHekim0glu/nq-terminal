// The read behind the P2 risk extras cards (TASKS Phase 12; RK4, PF11, BR5): GET .../risk-extras of the series the
// tear sheet's tab shows, the run at its Freq or the hypothesis at its Cost, as the P1 reads in
// screens/tear/tearQueries.ts do. It lives beside its screen, not in api/queries.ts, which is the first-paint shell
// (scripts/shellBudget.test.ts); the tear sheet is a lazy chunk, so this loads with it.
import { useApiQuery } from '../../api/queries'
import type { ApiError } from '../../api/client'
import type { Freq, TearTarget } from '../tear/tearQueries'

export interface RiskExtrasQuery<T> {
  readonly data: T | undefined
  readonly error: ApiError | null
}

/** RK4, PF11 and BR5 of the series the tab shows; idle until `enabled` and until a hypothesis has its cost. */
export function useTearRiskExtras(target: TearTarget, freq: Freq, cost: number | null, enabled: boolean) {
  const isRun = target.kind === 'run'
  const run = useApiQuery('/api/analytics/run/{run_id}/risk-extras', { path: { run_id: target.name }, query: { freq } }, { enabled: enabled && isRun && target.name !== '' })
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}/risk-extras',
    { path: { name: target.name }, query: cost === null ? {} : { cost } },
    { enabled: enabled && !isRun && target.name !== '' && cost !== null },
  )
  const q = isRun ? run : hypothesis
  return { data: q.data, error: q.error }
}
