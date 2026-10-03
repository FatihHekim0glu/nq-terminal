// The desktop seams end to end (roadmap D3.4, 03 section 15.2: workspace store, sessions, bridge). Each flow runs the
// page the way the desktop app serves it: the page build and /api on one origin, a backend of the run's own with its own
// temporary state folder, a session bought the way the shell buys it, a headless browser.
//
//   1. A workspace is saved on one origin, the backend is stopped and started again on a NEW port with the SAME state
//      folder, a page on a new origin (empty storage) loads, and the workspace is there: the file store, not the
//      browser's storage, carried it across the restart.
//   2. The launch-code flow: a code opens the terminal through session.html once, the code never travels in a request
//      line and leaves the address bar, and the same code is refused the second time.
//   3. Export and GRAB through the bridge: told by the shell's injected object that it runs in the Windows app, the
//      page still saves a CSV and a PNG through the download link the shell's download handler takes over, and puts a
//      PNG on the clipboard; no data request is made by either.
//
// Nothing here touches the live terminal: the backend is the fixture backend (backend/tests/fixture_app.py) on a free
// port; the page is the run's own build (the folder the preview of playwright.config.ts serves) behind a small
// same-origin server of this spec; every spawn is hidden; the browser is headless. The harness below is the same as in
// workspace-import.spec.ts.
import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_CSP } from './backendCsp.ts'
import { LOOPBACK, mintCode, readLock } from '../scripts/start/session.ts'

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

// ---------------------------------------------------------------- helpers of the flows

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const message = (page: Page): Locator => page.locator('.msg-line[role="status"]')
const SESSION_REDEEM = '/api/session/redeem'
// The status line polls the health route and the store routes carry the page's saved state: neither is a data read.
const NOT_A_DATA_READ = /^\/api\/(health|workspaces)(\/|$)/
const API_PATH = /^\/api(\/|$)/

async function homeReady(page: Page): Promise<void> {
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4, { timeout: 30_000 })
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
}

async function runLine(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
}

/** The API paths with their query of every request after the first `from`, less the polls and the store's own traffic.
 *  Code chunks and fonts the page loads on demand are not API reads. */
function dataReadsSince(requests: readonly string[], from: number): string[] {
  return requests
    .slice(from)
    .map((url) => new URL(url))
    .filter((url) => API_PATH.test(url.pathname) && !NOT_A_DATA_READ.test(url.pathname))
    .map((url) => `${url.pathname}${url.search}`)
}

/** Waits until the page has made no API data read for `settleMs`: a screen's late reads belong to the screen, not to the action about to be measured. */
async function quiet(requests: readonly string[], settleMs = 1_500): Promise<void> {
  let seen = -1
  while (seen !== dataReadsSince(requests, 0).length) {
    seen = dataReadsSince(requests, 0).length
    await pause(settleMs)
  }
}

// ---------------------------------------------------------------- 1. a saved workspace survives a restart on a new port

test.describe('seam: the workspace store across a backend restart', () => {
  test.describe.configure({ timeout: 240_000 })

  test('a workspace saved before the backend restarts on a new port loads on a new origin', async ({ browser }) => {
    const dist = pageBuildFolder()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-seams-restart-'))
    const stopped: Array<() => Promise<void>> = []
    // Stops what was started, the last first (each page server before the backend behind it).
    const shutdown = async (): Promise<void> => {
      for (const stop of stopped.splice(0).reverse()) await stop()
    }
    try {
      // First run: save a workspace whose first panel is NQ DES, which the default HOME does not hold.
      const firstPort = await freePort()
      const first = await startBackend(root, firstPort)
      stopped.push(first.stop)
      const firstSite = await startSite(dist, first.port, firstPort)
      stopped.push(firstSite.close)
      const before = await sessionContext(browser, first, firstSite.origin)
      const page = await before.newPage()
      await page.goto(`${firstSite.origin}/`)
      await homeReady(page)
      await runLine(page, 'NQ DES')
      await expect(panel(page, 'NQ DES')).toHaveCount(1)
      await runLine(page, 'SAVE SEAMS')
      await expect(message(page)).toHaveText(/^Saved SEAMS \(\d+ panels?\)\.$/)
      await expect.poll(() => (readDoc(first.stateDir, 'workspaces')?.data as { list?: Record<string, unknown> } | undefined)?.list?.SEAMS !== undefined, { timeout: 20_000, message: 'the store has not written the workspace' }).toBe(true)
      await before.close() // the page flushes on pagehide
      await shutdown()
      expect(readDoc(first.stateDir, 'workspaces')?.version).toBeGreaterThanOrEqual(1)

      // Second run: the same state folder, a new port, a new origin, empty browser storage.
      const secondPort = await freePort()
      const second = await startBackend(root, secondPort)
      stopped.push(second.stop)
      const secondSite = await startSite(dist, second.port, secondPort)
      stopped.push(secondSite.close)
      expect(second.stateDir).toBe(first.stateDir)
      expect(second.port, 'the backend came back on another port').not.toBe(first.port)
      expect(secondSite.origin).not.toBe(firstSite.origin)
      const after = await sessionContext(browser, second, secondSite.origin)
      const again = await after.newPage()
      const errors: string[] = []
      again.on('pageerror', (error) => errors.push(String(error)))
      await again.goto(`${secondSite.origin}/session.html`)
      expect(await again.evaluate(() => window.localStorage.length), 'the new origin starts with empty storage').toBe(0)
      await again.goto(`${secondSite.origin}/`)
      // The page may restore the last workspace by itself once the store has been read; either way LOAD finds it.
      await expect(again.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 30_000 })
      await expect(again.locator('p.ws-empty')).toHaveCount(0)
      await runLine(again, 'LOAD SEAMS')
      await expect(message(again)).toHaveText('Loaded SEAMS.')
      await expect(panel(again, 'NQ DES')).toHaveCount(1)
      expect(errors).toEqual([])
      await after.close()
    } finally {
      await shutdown()
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    }
  })
})

// ---------------------------------------------------------------- 2 and 3 share one backend

test.describe('seams: the launch code and the bridge', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  let root = ''
  let backend: Backend
  let site: Site

  test.beforeAll(async () => {
    test.setTimeout(150_000)
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-seams-'))
    const pagePort = await freePort()
    backend = await startBackend(root, pagePort)
    site = await startSite(pageBuildFolder(), backend.port, pagePort)
  })

  test.afterAll(async () => {
    await site?.close()
    await backend?.stop()
    if (root !== '') fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  })

  test('a launch code opens the terminal once and a reused code is refused', async ({ browser }) => {
    const lock = readLock(backend.stateDir)
    expect(lock, 'the backend holds a lock').not.toBeNull()
    const code = await mintCode(backend.port, lock?.token ?? '')
    expect(code).toMatch(/^[0-9a-f]{64}$/)
    const link = `${site.origin}/session.html#${code}`

    // First use: the page redeems the code, drops it from the address bar and opens the terminal.
    const opened = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } })
    const page = await opened.newPage()
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    const redeemed = page.waitForResponse((response) => new URL(response.url()).pathname === SESSION_REDEEM)
    await page.goto(link, { waitUntil: 'commit' })
    expect((await redeemed).status()).toBe(200)
    await page.waitForURL((url) => url.pathname === '/' && url.hash === '', { waitUntil: 'commit', timeout: 30_000 })
    await homeReady(page)
    expect(page.url()).not.toContain(String(code))
    expect(requests.filter((url) => url.includes(String(code))), 'the code is in no request line').toEqual([])
    expect((await page.request.get(`${site.origin}/api/health`)).status(), 'the session works').toBe(200)
    await opened.close()

    // Second use of the same code, in a clean browser: refused, in words, and no session comes of it.
    const refused = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } })
    const second = await refused.newPage()
    const answer = second.waitForResponse((response) => new URL(response.url()).pathname === SESSION_REDEEM)
    await second.goto(link, { waitUntil: 'commit' })
    expect((await answer).status()).toBe(401)
    await expect(second.getByRole('alert')).toContainText(/expired or was already used/)
    expect(new URL(second.url()).hash, 'the code leaves the address bar even when refused').toBe('')
    await expect(second.locator('[data-nqt-title]')).toHaveCount(0)
    expect((await second.request.get(`${site.origin}/api/health`)).status(), 'no session came of a refused code').toBe(401)
    await refused.close()
  })

  test('export and GRAB go through the bridge: a CSV and a PNG are saved, a PNG is copied, no data is read', async ({ browser }) => {
    const context = await sessionContext(browser, backend, site.origin, { permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    // What the Windows shell injects before any page script (03 section 4.4) and, as spies, the two things the bridge
    // reaches the shell by: the download link its download handler takes over, and the clipboard's image write.
    await page.addInitScript(() => {
      Object.defineProperty(window, '__NQT_SHELL__', { value: Object.freeze({ bridgeVersion: 1, platform: 'windows', keys: 'pc' }) })
      const seen: { saves: Array<{ name: string; blob: boolean }>; images: string[][] } = { saves: [], images: [] }
      Object.defineProperty(window, '__nqtSeams', { value: seen })
      const click = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
        if (this.download) seen.saves.push({ name: this.download, blob: this.href.startsWith('blob:') })
        click.call(this)
      }
      const clipboard = navigator.clipboard
      const write = clipboard.write.bind(clipboard)
      Object.defineProperty(clipboard, 'write', {
        configurable: true,
        value: (items: ClipboardItems) => {
          seen.images.push(items.flatMap((item) => [...item.types]))
          return write(items)
        },
      })
    })
    const requests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`${site.origin}/`)
    await homeReady(page)
    expect(await page.evaluate(() => (window as unknown as { __NQT_SHELL__: { platform: string } }).__NQT_SHELL__.platform)).toBe('windows')
    const seen = () => page.evaluate(() => (window as unknown as { __nqtSeams: { saves: Array<{ name: string; blob: boolean }>; images: string[][] } }).__nqtSeams)

    // GRAB <GO> on the GP panel: the chart as one PNG through the download link.
    const gp = panel(page, 'NQ GP 1d')
    await expect(gp.getByRole('img', { name: /^NQ1 Index: / })).toBeVisible()
    await page.keyboard.press('Alt+1')
    await quiet(requests)
    let from = requests.length
    const [grabbed] = await Promise.all([page.waitForEvent('download'), runLine(page, 'GRAB')])
    expect(grabbed.suggestedFilename()).toMatch(/\.png$/)
    const png = fs.readFileSync(await grabbed.path())
    expect([...png.subarray(0, 8)], 'the file is a PNG').toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(message(page)).toContainText(/Saved (1 chart with its|\d+ charts with their) labels as \S+\.png\./)
    expect(dataReadsSince(requests, from), 'GRAB reads nothing').toEqual([])

    // The panel's Options row: the same image on the clipboard.
    await quiet(requests)
    from = requests.length
    await gp.getByRole('button', { name: 'Options' }).click()
    await page.getByRole('menuitem', { name: 'Copy image' }).click()
    await expect(message(page)).toContainText(/Copied (1 chart with its|\d+ charts with their) labels to the clipboard\./)
    expect((await seen()).images.flat()).toContain('image/png')
    expect(dataReadsSince(requests, from), 'Copy image reads nothing').toEqual([])

    // 98) Export of RUNS: the rows on screen as a CSV through the same link.
    await runLine(page, 'RUNS')
    const runs = panel(page, 'RUNS')
    await expect(runs).toHaveCount(1)
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
    const rows = (await (await page.request.get(`${site.origin}/api/runs`)).json()) as unknown[]
    await quiet(requests)
    from = requests.length
    const [exported] = await Promise.all([page.waitForEvent('download'), runs.getByRole('button', { name: /98\) Export/ }).click()])
    expect(exported.suggestedFilename()).toBe('runs_all.csv')
    expect(fs.readFileSync(await exported.path(), 'utf8').split('\r\n')).toHaveLength(rows.length + 1)
    expect(dataReadsSince(requests, from), 'Export reads nothing').toEqual([])

    // Both files went by the download link, which is what the shell's download handler takes over.
    expect((await seen()).saves).toEqual([
      { name: grabbed.suggestedFilename(), blob: true },
      { name: 'runs_all.csv', blob: true },
    ])
    expect(errors).toEqual([])
    await context.close()
  })
})
