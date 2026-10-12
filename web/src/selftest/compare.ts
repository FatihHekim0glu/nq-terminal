// Comparing what the page computes with what a golden file holds. Numbers are met within one part in 1e9 relative to the
// golden's own value; names, integers, bands, labels and clusters must be equal exactly. A tally keeps the count, the worst
// error and the first thing that differed, and turns into the report row of one golden.
import { GOLDEN_TOLERANCE, type GoldenName, type GoldenReport } from './report.ts'

/**
 * |got - want| / |want|; zero when they are equal (so a golden zero met exactly is no error) and Infinity when either is not
 * a finite number or the golden is zero and the value is not. A golden of exactly zero from a computation (an eigenvalue of
 * a singular matrix) is measured against `scale` instead, the size of the numbers around it.
 */
export function relativeError(got: number, want: number, scale = 0): number {
  if (got === want) return 0
  if (!Number.isFinite(got) || !Number.isFinite(want)) return Number.POSITIVE_INFINITY
  const size = Math.max(Math.abs(want), scale)
  return size === 0 ? Number.POSITIVE_INFINITY : Math.abs(got - want) / size
}

export interface Tally {
  /** One number against its golden; `scale` widens the denominator for values that are zero by construction. */
  number(label: string, got: number | null | undefined, want: number | null | undefined, scale?: number): void
  /** Equality of anything that is plain data (strings, integers, nested arrays of them). */
  exact(label: string, got: unknown, want: unknown): void
  /** A nested structure: every number within tolerance, everything else equal, shapes the same. */
  tree(label: string, got: unknown, want: unknown, scale?: number): void
  report(name: GoldenName): GoldenReport
}

interface State {
  checks: number
  failed: number
  worst: number
  first: string | null
}

function fail(state: State, label: string, why: string): void {
  state.failed += 1
  state.first ??= `${label}: ${why}`
}

function compareNumber(state: State, label: string, got: unknown, want: unknown, scale: number): void {
  state.checks += 1
  if (typeof got !== 'number' || typeof want !== 'number') {
    if (got !== want) fail(state, label, `${String(got)} is not ${String(want)}`)
    return
  }
  const error = relativeError(got, want, scale)
  if (Number.isFinite(error)) state.worst = Math.max(state.worst, error)
  else state.worst = Number.POSITIVE_INFINITY
  if (!(error <= GOLDEN_TOLERANCE)) fail(state, label, `${got} against ${want} (relative error ${error})`)
}

function compareTree(state: State, label: string, got: unknown, want: unknown, scale: number): void {
  if (typeof want === 'number' || typeof got === 'number') return compareNumber(state, label, got, want, scale)
  if (Array.isArray(want) || Array.isArray(got)) {
    if (!Array.isArray(want) || !Array.isArray(got) || want.length !== got.length) {
      state.checks += 1
      return fail(state, label, `length ${Array.isArray(got) ? got.length : typeof got} is not ${Array.isArray(want) ? want.length : typeof want}`)
    }
    return want.forEach((item, i) => compareTree(state, `${label}[${i}]`, got[i], item, scale))
  }
  if (typeof want === 'object' && want !== null && typeof got === 'object' && got !== null) {
    const names = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()
    for (const name of names) {
      const missing = !(name in want) || !(name in got)
      if (missing) {
        state.checks += 1
        fail(state, `${label}.${name}`, 'present on one side only')
      } else compareTree(state, `${label}.${name}`, (got as Record<string, unknown>)[name], (want as Record<string, unknown>)[name], scale)
    }
    return
  }
  state.checks += 1
  if (got !== want) fail(state, label, `${JSON.stringify(got)} is not ${JSON.stringify(want)}`)
}

export function createTally(): Tally {
  const state: State = { checks: 0, failed: 0, worst: 0, first: null }
  return {
    number: (label, got, want, scale = 0) => compareNumber(state, label, got, want, scale),
    exact(label, got, want) {
      state.checks += 1
      if (JSON.stringify(got) !== JSON.stringify(want)) fail(state, label, `${JSON.stringify(got)} is not ${JSON.stringify(want)}`)
    },
    tree: (label, got, want, scale = 0) => compareTree(state, label, got, want, scale),
    report: (name) => ({
      name,
      checks: state.checks,
      failed: state.failed,
      maxRelativeError: state.worst,
      firstFailure: state.first,
      passed: state.failed === 0 && state.worst <= GOLDEN_TOLERANCE,
    }),
  }
}
