// One test file at a time on the stand-in ports 8798 and 8799 (the build plan's port table). Vitest runs test files in
// parallel workers, and two files that start real backends on the same port would fight over it, so each takes this
// guard before it binds anything and gives it back when it is done. The guard is a folder created atomically in the
// system temp folder (mkdir fails when it exists); one left behind by a run that died is taken over after STALE_MS.
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GUARD = join(tmpdir(), 'nqt-start-test-ports.lock')
const POLL_MS = 250
const STALE_MS = 15 * 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stale(): boolean {
  try {
    return Date.now() - statSync(GUARD).mtimeMs > STALE_MS
  } catch {
    return false
  }
}

/** Waits for the ports, then returns the function that gives them back. Waits at most `waitMs` (default 20 minutes). */
export async function takePorts(waitMs = 20 * 60_000): Promise<() => void> {
  const end = Date.now() + waitMs
  for (;;) {
    try {
      mkdirSync(GUARD)
      return () => rmSync(GUARD, { recursive: true, force: true })
    } catch {
      if (stale()) rmSync(GUARD, { recursive: true, force: true })
      else if (Date.now() >= end) throw new Error(`the stand-in ports stayed taken for ${waitMs} ms (${GUARD})`)
      else await sleep(POLL_MS)
    }
  }
}
