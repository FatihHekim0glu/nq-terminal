// Suggestions for the command line, from the registry and GET /api/commands (UI_SPEC section 5).
// Each suggestion carries the whole line it would leave, so choosing one replaces the line.
import { SUGGESTION_DETAILS } from '../copy/commands'
import { resolveContext } from './contexts'
import { withValue } from './messages'
import { findMnemonic, MNEMONICS, TIMEFRAMES, type MnemonicDef } from './registry'
import type { CommandIndexData, ContextKind } from './types'

export const MAX_SUGGESTIONS = 12

export type SuggestionGroup = 'function' | ContextKind | 'argument'

export interface Suggestion {
  /** The whole line after choosing this suggestion; unique within one list. */
  readonly value: string
  readonly label: string
  readonly detail: string
  readonly group: SuggestionGroup
}

interface Candidate {
  readonly label: string
  readonly detail: string
  readonly group: SuggestionGroup
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

function functionCandidate(m: MnemonicDef): Candidate {
  const detail = m.priority === 'P0' ? m.screen : withValue(SUGGESTION_DETAILS.notBuilt, `${m.screen} (${m.priority})`)
  return { label: m.code, detail, group: 'function' }
}

function contextCandidates(index: CommandIndexData | null): Candidate[] {
  if (!index) return []
  return [
    ...index.universe.map((u) => ({ label: u, detail: SUGGESTION_DETAILS.universe, group: 'universe' as const })),
    ...index.instruments.map((i) => ({ label: i.root, detail: `${i.symbol} ${i.sector}`, group: 'instrument' as const })),
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

/** Candidates for the token at position `done.length`, given the complete tokens before it. */
function candidatesAt(done: readonly string[], index: CommandIndexData | null): Candidate[] {
  const [first, second] = done
  if (first === undefined) return [...MNEMONICS.map(functionCandidate), ...contextCandidates(index)]
  const leading = findMnemonic(first)
  if (done.length === 1) return leading ? argumentsFor(leading) : functionsAfter(first, index)
  if (done.length === 2 && !leading && second !== undefined) return argumentsFor(findMnemonic(second))
  return []
}

function rank(candidates: readonly Candidate[], prefix: string): Candidate[] {
  const q = prefix.toLowerCase()
  const starts = candidates.filter((c) => c.label.toLowerCase().startsWith(q))
  if (q.length < 2) return starts
  const loose = candidates.filter((c) => !starts.includes(c) && fuzzy(c.label.toLowerCase(), q))
  return [...starts, ...loose]
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
  for (const c of rank(candidatesAt(done, index), prefix)) {
    const value = `${before}${c.label}${c.group === 'argument' ? '' : ' '}`
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: c.label, detail: c.detail, group: c.group })
    if (out.length === MAX_SUGGESTIONS) break
  }
  return out
}
