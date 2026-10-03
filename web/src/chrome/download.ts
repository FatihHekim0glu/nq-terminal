// Saves what the page holds as a file in the viewer's downloads folder: text (98) Export on REG and OOS)
// or a blob (GRAB's chart image). Both go through the bridge (src/bridge), the one place that makes the local
// object URL and its download link, so every save of the page is routed here and a shell can answer it with
// a native save dialog. No request leaves the page. Both return the bridge's SaveResult: `started` says at
// once whether the save began, and the promise says how it ended (saved, cancelled or failed). A caller that
// says "Saved" waits for that outcome (sayWhenSaved), so a cancelled dialog or a failed write is never
// reported as a save.
import { getBridge, type SaveOutcome, type SaveResult } from '../bridge'
import { EXPORT } from '../copy/panelParts'
import { postMessage } from './MessageLine.store'

const CSV_TYPE = 'text/csv;charset=utf-8'

export function saveBlob(fileName: string, blob: Blob): SaveResult {
  return getBridge().saveFile(fileName, blob)
}

export function saveText(fileName: string, text: string, type: string = CSV_TYPE): SaveResult {
  return saveBlob(fileName, new Blob([text], { type }))
}

/** How a started save ended; a promise that rejects counts as a failure, so this never rejects. */
export async function settleSave(result: SaveResult): Promise<SaveOutcome> {
  try {
    return await result
  } catch {
    return 'failed'
  }
}

export interface SaveWords {
  /** Posted when the save ended saved. */
  readonly saved: string
  /** Posted, as an error and before any wait, when the save did not start (no way to save here). */
  readonly unavailable: string
}

/**
 * Says how `result` went on the message line and resolves true only when the file was saved. A save that did
 * not start posts `unavailable` at once; a cancelled save posts the cancelled line, a failed one the failure
 * as an error, and neither ever posts `saved`. Never rejects.
 */
export async function sayWhenSaved(result: SaveResult, words: SaveWords): Promise<boolean> {
  if (!result.started) {
    postMessage(words.unavailable, 'error')
    return false
  }
  const outcome = await settleSave(result)
  if (outcome === 'saved') postMessage(words.saved)
  else if (outcome === 'cancelled') postMessage(EXPORT.cancelled)
  else postMessage(EXPORT.failed, 'error')
  return outcome === 'saved'
}
