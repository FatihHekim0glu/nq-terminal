// The global window and foreground watch (04 standing rule 4) around every launch of the desktop project, and the judge
// that decides what fails a run. watch.ps1 does the looking (EnumWindows over every process and GetForegroundWindow every
// 100 ms); this file starts it with no window of its own, keeps its lines and judges them.
//
// A run fails on: any new window that is drawn (visible, not cloaked, with an area, not an unseen layered window), any new
// window that is not drawn and is not tao's event target (the shell's own message window), and any change of the
// foreground window. The same rules as the shell's own hidden-window tests (desktop/src-tauri/tests/hidden_support/watch.rs).
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TAO_CLASS = 'Tao Thread Event Target'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const READY_WAIT_MS = 60_000
const DONE_WAIT_MS = 10_000

/** One step up a window owner's process ancestry. */
export interface ProcessLink {
  readonly pid: number
  readonly name: string
  readonly commandLine: string
}

export interface WatchEvent {
  readonly event: 'ready' | 'new' | 'foreground' | 'done'
  readonly pid?: number
  readonly process?: string
  readonly class?: string
  readonly title?: string
  readonly rect?: readonly number[]
  readonly drawn?: boolean
  readonly samples?: number
  readonly maxGapMs?: number
  /** The owner and its ancestors, nearest first, looked up when the line arrived (a process that was gone has none). */
  chain?: ProcessLink[]
}

const ANCESTRY_DEPTH = 8

/** The process and its ancestors, nearest first, by one CIM query per step. */
export function processChain(pid: number): ProcessLink[] {
  const links: ProcessLink[] = []
  let next = pid
  for (let depth = 0; depth < ANCESTRY_DEPTH && next > 0; depth += 1) {
    const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${next}'; if ($p) { @{ pid = [int]$p.ProcessId; parent = [int]$p.ParentProcessId; name = $p.Name; cmd = [string]$p.CommandLine } | ConvertTo-Json -Compress }`
    let text = ''
    try {
      text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()
    } catch {
      break
    }
    if (text === '') break
    const row = JSON.parse(text) as { pid: number; parent: number; name: string; cmd: string }
    links.push({ pid: row.pid, name: row.name, commandLine: row.cmd.slice(0, 200) })
    next = row.parent
  }
  return links
}

/** True when the event's window belongs to the tree under `rootPid` (the app this run started). */
export const ownedBy = (e: WatchEvent, rootPid: number): boolean => (e.chain ?? []).some((link) => link.pid === rootPid)

export interface WatchReport {
  readonly events: readonly WatchEvent[]
  readonly samples: number
  readonly maxGapMs: number
}

const describe = (e: WatchEvent, rootPid?: number): string => {
  const owner = rootPid === undefined || e.chain === undefined ? '' : ownedBy(e, rootPid) ? ' [this run\'s app tree]' : ` [NOT this run's app tree; ancestry ${e.chain.map((l) => `${l.name}:${l.pid}`).join(' < ') || 'gone'}]`
  return `${e.process ?? '?'} (pid ${e.pid ?? '?'}) class ${JSON.stringify(e.class ?? '')} title ${JSON.stringify(e.title ?? '')} rect ${JSON.stringify(e.rect ?? [])}${owner}`
}

/**
 * What fails a run, one line each: a drawn new window, an undrawn one that is not tao's, a foreground change. The rule is
 * global (a window of any process counts); `rootPid`, the app this run started, only labels whose tree a window came from.
 */
export function judge(events: readonly WatchEvent[], rootPid?: number): string[] {
  const failures: string[] = []
  for (const e of events) {
    if (e.event === 'new') {
      if (e.drawn === true) failures.push(`a window was drawn: ${describe(e, rootPid)}`)
      else if (e.class !== TAO_CLASS) failures.push(`an unexpected undrawn window appeared: ${describe(e, rootPid)}`)
    } else if (e.event === 'foreground') {
      failures.push(`the foreground window changed to: ${describe(e, rootPid)}`)
    }
  }
  return failures
}

/** A watch in progress. */
export interface Watch {
  readonly events: () => readonly WatchEvent[]
  /** Stops the loop and returns everything it saw. */
  readonly finish: () => Promise<WatchReport>
}

interface WatchState {
  readonly events: WatchEvent[]
  failure: string | null
  readonly waiters: Array<() => void>
}

/** One line of the loop's output: kept, enriched with the owner's ancestry where it names a window, and written to the log. */
function ingest(state: WatchState, logFile: string, line: string): void {
  try {
    const event = JSON.parse(line) as WatchEvent
    // Where an unexpected window came from is looked up now, while its process is still there.
    if ((event.event === 'new' || event.event === 'foreground') && (event.pid ?? 0) > 0) event.chain = processChain(event.pid ?? 0)
    state.events.push(event)
    fs.appendFileSync(logFile, `${JSON.stringify(event)}
`)
  } catch {
    fs.appendFileSync(logFile, `${line}
`)
    state.failure = `the watch printed a line that is not JSON: ${line}`
  }
  for (const w of state.waiters.splice(0)) w()
}

/** Waits until the loop has printed the named event line; throws when it failed or stays silent. */
async function waitForEvent(state: WatchState, event: WatchEvent['event'], ms: number): Promise<void> {
  const end = Date.now() + ms
  while (!state.events.some((e) => e.event === event)) {
    if (state.failure !== null) throw new Error(state.failure)
    const left = end - Date.now()
    if (left <= 0) throw new Error(`the window watch gave no "${event}" line within ${ms / 1000} s`)
    await new Promise<void>((resolve) => { state.waiters.push(resolve); setTimeout(resolve, Math.min(left, 500)) })
  }
}

function spawnLoop(state: WatchState, logFile: string): ChildProcessWithoutNullStreams {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'watch.ps1')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    pending += chunk
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const line = pending.slice(0, at).trim()
      pending = pending.slice(at + 1)
      if (line !== '') ingest(state, logFile, line)
    }
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.once('exit', () => {
    if (!state.events.some((e) => e.event === 'done')) state.failure ??= `the watch ended early: ${stderr.trim()}`
    for (const w of state.waiters.splice(0)) w()
  })
  return child
}

/** Starts the native loop and returns once its baseline is taken. Lines are also appended to the log file. */
export async function startWatch(logFile: string): Promise<Watch> {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  fs.writeFileSync(logFile, '')
  const state: WatchState = { events: [], failure: null, waiters: [] }
  const child = spawnLoop(state, logFile)
  await waitForEvent(state, 'ready', READY_WAIT_MS)
  return {
    events: () => [...state.events],
    finish: async () => {
      child.stdin.write('stop\n')
      await waitForEvent(state, 'done', DONE_WAIT_MS)
      const done = state.events.find((e) => e.event === 'done')
      child.stdin.end()
      return { events: [...state.events], samples: done?.samples ?? 0, maxGapMs: done?.maxGapMs ?? 0 }
    },
  }
}

/** Reads a watch log written by `startWatch` (for the spec that judges the run from a worker). */
export function readWatchLog(logFile: string): WatchEvent[] {
  return fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as WatchEvent)
}
