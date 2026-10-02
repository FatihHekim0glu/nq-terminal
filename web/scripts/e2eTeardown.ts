// Global teardown of the Playwright runs: removes the folders the run built the app into.
// The configs list them in NQT_E2E_CLEAN_DIRS (a JSON array of absolute paths) while they load, and the
// runner reads that again here. Only an e2e-* folder directly under node_modules/.tmp is ever removed.
import { rmSync } from 'node:fs'
import path from 'node:path'

export const CLEAN_DIRS_ENV = 'NQT_E2E_CLEAN_DIRS'

/** Whether a path is one run's own build folder: node_modules/.tmp/e2e-<name>. */
export function isRunFolder(dir: string): boolean {
  const parent = path.dirname(dir)
  return (
    path.basename(dir).startsWith('e2e-') &&
    path.basename(parent) === '.tmp' &&
    path.basename(path.dirname(parent)) === 'node_modules'
  )
}

/** Removes each run folder in the list and returns the ones it removed; anything else is refused and left alone. */
export function removeRunFolders(dirs: readonly string[]): string[] {
  const removed: string[] = []
  for (const dir of dirs) {
    if (!isRunFolder(dir)) {
      console.warn(`e2e teardown: refusing to remove ${dir}, which is not a run folder`)
      continue
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      removed.push(dir)
    } catch (error) {
      console.warn(`e2e teardown: could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return removed
}

function listedFolders(): string[] {
  const raw = process.env[CLEAN_DIRS_ENV]
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

export default function globalTeardown(): void {
  removeRunFolders(listedFolders())
}
