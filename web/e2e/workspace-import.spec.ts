// The one-time per-origin import of the ten localStorage keys into the workspace store (03 section 10.4, roadmap D3.3 and
// D3.4). A page whose origin is not yet in meta.imports and whose storage holds any of the ten keys merges them into
// six documents under the backend's state folder, and only then adds its origin to meta.imports. A page with empty
// storage adds nothing and never marks its origin.
//
//   1. Origin A, port 8798 (the stand-in for the owner's fixed 8765, never used here): the ten keys are seeded, the page
//      loads, all six documents appear in the fixture backend's own temporary state folder with the seeded values, and
//      meta.imports lists that origin. A reload of the same origin adds nothing.
//   2. Origin B, another port, empty storage: the page loads, adopts the stored look from the store, and changes nothing
//      in the state folder (every file byte for byte, no new file).
//   3. Born failing: with the store routes removed (an older backend, answered 404 by the page's own server) the same
//      checker finds nothing in the store, and the page falls back to its localStorage cache without an error line.
//
// Nothing here touches the live terminal: the backend is the fixture backend (backend/tests/fixture_app.py) with its own
// state folder; the page is the run's own build (the folder the preview of playwright.config.ts serves) behind a small
// same-origin server of this spec (page and /api on one origin, like the app); every spawn is hidden; the browser is
// headless. The session is bought the way the desktop shell buys it: the token from the backend's lock, GET /api/session
// with an origin, the cookie set in the context. The harness below is the same as in desktop-seams.spec.ts.
import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_CSP } from './backendCsp.ts'
import { removeTree } from './removeTree.ts'
import { LOOPBACK, readLock } from '../scripts/start/session.ts'

// ---------------------------------------------------------------- harness (restated in desktop-seams.spec.ts)

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.resolve(E2E_DIR, '..')
const TERMINAL_DIR = path.resolve(WEB_DIR, '..')
const PROJECT_DIR = path.resolve(TERMINAL_DIR, '..')
const BACKEND_TESTS = path.join(TERMINAL_DIR, 'backend', 'tests')
const FIXTURES = path.join(BACKEND_TESTS, 'fixtures')
const PYTHON = process.platform === 'win32'
  ? path.join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(PROJECT_DIR, '.venv', 'bin', 'python')
const REAL_BACKEND_PORT = 8765
const STAND_IN_PORT = 8798
// The paper-book settings of this machine are blanked: the fixture backend must not depend on the shell it ran in.
const MACHINE_SETTINGS = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C']
const PROOF_NONCE = '0'.repeat(64)
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

/** The folder of the run's own page build, which the preview of playwright.config.ts serves (named in NQT_E2E_SESSION). */
function pageBuildFolder(): string {
  const raw = process.env.NQT_E2E_SESSION
  if (raw === undefined || raw === '') throw new Error('NQT_E2E_SESSION is not set: run this spec through playwright.config.ts')
  const { storage, webOrigin } = JSON.parse(raw) as { storage: string; webOrigin: string }
  const folder = path.join(path.dirname(storage), `e2e-gallery-${new URL(webOrigin).port}`)
  if (!fs.existsSync(path.join(folder, 'index.html'))) throw new Error(`the page build is not in ${folder}`)
  return folder
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, LOOPBACK, () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Site {
  readonly origin: string
  close(): Promise<void>
}

/** The page build and /api on one origin, as the app serves them; /api goes to the backend with every header kept. */
async function startSite(dist: string, backendPort: number, port: number, storeRoutes = true): Promise<Site> {
  if (port === REAL_BACKEND_PORT) throw new Error('refusing port 8765')
  const pool = new http.Agent({ keepAlive: true })
  const forward = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const upstream = http.request({ host: LOOPBACK, port: backendPort, method: req.method, path: req.url, headers: req.headers, agent: pool }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  }
  const serveFile = (pathname: string, res: http.ServerResponse): void => {
    const wanted = path.normalize(path.join(dist, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)))
    if (!wanted.startsWith(dist + path.sep) || !fs.existsSync(wanted) || !fs.statSync(wanted).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(wanted)] ?? 'application/octet-stream',
      'content-security-policy': BACKEND_CSP,
      'cache-control': 'no-store',
    })
    fs.createReadStream(wanted).pipe(res)
  }
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', `http://${LOOPBACK}`)
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return serveFile(pathname, res)
    if (!storeRoutes && pathname.startsWith('/api/workspaces')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"detail":"Not Found"}')
      return
    }
    forward(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK, resolve)
  })
  return {
    origin: `http://${LOOPBACK}:${port}`,
    close: () => new Promise<void>((resolve) => {
      pool.destroy()
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

interface Backend {
  readonly port: number
  readonly stateDir: string
  stop(): Promise<void>
}

/** The fixture backend on a free port with `root`/state as its own state folder; `pagePort` is the origin it names. */
async function startBackend(root: string, pagePort: number): Promise<Backend> {
  const stateDir = path.join(root, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const logDir = fs.mkdtempSync(path.join(root, 'log-'))
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...Object.fromEntries(MACHINE_SETTINGS.map((name) => [name, ''])),
    NQT_STATE_DIR: stateDir, NQT_FIXTURE_DIR: FIXTURES, NQT_FIXTURE_JOBS: 'fake', NQT_FIXTURE_LOG_DIR: logDir,
    NQT_PORT: String(pagePort), PYTHONUTF8: '1',
  }
  const child: ChildProcess = spawn(PYTHON, ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', BACKEND_TESTS, '--host', LOOPBACK, '--port', String(port)],
    { cwd: path.join(TERMINAL_DIR, 'backend'), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let errors = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    errors = (errors + chunk.toString('utf8')).slice(-4000)
  })
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.pid === undefined) return
    const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    // This process is ours and its handle is still held, so its pid cannot belong to anyone else: the tree goes with it.
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else child.kill('SIGKILL')
    await Promise.race([gone, pause(10_000)])
  }
  const end = Date.now() + 90_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the fixture backend exited (${child.exitCode}): ${errors}`)
    if (Date.now() > end) {
      await stop()
      throw new Error(`the fixture backend did not answer in 90 s: ${errors}`)
    }
    try {
      if ((await fetch(`http://${LOOPBACK}:${port}/api/desktop/proof?nonce=${PROOF_NONCE}`)).status === 200) break
    } catch {
      // not listening yet
    }
    await pause(200)
  }
  return { port, stateDir, stop }
}

/** The session cookie the desktop shell would set: the token from the lock buys one bound to `origin`. */
async function shellCookie(backend: Backend, origin: string): Promise<{ name: string; value: string }> {
  const lock = readLock(backend.stateDir)
  if (lock === null) throw new Error('the backend holds no lock in its state folder')
  const answer = await fetch(`http://${LOOPBACK}:${backend.port}/api/session`, { headers: { authorization: `NQT ${lock.token}`, 'x-nqt-origin': origin } })
  const pair = (answer.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  const at = pair.indexOf('=')
  if (!answer.ok || at < 1) throw new Error(`the backend refused a session (HTTP ${answer.status})`)
  return { name: pair.slice(0, at), value: pair.slice(at + 1) }
}

/** A clean headless context at the project's viewport, with a session for `origin`. */
async function sessionContext(browser: Browser, backend: Backend, origin: string, extra: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London', ...extra,
  })
  // The gallery build leaves the workspace store off unless asked (src/main.tsx): these specs are the ones that test it.
  await context.addInitScript(() => {
    ;(window as unknown as { __NQT_STORE__?: boolean }).__NQT_STORE__ = true
  })
  const cookie = await shellCookie(backend, origin)
  await context.addCookies([{ ...cookie, domain: LOOPBACK, path: '/api', httpOnly: true, sameSite: 'Strict', secure: false }])
  return context
}

interface StoredDoc {
  readonly version: number
  readonly data: unknown
}

function readDoc(stateDir: string, doc: string): StoredDoc | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, 'workspaces', `${doc}.json`), 'utf8')) as StoredDoc
  } catch {
    return null
  }
}

/** Every file of the store's folder with its bytes, for an exact before and after. */
function storeFiles(stateDir: string): Record<string, string> {
  const folder = path.join(stateDir, 'workspaces')
  if (!fs.existsSync(folder)) return {}
  return Object.fromEntries(fs.readdirSync(folder).sort().map((name) => [name, fs.readFileSync(path.join(folder, name), 'utf8')]))
}

// ---------------------------------------------------------------- the ten keys, seeded

// `last` is null on purpose: the page opens the last workspace by itself at start (a LOAD of that name), which would
// replace HOME and write layouts, and this spec is about the import, not about that restore.
const RECIPE = { version: 1, panels: [{ line: 'NQ GP', group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
const LAYOUT = { seeded: true, grid: { width: 1, height: 1 } }
const CONTEXT = { kind: 'instrument', value: 'NQ' }
// HOME's own panel puts its hypothesis in group B as the page loads, whatever the store holds; seeding the same value keeps
// that write from looking like a change to the imported document.
const GROUP_B = { kind: 'hypothesis', value: 'volmanaged_v0' }
const SOURCES = ['registry', 'confirmations', 'openings', 'ledger', 'oos', 'runs']
// All six sources, so the record watch has nothing to add to the checkpoint on its first read (it extends a checkpoint
// that lacks a source, which would write the document without the viewer doing anything).
const WATCH = { version: 1, takenAt: 1_760_000_000_000, sources: Object.fromEntries(SOURCES.map((name) => [name, { count: 0, records: {} }])) }
const HISTORY = ['NQ GP', 'REG']
const MON = { view: 'normalised', heat: true, window: 126 }
const SEEDED_KEYS: Readonly<Record<string, string>> = {
  'nqt.workspaces': JSON.stringify({ version: 1, list: { SEEDED: RECIPE }, last: null }),
  'nqt.layouts': JSON.stringify({ version: 1, layouts: { ZZLAYOUT: LAYOUT } }),
  'nqt.linkGroups': JSON.stringify({ version: 1, contexts: { A: CONTEXT, B: GROUP_B, C: null } }),
  'nqt.watch': JSON.stringify(WATCH),
  'nqt.cmd.history': JSON.stringify(HISTORY),
  'nqt.tape': 'true',
  'nqt.cvd': 'deut',
  'nqt.theme': 'amber-classic',
  'nqt.orientation': '1',
  'nqt.mon.defaults': JSON.stringify(MON),
}
const EXPECTED_DOCS: Readonly<Record<string, unknown>> = {
  workspaces: { list: { SEEDED: RECIPE }, last: null },
  layouts: { ZZLAYOUT: LAYOUT },
  linkGroups: { contexts: { A: CONTEXT, B: GROUP_B, C: null } },
  watch: WATCH,
  history: HISTORY,
  prefs: { tape: true, cvd: 'deut', theme: 'amber-classic', orientation: '1', mon: MON },
}

/** Whether `actual` holds everything `expected` does: objects by subset, arrays and plain values exactly. */
function contains(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected)
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => contains(actual[i], item))
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const fields = actual as Record<string, unknown>
  return Object.entries(expected).every(([key, value]) => contains(fields[key], value))
}

/** What is wrong with the store after an import from `origin`: empty when all six documents hold the seeded values and meta lists the origin. */
function importProblems(stateDir: string, origin: string): string[] {
  const problems = Object.entries(EXPECTED_DOCS).flatMap(([doc, expected]) => {
    const stored = readDoc(stateDir, doc)
    if (stored === null) return [`${doc} is not in the store`]
    return contains(stored.data, expected) ? [] : [`${doc} does not hold the seeded value`]
  })
  const meta = readDoc(stateDir, 'meta')
  const imports = (meta?.data as { imports?: Array<{ origin: string }> } | undefined)?.imports ?? []
  if (JSON.stringify(imports.map((entry) => entry.origin)) !== JSON.stringify([origin])) problems.push(`meta.imports is ${JSON.stringify(imports.map((entry) => entry.origin))}, not [${origin}]`)
  return problems
}

/** Opens `origin` once without the terminal (the launch page with no code touches no key) and seeds the ten keys there. */
async function seedKeys(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/session.html`)
  await page.evaluate((entries) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value)
  }, Object.entries(SEEDED_KEYS))
}

async function homeReady(page: Page): Promise<void> {
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4, { timeout: 30_000 })
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
}

// How long a page that wrongly wrote would need: the 500 ms debounce, a round trip and a margin.
const QUIET_MS = 2_000

// ---------------------------------------------------------------- the specs

test.describe('workspace import from localStorage (03 section 10.4)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  let root = ''
  let dist = ''
  let backend: Backend
  let siteA: Site
  let siteB: Site
  let snapshot: Record<string, string> = {}

  test.beforeAll(async () => {
    test.setTimeout(150_000)
    dist = pageBuildFolder()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-import-'))
    backend = await startBackend(root, STAND_IN_PORT)
    siteA = await startSite(dist, backend.port, STAND_IN_PORT)
    siteB = await startSite(dist, backend.port, await freePort())
  })

  test.afterAll(async () => {
    await siteB?.close()
    await siteA?.close()
    await backend?.stop()
    if (root !== '') await removeTree(root)
  })

  test('the first load of a seeded origin imports all ten keys into six documents and lists the origin', async ({ browser }) => {
    expect(readDoc(backend.stateDir, 'meta'), 'the state folder starts empty').toBeNull()
    const context = await sessionContext(browser, backend, siteA.origin)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await seedKeys(page, siteA.origin)
    await page.goto(`${siteA.origin}/`)
    await homeReady(page)
    await expect.poll(() => importProblems(backend.stateDir, siteA.origin), { timeout: 20_000, message: 'the import has not completed' }).toEqual([])
    const meta = readDoc(backend.stateDir, 'meta')?.data as { imports: Array<{ origin: string; at: string }> }
    expect(meta.imports).toHaveLength(1)
    expect(meta.imports[0]?.origin).toBe(siteA.origin)
    expect(meta.imports[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    // The page still holds the keys it had: the store is a copy, localStorage stays the cache.
    expect(await page.evaluate((keys) => keys.map((key) => window.localStorage.getItem(key) !== null), Object.keys(SEEDED_KEYS))).toEqual(Object.keys(SEEDED_KEYS).map(() => true))
    expect(errors).toEqual([])
    snapshot = storeFiles(backend.stateDir)
    await context.close()
  })

  test('a second load of the same origin repeats nothing', async ({ browser }) => {
    expect(Object.keys(snapshot), 'the first test left no snapshot').toContain('meta.json')
    const context = await sessionContext(browser, backend, siteA.origin)
    const page = await context.newPage()
    await seedKeys(page, siteA.origin)
    await page.goto(`${siteA.origin}/`)
    await homeReady(page)
    await pause(QUIET_MS)
    expect(storeFiles(backend.stateDir)).toEqual(snapshot)
    await context.close()
  })

  test('a load on another port with empty storage reads the store and changes nothing', async ({ browser }) => {
    expect(siteB.origin).not.toBe(siteA.origin)
    const context = await sessionContext(browser, backend, siteB.origin)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`${siteB.origin}/session.html`)
    expect(await page.evaluate(() => window.localStorage.length), 'the new origin starts with empty storage').toBe(0)
    await page.goto(`${siteB.origin}/`)
    await homeReady(page)
    // The stored look reaches a page that has none of its own: the store is read, not only written.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic', { timeout: 20_000 })
    await expect(page.locator('html')).toHaveAttribute('data-cvd', 'deut')
    await pause(QUIET_MS)
    expect(storeFiles(backend.stateDir), 'no document and no file changed').toEqual(snapshot)
    const meta = readDoc(backend.stateDir, 'meta')?.data as { imports: Array<{ origin: string }> }
    expect(meta.imports.map((entry) => entry.origin), 'an empty page never marks its origin').toEqual([siteA.origin])
    expect(errors).toEqual([])
    await context.close()
  })
})

test.describe('workspace import against a backend without the store (an older backend, 404)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  test('the checker finds nothing in the store and the page keeps working from its cache', async ({ browser }) => {
    test.setTimeout(150_000)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-import-old-'))
    const pagePort = await freePort()
    const backend = await startBackend(root, pagePort)
    const site = await startSite(pageBuildFolder(), backend.port, pagePort, false)
    try {
      const context = await sessionContext(browser, backend, site.origin)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await seedKeys(page, site.origin)
      await page.goto(`${site.origin}/`)
      await homeReady(page)
      await pause(QUIET_MS)
      // Born failing: the very check that passes in the first test reports a problem for every document when the store
      // routes are not there, so a page that never reached the store cannot pass it.
      const problems = importProblems(backend.stateDir, site.origin)
      expect(problems).toHaveLength(Object.keys(EXPECTED_DOCS).length + 1)
      expect(storeFiles(backend.stateDir)).toEqual({})
      // Today's behaviour: the look comes from the page's own storage and no error is shown.
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic')
      await expect(page.locator('.msg-line[data-tone="error"]')).toHaveCount(0)
      expect(errors).toEqual([])
      await context.close()
    } finally {
      await site.close()
      await backend.stop()
      await removeTree(root)
    }
  })
})
