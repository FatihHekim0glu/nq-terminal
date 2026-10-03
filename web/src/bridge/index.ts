// The bridge: the one small interface through which the page saves a file or writes the clipboard (03
// section 4.5, roadmap D3.2). Its implementation is the browser's own behaviour in every shell: the desktop
// shell turns the download link of `saveFile` into a native save dialog from its side (it intercepts the
// download), and the Clipboard API serves the copies. So there is one implementation (browser.ts), told
// which shell it is in by detect.ts, and a page that runs in a plain browser behaves as it always did.
//
// The page reaches it through getBridge(); chrome/download.ts is the one caller of saveFile, so every file
// the page saves goes through it. scripts/noShellIpc.test.ts keeps object URLs and clipboard calls out of the
// rest of web/src.
import { browserBridge } from './browser'
import { readInjectedShell, type ShellInfo, type ShellKeys, type ShellPlatform } from './detect'

export type SaveOutcome = 'saved' | 'cancelled' | 'failed'

/**
 * The outcome of a save, and whether it started. `started` is known at once, within the click that asked
 * for the save (a callable that must say so before it returns reads it); the promise says how it ended.
 */
export type SaveResult = Promise<SaveOutcome> & { readonly started: boolean }

/** What the shell states about itself (bridgeVersion is 0 in a browser), and the calls the page may make. */
export interface ShellBridge extends ShellInfo {
  /** Saves `data` as a file called `name`. The save is begun before this returns. */
  saveFile(name: string, data: Blob): SaveResult
  /** Puts text on the clipboard: false where there is no clipboard or it refuses. Never rejects. */
  copyText(text: string): Promise<boolean>
  /**
   * Puts a png on the clipboard, given as a blob or as a promise of one: the write starts before this returns,
   * so the browser still counts the click (Safari refuses a write made after an await). False where the
   * clipboard takes no image; rejects with the error of the platform when the write is refused, so the caller
   * can say why.
   */
  copyImage(png: Blob | Promise<Blob>): Promise<boolean>
  /** Whether the clipboard here takes an image at all. */
  canCopyImage(): boolean
}

let current: ShellBridge | null = null

/** The bridge for this page, made on first use from what the shell injected. */
export function getBridge(): ShellBridge {
  current ??= browserBridge(readInjectedShell())
  return current
}

/** Installs `bridge` as the page's bridge, or with null forgets it so the next getBridge reads the shell again. */
export function installBridge(bridge: ShellBridge | null): void {
  current = bridge
}

/**
 * The bridge's text copy shaped as a clipboard, for code that takes a clipboard as a parameter (the Copy link
 * rows): writeText rejects where the bridge could not copy, as the browser's own clipboard does when it refuses.
 */
export function bridgeClipboard(): Pick<Clipboard, 'writeText'> {
  return {
    async writeText(text: string): Promise<void> {
      if (!(await getBridge().copyText(text))) throw new Error('The clipboard did not take the text.')
    },
  }
}

export type { ShellInfo, ShellKeys, ShellPlatform }
