// The launch page (web/session.html) in a real headless browser, in front of a real backend (04 D2.3): it redeems the
// one-time code, removes the fragment from the address bar AND the history, sets the cookie the backend describes
// (nqt_s_<port>, HttpOnly, SameSite=Strict, Path=/api), goes to the terminal, and says what to do when the code was
// used or never there. The build folder has a space in its name and the repository sits under a spaced home folder, so
// the page is proved to work from a spaced path. 8798 is the stand-in fixed port (the fixture backend), 8799 the preview
// in front of it; never 8765. Headless only: no window is shown. Backends and servers are this file's own, stopped at the end.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { takePorts } from './portGuard.ts'
import { getLoopback } from './session.ts'
import { mintSessionLink } from './sessionSetup.ts'

const WINDOWS = process.platform === 'win32'
const WEB = fileURLToPath(new URL('../..', import.meta.url))
const TERMINAL = join(WEB, '..')
const PYTHON = join(TERMINAL, '..', '.venv', 'Scripts', 'python.exe')
const API_PORT = 8798
const WEB_PORT = 8799
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
const COOKIE = `nqt_s_${WEB_PORT}` // the backend names it after its own NQT_PORT, which is the preview's port

const scratch: string[] = []
const children: ChildProcess[] = []
let state = ''
let browser: Browser | null = null

function kill(child: ChildProcess): void {
  if (child.pid !== undefined) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(what: string, ready: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ready()) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: 'ignore', windowsHide: true })
  children.push(child)
  return child
}

let givePortsBack: () => void = () => undefined
// Another test file may be using the stand-in ports (startPs1.test.ts): one at a time.
beforeAll(async () => {
  givePortsBack = await takePorts()
}, 25 * 60_000)

beforeAll(async () => {
  if (!WINDOWS) return
  const folder = mkdtempSync(join(tmpdir(), 'nqt session page '))
  scratch.push(folder)
  const dist = join(folder, 'dist build')
  state = join(folder, 'state')
  mkdirSync(state, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('NQT_')) delete env[key]
  const build = spawnSync(process.execPath, [join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: WEB,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 150_000,
  })
  if (build.status !== 0) throw new Error(`vite build failed: ${build.stdout}${build.stderr}`)
  // The fixture backend: its own state folder, so its own lock and token. NQT_PORT is the preview's port, as in the e2e run.
  run(
    PYTHON,
    ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', join(TERMINAL, 'backend', 'tests'), '--host', '127.0.0.1', '--port', String(API_PORT)],
    TERMINAL,
    { ...env, NQT_FIXTURE_DIR: join(TERMINAL, 'backend', 'tests', 'fixtures'), NQT_PORT: String(WEB_PORT), NQT_STATE_DIR: state, PYTHONUTF8: '1' },
  )
  run(
    process.execPath,
    [join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--config', 'e2e/vite.preview.config.ts', '--outDir', dist, '--port', String(WEB_PORT), '--strictPort'],
    WEB,
    { ...env, NQT_E2E_API_ORIGIN: API_ORIGIN },
  )
  const nonce = '0'.repeat(64)
  await until('the backend', async () => (await getLoopback(`${API_ORIGIN}/api/desktop/proof?nonce=${nonce}`))?.status === 200, 120_000)
  await until('the preview', async () => (await getLoopback(`${WEB_ORIGIN}/session.html`))?.status === 200, 60_000)
  browser = await chromium.launch()
}, 300_000)

afterAll(async () => {
  await browser?.close()
  for (const child of children) kill(child)
  await sleep(500)
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  givePortsBack()
})

async function link(): Promise<string> {
  return mintSessionLink({ stateDir: state, apiPort: API_PORT, webOrigin: WEB_ORIGIN, waitMs: 30_000 })
}

describe.runIf(WINDOWS)('session.html in a browser, from a spaced path', () => {
  it('redeems the code once, sets the session cookie, removes the fragment from the address and the history, and opens the terminal', async () => {
    const context = await browser!.newContext()
    try {
      const page = await context.newPage()
      const address = await link()
      const redeemed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/session/redeem')
      await page.goto(address, { waitUntil: 'commit' })
      const answer = await redeemed
      expect(answer.status()).toBe(200)
      expect(answer.request().url(), 'the code is not in the request address').not.toMatch(/[0-9a-f]{64}/)
      expect(answer.request().headers()['x-nqt-code']).toMatch(/^[0-9a-f]{64}$/)
      await page.waitForURL((url) => url.pathname === '/', { waitUntil: 'commit' })
      expect(page.url()).toBe(`${WEB_ORIGIN}/`)

      const cookies = (await context.cookies()).filter((c) => c.name === COOKIE)
      expect(cookies, 'the session cookie').toHaveLength(1)
      expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api' })

      // Neither the address bar nor any history entry still holds the code.
      const session = await context.newCDPSession(page)
      const history = (await session.send('Page.getNavigationHistory')) as { entries: Array<{ url: string }> }
      for (const entry of history.entries) {
        expect(entry.url).not.toMatch(/[0-9a-f]{64}/)
        expect(entry.url).not.toContain('session.html')
      }
    } finally {
      await context.close()
    }
  }, 120_000)

  it('says the link was used when the same code is opened again, and still removes the fragment', async () => {
    const context = await browser!.newContext()
    try {
      const address = await link()
      const first = await context.newPage()
      await first.goto(address, { waitUntil: 'commit' })
      await first.waitForURL((url) => url.pathname === '/', { waitUntil: 'commit' })
      const second = await context.newPage()
      await second.goto(address)
      const status = second.locator('#session-status')
      await expect.poll(async () => status.textContent(), { timeout: 30_000 }).toMatch(/expired or was already used/)
      expect(await status.getAttribute('role')).toBe('alert')
      expect(second.url()).toBe(`${WEB_ORIGIN}/session.html`)
      expect(await second.title()).toBe('nq-lab terminal: not opened')
      expect(await second.locator('#session-hint').textContent()).toMatch(/start the terminal again/i)
    } finally {
      await context.close()
    }
  }, 120_000)

  it('asks for a launch link when there is no code, and makes no redeem request', async () => {
    const context = await browser!.newContext()
    try {
      const page = await context.newPage()
      const requests: string[] = []
      page.on('request', (request) => requests.push(new URL(request.url()).pathname))
      await page.goto(`${WEB_ORIGIN}/session.html#go=GP/NQ`)
      await expect.poll(async () => page.locator('#session-status').textContent(), { timeout: 30_000 }).toMatch(/needs a launch link/)
      expect(requests).not.toContain('/api/session/redeem')
      expect(page.url()).toBe(`${WEB_ORIGIN}/session.html`)
    } finally {
      await context.close()
    }
  }, 60_000)

  it('is readable without a script: the status and a way forward are in the markup', async () => {
    const context = await browser!.newContext({ javaScriptEnabled: false })
    try {
      const page = await context.newPage()
      await page.goto(`${WEB_ORIGIN}/session.html`)
      expect(await page.locator('h1').count()).toBe(1)
      expect(await page.locator('noscript').textContent()).toMatch(/needs JavaScript/)
    } finally {
      await context.close()
    }
  }, 60_000)
})
