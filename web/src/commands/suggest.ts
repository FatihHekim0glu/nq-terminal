// Suggestions for the command line, from the registry and GET /api/commands (UI_SPEC section 5, spec
// 4.2 autocomplete). Each suggestion carries the whole line it would leave, so choosing one replaces
// the line. Instruments show as generic tickers with their sector key (`NQ1 Index`) and match by root,
// symbol or ticker. sheetGroups() cuts the ranked list into the sheet's groups (6 rows each, 9 when
// one group matches) and counts what the "More ..." row holds.
import { CHROME_WORDS, SUGGESTION_DETAILS } from '../copy/commands'
import { isBuilt } from './built'
import { resolveContext } from './contexts'
import { withValue } from './messages'
import { stripSector } from './parser'
import { findMnemonic, MNEMONICS, TIMEFRAMES, type MnemonicDef } from './registry'
import { displayInstrument, mergeGenericTokens } from './sectors'
import type { CommandIndexData, ContextKind } from './types'

export const MAX_SUGGESTIONS = 200
export const GROUP_ROWS = 6
export const SINGLE_GROUP_ROWS = 9
const SEARCH_MIN = 2

export type SuggestionGroup = 'function' | ContextKind | 'argument' | 'search'

export interface Suggestion {
  /** The whole line after choosing this suggestion; unique within one list. */
  readonly value: string
  readonly label: string
  readonly detail: string
  readonly group: SuggestionGroup
}

export interface SheetGroup {
  readonly group: SuggestionGroup
  readonly items: readonly Suggestion[]
  /** Rows the sheet leaves behind the group's "More ..." row. */
  readonly more: number
}

interface Candidate {
  readonly label: string
  readonly detail: string
  readonly group: SuggestionGroup
  /** Other names the candidate answers to (an instrument's root and symbol). */
  readonly keys?: readonly string[]
}

/** In-order character match, ported from the SIGNAL command palette. */
export function fuzzy(s: string, q: string): boolean {
  if (q === '') return true
  let i = 0
  for (const c of s) {
    if (c === q[i]) i++
    if (i === q.length) return true
  }
  return false
}

/** A built screen shows its title; an unbuilt one (none now: every mnemonic opens a screen) says so, with its priority. */
function functionCandidate(m: MnemonicDef): Candidate {
  const detail = isBuilt(m.code) ? m.screen : withValue(SUGGESTION_DETAILS.notBuilt, `${m.screen} (${m.priority})`)
  return { label: m.code, detail, group: 'function' }
}

const CHROME_CANDIDATES: readonly Candidate[] = Object.entries(CHROME_WORDS).map(([word, detail]) => ({ label: word, detail, group: 'function' }))
/** D13: after NXTW, line.ts's parseRest never runs chromeAction, so none of these bare chrome words
 * parse there, only MAIN (aliased to HOME inside parseRest). Suggesting the others would Tab-complete
 * a line parseLine then rejects (e.g. 'NXTW N' + Tab landing on 'NXTW NO '). */
const NXTW_BARRED = new Set(Object.keys(CHROME_WORDS).filter((w) => w !== 'MAIN'))

function contextCandidates(index: CommandIndexData | null): Candidate[] {
  if (!index) return []
  return [
    ...index.universe.map((u) => ({ label: u, detail: SUGGESTION_DETAILS.universe, group: 'universe' as const })),
    ...index.instruments.map((i) => ({
      label: displayInstrument(i.root, index),
      detail: withValue(SUGGESTION_DETAILS.instrument, i.symbol),
      group: 'instrument' as const,
      keys: [i.root, i.symbol],
    })),
    ...index.hypotheses.map((h) => ({ label: h, detail: SUGGESTION_DETAILS.hypothesis, group: 'hypothesis' as const })),
    ...index.confirmations.map((c) => ({ label: c, detail: SUGGESTION_DETAILS.confirmation, group: 'hypothesis' as const })),
    ...index.runs.map((r) => ({ label: r, detail: SUGGESTION_DETAILS.run, group: 'run' as const })),
  ]
}

function functionsAfter(contextToken: string, index: CommandIndexData | null): Candidate[] {
  const kinds = new Set(resolveContext(contextToken, index).map((c) => c.kind))
  if (kinds.size === 0) return index ? [] : MNEMONICS.map(functionCandidate)
  return MNEMONICS.filter((m) => m.accepts.some((k) => kinds.has(k))).map(functionCandidate)
}

function argumentsFor(mnemonic: MnemonicDef | undefined): Candidate[] {
  if (mnemonic?.argument !== 'timeframe') return []
  return TIMEFRAMES.map((t) => ({ label: t, detail: SUGGESTION_DETAILS.timeframe, group: 'argument' as const }))
}

/** The complete tokens before the cursor, with `C 1` joined and a valid sector key dropped. */
function normalised(done: readonly string[], index: CommandIndexData | null): readonly string[] {
  const merged = mergeGenericTokens(done)
  const stripped = stripSector(merged, index)
  return stripped.ok ? stripped.value : merged
}

/** Candidates for the token at position `done.length`, given the complete tokens before it. */
function candidatesAt(done: readonly string[], index: CommandIndexData | null): Candidate[] {
  const [first, second] = done
  if (first === undefined) return [...MNEMONICS.map(functionCandidate), ...CHROME_CANDIDATES, ...contextCandidates(index)]
  const leading = findMnemonic(first)
  if (done.length === 1) return leading ? argumentsFor(leading) : functionsAfter(first, index)
  if (done.length === 2 && !leading && second !== undefined) return argumentsFor(findMnemonic(second))
  return []
}

function names(c: Candidate): readonly string[] {
  return [c.label, ...(c.keys ?? [])].map((n) => n.toLowerCase())
}

function rank(candidates: readonly Candidate[], prefix: string): Candidate[] {
  const q = prefix.toLowerCase()
  const starts = candidates.filter((c) => names(c).some((n) => n.startsWith(q)))
  if (q.length < SEARCH_MIN) return starts
  const loose = candidates.filter((c) => !starts.includes(c) && fuzzy(c.label.toLowerCase(), q))
  return [...starts, ...loose]
}

function searchRow(prefix: string): Suggestion {
  const line = `HL ${prefix}`
  return { value: line, label: line, detail: SUGGESTION_DETAILS.search, group: 'search' }
}

/** The suggestion list for the tokens at and after `done`, given the token still being typed.
 * `includeSearch` is false inside NXTW, whose grammar (line.ts) has no bare HL: `parseRest` never runs
 * `chromeAction`. `afterNxtw` is also true only inside NXTW: `parseRest` runs there too, so besides HL,
 * NO, MENU and a second NXTW must be dropped from the candidates as well (D13), MAIN excepted (it is
 * aliased to HOME inside parseRest, so it still parses). */
function suggestFrom(done: readonly string[], prefix: string, index: CommandIndexData | null, includeSearch: boolean, afterNxtw = false): Suggestion[] {
  const before = done.length > 0 ? `${done.join(' ')} ` : ''
  const seen = new Set<string>()
  const out: Suggestion[] = []
  const candidates = candidatesAt(normalised(done, index), index).filter((c) => !afterNxtw || !NXTW_BARRED.has(c.label))
  for (const c of rank(candidates, prefix)) {
    const value = `${before}${c.label}${c.group === 'argument' ? '' : ' '}`
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: c.label, detail: c.detail, group: c.group })
    if (out.length === MAX_SUGGESTIONS) break
  }
  if (includeSearch && done.length === 0 && prefix.length >= SEARCH_MIN) out.push(searchRow(prefix))
  return out
}

export function suggest(line: string, index: CommandIndexData | null): Suggestion[] {
  const trimmed = line.trimStart()
  if (trimmed.trim() === '') return []
  const tokens = trimmed.split(/\s+/)
  const prefix = /\s$/.test(trimmed) ? '' : (tokens.pop() ?? '')
  const done = tokens.filter((t) => t !== '')
  // NXTW opens whatever follows it in a new panel (line.ts); once it is a complete token, suggest and
  // Tab-complete the rest of the grammar as usual, prefixed so choosing one still leaves 'NXTW ...'.
  if (done[0]?.toUpperCase() === 'NXTW') {
    return suggestFrom(done.slice(1), prefix, index, false, true).map((s) => ({ ...s, value: `NXTW ${s.value}` }))
  }
  return suggestFrom(done, prefix, index, true)
}

/** The sheet's groups in order of first appearance; `expanded` shows one group in full. */
export function sheetGroups(list: readonly Suggestion[], expanded: SuggestionGroup | null): SheetGroup[] {
  const order = [...new Set(list.map((s) => s.group))]
  const cap = order.length === 1 ? SINGLE_GROUP_ROWS : GROUP_ROWS
  return order.map((group) => {
    const all = list.filter((s) => s.group === group)
    const items = group === expanded ? all : all.slice(0, cap)
    return { group, items, more: all.length - items.length }
  })
}
