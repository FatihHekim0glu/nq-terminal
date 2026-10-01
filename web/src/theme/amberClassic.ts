// The amber-classic theme (TASKS Phase 12): readers and checks for src/theme/amberClassic.css.
// The stylesheet may only override the colour values of tokens the default theme declares, never a
// token a colour-vision theme owns, so the two axes (data-theme and data-cvd) combine freely.
import { readRawTokens, readTokens, type ContrastPair, type CvdTheme, type TokenMap } from './contrast'

import { AMBER_CLASSIC_THEME } from './look'

export { AMBER_CLASSIC_THEME }
export const AMBER_CLASSIC_SELECTOR = `:root[data-theme="${AMBER_CLASSIC_THEME}"]`

/**
 * Tokens the amber block may never set. The print palette is read from the live page by the evidence pack and
 * the print dossier and must stay black on white whatever the screen look; the regime ramp is told apart by
 * lightness alone and is checked on the black screen, which this look keeps.
 */
export const FIXED_TOKENS: readonly string[] = Object.freeze([
  'print-bg', 'print-fg', 'print-muted', 'print-rule', 'print-label', 'regime-low', 'regime-mid', 'regime-high',
])

const HEX = /^#[0-9A-F]{6}$/i
const ALIAS = /^var\(--([a-z0-9-]+)\)$/i
const CVD_SELECTOR = /\[data-cvd="(deut|prot)"\]/

interface Block {
  readonly selector: string
  readonly body: string
}

function blocksOf(css: string): Block[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Block[] = []
  let depth = 0
  let start = 0
  let open = 0
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i] === '{') {
      if (depth === 0) open = i
      depth += 1
    } else if (clean[i] === '}') {
      depth -= 1
      if (depth === 0) {
        out.push({ selector: clean.slice(start, open).trim(), body: clean.slice(open + 1, i) })
        start = i + 1
      }
    }
  }
  return out
}

/** Every declaration of the amber-classic block, keyed by token name without the dashes. */
export function amberClassicOverrides(amberCss: string): Record<string, string> {
  return { ...readRawTokens(amberCss) }
}

/** Tokens declared inside a data-cvd block of tokens.css: the colour-vision themes own these. */
function cvdOwned(tokensCss: string): Set<string> {
  const owned = blocksOf(tokensCss)
    .filter((b) => CVD_SELECTOR.test(b.selector))
    .flatMap((b) => [...b.body.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]!))
  return new Set(owned)
}

function declarationProblems(name: string, value: string, base: TokenMap, colours: TokenMap, owned: Set<string>): string[] {
  if (!(name in base)) return [`--${name} is not a token of the default theme`]
  if (!(name in colours)) return [`--${name} is not a colour token (sizes and fonts stay as they are)`]
  if (owned.has(name)) return [`--${name} belongs to a colour-vision theme`]
  if (FIXED_TOKENS.includes(name)) return [`--${name} is fixed in every look (print and regime tokens)`]
  const alias = ALIAS.exec(value)
  if (alias && !(alias[1]! in colours)) return [`--${name} points at an unknown token`]
  if (!alias && !HEX.test(value)) return [`--${name} is not a 6-digit hex colour: ${value}`]
  return []
}

/** What is wrong with the stylesheet as a pure token-value override; [] when nothing is. */
export function auditAmberClassicStructure(tokensCss: string, amberCss: string): string[] {
  const blocks = blocksOf(amberCss)
  const problems: string[] = []
  if (blocks.length !== 1) problems.push(`expected one block, found ${blocks.length}`)
  for (const b of blocks) {
    if (b.selector !== AMBER_CLASSIC_SELECTOR) problems.push(`unexpected selector: ${b.selector}`)
    const rest = b.body.replace(/--[a-z0-9-]+\s*:[^;]+;/gi, '').trim()
    if (rest) problems.push(`declarations other than custom properties: ${rest}`)
  }
  const base = readRawTokens(tokensCss)
  const colours = readTokens(tokensCss)
  const owned = cvdOwned(tokensCss)
  for (const [name, value] of Object.entries(amberClassicOverrides(amberCss))) {
    problems.push(...declarationProblems(name, value, base, colours, owned))
  }
  return problems
}

/**
 * The colour tokens with amber-classic laid over the default theme, and then the CVD theme if one is
 * given. The theme and a CVD block never share a token (auditAmberClassicStructure), so the order of
 * the two overlays does not change the result.
 */
export function readAmberClassicTokens(tokensCss: string, amberCss: string, cvd?: CvdTheme): TokenMap {
  return readTokens(`${tokensCss}\n${amberCss}`, cvd)
}

// ---------- the extra pairs ----------

const on = (fgs: readonly string[], bgs: readonly string[], min: number): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })))

/** Every dark fill the amber text and labels can sit on in this theme. */
const AMBER_SURFACES = [
  'bg', 'surface', 'raised', 'chrome', 'th-bg', 'sel-bg', 'hover-row', 'hover-cell', 'hover-menu', 'list-bg',
  'list-sel', 'ac-bg', 'tab-bg', 'btn-grey', 'field-btn', 'ro-box', 'band', 'cfg-head', 'stats-band',
  'toggle-hover', 'spark-bg', 'legend-bg', 'minibar-bg', 'cmd-bg', 'tape-bg', 'btn-top', 'btn-bot',
] as const

/** Where secondary text sits (a hovered cell takes --muted-hover instead). */
const MUTED_SURFACES = [
  'bg', 'raised', 'chrome', 'th-bg', 'sel-bg', 'hover-row', 'hover-menu', 'list-bg', 'ac-bg', 'band',
  'cfg-head', 'stats-band', 'spark-bg', 'legend-bg',
] as const

/** Pairs added for amber-classic, on top of the default CONTRAST_PAIRS (which still apply). */
export const AMBER_CLASSIC_PAIRS: readonly ContrastPair[] = Object.freeze([
  ...on(['text', 'data'], AMBER_SURFACES, 4.5),
  ...on(['muted'], MUTED_SURFACES, 4.5),
  { fg: 'muted-hover', bg: 'hover-cell', min: 4.5 },
  ...on(['th-fg'], ['th-bg', 'hover-row'], 4.5),
  ...on(['tab-fg'], ['tab-bg'], 4.5),
  ...on(['frame-tab-fg'], ['frame-tab-on'], 4.5),
  ...on(['minibar-fg'], ['minibar-bg'], 4.5),
  ...on(['msg-fg'], ['cmd-bg', 'bg'], 4.5),
  ...on(['white', 'fn-fg'], ['fn-bar', 'fn-hover', 'fn-press'], 4.5),
  ...on(['black', 'tab-on-fg'], ['tab-on', 'tab-hover'], 4.5),
  ...on(['field-fg'], ['field-bg'], 4.5),
  ...on(['chart-axis'], ['bg', 'legend-bg'], 4.5),
  ...on(['border-int', 'list-border', 'menu-border'], ['bg', 'raised', 'chrome', 'list-bg'], 3),
  { fg: 'sb-thumb', bg: 'sb-track', min: 3 },
  { fg: 'sb-thumb', bg: 'sb-track-list', min: 3 },
  { fg: 'sb-arrow', bg: 'sb-track', min: 3 },
  ...on(['focus'], ['fn-bar', 'fn-hover', 'tab-bg'], 3),
  // The frame strip: its black text on the strip, and on a hovered tab (--tab-on), where its focus ring is
  // black too (FrameStrip.css), so the ring needs 3:1 as well.
  { fg: 'frame-fg', bg: 'frame-bg', min: 4.5 },
  { fg: 'frame-fg', bg: 'tab-on', min: 4.5 },
  { fg: 'frame-fg', bg: 'tab-on', min: 3 },
  // The selected row of a menu or list and a pressed toggle: white text on the three blue fills.
  ...on(['white'], ['sel-list', 'list-sel', 'sel-toggle'], 4.5),
])
