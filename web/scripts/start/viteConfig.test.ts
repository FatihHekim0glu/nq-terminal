// vite.config.ts for the browser door (03 section 2.6): session.html is a second build input, the dev proxy takes
// its target from the backend's lock, and the dev server's port can move for a launcher test. The build test runs
// a real production build into a folder of its own and looks at what it emitted.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { DEMO_MODE, GALLERY_MODE, buildInputs, devApiOrigin, devPortOf, stateDirOf } from '../../vite.config.ts'

const WEB = fileURLToPath(new URL('../..', import.meta.url))
const BACKSLASH = String.fromCharCode(92)
const slashes = (text: string): string => text.split(BACKSLASH).join('/')
const TOKEN = '11'.repeat(32)
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nqt-vite-'))
  scratch.push(dir)
  return dir
}

function lockIn(dir: string, port: number): void {
  writeFileSync(join(dir, 'backend.lock'), JSON.stringify({ v: 1, pid: 4242, port, token: TOKEN, root: 'C:\lab', started: 'now' }))
}

describe('the dev proxy target', () => {
  it('is the port the lock records, not a fixed 8765', () => {
    const dir = tmp()
    lockIn(dir, 8798)
    expect(devApiOrigin({ NQT_STATE_DIR: dir })).toBe('http://127.0.0.1:8798')
  })

  it('is 8765 when there is no lock, or the lock is unreadable', () => {
    const dir = tmp()
    expect(devApiOrigin({ NQT_STATE_DIR: dir })).toBe('http://127.0.0.1:8765')
    writeFileSync(join(dir, 'backend.lock'), 'not json')
    expect(devApiOrigin({ NQT_STATE_DIR: dir })).toBe('http://127.0.0.1:8765')
  })

  it('reads terminal/state when NQT_STATE_DIR is not set', () => {
    expect(slashes(stateDirOf({}))).toMatch(/\/terminal\/state$/)
  })
})

describe('the dev server port', () => {
  it('is 5173 unless NQT_DEV_PORT names another unprivileged port', () => {
    expect(devPortOf({})).toBe(5173)
    expect(devPortOf({ NQT_DEV_PORT: '8799' })).toBe(8799)
    for (const bad of ['', 'x', '80', '70000', '5173.5']) expect(devPortOf({ NQT_DEV_PORT: bad })).toBe(5173)
  })
})

describe('the build inputs', () => {
  it('are the app and the session page in production and in the gallery build', () => {
    for (const mode of ['production', GALLERY_MODE]) {
      const inputs = buildInputs(mode)
      expect(Object.keys(inputs ?? {}).sort()).toEqual(['index', 'session'])
      expect(slashes(inputs?.session ?? '')).toMatch(/\/web\/session\.html$/)
    }
  })

  it('leave the demo build alone: it has no backend and so no session', () => {
    expect(buildInputs(DEMO_MODE)).toBeUndefined()
  })
})

describe('a production build', () => {
  it('emits dist/session.html with a small script of its own that does not load the app shell', () => {
    const out = join(tmp(), 'dist')
    const run = spawnSync(process.execPath, [join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], {
      cwd: WEB,
      encoding: 'utf8',
      timeout: 170_000,
      windowsHide: true,
    })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(out, 'index.html'))).toBe(true)
    expect(existsSync(join(out, 'session.html'))).toBe(true)
    const html = readFileSync(join(out, 'session.html'), 'utf8')
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]!)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatch(/^\/assets\//) // root-absolute: the same wherever the folder sits
    const script = readFileSync(join(out, scripts[0]!.replace(/^\//, '')), 'utf8')
    expect(script.length).toBeLessThan(8_000)
    expect(script).not.toContain('react.transitional.element')
    expect(script).toContain('X-NQT-Code')
    expect(html).not.toMatch(/modulepreload/) // nothing else loads first
    expect(readdirSync(join(out, 'assets')).some((name) => name.startsWith('session'))).toBe(true)
  }, 180_000)
})
