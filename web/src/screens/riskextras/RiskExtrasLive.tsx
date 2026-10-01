// The P2 risk extras cards of one tear sheet tab, with their read (TASKS Phase 12; RK4, PF11, BR5). TearP1 mounts it
// on RET (ulcer index, recovery factor, modified ES) and RR (Treynor) beside its own cards; the cards are the
// presentational RiskExtras, this only asks for the series' own `risk-extras` body and passes it in.
import type { Freq, TearTarget } from '../tear/tearQueries'
import RiskExtras, { type RiskExtrasTab } from './RiskExtras'
import { useTearRiskExtras } from './riskExtrasQueries'
import type { RiskExtrasView } from './types'

export interface RiskExtrasLiveProps {
  readonly tab: RiskExtrasTab
  readonly target: TearTarget
  readonly freq: Freq
  readonly cost: number | null
}

export default function RiskExtrasLive({ tab, target, freq, cost }: RiskExtrasLiveProps) {
  const q = useTearRiskExtras(target, freq, cost, true)
  // Schemas['RiskExtras'] is assignable to RiskExtrasView once `pnpm gen:api` has the route (types.ts).
  const data: RiskExtrasView | undefined = q.data
  return <RiskExtras tab={tab} data={data} error={q.error} />
}
