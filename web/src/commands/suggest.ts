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

/** A built screen shows its title; only an unbuilt one (JOBS) says so, with its priority. */
function functionCandidate(m: MnemonicDef): Candidate {
  const detail = isBuilt(m.code) ? m.screen : withValue(SUGGESTION_DETAILS.notBuilt, `${m.screen} (${m.priority})`)
  return { label: m.code, detail, group: 'function' }
}

const CHROME_CANDIDATES: readonly Candidate[] = Object.entries(CHROME_WORDS).map(([word, detail]) => ({ label: word, detail, group: 'function' }))

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

export function suggest(line: string, index: CommandIndexData | null): Suggestion[] {
  const trimmed = line.trimStart()
  if (trimmed.trim() === '') return []
  const tokens = trimmed.split(/\s+/)
  const prefix = /\s$/.test(trimmed) ? '' : (tokens.pop() ?? '')
  const done = tokens.filter((t) => t !== '')
  const before = done.length > 0 ? `${done.join(' ')} ` : ''
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const c of rank(candidatesAt(normalised(done, index), index), prefix)) {
    const value = `${before}${c.label}${c.group === 'argument' ? '' : ' '}`
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: c.label, detail: c.detail, group: c.group })
    if (out.length === MAX_SUGGESTIONS) break
  }
  if (done.length === 0 && prefix.length >= SEARCH_MIN) out.push(searchRow(prefix))
  return out
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
