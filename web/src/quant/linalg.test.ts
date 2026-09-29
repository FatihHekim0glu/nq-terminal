// pearsonMatrix and symmetricEigenvalues against the numpy golden vectors from qa/crosscheck/p12_neff.py (numpy.corrcoef
// and numpy.linalg.eigvalsh on a seeded 400 x 9 panel), plus checks that need no golden file: hand cases, a closed form,
// a matrix built from known eigenvalues, the trace, and the inputs that must throw.
import { describe, expect, it } from 'vitest'
import raw from '../../../qa/golden/p12_neff.json?raw'
import { pearsonMatrix, symmetricEigenvalues } from './linalg'

type EigenCase = { name: string; matrix: number[][]; eigenvalues: number[] }
type Golden = {
  panel: { columns: number[][] }
  correlation: number[][]
  eigenvalues: number[]
  eigen_cases: EigenCase[]
}
const GOLDEN = JSON.parse(raw) as Golden

/** Largest absolute difference between two equally long vectors. */
function maxAbsDifference(got: readonly number[], want: readonly number[]): number {
  expect(got).toHaveLength(want.length)
  return Math.max(0, ...got.map((value, i) => Math.abs(value - (want[i] as number))))
}

function flatten(matrix: readonly (readonly number[])[]): number[] {
  return matrix.flatMap((row) => [...row])
}

/** A small seeded generator (mulberry32), so the random cases below are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A = Q D Q^T for a product of seeded Givens rotations Q, so the eigenvalues of A are exactly `values`. */
function matrixWithEigenvalues(values: readonly number[], seed: number): number[][] {
  const size = values.length
  const random = seeded(seed)
  const a = values.map((value, i) => values.map((_, j) => (i === j ? value : 0)))
  for (let turn = 0; turn < 6 * size; turn += 1) {
    const p = Math.floor(random() * size)
    const q = (p + 1 + Math.floor(random() * (size - 1))) % size
    const angle = random() * Math.PI
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    for (let k = 0; k < size; k += 1) {
      const kp = (a[k] as number[])[p] as number
      const kq = (a[k] as number[])[q] as number
      ;(a[k] as number[])[p] = c * kp - s * kq
      ;(a[k] as number[])[q] = s * kp + c * kq
    }
    for (let k = 0; k < size; k += 1) {
      const pk = (a[p] as number[])[k] as number
      const qk = (a[q] as number[])[k] as number
      ;(a[p] as number[])[k] = c * pk - s * qk
      ;(a[q] as number[])[k] = s * pk + c * qk
    }
  }
  return a
}

describe('pearsonMatrix against numpy.corrcoef', () => {
  const r = pearsonMatrix(GOLDEN.panel.columns)

  it('reads the 400 x 9 golden panel', () => {
    expect(GOLDEN.panel.columns).toHaveLength(9)
    expect(GOLDEN.panel.columns.every((column) => column.length === 400)).toBe(true)
    expect(r).toHaveLength(9)
    expect(r.every((row) => row.length === 9)).toBe(true)
  })

  it('matches the golden correlation to 1e-12 absolute', () => {
    expect(maxAbsDifference(flatten(r), flatten(GOLDEN.correlation))).toBeLessThanOrEqual(1e-12)
  })

  it('has exactly 1 on the diagonal, is exactly symmetric and stays inside [-1, 1]', () => {
    for (let i = 0; i < 9; i += 1) {
      expect((r[i] as number[])[i]).toBe(1)
      for (let j = 0; j < 9; j += 1) {
        expect((r[i] as number[])[j]).toBe((r[j] as number[])[i])
        expect(Math.abs((r[i] as number[])[j] as number)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('pearsonMatrix by hand', () => {
  it('gives 1 for a scaled copy, -1 for a reversed one and 0 for orthogonal columns', () => {
    const r = pearsonMatrix([
      [1, 2, 3, 4],
      [2, 4, 6, 8],
      [4, 3, 2, 1],
      [1, -1, -1, 1],
    ])
    expect((r[0] as number[])[1]).toBeCloseTo(1, 15)
    expect((r[0] as number[])[2]).toBeCloseTo(-1, 15)
    expect(Math.abs((r[0] as number[])[3] as number)).toBeLessThanOrEqual(1e-15)
  })

  it('never returns a value outside [-1, 1] for a rounded copy', () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.1)
    const r = pearsonMatrix([x, x.map((value) => value * 0.1), x.map((value) => -value * 3)])
    expect((r[0] as number[])[1]).toBeLessThanOrEqual(1)
    expect((r[0] as number[])[2]).toBeGreaterThanOrEqual(-1)
  })

  it('centres before it multiplies: a huge common offset changes nothing', () => {
    const x = Array.from({ length: 40 }, (_, i) => ((i * 7) % 13) * 0.5)
    const y = Array.from({ length: 40 }, (_, i) => ((i * 5) % 11) * 0.5 + x[i]! * 0.25)
    const plain = pearsonMatrix([x, y])
    const shifted = pearsonMatrix([x.map((v) => v + 1e8), y.map((v) => v + 3e8)])
    expect(Math.abs((plain[0] as number[])[1]! - (shifted[0] as number[])[1]!)).toBeLessThanOrEqual(1e-12)
  })

  it('accepts three sessions, the minimum', () => {
    const r = pearsonMatrix([
      [1, 2, 4],
      [2, 1, 5],
    ])
    expect((r[0] as number[])[1]).toBeGreaterThan(0.5)
  })

  it('returns an empty matrix for no columns and [[1]] for one', () => {
    expect(pearsonMatrix([])).toEqual([])
    expect(pearsonMatrix([[1, 2, 3, 5]])).toEqual([[1]])
  })

  it('handles ten thousand sessions', () => {
    const random = seeded(7)
    const columns = Array.from({ length: 6 }, () => Array.from({ length: 10_000 }, () => random() - 0.5))
    const r = pearsonMatrix(columns)
    const off = flatten(r).filter((_, k) => Math.floor(k / 6) !== k % 6)
    expect(Math.max(...off.map(Math.abs))).toBeLessThan(0.06) // independent draws: sd 0.01
  })

  it('does not change its input', () => {
    const columns = [
      [3, 1, 2, 5],
      [1, 4, 2, 8],
    ]
    const before = JSON.stringify(columns)
    pearsonMatrix(columns)
    expect(JSON.stringify(columns)).toBe(before)
  })
})

describe('pearsonMatrix refuses what it cannot correlate', () => {
  it('names the column that has no variance', () => {
    expect(() => pearsonMatrix([[1, 2, 3], [5, 5, 5]])).toThrow('column 1 has no variance')
    expect(() => pearsonMatrix([[0, 0, 0, 0], [1, 2, 3, 4]])).toThrow('column 0 has no variance')
  })

  it('finds a constant column even when its mean is not exact in floating point', () => {
    expect(() => pearsonMatrix([[1, 2, 3], [0.1, 0.1, 0.1]])).toThrow('column 1 has no variance')
    expect(() => pearsonMatrix([[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], [1, 2, 3, 4, 5, 6, 7]])).toThrow(
      'column 0 has no variance',
    )
  })

  it('refuses fewer than three sessions, unequal columns and non-finite values', () => {
    expect(() => pearsonMatrix([[1, 2], [2, 1]])).toThrow()
    expect(() => pearsonMatrix([[1, 2, 3], [1, 2, 3, 4]])).toThrow()
    expect(() => pearsonMatrix([[1, 2, Number.NaN], [1, 2, 4]])).toThrow()
    expect(() => pearsonMatrix([[1, 2, 3], [1, Infinity, 4]])).toThrow()
  })
})

describe('symmetricEigenvalues against numpy.linalg.eigvalsh', () => {
  it('matches the golden eigenvalues of the correlation to 1e-12 absolute, largest first', () => {
    const got = symmetricEigenvalues(GOLDEN.correlation)
    expect(maxAbsDifference(got, GOLDEN.eigenvalues)).toBeLessThanOrEqual(1e-12)
    expect(got).toEqual([...got].sort((a, b) => b - a))
  })

  it('agrees through the whole chain: panel to correlation to eigenvalues', () => {
    const got = symmetricEigenvalues(pearsonMatrix(GOLDEN.panel.columns))
    expect(maxAbsDifference(got, GOLDEN.eigenvalues)).toBeLessThanOrEqual(1e-12)
  })

  it('preserves the trace (9) and the sum of squares of the entries', () => {
    const r = pearsonMatrix(GOLDEN.panel.columns)
    const eigs = symmetricEigenvalues(r)
    expect(Math.abs(eigs.reduce((s, x) => s + x, 0) - 9)).toBeLessThanOrEqual(1e-12)
    const frobenius = flatten(r).reduce((s, x) => s + x * x, 0)
    expect(Math.abs(eigs.reduce((s, x) => s + x * x, 0) - frobenius)).toBeLessThanOrEqual(1e-11)
  })

  it.each(GOLDEN.eigen_cases.map((c) => [c.name, c] as const))('hand case %s matches numpy to 1e-12', (_name, c) => {
    expect(maxAbsDifference(symmetricEigenvalues(c.matrix), c.eigenvalues)).toBeLessThanOrEqual(1e-12)
  })
})

describe('symmetricEigenvalues by hand and by construction', () => {
  it('[[2, 1], [1, 2]] has eigenvalues 3 and 1', () => {
    expect(symmetricEigenvalues([[2, 1], [1, 2]])).toEqual([3, 1])
  })

  it('the identity has all ones, a diagonal matrix its diagonal sorted down, a 1 x 1 matrix itself', () => {
    expect(symmetricEigenvalues([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toEqual([1, 1, 1])
    expect(symmetricEigenvalues([[1, 0], [0, 3]])).toEqual([3, 1])
    expect(symmetricEigenvalues([[5]])).toEqual([5])
    expect(symmetricEigenvalues([])).toEqual([])
  })

  it('duplicate columns give eigenvalues 2, 1 and 0', () => {
    const got = symmetricEigenvalues([[1, 1, 0], [1, 1, 0], [0, 0, 1]])
    expect(maxAbsDifference(got, [2, 1, 0])).toBeLessThanOrEqual(1e-15)
  })

  it('a negative eigenvalue stays negative: [[0, 1], [1, 0]] is 1 and -1', () => {
    expect(maxAbsDifference(symmetricEigenvalues([[0, 1], [1, 0]]), [1, -1])).toBeLessThanOrEqual(1e-15)
  })

  it('the all-zero matrix has zero eigenvalues (nothing to rotate)', () => {
    expect(symmetricEigenvalues([[0, 0], [0, 0]])).toEqual([0, 0])
  })

  it('a path Laplacian of size 8 has the closed form 2 - 2 cos(k pi / 9)', () => {
    const n = 8
    const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 2 : Math.abs(i - j) === 1 ? -1 : 0)))
    const want = Array.from({ length: n }, (_, k) => 2 - 2 * Math.cos(((k + 1) * Math.PI) / (n + 1))).sort((a, b) => b - a)
    expect(maxAbsDifference(symmetricEigenvalues(matrix), want)).toBeLessThanOrEqual(1e-13)
  })

  it('recovers the eigenvalues a matrix was built from (12 x 12, clustered and repeated values)', () => {
    const values = [5, 4.999, 3, 3, 3, 1.5, 0.25, 0.25, 0, -0.5, -2, -2]
    const got = symmetricEigenvalues(matrixWithEigenvalues(values, 20260928))
    expect(maxAbsDifference(got, [...values].sort((a, b) => b - a))).toBeLessThanOrEqual(1e-12)
  })

  it('handles a 60 x 60 correlation of thirty near-duplicate pairs', () => {
    const random = seeded(11)
    const columns: number[][] = []
    for (let pair = 0; pair < 30; pair += 1) {
      const base = Array.from({ length: 2000 }, () => random() - 0.5)
      columns.push(base, base.map((v) => v + (random() - 0.5) * 0.02))
    }
    const r = pearsonMatrix(columns)
    const eigs = symmetricEigenvalues(r)
    expect(eigs).toHaveLength(60)
    expect(Math.abs(eigs.reduce((s, x) => s + x, 0) - 60)).toBeLessThanOrEqual(1e-11)
    expect(eigs.filter((x) => x > 1.5)).toHaveLength(30) // thirty pairs: thirty eigenvalues near 2 and thirty near 0
    expect(eigs.filter((x) => x < 0.5)).toHaveLength(30)
    expect(eigs[eigs.length - 1]!).toBeGreaterThan(-1e-12) // a correlation matrix is positive semidefinite
  })

  it('does not change its input', () => {
    const matrix = [[2, 1], [1, 2]]
    symmetricEigenvalues(matrix)
    expect(matrix).toEqual([[2, 1], [1, 2]])
  })

  it('honours a looser tolerance and a sweep limit', () => {
    const matrix = matrixWithEigenvalues([3, 2, 1, 0.5], 5)
    expect(maxAbsDifference(symmetricEigenvalues(matrix, 1e-6), [3, 2, 1, 0.5])).toBeLessThanOrEqual(1e-5)
    expect(() => symmetricEigenvalues(matrix, 1e-15, 0)).toThrow('did not converge')
    expect(symmetricEigenvalues([[2, 0], [0, 1]], 1e-15, 0)).toEqual([2, 1]) // already diagonal: no sweep needed
  })
})

describe('symmetricEigenvalues refuses what it cannot decompose', () => {
  it('throws on a matrix that is not square', () => {
    expect(() => symmetricEigenvalues([[1, 2, 3], [2, 1, 3]])).toThrow('square')
    expect(() => symmetricEigenvalues([[1, 2], [2]])).toThrow('square')
  })

  it('throws on asymmetry above 1e-12 and accepts asymmetry below it', () => {
    expect(() => symmetricEigenvalues([[1, 0.5], [0.4, 1]])).toThrow('symmetric')
    expect(() => symmetricEigenvalues([[1, 0.5], [0.5 + 1e-11, 1]])).toThrow('symmetric')
    expect(symmetricEigenvalues([[1, 0.5], [0.5 + 1e-13, 1]])).toHaveLength(2)
  })

  it('throws on a non-finite entry', () => {
    expect(() => symmetricEigenvalues([[1, Number.NaN], [Number.NaN, 1]])).toThrow('finite')
    expect(() => symmetricEigenvalues([[Infinity, 0], [0, 1]])).toThrow('finite')
  })
})
