// The launcher from the outside: gatherFacts on scratch folders, ./start.sh and scripts/start.mjs as real
// processes (dry run, doctor, usage errors, the Node switch), and a live run against a fake Vite and a fake
// backend that checks Ctrl+C leaves no process behind. Nothing here installs, builds or binds a fixed port:
// live runs take a free ephemeral port, and 5173, 5174 and 8765 are only ever read. The backend is behind the
// session token: the fake backend reads TOKEN and NONCE from its input, signs the proof route with them, mints a
// launch code for the token holder and exits when its input closes; the launcher is checked to print the session link.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, copyFileSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { gatherFacts } from './facts.ts'
import { main } from './launcher.ts'
import { mac, newToken } from './session.ts'

const WEB = fileURLToPath(new URL('../..', import.meta.url))
const ROOT = dirname(WEB.replace(/[\\/]$/, ''))
const START_MJS = join(ROOT, 'scripts', 'start.mjs')
const START_SH = join(ROOT, 'start.sh')
const LAUNCHER_URL = pathToFileURL(join(WEB, 'scripts', 'start', 'launcher.ts')).href
const NODE24 = process.execPath
/**
 * The suites below that run shell-script fakes, sh, chmod bits or process groups are POSIX only: the Windows box
 * runs start.ps1 (covered by src/screens/home/startScript.test.ts), and ./start.sh there says so and stops.
 */
const WINDOWS = process.platform === 'win32'

const scratch: string[] = []
const drivers: Array<{ readonly dispose: () => void }> = []
afterAll(() => {
  // A test that timed out never reached its finally: end its fakes here, then remove the folders.
  for (const driver of drivers) driver.dispose()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function tmp(prefix = 'nqt-start-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  scratch.push(dir)
  return dir
}

/** The test's environment without any NQT_ variable, so a value on the developer's machine cannot leak in. */
function baseEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('NQT_')) delete env[key]
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function writeExecutable(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  chmodSync(path, 0o755)
}

/** A lab root whose .venv/bin/python is a shell script: `body` is its text after the shebang. */
function labWithPython(body: string): string {
  const lab = tmp('nqt-lab-')
  writeExecutable(join(lab, '.venv', 'bin', 'python'), `#!/bin/sh\n${body}\n`)
  return lab
}

const PYTHON_OK = 'exit 0'
const PYTHON_NO_NQ_LAB = 'case "$*" in *nq_lab*) exit 1;; esac\nexit 0'

interface Ran {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 90_000): Ran {
  const r = spawnSync(command, args, { encoding: 'utf8', env, timeout, stdio: ['ignore', 'pipe', 'pipe'] })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function startMjs(args: string[], env: NodeJS.ProcessEnv, node = NODE24): Ran {
  return run(node, [START_MJS, ...args], env)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }))
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(what: string, ready: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (ready()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** `promise`, or a rejection after `ms`, so a hung launcher fails the test while its finally can still run. */
function within<T>(what: string, promise: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function getStatus(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path: '/', timeout: 3000 }, (res) => {
      res.resume()
      resolve(res.statusCode ?? null)
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => req.destroy())
  })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ gatherFacts

/** A scratch terminal folder: web/package.json plus whatever files are asked for, at the given mtimes (seconds). */
function terminalWith(files: Record<string, number | null> = {}, engines = '>=24'): string {
  const dir = tmp('nqt-term-')
  mkdirSync(join(dir, 'web'), { recursive: true })
  writeFileSync(join(dir, 'web', 'package.json'), JSON.stringify({ engines: { node: engines } }))
  for (const [rel, seconds] of Object.entries(files)) {
    const path = join(dir, 'web', rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'x')
    if (seconds !== null) utimesSync(path, seconds, seconds)
  }
  return dir
}

describe.skipIf(WINDOWS)('gatherFacts', () => {
  it('reports this Node and the version the engines ask for', async () => {
    const dir = terminalWith({}, '>=26')
    const facts = await gatherFacts({ terminalDir: dir, env: baseEnv() })
    expect(facts.node).toEqual({ version: process.version, path: process.execPath })
    expect(facts.requiredNode).toBe(26)
    expect(facts.terminalDir).toBe(dir)
    expect(facts.platform).toBe(process.platform)
  })

  it('falls back to 24 when package.json cannot be read', async () => {
    const dir = tmp('nqt-term-')
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv() })).requiredNode).toBe(24)
  })

  it('takes the lab root from NQT_LAB_ROOT when it is absolute and exists, else from the parent folder', async () => {
    const parent = tmp('nqt-parent-')
    const dir = join(parent, 'terminal')
    mkdirSync(join(dir, 'web'), { recursive: true })
    const lab = tmp('nqt-lab-')
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: lab }) })).labRoot).toBe(lab)
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv() })).labRoot).toBe(parent)
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: join(lab, 'missing') }) })).labRoot).toBe(parent)
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: 'relative/lab' }) })).labRoot).toBe(parent)
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: '' }) })).labRoot).toBe(parent)
  })

  it('finds the venv python by platform', async () => {
    const lab = tmp('nqt-lab-')
    const dir = terminalWith()
    const posix = await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: lab }), platform: 'linux' })
    expect(posix.python).toEqual({ path: join(lab, '.venv', 'bin', 'python'), exists: false, fastapi: false, nqLab: false })
    const windows = await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_LAB_ROOT: lab }), platform: 'win32' })
    expect(windows.python.path).toBe(join(lab, '.venv', 'Scripts', 'python.exe'))
  })

  it('imports fastapi and uvicorn, and nq_lab, with the venv python and no shell', async () => {
    const log = join(tmp(), 'args.log')
    const lab = labWithPython(`printf '%s\\n' "$*" >> "${log}"\nexit 0`)
    const facts = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv({ NQT_LAB_ROOT: lab }) })
    expect(facts.python).toEqual({ path: join(lab, '.venv', 'bin', 'python'), exists: true, fastapi: true, nqLab: true })
    expect(readFileSync(log, 'utf8').trim().split('\n').sort()).toEqual(['-c import fastapi, uvicorn', '-c import nq_lab.config'])
  })

  it('tells a venv without nq_lab from one without fastapi', async () => {
    const noLab = labWithPython(PYTHON_NO_NQ_LAB)
    const a = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv({ NQT_LAB_ROOT: noLab }) })
    expect(a.python).toMatchObject({ exists: true, fastapi: true, nqLab: false })
    const noApi = labWithPython('case "$*" in *fastapi*) exit 1;; esac\nexit 0')
    const b = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv({ NQT_LAB_ROOT: noApi }) })
    expect(b.python).toMatchObject({ exists: true, fastapi: false, nqLab: true })
  })

  it('counts a venv python that cannot run as a miss, not a crash', async () => {
    const lab = tmp('nqt-lab-')
    writeExecutable(join(lab, '.venv', 'bin', 'python'), 'not a program\n')
    const facts = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv({ NQT_LAB_ROOT: lab }) })
    expect(facts.python).toMatchObject({ exists: true, fastapi: false, nqLab: false })
  })

  it('sees the web dependencies only when Vite is installed', async () => {
    expect((await gatherFacts({ terminalDir: terminalWith(), env: baseEnv() })).webDeps).toBe(false)
    const dir = terminalWith({ 'node_modules/vite/bin/vite.js': null })
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv() })).webDeps).toBe(true)
  })

  it('reads NQT_FIXTURE_DIR, treating empty as unset', async () => {
    const dir = terminalWith()
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_FIXTURE_DIR: '/fx' }) })).fixtureDir).toBe('/fx')
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ NQT_FIXTURE_DIR: '' }) })).fixtureDir).toBeNull()
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv() })).fixtureDir).toBeNull()
  })

  it('finds a bundled Chromium in the Playwright cache', async () => {
    const cache = tmp('nqt-pw-')
    const dir = terminalWith()
    const none = await gatherFacts({ terminalDir: dir, env: baseEnv({ PLAYWRIGHT_BROWSERS_PATH: cache }) })
    expect(none.browser.bundled).toBe(false)
    mkdirSync(join(cache, 'ffmpeg-1011'))
    expect((await gatherFacts({ terminalDir: dir, env: baseEnv({ PLAYWRIGHT_BROWSERS_PATH: cache }) })).browser.bundled).toBe(false)
    mkdirSync(join(cache, 'chromium-1234'))
    const some = await gatherFacts({ terminalDir: dir, env: baseEnv({ PLAYWRIGHT_BROWSERS_PATH: cache }) })
    expect(some.browser.bundled).toBe(true)
    expect(typeof some.browser.chrome).toBe('boolean')
  })

  it('checks corepack on PATH', async () => {
    const facts = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv() })
    expect(facts.corepack).toBe(true) // the Node that runs these tests ships it
    const empty = tmp('nqt-path-')
    const none = await gatherFacts({ terminalDir: terminalWith(), env: baseEnv({ PATH: empty }) })
    expect(none.corepack).toBe(false)
  })

  describe('build freshness (start.ps1 rule)', () => {
    const DIST = 4_000_000_000
    const build = async (files: Record<string, number | null>): Promise<boolean> => {
      const dir = terminalWith({ 'dist/index.html': DIST, ...files })
      return (await gatherFacts({ terminalDir: dir, env: baseEnv() })).buildNeeded
    }

    it('needs a build when web/dist is missing', async () => {
      expect((await gatherFacts({ terminalDir: terminalWith({ 'src/a.ts': 1 }), env: baseEnv() })).buildNeeded).toBe(true)
    })

    it('is up to date when nothing is newer than dist/index.html', async () => {
      expect(await build({ 'src/a.ts': DIST - 100, 'src/deep/b.tsx': DIST - 5, 'public/f.svg': DIST - 1 })).toBe(false)
      expect(await build({ 'src/a.ts': DIST })).toBe(false)
    })

    it('needs a build when a source, a public file or a build input is newer', async () => {
      expect(await build({ 'src/deep/y.ts': DIST + 100 })).toBe(true)
      expect(await build({ 'public/f.svg': DIST + 100 })).toBe(true)
      for (const name of ['index.html', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json']) {
        expect(await build({ [name]: DIST + 100 })).toBe(true)
      }
    })

    it('ignores test and gallery files, as start.ps1 does', async () => {
      expect(await build({ 'src/a.ts': DIST - 10, 'src/deep/x.test.ts': DIST + 100, 'src/deep/y.gallery.tsx': DIST + 100 })).toBe(false)
    })
  })

  describe('ports', () => {
    it('reads free, terminal and busy on the loopback address, and always lists the three fixed ports', async () => {
      const free = await freePort()
      const terminal = await listen((req, res) => {
        res.end(req.url === '/api/health' ? '{"fence":"ok"}' : 'x')
      })
      const busy = await listen((_req, res) => {
        res.end('<html>a dev server</html>')
      })
      const refusing = await listen((_req, res) => {
        res.statusCode = 503
        res.end('{"fence":"no"}')
      })
      try {
        const facts = await gatherFacts({
          terminalDir: terminalWith(),
          env: baseEnv(),
          ports: [free, terminal.port, busy.port, refusing.port],
        })
        expect(facts.ports[String(free)]).toBe('free')
        expect(facts.ports[String(terminal.port)]).toBe('terminal')
        expect(facts.ports[String(busy.port)]).toBe('busy')
        expect(facts.ports[String(refusing.port)]).toBe('busy')
        for (const fixed of ['8765', '5173', '5174']) expect(['free', 'terminal', 'busy']).toContain(facts.ports[fixed])
      } finally {
        await Promise.all([closeServer(terminal.server), closeServer(busy.server), closeServer(refusing.server)])
      }
    })
  })

  describe('contract check', () => {
    it('is skipped unless asked for, and unknown when the generator is absent', async () => {
      const dir = terminalWith()
      expect((await gatherFacts({ terminalDir: dir, env: baseEnv() })).contract).toBe('unknown')
      expect((await gatherFacts({ terminalDir: dir, env: baseEnv(), contract: true })).contract).toBe('unknown')
    })

    it('runs gen-api.mjs --check with this Node when asked', async () => {
      const dir = terminalWith({ 'node_modules/vite/bin/vite.js': null })
      mkdirSync(join(dir, 'web', 'src', 'api', 'codegen'), { recursive: true })
      writeFileSync(join(dir, 'web', 'src', 'api', 'codegen', 'gen-api.mjs'), "console.error('stale generated API files (run pnpm gen:api)'); process.exit(1)\n")
      expect((await gatherFacts({ terminalDir: dir, env: baseEnv(), contract: true })).contract).toBe('stale')
      writeFileSync(join(dir, 'web', 'src', 'api', 'codegen', 'gen-api.mjs'), "console.log('in sync')\n")
      expect((await gatherFacts({ terminalDir: dir, env: baseEnv(), contract: true })).contract).toBe('in sync')
      writeFileSync(join(dir, 'web', 'src', 'api', 'codegen', 'gen-api.mjs'), "throw new Error('cannot import openapi-typescript')\n")
      expect((await gatherFacts({ terminalDir: dir, env: baseEnv(), contract: true })).contract).toBe('unknown')
    })
  })
})

// ------------------------------------------------------------------ main, in this process

describe('main: cases that need no other process', () => {
  function capture(): { out: string[]; err: string[]; ctx: { stdout: (l: string) => void; stderr: (l: string) => void } } {
    const out: string[] = []
    const err: string[] = []
    return { out, err, ctx: { stdout: (l) => void out.push(l), stderr: (l) => void err.push(l) } }
  }

  it('prints the usage and returns 0 for --help', async () => {
    const c = capture()
    expect(await main(['--help'], { terminalDir: ROOT, ...c.ctx })).toBe(0)
    expect(c.out[0]).toBe('Usage: ./start.sh [doctor] [options]')
    expect(c.err).toEqual([])
  })

  it('returns 2 with the reason and a pointer to --help for a usage error', async () => {
    const c = capture()
    expect(await main(['--port', '80'], { terminalDir: ROOT, ...c.ctx })).toBe(2)
    expect(c.err.join('\n')).toContain('--port')
    expect(c.err.join('\n')).toContain('--help')
    expect(c.out).toEqual([])
  })

  it('points a Windows start at start.ps1, returns 2 and gathers nothing', async () => {
    const c = capture()
    expect(await main(['--dry-run'], { terminalDir: ROOT, platform: 'win32', ...c.ctx })).toBe(2)
    expect([...c.out, ...c.err].join('\n')).toContain('On Windows run start.ps1 (README, Start it).')
  })
})

// ------------------------------------------------------------------ scripts/start.mjs and start.sh, as processes

describe.skipIf(WINDOWS)('scripts/start.mjs: dry run and doctor', () => {
  it('says mode: DEMO ONLY for an empty NQT_LAB_ROOT, and starts nothing', () => {
    const lab = tmp('nqt-lab-')
    const r = startMjs(['--dry-run', '--no-browser'], baseEnv({ NQT_LAB_ROOT: lab }))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines).toContain('mode: DEMO ONLY (nq_lab not found)')
    // The user's own demo server may hold 5174 right now, so only the shape of the port line is fixed.
    expect(lines.some((l) => /^port: 5174 \((free|busy|terminal)\)$/.test(l))).toBe(true)
    expect(lines).toContain('page: http://127.0.0.1:5174/')
    expect(lines).toContain('browser: not opened')
    expect(lines.some((l) => l.includes('serve the demo') && l.includes('--mode demo --port 5174 --strictPort'))).toBe(true)
    expect(lines.some((l) => l.includes('install'))).toBe(false)
  })

  it('makes the demo plan on a chosen port, with the server flags in one argument list', () => {
    const r = startMjs(['--demo', '--no-browser', '--port', '5193', '--dry-run'], baseEnv({ NQT_LAB_ROOT: tmp('nqt-lab-') }))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('mode: DEMO ONLY (--demo)')
    expect(r.stdout).toContain('--mode demo --port 5193 --strictPort')
    expect(r.stdout).toContain('page: http://127.0.0.1:5193/')
    expect(r.stdout).not.toContain('install')
    expect(r.stdout).not.toContain('0.0.0.0')
  })

  it('says mode: FULL when the lab root has a venv python that imports fastapi, uvicorn and nq_lab', () => {
    const lab = labWithPython(PYTHON_OK)
    const r = startMjs(['--dry-run', '--no-browser', '--no-build'], baseEnv({ NQT_LAB_ROOT: lab }))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('mode: FULL (venv python with fastapi, uvicorn and nq_lab)')
    expect(r.stdout).toContain(`start the backend: ${join(lab, '.venv', 'bin', 'python')} -m nq_terminal (in ${join(ROOT, 'backend')})`)
    expect(r.stdout).toContain('env: NQT_PORT=8765 PYTHONUTF8=1 PYTHONIOENCODING=utf-8 NQT_PREWARM=1')
    expect(r.stdout).toContain('build: skipped (--no-build)')
    expect(r.stdout).toContain('page: http://127.0.0.1:8765/')
  })

  it('says mode: FIXTURE with NQT_FIXTURE_DIR, and passes the folder on', () => {
    const lab = labWithPython(PYTHON_OK)
    const fixtures = tmp('nqt-fx-')
    const r = startMjs(['--dry-run', '--no-browser', '--no-build', '--port', '8790'], baseEnv({ NQT_LAB_ROOT: lab, NQT_FIXTURE_DIR: fixtures }))
    expect(r.stdout).toContain('mode: FIXTURE (')
    expect(r.stdout).toContain(`NQT_PORT=8790 PYTHONUTF8=1 PYTHONIOENCODING=utf-8 NQT_FIXTURE_DIR=${fixtures}`)
  })

  it('falls back to the demo when the venv has no nq_lab, and refuses --full naming it', () => {
    const lab = labWithPython(PYTHON_NO_NQ_LAB)
    const env = baseEnv({ NQT_LAB_ROOT: lab })
    expect(startMjs(['--dry-run', '--no-browser'], env).stdout).toContain('mode: DEMO ONLY (nq_lab not found)')
    const full = startMjs(['--full', '--dry-run'], env)
    expect(full.status).toBe(1)
    expect(full.stderr).toContain('nq_lab')
    expect(full.stderr).toContain('NQT_LAB_ROOT')
    expect(full.stdout).toBe('')
  })

  it('refuses --dev without a backend', () => {
    const r = startMjs(['--dev', '--dry-run'], baseEnv({ NQT_LAB_ROOT: tmp('nqt-lab-') }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--dev')
    expect(r.stderr).toContain('nq_lab')
  })

  it('plans --dev with uvicorn --reload and the Vite dev server', () => {
    const lab = labWithPython(PYTHON_OK)
    const r = startMjs(['--dev', '--dry-run', '--no-browser'], baseEnv({ NQT_LAB_ROOT: lab }))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('-m uvicorn nq_terminal.app:create_app --factory --reload --host 127.0.0.1 --port 8765 --no-server-header --no-proxy-headers --timeout-graceful-shutdown 2')
    expect(r.stdout).toContain('page: http://127.0.0.1:5173/')
  })

  it('exits 2 with the reason for a usage error, and 0 with the usage for --help', () => {
    const bad = startMjs(['--bogus'], baseEnv())
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('--bogus')
    expect(bad.stdout).toBe('')
    const help = startMjs(['--help'], baseEnv())
    expect(help.status).toBe(0)
    expect(help.stdout.startsWith('Usage: ./start.sh')).toBe(true)
  })

  it('doctor mentions nq_lab, ends on the mode line and starts nothing', () => {
    const r = startMjs(['doctor'], baseEnv({ NQT_LAB_ROOT: tmp('nqt-lab-') }))
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines.some((l) => l.includes('nq_lab'))).toBe(true)
    expect(lines[0]).toMatch(/^ok {4}node \d+\.\d+\.\d+ at /)
    expect(lines[lines.length - 1]).toBe('mode: DEMO ONLY (nq_lab not found). Next: ./start.sh')
    for (const line of lines.slice(0, -1)) expect(line).toMatch(/^(ok {4}|FAIL {2})\S/)
  }, 90_000)

  it('doctor on a lab with a working venv ends on mode: FULL', () => {
    const r = startMjs(['doctor'], baseEnv({ NQT_LAB_ROOT: labWithPython(PYTHON_OK) }))
    const lines = r.stdout.trim().split('\n')
    expect(lines).toContain(`ok    nq_lab imports in the venv`)
    expect(lines[lines.length - 1]).toBe('mode: FULL (venv python with fastapi, uvicorn and nq_lab). Next: ./start.sh')
  }, 90_000)

  /** Runs the launcher as a real process and collects what it printed. */
  function runLauncher(args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
    return new Promise<Ran>((resolve) => {
      const child = spawn(NODE24, [START_MJS, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      child.on('close', (status) => resolve({ status, stdout, stderr }))
    })
  }

  it('attaches to the backend the lock names: prints a one-time session link made with the token, and starts nothing', async () => {
    const marker = join(tmp(), 'backend-started')
    const lab = labWithPython(`case "$1" in -m) : > "${marker}";; esac\nexit 0`)
    const token = newToken()
    const code = 'cd'.repeat(32)
    const authorisations: Array<string | undefined> = []
    let port = 0
    const stub = await listen((req, res) => {
      authorisations.push(req.headers.authorization)
      const url = new URL(req.url ?? '', 'http://x')
      res.setHeader('content-type', 'application/json')
      if (url.pathname === '/api/desktop/proof') {
        res.end(JSON.stringify({ proof: mac(token, 'proof', url.searchParams.get('nonce') ?? '', port, process.pid), pid: process.pid }))
      } else if (url.pathname === '/api/session/code' && req.headers.authorization === `NQT ${token}`) {
        res.end(JSON.stringify({ code, expires_in_s: 60 }))
      } else {
        res.statusCode = 401
        res.end('{}')
      }
    })
    port = stub.port
    const state = tmp('nqt-state-')
    const lock = join(state, 'backend.lock')
    writeFileSync(lock, JSON.stringify({ v: 1, pid: process.pid, port, token, root: ROOT, started: 'now' }), { mode: 0o600 })
    chmodSync(lock, 0o600)
    try {
      const r = await runLauncher(['--no-browser', '--port', String(port)], baseEnv({ NQT_LAB_ROOT: lab, NQT_STATE_DIR: state }))
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain(`The terminal already runs on http://127.0.0.1:${port}/; nothing started.`)
      expect(r.stdout).toContain(`browser: not opened (http://127.0.0.1:${port}/session.html#${code})`)
      expect(r.stdout).not.toContain(token)
      expect(existsSync(marker)).toBe(false)
      // The proof came first: every request before the code request carried no token.
      expect(authorisations.filter((a) => a !== undefined)).toEqual([`NQT ${token}`])
    } finally {
      await closeServer(stub.server)
    }
  }, 60_000)

  it('refuses a terminal on the port that has no lock: an older version cannot be attached to, and nothing starts', async () => {
    const marker = join(tmp(), 'backend-started')
    const lab = labWithPython(`case "$1" in -m) : > "${marker}";; esac\nexit 0`)
    const stub = await listen((req, res) => {
      res.end(req.url === '/api/health' ? '{"fence":"ok"}' : 'x')
    })
    try {
      const r = await runLauncher(['--no-browser', '--port', String(stub.port)], baseEnv({ NQT_LAB_ROOT: lab, NQT_STATE_DIR: tmp('nqt-state-') }))
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('no lock file or token')
      expect(r.stdout).not.toContain('session.html')
      expect(existsSync(marker)).toBe(false)
    } finally {
      await closeServer(stub.server)
    }
  }, 60_000)
})

describe.skipIf(WINDOWS)('start.sh', () => {
  const text = readFileSync(START_SH, 'utf8')

  it('is POSIX sh, ASCII, LF only, and executable', () => {
    expect(text.startsWith('#!/bin/sh\n')).toBe(true)
    expect(text).toMatch(/^set -eu$/m)
    expect(text).not.toContain('\r')
    expect([...text].filter((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n'))).toEqual([])
    expect(statSync(START_SH).mode & 0o111).toBe(0o111)
    expect(text).not.toContain('[[')
    expect(text).not.toMatch(/\becho -e\b|\bfunction\b|\bsource\b/)
    expect(text).not.toContain('0.0.0.0')
  })

  it('runs scripts/start.mjs with the given arguments through exec, quoting every path', () => {
    expect(text).toContain('node=${NQT_NODE:-node}')
    expect(text).toContain('exec "$node" "$here/scripts/start.mjs" "$@"')
    // CDPATH cleared for this cd: with CDPATH set, cd prints the folder it found, and `here` would hold it twice.
    expect(text).toContain('here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)')
  })

  it('finds its own folder when CDPATH is exported and it is run by a relative path', () => {
    // From the folder above the terminal, `sh <name>/start.sh`: dirname gives a bare name, which cd looks up in
    // CDPATH and then prints. Born failing with a plain `cd`: `here` held the path twice and Node found no module.
    const r = spawnSync('sh', [join(basename(ROOT), 'start.sh'), '--help'], {
      cwd: dirname(ROOT),
      encoding: 'utf8',
      env: baseEnv({ CDPATH: '.', NQT_NODE: NODE24 }),
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage: ./start.sh [doctor] [options]')
  })

  it('names the way out when Node is missing', () => {
    expect(text).toContain('command -v "$node"')
    expect(text).toContain('NQT_NODE')
    expect(text).toMatch(/exit 1/)
  })

  it('runs the launcher when executed directly, with the arguments passed through', () => {
    const r = run(START_SH, ['--dry-run', '--no-browser', '--demo'], baseEnv({ NQT_NODE: NODE24, NQT_LAB_ROOT: tmp('nqt-lab-') }))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('mode: DEMO ONLY (--demo)')
  })

  it('refuses in one line when NQT_NODE names nothing runnable', () => {
    const r = run('sh', [START_SH, '--dry-run'], baseEnv({ NQT_NODE: '/nonexistent/node' }))
    expect(r.status).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr.trim().split('\n')).toHaveLength(1)
    expect(r.stderr).toContain('NQT_NODE')
    expect(r.stderr).toContain('/nonexistent/node')
  })

  it('keeps a folder name with a space in one piece', () => {
    const home = tmp('nqt-space-')
    const spaced = join(home, 'a b')
    mkdirSync(join(spaced, 'scripts'), { recursive: true })
    copyFileSync(START_SH, join(spaced, 'start.sh'))
    chmodSync(join(spaced, 'start.sh'), 0o755)
    copyFileSync(START_MJS, join(spaced, 'scripts', 'start.mjs'))
    symlinkSync(WEB.replace(/[\\/]$/, ''), join(spaced, 'web'))
    const r = run('sh', [join(spaced, 'start.sh'), '--dry-run', '--no-browser', '--demo'], baseEnv({ NQT_NODE: NODE24 }))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`root: ${spaced}`)
    expect(r.stdout).toContain(`"${join(spaced, 'web', 'node_modules', 'vite', 'bin', 'vite.js')}"`)
  })
})

describe('scripts/start.mjs and nodeGuard.mjs: the files that must run on an old Node', () => {
  const files = { 'scripts/start.mjs': readFileSync(START_MJS, 'utf8'), 'nodeGuard.mjs': readFileSync(join(WEB, 'scripts', 'start', 'nodeGuard.mjs'), 'utf8') }

  it('are ASCII with LF only', () => {
    for (const text of Object.values(files)) {
      expect(text).not.toContain('\r')
      expect([...text].filter((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n'))).toEqual([])
    }
  })

  it('import only Node built-ins and the guard, and reach the launcher by a dynamic import', () => {
    const specifiers = (text: string): string[] => [...text.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1] ?? '')
    expect(specifiers(files['scripts/start.mjs']).filter((spec) => !spec.startsWith('node:'))).toEqual(['../web/scripts/start/nodeGuard.mjs'])
    expect(specifiers(files['nodeGuard.mjs']).filter((spec) => !spec.startsWith('node:'))).toEqual([])
    expect(files['scripts/start.mjs']).toContain("await import('../web/scripts/start/launcher.ts')")
    expect(files['nodeGuard.mjs']).not.toContain('launcher.ts')
  })

  it('hold no TypeScript-only syntax, which an old Node cannot read', () => {
    const typescriptOnly = [
      /\bimport type\b|^\s*(export )?(interface|enum|type) \w+/m,
      /\)\s*:\s*(string|number|boolean|void|null|unknown)\s*(\{|=>)|\bas (const|string|number|unknown)\b|: (string|number|boolean)\[\]/,
    ]
    for (const text of Object.values(files)) {
      for (const pattern of typescriptOnly) expect(text).not.toMatch(pattern)
    }
    // Born failing: each form is caught when planted, and a plain ternary is not.
    const planted = ['import type { A } from "x"', 'interface A { b: 1 }', 'function f(x): string {', 'const y = z as unknown', 'let a: string[] = []']
    for (const line of planted) expect(typescriptOnly.some((pattern) => pattern.test(line))).toBe(true)
    expect(typescriptOnly.some((pattern) => pattern.test('return ok ? run.stdout.trim() : null'))).toBe(false)
  })
})

// An older Node than the terminal needs, if this machine has one: the guard must switch or refuse.
function findOldNode(): string | null {
  const found = ['/opt/homebrew/opt/node@20/bin/node', '/opt/homebrew/opt/node@22/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const path of found) {
    if (!existsSync(path)) continue
    const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 5000 })
    const major = /^v(\d+)\./.exec(r.stdout ?? '')?.[1]
    if (major !== undefined && Number(major) < 24) return path
  }
  return null
}
const OLD_NODE = findOldNode()

describe.runIf(OLD_NODE !== null)('scripts/start.mjs under an older Node', () => {
  const old = OLD_NODE ?? ''

  it('switches to a Node that is new enough, says so in one line, and carries on', () => {
    const r = startMjs(['--dry-run', '--no-browser'], baseEnv({ NQT_NODE: NODE24, NQT_LAB_ROOT: tmp('nqt-lab-') }), old)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toMatch(new RegExp(`^start: Node \\d+\\.\\d+\\.\\d+ is too old for this terminal; using Node ${process.versions.node.replace(/\./g, '\\.')} at `))
    expect(lines[0]?.endsWith(NODE24)).toBe(true)
    expect(lines).toContain('mode: DEMO ONLY (nq_lab not found)')
  })

  it('passes the exit code of the switched run through', () => {
    const r = startMjs(['--bogus'], baseEnv({ NQT_NODE: NODE24 }), old)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--bogus')
    expect(r.stdout).toContain('is too old for this terminal')
  })

  it('refuses in plain words when switching is off, and never starts the launcher', () => {
    const r = startMjs(['--dry-run'], baseEnv({ NQT_NODE: NODE24, NQT_NODE_SWITCH: 'off' }), old)
    expect(r.status).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/is too old: this terminal needs Node 24 or later/)
    expect(r.stderr).toContain('ERR_UNKNOWN_BUILTIN_MODULE')
    expect(r.stderr).toContain('NQT_NODE')
    expect(r.stderr).not.toContain('mode:')
  })
})

// ------------------------------------------------------------------ live runs against fakes

const FAKE_VITE = `
import http from 'node:http'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
// The test keeps FAKE_ALIVE_FILE while it runs and removes it when it is over (pass, fail or timeout), and
// these fakes exit once it is gone, so a failing run leaves nothing behind.
const watch = "setInterval(() => { if (!require('node:fs').existsSync(process.env.FAKE_ALIVE_FILE)) process.exit(0) }, 200)"
setInterval(() => { if (!fs.existsSync(process.env.FAKE_ALIVE_FILE)) process.exit(0) }, 200)
const grandchild = spawn(process.execPath, ['-e', watch], { stdio: 'ignore' })
fs.writeFileSync(process.env.FAKE_PID_FILE, String(grandchild.pid))
if (process.env.FAKE_IGNORE_TERM === '1') process.on('SIGTERM', () => {})
if (process.env.FAKE_EXIT_CODE) process.exit(Number(process.env.FAKE_EXIT_CODE))
if (process.env.FAKE_NO_LISTEN === '1') setInterval(() => {}, 1000)
else http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<div id="root"></div>') }).listen(port, '127.0.0.1')
`

const FAKE_BACKEND = `
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import readline from 'node:readline'
const port = Number(process.env.NQT_PORT)
setInterval(() => { if (!fs.existsSync(process.env.FAKE_ALIVE_FILE)) process.exit(0) }, 200)
fs.writeFileSync(process.env.FAKE_ENV_FILE, JSON.stringify({
  NQT_PORT: process.env.NQT_PORT, PYTHONUTF8: process.env.PYTHONUTF8, PYTHONIOENCODING: process.env.PYTHONIOENCODING,
  NQT_STDIN_CONTROL: process.env.NQT_STDIN_CONTROL ?? null,
  NQT_FIXTURE_DIR: process.env.NQT_FIXTURE_DIR ?? null, cwd: process.cwd(),
}))
// TOKEN and NONCE arrive once on the input; end of file means the parent is gone, as in the real backend.
const values = {}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const found = /^(TOKEN|NONCE) ([0-9a-f]{64})$/.exec(line)
  if (found && !(found[1] in values)) values[found[1]] = found[2]
})
process.stdin.on('end', () => { fs.writeFileSync(process.env.FAKE_EOF_FILE, 'eof'); process.exit(0) })
const sign = (kind, nonce) => crypto.createHmac('sha256', Buffer.from(values.TOKEN, 'hex')).update(kind + '|' + nonce + '|' + port + '|' + process.pid, 'ascii').digest('hex')
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/api/desktop/proof' && values.TOKEN) { res.end(JSON.stringify({ proof: sign('proof', url.searchParams.get('nonce')), pid: process.pid })); return }
  if (url.pathname === '/api/session/code' && values.TOKEN && req.headers.authorization === 'NQT ' + values.TOKEN) { res.end(JSON.stringify({ code: 'ab'.repeat(32), expires_in_s: 60 })); return }
  res.statusCode = 404
  res.end('{}')
}).listen(port, '127.0.0.1')
`

/** A terminal folder with a fake Vite and an empty backend folder, so nothing real is started. */
function fakeTerminal(): string {
  const dir = terminalWith({ 'node_modules/vite/bin/vite.js': null })
  writeFileSync(join(dir, 'web', 'node_modules', 'vite', 'bin', 'vite.js'), FAKE_VITE)
  mkdirSync(join(dir, 'backend'), { recursive: true })
  return dir
}

interface Driver {
  readonly child: ChildProcess
  readonly out: () => string
  readonly err: () => string
  readonly exited: Promise<number | null>
  /** Ends the test's fakes and the driver, whatever state they are in. */
  readonly dispose: () => void
}

/** Runs main() in a child Node, so its signal handlers and process groups are the real ones. */
function drive(argv: string[], terminalDir: string, env: NodeJS.ProcessEnv, extraCtx = ''): Driver {
  const source =
    `import { main } from ${JSON.stringify(LAUNCHER_URL)}\n` +
    `process.exitCode = await main(${JSON.stringify(argv)}, { terminalDir: ${JSON.stringify(terminalDir)}${extraCtx} })\n`
  const aliveFile = join(tmp(), 'alive')
  writeFileSync(aliveFile, 'alive')
  const child = spawn(NODE24, ['--input-type=module', '-e', source], { env: { ...env, FAKE_ALIVE_FILE: aliveFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
  const dispose = (): void => {
    rmSync(aliveFile, { force: true })
    child.kill('SIGKILL')
  }
  const driver: Driver = { child, out: () => out, err: () => err, exited, dispose }
  drivers.push(driver)
  return driver
}

async function portRefuses(port: number): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    const status = await getStatus(port)
    if (status === null) return true
    await sleep(100)
  }
  return false
}

describe.skipIf(WINDOWS)('a live run: Ctrl+C leaves nothing behind', () => {
  it('serves the demo, then stops the whole process group on SIGINT', async () => {
    const dir = fakeTerminal()
    const pidFile = join(tmp(), 'grandchild.pid')
    const port = await freePort()
    const driver = drive(['--demo', '--no-browser', '--port', String(port)], dir, baseEnv({ FAKE_PID_FILE: pidFile, NQT_LAB_ROOT: tmp('nqt-lab-') }))
    try {
      await waitFor('the launcher to report it is running', () => driver.out().includes('Running. Press Ctrl+C to stop.'))
      expect(driver.out()).toContain(`http://127.0.0.1:${port}/`)
      expect(await getStatus(port)).toBe(200)
      const grandchild = Number(readFileSync(pidFile, 'utf8'))
      expect(isAlive(grandchild)).toBe(true)

      driver.child.kill('SIGINT')
      expect(await within('the launcher to exit', driver.exited)).toBe(130)
      expect(driver.out()).toContain('Stopping')
      expect(await portRefuses(port)).toBe(true)
      await waitFor('the grandchild to be gone', () => !isAlive(grandchild), 5000)
    } finally {
      driver.dispose()
    }
  }, 60_000)

  it('escalates to SIGKILL for a child that ignores SIGTERM', async () => {
    const dir = fakeTerminal()
    const pidFile = join(tmp(), 'grandchild.pid')
    const port = await freePort()
    const driver = drive(['--demo', '--no-browser', '--port', String(port)], dir, baseEnv({ FAKE_PID_FILE: pidFile, FAKE_IGNORE_TERM: '1' }))
    try {
      await waitFor('the launcher to report it is running', () => driver.out().includes('Running.'))
      const grandchild = Number(readFileSync(pidFile, 'utf8'))
      const started = Date.now()
      driver.child.kill('SIGTERM')
      expect(await within('the launcher to exit', driver.exited)).toBe(143)
      expect(Date.now() - started).toBeGreaterThanOrEqual(2500)
      expect(await portRefuses(port)).toBe(true)
      await waitFor('the grandchild to be gone', () => !isAlive(grandchild), 5000)
    } finally {
      driver.dispose()
    }
  }, 60_000)

  it('stops with the exit code and cleans up when a child dies before it answers', async () => {
    const dir = fakeTerminal()
    const pidFile = join(tmp(), 'grandchild.pid')
    const port = await freePort()
    const driver = drive(['--demo', '--no-browser', '--port', String(port)], dir, baseEnv({ FAKE_PID_FILE: pidFile, FAKE_EXIT_CODE: '3' }))
    try {
      expect(await within('the launcher to exit', driver.exited)).toBe(1)
      expect(driver.err()).toContain('serve the demo exited with code 3')
      expect(driver.out()).not.toContain('Running.')
      await waitFor('the grandchild to be gone', () => !isAlive(Number(readFileSync(pidFile, 'utf8'))), 5000)
    } finally {
      driver.dispose()
    }
  }, 60_000)

  it('gives up with a clear message when the server never answers', async () => {
    const dir = fakeTerminal()
    const pidFile = join(tmp(), 'grandchild.pid')
    const port = await freePort()
    const driver = drive(['--demo', '--no-browser', '--port', String(port)], dir, baseEnv({ FAKE_PID_FILE: pidFile, FAKE_NO_LISTEN: '1' }), ', startupMs: 1500')
    try {
      expect(await within('the launcher to exit', driver.exited)).toBe(1)
      expect(driver.err()).toContain('serve the demo did not answer')
      await waitFor('the grandchild to be gone', () => !isAlive(Number(readFileSync(pidFile, 'utf8'))), 5000)
    } finally {
      driver.dispose()
    }
  }, 60_000)

  it('runs the backend behind the token: allow-listed environment, TOKEN and NONCE on its input, a session link, and the input closed first on SIGINT', async () => {
    const dir = fakeTerminal()
    const work = tmp('nqt-fake-')
    const serve = join(work, 'serve.mjs')
    const envFile = join(work, 'env.json')
    const eofFile = join(work, 'eof')
    writeFileSync(serve, FAKE_BACKEND)
    // The fake python answers the allow-list question with its own environment (the identity list) and runs the fake backend for -m.
    const lab = labWithPython(
      `case "$*" in *backend_env*) exec "${NODE24}" -e "process.stdout.write(JSON.stringify(process.env) + '\\n')";; esac\n` +
        `case "$1" in -m) exec "${NODE24}" "${serve}";; esac\nexit 0`,
    )
    const fixtures = tmp('nqt-fx-')
    const port = await freePort()
    const driver = drive(
      ['--no-browser', '--no-build', '--port', String(port)],
      dir,
      baseEnv({ NQT_LAB_ROOT: lab, NQT_FIXTURE_DIR: fixtures, NQT_STATE_DIR: tmp('nqt-state-'), FAKE_ENV_FILE: envFile, FAKE_EOF_FILE: eofFile }),
    )
    try {
      await waitFor('the launcher to report it is running', () => driver.out().includes('Running.'))
      expect(driver.out()).toContain(`nq-lab terminal: http://127.0.0.1:${port}/ (read only)`)
      expect(driver.out()).toContain(`browser: not opened (http://127.0.0.1:${port}/session.html#${'ab'.repeat(32)})`)
      const seen = JSON.parse(readFileSync(envFile, 'utf8')) as Record<string, string | null>
      expect(seen).toEqual({
        NQT_PORT: String(port),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        NQT_STDIN_CONTROL: '1',
        NQT_FIXTURE_DIR: fixtures,
        cwd: realpathSync(join(dir, 'backend')),
      })
      expect(existsSync(eofFile)).toBe(false)
      driver.child.kill('SIGINT')
      expect(await within('the launcher to exit', driver.exited)).toBe(130)
      expect(existsSync(eofFile), 'the backend saw its input close').toBe(true)
      expect(await portRefuses(port)).toBe(true)
    } finally {
      driver.dispose()
    }
  }, 60_000)
})
