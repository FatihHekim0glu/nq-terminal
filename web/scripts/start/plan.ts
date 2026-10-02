// The launcher's pure planning layer (./start.sh, scripts/start.mjs, launcher.ts): argument parsing, mode
// resolution, and the exact steps each mode runs. Nothing here touches the machine; launcher.ts gathers the
// facts (facts.ts) and runs the steps. The steps mirror start.ps1: the same uvicorn list, the same readiness
// check (the proof route, since every other /api path needs a session) and the same environment. The browser
// door is behind the token: the backend binds 8765 (never port 0, which only a backend the app starts uses), is
// started with TOKEN and NONCE on its input, and the page is opened on a one-time session link. Every step is an
// argv array, never a shell string, and nothing ever binds 0.0.0.0.
import { join } from 'node:path'

export type Command = 'start' | 'doctor' | 'help'
export type ModeChoice = 'auto' | 'demo' | 'full'
export type Mode = 'FULL' | 'FIXTURE' | 'DEMO ONLY'
export type PortState = 'free' | 'terminal' | 'busy'
/**
 * What the lock file of the state folder says: 'none' (no file), 'stale' (its pid is gone), 'live' (a backend that
 * proved itself with a fresh nonce), 'unproven' (alive but could not prove it holds the token), 'untrusted' (the
 * file is not owner-only, so it is not believed).
 */
export type LockState = 'none' | 'stale' | 'live' | 'unproven' | 'untrusted'

export interface LockFact {
  readonly state: LockState
  /** The backend port the lock names, when it was read. */
  readonly port: number | null
}

export interface StartOptions {
  readonly command: Command
  readonly mode: ModeChoice
  readonly dev: boolean
  /** null when --port was not given: the default depends on the mode. */
  readonly port: number | null
  readonly browser: boolean
  readonly build: boolean
  readonly dryRun: boolean
}

export interface Facts {
  readonly platform: string
  /** The Node major web/package.json engines asks for. */
  readonly requiredNode: number
  readonly node: { readonly version: string; readonly path: string }
  readonly terminalDir: string
  readonly labRoot: string
  readonly python: { readonly path: string; readonly exists: boolean; readonly fastapi: boolean; readonly nqLab: boolean }
  readonly webDeps: boolean
  readonly corepack: boolean
  readonly browser: { readonly bundled: boolean; readonly chrome: boolean }
  /** Keyed by port number as text: the three fixed ports plus any port the user asked for. */
  readonly ports: Readonly<Record<string, PortState>>
  readonly contract: 'in sync' | 'stale' | 'unknown'
  readonly fixtureDir: string | null
  readonly buildNeeded: boolean
  /** The folder whose backend.lock names the backend of this lab (NQT_STATE_DIR, else terminal/state). */
  readonly stateDir: string
  readonly lock: LockFact
}

export interface Step {
  readonly what: string
  readonly argv: readonly string[]
  readonly cwd: string
  /** Variables added to the launcher's own environment. */
  readonly env: Readonly<Record<string, string>>
  /** 'exit': runs to completion first. Otherwise a long-running process, ready once the URL answers 200 with `contains`. */
  readonly wait: 'exit' | { readonly url: string; readonly contains: string }
  /** 'control': the process is started with a pipe on its input that the launcher writes TOKEN and NONCE to and keeps open. */
  readonly stdin?: 'control'
  /** The process gets the allow-listed environment of desktop/envlist.py, built with the venv python, not this shell's. */
  readonly allowList?: boolean
}

export interface StartPlan {
  readonly mode: Mode
  readonly reason: string
  readonly dev: boolean
  /** The backend port, or the demo port. */
  readonly port: number
  /** The page to open and to report. */
  readonly url: string
  readonly alreadyRunning: boolean
  readonly install: boolean
  readonly build: 'needed' | 'up to date' | 'skipped' | 'not used'
  readonly steps: readonly Step[]
  /** What would stop a real run. A dry run prints them and still succeeds. */
  readonly blockers: readonly string[]
  /** The live backend the lock names: nothing is started, a launch code is minted for it. */
  readonly attach: { readonly port: number } | null
  /** Where the one-time session page is opened (its origin), and the backend port that issues the code; null for the demo. */
  readonly session: { readonly origin: string; readonly apiPort: number } | null
}

export type ParseResult = { readonly ok: true; readonly options: StartOptions } | { readonly ok: false; readonly error: string }
export type ModeResult =
  | { readonly ok: true; readonly mode: Mode; readonly reason: string }
  | { readonly ok: false; readonly error: string }
export type ResolvedMode = Extract<ModeResult, { ok: true }>

export const LOOPBACK = '127.0.0.1'
export const BACKEND_PORT = 8765
export const DEV_PORT = 5173
export const DEMO_PORT = 5174
export const MIN_PORT = 1024
export const MAX_PORT = 65535
export const FENCE = '"fence"'
export const PAGE_MARKER = 'id="root"'
/** The proof route needs a nonce of 64 hex characters; readiness checks use this one, identity checks a fresh one. */
export const PROBE_NONCE = '0'.repeat(64)
export const PROOF_MARKER = '"proof"'

const PROMPT_OFF: Readonly<Record<string, string>> = { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
const NEEDS_PORT = `--port needs a whole number from ${MIN_PORT} to ${MAX_PORT}`

export function usageLines(): string[] {
  return [
    'Usage: ./start.sh [doctor] [options]',
    '',
    'Starts the nq-lab terminal (read only) on 127.0.0.1.',
    '  ./start.sh          the full terminal when the nq-lab venv is found, otherwise the demo',
    '  ./start.sh doctor   check this machine and say which mode would start',
    '',
    'Options:',
    `  --demo         serve the demo (fixture data answered in the browser) on port ${DEMO_PORT}`,
    '  --full         need the backend (nq_lab in the venv); stop with a message when it is missing',
    `  --dev          backend under uvicorn --reload on ${BACKEND_PORT} plus the Vite dev server on ${DEV_PORT}`,
    `  --port N       port on 127.0.0.1, ${MIN_PORT} to ${MAX_PORT} (default ${BACKEND_PORT}; the demo ${DEMO_PORT})`,
    '  --no-browser   do not open the browser',
    '  --no-build     serve web/dist as it is, even when it is older than the sources',
    '  --dry-run      print the plan and start nothing',
    '  --help         this text',
    '',
    'Environment:',
    '  NQT_NODE            a Node binary to run the launcher with',
    '  NQT_NODE_SWITCH=off do not look for a newer Node when this one is too old',
    '  NQT_LAB_ROOT        the nq-lab folder that holds .venv (default: the folder above this one)',
    '  NQT_FIXTURE_DIR     serve the fixture files in this folder instead of the research files',
    'The backend runs behind a session token: the browser opens on a one-time link (valid for 60 seconds), and',
    '--no-browser prints that link instead. When a backend already holds the lock, it is attached to, not replaced.',
    'Ctrl+C stops everything the launcher started.',
  ]
}

function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return value >= MIN_PORT && value <= MAX_PORT ? value : null
}

export function parseArgs(argv: readonly string[]): ParseResult {
  let command: Command = 'start'
  let commandSeen = false
  let mode: ModeChoice = 'auto'
  let demo = false
  let full = false
  let dev = false
  let port: number | null = null
  let browser = true
  let build = true
  let dryRun = false
  let help = false

  const fail = (error: string): ParseResult => ({ ok: false, error })

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === 'doctor') {
      if (commandSeen) return fail(`unexpected argument "${arg}"`)
      command = 'doctor'
      commandSeen = true
    } else if (arg === 'help' || arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--demo') demo = true
    else if (arg === '--full') full = true
    else if (arg === '--dev') dev = true
    else if (arg === '--no-browser') browser = false
    else if (arg === '--no-build') build = false
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--port' || arg.startsWith('--port=')) {
      const inline = arg.startsWith('--port=')
      const text = inline ? arg.slice('--port='.length) : argv[i + 1]
      if (text === undefined) return fail(`${NEEDS_PORT}; none was given`)
      if (!inline) i += 1
      const value = parsePort(text)
      if (value === null) return fail(`${NEEDS_PORT}; got "${text}"`)
      port = value
    } else if (arg.startsWith('-')) {
      return fail(`unknown option "${arg}"`)
    } else {
      return fail(`unknown argument "${arg}"`)
    }
  }

  if (demo && full) return fail('--demo and --full cannot be combined')
  if (demo && dev) return fail('--demo and --dev cannot be combined')
  if (demo) mode = 'demo'
  if (full) mode = 'full'
  if (help) command = 'help'
  return { ok: true, options: { command, mode, dev, port, browser, build, dryRun } }
}

/** FULL or FIXTURE need the venv python to import fastapi, uvicorn and nq_lab (the backend imports nq_lab even on fixtures). */
function backendReason(facts: Facts): string | null {
  const { python } = facts
  if (!python.exists || !python.nqLab) return 'nq_lab not found'
  if (!python.fastapi) return 'fastapi or uvicorn missing in the venv'
  return null
}

export function resolveMode(options: StartOptions, facts: Facts): ModeResult {
  if (options.mode === 'demo') return { ok: true, mode: 'DEMO ONLY', reason: '--demo' }
  const missing = backendReason(facts)
  if (missing === null) {
    const fixture = facts.fixtureDir !== null
    return {
      ok: true,
      mode: fixture ? 'FIXTURE' : 'FULL',
      reason: `${fixture ? 'NQT_FIXTURE_DIR is set; ' : ''}venv python with fastapi, uvicorn and nq_lab`,
    }
  }
  if (options.mode === 'full' || options.dev) {
    const flag = options.mode === 'full' ? '--full' : '--dev'
    const { python, labRoot } = facts
    const error =
      missing === 'nq_lab not found'
        ? `${flag} needs the backend, but nq_lab was not found: the venv python at ${python.path} ${python.exists ? 'cannot import it' : 'does not exist'}. ` +
          `Set NQT_LAB_ROOT to the nq-lab folder that holds .venv (now ${labRoot}), or leave out ${flag} for the demo.`
        : `${flag} needs the backend, but fastapi or uvicorn cannot be imported by the venv python at ${python.path}. Run uv sync in ${labRoot}.`
    return { ok: false, error }
  }
  return { ok: true, mode: 'DEMO ONLY', reason: missing }
}

function portState(facts: Facts, port: number): PortState {
  return facts.ports[String(port)] ?? 'free'
}

function pageUrl(port: number): string {
  return `http://${LOOPBACK}:${port}/`
}

function originOf(port: number): string {
  return `http://${LOOPBACK}:${port}`
}

function corepackStep(facts: Facts, what: string, args: readonly string[]): Step {
  return { what, argv: ['corepack', 'pnpm', ...args], cwd: join(facts.terminalDir, 'web'), env: PROMPT_OFF, wait: 'exit' }
}

function viteStep(facts: Facts, what: string, args: readonly string[], port: number | null): Step {
  const web = join(facts.terminalDir, 'web')
  const shown = port === null ? pageUrl(DEV_PORT) : pageUrl(port)
  return {
    what,
    argv: [facts.node.path, join(web, 'node_modules', 'vite', 'bin', 'vite.js'), ...args],
    cwd: web,
    env: {},
    wait: { url: shown, contains: PAGE_MARKER },
  }
}

/**
 * NQT_PORT is the fixed browser port (8765 unless --port says otherwise), never 0. NQT_STDIN_CONTROL=1 makes the
 * backend read TOKEN and NONCE from its input (the plain launcher; --dev's uvicorn makes its own token and records it
 * in the lock). NQT_PREWARM=1 asks it to warm the HOME computations once its port is bound (the plain launcher only:
 * not --dev, whose uvicorn --reload restarts the process on each edit, and not fixture mode, which has no price source).
 */
function backendEnv(facts: Facts, port: number, controlled: boolean): Record<string, string> {
  const env: Record<string, string> = { NQT_PORT: String(port), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  if (controlled) env.NQT_STDIN_CONTROL = '1'
  if (facts.fixtureDir !== null) env.NQT_FIXTURE_DIR = facts.fixtureDir
  else if (controlled) env.NQT_PREWARM = '1'
  return env
}

/** Ready once the proof route answers: every other /api path needs a session, and the launcher has none yet. */
function proofWait(port: number): { readonly url: string; readonly contains: string } {
  return { url: `${pageUrl(port)}api/desktop/proof?nonce=${PROBE_NONCE}`, contains: PROOF_MARKER }
}

function backendStep(facts: Facts, what: string, args: readonly string[], port: number, controlled = false): Step {
  return {
    what,
    argv: [facts.python.path, ...args],
    cwd: join(facts.terminalDir, 'backend'),
    env: backendEnv(facts, port, controlled),
    wait: proofWait(port),
    allowList: true,
    ...(controlled ? { stdin: 'control' as const } : {}),
  }
}

function untrustedMessage(facts: Facts): string {
  return `the lock file in ${facts.stateDir} is not owner-only (another account owns it or can write it), so it is not used. Remove it if you did not expect it.`
}

function busyMessage(port: number): string {
  return `port ${port} on ${LOOPBACK} is taken by another program. Choose another with --port.`
}

function corepackMessage(builds: boolean): string {
  return builds
    ? 'corepack is not on PATH, so web/dist cannot be rebuilt. Install Node 24 with corepack, or start with --no-build to serve web/dist as it is.'
    : 'corepack is not on PATH, so the web dependencies cannot be installed. Install Node 24 with corepack (corepack enable), then run ./start.sh again.'
}

export function planStart(options: StartOptions, facts: Facts, resolved: ResolvedMode): StartPlan {
  const { mode, reason } = resolved
  const demo = mode === 'DEMO ONLY'
  const dev = options.dev && !demo
  const port = options.port ?? (demo ? DEMO_PORT : BACKEND_PORT)
  const state = portState(facts, port)
  const blockers: string[] = []
  const steps: Step[] = []
  let build: StartPlan['build'] = 'not used'
  let url = pageUrl(port)
  let alreadyRunning = false
  let attach: StartPlan['attach'] = null
  let session: StartPlan['session'] = null
  const lock = facts.lock

  const installStep = (): Step => corepackStep(facts, 'install the web dependencies', ['install', '--frozen-lockfile'])
  const install = !facts.webDeps ? installStep() : null

  if (demo) {
    if (install) steps.push(install)
    steps.push(viteStep(facts, 'serve the demo', ['--mode', 'demo', '--port', String(port), '--strictPort'], port))
    if (state === 'terminal') alreadyRunning = true
    else if (state === 'busy') blockers.push(busyMessage(port))
  } else if (dev) {
    url = pageUrl(DEV_PORT)
    session = { origin: originOf(DEV_PORT), apiPort: port }
    if (lock.state === 'live') {
      blockers.push(`--dev needs its own reloading backend, but a backend already holds the lock in ${facts.stateDir} (port ${lock.port ?? 'unknown'}). Stop that backend first.`)
    } else if (lock.state === 'untrusted') {
      blockers.push(untrustedMessage(facts))
    }
    if (install) steps.push(install)
    steps.push(
      backendStep(
        facts,
        'start the backend with uvicorn --reload',
        [
          '-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--reload',
          '--host', LOOPBACK, '--port', String(port), '--no-server-header', '--no-proxy-headers',
          '--timeout-graceful-shutdown', '2',
        ],
        port,
      ),
    )
    steps.push(viteStep(facts, 'start the Vite dev server', [], null))
    if (state === 'terminal' && lock.state !== 'live') blockers.push(`--dev needs port ${port} free for uvicorn --reload, but the terminal already runs there. Stop it first.`)
    else if (state === 'busy') blockers.push(busyMessage(port))
    if (portState(facts, DEV_PORT) !== 'free') blockers.push(`port ${DEV_PORT} on ${LOOPBACK} is taken; the Vite dev server needs it.`)
  } else {
    build = !options.build ? 'skipped' : facts.buildNeeded ? 'needed' : 'up to date'
    if (lock.state === 'live' && lock.port !== null) {
      // One backend per lab: the lock names a backend that proved itself, so a launch code is minted for it and
      // nothing is started (an attached launcher never stops it).
      alreadyRunning = true
      attach = { port: lock.port }
      url = pageUrl(lock.port)
      session = { origin: originOf(lock.port), apiPort: lock.port }
    } else if (lock.state === 'untrusted') {
      blockers.push(untrustedMessage(facts))
    } else if (state === 'terminal') {
      blockers.push(`a terminal on ${LOOPBACK}:${port} has no lock file or token (an older version). Close it, or stop that process, then start again.`)
    } else {
      if (build === 'needed') {
        // As start.ps1: install --frozen-lockfile before every build, dependencies present or not. pnpm-lock.yaml
        // is a build input, so a pull that changes it needs a build with node_modules present but stale; with the
        // lockfile unchanged the install is a fast no-op.
        steps.push(install ?? installStep())
        steps.push(corepackStep(facts, 'build web/dist', ['build']))
      }
      steps.push(backendStep(facts, 'start the backend', ['-m', 'nq_terminal'], port, true))
      session = { origin: originOf(port), apiPort: port }
      if (state === 'busy') blockers.push(busyMessage(port))
    }
  }

  const planned = alreadyRunning ? [] : steps
  if (!facts.corepack && planned.some((s) => s.argv[0] === 'corepack')) {
    blockers.push(corepackMessage(planned.some((s) => s.what === 'build web/dist')))
  }
  return {
    mode,
    reason,
    dev,
    port,
    url,
    alreadyRunning,
    install: planned.some((s) => s.what === 'install the web dependencies'),
    build,
    steps: planned,
    blockers,
    attach,
    session,
  }
}

/** An argument as it is shown, quoted when it holds a space. Display only: the steps keep the raw argv. */
function shown(text: string): string {
  return /\s/.test(text) ? `"${text}"` : text
}

/** The plan as lines, in the manner of start.ps1's Write-Plan. */
export function formatPlan(plan: StartPlan, options: StartOptions, facts: Facts): string[] {
  const lines = [
    `mode: ${plan.mode} (${plan.reason})`,
    `root: ${facts.terminalDir}`,
    `node: ${facts.node.version.replace(/^v/, '')} at ${facts.node.path}`,
    `port: ${plan.port} (${portState(facts, plan.port)})`,
  ]
  if (plan.dev) lines.push(`port: ${DEV_PORT} (${portState(facts, DEV_PORT)})`)
  if (plan.build === 'not used') {
    lines.push(`build: not used (Vite serves the ${plan.dev ? 'sources' : 'demo from the sources'})`)
  } else if (plan.build === 'skipped') {
    lines.push('build: skipped (--no-build)')
  } else {
    lines.push(`build: ${plan.build} (${join(facts.terminalDir, 'web', 'dist')})`)
  }
  plan.steps.forEach((step, index) => {
    lines.push(`step ${index + 1} of ${plan.steps.length}: ${step.what}: ${step.argv.map(shown).join(' ')} (in ${step.cwd})`)
    const env = Object.entries(step.env)
    if (env.length > 0) lines.push(`  env: ${env.map(([key, value]) => `${key}=${shown(value)}`).join(' ')}`)
    if (step.allowList === true) lines.push('  env filter: the allow list of desktop/envlist.py; no other variable reaches the backend')
    if (step.stdin === 'control') lines.push('  input: TOKEN and NONCE, written once and kept open; closing it stops the backend')
  })
  if (plan.alreadyRunning) lines.push(`already running: ${plan.url} (nothing would be started)`)
  lines.push(`page: ${plan.url}`)
  if (plan.session === null) {
    lines.push(options.browser ? `browser: opens ${plan.url}` : 'browser: not opened')
  } else {
    const link = `${plan.session.origin}/session.html#<one-time code>`
    lines.push(options.browser ? `browser: opens ${link}` : `browser: not opened (the one-time link ${link} is printed instead)`)
  }
  for (const blocker of plan.blockers) lines.push(`would stop: ${blocker}`)
  return lines
}
