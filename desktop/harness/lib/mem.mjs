import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MB = 1048576
const HERE = path.dirname(fileURLToPath(import.meta.url))

// Whole-tree memory under rootPid. windowsHide keeps the PowerShell child from opening a console.
export function memTree(rootPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'mem.ps1'), '-RootPid', String(rootPid)],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  return JSON.parse(out)
}

// Current identity ({ pid, created, exe }) of each pid that still exists, in the same form mem.ps1 records it.
export function liveIdentity(pids) {
  const ids = [...new Set(pids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return []
  const script = `$ids = @(${ids.join(',')}); $r = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; exe = $_.Name; created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }) } }); ConvertTo-Json -InputObject $r -Compress`
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const rows = JSON.parse(out || '[]')
  return Array.isArray(rows) ? rows : [rows]
}

// Identity rows of rootPid and its creation-time-checked descendants (no performance counters, so it is quick).
export function treeIdentity(rootPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'mem.ps1'), '-RootPid', String(rootPid), '-WalkOnly', '-Identity'],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const rows = JSON.parse(out || '[]')
  return Array.isArray(rows) ? rows : [rows]
}

// ---- Where the memory sits: backend, WebView2 by process type, shell (informational; the figure of record is unchanged) ----

/** The T4 canvas clause (02_decision.md): a UI tree above this at idle sends the search to the canvas backing stores per panel. */
export const T4_UI_TREE_MB = 350

/** Soak samples from this time on (seconds) count as settled; the first sample is the start-up peak, reported apart. */
export const SETTLED_FROM_S = 900

const BACKEND_IMAGES = /^(python[\w.-]*|pythonw[\w.-]*|uv|conhost|openconsole|cmd)(\.exe)?$/
const round1 = (v) => Math.round(v * 10) / 10

/** The WebView2 process type of a command line: browser (the root, no --type), renderer, gpu-process, utility-network,
 *  utility-storage, utility-other, crashpad, other, or unknown when the command line could not be read. */
function webviewType(commandLine) {
  if (typeof commandLine !== 'string' || commandLine.trim() === '') return 'unknown'
  const type = /--type=([\w-]+)/.exec(commandLine)?.[1]
  if (!type) return 'browser'
  if (type === 'renderer' || type === 'gpu-process') return type
  if (type === 'crashpad-handler') return 'crashpad'
  if (type === 'utility') {
    const sub = /--utility-sub-type=([\w.]+)/.exec(commandLine)?.[1] ?? ''
    return /network/i.test(sub) ? 'utility-network' : /storage/i.test(sub) ? 'utility-storage' : 'utility-other'
  }
  return 'other'
}

/**
 * Splits a process list of one app tree into the backend (python, its launcher and console host), the WebView2 processes by
 * --type and the shell (everything else, in practice the shell executable). Each item: { pid, parent, name (image name),
 * commandLine, wsPrivate (bytes) }. Pure. The three parts and totalMB come from the same unrounded sum; each figure is MB to
 * one decimal place.
 */
export function classifyTree(processes) {
  let backend = 0
  let shell = 0
  const types = {}
  for (const p of processes) {
    const bytes = Number.isFinite(p.wsPrivate) ? p.wsPrivate : 0
    const image = String(p.name ?? '').toLowerCase().replace(/#\d+$/, '')
    if (BACKEND_IMAGES.test(image)) backend += bytes
    else if (/^msedgewebview2(\.exe)?$/.test(image)) { const t = webviewType(p.commandLine); types[t] = (types[t] ?? 0) + bytes } else if (/crashpad/.test(image)) types.crashpad = (types.crashpad ?? 0) + bytes
    else shell += bytes
  }
  const ui = Object.values(types).reduce((a, v) => a + v, 0)
  return { backendMB: round1(backend / MB), uiTreeMB: round1(ui / MB), shellMB: round1(shell / MB),
    perType: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, round1(v / MB)])), totalMB: round1((backend + ui + shell) / MB) }
}

/** The reason of a failed side reading, short enough for a record and a report line. */
export const errorText = (e) => String((e && e.message) ?? e).slice(0, 200)

/** Parent pid and command line of each pid that still exists (one CIM query; windowsHide keeps the PowerShell child hidden). */
export function processDetails(pids) {
  const ids = [...new Set(pids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return []
  const script = `$ids = @(${ids.join(',')}); $r = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; commandLine = $_.CommandLine } }); ConvertTo-Json -InputObject $r -Compress`
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const rows = JSON.parse(out || '[]')
  return Array.isArray(rows) ? rows : [rows]
}

/**
 * The breakdown of the tree under rootPid: the existing mem.ps1 reading (private working set per process) joined with each
 * process's command line, then classifyTree. When the command lines cannot be read the WebView2 processes are counted as
 * 'unknown' and the totals still hold. `deps` replaces the two readers in tests.
 */
export function memTreeBreakdown(rootPid, deps = {}) {
  const read = deps.tree ?? memTree
  const lookup = deps.details ?? processDetails
  const tree = read(rootPid)
  const procs = Array.isArray(tree?.procs) ? tree.procs : tree?.procs ? [tree.procs] : []
  let byPid = new Map()
  let commandLineError = null
  try { byPid = new Map(lookup(procs.map((p) => p.pid)).map((d) => [Number(d.pid), d])) } catch (e) { commandLineError = errorText(e) }
  const split = classifyTree(procs.map((p) => ({ pid: p.pid, parent: byPid.get(Number(p.pid))?.parent ?? null, name: p.exe ?? p.name, commandLine: byPid.get(Number(p.pid))?.commandLine ?? null, wsPrivate: p.wsPrivate })))
  return commandLineError === null ? split : { ...split, commandLineError }
}
