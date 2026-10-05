// The parent side of tailog.py: a 1 ms read-only tail of one backend.log that runs beside a launch and hands back the epoch times of
// NQT-READY, the identity proof and the first session read. The log may not exist when the tail starts.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnHidden } from './proc.mjs'
import { PY } from './paths.mjs'

export const TAILOG_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tailog.py')
const STOP_WAIT_MS = 8000

/** Parses the one JSON document of the tail; null when it is empty or not JSON. Pure. */
export function parseTail(text) {
  try { const doc = JSON.parse(String(text)); return doc && typeof doc === 'object' ? doc : null } catch { return null }
}

/** Starts the tail. `stop()` closes its stdin, waits for it to print its document and returns it (null when it never did). */
export function startTail(logPath, maxSeconds = 90, { python = PY } = {}) {
  const child = spawnHidden(python, ['-E', '-s', '-X', 'utf8', TAILOG_SCRIPT, logPath, String(maxSeconds)], { stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const exited = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve) })
  return {
    child,
    async stop() {
      try { child.stdin.end() } catch { /* already closed */ }
      await Promise.race([exited, new Promise((r) => setTimeout(r, STOP_WAIT_MS))])
      if (child.exitCode === null) child.kill()
      return parseTail(out)
    },
  }
}
