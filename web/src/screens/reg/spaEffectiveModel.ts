// SV8 on MT: the effective number of family members (ANALYTICS_CATALOG SV8 step 8), in words over the served
// `effective_members` of a row (GET /api/analytics/spa). The backend computes it from the Pearson correlation of the
// members' loss differentials on the common index (the series the stationary bootstrap resamples) with SV3b's
// estimators: eigenvalue participation, Li and Ji (2005) and UPGMA clusters at the pre-registered cut (analytics/neff.py).
// The browser computes none of it any more (the C8 client-phase exception is closed; the old browser estimators survive
// only as a test reference, src/quant/neffReference.ts). Never a verdict: it describes the dependence the family's
// maximum statistic ran over, beside the family-wise p-values, which it does not adjust. It is not a count of independent
// hypotheses: against buy and hold every differential holds -r_bh, which pulls a low-exposure member's correlation
// towards 1 (the served note says so; MT 87 has the returns' figure).
import { SPA } from '../../copy/spa'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import { formatN } from './effectiveNModel'
import type { SpaEffectiveMembers } from './spaTypes'

const E = SPA.effective

export function effectiveLines(served: SpaEffectiveMembers): string[] {
  const { refusal } = served
  if (refusal !== null) {
    return [refusal.kind === 'single' ? E.single : fillCopy(E.undefined, { name: refusal.name ?? '' })]
  }
  const clusters = served.clusters.length === 1 ? E.clustersOne : fillCopy(E.clustersMany, { count: served.clusters.length })
  const lines = [
    fillCopy(E.summary, {
      participation: formatN(served.participation as number),
      liJi: formatN(served.li_ji as number),
      k: served.k,
      clusters,
      cut: served.cut,
      groups: served.clusters.map((group) => group.join(', ')).join('; '),
    }),
  ]
  if (served.strongest !== null) {
    lines.push(fillCopy(E.pair, { a: served.strongest.a, b: served.strongest.b, rho: formatNumber(served.strongest.rho, 2) }))
  }
  lines.push(E.source)
  return lines
}
