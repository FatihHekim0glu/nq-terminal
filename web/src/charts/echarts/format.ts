// Number and date formats for the ECharts set. Signed values always carry their sign (UI_SPEC 9,
// WCAG 1.4.1: colour is never the only cue), and a value that rounds to zero prints without a sign.
// Rounding is the screens' one rule (format/decimal.ts toDecimal: the shortest decimal, ties half away
// from zero), never Number.prototype.toFixed, which rounds the binary value (-0.735 would print -0.73).
import { toDecimal } from '../../format/decimal'

function trimNegativeZero(text: string): string {
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

function groupThousands(text: string): string {
  const [whole = '', frac] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/** Fixed decimals with thousands grouped, never `-0.00`. */
export function fixed(value: number, decimals: number): string {
  return groupThousands(trimNegativeZero(toDecimal(value, decimals)))
}

/** Fixed decimals with an explicit `+` on positive values; zero (after rounding) has no sign. */
export function signed(value: number, decimals: number): string {
  const text = fixed(value, decimals)
  return /^[0.,]+$/.test(text) || text.startsWith('-') ? text : `+${text}`
}

const P_FLOOR = 0.0001

/** p-values to four decimals; anything smaller prints as `<0.0001`. */
export function formatP(p: number): string {
  return p < P_FLOOR ? `<${toDecimal(P_FLOOR, 4)}` : toDecimal(p, 4)
}

/** Epoch seconds as YYYY-MM-DD (UTC). */
export function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** `-4.00%` for a percentage, `+0.16 R` for any other unit, the bare number without one. */
export function withUnit(text: string, unit?: string): string {
  if (!unit) return text
  return unit === '%' ? `${text}%` : `${text} ${unit}`
}
