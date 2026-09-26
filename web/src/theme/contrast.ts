// WCAG 2.2 contrast checks for the terminal tokens (UI_SPEC sections 3 and 9).
// 1.4.3 text: 4.5:1. 1.4.11 non-text (control boundaries, focus ring, chart lines): 3:1.

export const TEXT_MIN = 4.5
export const COMPONENT_MIN = 3

const HEX = /^#([0-9A-Fa-f]{6})$/

export type TokenMap = Readonly<Record<string, string>>

export interface ContrastPair {
  readonly fg: string
  readonly bg: string
  readonly min: number
}

export interface ContrastFailure extends ContrastPair {
  /** null when either token is missing or not a 6-digit hex colour */
  readonly ratio: number | null
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const match = HEX.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = Number.parseInt(match[1]!, 16)
  const r = channel((n >> 16) & 0xff)
  const g = channel((n >> 8) & 0xff)
  const b = channel(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every `--name: #RRGGBB;` declaration in the stylesheet, keyed by name without the dashes. */
export function readTokens(css: string): TokenMap {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    out[m[1]!] = m[2]!.toUpperCase()
  }
  return out
}

const BACKGROUNDS = ['bg', 'surface', 'raised'] as const

const TEXT_TOKENS = [
  'text', 'data', 'muted', 'accent', 'accent-2', 'c-up', 'c-down', 'cvd-up', 'fence',
  'sec-equity', 'sec-rates', 'sec-fx', 'sec-energy', 'sec-metals', 'sec-grains',
  'sec-livestock', 'sec-benchmark', 'link-a', 'link-b', 'link-c',
] as const

// Control boundaries and the focus ring (1.4.11, 2.4.7).
const COMPONENT_TOKENS = ['border-int', 'accent'] as const

function allPairs(): ContrastPair[] {
  const text = TEXT_TOKENS.flatMap((fg) => BACKGROUNDS.map((bg) => ({ fg, bg, min: TEXT_MIN })))
  // The selected suggestion row: its label (data), its detail (muted) and prose (text) on --sel-bg.
  const selected = (['text', 'data', 'muted', 'accent'] as const).map((fg) => ({ fg, bg: 'sel-bg', min: TEXT_MIN }))
  const components = COMPONENT_TOKENS.flatMap((fg) =>
    BACKGROUNDS.map((bg) => ({ fg, bg, min: COMPONENT_MIN })),
  )
  return [...text, ...selected, ...components]
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze(allPairs())

function measure(tokens: TokenMap, pair: ContrastPair): number | null {
  const fg = tokens[pair.fg]
  const bg = tokens[pair.bg]
  if (!fg || !bg || !HEX.test(fg) || !HEX.test(bg)) return null
  return contrastRatio(fg, bg)
}

/** The pairs that fall below their threshold, or whose tokens are missing. [] means all pass. */
export function auditContrast(
  tokens: TokenMap,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastFailure[] {
  return pairs
    .map((pair) => ({ ...pair, ratio: measure(tokens, pair) }))
    .filter((result) => result.ratio === null || result.ratio < result.min)
}
