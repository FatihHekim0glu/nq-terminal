// [POST HOC] Basis A, per session (SV3a). The correlation of the registered trials and its eigenvalues, the first
// half of the effective number of trials (ROADMAP 19). Computed in the browser (ANALYTICS_CATALOG C8, client phase);
// the backend mirror in analytics/deflated.py is pending. Pinned to numpy by the golden vectors of
// qa/crosscheck/p12_neff.py (numpy.corrcoef and numpy.linalg.eigvalsh, src/quant/linalg.test.ts) to 1e-12. Never
// shown as a served number, and nothing here decides anything: it is arithmetic on a matrix.
//
// - pearsonMatrix: Pearson correlation of M columns of equal length T from centred sums (each column minus its mean,
//   one correction pass), never Spearman. The diagonal is exactly 1, the matrix is exactly symmetric and no entry
//   leaves [-1, 1].
// - symmetricEigenvalues: the eigenvalues of a real symmetric matrix by the cyclic Jacobi method (Jacobi 1846;
//   Golub and Van Loan, "Matrix Computations", algorithm 8.4.1 "sym.schur2", in the rotation form of Numerical
//   Recipes 11.1). Every sweep visits each pair (p, q) once and rotates so that entry (p, q) becomes zero; the sweeps
//   stop when the off-diagonal Frobenius norm is at most `tolerance` times the norm of the whole matrix. Only the
//   eigenvalues are wanted, so the rotations are not accumulated.

/** A matrix as an array of rows (or, for pearsonMatrix, an array of columns). */
export type Matrix = readonly (readonly number[])[]

/** The most two mirrored entries may differ before a matrix is called asymmetric. */
const SYMMETRY_LIMIT = 1e-12

/** The centred column divided by its length, ready for a dot product; throws when the column does not vary. */
function unitColumn(column: readonly number[], index: number): Float64Array {
  const length = column.length
  let sum = 0
  for (let t = 0; t < length; t += 1) {
    const value = column[t] as number
    if (!Number.isFinite(value)) throw new Error(`column ${index} has a value that is not finite at session ${t}`)
    sum += value
  }
  const first = column[0] as number
  let mean = sum / length
  let correction = 0
  let constant = true
  for (let t = 0; t < length; t += 1) {
    const value = column[t] as number
    correction += value - mean
    if (value !== first) constant = false
  }
  mean += correction / length
  const centred = new Float64Array(length)
  let squares = 0
  for (let t = 0; t < length; t += 1) {
    const deviation = (column[t] as number) - mean
    centred[t] = deviation
    squares += deviation * deviation
  }
  // a constant column can leave a tiny non-zero deviation when its mean is not exact (0.1 three times), so test it
  if (constant || squares === 0) throw new Error(`column ${index} has no variance`)
  const scale = Math.sqrt(squares)
  for (let t = 0; t < length; t += 1) centred[t] = (centred[t] as number) / scale
  return centred
}

/**
 * The Pearson correlation matrix of `columns` (M columns, each of the same length T >= 3): an M x M array with
 * exactly 1 on the diagonal, exactly symmetric, every entry in [-1, 1]. No columns give an empty matrix.
 * Throws `column ${i} has no variance` for a constant column, and for fewer than 3 sessions, columns of unequal
 * length or a value that is not finite. The input is not changed.
 */
export function pearsonMatrix(columns: Matrix): number[][] {
  const count = columns.length
  if (count === 0) return []
  const sessions = (columns[0] as readonly number[]).length
  if (sessions < 3) throw new Error(`at least 3 sessions are needed, got ${sessions}`)
  for (let i = 1; i < count; i += 1) {
    const length = (columns[i] as readonly number[]).length
    if (length !== sessions) throw new Error(`column ${i} has ${length} sessions but column 0 has ${sessions}`)
  }
  const unit = columns.map((column, i) => unitColumn(column, i))
  const matrix = Array.from({ length: count }, () => new Array<number>(count).fill(1))
  for (let i = 0; i < count; i += 1) {
    const left = unit[i] as Float64Array
    for (let j = i + 1; j < count; j += 1) {
      const right = unit[j] as Float64Array
      let dot = 0
      for (let t = 0; t < sessions; t += 1) dot += (left[t] as number) * (right[t] as number)
      const r = Math.max(-1, Math.min(1, dot))
      ;(matrix[i] as number[])[j] = r
      ;(matrix[j] as number[])[i] = r
    }
  }
  return matrix
}

/** Reads the rows into one flat array, refusing a matrix that is not square, not finite or not symmetric. */
function symmetricCopy(matrix: Matrix): { size: number; a: Float64Array } {
  const size = matrix.length
  for (let i = 0; i < size; i += 1) {
    const row = matrix[i] as readonly number[]
    if (row.length !== size) throw new Error(`the matrix is not square: row ${i} has ${row.length} entries, not ${size}`)
    for (let j = 0; j < size; j += 1) {
      if (!Number.isFinite(row[j] as number)) throw new Error(`the matrix has an entry that is not finite at (${i}, ${j})`)
    }
  }
  const a = new Float64Array(size * size)
  for (let i = 0; i < size; i += 1) {
    const row = matrix[i] as readonly number[]
    a[i * size + i] = row[i] as number
    for (let j = i + 1; j < size; j += 1) {
      const upper = row[j] as number
      const lower = (matrix[j] as readonly number[])[i] as number
      if (Math.abs(upper - lower) > SYMMETRY_LIMIT) {
        throw new Error(`the matrix is not symmetric: entries (${i}, ${j}) and (${j}, ${i}) differ by ${Math.abs(upper - lower)}`)
      }
      const mean = (upper + lower) / 2
      a[i * size + j] = mean
      a[j * size + i] = mean
    }
  }
  return { size, a }
}

/**
 * The eigenvalues of a real symmetric matrix, largest first, by the cyclic Jacobi method. The sweeps stop when the
 * off-diagonal Frobenius norm is at most `tolerance` times the Frobenius norm of the whole matrix; the default
 * 1e-15 is reached in a handful of sweeps for a correlation matrix. Throws when the matrix is not square, holds a
 * value that is not finite, is asymmetric by more than 1e-12, or has not converged after `maxSweeps` sweeps. The
 * input is not changed.
 */
export function symmetricEigenvalues(matrix: Matrix, tolerance = 1e-15, maxSweeps = 100): number[] {
  const { size, a } = symmetricCopy(matrix)
  const at = (i: number, j: number): number => a[i * size + j] as number
  let whole = 0
  for (let k = 0; k < a.length; k += 1) whole += (a[k] as number) * (a[k] as number)
  const limit = tolerance * Math.sqrt(whole)
  for (let sweep = 0; ; sweep += 1) {
    let off = 0
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) off += 2 * at(i, j) * at(i, j)
    }
    if (Math.sqrt(off) <= limit) break
    if (sweep >= maxSweeps) throw new Error(`the eigenvalues did not converge in ${maxSweeps} sweeps`)
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const apq = at(p, q)
        if (apq === 0) continue
        // the rotation that zeroes (p, q): tan of the angle t is the smaller root of t^2 + 2 tau t - 1 = 0
        const tau = (at(q, q) - at(p, p)) / (2 * apq)
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c
        a[p * size + p] = at(p, p) - t * apq
        a[q * size + q] = at(q, q) + t * apq
        a[p * size + q] = 0
        a[q * size + p] = 0
        for (let r = 0; r < size; r += 1) {
          if (r === p || r === q) continue
          const arp = at(r, p)
          const arq = at(r, q)
          const rotatedP = c * arp - s * arq
          const rotatedQ = s * arp + c * arq
          a[r * size + p] = rotatedP
          a[p * size + r] = rotatedP
          a[r * size + q] = rotatedQ
          a[q * size + r] = rotatedQ
        }
      }
    }
  }
  return Array.from({ length: size }, (_, i) => at(i, i)).sort((x, y) => y - x)
}
