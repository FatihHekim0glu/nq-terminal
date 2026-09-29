// What ./start.sh needs to know about this machine: the venv python and what it imports, the web dependencies,
// corepack, a browser for Playwright, the three fixed ports and any port asked for, whether the API types match
// the contract, and whether web/dist is older than the sources (the rule start.ps1 uses). Every subprocess is
// an argv array run without a shell with a timeout; every network call is a GET to 127.0.0.1 and nothing else.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { get } from 'node:http'
import net from 'node:net'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { requiredMajor } from './nodeGuard.mjs'
import { BACKEND_PORT, DEMO_PORT, DEV_PORT, FENCE, LOOPBACK, type Facts, type PortState } from './plan.ts'

const IMPORT_TIMEOUT_MS = 20_000
const CONTRACT_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 500
const HEALTH_TIMEOUT_MS = 3000
const BODY_LIMIT = 65_536
const DEFAULT_REQUIRED_NODE = 24

/** The build inputs start.ps1 watches besides web/src and web/public. */
const BUILD_INPUTS = ['index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json']
/** Source files that do not go into the build (start.ps1: names holding .test. or .gallery.). */
const NOT_BUILT = /\.(test|gallery)\./

export interface FactsInput {
  readonly terminalDir: string
  /** The environment the steps will run in; corepack is looked for on its PATH. */
  readonly env: NodeJS.ProcessEnv
  readonly platform?: string
  /** Ports to read besides 8765, 5173 and 5174. */
  readonly ports?: readonly number[]
  /** Run the (slow) API contract check. Only the doctor needs it. */
  readonly contract?: boolean
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function labRootOf(terminalDir: string, env: NodeJS.ProcessEnv): string {
  const given = env.NQT_LAB_ROOT
  if (given !== undefined && given !== '' && isAbsolute(given) && isDirectory(given)) return resolve(given)
  return dirname(terminalDir)
}

function canImport(python: string, code: string, cwd: string, env: NodeJS.ProcessEnv): boolean {
  const run = spawnSync(python, ['-c', code], { cwd, env, stdio: 'ignore', timeout: IMPORT_TIMEOUT_MS, windowsHide: true })
  return run.status === 0
}

function pythonFacts(terminalDir: string, labRoot: string, platform: string, env: NodeJS.ProcessEnv): Facts['python'] {
  const path = platform === 'win32' ? join(labRoot, '.venv', 'Scripts', 'python.exe') : join(labRoot, '.venv', 'bin', 'python')
  if (!existsSync(path)) return { path, exists: false, fastapi: false, nqLab: false }
  // The backend runs in terminalDir/backend, so the imports are tried from there.
  const backend = join(terminalDir, 'backend')
  const cwd = isDirectory(backend) ? backend : terminalDir
  return {
    path,
    exists: true,
    fastapi: canImport(path, 'import fastapi, uvicorn', cwd, env),
    nqLab: canImport(path, 'import nq_lab.config', cwd, env),
  }
}

function corepackOnPath(env: NodeJS.ProcessEnv): boolean {
  const run = spawnSync('corepack', ['--version'], { env, stdio: 'ignore', timeout: IMPORT_TIMEOUT_MS, windowsHide: true })
  return run.status === 0
}

function browserFacts(web: string, platform: string, env: NodeJS.ProcessEnv): Facts['browser'] {
  const home = env.HOME || homedir()
  const custom = env.PLAYWRIGHT_BROWSERS_PATH
  let cache: string
  if (custom === '0') cache = join(web, 'node_modules', 'playwright-core', '.local-browsers')
  else if (custom !== undefined && custom !== '') cache = custom
  else cache = platform === 'darwin' ? join(home, 'Library', 'Caches', 'ms-playwright') : join(home, '.cache', 'ms-playwright')
  const chromes =
    platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
  return {
    bundled: listDir(cache).some((name) => /^chromium(_headless_shell)?-\d+/.test(name)),
    chrome: chromes.some((path) => existsSync(path)),
  }
}

/** The newest modification time (ms) of the files under `dir`, skipping names `skip` accepts; -Infinity when none. */
function newestUnder(dir: string, skip?: RegExp): number {
  let newest = -Infinity
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestUnder(path, skip))
    else if (entry.isFile() && !(skip?.test(entry.name) ?? false)) newest = Math.max(newest, statSync(path).mtimeMs)
  }
  return newest
}

/** start.ps1's Test-BuildNeeded: web/dist/index.html missing, or older than the newest source. */
function buildNeeded(web: string): boolean {
  let built: number
  try {
    built = statSync(join(web, 'dist', 'index.html')).mtimeMs
  } catch {
    return true
  }
  let newest = -Infinity
  try {
    newest = Math.max(newest, newestUnder(join(web, 'src'), NOT_BUILT))
  } catch {
    // no src folder: nothing to compare
  }
  for (const name of BUILD_INPUTS) {
    try {
      newest = Math.max(newest, statSync(join(web, name)).mtimeMs)
    } catch {
      // an input that is not there does not make the build older
    }
  }
  try {
    newest = Math.max(newest, newestUnder(join(web, 'public')))
  } catch {
    // no public folder
  }
  return newest > built
}

function contractState(web: string, env: NodeJS.ProcessEnv, enabled: boolean): Facts['contract'] {
  const script = join(web, 'src', 'api', 'codegen', 'gen-api.mjs')
  if (!enabled || !existsSync(script)) return 'unknown'
  const run = spawnSync(process.execPath, [script, '--check'], {
    cwd: web,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CONTRACT_TIMEOUT_MS,
    windowsHide: true,
  })
  if (run.status === 0) return 'in sync'
  if (run.status === 1 && /stale/.test(run.stderr)) return 'stale'
  return 'unknown'
}

function requiredNode(web: string): number {
  try {
    const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as { engines?: { node?: string } }
    return requiredMajor(pkg.engines)
  } catch {
    return DEFAULT_REQUIRED_NODE
  }
}

/** A GET to 127.0.0.1 and nothing else. Null when the request fails, times out, is aborted or aims elsewhere. */
export function httpGetLoopback(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly status: number; readonly body: string } | null> {
  return new Promise((resolvePromise) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolvePromise(null)
      return
    }
    if (target.protocol !== 'http:' || target.hostname !== LOOPBACK) {
      resolvePromise(null)
      return
    }
    const request = get(
      target,
      { agent: false, timeout: timeoutMs, signal, headers: { accept: 'text/html,application/json,*/*' } },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (body.length < BODY_LIMIT) body += chunk
        })
        response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, body }))
        response.on('error', () => resolvePromise(null))
      },
    )
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolvePromise(null))
  })
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: LOOPBACK, port })
    const done = (open: boolean): void => {
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 'free' when nothing accepts a connection; 'terminal' when /api/health answers 200 with the fence; else 'busy'. */
export async function portState(port: number): Promise<PortState> {
  if (!(await canConnect(port))) return 'free'
  const reply = await httpGetLoopback(`http://${LOOPBACK}:${port}/api/health`, HEALTH_TIMEOUT_MS)
  return reply !== null && reply.status === 200 && reply.body.includes(FENCE) ? 'terminal' : 'busy'
}

export async function gatherFacts(input: FactsInput): Promise<Facts> {
  const { terminalDir, env } = input
  const platform = input.platform ?? process.platform
  const web = join(terminalDir, 'web')
  const labRoot = labRootOf(terminalDir, env)
  const numbers = [...new Set([BACKEND_PORT, DEV_PORT, DEMO_PORT, ...(input.ports ?? [])])]
  const states = await Promise.all(numbers.map((port) => portState(port)))
  const ports: Record<string, PortState> = {}
  numbers.forEach((port, index) => {
    ports[String(port)] = states[index] ?? 'free'
  })
  return {
    platform,
    requiredNode: requiredNode(web),
    node: { version: process.version, path: process.execPath },
    terminalDir,
    labRoot,
    python: pythonFacts(terminalDir, labRoot, platform, env),
    webDeps: existsSync(join(web, 'node_modules', 'vite', 'bin', 'vite.js')),
    corepack: corepackOnPath(env),
    browser: browserFacts(web, platform, env),
    ports,
    contract: contractState(web, env, input.contract ?? false),
    fixtureDir: env.NQT_FIXTURE_DIR !== undefined && env.NQT_FIXTURE_DIR !== '' ? env.NQT_FIXTURE_DIR : null,
    buildNeeded: buildNeeded(web),
  }
}
