// The data summary every canvas chart carries as its accessible name (UI_SPEC section 9): range,
// first and last value, low and high, and the maximum drawdown when the screen passes the API's figure.
// The drawdown is never derived from the plotted values: a Basis A curve (1 plus a cumulative sum)
// has no honest peak ratio, and exposure or contract series have no drawdown at all. Gaps (null, NaN,
// Inf) are skipped, never read as zero. One loop, no Math.min(...values): a 250k-point series works.
import { CHART, fillCopy } from '../copy/workspace'

export interface SeriesSummaryInput {
  readonly name: string
  /** Labels for the x axis (dates or times), one per value. */
  readonly t: readonly string[]
  readonly v: readonly (number | null)[]
  readonly unit?: string
  readonly format?: (value: number) => string
  /** The API's maximum drawdown, formatted with its unit, and the basis it is on. */
  readonly drawdown?: SummaryDrawdown
}

export interface SummaryDrawdown {
  /** Already formatted by the screen, for example "-22.64%". */
  readonly value: string
  /** For example "Basis A". */
  readonly basis: string
}

interface Extent {
  readonly count: number
  readonly firstIndex: number
  readonly lastIndex: number
  readonly min: number
  readonly max: number
}

/** One pass over the finite values: no argument spread, so any length works. */
function extent(v: readonly (number | null)[]): Extent | null {
  let count = 0
  let firstIndex = -1
  let lastIndex = -1
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < v.length; i += 1) {
    const value = v[i]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    count += 1
    if (firstIndex === -1) firstIndex = i
    lastIndex = i
    if (value < min) min = value
    if (value > max) max = value
  }
  return count === 0 ? null : { count, firstIndex, lastIndex, min, max }
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
  if (input.drawdown) {
    return fillCopy(CHART.seriesSummaryDrawdown, { ...values, drawdown: input.drawdown.value, basis: input.drawdown.basis })
  }
  return fillCopy(CHART.seriesSummary, values)
}
