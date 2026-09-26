// WCAG 2.2 contrast checks for the terminal tokens (look spec sections 2 and 8.2).
// 1.4.3 text: 4.5:1. 1.4.11 non-text (control boundaries, focus ring, chart marks): 3:1.
// Pairs name tokens only, so the values live in tokens.css and nowhere else.

export const TEXT_MIN = 4.5
export const COMPONENT_MIN = 3
/** Steps sampled along each heat ramp (8.2: 101 steps, ends included). */
export const RAMP_STEPS = 101

const HEX = /^#([0-9A-Fa-f]{6})$/

export type TokenMap = Readonly<Record<string, string>>
export type CvdTheme = 'deut' | 'prot'

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

function parseHex(hex: string): readonly [number, number, number] {
  const match = HEX.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = Number.parseInt(match[1]!, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Linear sRGB-channel mix from `a` (t = 0) to `b` (t = 1), rounded to the nearest channel value. */
export function mixHex(a: string, b: string, t: number): string {
  const from = parseHex(a)
  const to = parseHex(b)
  const out = from.map((c, i) => Math.round(c + (to[i]! - c) * t))
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** The better ratio of the candidate text colours on `bg` (the heat-cell text rule). */
export function bestTextRatio(bg: string, candidates: readonly string[]): number {
  return Math.max(...candidates.map((fg) => contrastRatio(fg, bg)))
}

// ---------- reading tokens.css ----------

interface Block {
  readonly selector: string
  readonly body: string
}

function topLevelBlocks(css: string): Block[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks: Block[] = []
  let depth = 0
  let start = 0
  let open = 0
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (ch === '{') {
      if (depth === 0) open = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        blocks.push({ selector: clean.slice(start, open).trim(), body: clean.slice(open + 1, i) })
        start = i + 1
      }
    }
  }
  return blocks
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (name !== undefined && value !== undefined) out[name] = value.trim()
  }
  return out
}

function cvdOf(selector: string): CvdTheme | null {
  const m = /\[data-cvd="(deut|prot)"\]/.exec(selector)
  return m ? (m[1] as CvdTheme) : null
}

/**
 * Every custom property of the default theme as written (`#RRGGBB`, `var(--x)`, `15px`), keyed by name
 * without the dashes. With `cvd`, that theme's block is laid over the default one. At-rules such as
 * Tailwind's `@theme inline` are skipped: they map utilities onto these tokens and define none.
 */
export function readRawTokens(css: string, cvd?: CvdTheme): TokenMap {
  const blocks = topLevelBlocks(css).filter((b) => !b.selector.startsWith('@'))
  const base = blocks.filter((b) => cvdOf(b.selector) === null)
  const theme = cvd ? blocks.filter((b) => cvdOf(b.selector) === cvd) : []
  return Object.freeze(Object.assign({}, ...[...base, ...theme].map((b) => declarations(b.body))))
}

function resolve(raw: TokenMap, name: string, seen: ReadonlySet<string> = new Set()): string | null {
  const value = raw[name]
  if (value === undefined || seen.has(name)) return null
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(value)
  if (alias) return resolve(raw, alias[1]!, new Set([...seen, name]))
  return HEX.test(value) ? value.toUpperCase() : null
}

/** Every colour token resolved to `#RRGGBB` (aliases followed), for the default or a CVD theme. */
export function readTokens(css: string, cvd?: CvdTheme): TokenMap {
  const raw = readRawTokens(css, cvd)
  const out: Record<string, string> = {}
  for (const name of Object.keys(raw)) {
    const hex = resolve(raw, name)
    if (hex) out[name] = hex
  }
  return Object.freeze(out)
}

// ---------- the pairs of section 8.2 ----------

const on = (fgs: readonly string[], bgs: readonly string[], min: number): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })))

/** The five dark surfaces text sits on: body, pane, chrome, table header, selected row. */
const SURFACES = ['bg', 'raised', 'chrome', 'th-bg', 'sel-bg'] as const
/** Surfaces where plain --c-down passes; th-bg, sel-bg and hover-cell take its variants. */
const DOWN_SURFACES = ['bg', 'raised', 'chrome'] as const

const SECTOR_AND_GROUP = [
  'sec-equity', 'sec-rates', 'sec-fx', 'sec-energy', 'sec-metals', 'sec-grains', 'sec-livestock',
  'sec-benchmark', 'link-a', 'link-b', 'link-c',
] as const

const BLACK_LABEL_FILLS = [
  'field-bg', 'frame-bg', 'tab-on', 'tab-hover', 'key-cancel', 'key-go', 'key-sector', 'key-panel',
  'field-off', 'datatip-bg', 'heat-up-2', 'heat-up-1', 'heat-dn-2', 'marker', 'warn', 'dialog-title',
  'link-a', 'link-b', 'link-c',
] as const

const WHITE_LABEL_FILLS = [
  'fn-bar', 'fn-hover', 'fn-press', 'sel-list', 'sel-toggle', 'flag-bg', 'heat-dn-1', 'corr-dn-2',
  'corr-dn-1', 'corr-0', 'corr-up-1', 'corr-up-2', 'corr-diag', 'list-sel', 'tile-up-1', 'tile-up-2',
  'tile-dn-1', 'tile-dn-2', 'btn-top', 'btn-bot', 'hover-menu', 'legend-bg',
] as const

/** Named foreground/background pairs of the components (label on its own fill). */
const COMPONENT_TEXT: readonly (readonly [string, string])[] = [
  ['data', 'list-sel'], ['data', 'hover-menu'], ['data', 'hover-cell'], ['data', 'hover-row'],
  ['text', 'hover-row'], ['text', 'hover-cell'], ['c-up', 'hover-cell'], ['muted', 'hover-menu'],
  ['text', 'tab-bg'], ['tab-fg', 'tab-bg'], ['tab-on-fg', 'tab-on'], ['text', 'btn-grey'], ['text', 'field-btn'],
  ['tape-fg', 'tape-bg'], ['tape-src', 'tape-bg'], ['tip-fg', 'tip-bg'], ['frame-tab-fg', 'frame-tab-on'],
  ['frame-fg', 'frame-bg'], ['field-fg', 'field-bg'], ['fn-fg', 'fn-bar'], ['flag-fg', 'flag-bg'],
  ['th-fg', 'th-bg'], ['msg-fg', 'cmd-bg'], ['c-down-raised', 'th-bg'], ['c-down-raised', 'sel-bg'],
  ['c-down-hover', 'hover-cell'], ['c-down-hover', 'sel-bg'], ['muted-hover', 'hover-cell'],
  ['accent-2', 'bg'], ['accent-2', 'raised'], ['warn', 'bg'], ['warn', 'chrome'], ['cyan-name', 'bg'],
  ['cyan-chart', 'bg'], ['exc', 'bg'], ['fence', 'bg'], ['cvd-up', 'bg'], ['cvd-up', 'raised'],
  ['cvd-up', 'th-bg'], ['cvd-up', 'sel-bg'],
]

/** Graphics (1.4.11): control edges, the focus ring, the caret, scrollbars and chart marks. */
const GRAPHICS: readonly ContrastPair[] = [
  ...on(['cmd-border', 'cmd-cursor', 'cmd-caret', 'border-int', 'field-focus', 'focus'], DOWN_SURFACES, COMPONENT_MIN),
  { fg: 'sb-thumb', bg: 'sb-track', min: COMPONENT_MIN },
  { fg: 'sb-arrow', bg: 'sb-track', min: COMPONENT_MIN },
  { fg: 'list-border', bg: 'list-bg', min: COMPONENT_MIN },
  { fg: 'text', bg: 'field-btn', min: COMPONENT_MIN },
  ...on(['chart-s1', 'chart-axis', 'accent-2', 'chart-vol', 'candle-up', 'candle-dn', 'bar-pos', 'bar-neg',
    'last-line', 'roll-vol', 'dist-curve', 'zero-line'], ['bg'], COMPONENT_MIN),
]

function defaultPairs(): ContrastPair[] {
  return [
    ...on(['text', 'data', 'muted', 'white', 'c-up', 'link'], SURFACES, TEXT_MIN),
    ...on(['c-down'], DOWN_SURFACES, TEXT_MIN),
    ...on(SECTOR_AND_GROUP, ['bg', 'raised'], TEXT_MIN),
    ...on(['black'], BLACK_LABEL_FILLS, TEXT_MIN),
    ...on(['white'], WHITE_LABEL_FILLS, TEXT_MIN),
    ...COMPONENT_TEXT.map(([fg, bg]) => ({ fg, bg, min: TEXT_MIN })),
    ...GRAPHICS,
  ]
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze(defaultPairs())

/** Checked on each CVD theme's tokens: the swapped up, down and amber colours on the four surfaces. */
export const CVD_PAIRS: readonly ContrastPair[] = Object.freeze([
  ...on(['c-up', 'c-down-raised', 'data'], ['bg', 'raised', 'th-bg', 'sel-bg'], TEXT_MIN),
  ...on(['c-down'], DOWN_SURFACES, TEXT_MIN),
  { fg: 'c-down-hover', bg: 'hover-cell', min: TEXT_MIN },
  { fg: 'field-fg', bg: 'field-bg', min: TEXT_MIN },
  ...on(['black'], ['heat-up-2', 'heat-up-1'], TEXT_MIN),
])

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
