// The Playwright run's backend state folder (node_modules/.tmp/e2e-state-<port>, playwright.config.ts) and who owns it.
// The fixture backend holds its lock in that folder until it stops, which happens after the global teardown, so the
// build-folder teardown (scripts/e2eTeardown.ts) cannot remove it and every run used to leave one behind.
// The run therefore marks the folder with a random run id when it starts the backend (`mark`, in the backend's
// web-server command), and the teardown removes the folder only when the marker is its own run id: a folder of
// another run (another port, possibly live) carries another id and is never touched. When the lock still holds the
// folder at teardown, a detached `clean` process retries until the backend has stopped.
// Usage as a script: node e2eState.ts mark <folder> <run id> | node e2eState.ts clean <folder> <run id>
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isRunFolder } from '../../scripts/e2eTeardown.ts'

/** The marker file the run writes into its state folder; its body is the run id. */
export const MARKER_FILE = '.e2e-run-id'
/** The run id, set while the config loads. */
export const RUN_ID_ENV = 'NQT_E2E_RUN_ID'
/** The folder and run id the teardown acts on (a JSON object), set while the config loads. */
export const STATE_OWNER_ENV = 'NQT_E2E_STATE_OWNER'

/** The longest the detached cleaner waits for the backend to release its lock, and its pause between two tries. */
const CLEAN_TIMEOUT_MS = 120_000
const CLEAN_PAUSE_MS = 500

export type Decision = 'remove' | 'missing' | 'not-run-folder' | 'no-run-id' | 'no-marker' | 'foreign'
export type Outcome = 'removed' | 'missing' | 'left' | 'busy'

export interface StateOwner {
  readonly folder: string
  readonly runId: string
}

/** Removes one path; it throws while the path is held (the backend's lock). */
export type Remover = (target: string) => void

const rmTree: Remover = (target) => {
  rmSync(target, { recursive: true, force: true })
}

export function newRunId(): string {
  return randomUUID()
}

/** Whether a state folder is this run's to remove. Pure: the folder, the run id, whether it exists and what its marker holds. */
export function decideRemoval(input: { folder: string; runId: string; folderExists: boolean; marker: string | null }): Decision {
  if (!isRunFolder(input.folder)) return 'not-run-folder'
  if (!input.folderExists) return 'missing'
  if (input.runId === '') return 'no-run-id'
  const marker = input.marker?.trim() ?? ''
  if (marker === '') return 'no-marker'
  return marker === input.runId ? 'remove' : 'foreign'
}

/** The run id in the folder's marker, or null when there is no marker. */
export function readMarker(folder: string): string | null {
  try {
    return readFileSync(path.join(folder, MARKER_FILE), 'utf8')
  } catch {
    return null
  }
}

/** Marks a run folder (creating it) with the run id. */
export function writeMarker(folder: string, runId: string): void {
  if (!isRunFolder(folder)) throw new Error(`e2eState: ${folder} is not a run folder (node_modules/.tmp/e2e-<name>)`)
  if (runId === '') throw new Error('e2eState: the run id is empty')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, MARKER_FILE), runId)
}

/**
 * Removes the folder when its marker is this run's id. Everything but the marker goes first, and the marker last, so a
 * folder that a held lock keeps in place still carries its marker for the next pass ('busy'). Never throws.
 */
export function removeOwnState(folder: string, runId: string, remove: Remover = rmTree): Outcome {
  const folderExists = existsSync(folder)
  const decision = decideRemoval({ folder, runId, folderExists, marker: folderExists ? readMarker(folder) : null })
  if (decision === 'missing') return 'missing'
  if (decision !== 'remove') return 'left'
  let busy = false
  try {
    for (const name of readdirSync(folder)) {
      if (name === MARKER_FILE) continue
      try {
        remove(path.join(folder, name))
      } catch {
        busy = true // keep going: whatever is not held is still removed
      }
    }
    if (busy) return 'busy'
    remove(path.join(folder, MARKER_FILE))
    remove(folder)
    return 'removed'
  } catch {
    return 'busy'
  }
}

export interface WaitOptions {
  readonly timeoutMs?: number
  readonly pauseMs?: number
  readonly remove?: Remover
}

/** Retries removeOwnState while the folder is busy; a folder that is not this run's, or is gone, ends it at once. */
export async function removeOwnStateWhenFree(folder: string, runId: string, options: WaitOptions = {}): Promise<Outcome> {
  const end = Date.now() + (options.timeoutMs ?? CLEAN_TIMEOUT_MS)
  const pause = options.pauseMs ?? CLEAN_PAUSE_MS
  for (;;) {
    const outcome = removeOwnState(folder, runId, options.remove)
    if (outcome !== 'busy' || Date.now() >= end) return outcome
    await new Promise<void>((resolve) => setTimeout(resolve, pause))
  }
}

/** The folder and run id the config recorded in the environment, or null when they are missing or malformed. */
export function ownerFromEnv(env: NodeJS.ProcessEnv): StateOwner | null {
  const raw = env[STATE_OWNER_ENV]
  if (raw === undefined || raw === '') return null
  try {
    const parsed = JSON.parse(raw) as Partial<StateOwner> | null
    if (typeof parsed?.folder !== 'string' || typeof parsed.runId !== 'string' || parsed.runId === '') return null
    return { folder: parsed.folder, runId: parsed.runId }
  } catch {
    return null
  }
}

/** This file, for the config's `mark` command and the teardown's detached `clean`. */
export const SCRIPT_PATH = fileURLToPath(import.meta.url)

async function main(argv: readonly string[]): Promise<number> {
  const [command, folder, runId] = argv
  if ((command !== 'mark' && command !== 'clean') || folder === undefined || runId === undefined) {
    process.stderr.write('usage: node e2eState.ts mark|clean <folder> <run id>\n')
    return 2
  }
  const target = path.resolve(folder)
  if (command === 'mark') {
    writeMarker(target, runId)
    return 0
  }
  await removeOwnStateWhenFree(target, runId)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
