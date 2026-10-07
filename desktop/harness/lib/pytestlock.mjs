// The wait on a backend pytest session (0.3.1 part 2). A backend pytest session holds D:\dev\locks\PYTEST.<pid>.lock while
// it runs (backend/tests/conftest.py); a real-data harness run must not overlap it, so run.mjs waits for the lock first, with
// the rule of desktop/scripts/check.ps1 (Get-PytestLocks): a lock is stale when it was last written two hours ago or more,
// and at once when the process named in its file name is not running (a session killed without its cleanup).
import fs from 'node:fs'
import path from 'node:path'

export const PYTEST_LOCK_STALE_MS = 2 * 60 * 60 * 1000
export const DEFAULT_LOCK_DIR = 'D:/dev/locks'
const LOCK_NAME = /^PYTEST\.(\d+)\.lock$/
const HOURS = PYTEST_LOCK_STALE_MS / 3600_000
const DEFAULT_POLL_MS = 30_000
const DEFAULT_TIMEOUT_MS = PYTEST_LOCK_STALE_MS

/** The locks folder: NQT_LOCK_DIR when set (the lock tests), else D:\dev\locks, as in check.ps1. */
export const lockDirFromEnv = (env = process.env) => env.NQT_LOCK_DIR || DEFAULT_LOCK_DIR

/** True when a process with this pid is running (signal 0 only looks; access denied still means it exists). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * The PYTEST.<pid>.lock files of `dir`: `fresh` hold the way, `stale` (each with the reason it is ignored) do not.
 * `now` and `isAlive` are injected in tests.
 */
export function pytestLocks(dir, { now = Date.now(), isAlive = pidAlive } = {}) {
  const fresh = []
  const stale = []
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    // A missing folder holds nothing; any other failure is reported by the caller instead of passing silently. The report
    // warns and does not abort, because pytest also skips its lock when it cannot write one (backend/tests/conftest.py);
    // the same rule is in desktop/scripts/check.ps1 (Get-PytestLocks).
    return error?.code === 'ENOENT' ? { fresh, stale } : { fresh, stale, unreadable: `${error?.code ?? 'error'} ${error?.message ?? ''}`.trim() }
  }
  for (const name of names.sort()) {
    const match = LOCK_NAME.exec(name)
    if (match === null) continue
    let mtimeMs
    try { mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs } catch { continue } // removed between the listing and the stat
    const pid = Number(match[1])
    if (now - mtimeMs >= PYTEST_LOCK_STALE_MS) {
      stale.push({ name, pid, why: `last written ${new Date(mtimeMs).toISOString()}, older than ${HOURS} h` })
    } else if (!isAlive(pid)) {
      stale.push({ name, pid, why: `process ${pid} is not running` })
    } else {
      fresh.push({ name, pid })
    }
  }
  return { fresh, stale }
}

/** Runs that start the real backend against the lab: the --real-data flag, and a first launch that is not dry. */
export const usesRealData = (args) => args.flag('real-data') || (args.flag('first-launch') && !args.flag('dry'))

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls while a fresh PYTEST lock exists, saying so on every look; resolves with what it saw once the way is clear, and
 * rejects with the lock named after `timeoutMs`. `log` and `sleep` are injected in tests.
 */
export async function waitNoPytestLock({ dir = lockDirFromEnv(), step = 'real-data run', pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, log = console.log, sleep = defaultSleep, isAlive = pidAlive } = {}) {
  const started = Date.now()
  const ignored = []
  let names = []
  let noteGiven = false
  for (;;) {
    const { fresh, stale, unreadable } = pytestLocks(dir, { isAlive })
    if (unreadable !== undefined && !noteGiven) {
      noteGiven = true
      log(`NOTE  pytest-lock  cannot read the locks folder ${dir} (${unreadable}); the ${step} does not wait`)
    }
    for (const lock of stale) {
      if (ignored.some((seen) => seen.name === lock.name)) continue
      ignored.push(lock)
      log(`NOTE  pytest-lock  ignoring stale lock ${lock.name} (${lock.why})`)
    }
    if (fresh.length === 0) break
    names = fresh.map((lock) => lock.name)
    if (Date.now() - started >= timeoutMs) throw new Error(`PYTEST lock still held after ${Math.round(timeoutMs / 1000)} s (${names.join(', ')}); the ${step} was not started`)
    log(`WAIT  ${step}  a backend pytest session holds ${names.join(', ')} in ${dir}; next look in ${Math.round(pollMs / 1000)} s`)
    await sleep(pollMs)
  }
  const waited = names.length > 0
  const waitedMs = Date.now() - started
  if (waited) log(`PASS  pytest-wait  waited ${Math.round(waitedMs / 1000)} s for ${names.join(', ')}`)
  return { waited, waitedMs, names, ignored }
}
