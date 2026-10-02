// start.ps1 behind the token (04 D2.3, 03 sections 2.1, 2.4 and 2.6), run as real processes on spare loopback ports.
// 8798 stands in for the fixed browser port and 8799 for the dry runs (the port table of the build plan); 8765 is never
// used, probed or stopped. Every launcher gets its own temporary state folder, so it holds its own lock and token and
// never meets the owner's backend, and runs in fixture mode with NQT_JOBS=off. Nothing here opens a browser: the
// launcher runs under a wrapper that replaces Start-Process with a refusal that records the call, and a launcher that
// called it (a Start-Process version) fails the run.
//
// Born failing against the old launcher, which started the backend with Start-Process, printed no session link and
// never held the backend's input open.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { takePorts } from './portGuard.ts'
import { getLoopback, mac, newToken, readLock } from './session.ts'

const WINDOWS = process.platform === 'win32'
const WEB = fileURLToPath(new URL('../..', import.meta.url))
const TERMINAL = join(WEB, '..')
const START_PS1 = join(TERMINAL, 'start.ps1')
const FIXTURES = join(TERMINAL, 'backend', 'tests', 'fixtures')
const STAND_IN_PORT = 8798 // the fixed browser port's stand-in
const DRY_RUN_PORT = 8799
const STOP_WITHIN_MS = 5500 // the watchdog's 5 s, plus the time the process table takes to notice
const SESSION_URL = (port: number): RegExp => new RegExp(`http://127\\.0\\.0\\.1:${port}/session\\.html#([0-9a-f]{64})`)

const scratch: string[] = []
const children: ChildProcess[] = []
const servers: Server[] = []
const backendPids = new Set<number>()

// Another test file may be using the stand-in ports (sessionPage.browser.test.ts): one at a time.
let givePortsBack: () => void = () => undefined
beforeAll(async () => {
  givePortsBack = await takePorts()
}, 25 * 60_000)

afterAll(() => {
  // Only what this file started: each launcher, and the backend its lock names.
  for (const child of children) if (child.pid !== undefined) kill(child.pid, true)
  for (const pid of backendPids) kill(pid, true)
  for (const server of servers) {
    server.closeAllConnections()
    server.close()
  }
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  givePortsBack()
})

function kill(pid: number, tree: boolean): void {
  spawnSync('taskkill.exe', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore', windowsHide: true })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The test's environment without any NQT_ variable, plus the given ones. */
function env(extra: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(out)) if (key.startsWith('NQT_')) delete out[key]
  return { ...out, ...extra }
}

interface Launch {
  readonly child: ChildProcess
  readonly state: string
  readonly marker: string
  output(): string
  waitFor(pattern: RegExp, ms: number): Promise<RegExpMatchArray>
  exited(): Promise<number | null>
}

/** start.ps1 with `args`, run under a wrapper whose Start-Process refuses and records instead of opening anything. */
function launch(args: string[], extra: Record<string, string> = {}, state = tmp('nqt-state-')): Launch {
  const folder = tmp('nqt-launch-')
  const marker = join(folder, 'start-process.txt')
  const wrapper = join(folder, 'wrapper.ps1')
  writeFileSync(
    wrapper,
    [
      `function Start-Process { Add-Content -LiteralPath '${marker}' -Value ('Start-Process ' + ($args -join ' ')); throw 'Start-Process is not allowed in a launcher test' }`,
      `& '${START_PS1}' ${args.join(' ')}`,
      'exit $LASTEXITCODE',
    ].join('\n'),
  )
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
    env: env({ NQT_STATE_DIR: state, NQT_FIXTURE_DIR: FIXTURES, NQT_JOBS: 'off', ...extra }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)
  let text = ''
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
  const done = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  return {
    child,
    state,
    marker,
    output: () => text,
    exited: () => done,
    async waitFor(pattern, ms) {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const found = text.match(pattern)
        if (found !== null) return found
        if (child.exitCode !== null) break
        await sleep(100)
      }
      throw new Error(`timed out waiting for ${pattern}; the launcher said:\n${text}`)
    },
  }
}

function noteBackend(state: string): number | null {
  const pid = readLock(state)?.pid ?? null
  if (pid !== null) backendPids.add(pid)
  return pid
}

async function waitUntil(what: string, ready: () => boolean, ms: number): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (ready()) return Date.now() - start
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Stops what a test left running: each launcher still alive, and the backend its state folder's lock names. */
function stopAll(...runs: Launch[]): void {
  for (const run of runs) {
    if (run.child.exitCode === null && run.child.pid !== undefined) kill(run.child.pid, true)
    const pid = noteBackend(run.state)
    if (pid !== null && pid !== process.pid && alive(pid)) kill(pid, true)
  }
}

function browsersAimedAt(port: number): string {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge|firefox|brave|iexplore' -and $_.CommandLine -match '127\\.0\\.0\\.1:${port}' } | ForEach-Object { $_.CommandLine }`
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).stdout.trim()
}

/** A server that answers the proof route as the holder of `token`, and mints `code` for it; or a stranger when not. */
function fakeBackend(token: string | null, code: string): Promise<{ port: number; headers: Array<IncomingMessage['headers']> }> {
  const seen: Array<IncomingMessage['headers']> = []
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      seen.push(req.headers)
      const url = new URL(req.url ?? '', 'http://x')
      res.setHeader('content-type', 'application/json')
      if (url.pathname === '/api/desktop/proof') {
        const nonce = url.searchParams.get('nonce') ?? ''
        const key = token ?? '33'.repeat(32) // a stranger signs with a key that is not the lock's
        res.end(JSON.stringify({ proof: mac(key, 'proof', nonce, port(), process.pid), pid: process.pid }))
        return
      }
      if (url.pathname === '/api/session/code' && req.headers.authorization === `NQT ${token}`) {
        res.end(JSON.stringify({ code, expires_in_s: 60 }))
        return
      }
      res.statusCode = 401
      res.end('{}')
    })
    const port = (): number => (server.address() as AddressInfo).port
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve({ port: port(), headers: seen }))
  })
}

/** A lock file naming a backend of the test's making. `protect` gives it the owner-only rights a real lock has. */
function plantLock(state: string, port: number, token: string, protect = true): string {
  mkdirSync(state, { recursive: true })
  const file = join(state, 'backend.lock')
  writeFileSync(file, JSON.stringify({ v: 1, pid: process.pid, port, token, root: TERMINAL, started: '2026-10-02T10:00:00Z' }))
  if (protect) {
    const user = [process.env.USERDOMAIN ?? '', process.env.USERNAME ?? ''].join(String.fromCharCode(92))
    const run = spawnSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${user}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F'], { encoding: 'utf8', windowsHide: true })
    if (run.status !== 0) throw new Error(`icacls failed: ${run.stdout}${run.stderr}`)
  }
  return file
}

describe.runIf(WINDOWS)('start.ps1 -NoBrowser on a spare port', () => {
  it('prints a live one-time session link, opens no browser, and holds the backend input so closing the launcher ends it within 5 s', async () => {
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(DRY_RUN_PORT)])
    try {
      const link = await run.waitFor(SESSION_URL(DRY_RUN_PORT), 80_000)
      const code = link[1]!
      const backendPid = noteBackend(run.state)
      expect(backendPid, 'the backend holds the lock of its own state folder').not.toBeNull()
      // The launcher prints this after the session link and the 'nq-lab terminal:' line, so wait for it.
      await run.waitFor(/closing this window stops the terminal/i, 20_000)

      // The printed code is live, and works exactly once.
      const first = await getLoopback(`http://127.0.0.1:${DRY_RUN_PORT}/api/session/redeem`, { 'x-nqt-code': code })
      expect(first?.status).toBe(200)
      expect((await getLoopback(`http://127.0.0.1:${DRY_RUN_PORT}/api/session/redeem`, { 'x-nqt-code': code }))?.status).toBe(401)

      // No browser: the Start-Process stand-in was never called and nothing browser-like aims at the port.
      expect(existsSync(run.marker), 'Start-Process was called').toBe(false)
      expect(browsersAimedAt(DRY_RUN_PORT)).toBe('')
      expect(run.output()).toMatch(/browser: not opened/)

      // The launcher is the backend's parent: end it the hard way (a closed window), and its pipe closes with it.
      expect(alive(backendPid!)).toBe(true)
      kill(run.child.pid!, false)
      const took = await waitUntil('the backend to end after its launcher', () => !alive(backendPid!), 15_000)
      expect(took, `the backend took ${took} ms`).toBeLessThan(STOP_WITHIN_MS)
      expect(readLock(run.state), 'the lock is released').toBeNull()
    } finally {
      stopAll(run) // a failed assertion must not leave a backend holding the stand-in port
    }
  }, 140_000)

  it('keeps the token out of everything it prints and out of the backend command line', async () => {
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(DRY_RUN_PORT)])
    try {
      await run.waitFor(SESSION_URL(DRY_RUN_PORT), 80_000)
      const info = readLock(run.state)
      expect(info).not.toBeNull()
      noteBackend(run.state)
      expect(run.output()).not.toContain(info!.token)
      const command = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${info!.pid}").CommandLine`], {
        encoding: 'utf8',
        windowsHide: true,
      }).stdout
      expect(command).toContain('nq_terminal')
      expect(command).not.toContain(info!.token)
      kill(run.child.pid!, false)
      await waitUntil('the backend to end', () => !alive(info!.pid), 15_000)
    } finally {
      stopAll(run)
    }
  }, 140_000)
})

describe.runIf(WINDOWS)('two launchers on one state folder', () => {
  it('give one backend: the second attaches to the first, mints its own code, and never stops what it did not start', async () => {
    const first = launch(['-NoBrowser', '-NoBuild', '-Port', String(DRY_RUN_PORT)])
    let second: Launch | null = null
    try {
      const firstLink = await first.waitFor(SESSION_URL(DRY_RUN_PORT), 80_000)
      const backend = noteBackend(first.state)
      expect(backend).not.toBeNull()
      // The port asked for differs on purpose: an attached launcher goes to the port the lock names.
      second = launch(['-NoBrowser', '-NoBuild', '-Port', String(STAND_IN_PORT)], {}, first.state)
      const secondLink = await second.waitFor(SESSION_URL(DRY_RUN_PORT), 40_000)
      expect(await second.exited()).toBe(0)
      expect(second.output()).toMatch(/already runs/i)
      expect(secondLink[1], 'each launcher gets a code of its own').not.toBe(firstLink[1])
      expect(readLock(first.state)?.pid, 'one backend, the first').toBe(backend)
      expect(alive(backend!), 'an attached launcher never stops the backend').toBe(true)
      expect(existsSync(second.marker)).toBe(false)
      // The second launcher's code is live.
      expect((await getLoopback(`http://127.0.0.1:${DRY_RUN_PORT}/api/session/redeem`, { 'x-nqt-code': secondLink[1]! }))?.status).toBe(200)
      kill(first.child.pid!, false)
      await waitUntil('the backend to end', () => !alive(backend!), 15_000)
    } finally {
      stopAll(...(second === null ? [first] : [first, second]))
    }
  }, 140_000)
})

describe.runIf(WINDOWS)('start.ps1 attaching to a lock', () => {
  it('attaches to a backend that proves itself with a fresh nonce, mints the code with the token, and starts nothing', async () => {
    const token = newToken()
    const code = 'ef'.repeat(32)
    const fake = await fakeBackend(token, code)
    const state = tmp('nqt-state-')
    plantLock(state, fake.port, token)
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(STAND_IN_PORT)], {}, state)
    const link = await run.waitFor(SESSION_URL(fake.port), 40_000)
    expect(link[1]).toBe(code)
    expect(await run.exited()).toBe(0)
    expect(existsSync(run.marker)).toBe(false)
    // The proof came before the token: the first request carried no Authorization header, and only the code request did.
    const paths = fake.headers.map((h) => h.authorization ?? null)
    expect(paths[0]).toBeNull()
    expect(paths.filter((h) => h !== null)).toEqual([`NQT ${token}`])
    expect(run.output()).not.toContain(token)
    expect(readLock(state)?.pid, 'the lock was left alone').toBe(process.pid)
  }, 60_000)

  it('never sends the token to a backend that cannot prove it holds it', async () => {
    const token = newToken()
    const stranger = await fakeBackend(null, 'ab'.repeat(32))
    const state = tmp('nqt-state-')
    plantLock(state, stranger.port, token)
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(DRY_RUN_PORT)], {}, state)
    // The planted file is not held open by anything, so the real backend treats it as stale and replaces it.
    const link = await run.waitFor(SESSION_URL(DRY_RUN_PORT), 80_000)
    noteBackend(state)
    expect(link[1]).not.toBe('ab'.repeat(32))
    expect(stranger.headers.every((h) => h.authorization === undefined), 'the token reached an unproven backend').toBe(true)
    expect(stranger.headers.length, 'it was asked for a proof').toBeGreaterThan(0)
    expect(run.output()).not.toContain(token)
    kill(run.child.pid!, false)
    const pid = readLock(state)?.pid
    if (pid !== undefined) await waitUntil('the backend to end', () => !alive(pid), 15_000)
  }, 140_000)
})

describe.runIf(WINDOWS)('start.ps1 and a lock that is not owner-only', () => {
  it('refuses a lock other accounts can write, and never sends it the token', async () => {
    const token = newToken()
    const fake = await fakeBackend(token, 'ab'.repeat(32))
    const state = tmp('nqt-state-')
    plantLock(state, fake.port, token, false) // inherits the folder rights: other accounts have access
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(DRY_RUN_PORT)], {}, state)
    expect(await run.exited()).not.toBe(0)
    expect(run.output()).toMatch(/not owner-only/i)
    expect(fake.headers, 'the planted backend was never contacted').toEqual([])
    expect(existsSync(run.marker)).toBe(false)
  }, 60_000)
})

describe.runIf(WINDOWS)('start.ps1 -Dev behind the token', () => {
  it('stops with a message when a backend already holds the lock, and starts nothing', async () => {
    const token = newToken()
    const fake = await fakeBackend(token, 'cd'.repeat(32))
    const state = tmp('nqt-state-')
    plantLock(state, fake.port, token)
    const run = launch(['-Dev', '-NoBrowser', '-Port', String(STAND_IN_PORT), '-DevPort', String(DRY_RUN_PORT)], {}, state)
    expect(await run.exited()).not.toBe(0)
    expect(run.output()).toMatch(/lock/i)
    expect(run.output()).toMatch(/-Dev/)
    expect(existsSync(run.marker)).toBe(false)
  }, 60_000)

  it('runs the reloading backend and Vite on spare ports; the dev origin gets its session through the one-time code', async () => {
    const run = launch(['-Dev', '-NoBrowser', '-Port', String(STAND_IN_PORT), '-DevPort', String(DRY_RUN_PORT)])
    const link = await run.waitFor(SESSION_URL(DRY_RUN_PORT), 110_000)
    const info = readLock(run.state)
    expect(info?.port, 'the lock records the backend port the proxy reads').toBe(STAND_IN_PORT)
    expect(run.output()).not.toContain(info!.token)
    const backend = info!.pid
    backendPids.add(backend)
    // The dev server serves the launch page, and its /api proxy reaches the backend the lock names.
    const page = await getLoopback(`http://127.0.0.1:${DRY_RUN_PORT}/session.html`, {}, 30_000)
    expect(page?.status).toBe(200)
    expect(page?.body).toContain('session-status')
    const redeemed = await getLoopback(`http://127.0.0.1:${DRY_RUN_PORT}/api/session/redeem`, { 'x-nqt-code': link[1]! })
    expect(redeemed?.status, 'the code works through the dev proxy').toBe(200)
    expect(JSON.parse(redeemed?.body ?? '{}')).toMatchObject({ ok: true, cookie: `nqt_s_${STAND_IN_PORT}` })
    expect(existsSync(run.marker)).toBe(false)
    expect(browsersAimedAt(DRY_RUN_PORT)).toBe('')
    kill(run.child.pid!, true)
    await waitUntil('the backend to end', () => !alive(backend), 15_000)
  }, 170_000)
})

describe.runIf(WINDOWS)('start.ps1 on a port something else holds', () => {
  it('stops with a message and starts nothing when the port answers as no terminal', async () => {
    const holder = await new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer((_req, res) => res.end('hello'))
      servers.push(server)
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }))
    })
    const run = launch(['-NoBrowser', '-NoBuild', '-Port', String(holder.port)])
    expect(await run.exited()).not.toBe(0)
    expect(run.output()).toMatch(/taken by another program/i)
    expect(existsSync(run.marker)).toBe(false)
    expect(readFileSync(START_PS1, 'utf8').length).toBeGreaterThan(0)
  }, 60_000)
})
