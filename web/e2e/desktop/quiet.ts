// One Playwright run at a time on this machine (04 standing rule): before the desktop project launches anything it looks
// for another Playwright test run or a vitest browser run and, if there is one, waits for it to end rather than starting a
// second. It never stops a process it did not start. Two desktop runs (another worktree, a second manual start) are kept
// apart by a machine-wide lock file, because they share D:/dev/d5/app/lab, the lab/terminal junction and the parity port.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const POLL_MS = 15_000
const GIVE_UP_MS = 45 * 60_000
/** Where the machine-wide lock of the desktop project lives (never on C:). */
export const LOCK_DIR = 'D:/dev/d5'
export const LOCK_NAME = 'desktop-run.lock'
/** A command line of a run that drives browsers: Playwright's test runner (its cli or its worker) or vitest. */
export const BUSY = /@playwright[\\/+]test[\\/].*(cli|worker)|playwright[\\/]cli\.js\s+test|playwright\s+test|[\\/]vitest[\\/]|vitest(\.mjs)?\s+(run|--)/i
/** The desktop project's own config on a command line: another run of this project. */
export const DESKTOP_RUN = /playwright\.desktop\.config/i

export interface ProcRow { pid: number; ppid: number; commandLine: string }

/** Every process with its parent and command line, but for the PowerShell that asks. */
export function processTable(): ProcRow[] {
  const script = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }'
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const rows: ProcRow[] = []
  for (const line of out.split(/\r?\n/)) {
    const [pid, ppid, ...rest] = line.split('\t')
    const commandLine = rest.join('\t')
    if (line !== '' && Number.isInteger(Number(pid)) && Number.isInteger(Number(ppid)) && !/Get-CimInstance/.test(commandLine)) rows.push({ pid: Number(pid), ppid: Number(ppid), commandLine })
  }
  return rows
}

/** This process, its ancestors (package-manager and shell wrappers of this very run) and its descendants, from the table. */
export function ownTree(table: ProcRow[], own: number): Set<number> {
  const parentOf = new Map(table.map((r) => [r.pid, r.ppid]))
  const tree = new Set<number>([own])
  for (let at = parentOf.get(own); at !== undefined && !tree.has(at); at = parentOf.get(at)) tree.add(at)
  // Descendants of this process only: a sibling run under the same shell is a descendant of an ancestor, not of this run.
  const below = new Set<number>([own])
  for (let grew = true; grew; ) {
    grew = false
    for (const r of table) if (!below.has(r.pid) && below.has(r.ppid)) { below.add(r.pid); tree.add(r.pid); grew = true }
  }
  return tree
}

/**
 * The command lines of other runs that drive browsers: a node process matching `BUSY` that is not in this run's own tree.
 * Another desktop run is NOT exempt (its main process carries the same config name as this one); with `lockHeld` it is the
 * lock that has already ordered the desktop runs, so one that is still on the table is waiting for it and is left alone.
 */
export function foreignRuns(table: ProcRow[], own: number, lockHeld = false): string[] {
  const mine = ownTree(table, own)
  return table
    .filter((r) => !mine.has(r.pid) && BUSY.test(r.commandLine) && /node(\.exe)?"?\s/i.test(r.commandLine))
    .filter((r) => !(lockHeld && DESKTOP_RUN.test(r.commandLine)))
    .map((r) => `${r.pid}\t${r.commandLine}`)
}

/** The command lines of every other process that matches `BUSY` (this run's own tree excluded). */
export function busyProcesses(own: number = process.pid): string[] {
  return foreignRuns(processTable(), own)
}

export interface RunLock { readonly file: string; release(): void }
interface LockBody { pid: number; startedAt: string; cwd: string }

/** When a process started, or null when it is not running; the pair (pid, start time) survives pid reuse. */
export function startTimeOf(pid: number): string | null {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`], { encoding: 'utf8', windowsHide: true })
    return out.trim() || null
  } catch {
    return null
  }
}

function readLock(file: string): LockBody | null {
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockBody>
    return typeof body.pid === 'number' && typeof body.startedAt === 'string' ? { pid: body.pid, startedAt: body.startedAt, cwd: String(body.cwd ?? '') } : null
  } catch {
    return null
  }
}

/**
 * Takes the machine-wide lock of the desktop project, create-exclusive, holding this process's pid and start time. Returns
 * null while another live run holds it. A lock whose owner is gone (or whose pid now belongs to a younger process) is stale
 * and is replaced; one that cannot be read is treated as held, never as free.
 */
export function tryAcquireRunLock(dir: string = LOCK_DIR, pid: number = process.pid, startTime: (p: number) => string | null = startTimeOf): RunLock | null {
  if (/^c:/i.test(path.resolve(dir))) throw new Error(`the desktop run lock lives on D: only; ${dir} is on C:`)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, LOCK_NAME)
  const mine: LockBody = { pid, startedAt: startTime(pid) ?? '', cwd: process.cwd() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' })
      return { file, release: () => { if (readLock(file)?.pid === pid) fs.rmSync(file, { force: true }) } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const held = readLock(file)
    if (held === null) return null
    const now = startTime(held.pid)
    if (now !== null && now === held.startedAt) return null
    fs.rmSync(file, { force: true }) // stale: the owner ended or its pid was reused
  }
  return null
}

/**
 * Waits until no other Playwright or vitest run is active and this run holds the desktop lock (its own parent shells and
 * children excluded), then returns the lock for the tear-down to release. Fails after 45 minutes rather than start a second.
 */
export async function waitForQuietMachine(): Promise<RunLock> {
  const end = Date.now() + GIVE_UP_MS
  let told = false
  for (;;) {
    const lock = tryAcquireRunLock()
    let others: string[] = ['the desktop lock is held by another desktop run']
    if (lock !== null) {
      others = foreignRuns(processTable(), process.pid, true)
      if (others.length === 0) return lock
      lock.release()
    }
    if (!told) {
      process.stdout.write(`another Playwright or vitest run is active; the desktop project waits for it:\n${others.map((l) => `  ${l.slice(0, 160)}`).join('\n')}\n`)
      told = true
    }
    if (Date.now() > end) throw new Error('another Playwright or vitest run stayed active for 45 minutes; not starting a second')
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
