// The colour pairs the stylesheets actually write (TASKS Phase 12): every rule that sets a text colour and a
// fill from tokens, read straight from the .css sources, so a look is checked on the pairs the screens use
// and not only on a hand-kept list. Pure text in, plain data out; the test beside it reads the files.
import type { ContrastPair } from './contrast'

export interface CssPair extends ContrastPair {
  /** The rule's selector, as written (comments removed). */
  readonly selector: string
  /** Where the rule sits, for the failure message. */
  readonly source: string
  /** A disabled control: WCAG 1.4.3 exempts inactive user interface components from the text minimum. */
  readonly inactive: boolean
}

/** A rule that sets only a fill from a token: the text on it is whatever the page inherits. */
export interface CssFill {
  readonly bg: string
  readonly selector: string
  readonly source: string
  /** True when the rule also sets a text colour that is not a plain token reference. */
  readonly ownText: boolean
}

export interface CssScan {
  readonly pairs: readonly CssPair[]
  readonly fills: readonly CssFill[]
}

interface Rule {
  readonly selector: string
  readonly body: string
}

const TOKEN_REF = /^var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)$/i
const SKIPPED_AT_RULES = /^@(?:keyframes|font-face|page|property|-webkit-keyframes)\b/i
const INACTIVE = /\[aria-disabled(?:=["']?true["']?)?\]|:disabled/i
const TEXT_MIN = 4.5

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Style rules of a sheet, with the contents of @media and @supports blocks flattened in. */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = []
  let depth = 0
  let start = 0
  let open = 0
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) open = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth !== 0) continue
      const selector = css.slice(start, open).trim()
      const body = css.slice(open + 1, i)
      start = i + 1
      if (!selector.startsWith('@')) out.push({ selector, body })
      else if (!SKIPPED_AT_RULES.test(selector)) out.push(...rulesOf(body))
    }
  }
  return out
}

function declarationsOf(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    map.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/\s*!important\s*$/i, '').trim())
  }
  return map
}

function tokenOf(value: string | undefined): string | null {
  const match = value === undefined ? null : TOKEN_REF.exec(value)
  return match ? match[1]!.toLowerCase() : null
}

/** The fill a rule paints from one token: `background-color`, or a `background` that is just that token. */
function fillOf(decls: Map<string, string>): string | null {
  return tokenOf(decls.get('background-color')) ?? tokenOf(decls.get('background'))
}

/**
 * Reads one stylesheet. A pair is a rule that sets both `color` and a fill from tokens. A fill-only rule is
 * listed apart, because the text on it is inherited. Selector lists are kept as one rule (the declarations
 * are shared by every selector in it).
 */
export function scanCssPairs(css: string, source: string): CssScan {
  const pairs: CssPair[] = []
  const fills: CssFill[] = []
  for (const { selector, body } of rulesOf(stripComments(css))) {
    const decls = declarationsOf(body)
    const bg = fillOf(decls)
    if (bg === null) continue
    const colour = decls.get('color')
    const fg = tokenOf(colour)
    if (fg !== null) pairs.push({ fg, bg, min: TEXT_MIN, selector, source, inactive: INACTIVE.test(selector) })
    else fills.push({ bg, selector, source, ownText: colour !== undefined })
  }
  return { pairs, fills }
}

/** The scans of several sheets as one. */
export function mergeScans(scans: readonly CssScan[]): CssScan {
  return { pairs: scans.flatMap((s) => s.pairs), fills: scans.flatMap((s) => s.fills) }
}

/** The pairs without the repeats (the same fg, bg and minimum), keeping the first rule that wrote each. */
export function uniquePairs(pairs: readonly CssPair[]): CssPair[] {
  const seen = new Map<string, CssPair>()
  for (const p of pairs) {
    const key = `${p.fg}|${p.bg}|${p.min}`
    if (!seen.has(key)) seen.set(key, p)
  }
  return [...seen.values()]
}
