// Heat scales for cells (look spec 2.2): MON 4-step, CORR MOVERS 5-step, MRET SEAG ramp.
// Each returns the fill and the text colour. Text is whichever of black and white contrasts more
// with the fill, which gives the spec's choices (black on the MON steps except white on the dark red
// one; white on every CORR fill) and passes 4.5:1 along the whole SEAG ramp (worst 4.60 and 4.91).
// The printed value always carries the sign, so colour is never the only cue.
import { contrastRatio } from '../../theme/contrast'
import { DEFAULT_CHART_TOKENS, type ChartTokens } from './chartTokens'

export interface HeatCell {
  readonly fill: string
  readonly text: string
}

/** CORR thresholds (house): |r| below 0.10 neutral, 0.10 to 0.40 weak, above 0.40 strong. */
export const CORR_WEAK = 0.1
export const CORR_STRONG = 0.4

function isValue(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function blank(tokens: ChartTokens): HeatCell {
  return { fill: tokens.color.bg, text: tokens.color.text }
}

/** Black (the page black) or white, whichever contrasts more with `fill`. */
export function textOn(fill: string, tokens: ChartTokens = DEFAULT_CHART_TOKENS): string {
  const { bg: black, white } = tokens.color
  return contrastRatio(black, fill) >= contrastRatio(white, fill) ? black : white
}

function cell(fill: string, tokens: ChartTokens): HeatCell {
  return { fill, text: textOn(fill, tokens) }
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Linear sRGB channel interpolation from `a` (t = 0) to `b` (t = 1), rounded; t is clamped. */
export function interpolateHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t))
  const ca = channels(a)
  const cb = channels(b)
  const mixed = ca.map((v, i) => Math.round(v + (cb[i]! - v) * k))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/**
 * MON returns cell: strong step when |v| is at or beyond `strongAt` (the column's own threshold, since
 * 1D and 12M moves differ in size), weak step below it. Zero and missing values stay unfilled.
 */
export function monHeat(v: number | null | undefined, strongAt: number, tokens: ChartTokens = DEFAULT_CHART_TOKENS): HeatCell {
  if (!isValue(v) || v === 0) return blank(tokens)
  const c = tokens.color
  const strong = Math.abs(v) >= strongAt
  if (v > 0) return cell(strong ? c.heatUp2 : c.heatUp1, tokens)
  return cell(strong ? c.heatDn2 : c.heatDn1, tokens)
}

/** CORR cell on the MOVERS scale; the diagonal is grey. */
export function corrHeat(
  r: number | null | undefined,
  options: { readonly diagonal?: boolean } = {},
  tokens: ChartTokens = DEFAULT_CHART_TOKENS,
): HeatCell {
  const c = tokens.color
  if (options.diagonal) return cell(c.corrDiag, tokens)
  if (!isValue(r)) return blank(tokens)
  const size = Math.abs(r)
  if (size < CORR_WEAK) return cell(c.corr0, tokens)
  const strong = size > CORR_STRONG
  if (r > 0) return cell(strong ? c.corrUp2 : c.corrUp1, tokens)
  return cell(strong ? c.corrDn2 : c.corrDn1, tokens)
}

/**
 * MRET cell on the SEAG ramp: interpolated by |v| / maxAbs from the floor (small values never fall
 * to black) to the max, symmetric in sign. Zero counts as positive. Missing and future months stay black.
 */
export function seagHeat(v: number | null | undefined, maxAbs: number, tokens: ChartTokens = DEFAULT_CHART_TOKENS): HeatCell {
  if (!isValue(v)) return blank(tokens)
  const c = tokens.color
  const t = maxAbs > 0 ? Math.abs(v) / maxAbs : v === 0 ? 0 : 1
  const fill = v >= 0 ? interpolateHex(c.seagUpFloor, c.seagUpMax, t) : interpolateHex(c.seagDnFloor, c.seagDnMax, t)
  return cell(fill, tokens)
}
