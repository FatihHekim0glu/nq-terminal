// A Playwright run leaves its backend's state folder (node_modules/.tmp/e2e-state-<port>) behind: the backend holds its
// lock until it stops, which is after the global teardown, so the teardown could not remove it. The run now marks the
// folder with a random run id when it starts the backend, and the teardown removes the folder only when the marker is
// its own, so a folder of another run (another port, possibly live) is never touched. When the lock still holds the
// folder at teardown, a detached cleaner retries until the backend has gone.
// Born failing: a run that leaves its folder, and a teardown that removes a folder it did not mark.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import config from '../../playwright.config.ts'
import {
  MARKER_FILE,
  RUN_ID_ENV,
  STATE_OWNER_ENV,
  decideRemoval,
  newRunId,
  ownerFromEnv,
  readMarker,
  removeOwnState,
  removeOwnStateWhenFree,
  writeMarker,
} from './e2eState.ts'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'nqt-e2e-state-'))
  roots.push(root)
  return root
}

/** A state folder as a run leaves it: the backend's lock and cache inside, under node_modules/.tmp/e2e-state-<port>. */
function makeState(root: string, port: number): string {
  const dir = path.join(root, 'node_modules', '.tmp', `e2e-state-${port}`)
  mkdirSync(path.join(dir, 'cache'), { recursive: true })
  writeFileSync(path.join(dir, 'backend.lock'), '{}')
  writeFileSync(path.join(dir, 'cache', 'entry.json'), '{}')
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('newRunId', () => {
  it('is random per call and fit for a file body', () => {
    const [a, b] = [newRunId(), newRunId()]
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{32,}$/)
  })
})

describe('decideRemoval', () => {
  const base = { folder: path.join('x', 'node_modules', '.tmp', 'e2e-state-4273'), runId: 'run-a', folderExists: true, marker: 'run-a' }

  it('removes a run folder whose marker is the run id', () => {
    expect(decideRemoval(base)).toBe('remove')
  })

  it('tolerates a trailing newline in the marker', () => {
    expect(decideRemoval({ ...base, marker: 'run-a\n' })).toBe('remove')
  })

  it('leaves a folder with another run id, with no marker, or with an empty marker', () => {
    expect(decideRemoval({ ...base, marker: 'run-b' })).toBe('foreign')
    expect(decideRemoval({ ...base, marker: null })).toBe('no-marker')
    expect(decideRemoval({ ...base, marker: '' })).toBe('no-marker')
  })

  it('never matches when the run has no id of its own', () => {
    expect(decideRemoval({ ...base, runId: '', marker: '' })).toBe('no-run-id')
    expect(decideRemoval({ ...base, runId: '', marker: 'run-a' })).toBe('no-run-id')
  })

  it('reports a missing folder, and refuses a path that is not a run folder before reading anything', () => {
    expect(decideRemoval({ ...base, folderExists: false, marker: null })).toBe('missing')
    expect(decideRemoval({ ...base, folder: path.join('x', 'web', 'dist') })).toBe('not-run-folder')
    expect(decideRemoval({ ...base, folder: path.join('x', 'node_modules', '.tmp', 'merge-build') })).toBe('not-run-folder')
  })
})

describe('writeMarker and readMarker', () => {
  it('writes the run id into the folder and reads it back', () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-a')
    expect(readFileSync(path.join(state, MARKER_FILE), 'utf8')).toBe('run-a')
    expect(readMarker(state)).toBe('run-a')
  })

  it('creates a folder that is not there yet, and reads a missing marker as null', () => {
    const root = makeRoot()
    const state = path.join(root, 'node_modules', '.tmp', 'e2e-state-4280')
    expect(readMarker(state)).toBeNull()
    writeMarker(state, 'run-a')
    expect(existsSync(state)).toBe(true)
  })

  it('refuses to mark a folder that is not a run folder', () => {
    const dist = path.join(makeRoot(), 'dist')
    mkdirSync(dist)
    expect(() => writeMarker(dist, 'run-a')).toThrow(/not a run folder/)
    expect(existsSync(path.join(dist, MARKER_FILE))).toBe(false)
  })
})

describe('removeOwnState', () => {
  it('removes the folder this run marked, also when the run failed', () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-a')
    expect(removeOwnState(state, 'run-a')).toBe('removed')
    expect(existsSync(state)).toBe(false)
  })

  it('leaves the folder of another port, which another run marked', () => {
    const root = makeRoot()
    const mine = makeState(root, 4273)
    const other = makeState(root, 4373)
    writeMarker(mine, 'run-a')
    writeMarker(other, 'run-b')
    expect(removeOwnState(mine, 'run-a')).toBe('removed')
    expect(existsSync(other)).toBe(true)
    expect(existsSync(path.join(other, 'backend.lock'))).toBe(true)
    // Even pointed at that folder by mistake, this run's id does not match its marker.
    expect(removeOwnState(other, 'run-a')).toBe('left')
    expect(existsSync(path.join(other, 'cache', 'entry.json'))).toBe(true)
  })

  it('leaves a folder with no marker or another marker', () => {
    const root = makeRoot()
    const unmarked = makeState(root, 4273)
    const foreign = makeState(root, 4274)
    writeMarker(foreign, 'run-b')
    expect(removeOwnState(unmarked, 'run-a')).toBe('left')
    expect(removeOwnState(foreign, 'run-a')).toBe('left')
    expect(existsSync(path.join(unmarked, 'backend.lock'))).toBe(true)
    expect(existsSync(path.join(foreign, 'backend.lock'))).toBe(true)
    expect(readMarker(foreign)).toBe('run-b')
  })

  it('is no error when the folder is already gone', () => {
    const gone = path.join(makeRoot(), 'node_modules', '.tmp', 'e2e-state-4273')
    expect(removeOwnState(gone, 'run-a')).toBe('missing')
  })

  it('refuses a folder that is not a run folder and leaves it alone', () => {
    const dist = path.join(makeRoot(), 'dist')
    mkdirSync(dist)
    writeFileSync(path.join(dist, MARKER_FILE), 'run-a')
    expect(removeOwnState(dist, 'run-a')).toBe('left')
    expect(existsSync(dist)).toBe(true)
  })

  it('keeps the marker while the lock holds the folder, so a later pass still knows the folder is its own', () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-a')
    const locked = (target: string): void => {
      if (path.basename(target) === 'backend.lock') throw new Error('EBUSY: resource busy or locked')
      rmSync(target, { recursive: true, force: true })
    }
    expect(removeOwnState(state, 'run-a', locked)).toBe('busy')
    expect(existsSync(path.join(state, 'backend.lock'))).toBe(true)
    expect(readMarker(state)).toBe('run-a')
    expect(existsSync(path.join(state, 'cache'))).toBe(false)
    // The backend stops and releases the lock: the next pass removes the rest.
    expect(removeOwnState(state, 'run-a')).toBe('removed')
    expect(existsSync(state)).toBe(false)
  })
})

describe('removeOwnStateWhenFree', () => {
  it('retries while the folder is busy and ends when it is removed', async () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-a')
    let calls = 0
    const flaky = (target: string): void => {
      calls += 1
      if (calls <= 4) throw new Error('EBUSY')
      rmSync(target, { recursive: true, force: true })
    }
    await expect(removeOwnStateWhenFree(state, 'run-a', { timeoutMs: 5_000, pauseMs: 1, remove: flaky })).resolves.toBe('removed')
    expect(existsSync(state)).toBe(false)
  })

  it('gives up with busy when the lock is never released', async () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-a')
    const stuck = (): void => {
      throw new Error('EBUSY')
    }
    await expect(removeOwnStateWhenFree(state, 'run-a', { timeoutMs: 30, pauseMs: 5, remove: stuck })).resolves.toBe('busy')
    expect(readMarker(state)).toBe('run-a')
  })

  it('does not wait on a folder it does not own', async () => {
    const state = makeState(makeRoot(), 4273)
    writeMarker(state, 'run-b')
    const started = Date.now()
    await expect(removeOwnStateWhenFree(state, 'run-a', { timeoutMs: 5_000, pauseMs: 1_000 })).resolves.toBe('left')
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('ownerFromEnv', () => {
  it('reads the folder and run id the config recorded', () => {
    const owner = { folder: path.join('x', 'node_modules', '.tmp', 'e2e-state-4273'), runId: 'run-a' }
    expect(ownerFromEnv({ [STATE_OWNER_ENV]: JSON.stringify(owner) })).toEqual(owner)
  })

  it('is null when nothing, or something malformed, was recorded', () => {
    expect(ownerFromEnv({})).toBeNull()
    expect(ownerFromEnv({ [STATE_OWNER_ENV]: '' })).toBeNull()
    expect(ownerFromEnv({ [STATE_OWNER_ENV]: 'not json' })).toBeNull()
    expect(ownerFromEnv({ [STATE_OWNER_ENV]: JSON.stringify({ folder: 'x' }) })).toBeNull()
    expect(ownerFromEnv({ [STATE_OWNER_ENV]: JSON.stringify({ folder: 'x', runId: '' }) })).toBeNull()
  })
})

describe('playwright.config.ts', () => {
  const servers = (Array.isArray(config.webServer) ? config.webServer : [config.webServer]) as { name?: string; command?: string }[]
  const backend = servers.find((s) => /uvicorn/.test(s.command ?? ''))

  it('records the state folder and a run id for the teardown', () => {
    const owner = ownerFromEnv(process.env)
    expect(owner).not.toBeNull()
    expect(path.basename(owner?.folder ?? '')).toMatch(/^e2e-state-\d+$/)
    expect(process.env[RUN_ID_ENV]).toBe(owner?.runId)
  })

  it('marks the state folder with that run id after emptying it and before the backend starts', () => {
    const owner = ownerFromEnv(process.env)
    const command = backend?.command ?? ''
    const fresh = command.indexOf('--fresh')
    const mark = command.search(/e2eState\.ts"\s+mark\s/)
    const start = command.indexOf('uvicorn')
    expect(fresh).toBeGreaterThan(-1)
    expect(mark).toBeGreaterThan(fresh)
    expect(start).toBeGreaterThan(mark)
    expect(command).toContain(`"${owner?.folder}" "${owner?.runId}"`)
  })

  it('runs the state teardown beside the build-folder teardown, which stays last', () => {
    const teardowns = Array.isArray(config.globalTeardown) ? config.globalTeardown : [config.globalTeardown]
    expect(teardowns.map(String).some((t) => /e2eState\.teardown\.ts$/.test(t))).toBe(true)
    expect(String(teardowns[teardowns.length - 1])).toMatch(/e2eTeardown\.ts$/)
  })
})
