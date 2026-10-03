// Terminal links: `#go=<line>(&go=<line>)*` in the address bar replays command lines through the
// command line, so a copied link reproduces a view. The fragment never leaves the browser (the server
// is not sent it), and it is untrusted input:
//   - linesFromHash reads it by hand: at most MAX_LINK_LINES lines of at most MAX_LINE characters,
//     each in the command alphabet (letters, digits, underscore, dot, hyphen, space); anything else
//     refuses the whole link;
//   - LINK_ACTIONS is the allowlist of what a line may do once parsed (see useDeepLinks): a link opens
//     screens, contexts and help, and can never reset, undo, export, grab or save anything.
// A link can also be pasted into the command line (deepLink.paste.ts, loaded on demand): it goes through the same
// reader and the same verdict as the address bar (linkVerdict), so the limits are one set.
// This file also holds the workspace-ready signal: a link waits for the workspace before it runs. It is
// the reading half only, and part of the first-paint shell; the writing half (building a link for the
// Copy link rows) sits in copyLink.ts, which loads with the Workspace.
import { parseLine, type LineResult } from '../commands/line'
import { describeError } from '../commands/messages'
import { MAX_LINE } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import { LINKS } from '../copy/links'
import { fillCopy } from '../copy/workspace'

export const LINK_KEY = 'go'
export const MAX_LINK_LINES = 8
/** The line kinds a link may run. Everything else (RESET, UNDO, WATCH, GRAB, digits, HL, ...) is refused. */
export const LINK_ACTIONS = ['run', 'context', 'help'] as const

export interface LinkLine {
  readonly line: string
  /** False for the first line (like Enter), true for the later ones (like Shift+Enter). */
  readonly newPanel: boolean
}

const PREFIX = `${LINK_KEY}=`
const ALPHABET = /^[A-Za-z0-9_. -]+$/

/** One decoded, trimmed line, or null when it is not a well formed link line. */
function decodeLine(raw: string): string | null {
  try {
    const text = decodeURIComponent(raw)
    return text.length <= MAX_LINE && ALPHABET.test(text) && text.trim() !== '' ? text.trim() : null
  } catch {
    return null
  }
}

/**
 * The lines of a `#go=` hash. Null when the hash is empty or has no `go=` part (not a link: leave it
 * alone). An empty list when it is a link the terminal refuses. Parsed by hand, not with URLSearchParams,
 * so that a plus sign stays a plus sign (and is then refused as outside the alphabet).
 */
export function linesFromHash(hash: string): readonly LinkLine[] | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = body.split('&')
  if (!parts.some((part) => part.startsWith(PREFIX))) return null
  if (parts.length > MAX_LINK_LINES) return []
  const lines: LinkLine[] = []
  for (const part of parts) {
    const line = part.startsWith(PREFIX) ? decodeLine(part.slice(PREFIX.length)) : null
    if (line === null) return []
    lines.push({ line, newPanel: lines.length > 0 })
  }
  return lines
}

/** What to do with a link: run it, refuse it for good, or hold it until the commands index has loaded. */
export type LinkVerdict =
  | { readonly kind: 'run' }
  | { readonly kind: 'refuse'; readonly message: string }
  | { readonly kind: 'wait'; readonly message: string }

/**
 * The lines in order. The first one that parses to something a link may not do, or that does not parse,
 * refuses the link. A line that cannot be parsed for want of the index is remembered, not refused: if
 * nothing else refuses the link, it waits. Shared by the address bar (useDeepLinks) and the command line.
 */
export function linkVerdict(lines: readonly LinkLine[], index: CommandIndexData | null): LinkVerdict {
  let unavailable: string | null = null
  for (const { line } of lines) {
    const result = parseLine(line, { index, fallbackContext: null })
    if (result.ok) {
      if (!isLinkAction(result)) return { kind: 'refuse', message: fillCopy(LINKS.refusedLine, { line }) }
    } else if (result.error.code !== 'index-unavailable') {
      return { kind: 'refuse', message: describeError(result.error) }
    } else {
      unavailable ??= describeError(result.error)
    }
  }
  return unavailable === null ? { kind: 'run' } : { kind: 'wait', message: unavailable }
}

/** True only for a line that parsed and whose action a link may run. */
export function isLinkAction(result: LineResult): boolean {
  return result.ok && LINK_ACTIONS.some((kind) => kind === result.action.kind)
}

// The workspace-ready signal. The Workspace loads as its own chunk and dockview needs a moment after it
// mounts; a command sent before that answers "still loading". Links wait here instead.
let ready = false
let waiting: Array<() => void> = []

export function markWorkspaceReady(): void {
  ready = true
  const release = waiting
  waiting = []
  for (const resolve of release) resolve()
}

/** The Workspace unmounted: the next link waits for the next one. */
export function markWorkspaceGone(): void {
  ready = false
}

export function whenWorkspaceReady(): Promise<void> {
  return ready ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))
}

/** Back to the start state (tests). */
export function resetWorkspaceReady(): void {
  ready = false
  waiting = []
}
