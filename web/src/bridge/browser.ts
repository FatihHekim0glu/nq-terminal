// The bridge as the browser does it: a download link over a local object URL for a file, the Clipboard API
// for text and images. Nothing leaves the page and no request is made. Every platform global is read at the
// moment of the call, never captured, so a browser that lacks one (no object URLs, no clipboard, no
// ClipboardItem) is met by a false or a failed outcome, never by an error the caller must catch.
//
// How a save ends. A browser cannot say whether the user kept the file, so a click that started a download is
// reported as saved. A shell of bridgeVersion 2 or more can: its download handler turns the link into a native
// save dialog and a checked write, and tells the page how that ended by one `nqt:save-outcome` event on the window
// (`detail: { uri, outcome }`, the object URL of the link and saved, cancelled or failed). The shell calls the page;
// the page calls no shell command. A save in such a shell waits for the event of its own object URL, so a cancelled
// dialog or a refused path is never reported as a save (chrome/download.ts sayWhenSaved).
import type { ShellInfo } from './detect'
import type { SaveOutcome, SaveResult, ShellBridge } from './index'

const PNG = 'image/png'

/** The first bridgeVersion whose shell reports how each save ended. */
export const SAVE_OUTCOMES_FROM = 2
export const SAVE_OUTCOME_EVENT = 'nqt:save-outcome'
/** The shell answers as fast as the user answers its dialog; past this the page stops waiting and says it failed. */
export const SAVE_WAIT_MS = 300_000

interface Waiting {
  readonly outcome: Promise<SaveOutcome>
  cancel(): void
}

const isOutcome = (value: unknown): value is SaveOutcome => value === 'saved' || value === 'cancelled' || value === 'failed'

/** Listens, from now on, for the shell's word on the save of the object URL `url`. */
function awaitShell(url: string): Waiting {
  let cancel = (): void => undefined
  const outcome = new Promise<SaveOutcome>((resolve) => {
    const finish = (value: SaveOutcome): void => {
      clearTimeout(timer)
      window.removeEventListener(SAVE_OUTCOME_EVENT, listen)
      resolve(value)
    }
    const listen = (event: Event): void => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (typeof detail !== 'object' || detail === null) return
      const { uri, outcome: said } = detail as { uri?: unknown; outcome?: unknown }
      if (uri === url && isOutcome(said)) finish(said)
    }
    const timer = setTimeout(() => finish('failed'), SAVE_WAIT_MS)
    window.addEventListener(SAVE_OUTCOME_EVENT, listen)
    cancel = () => finish('failed')
  })
  return { outcome, cancel: () => cancel() }
}

/**
 * Clicks a download link over an object URL for `blob` and returns that URL; null where the browser has none or
 * refuses one. `before` runs with the URL just before the click, so a listener is in place when the shell answers.
 */
function clickDownloadLink(fileName: string, blob: Blob, before: (url: string) => void): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  let url: string
  try {
    url = URL.createObjectURL(blob)
  } catch {
    return null
  }
  try {
    before(url)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    link.click()
    return url
  } finally {
    URL.revokeObjectURL(url)
  }
}

function saveFile(info: ShellInfo, fileName: string, blob: Blob): SaveResult {
  const held: { waiting: Waiting | null } = { waiting: null }
  let url: string | null
  try {
    url = clickDownloadLink(fileName, blob, (made) => {
      if (info.bridgeVersion >= SAVE_OUTCOMES_FROM) held.waiting = awaitShell(made)
    })
  } catch (error) {
    held.waiting?.cancel()
    throw error
  }
  if (url === null) return Object.assign(Promise.resolve<SaveOutcome>('failed'), { started: false })
  if (held.waiting === null) return Object.assign(Promise.resolve<SaveOutcome>('saved'), { started: true })
  return Object.assign(held.waiting.outcome, { started: true })
}

async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/** Async so that an item constructor that throws becomes a refusal, like a write the browser rejects. */
async function copyImage(png: Blob | Promise<Blob>): Promise<boolean> {
  if (!canCopyImage()) return false
  await navigator.clipboard.write([new ClipboardItem({ [PNG]: png })])
  return true
}

/** The bridge for a page in the shell `info` describes (a browser, or the desktop shell). */
export function browserBridge(info: ShellInfo): ShellBridge {
  return {
    bridgeVersion: info.bridgeVersion,
    platform: info.platform,
    keys: info.keys,
    saveFile: (fileName, blob) => saveFile(info, fileName, blob),
    copyText,
    copyImage,
    canCopyImage,
  }
}
