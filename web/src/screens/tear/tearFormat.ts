// Number and unit rules for the tear sheet (look spec 3.4; ANALYTICS_CATALOG C1). The API states a
// unit on every section and KPI. A unit that starts with "fraction" is shown as a percentage (the
// API value times 100, `%` attached); every other unit is shown as sent. Values are never rounded
// before display, so what the screen prints equals the API value at the printed precision.

import type { SummaryDrawdown } from '../../charts/ChartA11ySummary'
import { TEAR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'

export const MISSING = '--'

const FRACTION = /^fraction\b/i
const PERCENT_PER_YEAR = /^%/
const PERCENT_SCALE = 100

export interface NumberOptions {
  /** An explicit + on positive values (changes and returns). */
  readonly signed?: boolean
  /** Thousands separators (money and counts). */
  readonly thousands?: boolean
}

export function isPercentUnit(unit: string): boolean {
  return FRACTION.test(unit.trim())
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The value as displayed: a fraction times 100, else unchanged; null for a missing or non-finite value. */
export function toDisplay(value: number | null | undefined, unit: string): number | null {
  if (!finite(value)) return null
  return isPercentUnit(unit) ? value * PERCENT_SCALE : value
}

/** A series in display units. The API array itself comes back when nothing is scaled. */
export function scaleSeries(
  values: ReadonlyArray<number | null>,
  unit: string,
): ReadonlyArray<number | null> {
  if (!isPercentUnit(unit)) return values
  return values.map((v) => toDisplay(v, unit))
}

/** A short unit for the face of a KPI tile; the popover repeats the API's full unit. */
export function shortUnit(unit: string): string {
  const text = unit.trim()
  if (isPercentUnit(text) || PERCENT_PER_YEAR.test(text)) return '%'
  if (/^ratio\b/i.test(text)) return 'ratio'
  if (/^probability\b/i.test(text)) return 'probability'
  if (/^t statistic\b/i.test(text)) return ''
  if (/\bUSD\b/.test(text)) return 'USD'
  return text
}

/** Fixed decimals for a unit: 4 for a multiple of K, 3 for a probability, 0 for counts of periods. */
export function decimalsForUnit(unit: string): number {
  const text = unit.trim()
  if (/^multiple of K\b/i.test(text)) return 4
  if (/^probability\b/i.test(text)) return 3
  if (/^(sessions|months)$/i.test(text)) return 0
  return 2
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Fixed decimals, ASCII minus, `--` when missing, no negative zero. */
export function formatNumber(value: number | null | undefined, decimals: number, opts: NumberOptions = {}): string {
  if (!finite(value)) return MISSING
  let text = Math.abs(value).toFixed(decimals)
  const zero = Number(text) === 0
  if (opts.thousands) {
    const [whole = '', frac] = text.split('.')
    text = frac === undefined ? groupThousands(whole) : `${groupThousands(whole)}.${frac}`
  }
  if (zero) return text
  if (value < 0) return `-${text}`
  return opts.signed ? `+${text}` : text
}

/** A value in its API unit: percentages with `%` attached, USD with its code, others bare. */
export function formatValue(
  value: number | null | undefined,
  unit: string,
  decimals: number,
  signed = false,
): string {
  const shown = toDisplay(value, unit)
  if (shown === null) return MISSING
  const short = shortUnit(unit)
  const usd = short === 'USD'
  const text = formatNumber(shown, decimals, { signed, thousands: usd })
  if (short === '%') return `${text}%`
  return usd ? `${text} USD` : text
}

/** A share of a whole (hit rate, positive months) as a percentage with 2 decimals. */
export function formatShare(value: number | null | undefined): string {
  if (!finite(value)) return MISSING
  return `${formatNumber(value * PERCENT_SCALE, 2)}%`
}

/** The API's max drawdown for an equity chart's accessible name, formatted as the KPI tile shows it, with
 * its basis. Undefined when the API has none: the chart then states no drawdown rather than derive one. */
export function summaryDrawdown(value: number | null | undefined, unit: string, basis: string): SummaryDrawdown | undefined {
  if (!finite(value)) return undefined
  return { value: formatValue(value, unit, 2), basis: fillCopy(TEAR.basisShort, { basis }) }
}

/** The unit a panel prints: a fraction shown times 100 reads as percent, naming the API's unit. */
export function displayUnit(unit: string): string {
  return isPercentUnit(unit) ? fillCopy(TEAR.percentOf, { unit }) : unit
}
