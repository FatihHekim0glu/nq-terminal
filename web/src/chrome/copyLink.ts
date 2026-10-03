// Copy link and Copy link as Markdown, the two rows a panel adds to its Options menu: the address of this
// page with `#go=<the panel's command line>`, so pasting it reproduces the view (deepLink.ts reads it
// back). This file writes links and deepLink.ts reads them; the link syntax is shared through LINK_KEY.
// Loaded with the Workspace only (Workspace.tsx is the one importer), not with the first paint, so the
// builders and the copy (LINK_COPY) stay out of the shell.
import { apiGet } from '../api/client'
import { bridgeClipboard } from '../bridge'
import { LINK_COPY, PORTABLE_LINK_COPY } from '../copy/linkCopy'
import { fillCopy } from '../copy/workspace'
import { LINK_KEY } from './deepLink'
import type { MenuEntry } from './FunctionBar.menu'
import { postMessage } from './MessageLine.store'

// HELP's explanation of the portable form lives with the copy above; it reaches HELP through here.
export { PORTABLE_LINK_COPY }

export type LinkFormat = 'url' | 'markdown'

const PREFIX = `${LINK_KEY}=`

/** `#go=<line>&go=<line>`, each line percent-encoded. */
export function hashFor(lines: readonly string[]): string {
  return `#${lines.map((line) => PREFIX + encodeURIComponent(line)).join('&')}`
}

/** The address of this page with one line as its link; never the current search or hash. */
export function linkFor(where: Pick<Location, 'origin' | 'pathname'>, line: string): string {
  return where.origin + where.pathname + hashFor([line])
}

export function markdownLink(line: string, url: string): string {
  return `[${line}](${url})`
}

/** The portable form of a link: the bare `#go=<line>`, which names no origin and so works wherever it is pasted. */
export function portableLink(line: string): string {
  return hashFor([line])
}

/**
 * True only when /api/health says the backend holds the fixed browser port (`port_fixed`, 03 section 4.6): then
 * an address is still valid at the next visit. Any failure or any other answer reads as not fixed, because the
 * bare string works anywhere and an address to a random port does not.
 */
export async function readPortFixed(): Promise<boolean> {
  try {
    const health = await apiGet('/api/health')
    return health?.port_fixed === true
  } catch {
    return false
  }
}

/**
 * Puts the link for `line` on the clipboard and says so on the message line: the full address where the port is
 * fixed, else the bare `#go=` string (and the message says it is one). When the browser has no clipboard or
 * refuses it (no permission, no focus), the message shows the link itself to copy by hand.
 */
export async function copyPanelLink(
  line: string,
  format: LinkFormat,
  where: Pick<Location, 'origin' | 'pathname'> = globalThis.location,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = bridgeClipboard(),
  portFixed: () => Promise<boolean> = readPortFixed,
): Promise<void> {
  const fixed = await portFixed()
  const url = fixed ? linkFor(where, line) : portableLink(line)
  const refused = () => postMessage(fillCopy(LINK_COPY.copyFailed, { url }), 'error')
  if (!clipboard) return refused()
  try {
    await clipboard.writeText(format === 'markdown' ? markdownLink(line, url) : url)
  } catch {
    return refused()
  }
  postMessage(fillCopy(fixed ? LINK_COPY.copied : PORTABLE_LINK_COPY.copied, { line }))
}

/** The Options rows for a panel whose command line is `line` (its title, for example "NQ GP 1d"). */
export function copyLinkEntries(line: string): MenuEntry[] {
  return [
    { label: LINK_COPY.copyLink, onSelect: () => void copyPanelLink(line, 'url') },
    { label: LINK_COPY.copyMarkdown, onSelect: () => void copyPanelLink(line, 'markdown') },
  ]
}
