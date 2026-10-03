// Launching the hidden smoke build for the desktop end-to-end project (03 section 15.4; 04 D5.2), and ending it.
// Plain erasable TypeScript, so Playwright's loader and Node 24 itself (served-session.ts) read the same file.
//
// Every launch follows the launch prelude: the smoke exe with a PATH that has neither D:/dev/mingw nor D:/dev/cargo (a
// hidden MinGW runtime dependency fails here), no WEBVIEW2_* variable, windowsHide, its output in files, a profile
// folder, a config folder, a state folder and a save folder of this run's own under D:/dev/d5. The window is never
// shown (the shell makes the page visible behind the hidden window), nothing here takes focus, and the tree this file
// started is the only thing it ends. The debugging port is 0: the engine picks one and writes DevToolsActivePort.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OWNER_PORT = 8765
export const SMOKE_BUILD_HINT = 'cargo tauri build --no-bundle --features smoke --config src-tauri\\tauri.smoke.conf.json -- --locked'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The terminal folder of this checkout (web/e2e/desktop up three). */
export const TERMINAL_DIR = path.resolve(HERE, '..', '..', '..')
const RUNS_ROOT_DEFAULT = 'D:/dev/d5/app'
const DEVTOOLS_WAIT_MS = 60_000
const PAGE_WAIT_MS = 120_000
const STOP_WAIT_MS = 15_000

/** The folder every artefact of the desktop project lives under (D: only; never the repository, never C:). */
export function runsRoot(): string {
  return path.resolve(process.env.NQT_APP_RUNS ?? RUNS_ROOT_DEFAULT)
}

export interface LaunchOptions {
  /** The smoke exe. */
  readonly exe: string
  /** `--fixture`: the fixture backend through the full handshake. Without it the backend is the real one (`--lab`). */
  readonly fixture: boolean
  /** The lab folder (`.venv`, `src`, `terminal`). */
  readonly lab: string
  readonly runDir: string
  /** `<width>x<height>`; the shell keeps a test build's exact size. */
  readonly size?: string
  readonly zoom?: number
  readonly extraArgs?: readonly string[]
}

export interface AppHandle {
  readonly pid: number
  readonly runDir: string
  readonly devtoolsPort: number
  readonly cdpUrl: string
  /** The origin of the backend page the shell loaded. */
  readonly origin: string
  readonly saveDir: string
  readonly stateDir: string
  readonly configDir: string
  readonly webviewDir: string
  readonly stop: () => Promise<StopReport>
}

export interface StopReport {
  /** The pid the backend's lock named, when it could be read. */
  readonly backendPid: number | null
  /** True when that process is gone after the shell's tree was ended. */
  readonly backendGone: boolean
}

/** The launch prelude's PATH: no build tools. */
export function cleanPath(path_: string | undefined): string {
  return (path_ ?? '')
    .split(';')
    .filter((p) => p !== '' && !/^d:[\\/]dev[\\/](mingw|cargo)/i.test(p))
    .join(';')
}

/** The environment of a shell launch: this process's, with the clean PATH and no WEBVIEW2_* name. */
export function launchEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(parent)) {
    if (name.toUpperCase().startsWith('WEBVIEW2_')) continue
    env[name] = value
  }
  const pathName = Object.keys(env).find((n) => n.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathName] = cleanPath(env[pathName])
  return env
}

/** The smoke exe: NQT_SMOKE_EXE, else the newest build in the usual target folders. */
export function findSmokeExe(): string {
  const named = process.env.NQT_SMOKE_EXE
  if (named !== undefined && named !== '') {
    if (!fs.existsSync(named)) throw new Error(`NQT_SMOKE_EXE does not exist: ${named}`)
    return named
  }
  const candidates = ['D:/dev/targets/w5a-app-smoke/release/nq-lab-terminal.exe', 'D:/dev/targets/smoke/release/nq-lab-terminal.exe']
  const found = candidates.find((c) => fs.existsSync(c))
  if (found === undefined) throw new Error(`no smoke build: set NQT_SMOKE_EXE, or build one with: ${SMOKE_BUILD_HINT} (CARGO_TARGET_DIR under D:/dev/targets)`)
  return found
}

const isLab = (dir: string): boolean =>
  fs.existsSync(path.join(dir, '.venv', 'Scripts', 'python.exe')) && fs.existsSync(path.join(dir, 'src', 'nq_lab', 'config.py'))

/** `terminal` is a directory junction to this checkout; a junction that points elsewhere is replaced. */
function linkTerminal(lab: string): void {
  const link = path.join(lab, 'terminal')
  const present = fs.existsSync(link) && fs.realpathSync(link).toLowerCase() === fs.realpathSync(TERMINAL_DIR).toLowerCase()
  if (present) return
  if (fs.lstatSync(link, { throwIfNoEntry: false }) !== undefined) fs.rmSync(link, { recursive: false, force: true })
  fs.symlinkSync(TERMINAL_DIR, link, 'junction')
}

/**
 * The backend names the lab it serves by `nq_lab.config.ROOT`, which follows the package's own location, and the shell
 * refuses a backend whose root is not the picked lab. A checkout outside the real lab therefore needs an `nq_lab` of its
 * own location: a copy of the package under `<lab>/src`, and a small venv at `<lab>/.venv` (made by the real lab's
 * interpreter, no pip) whose .pth puts that copy first and then adds the real venv's packages. Nothing is installed.
 */
function buildWorktreeLab(real: string, lab: string): void {
  fs.mkdirSync(lab, { recursive: true })
  const copy = path.join(lab, 'src', 'nq_lab')
  if (!fs.existsSync(path.join(copy, 'config.py'))) {
    fs.cpSync(path.join(real, 'src', 'nq_lab'), copy, { recursive: true, filter: (from) => !from.includes('__pycache__') })
  }
  const venv = path.join(lab, '.venv')
  if (!fs.existsSync(path.join(venv, 'Scripts', 'python.exe'))) {
    execFileSync(path.join(real, '.venv', 'Scripts', 'python.exe'), ['-m', 'venv', '--without-pip', venv], { stdio: 'ignore', windowsHide: true })
  }
  const site = path.join(real, '.venv', 'Lib', 'site-packages')
  const pth = `${path.join(lab, 'src')}\nimport site; site.addsitedir(r'${site}')\n`
  fs.writeFileSync(path.join(venv, 'Lib', 'site-packages', 'nqt-lab.pth'), pth)
  linkTerminal(lab)
}

/**
 * The lab the shell is pointed at. When this checkout is the real lab's own `terminal` folder, that is the lab. A checkout
 * elsewhere (a worktree) gets a lab of its own under the runs root (buildWorktreeLab), so the backend the shell spawns and
 * the fixtures it reads are this checkout's, not the main tree's. NQT_APP_LAB names a lab explicitly.
 */
export function resolveLab(): string {
  const named = process.env.NQT_APP_LAB
  if (named !== undefined && named !== '') return path.resolve(named)
  const parent = path.dirname(TERMINAL_DIR)
  if (isLab(parent) && path.basename(TERMINAL_DIR) === 'terminal') return parent
  const real = process.env.NQT_REAL_LAB ?? path.join(process.env.USERPROFILE ?? '', 'nq-lab')
  if (!isLab(real)) throw new Error(`no real lab to borrow the interpreter and packages from: ${real} (set NQT_REAL_LAB)`)
  const lab = path.join(runsRoot(), 'lab')
  buildWorktreeLab(real, lab)
  return lab
}

const RUN_NAME = /^[a-z-]+-\d{8}-\d{6}-\d+$/
const RUN_KEEP_MS = 24 * 3_600_000

/** Removes this tool's own run folders (by name, under the runs root) that are more than a day old; nothing else. */
function pruneOldRuns(runs: string): void {
  let names: string[] = []
  try {
    names = fs.readdirSync(runs)
  } catch {
    return
  }
  for (const name of names) {
    const dir = path.join(runs, name)
    try {
      if (RUN_NAME.test(name) && Date.now() - fs.statSync(dir).mtimeMs > RUN_KEEP_MS) fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // in use or already gone: left for the next run
    }
  }
}

/** A fresh run folder under the runs root. */
export function newRunDir(tag: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  pruneOldRuns(path.join(runsRoot(), 'runs'))
  const dir = path.join(runsRoot(), 'runs', `${tag}-${stamp}-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function readFirstLine(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]?.trim() ?? null
  } catch {
    return null
  }
}

/** True when the process is alive (signal 0 probes without sending). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitFor<T>(what: string, ms: number, probe: () => T | null | Promise<T | null>, dead: () => string | null): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await probe()
    if (value !== null) return value
    const gone = dead()
    if (gone !== null) throw new Error(`${what}: the shell ${gone} before it was ready`)
    if (Date.now() > end) throw new Error(`${what}: not ready within ${ms / 1000} s`)
    await sleep(200)
  }
}

interface Target {
  readonly type: string
  readonly url: string
  readonly webSocketDebuggerUrl?: string
}

/** The page targets the engine lists on its debugging port. */
export async function listTargets(port: number): Promise<Target[]> {
  const reply = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await reply.json()) as Target[]
}

/** The origin of the backend page: a page target on 127.0.0.1 that is not the debugging port and never the owner's. */
async function backendOrigin(devtoolsPort: number): Promise<string | null> {
  try {
    for (const t of await listTargets(devtoolsPort)) {
      if (t.type !== 'page') continue
      const match = /^(http:\/\/127\.0\.0\.1:(\d+))\//.exec(t.url)
      if (match === null) continue
      const port = Number(match[2])
      if (port !== devtoolsPort && port !== OWNER_PORT) return match[1] ?? null
    }
  } catch {
    // the engine is not answering yet
  }
  return null
}

function folders(runDir: string): { saveDir: string; stateDir: string; configDir: string; webviewDir: string } {
  const sub = (name: string): string => {
    const dir = path.join(runDir, name)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  return { saveDir: sub('save'), stateDir: sub('state'), configDir: sub('config'), webviewDir: sub('wv') }
}

/** Every switch of a launch, in the order the shell's parser takes them (each at most once). */
export function launchArgs(options: LaunchOptions, dirs: ReturnType<typeof folders>): string[] {
  const args = ['--webview-data-dir', dirs.webviewDir, '--config-dir', dirs.configDir, '--state-dir', dirs.stateDir, '--save-dir', dirs.saveDir, '--lab', options.lab]
  if (options.fixture) args.push('--fixture')
  if (options.size !== undefined) args.push('--size', options.size)
  if (options.zoom !== undefined) args.push('--zoom', String(options.zoom))
  args.push('--remote-debugging-port', '0', ...(options.extraArgs ?? []))
  return args
}

/** Ends a process tree this module started (taskkill /T), with no window. */
export function killTree(pid: number): void {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // already gone
  }
}

/**
 * Ends the tree of a child this run spawned, but only while the child has not exited. Node holds the child's handle until its
 * exit event, so before then the pid is surely ours; after it the number may belong to an unrelated process, and a bare probe of
 * the number (alive) cannot tell, so the tree kill (taskkill /T) would end that stranger's tree. Returns whether a kill was sent.
 */
export function endOwnedTree(pid: number, hasExited: () => boolean, { kill = killTree, probe = alive }: { kill?: (pid: number) => void; probe?: (pid: number) => boolean } = {}): boolean {
  if (hasExited() || !probe(pid)) return false
  kill(pid)
  return true
}

function backendPidOf(stateDir: string): number | null {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(stateDir, 'backend.lock'), 'utf8')) as { pid?: unknown }
    return typeof lock.pid === 'number' ? lock.pid : null
  } catch {
    return null
  }
}

interface Shell {
  readonly pid: number
  /** Why the shell is gone ("exited with code N"), or null while it runs. */
  readonly gone: () => string | null
}

/** Starts the smoke exe with the launch prelude (clean PATH, no WEBVIEW2_*, no window) and its output in files. */
function spawnShell(options: LaunchOptions, dirs: ReturnType<typeof folders>): Shell {
  const out = fs.openSync(path.join(options.runDir, 'shell.out.log'), 'w')
  const err = fs.openSync(path.join(options.runDir, 'shell.err.log'), 'w')
  const child = spawn(options.exe, launchArgs(options, dirs), { env: launchEnv(process.env), stdio: ['ignore', out, err], windowsHide: true, detached: false })
  fs.closeSync(out)
  fs.closeSync(err)
  if (child.pid === undefined) throw new Error('the smoke exe did not start')
  let exited: string | null = null
  child.once('exit', (code) => { exited = `exited with code ${code}` })
  return { pid: child.pid, gone: () => exited }
}

/** Ends the shell's tree (and only that) and waits for the backend named in the state folder's lock to be gone. */
function stopper(shell: Shell, stateDir: string): () => Promise<StopReport> {
  return async () => {
    const pid = shell.pid
    const backendPid = backendPidOf(stateDir)
    endOwnedTree(pid, () => shell.gone() !== null)
    const end = Date.now() + STOP_WAIT_MS
    while (Date.now() < end && ((backendPid !== null && alive(backendPid)) || alive(pid))) await sleep(200)
    return { backendPid, backendGone: backendPid === null || !alive(backendPid) }
  }
}

/** Starts the smoke exe hidden and waits until it has a debugging port and a backend page. */
export async function launchApp(options: LaunchOptions): Promise<AppHandle> {
  if (!fs.existsSync(options.exe)) throw new Error(`the smoke exe is missing: ${options.exe}`)
  const dirs = folders(options.runDir)
  const shell = spawnShell(options, dirs)
  const stop = stopper(shell, dirs.stateDir)
  try {
    const portFile = path.join(dirs.webviewDir, 'EBWebView', 'DevToolsActivePort')
    const devtoolsPort = await waitFor('DevToolsActivePort', DEVTOOLS_WAIT_MS, () => {
      const port = Number(readFirstLine(portFile))
      return Number.isInteger(port) && port > 0 && port !== OWNER_PORT ? port : null
    }, shell.gone)
    const origin = await waitFor('the backend page', PAGE_WAIT_MS, () => backendOrigin(devtoolsPort), shell.gone)
    return { pid: shell.pid, runDir: options.runDir, devtoolsPort, cdpUrl: `http://127.0.0.1:${devtoolsPort}`, origin, ...dirs, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
