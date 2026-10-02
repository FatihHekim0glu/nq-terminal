// [POST HOC] Basis A, per session (SV3a). Hierarchical clusters of the registered trials on the distance 1 - rho, the
// second estimator of the effective number of trials (ROADMAP 19). TEST REFERENCE since 2026-10-02: the backend serves
// these numbers (analytics/neff.py, the C8 mirror) and no production file imports this module (importGuard.test.ts).
// Pinned to scipy by the golden vectors of qa/crosscheck/p12_neff.py (scipy.cluster.hierarchy.linkage with 'average',
// then fcluster with 'distance', src/quant/cluster.test.ts). It decides nothing: a cut of a tree.
//
// Pre-registered constant: CLUSTER_CUT = 0.5 on the distance 1 - rho, with average linkage (UPGMA). The linkage is
// never single or complete: single linkage chains a weak path of trials into one cluster, complete linkage waits for
// the farthest pair.
//
// - averageLinkage: naive UPGMA (Sokal and Michener 1958). Repeatedly merge the two closest live clusters; the new
//   cluster sits at the size-weighted mean of the old distances (the Lance and Williams update
//   d(new, k) = (n_a d(a, k) + n_b d(b, k)) / (n_a + n_b)), which is the plain mean over all cross pairs. Ties go to
//   the lowest (a, b). It returns scipy's numbering: leaves are 0..M-1 and merge i creates cluster M + i, with the
//   smaller id first. Only the upper triangle of the distance matrix is read, as scipy reads a condensed matrix.
// - flatClusters: scipy's fcluster with criterion 'distance', the flat clusters "no greater than the cut". A merge is
//   kept when its own height and the height of every merge under it are at most the cut, so a merge exactly at the
//   cut is kept, and a tree that inverts (a merge lower than one of its children) joins nothing early. Average
//   linkage never inverts, where this equals "keep the merges with height <= cut".
import type { Matrix } from './linalg'

/** The pre-registered cut on 1 - rho: trials closer than this on average are one cluster. */
export const CLUSTER_CUT = 0.5

/** One merge, in scipy's linkage numbering: leaves 0..M-1, merge i creates cluster M + i; a < b for merges made here. */
export interface Merge {
  a: number
  b: number
  height: number
  size: number
}

/** The most two mirrored entries may differ before a distance matrix is called asymmetric. */
const SYMMETRY_LIMIT = 1e-12

/** The upper triangle of `distance` into a flat, mirrored array, refusing a matrix that is not square, finite and symmetric. */
function readDistance(distance: Matrix): Float64Array {
  const size = distance.length
  const flat = new Float64Array(size * size)
  for (let i = 0; i < size; i += 1) {
    const row = distance[i] as readonly number[]
    if (row.length !== size) throw new Error(`the distance matrix is not square: row ${i} has ${row.length} entries, not ${size}`)
  }
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const upper = (distance[i] as readonly number[])[j] as number
      const lower = (distance[j] as readonly number[])[i] as number
      if (!Number.isFinite(upper) || !Number.isFinite(lower)) throw new Error(`the distance matrix has an entry that is not finite at (${i}, ${j})`)
      if (Math.abs(upper - lower) > SYMMETRY_LIMIT) {
        throw new Error(`the distance matrix is not symmetric: entries (${i}, ${j}) and (${j}, ${i}) differ by ${Math.abs(upper - lower)}`)
      }
      flat[i * size + j] = upper
      flat[j * size + i] = upper
    }
  }
  return flat
}

/**
 * Average linkage (UPGMA) on a symmetric distance matrix such as 1 - rho: the M - 1 merges in the order they are made,
 * heights non-decreasing, ties to the lowest (a, b), in scipy's numbering. Fewer than two points give no merges. The
 * diagonal is ignored and the input is not changed. Throws for a matrix that is not square, not finite or asymmetric
 * by more than 1e-12.
 */
export function averageLinkage(distance: Matrix): Merge[] {
  const count = distance.length
  const d = readDistance(distance)
  const ids = Array.from({ length: count }, (_, i) => i)
  const sizes = new Array<number>(count).fill(1)
  const live = Array.from({ length: count }, (_, i) => i) // slots that still hold a cluster
  const merges: Merge[] = []
  for (let step = 0; step < count - 1; step += 1) {
    let bestHeight = Infinity
    let bestA = -1
    let bestB = -1
    let bestI = -1
    let bestJ = -1
    for (let i = 0; i < live.length; i += 1) {
      const slotI = live[i] as number
      for (let j = i + 1; j < live.length; j += 1) {
        const slotJ = live[j] as number
        const height = d[slotI * count + slotJ] as number
        const idI = ids[slotI] as number
        const idJ = ids[slotJ] as number
        const a = Math.min(idI, idJ)
        const b = Math.max(idI, idJ)
        if (height < bestHeight || (height === bestHeight && (a < bestA || (a === bestA && b < bestB)))) {
          bestHeight = height
          bestA = a
          bestB = b
          bestI = i
          bestJ = j
        }
      }
    }
    const keep = live[bestI] as number
    const drop = live[bestJ] as number
    const sizeKeep = sizes[keep] as number
    const sizeDrop = sizes[drop] as number
    for (const other of live) {
      if (other === keep || other === drop) continue
      const merged =
        (sizeKeep * (d[keep * count + other] as number) + sizeDrop * (d[drop * count + other] as number)) / (sizeKeep + sizeDrop)
      d[keep * count + other] = merged
      d[other * count + keep] = merged
    }
    ids[keep] = count + step
    sizes[keep] = sizeKeep + sizeDrop
    live.splice(bestJ, 1)
    merges.push({ a: bestA, b: bestB, height: bestHeight, size: sizeKeep + sizeDrop })
  }
  return merges
}

/** Checks the arguments of flatClusters and returns the number of merges a tree of `points` leaves holds. */
function checkTree(merges: readonly Merge[], points: number, cut: number): void {
  if (!Number.isInteger(points) || points < 0) throw new Error(`the number of points must be a whole number, at least 0, got ${points}`)
  if (Number.isNaN(cut)) throw new Error('the cut must be a number')
  const needed = Math.max(points - 1, 0)
  if (merges.length !== needed) throw new Error(`${points} points need ${needed} merges, got ${merges.length}`)
}

/**
 * The flat clusters of a linkage tree at `cut` (scipy fcluster, criterion 'distance'): the members of each cluster
 * ascending, the clusters ordered by their first member. A merge is kept when its height and the height of every merge
 * under it are at most the cut, so a merge exactly at the cut is kept. `points` is the number of leaves M; the tree
 * needs M - 1 merges in scipy's numbering. Throws for a NaN cut, a wrong number of merges or a child that does not
 * exist yet or was merged already.
 */
export function flatClusters(merges: readonly Merge[], points: number, cut: number): number[][] {
  checkTree(merges, points, cut)
  const nodes = points + merges.length
  const members: number[][] = Array.from({ length: nodes }, (_, i) => (i < points ? [i] : []))
  const highest = new Array<number>(nodes).fill(-Infinity) // the tallest merge at or under each node
  const merged = new Array<boolean>(nodes).fill(false)
  merges.forEach((merge, i) => {
    const node = points + i
    for (const child of [merge.a, merge.b]) {
      if (!Number.isInteger(child) || child < 0 || child >= node) throw new Error(`merge ${i} has a child (${child}) that does not exist yet`)
      if (merged[child]) throw new Error(`merge ${i} has a child (${child}) that was merged already`)
    }
    if (merge.a === merge.b) throw new Error(`merge ${i} has the same child (${merge.a}) twice`)
    if (Number.isNaN(merge.height)) throw new Error(`merge ${i} has a height that is not a number`)
    merged[merge.a] = true
    merged[merge.b] = true
    members[node] = [...(members[merge.a] as number[]), ...(members[merge.b] as number[])]
    highest[node] = Math.max(merge.height, highest[merge.a] as number, highest[merge.b] as number)
  })
  const flat: number[][] = []
  const pending = nodes > 0 ? [nodes - 1] : []
  while (pending.length > 0) {
    const node = pending.pop() as number
    if ((highest[node] as number) <= cut) {
      flat.push([...(members[node] as number[])].sort((x, y) => x - y))
    } else {
      const merge = merges[node - points] as Merge
      pending.push(merge.a, merge.b)
    }
  }
  return flat.sort((x, y) => (x[0] as number) - (y[0] as number))
}
