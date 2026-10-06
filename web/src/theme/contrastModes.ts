// The two contrast modes of roadmap Phase D9, as checks on the stylesheets (pure text in, plain data out; the
// test beside this file reads the sheets):
// - forced colours (a Windows contrast theme): src/theme/forcedColors.css may use system colour keywords only,
//   must not lean on box-shadow (the theme drops it), and must give every state rule under src/ that draws a
//   selected, pressed, current or open state as a fill its own Highlight rule and its own keyboard ring;
// - prefers-contrast: more: src/theme/contrastMore.css lifts token values per look, read here over the
//   default or amber-classic tokens.
import { readTokens, type CvdTheme, type TokenMap } from './contrast'
import { readAmberClassicTokens } from './amberClassic'

/** The CSS system colours this app uses in forced-colours mode (CSS Color 4, section 6.2). */
export const SYSTEM_COLOURS: readonly string[] = Object.freeze([
  'Canvas', 'CanvasText', 'LinkText', 'Highlight', 'HighlightText', 'ButtonFace', 'ButtonText', 'GrayText',
])

export const FORCED_QUERY = '(forced-colors: active)'
export const MORE_QUERY = '(prefers-contrast: more)'

export interface Rule {
  readonly selector: string
  readonly decls: ReadonlyMap<string, string>
}

interface Block {
  readonly head: string
  readonly body: string
}

function blocks(css: string): Block[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Block[] = []
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
        out.push({ head: clean.slice(start, open).trim(), body: clean.slice(open + 1, i) })
        start = i + 1
      }
    }
  }
  return out
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    map.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim())
  }
  return map
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The selectors of a selector list, split on the commas outside any parentheses (`:is(a, b)` stays whole). */
export function splitSelectorList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      out.push(squash(list.slice(start, i)))
      start = i + 1
    }
  }
  out.push(squash(list.slice(start)))
  return out.filter((s) => s !== '')
}

/** A selector with its whitespace collapsed and single quotes made double, for comparison. */
export function normaliseSelector(selector: string): string {
  return squash(selector).replace(/'/g, '"')
}

/** Every style rule directly inside the top-level `@media <query>` blocks of a sheet. */
export function rulesInMedia(css: string, query: string): Rule[] {
  return blocks(css)
    .filter((b) => squash(b.head) === `@media ${query}`)
    .flatMap((b) => blocks(b.body).map((r) => ({ selector: squash(r.head), decls: declarations(r.body) })))
}

/** The top-level heads of a sheet that are not the given media query (anything that would apply outside it). */
export function headsOutside(css: string, query: string): string[] {
  return blocks(css).map((b) => squash(b.head)).filter((head) => head !== `@media ${query}`)
}

// ---------- forced colours ----------

const SYSTEM = new RegExp(`^(?:${SYSTEM_COLOURS.join('|')})$`)
const SYSTEM_WORD = new RegExp(`\\b(?:${SYSTEM_COLOURS.join('|')})\\b`)
const NON_SYSTEM_COLOUR = /var\(|#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\(|\bcurrentcolor\b|\btransparent\b/i
/** Properties whose whole value is one colour. */
const COLOUR_ONLY = /^(?:color|background-color|outline-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|fill|stroke)$/
/** Shorthands that carry a colour among other parts. */
const COLOUR_SHORTHAND = /^(?:background|outline|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?)$/

function declarationProblems(rule: Rule): string[] {
  const out: string[] = []
  for (const [prop, raw] of rule.decls) {
    const value = raw.replace(/\s*!important\s*$/i, '')
    const where = `${rule.selector} { ${prop} }`
    if (prop === 'box-shadow') out.push(`${where}: box-shadow is dropped by the theme; use an outline or a border`)
    if (NON_SYSTEM_COLOUR.test(value)) out.push(`${where}: ${value} is not a system colour`)
    else if (COLOUR_ONLY.test(prop) && !SYSTEM.test(value)) out.push(`${where}: ${value} is not a system colour`)
    else if (COLOUR_SHORTHAND.test(prop) && !SYSTEM_WORD.test(value) && !/^(?:0|none)$/.test(value)) {
      out.push(`${where}: ${value} names no system colour`)
    }
  }
  const adjust = rule.decls.get('forced-color-adjust')
  if (adjust === 'none' && !(SYSTEM.test(rule.decls.get('color') ?? '') && SYSTEM.test(rule.decls.get('background-color') ?? ''))) {
    out.push(`${rule.selector}: forced-color-adjust: none without its own system text and fill colours`)
  }
  return out
}

/**
 * What is wrong with a forced-colours sheet: a rule outside the media query, a selector not led by :root (the
 * component sheets load later and would win a tie), a colour that is not a system colour, a box-shadow, or
 * forced-color-adjust: none on a rule that does not then set its own system colours. [] means it passes.
 */
export function auditForcedSheet(css: string): string[] {
  const outside = headsOutside(css, FORCED_QUERY).map((head) => `${head}: outside ${FORCED_QUERY}`)
  const rules = rulesInMedia(css, FORCED_QUERY)
  const unled = rules
    .flatMap((r) => splitSelectorList(r.selector))
    .filter((part) => !part.startsWith(':root '))
    .map((part) => `${part}: not led by :root`)
  return [...outside, ...unled, ...rules.flatMap(declarationProblems)]
}

const STATE_ATTRIBUTE =
  /\[(?:aria-(?:selected|pressed|current|expanded|checked)|data-(?:selected|active|marked|highlight))=["']?(?:true|page)["']?\]/
const STATE_CLASS = /\.[a-z0-9-]+-(?:selected|held|on)\b/
const FILL = /^(?:background|background-color|box-shadow)$/

/** The selector parts of a sheet that draw a state (selected, pressed, current, open, marked) with a fill or a shadow. */
export function stateFillSelectors(css: string): string[] {
  const rules = blocks(css).flatMap((b) =>
    b.head.startsWith('@') ? blocks(b.body).map((r) => ({ head: r.head, body: r.body })) : [b],
  )
  const out = new Set<string>()
  for (const { head, body } of rules) {
    if (![...declarations(body).keys()].some((prop) => FILL.test(prop))) continue
    for (const part of splitSelectorList(head).map(normaliseSelector)) {
      const positive = part.replace(/:not\([^()]*\)/g, '')
      if (/:hover|:focus|:active/.test(positive)) continue
      if (STATE_ATTRIBUTE.test(positive) || STATE_CLASS.test(positive)) out.add(part)
    }
  }
  return [...out]
}

function selectorsWhere(rules: readonly Rule[], test: (decls: ReadonlyMap<string, string>) => boolean): Set<string> {
  return new Set(rules.filter((r) => test(r.decls)).flatMap((r) => splitSelectorList(r.selector).map(normaliseSelector)))
}

const plain = (value: string | undefined): string => (value ?? '').replace(/\s*!important\s*$/i, '')

/**
 * State selectors (from stateFillSelectors) the forced sheet does not answer: each needs `:root <selector>` in a rule
 * that fills Highlight with HighlightText text, and `:root <selector>:focus-visible` in a rule that rings it in
 * HighlightText.
 */
export function missingForcedStates(stateSelectors: readonly string[], forcedCss: string): string[] {
  const rules = rulesInMedia(forcedCss, FORCED_QUERY)
  const filled = selectorsWhere(rules, (d) => plain(d.get('background-color')) === 'Highlight' && plain(d.get('color')) === 'HighlightText')
  const ringed = selectorsWhere(rules, (d) => plain(d.get('outline-color')) === 'HighlightText')
  return stateSelectors.flatMap((s) => [
    ...(filled.has(`:root ${s}`) ? [] : [`${s}: no Highlight fill`]),
    ...(ringed.has(`:root ${s}:focus-visible`) ? [] : [`${s}: no HighlightText ring`]),
  ])
}

// ---------- prefers-contrast: more ----------

export type Look = 'standard' | 'amber-classic'

const LOOK_SELECTOR: Readonly<Record<Look, string>> = {
  standard: ':root:not([data-theme="amber-classic"])',
  'amber-classic': ':root[data-theme="amber-classic"]',
}

/** The token values the more-contrast sheet sets for one look, keyed by name without the dashes. */
export function contrastMoreOverrides(moreCss: string, look: Look): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of rulesInMedia(moreCss, MORE_QUERY)) {
    if (rule.selector !== LOOK_SELECTOR[look]) continue
    for (const [prop, value] of rule.decls) {
      if (prop.startsWith('--')) out[prop.slice(2)] = value.toUpperCase()
    }
  }
  return out
}

/** A look's resolved tokens with the more-contrast values laid over them (and a CVD theme, if given). */
export function readContrastMoreTokens(
  sheets: { readonly tokensCss: string; readonly amberCss: string; readonly moreCss: string },
  look: Look,
  cvd?: CvdTheme,
): TokenMap {
  const base = look === 'amber-classic' ? readAmberClassicTokens(sheets.tokensCss, sheets.amberCss, cvd) : readTokens(sheets.tokensCss, cvd)
  return Object.freeze({ ...base, ...contrastMoreOverrides(sheets.moreCss, look) })
}
