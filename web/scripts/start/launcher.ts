// The launcher behind ./start.sh (scripts/start.mjs imports main() under Node 24, which strips these types).
//
// It gathers the facts (facts.ts), resolves the mode (plan.ts: FULL, FIXTURE or DEMO ONLY), and then prints
// the doctor checklist, prints the plan (--dry-run), or runs the plan's steps. Steps are argv arrays run
// without a shell. A step that runs to completion (install, build) is waited for; a long-running one
// (backend, Vite) is started in a process group of its own and polled until its URL answers, every 500 ms for
// up to 90 s, and the launcher stops at once if it exits first. On Ctrl+C, SIGTERM or SIGHUP every group is
// sent SIGTERM and, three seconds later, SIGKILL, so nothing the launcher started outlives it.
import { spawn, type ChildProcess } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { doctorLines } from './doctor.ts'
import { gatherFacts, httpGetLoopback } from './facts.ts'
import { formatPlan, parseArgs, planStart, resolveMode, usageLines, type Facts, type StartOptions, type StartPlan, type Step } from './plan.ts'

const STARTUP_MS = 90_000
const POLL_MS = 500
const PROBE_MS = 3000
const TERM_GRACE_MS = 3000
const KILL_WAIT_MS = 1000
const WATCH_MS = 50
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

export interface LauncherContext {
  readonly terminalDir: string
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: string
  readonly stdout?: (line: string) => void
  readonly stderr?: (line: string) => void
  /** How long a started process may take to answer, in ms (default 90 000); for tests. */
  readonly startupMs?: number
}

interface Io {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
}

interface Exit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

interface Running {
  readonly step: Step
  readonly proc: ChildProcess
  exit: Exit | null
  /** The process is gone but part of its process group is not; that part has been sent SIGTERM. */
  lingering: boolean
  done: Promise<void>
}

const exitOf = (child: Running): Exit | null => child.exit

/** The environment steps run in: the chosen Node's folder first on PATH, so corepack and pnpm come from it. */
function withNodeOnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = env.PATH === undefined || env.PATH === '' ? dirname(process.execPath) : `${dirname(process.execPath)}${delimiter}${env.PATH}`
  return { ...env, PATH: path }
}

function signalCode(signal: NodeJS.Signals): number {
  return 128 + (osConstants.signals[signal] ?? 0)
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // the group is already gone
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function launch(step: Step, env: NodeJS.ProcessEnv): Running {
  const [command = '', ...args] = step.argv
  const proc = spawn(command, args, {
    cwd: step.cwd,
    env: { ...env, ...step.env },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true, // its own process group, so the whole tree can be signalled
    windowsHide: true,
  })
  const running: Running = { step, proc, exit: null, lingering: false, done: Promise.resolve() }
  running.done = new Promise<void>((resolve) => {
    proc.once('error', () => {
      running.exit ??= { code: 127, signal: null }
      resolve()
    })
    proc.once('exit', (code, signal) => {
      running.exit ??= { code, signal }
      // What a process leaves behind in its group (a helper, a watcher) must not outlive it.
      if (proc.pid !== undefined && groupAlive(proc.pid)) {
        running.lingering = true
        signalGroup(proc.pid, 'SIGTERM')
      }
      resolve()
    })
  })
  return running
}

function pause(ms: number, ...wakeups: Array<Promise<unknown>>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const stop = (): void => {
      clearTimeout(timer)
      resolve()
    }
    for (const wakeup of wakeups) void wakeup.then(stop)
  })
}

/** SIGTERM to every group, SIGKILL to those still there after the grace period. Resolves when none is left. */
async function stopAll(all: readonly Running[]): Promise<void> {
  const pids = all
    .filter((r) => exitOf(r) === null || r.lingering)
    .map((r) => r.proc.pid)
    .filter((pid): pid is number => pid !== undefined)
  for (const pid of pids) signalGroup(pid, 'SIGTERM')
  const waitUntilGone = async (ms: number): Promise<number[]> => {
    const end = Date.now() + ms
    let alive = pids.filter(groupAlive)
    while (alive.length > 0 && Date.now() < end) {
      await pause(WATCH_MS)
      alive = alive.filter(groupAlive)
    }
    return alive
  }
  const stubborn = await waitUntilGone(TERM_GRACE_MS)
  for (const pid of stubborn) signalGroup(pid, 'SIGKILL')
  if (stubborn.length > 0) await waitUntilGone(KILL_WAIT_MS)
  await Promise.all(all.map((r) => (exitOf(r) === null && r.proc.pid !== undefined ? pause(KILL_WAIT_MS, r.done) : Promise.resolve())))
}

function openBrowser(url: string, platform: string, io: Io): void {
  const opener = platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const proc = spawn(opener, [url], { stdio: 'ignore', detached: true })
    proc.once('error', () => io.err(`start: could not run ${opener}. Open ${url} yourself.`))
    proc.unref()
  } catch {
    io.err(`start: could not run ${opener}. Open ${url} yourself.`)
  }
}

function showPage(url: string, options: StartOptions, platform: string, io: Io): void {
  if (options.browser) openBrowser(url, platform, io)
  else io.out(`browser: not opened (${url})`)
}

type Readiness = 'ready' | 'exited' | 'timeout' | 'interrupted'

/** Listens for Ctrl+C, SIGTERM and SIGHUP; the first one is remembered and wakes everything that waits. */
function watchSignals(): { readonly state: { signal: NodeJS.Signals | null }; readonly interrupted: Promise<void>; readonly release: () => void } {
  const state: { signal: NodeJS.Signals | null } = { signal: null }
  let wake: () => void = () => undefined
  const interrupted = new Promise<void>((resolve) => {
    wake = resolve
  })
  const handlers = SIGNALS.map((signal) => {
    const handler = (): void => {
      if (state.signal === null) {
        state.signal = signal
        wake()
      }
    }
    process.on(signal, handler)
    return { signal, handler }
  })
  const release = (): void => {
    for (const { signal, handler } of handlers) process.off(signal, handler)
  }
  return { state, interrupted, release }
}

async function runSteps(plan: StartPlan, options: StartOptions, facts: Facts, env: NodeJS.ProcessEnv, io: Io, startupMs: number): Promise<number> {
  const { state, interrupted, release } = watchSignals()
  const running: Running[] = []
  const stopped = (): number => signalCode(state.signal ?? 'SIGINT')

  const waitReady = async (child: Running, wait: { readonly url: string; readonly contains: string }): Promise<Readiness> => {
    const deadline = Date.now() + startupMs
    for (;;) {
      if (state.signal !== null) return 'interrupted'
      if (exitOf(child) !== null) return 'exited'
      const probe = new AbortController()
      const reply = await Promise.race([
        httpGetLoopback(wait.url, PROBE_MS, probe.signal),
        interrupted.then(() => null),
        child.done.then(() => null),
      ])
      probe.abort()
      if (reply !== null && reply.status === 200 && reply.body.includes(wait.contains)) return 'ready'
      if (state.signal !== null) return 'interrupted'
      if (exitOf(child) !== null) return 'exited'
      if (Date.now() >= deadline) return 'timeout'
      await pause(POLL_MS, interrupted, child.done)
    }
  }

  try {
    for (const step of plan.steps) {
      io.out(`start: ${step.what}`)
      const child = launch(step, env)
      running.push(child)
      if (step.wait === 'exit') {
        await Promise.race([child.done, interrupted])
        if (state.signal !== null) return stopped()
        const code = exitOf(child)?.code ?? 1
        if (code !== 0) {
          io.err(`start: ${step.what} failed with code ${code}.`)
          return 1
        }
        continue
      }
      const readiness = await waitReady(child, step.wait)
      if (readiness === 'interrupted') return stopped()
      if (readiness === 'exited') {
        io.err(`start: ${step.what} exited with code ${exitOf(child)?.code ?? 'unknown'} before it answered.`)
        return 1
      }
      if (readiness === 'timeout') {
        io.err(`start: ${step.what} did not answer within ${startupMs / 1000} seconds.`)
        return 1
      }
    }
    io.out(
      plan.mode === 'DEMO ONLY'
        ? `nq-lab terminal demo: ${plan.url} (fixture data answered in the browser)`
        : `nq-lab terminal: ${plan.url} (read only)`,
    )
    showPage(plan.url, options, facts.platform, io)
    io.out('Running. Press Ctrl+C to stop.')
    const longRunning = running.filter((r) => r.step.wait !== 'exit')
    const first = await Promise.race([interrupted.then(() => null), ...longRunning.map((r) => r.done.then(() => r))])
    if (first === null) return stopped()
    const code = exitOf(first)?.code ?? null
    io.out(`A process exited with code ${code ?? 'unknown'}; stopping.`)
    return code ?? 1
  } finally {
    if (state.signal !== null) io.out('Stopping...')
    await stopAll(running)
    release()
  }
}

export async function main(argv: readonly string[], ctx: LauncherContext): Promise<number> {
  const io: Io = {
    out: ctx.stdout ?? ((line) => console.log(line)),
    err: ctx.stderr ?? ((line) => console.error(line)),
  }
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    io.err(`start: ${parsed.error}`)
    io.err('Run ./start.sh --help for the options.')
    return 2
  }
  const options = parsed.options
  if (options.command === 'help') {
    for (const line of usageLines()) io.out(line)
    return 0
  }
  const platform = ctx.platform ?? process.platform
  if (platform === 'win32' && options.command === 'start') {
    io.err('On Windows run start.ps1 (README, Start it).')
    return 2
  }

  const env = withNodeOnPath(ctx.env ?? process.env)
  const facts = await gatherFacts({
    terminalDir: ctx.terminalDir,
    env,
    platform,
    ports: options.port === null ? [] : [options.port],
    contract: options.command === 'doctor',
  })

  if (options.command === 'doctor') {
    // The checklist reports the mode a plain ./start.sh would pick, whatever flags came with it.
    const auto = resolveMode({ ...options, mode: 'auto', dev: false }, facts)
    if (!auto.ok) {
      io.err(`start: ${auto.error}`)
      return 1
    }
    for (const line of doctorLines(facts, auto)) io.out(line)
    return 0
  }

  const resolved = resolveMode(options, facts)
  if (!resolved.ok) {
    io.err(`start: ${resolved.error}`)
    return 1
  }
  const plan = planStart(options, facts, resolved)
  if (options.dryRun) {
    for (const line of formatPlan(plan, options, facts)) io.out(line)
    return 0
  }
  if (plan.blockers.length > 0) {
    for (const blocker of plan.blockers) io.err(`start: ${blocker}`)
    return 1
  }
  if (plan.alreadyRunning) {
    io.out(`The terminal already runs on ${plan.url}; nothing started.`)
    showPage(plan.url, options, platform, io)
    return 0
  }
  return runSteps(plan, options, facts, env, io, ctx.startupMs ?? STARTUP_MS)
}
