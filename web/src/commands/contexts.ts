// Context resolution for the command line (UI_SPEC section 5): a token names an instrument
// (root or symbol, any case), the universe (27F), a hypothesis or confirmation, or a run id.
// Names from files match exactly first, then by a unique case-insensitive match.
import type { CommandIndexData, ContextKind, ResolvedContext } from './types'

function byName(token: string, names: readonly string[]): string | undefined {
  if (names.includes(token)) return token
  const lower = token.toLowerCase()
  const matches = names.filter((name) => name.toLowerCase() === lower)
  return matches.length === 1 ? matches[0] : undefined
}

function instrumentRoot(token: string, index: CommandIndexData): string | undefined {
  const upper = token.toUpperCase()
  return index.instruments.find((i) => i.root.toUpperCase() === upper || i.symbol.toUpperCase() === upper)?.root
}

function universe(token: string, index: CommandIndexData): string | undefined {
  const upper = token.toUpperCase()
  return index.universe.find((u) => u.toUpperCase() === upper)
}

/** Every kind the token can stand for, each at most once. Empty when nothing matches or no index. */
export function resolveContext(token: string, index: CommandIndexData | null): readonly ResolvedContext[] {
  if (!index || token === '') return []
  const found: Array<readonly [ContextKind, string | undefined]> = [
    ['universe', universe(token, index)],
    ['instrument', instrumentRoot(token, index)],
    ['hypothesis', byName(token, [...index.hypotheses, ...index.confirmations])],
    ['run', byName(token, index.runs)],
  ]
  return found.flatMap(([kind, value]) => (value === undefined ? [] : [{ kind, value }]))
}

/** The first candidate whose kind the function accepts, in the function's preference order. */
export function pickContext(
  candidates: readonly ResolvedContext[],
  accepts: readonly ContextKind[],
): ResolvedContext | undefined {
  for (const kind of accepts) {
    const hit = candidates.find((c) => c.kind === kind)
    if (hit) return hit
  }
  return undefined
}
