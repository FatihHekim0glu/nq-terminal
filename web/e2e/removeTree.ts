// Removes a temporary folder a fixture backend used, for the specs that start their own. On Windows the folder can stay
// locked for a moment after the backend's process tree is killed (the scanner or the closing handles), and Node's own
// maxRetries path of fs.rmSync gave up on that moment in about two runs of three, so this retries the whole removal
// itself until the folder is gone or the time is up, and then throws the last error.
import fs from 'node:fs'

/** The longest the removal keeps trying. */
const REMOVE_TIMEOUT_MS = 20_000
/** The pause between two tries. */
const RETRY_PAUSE_MS = 100

export async function removeTree(folder: string, timeoutMs: number = REMOVE_TIMEOUT_MS): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      fs.rmSync(folder, { recursive: true, force: true })
      return
    } catch (error) {
      if (Date.now() >= end) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_PAUSE_MS))
    }
  }
}
