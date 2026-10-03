// The bridge as the browser does it: a download link over a local object URL for a file, the Clipboard API
// for text and images. Nothing leaves the page and no request is made. Every platform global is read at the
// moment of the call, never captured, so a browser that lacks one (no object URLs, no clipboard, no
// ClipboardItem) is met by a false or a failed outcome, never by an error the caller must catch.
import type { ShellInfo } from './detect'
import type { SaveOutcome, SaveResult, ShellBridge } from './index'

const PNG = 'image/png'

/** Clicks a download link over an object URL for `blob`; false where the browser has none or refuses one. */
function clickDownloadLink(fileName: string, blob: Blob): boolean {
  if (typeof URL.createObjectURL !== 'function') return false
  let url: string
  try {
    url = URL.createObjectURL(blob)
  } catch {
    return false
  }
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    link.click()
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}

function saveFile(fileName: string, blob: Blob): SaveResult {
  const started = clickDownloadLink(fileName, blob)
  const outcome: SaveOutcome = started ? 'saved' : 'failed'
  return Object.assign(Promise.resolve(outcome), { started })
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
    saveFile,
    copyText,
    copyImage,
    canCopyImage,
  }
}
