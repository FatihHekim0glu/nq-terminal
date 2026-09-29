// The <GO> preview row (roadmap #6 slice 2): a line under the sheet that says what Enter (and
// Shift+Enter) would do with the line as typed, without running it. usePreviewText asks the caller's
// previewRun for both texts through the same grammar runText uses; CommandLine.tsx renders the result
// as an aria-hidden row (never while a menu is open) and PreviewAnnouncer, mounted whenever the caller
// offers previewRun, tells a screen reader once the line has stopped changing, so arrow-key browsing
// of the sheet is not read out keystroke by keystroke.
import { useEffect, useState } from 'react'
import { parseLine } from '../commands/line'
import { LAYOUT_SEPARATOR } from '../copy/layout'
import type { CommandLineParts } from './CommandLine.state'

const ANNOUNCE_DELAY_MS = 600

function fallbackOf(p: CommandLineParts) {
  return p.options.resolveFallback ? p.options.resolveFallback() : p.options.fallbackContext
}

/**
 * What the typed line would do: previewRun(command, newPanel) alone for a line already opening in a
 * new panel (NXTW, Shift+Enter has no separate line form); otherwise that text plus, after
 * LAYOUT_SEPARATOR (the same string as LAYOUT.separator), the new-panel form too. Null when the line is not a runnable command, or the
 * caller has nothing to say about it.
 */
export function usePreviewText(p: CommandLineParts): string | null {
  const { previewRun } = p.options
  if (!previewRun) return null
  const result = parseLine(p.s.line, { index: p.options.index, fallbackContext: fallbackOf(p) })
  if (!result.ok || result.action.kind !== 'run') return null
  const { command, newPanel } = result.action
  const primary = previewRun(command, newPanel)
  if (primary === null) return null
  if (newPanel) return primary
  const shift = previewRun(command, true)
  return shift === null ? primary : `${primary}${LAYOUT_SEPARATOR}${shift}`
}

export interface PreviewAnnouncerProps {
  readonly text: string | null
}

/** A status region, mounted whenever the caller offers previewRun, that copies `text` once it has
 * stopped changing for 600 ms, so a screen reader is not read the preview on every keystroke. */
export function PreviewAnnouncer({ text }: PreviewAnnouncerProps) {
  const [announced, setAnnounced] = useState(text)
  useEffect(() => {
    const id = window.setTimeout(() => setAnnounced(text), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [text])
  return (
    <span role="status" className="sr-only">
      {announced}
    </span>
  )
}
