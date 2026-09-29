// GRAB (roadmap 15): the focused panel's charts as one image with their labels, saved as a file or copied
// to the clipboard. It copies the canvases the charts already drew and reads what the page already knows
// (the panel title, the screen's registered provenance, the cached health answer the caller passes in):
// no request of any kind, nothing recomputed. Lazy code: the Workspace handle reaches it through a
// dynamic import, so neither this file nor its copy is part of the first load.
import { saveBlob } from '../../chrome/download'
import { panelElement } from '../../chrome/KeyToolbar.panels'
import { postMessage, type MessageTone } from '../../chrome/MessageLine.store'
import { panelSource } from '../../chrome/panelSources'
import { isDemoPage } from '../../copy/chrome'
import { GRAB } from '../../copy/grab'
import { PANEL, fillCopy } from '../../copy/workspace'
import { collectFigures } from './collect'
import { composeGrab, readGrabPalette } from './compose'
import { grabCaption, grabFileName, type GrabFacts } from './grabModel'

/** The parts of the /api/health answer GRAB reads: the server clock and whether the data is fixture data. */
export interface HealthLite {
  readonly now_utc: string | null
  readonly fixture_mode: boolean
}

export interface GrabRequest {
  readonly panelId: string
  /** The panel's mnemonic, for example `EQ`. */
  readonly code: string
  /** The panel number (1 for the first panel), or null when it has none. */
  readonly number: number | null
  readonly group: string
  /** The cached health answer, or null when there is none (the caption then has no as of time). */
  readonly health: HealthLite | null
  readonly target: 'file' | 'clipboard'
  readonly now?: Date
}

const PNG = 'image/png'

function say(text: string, tone: MessageTone = 'info'): false {
  postMessage(text, tone)
  return false
}

function fail(detail: string): false {
  return say(fillCopy(GRAB.failed, { detail }), 'error')
}

function reason(error: unknown): string {
  // A browser message often ends in a full stop of its own; the copy adds one.
  const text = error instanceof Error ? error.message.trim().replace(/\.+$/, '') : ''
  return text || GRAB.detail.unknown
}

function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

function panelLabel(req: GrabRequest): string {
  return req.number !== null && req.number > 0 && req.code ? fillCopy(PANEL.number, { n: req.number, code: req.code }) : req.code
}

function factsFor(req: GrabRequest, title: string, now: Date): GrabFacts {
  return {
    panelLabel: panelLabel(req),
    title,
    group: req.group,
    demo: isDemoPage(),
    fixture: req.health?.fixture_mode === true,
    provenance: panelSource(req.panelId)?.provenance ?? null,
    asOfUtc: req.health?.now_utc ?? null,
    now,
  }
}

/** The done message with a note for each figure left out. */
function withNotes(done: string, skipped: number, trimmed: boolean): string {
  const skippedNote = skipped === 0 ? null : skipped === 1 ? GRAB.skippedOne : fillCopy(GRAB.skipped, { n: skipped })
  return [done, skippedNote, trimmed ? GRAB.trimmed : null].filter((part) => part !== null).join(' ')
}

function toPng(canvas: { toBlob(callback: BlobCallback, type?: string): void }): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(resolve, PNG)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Asks the clipboard to take the png now, with a promise of the image: called before anything is awaited, so
 * the browser still counts the user's click (Safari refuses a write made after the gesture). Async so that a
 * constructor that throws becomes a refusal, like a write the browser rejects.
 */
async function copyToClipboard(png: Promise<Blob | null>): Promise<void> {
  const image = png.then((blob) => blob ?? Promise.reject(new Error(GRAB.detail.noImage)))
  // Its outcome is read through `png` and the write; this keeps it from being reported as unhandled.
  image.catch(() => undefined)
  return navigator.clipboard.write([new ClipboardItem({ [PNG]: image })])
}

/**
 * Grabs the panel: its chart figures, each with its summary, and a caption with the panel, provenance,
 * fence, source and times. Says what happened on the message line and resolves true only when the
 * image was saved or copied. Never rejects.
 */
export async function grabPanel(req: GrabRequest): Promise<boolean> {
  const panel = panelElement(req.panelId)
  if (!panel) return say(GRAB.noPanel)
  const { figures, skipped } = collectFigures(panel)
  if (figures.length === 0) return say(GRAB.noFigures)
  if (req.target === 'clipboard' && !canCopyImage()) return say(GRAB.clipboardUnavailable)
  try {
    const now = req.now ?? new Date()
    const title = panel.getAttribute('data-nqt-title') ?? ''
    const caption = grabCaption(factsFor(req, title, now))
    const composed = composeGrab(figures, caption, readGrabPalette(), globalThis.devicePixelRatio || 1)
    if (!composed) return fail(GRAB.detail.noSurface)
    const png = toPng(composed.canvas)
    const written = req.target === 'clipboard' ? copyToClipboard(png) : null
    // Settled below; an early return (no image data) must not leave it unhandled.
    written?.catch(() => undefined)
    const blob = await png
    if (!blob) return fail(GRAB.detail.noImage)
    const trimmed = composed.kept < figures.length
    const many = composed.kept > 1
    if (written) {
      try {
        await written
      } catch (error) {
        // The image was made: the browser declined the clipboard (no focus, no permission).
        return say(fillCopy(GRAB.clipboardRefused, { detail: reason(error) }), 'error')
      }
      const done = many ? fillCopy(GRAB.copied, { n: composed.kept }) : GRAB.copiedOne
      postMessage(withNotes(done, skipped, trimmed))
      return true
    }
    const file = grabFileName(title || req.code, now)
    if (!saveBlob(file, blob)) return say(GRAB.unavailable, 'error')
    const done = many ? fillCopy(GRAB.saved, { n: composed.kept, file }) : fillCopy(GRAB.savedOne, { file })
    postMessage(withNotes(done, skipped, trimmed))
    return true
  } catch (error) {
    return fail(reason(error))
  }
}
