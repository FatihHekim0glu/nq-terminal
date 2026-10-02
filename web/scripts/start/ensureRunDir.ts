// Creates a run's own state folder before the fixture backend starts (playwright.config.ts runs this first in the
// backend's web-server command, because the backend refuses an NQT_STATE_DIR that does not exist). Only a run folder
// is ever created or emptied: node_modules/.tmp/e2e-<name>, the same rule the global teardown removes by.
// `--fresh` empties the folder first, so what the previous run left behind (its backend still held the lock when the
// teardown ran, so the folder could not be removed then) never reaches this run.
// Usage: node scripts/start/ensureRunDir.ts [--fresh] <folder> [<folder> ...]
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { isRunFolder } from '../e2eTeardown.ts'

const FRESH = '--fresh'
const arguments_ = process.argv.slice(2)
const fresh = arguments_.includes(FRESH)
let failed = false
for (const argument of arguments_.filter((a) => a !== FRESH)) {
  const folder = path.resolve(argument)
  if (!isRunFolder(folder)) {
    process.stderr.write(`ensureRunDir: refusing ${folder}, which is not a run folder (node_modules/.tmp/e2e-<name>)\n`)
    failed = true
    continue
  }
  if (fresh) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  mkdirSync(folder, { recursive: true })
}
process.exitCode = failed ? 1 : 0
