// SV8 on MT: the effective number of family members (ANALYTICS_CATALOG SV8, with the SV3b estimators). The backend
// serves the Pearson correlation of the members' loss differentials on the common index (`SpaView.correlation`, the
// series the stationary bootstrap resamples); this file reads it with the estimators the effective trials view
// already has, from src/quant: eigenvalue participation and Li and Ji over `symmetricEigenvalues`, and UPGMA clusters
// at the pre-registered cut. Computed in the browser (the SV3b client phase, C8), labelled so, and never a verdict:
// it describes the dependence the family's maximum statistic ran over, beside the family-wise p-values, which it does
// not adjust. It is not a count of independent hypotheses: against buy and hold every differential holds -r_bh, which
// pulls a low-exposure member's correlation towards 1 (the served note says so; MT 87 has the returns' figure). The matrix is refused rather than read when it is not a k by k correlation matrix.
import { SPA } from '../../copy/spa'
import { fillCopy } from '../../copy/workspace'
import { CLUSTER_CUT, averageLinkage, flatClusters } from '../../quant/cluster'
import { symmetricEigenvalues } from '../../quant/linalg'
import { liJiCount, participationRatio } from '../../quant/trials'
import { formatNumber } from '../tear/tearFormat'
import type { SpaView } from './spaTypes'

const E = SPA.effective
/** A served correlation may stray from the unit interval or symmetry by this much (rounding in a JSON round trip). */
const MATRIX_TOLERANCE = 1e-9

export interface StrongestPair {
  readonly a: string
  readonly b: string
  readonly rho: number
}

export type EffectiveMembersResult =
  | { readonly ok: false; readonly reason: 'single' | 'malformed' }
  | { readonly ok: false; readonly reason: 'undefined'; readonly name: string }
  | {
      readonly ok: true
      readonly k: number
      readonly participation: number
      readonly liJi: number
      /** Largest cluster first, then by first member; members in family order. */
      readonly clusters: readonly (readonly string[])[]
      readonly strongest: StrongestPair
    }

type Matrix = readonly (readonly (number | null)[])[]
type Dense = readonly (readonly number[])[]

function isCorrelation(matrix: Matrix, k: number): matrix is Dense {
  return matrix.every(
    (row, i) =>
      row.length === k &&
      row.every((value, j) => {
        if (value === null || !Number.isFinite(value) || Math.abs(value) > 1 + MATRIX_TOLERANCE) return false
        const mirror = matrix[j]?.[i]
        if (typeof mirror !== 'number' || Math.abs(mirror - value) > MATRIX_TOLERANCE) return false
        return i !== j || Math.abs(value - 1) <= MATRIX_TOLERANCE
      }),
  )
}

/** The first member with no correlation to itself (null on the diagonal): one that does not vary. */
function undefinedMember(matrix: Matrix): number {
  return matrix.findIndex((row, i) => row[i] === null)
}

function strongestPair(matrix: Dense, names: readonly string[]): StrongestPair {
  let best: StrongestPair = { a: names[0] as string, b: names[1] as string, rho: (matrix[0] as readonly number[])[1] as number }
  matrix.forEach((row, i) => {
    row.forEach((rho, j) => {
      if (j > i && Math.abs(rho) > Math.abs(best.rho)) best = { a: names[i] as string, b: names[j] as string, rho }
    })
  })
  return best
}

function rankedClusters(groups: readonly (readonly number[])[], names: readonly string[]): string[][] {
  return [...groups]
    .sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
    .map((members) => members.map((i) => names[i] as string))
}

export function effectiveMembers(view: SpaView): EffectiveMembersResult {
  const names = view.members.map((m) => m.name)
  const k = names.length
  const matrix = view.correlation
  if (k < 2) return { ok: false, reason: 'single' }
  if (matrix.length !== k || matrix.some((row) => row.length !== k)) return { ok: false, reason: 'malformed' }
  const gap = undefinedMember(matrix)
  if (gap >= 0) return { ok: false, reason: 'undefined', name: names[gap] as string }
  if (!isCorrelation(matrix, k)) return { ok: false, reason: 'malformed' }
  const eigenvalues = symmetricEigenvalues(matrix)
  // every entry is a number here: undefinedMember found no gap above
  const distance = matrix.map((row) => row.map((rho) => 1 - (rho as number)))
  const groups = flatClusters(averageLinkage(distance), k, CLUSTER_CUT)
  return {
    ok: true,
    k,
    participation: participationRatio(eigenvalues),
    liJi: liJiCount(eigenvalues),
    clusters: rankedClusters(groups, names),
    strongest: strongestPair(matrix, names),
  }
}

/** A count of members: whole numbers bare, an effective (fractional) count to two decimals. */
function formatN(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : formatNumber(value, 2)
}

export function effectiveLines(result: EffectiveMembersResult): string[] {
  if (!result.ok) {
    if (result.reason === 'undefined') return [fillCopy(E.undefined, { name: result.name })]
    return [result.reason === 'single' ? E.single : E.malformed]
  }
  const clusters = result.clusters.length === 1 ? E.clustersOne : fillCopy(E.clustersMany, { count: result.clusters.length })
  return [
    fillCopy(E.summary, {
      participation: formatN(result.participation),
      liJi: formatN(result.liJi),
      k: result.k,
      clusters,
      cut: CLUSTER_CUT,
      groups: result.clusters.map((group) => group.join(', ')).join('; '),
    }),
    fillCopy(E.pair, { a: result.strongest.a, b: result.strongest.b, rho: formatNumber(result.strongest.rho, 2) }),
    E.computed,
  ]
}
