// A Playwright run builds the app into a folder of its own under node_modules/.tmp, named for its web port
// (playwright.config.ts, playwright.offline.config.ts). Each run on a different port left its folder behind, so
// the system drive collected about 9 MB per run (release check of wave W1B: nineteen folders, 165 MB).
// Born failing: a run that leaves its build folder, a teardown that removes anything outside
// node_modules/.tmp/e2e-*, and a config that does not register the teardown.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import config from '../playwright.config.ts'
import { CLEAN_DIRS_ENV, isRunFolder, removeRunFolders } from './e2eTeardown.ts'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'nqt-teardown-'))
  roots.push(root)
  return root
}

function makeFolder(root: string, ...parts: string[]): string {
  const dir = path.join(root, ...parts)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html>')
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('isRunFolder', () => {
  it('accepts only an e2e-* folder directly under node_modules/.tmp', () => {
    expect(isRunFolder(path.join('x', 'web', 'node_modules', '.tmp', 'e2e-gallery-4273'))).toBe(true)
    expect(isRunFolder(path.join('x', 'web', 'node_modules', '.tmp', 'e2e-demo-4374'))).toBe(true)
    expect(isRunFolder(path.join('x', 'web', 'node_modules', '.tmp', 'merge-build'))).toBe(false)
    expect(isRunFolder(path.join('x', 'web', 'dist'))).toBe(false)
    expect(isRunFolder(path.join('x', 'web', 'node_modules', '.tmp', 'e2e-gallery-4273', 'assets'))).toBe(false)
    expect(isRunFolder(path.join('x', 'web', '.tmp', 'e2e-gallery-4273'))).toBe(false)
  })
})

describe('removeRunFolders', () => {
  it('removes the run folders it is given', () => {
    const root = makeRoot()
    const gallery = makeFolder(root, 'node_modules', '.tmp', 'e2e-gallery-4273')
    const demo = makeFolder(root, 'node_modules', '.tmp', 'e2e-demo-4374')
    expect(removeRunFolders([gallery, demo])).toEqual([gallery, demo])
    expect(existsSync(gallery)).toBe(false)
    expect(existsSync(demo)).toBe(false)
  })

  it('refuses a folder that is not a run folder and leaves it alone', () => {
    const root = makeRoot()
    const dist = makeFolder(root, 'dist')
    const other = makeFolder(root, 'node_modules', '.tmp', 'merge-build')
    expect(removeRunFolders([dist, other])).toEqual([])
    expect(existsSync(dist)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })

  it('does not fail on a folder that is already gone', () => {
    const root = makeRoot()
    const gone = path.join(root, 'node_modules', '.tmp', 'e2e-gallery-4273')
    expect(removeRunFolders([gone])).toEqual([gone])
  })
})

describe('the configs register the teardown', () => {
  it('playwright.config.ts names the teardown and lists the folder it builds into', () => {
    expect(String(config.globalTeardown)).toMatch(/e2eTeardown\.ts$/)
    const listed = JSON.parse(process.env[CLEAN_DIRS_ENV] ?? '[]') as string[]
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer]
    const command = servers.find((s) => s?.name === 'vite preview')?.command ?? ''
    const built = [...command.matchAll(/--outDir\s+"([^"]+)"/g)].map((m) => m[1] as string)
    expect(listed.length).toBeGreaterThan(0)
    for (const dir of built) expect(listed).toContain(dir)
    for (const dir of listed) expect(isRunFolder(dir), dir).toBe(true)
  })

  it('playwright.offline.config.ts names the teardown and lists both folders it builds into', () => {
    const text = readFileSync(path.join(WEB, 'playwright.offline.config.ts'), 'utf8')
    expect(text).toMatch(/globalTeardown:\s*['"][^'"]*e2eTeardown\.ts['"]/)
    expect(text).toMatch(/process\.env\[CLEAN_DIRS_ENV\]\s*=\s*JSON\.stringify\(\[OFFLINE_DIST, DEMO_DIST\]\)/)
  })
})
