// A link pasted into the command line: the bare `#go=...` string Copy link gives outside the fixed browser door, the
// full address, or a Markdown link. Read by the address bar's own reader (linesFromHash) and judged by its own verdict
// (linkVerdict), so the limits are one set. Loaded on demand by the command line when a pasted line is link shaped,
// so it stays out of the first-paint shell (the address bar's reader, deepLink.ts, is in it).
import type { CommandIndexData } from '../commands/types'
import { LINKS_PASTED } from '../copy/linksPasted'
import { requestLine } from './CommandLine.bus'
import type { CommandLineParts } from './CommandLine.state'
import { LINK_KEY, linesFromHash, linkVerdict, whenWorkspaceReady, type LinkLine } from './deepLink'

const PREFIX = `${LINK_KEY}=`

const MARKDOWN_LINK = /^\[[^\]]*\]\(([^()\s]+)\)$/
const KEY_ANY_CASE = /(^#?|&)go=/gi
const WEB_ADDRESS = /^https?:\/\//i

/**
 * What a pasted text is, as a link. Null when it is not shaped like one (it starts with neither `#` nor `go=`,
 * and is no web address with a fragment): the command line then reads it as typed. An empty list when it is link
 * shaped and the reader refuses it, exactly as for the address bar. A web address or a Markdown link is read by
 * its fragment, so a link copied on the fixed browser door opens the same view in the app. Total: never throws.
 */
export function pastedLinkLines(text: string): readonly LinkLine[] | null {
  const trimmed = text.trim()
  const target = MARKDOWN_LINK.exec(trimmed)?.[1] ?? trimmed
  const bare = target.startsWith('#') || target.slice(0, PREFIX.length).toLowerCase() === PREFIX
  if (!bare && !(WEB_ADDRESS.test(target) && target.includes('#'))) return null
  const hash = bare ? target : target.slice(target.indexOf('#'))
  // The command box shows upper case, so a pasted link arrives as `#GO=`: the key is read in either case here.
  return linesFromHash(hash.replace(KEY_ANY_CASE, (_all, lead: string) => lead + PREFIX)) ?? []
}

/** What the command line makes of a pasted text (see pastedLinkLines and linkVerdict). */
export type PastedLink =
  | { readonly kind: 'none' }
  | { readonly kind: 'refuse'; readonly message: string }
  | { readonly kind: 'run'; readonly lines: readonly LinkLine[] }

/**
 * A pasted text as the command line sees it: not a link (`none`, parse it as typed), a link to refuse with the words
 * to say (the address bar's own refusals), or the lines to run. A link that waits for the commands index is refused
 * too: the text stays in the box, so it can be sent again once the index has loaded.
 */
export function readPastedLink(text: string, index: CommandIndexData | null): PastedLink {
  const lines = pastedLinkLines(text)
  if (lines === null) return { kind: 'none' }
  if (lines.length === 0) return { kind: 'refuse', message: LINKS_PASTED.refused }
  const outcome = linkVerdict(lines, index)
  return outcome.kind === 'run' ? { kind: 'run', lines } : { kind: 'refuse', message: outcome.message }
}

/**
 * Runs a pasted link for the command line: a refusal is handed to `refuse` (the line's own error path, which
 * keeps the text in the box), a link runs its lines in order as typed lines once the workspace is ready. When the text is
 * not a link it calls `typed`, so the caller reads it as typed. Here, not in the line's dispatch, so the shell does not carry it.
 */
export async function runPastedLink(
  p: CommandLineParts,
  text: string,
  newPanel: boolean,
  refuse: (p: CommandLineParts, text: string, message: string) => void,
  typed: () => void,
): Promise<void> {
  const pasted = readPastedLink(text, p.options.index)
  if (pasted.kind === 'none') return typed()
  if (pasted.kind === 'refuse') return refuse(p, text, pasted.message)
  p.s.edit('')
  await whenWorkspaceReady()
  for (const { line, newPanel: later } of pasted.lines) requestLine(line, later || newPanel)
}
