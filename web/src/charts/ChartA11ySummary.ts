// The data summary every canvas chart carries as its accessible name (UI_SPEC section 9): range,
// first and last value, low and high, and on request the maximum drawdown. Gaps (null, NaN, Inf)
// are skipped, never read as zero. One loop, no Math.min(...values): a 250k-point series works.
import { CHART, fillCopy } from '../copy/workspace'

export interface SeriesSummaryInput {
  readonly name: string
  /** Labels for the x axis (dates or times), one per value. */
  readonly t: readonly string[]
  readonly v: readonly (number | null)[]
  readonly unit?: string
  readonly format?: (value: number) => string
  /** Add the largest peak-to-trough fall (for equity-like series with positive values). */
  readonly drawdown?: boolean
}

interface Extent {
  readonly count: number
  readonly firstIndex: number
  readonly lastIndex: number
  readonly min: number
  readonly max: number
  /** Largest fall from a running peak as a fraction (<= 0); null when a peak was not positive. */
  readonly maxDrawdown: number | null
}

/** One pass over the finite values: no argument spread, so any length works. */
function extent(v: readonly (number | null)[]): Extent | null {
  let count = 0
  let firstIndex = -1
  let lastIndex = -1
  let min = Infinity
  let max = -Infinity
  let peak = -Infinity
  let maxDrawdown: number | null = 0
  for (let i = 0; i < v.length; i += 1) {
    const value = v[i]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    count += 1
    if (firstIndex === -1) firstIndex = i
    lastIndex = i
    if (value < min) min = value
    if (value > max) max = value
    if (value > peak) peak = value
    if (peak <= 0) maxDrawdown = null
    else if (maxDrawdown !== null) maxDrawdown = Math.min(maxDrawdown, value / peak - 1)
  }
  return count === 0 ? null : { count, firstIndex, lastIndex, min, max, maxDrawdown }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

export function describeSeries(input: SeriesSummaryInput): string {
  const format = input.format ?? ((n: number) => String(n))
  const e = extent(input.v)
  if (!e) return fillCopy(CHART.emptySeries, { name: input.name })
  const values = {
    name: input.name,
    count: e.count,
    start: input.t[e.firstIndex] ?? '',
    end: input.t[e.lastIndex] ?? '',
    first: format(input.v[e.firstIndex] as number),
    last: format(input.v[e.lastIndex] as number),
    min: format(e.min),
    max: format(e.max),
    unit: input.unit ? ` ${input.unit}` : '',
  }
  if (input.drawdown && e.maxDrawdown !== null) {
    return fillCopy(CHART.seriesSummaryDrawdown, { ...values, drawdown: percent(e.maxDrawdown) })
  }
  return fillCopy(CHART.seriesSummary, values)
}
