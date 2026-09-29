// Replays a terminal link (`#go=<line>&go=<line>`, see deepLink.ts) through the command line, as if the
// lines were typed: the first like Enter, later ones like Shift+Enter (a new panel). The link is read from
// the address bar on mount and on hashchange, and consumed with replaceState so a reload does not run it
// twice. The fragment is untrusted, so a link runs only when every one of its lines
//   - is well formed (linesFromHash), and
//   - parses (once the commands index has settled, with no focused-panel context to lean on), and
//   - is a link action: a screen, a context or help (LINK_ACTIONS).
// Otherwise the whole link is refused: nothing runs and the message line says why. Lines then wait for the
// workspace, which loads as its own chunk. Internal callers use requestLine directly; this is only the
// address bar's way in.
import { useCallback, useEffect, useRef } from 'react'
import { useCommands } from '../api/queries'
import { parseLine } from '../commands/line'
import { describeError } from '../commands/messages'
import type { CommandIndexData } from '../commands/types'
import { LINKS } from '../copy/links'
import { fillCopy } from '../copy/workspace'
import { requestLine } from './CommandLine.bus'
import { isLinkAction, linesFromHash, whenWorkspaceReady, type LinkLine } from './deepLink'
import { postMessage } from './MessageLine.store'

export interface DeepLinkEnv {
  readonly location: Pick<Location, 'hash' | 'pathname' | 'search'>
  readonly history: Pick<History, 'replaceState'>
  readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}

const browserEnv = (): DeepLinkEnv => ({ location: window.location, history: window.history, target: window })

/** What to do with a link: run it, refuse it for good, or hold it until the commands index has loaded. */
type Verdict =
  | { readonly kind: 'run' }
  | { readonly kind: 'refuse'; readonly message: string }
  | { readonly kind: 'wait'; readonly message: string }

/** A link that waits for the index, and whether the reader has been told so. */
interface Waiting {
  readonly lines: readonly LinkLine[]
  readonly told: boolean
}

/**
 * The lines in order. The first one that parses to something a link may not do, or that does not parse,
 * refuses the link. A line that cannot be parsed for want of the index is remembered, not refused: if
 * nothing else refuses the link, it waits.
 */
function verdict(lines: readonly LinkLine[], index: CommandIndexData | null): Verdict {
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

/**
 * Removes the fragment from the address bar without adding a history entry. A path that begins with
 * two slashes would be read as another host, so it is written with one. A browser that refuses the
 * rewrite leaves the address alone; the link still runs.
 */
function consume({ history, location }: DeepLinkEnv): void {
  try {
    history.replaceState(null, '', location.pathname.replace(/^\/+/, '/') + location.search)
  } catch {
    // The address keeps its fragment; nothing else depends on it going.
  }
}

/** `env` is read once, on mount (tests pass a fake address bar); it defaults to the window. */
export function useDeepLinks(env?: DeepLinkEnv): void {
  const commands = useCommands()
  const settled = commands.status !== 'pending'
  const index = commands.data ?? null
  const now = useRef({ index, settled })
  now.current = { index, settled }
  const mounted = useRef(false)
  // Links read from the address bar that wait for the index (or for a better one, after it failed to load).
  const waiting = useRef<readonly Waiting[]>([])
  const source = useRef(env)

  const drain = useCallback(() => {
    if (!now.current.settled) return
    const links = waiting.current
    const kept: Waiting[] = []
    for (const { lines, told } of links) {
      const outcome = verdict(lines, now.current.index)
      if (outcome.kind === 'refuse') {
        postMessage(outcome.message, 'error')
      } else if (outcome.kind === 'wait') {
        if (!told) postMessage(outcome.message, 'error')
        kept.push({ lines, told: true })
      } else {
        void whenWorkspaceReady().then(() => {
          if (mounted.current) for (const { line, newPanel } of lines) requestLine(line, newPanel)
        })
      }
    }
    waiting.current = kept
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const at = source.current ?? browserEnv()
    const take = () => {
      const lines = linesFromHash(at.location.hash)
      if (lines === null) return
      consume(at)
      if (lines.length === 0) postMessage(LINKS.refused, 'error')
      else waiting.current = [...waiting.current, { lines, told: false }]
      drain()
    }
    take()
    at.target.addEventListener('hashchange', take)
    return () => at.target.removeEventListener('hashchange', take)
  }, [drain])

  // A success after an error changes the index but not `settled`: it must drain the links that waited.
  useEffect(drain, [drain, settled, index])
}
