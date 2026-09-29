// The print dossier (roadmap 15 part 3): the dossier of the focused panel, its charts as images, printed on
// A4 landscape through the browser's own print dialog (Save as PDF keeps a copy). It reads what the panel
// already holds (the registered dossier closure, the canvases on screen, the cached health answer the caller
// passes in): no request of any kind, nothing recomputed, no library. The dossier is drawn by PrintDossier
// into a hidden #nqt-print-root on the body with a React root of its own, so the terminal's screen is never
// touched; print.css (imported here, so it loads with this chunk) shows only that root in print media. The
// runner waits for two animation frames, the images and the fonts, opens the dialog, and removes the root
// when printing ends (afterprint) or, for a browser that never says so, at the next print. Lazy code: only
// the dynamic import in the Workspace's export menu reaches it.
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { postMessage, type MessageTone } from '../../chrome/MessageLine.store'
import { DOSSIER } from '../../copy/dossier'
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import type { HealthLite } from '../grab/run'
import { prepareExport, type ExportJob } from '../prepare'
import { PrintDossier } from './PrintDossier'
import './print.css'

/** The id of the hidden element the dossier is drawn into; print.css shows it in print media. */
export const ROOT_ID = 'nqt-print-root'

/** The longest the runner waits for the frames, images and fonts before it prints anyway. */
const WAIT_CAP_MS = 5000

export interface PrintRequest {
  readonly panelId: string
  /** The cached health answer, or null when there is none (the dossier then has no server clock). */
  readonly health: HealthLite | null
  readonly now?: Date
}

/** A dossier on the page: its element, its React root, how to stop listening for afterprint, and the title to give back. */
interface Mounted {
  readonly host: HTMLElement
  readonly root: Root
  readonly title: string
  stop: () => void
}

/** The dossier now on the page, or null. One at a time: a new print takes the old one down first. */
let mounted: Mounted | null = null

function say(text: string, tone: MessageTone = 'info'): false {
  postMessage(text, tone)
  return false
}

function reason(error: unknown): string {
  // A browser message often ends in a full stop of its own; the copy adds one.
  const text = error instanceof Error ? error.message.trim().replace(/\.+$/, '') : ''
  return text || GRAB.detail.unknown
}

/** The done message with a note for each chart left out, as GRAB and the pack word it. */
function withNote(done: string, skipped: number): string {
  if (skipped === 0) return done
  return `${done} ${skipped === 1 ? GRAB.skippedOne : fillCopy(GRAB.skipped, { n: skipped })}`
}

/** Takes the dossier off the page: stops listening, unmounts the React root and removes the element. */
function take(entry: Mounted): void {
  entry.stop()
  entry.root.unmount()
  entry.host.remove()
  if (mounted === entry) mounted = null
}

/** Ends a print: the dossier goes and the document gets its title back. */
function finish(entry: Mounted): void {
  const wasCurrent = mounted === entry
  take(entry)
  if (wasCurrent) document.title = entry.title
}

/**
 * Draws the job on the page, taking down any dossier already there (this module's own, or one left by an
 * earlier copy of it). The element is hidden and shown by print.css alone (the chunk's stylesheet loads with it):
 * not by the hidden attribute, which the app's Tailwind base hides with an important rule that print.css could
 * not override. The document is named for the panel while the dialog is open, so Save as PDF suggests that
 * name; the title it had is kept for finish() and carried over from a dossier taken down.
 */
function mount(job: ExportJob): Mounted {
  const title = mounted?.title ?? document.title
  if (mounted !== null) take(mounted)
  for (const stale of document.querySelectorAll(`#${ROOT_ID}`)) stale.remove()
  const host = document.createElement('div')
  host.id = ROOT_ID
  document.body.append(host)
  const root = createRoot(host)
  const entry: Mounted = { host, root, title, stop: () => undefined }
  mounted = entry
  // Committed now, not at some later tick, so the images exist by the time the runner waits on them.
  flushSync(() => root.render(<PrintDossier dossier={job.dossier} figures={job.figures} />))
  if (job.fileStem !== '') document.title = job.fileStem
  return entry
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** `make()` as a promise that never rejects: a browser without the feature, or a refusal, is simply not waited on. */
function attempt(make: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(make()).catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
}

/** Two animation frames (the page has laid the dossier out), then every image decoded and the fonts ready. */
async function ready(host: HTMLElement): Promise<void> {
  await nextFrame()
  await nextFrame()
  const fonts = (document as { fonts?: { ready?: unknown } }).fonts
  await Promise.all([
    ...[...host.querySelectorAll('img')].map((img) => attempt(() => (typeof img.decode === 'function' ? img.decode() : undefined))),
    attempt(() => fonts?.ready),
  ])
}

/** `ready(host)`, but never for longer than the cap: a hidden tab or a stuck font must not leave the click with no answer. */
function readyOrCapped(host: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, WAIT_CAP_MS)
    void ready(host).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Prints the panel's dossier. Says what happened on the message line and resolves true only when the print
 * dialog was opened; a newer call while this one waits takes over (this one then resolves false, prints
 * nothing and says nothing). Never rejects.
 */
export async function printPanel(req: PrintRequest): Promise<boolean> {
  let entry: Mounted | null = null
  try {
    if (typeof window.print !== 'function') return say(DOSSIER.printUnavailable, 'error')
    const job = prepareExport({ panelId: req.panelId, health: req.health, now: req.now ?? new Date() })
    if ('message' in job) return say(job.message)
    const current = mount(job)
    entry = current
    await readyOrCapped(current.host)
    if (mounted !== current) return false
    const onAfterPrint = (): void => finish(current)
    window.addEventListener('afterprint', onAfterPrint, { once: true })
    current.stop = () => window.removeEventListener('afterprint', onAfterPrint)
    // Said before the dialog opens: in some browsers print() does not return until the dialog is closed.
    postMessage(withNote(fillCopy(DOSSIER.printOpened, { name: job.dossier.title }), job.skipped))
    window.print()
    return true
  } catch (error) {
    if (entry !== null && mounted === entry) finish(entry)
    return say(fillCopy(DOSSIER.failed, { detail: reason(error) }), 'error')
  }
}
