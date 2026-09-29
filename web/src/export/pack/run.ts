// The evidence pack (roadmap 15 part 2): the dossier of the focused panel, its charts as images and the print
// palette laid out as one HTML file, saved to the viewer's downloads folder. It reads what the panel already
// holds (the registered dossier closure, the canvases on screen, the cached health answer the caller passes
// in): no request of any kind, nothing recomputed. Lazy code: the Workspace's export menu reaches it through
// a dynamic import, so neither this file nor its copy is part of the first load.
import { saveText } from '../../chrome/download'
import { postMessage, type MessageTone } from '../../chrome/MessageLine.store'
import { DOSSIER } from '../../copy/dossier'
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import type { HealthLite } from '../grab/run'
import { prepareExport } from '../prepare'
import { readPackPalette, renderPackHtml } from './packHtml'

export interface PackRequest {
  readonly panelId: string
  /** The cached health answer, or null when there is none (the pack then has no server clock). */
  readonly health: HealthLite | null
  readonly now?: Date
}

const HTML_TYPE = 'text/html;charset=utf-8'

function say(text: string, tone: MessageTone = 'info'): false {
  postMessage(text, tone)
  return false
}

function reason(error: unknown): string {
  // A browser message often ends in a full stop of its own; the copy adds one.
  const text = error instanceof Error ? error.message.trim().replace(/\.+$/, '') : ''
  return text || GRAB.detail.unknown
}

/** `YYYYMMDD-HHMMSS` in UTC, as GRAB's file names carry it. */
function stamp(now: Date): string {
  return Number.isNaN(now.getTime()) ? '00000000-000000' : now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/** The saved message for `charts` figures: one and none have their own words, so it never says "1 charts". */
function savedText(file: string, charts: number): string {
  if (charts === 0) return fillCopy(DOSSIER.packSavedNone, { file })
  return charts === 1 ? fillCopy(DOSSIER.packSavedOne, { file }) : fillCopy(DOSSIER.packSaved, { file, n: charts })
}

/** The done message with a note for each chart left out. */
function withNote(done: string, skipped: number): string {
  if (skipped === 0) return done
  return `${done} ${skipped === 1 ? GRAB.skippedOne : fillCopy(GRAB.skipped, { n: skipped })}`
}

/**
 * Saves the panel's evidence pack as `<stem>_pack_<YYYYMMDD-HHMMSS>Z.html`. Says what happened on the message
 * line and resolves true only when the file was saved. Never rejects.
 */
export async function packPanel(req: PackRequest): Promise<boolean> {
  try {
    const now = req.now ?? new Date()
    const job = prepareExport({ panelId: req.panelId, health: req.health, now })
    if ('message' in job) return say(job.message)
    const html = renderPackHtml(job.dossier, job.figures, readPackPalette(getComputedStyle(document.documentElement)))
    const file = `${job.fileStem}_pack_${stamp(now)}Z.html`
    if (!saveText(file, html, HTML_TYPE)) return say(GRAB.unavailable, 'error')
    postMessage(withNote(savedText(file, job.figures.length), job.skipped))
    return true
  } catch (error) {
    return say(fillCopy(DOSSIER.failed, { detail: reason(error) }), 'error')
  }
}
