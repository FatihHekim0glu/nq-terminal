// averageLinkage (UPGMA, scipy numbering) and flatClusters (fcluster 'distance') against the scipy golden vectors from
// qa/crosscheck/p12_neff.py, plus hand cases: two tight pairs, a merge exactly at the cut, ties, an inverted tree, and
// the variants that must stay wrong (single linkage, a strict cut).
import { describe, expect, it } from 'vitest'
import raw from '../../../qa/golden/p12_neff.json?raw'
import { CLUSTER_CUT, averageLinkage, flatClusters, type Merge } from './cluster'

type Golden = {
  correlation: number[][]
  linkage: Merge[]
  linkage_heights: number[]
  cluster_cut: number
  clusters: number[][]
  cluster_sweep: { cut: number; clusters: number[][] }[]
  inversion_case: { m: number; merges: Merge[]; cuts: { cut: number; clusters: number[][] }[] }
}
const GOLDEN = JSON.parse(raw) as Golden

/** 1 - rho, the distance the terminal clusters on. */
function distanceOf(correlation: readonly (readonly number[])[]): number[][] {
  return correlation.map((row) => row.map((value) => 1 - value))
}

/** A symmetric matrix from the upper triangle, in row-major pair order (0,1) (0,2) ... (1,2) ... */
function fromPairs(size: number, pairs: readonly number[]): number[][] {
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  let k = 0
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      ;(matrix[i] as number[])[j] = pairs[k] as number
      ;(matrix[j] as number[])[i] = pairs[k] as number
      k += 1
    }
  }
  return matrix
}

/** Single linkage heights (the heights of the minimum spanning tree, ascending): the born failing variant. */
function singleLinkageHeights(distance: readonly (readonly number[])[]): number[] {
  const size = distance.length
  const inTree = new Array<boolean>(size).fill(false)
  const best = new Array<number>(size).fill(Infinity)
  best[0] = 0
  const heights: number[] = []
  for (let step = 0; step < size; step += 1) {
    let next = -1
    for (let i = 0; i < size; i += 1) {
      if (!inTree[i] && (next === -1 || (best[i] as number) < (best[next] as number))) next = i
    }
    inTree[next] = true
    if (step > 0) heights.push(best[next] as number)
    for (let i = 0; i < size; i += 1) {
      if (!inTree[i]) best[i] = Math.min(best[i] as number, (distance[next] as readonly number[])[i] as number)
    }
  }
  return heights.sort((a, b) => a - b)
}

describe('averageLinkage against scipy.cluster.hierarchy.linkage(..., "average")', () => {
  const merges = averageLinkage(distanceOf(GOLDEN.correlation))

  it('makes M - 1 = 8 merges', () => {
    expect(GOLDEN.linkage).toHaveLength(8)
    expect(merges).toHaveLength(8)
  })

  it('has scipy numbering: the same children (smaller id first) and the same sizes at every step', () => {
    expect(merges.map(({ a, b, size }) => ({ a, b, size }))).toEqual(GOLDEN.linkage.map(({ a, b, size }) => ({ a, b, size })))
  })

  it('has the golden heights to 1e-12 absolute', () => {
    expect(GOLDEN.linkage_heights).toEqual(GOLDEN.linkage.map((row) => row.height))
    merges.forEach((merge, i) => {
      expect(Math.abs(merge.height - (GOLDEN.linkage_heights[i] as number)), `merge ${i}`).toBeLessThanOrEqual(1e-12)
    })
  })

  it('never lowers a height (average linkage is monotone)', () => {
    for (let i = 1; i < merges.length; i += 1) {
      expect((merges[i] as Merge).height).toBeGreaterThan((merges[i - 1] as Merge).height)
    }
  })

  it('born failing: single linkage gives other heights than the golden ones', () => {
    const single = singleLinkageHeights(distanceOf(GOLDEN.correlation))
    expect(single).toHaveLength(8)
    const gap = Math.max(...single.map((h, i) => Math.abs(h - (GOLDEN.linkage_heights[i] as number))))
    expect(gap).toBeGreaterThan(0.05)
    expect(single[single.length - 1] as number).toBeLessThan(GOLDEN.linkage_heights[7] as number)
  })
})

describe('flatClusters against scipy.cluster.hierarchy.fcluster(..., 0.5, "distance")', () => {
  const merges = averageLinkage(distanceOf(GOLDEN.correlation))

  it('cuts at the pre-registered 0.5', () => {
    expect(CLUSTER_CUT).toBe(0.5)
    expect(GOLDEN.cluster_cut).toBe(CLUSTER_CUT)
  })

  it('gives the golden partition: one cluster of three and six singletons', () => {
    expect(flatClusters(merges, 9, CLUSTER_CUT)).toEqual(GOLDEN.clusters)
    expect(flatClusters(GOLDEN.linkage, 9, CLUSTER_CUT)).toEqual(GOLDEN.clusters)
    expect(GOLDEN.clusters).toHaveLength(7)
  })

  it('gives every nested partition of the sweep, from nine singletons to one cluster', () => {
    expect(GOLDEN.cluster_sweep.map((s) => s.clusters.length)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
    for (const { cut, clusters } of GOLDEN.cluster_sweep) {
      expect(flatClusters(merges, 9, cut), `cut ${cut}`).toEqual(clusters)
    }
  })

  it('follows scipy on a tree that inverts: a merge joins only when everything under it is at or below the cut', () => {
    const { m, merges: tree, cuts } = GOLDEN.inversion_case
    for (const { cut, clusters } of cuts) {
      expect(flatClusters(tree, m, cut), `cut ${cut}`).toEqual(clusters)
    }
  })
})

describe('two tight pairs', () => {
  // (0,1) at 0.1, (2,3) at 0.2, every cross pair at 0.9
  const distance = fromPairs(4, [0.1, 0.9, 0.9, 0.9, 0.9, 0.2])
  const merges = averageLinkage(distance)

  it('merges the closer pair first, then the other, then the two pairs at their mean distance', () => {
    expect(merges.map(({ a, b, size }) => [a, b, size])).toEqual([
      [0, 1, 2],
      [2, 3, 2],
      [4, 5, 4],
    ])
    expect(merges[0]?.height).toBeCloseTo(0.1, 14)
    expect(merges[1]?.height).toBeCloseTo(0.2, 14)
    expect(merges[2]?.height).toBeCloseTo(0.9, 14)
  })

  it('cuts into the pairs, into one cluster, into singletons, and half way', () => {
    expect(flatClusters(merges, 4, 0.5)).toEqual([[0, 1], [2, 3]])
    expect(flatClusters(merges, 4, 0.95)).toEqual([[0, 1, 2, 3]])
    expect(flatClusters(merges, 4, 0.05)).toEqual([[0], [1], [2], [3]])
    expect(flatClusters(merges, 4, 0.15)).toEqual([[0, 1], [2], [3]])
  })
})

describe('average against single linkage by hand', () => {
  // d(0,1) = 0.2, d(0,2) = 0.3, d(1,2) = 0.9: average joins 2 at (0.3 + 0.9) / 2 = 0.6, single would join it at 0.3
  const distance = fromPairs(3, [0.2, 0.3, 0.9])
  const merges = averageLinkage(distance)

  it('joins the third point at the mean of its two distances', () => {
    expect(merges.map(({ a, b, size }) => [a, b, size])).toEqual([
      [0, 1, 2],
      [2, 3, 3],
    ])
    expect(merges[1]?.height).toBeCloseTo(0.6, 14)
    expect(flatClusters(merges, 3, 0.5)).toEqual([[0, 1], [2]])
  })

  it('born failing: single linkage would join everything at 0.5', () => {
    expect(singleLinkageHeights(distance)).toEqual([0.2, 0.3])
    expect(flatClusters([{ a: 0, b: 1, height: 0.2, size: 2 }, { a: 2, b: 3, height: 0.3, size: 3 }], 3, 0.5)).toEqual([[0, 1, 2]])
  })

  it('weights unequal distances by cluster size (UPGMA)', () => {
    // pairs: d01 0.1, d02 0.4, d12 0.7, d34 0.3, d23 0.9, every other pair 1
    const distance5 = fromPairs(5, [0.1, 0.4, 1, 1, 0.7, 1, 1, 0.9, 1, 0.3])
    const tree = averageLinkage(distance5)
    // (0,1) at 0.1 is cluster 5, (3,4) at 0.3 is cluster 6, and {0,1} to 2 is (0.4 + 0.7) / 2 = 0.55
    expect(tree.map(({ a, b, size }) => [a, b, size])).toEqual([
      [0, 1, 2],
      [3, 4, 2],
      [2, 5, 3],
      [6, 7, 5],
    ])
    expect(tree[2]?.height).toBeCloseTo(0.55, 14)
    // {0,1,2} to {3,4}: the six pairs are 1, 1, 1, 1, 0.9 and 1, so 5.9 / 6 (the mean of the pairs, not of two heights)
    expect(tree[3]?.height).toBeCloseTo(5.9 / 6, 14)
  })
})

describe('ties and numbering', () => {
  it('breaks ties to the lowest (a, b): equal distances merge 0 and 1, then 2 and 3, then the two pairs', () => {
    const merges = averageLinkage(fromPairs(4, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]))
    expect(merges.map(({ a, b, height, size }) => [a, b, height, size])).toEqual([
      [0, 1, 0.5, 2],
      [2, 3, 0.5, 2],
      [4, 5, 0.5, 4],
    ])
  })

  it('prefers the lower first child over a lower second child', () => {
    // (0,3) and (1,2) tie at 0.1: (0,3) is the lowest pair
    const merges = averageLinkage(fromPairs(4, [0.9, 0.9, 0.1, 0.1, 0.9, 0.9]))
    expect(merges[0]).toMatchObject({ a: 0, b: 3, size: 2 })
    expect(merges[1]).toMatchObject({ a: 1, b: 2, size: 2 })
  })

  it('numbers leaves 0..M-1 and merge i as M + i, smaller id first', () => {
    const merges = averageLinkage(distanceOf(GOLDEN.correlation))
    merges.forEach((merge, i) => {
      expect(merge.a).toBeLessThan(merge.b)
      expect(merge.b).toBeLessThan(9 + i)
    })
    const children = merges.flatMap(({ a, b }) => [a, b]).sort((x, y) => x - y)
    expect(children).toEqual(Array.from({ length: 16 }, (_, k) => k)) // every id below the root, once
  })

  it('ignores the diagonal and uses the upper triangle of a matrix that is symmetric to 1e-12', () => {
    const distance = fromPairs(3, [0.2, 0.3, 0.9])
    const noisy = distance.map((row, i) => row.map((value, j) => (i === j ? 7 : i > j ? value + 1e-13 : value)))
    expect(averageLinkage(noisy).map(({ a, b }) => [a, b])).toEqual([[0, 1], [2, 3]])
  })

  it('returns no merges for zero or one point and one merge for two', () => {
    expect(averageLinkage([])).toEqual([])
    expect(averageLinkage([[0]])).toEqual([])
    expect(averageLinkage([[0, 0.3], [0.3, 0]])).toEqual([{ a: 0, b: 1, height: 0.3, size: 2 }])
  })

  it('does not change its input', () => {
    const distance = fromPairs(4, [0.1, 0.9, 0.9, 0.9, 0.9, 0.2])
    const before = JSON.stringify(distance)
    averageLinkage(distance)
    expect(JSON.stringify(distance)).toBe(before)
  })

  it('clusters 200 points quickly and merges every point once', () => {
    let state = 12345
    const next = (): number => {
      // mulberry32
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const size = 200
    const distance = fromPairs(size, Array.from({ length: (size * (size - 1)) / 2 }, () => 0.05 + next()))
    const merges = averageLinkage(distance)
    expect(merges).toHaveLength(size - 1)
    expect((merges[size - 2] as Merge).size).toBe(size)
    expect(flatClusters(merges, size, 2)).toEqual([Array.from({ length: size }, (_, k) => k)])
  })
})

describe('averageLinkage refuses a distance it cannot use', () => {
  it('throws on a matrix that is not square, not symmetric or not finite', () => {
    expect(() => averageLinkage([[0, 1, 2], [1, 0, 2]])).toThrow('square')
    expect(() => averageLinkage([[0, 0.3], [0.4, 0]])).toThrow('symmetric')
    expect(() => averageLinkage([[0, Number.NaN], [Number.NaN, 0]])).toThrow('finite')
    expect(() => averageLinkage([[0, Infinity], [Infinity, 0]])).toThrow('finite')
  })
})

describe('flatClusters', () => {
  it('keeps a merge whose height is exactly the cut, and drops it for a cut just below', () => {
    const merges: Merge[] = [{ a: 0, b: 1, height: 0.5, size: 2 }]
    expect(flatClusters(merges, 2, 0.5)).toEqual([[0, 1]])
    expect(flatClusters(merges, 2, 0.4999999999999999)).toEqual([[0], [1]])
    expect(flatClusters(merges, 2, 0.5000000000000001)).toEqual([[0, 1]])
  })

  it('lists members ascending and clusters by first member, whatever the merge sequence', () => {
    // 3 joins 1 first (a = 1, b = 3), then 0 joins that cluster (a = 0, b = 5... ids: leaves 0..4, merge 0 = 5)
    const merges: Merge[] = [
      { a: 1, b: 3, height: 0.1, size: 2 },
      { a: 0, b: 5, height: 0.2, size: 3 },
      { a: 2, b: 4, height: 0.3, size: 2 },
      { a: 6, b: 7, height: 0.9, size: 5 },
    ]
    expect(flatClusters(merges, 5, 0.25)).toEqual([[0, 1, 3], [2], [4]])
    expect(flatClusters(merges, 5, 0.35)).toEqual([[0, 1, 3], [2, 4]])
    expect(flatClusters(merges, 5, 0.9)).toEqual([[0, 1, 2, 3, 4]])
    expect(flatClusters(merges, 5, 0.05)).toEqual([[0], [1], [2], [3], [4]])
  })

  it('handles zero and one point', () => {
    expect(flatClusters([], 0, 0.5)).toEqual([])
    expect(flatClusters([], 1, 0.5)).toEqual([[0]])
  })

  it('an infinite cut joins everything and a negative cut nothing', () => {
    const merges = averageLinkage(fromPairs(3, [0.2, 0.3, 0.9]))
    expect(flatClusters(merges, 3, Infinity)).toEqual([[0, 1, 2]])
    expect(flatClusters(merges, 3, -1)).toEqual([[0], [1], [2]])
  })

  it('refuses a cut that is NaN, a merge list of the wrong length and children that do not exist yet', () => {
    const merges: Merge[] = [{ a: 0, b: 1, height: 0.5, size: 2 }]
    expect(() => flatClusters(merges, 2, Number.NaN)).toThrow('cut')
    expect(() => flatClusters(merges, 3, 0.5)).toThrow('merges')
    expect(() => flatClusters([], 2, 0.5)).toThrow('merges')
    expect(() => flatClusters([{ a: 0, b: 2, height: 0.5, size: 2 }], 2, 0.5)).toThrow('child')
    expect(() => flatClusters([{ a: 1, b: 1, height: 0.5, size: 2 }], 2, 0.5)).toThrow('child')
    expect(() => flatClusters(merges, 1.5, 0.5)).toThrow('points')
    expect(() => flatClusters(merges, -1, 0.5)).toThrow('points')
  })

  it('refuses a child that was merged already', () => {
    const merges: Merge[] = [
      { a: 0, b: 1, height: 0.1, size: 2 },
      { a: 0, b: 2, height: 0.2, size: 2 },
    ]
    expect(() => flatClusters(merges, 3, 0.5)).toThrow('child')
  })
})
