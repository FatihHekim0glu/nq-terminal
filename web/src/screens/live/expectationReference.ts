// TEST REFERENCE ONLY: the browser's client-phase placement of LV6 (C8 exception, recorded 2026-09-29), kept so the
// tests can check that the served placement (GET /api/analytics/paper-expectation, analytics/expectation.py) equals
// what the browser drew. No production module imports this file; the LIVE card reads the served view.
//
// pathOnCone is pinned by qa/crosscheck/p12_expectation.py (numpy: usd / K, searchsorted side='right'): the golden
// file qa/golden/p12_expectation.json is read by expectationReference.test.ts, case by case.

/** The band a value sits in, named by the percentiles around it (p5to25 is at or above p5 and below p25). */
export const CONE_BANDS = ['below5', 'p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'] as const
export type ConeBandName = (typeof CONE_BANDS)[number]

/** The five percentiles of the cone at one step: p5, p25, p50, p75, p95. */
export type ConePercentiles = readonly [number, number, number, number, number]

const PERCENTILE_KEYS = ['5', '25', '50', '75', '95'] as const
type PercentileKey = (typeof PERCENTILE_KEYS)[number]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The band of `value` among five percentiles: the count of percentiles at or below it, named. A value exactly on
 * a percentile is in the band above it (numpy.searchsorted side='right'). Null when the value or a percentile is
 * not a finite number, or the percentiles are not in ascending order.
 */
export function coneBand(value: number, q: ConePercentiles): ConeBandName | null {
  if (!finite(value) || q.length !== PERCENTILE_KEYS.length || !q.every(finite)) return null
  if (q.some((p, i) => i > 0 && p < q[i - 1]!)) return null
  return CONE_BANDS[q.filter((p) => p <= value).length]!
}

export interface PathOnConeInput {
  /** Cumulative P&L in USD, one entry per journal row; null before the first performance row and in a gap. */
  readonly usd: ReadonlyArray<number | null>
  /** K in USD: the served capital of the linked Nautilus reproduction. Must be finite and above zero. */
  readonly capital: number
  /** The cone's pointwise percentiles by step, in the cone's own unit (fraction of K). */
  readonly quantiles: Readonly<Record<PercentileKey, ReadonlyArray<number | null>>>
  /** The cone's number of steps. */
  readonly horizon: number
}

export interface PathOnCone {
  readonly firstIndex: number | null
  readonly fraction: ReadonlyArray<number | null>
  readonly bands: ReadonlyArray<ConeBandName | null>
  readonly beyond: number
}

function percentilesAt(quantiles: PathOnConeInput['quantiles'], step: number): ConePercentiles | null {
  const cut = PERCENTILE_KEYS.map((key) => (quantiles[key] as ReadonlyArray<number | null> | undefined)?.[step])
  return cut.every(finite) ? (cut as unknown as ConePercentiles) : null
}

/** Places a cumulative USD path on the cone, step by step (steps count rows from the first one with a value). */
export function pathOnCone(input: PathOnConeInput): PathOnCone {
  const { usd, capital, quantiles, horizon } = input
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('capital must be a positive finite number')
  if (!Number.isInteger(horizon) || horizon < 0) throw new Error('horizon must be a non-negative whole number')
  const empty = (): null[] => Array.from({ length: horizon }, () => null)
  const first = usd.findIndex(finite)
  if (first < 0) return { firstIndex: null, fraction: empty(), bands: empty(), beyond: 0 }

  const fraction: Array<number | null> = []
  const bands: Array<ConeBandName | null> = []
  for (let step = 0; step < horizon; step += 1) {
    const value = usd[first + step]
    if (!finite(value)) {
      fraction.push(null)
      bands.push(null)
      continue
    }
    const share = value / capital
    const cut = percentilesAt(quantiles, step)
    fraction.push(share)
    bands.push(cut === null ? null : coneBand(share, cut))
  }
  return { firstIndex: first, fraction, bands, beyond: usd.slice(first + horizon).filter(finite).length }
}
