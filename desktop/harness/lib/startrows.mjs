// The start-up rows (Roadmap v2; startup.md section 11), read from the logs the harness already keeps. Informational in wave w1.
//
//   shell.log    spawn offset (start to supervise_spawned), spawn to READY (supervise_spawned to supervise_checked)
//   backend.log  HOME stage (prewarm started to prewarm finished), page files served (GET /assets/ lines), the slowest requests
//   importtime.py  the in-process import time and the modules without current bytecode (run by runImportTime)
//
// One shell.log and one backend.log can hold several launches (a usual-launch run opens the same folders again). Both logs are split
// per launch: the shell log at each `start` event, the backend log at each `Started server process [pid]` line, and the two are paired
// by the backend pid that supervise_checked names. A figure a launch's own lines do not hold reads `missing` with the reason; it is never
// 0 and never borrowed from another launch.
//
// The request lines are written by the backend's request-timing middleware (backend/nq_terminal/desktop/request_timing.py), one INFO line
// per request while the HOME tasks stage runs:
//   <date> <time> INFO nq_terminal.request_timing: request timing: <METHOD> <path> status=<n> start=<s> end=<s> wall_ms=<ms> event_loop_cpu_ms=<ms> process_cpu_ms=<ms>
// The duration is wall_ms, else end less start (seconds on the monotonic clock); the CPU read is event_loop_cpu_ms (thread_cpu_ms on older lines): event-loop load, not the request's own CPU, so the report leaves it out. A DEBUG line, and the keys
// start_ms, end_ms and cpu_ms (or cpu in seconds), are read as well. The path is read up to any `?`, so a query string never reaches a row.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../../scripts/main-module.mjs'
import { median } from './stats.mjs'
import { parseShellLog } from './shelllog.mjs'
import { START_ROWS } from './rows.mjs'
import { PY, TERMINAL } from './paths.mjs'

export const SCHEMA = 'start-rows-1'
export const SLOWEST = 5
export const NEEDED_FLAGS = Object.freeze(['-E', '-s', '-X utf8'])
const HERE = path.dirname(fileURLToPath(import.meta.url))
const IMPORT_SCRIPT = path.join(HERE, 'importtime.py')

const ok = (value, extra = {}) => ({ status: 'ok', value, reason: null, ...extra })
const missing = (reason) => ({ status: 'missing', value: null, reason })
const round1 = (v) => Math.round(v * 10) / 10

// ---- splitting the two logs per launch -------------------------------------------------------------------------------------
/** The events of each launch: a new group at every `start` event; events before the first one belong to no launch. */
export function splitShellLaunches(events) {
  if (events.length > 0 && !events.some((e) => e.event === 'start')) return [events]
  const groups = []
  for (const e of events) {
    if (e.event === 'start') groups.push([])
    if (groups.length > 0) groups.at(-1).push(e)
  }
  return groups
}

const SERVER_LINE = /Started server process \[(\d+)\]/

/** The lines of each launch of a backend.log: [{ pid, lines }], split at every `Started server process [pid]` line. */
export function splitBackendLaunches(text) {
  const sections = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = SERVER_LINE.exec(line)
    if (m) sections.push({ pid: Number(m[1]), lines: [] })
    if (sections.length > 0) sections.at(-1).lines.push(line)
  }
  return sections
}

/** Pairs each shell launch with its backend section: by the pid supervise_checked names, else by position when that section is unclaimed. */
function pairSections(shellLaunches, sections) {
  const claimed = new Set()
  const pids = shellLaunches.map((ev) => ev.find((e) => e.event === 'supervise_checked')?.pid ?? null)
  const paired = pids.map((pid) => {
    const i = pid === null ? -1 : sections.findIndex((s, j) => s.pid === pid && !claimed.has(j))
    if (i >= 0) claimed.add(i)
    return i
  })
  return paired.map((i, k) => {
    if (i >= 0) return sections[i]
    const byPosition = k < sections.length && !claimed.has(k) && pids[k] === null ? k : -1
    if (byPosition >= 0) claimed.add(byPosition)
    return byPosition >= 0 ? sections[byPosition] : null
  })
}

// ---- the shell log rows ----------------------------------------------------------------------------------------------------
const firstOf = (events, name) => events.find((e) => e.event === name) ?? null
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function shellRows(events) {
  const start = firstOf(events, 'start')
  const spawned = firstOf(events, 'supervise_spawned')
  const checked = firstOf(events, 'supervise_checked')
  const rows = {}
  if (!isNum(spawned?.t)) {
    rows.spawn_offset_ms = missing('no supervise_spawned line in the shell log of this launch')
    rows.spawn_to_ready_ms = missing('no supervise_spawned line in the shell log of this launch')
    return rows
  }
  rows.spawn_offset_ms = isNum(start?.t) && spawned.t >= start.t ? ok(spawned.t - start.t) : missing('no start line before supervise_spawned')
  rows.spawn_to_ready_ms = isNum(checked?.t) && checked.t >= spawned.t ? ok(checked.t - spawned.t) : missing('no supervise_checked line after supervise_spawned')
  return rows
}

// ---- the backend log rows --------------------------------------------------------------------------------------------------
const PREWARM_STAGE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}) INFO nq_terminal\.services\.prewarm: prewarm (started|finished)\b/
const REQUEST_LINE = /^\S+ \S+ (?:INFO|DEBUG) \S*request_timing: (?:request timing: )?(?:([A-Z]+) )?(\S+)(.*)$/
const stampMs = (s) => Date.parse(`${s.slice(0, 10)}T${s.slice(11, 19)}.${s.slice(20)}`)

/** One request-timing line as { method, path, ms, cpuMs }, or null when the line is not one or its clocks do not read. */
export function parseRequestLine(line) {
  const m = REQUEST_LINE.exec(line)
  if (!m) return null
  const kv = {}
  for (const [, k, v] of m[3].matchAll(/(\w+)=(-?[\d.]+)/g)) kv[k] = Number(v)
  const at = (name) => (isNum(kv[`${name}_ms`]) ? kv[`${name}_ms`] : isNum(kv[name]) ? kv[name] * 1000 : null)
  const [start, end] = [at('start'), at('end')]
  const wall = isNum(kv.wall_ms) ? kv.wall_ms : start !== null && end !== null ? end - start : null
  const cpu = isNum(kv.event_loop_cpu_ms) ? kv.event_loop_cpu_ms : isNum(kv.thread_cpu_ms) ? kv.thread_cpu_ms : at('cpu')
  if (wall === null || wall < 0) return null
  return { method: m[1] ?? null, path: m[2].split(/[?#]/)[0], ms: round1(wall), cpuMs: cpu === null ? null : round1(cpu) }
}

function stageRow(lines) {
  const stamps = { started: null, finished: null }
  for (const line of lines) {
    const m = PREWARM_STAGE.exec(line)
    if (m && stamps[m[2]] === null && (m[2] === 'started' || stamps.started !== null)) stamps[m[2]] = m[1]
  }
  if (stamps.started === null) return missing('no prewarm started line in the backend log of this launch')
  if (stamps.finished === null) return missing('no prewarm finished line after prewarm started')
  const ms = stampMs(stamps.finished) - stampMs(stamps.started)
  return ms >= 0 ? ok(ms) : missing('prewarm finished is stamped before prewarm started')
}

const ASSET_LINE = /"GET \/assets\//
const PAGE_LOAD_LINE = /"GET \/ HTTP/

/** The /assets/ lines of the launch, how many of them the first page load took (up to the second GET /), and how many 304 answers. */
function pageFilesRow(lines) {
  const loads = lines.flatMap((l, i) => (PAGE_LOAD_LINE.test(l) ? [i] : []))
  const assets = lines.filter((l) => ASSET_LINE.test(l))
  const firstLoad = lines.slice(0, loads[1] ?? lines.length).filter((l) => ASSET_LINE.test(l)).length
  return ok(assets.length, { firstLoad, pageLoads: loads.length, notModified: assets.filter((l) => /" 304\b/.test(l)).length })
}

/** The slowest requests of the HOME window. The middleware times a request when it began while the window was open and writes its
 * line when it ends, so a request that straddles the stage end is logged after the "prewarm finished" line: every request-timing
 * line of the launch's section belongs to the window, and cutting the log at the stage markers would drop the slowest ones. */
function slowRequestsRow(lines) {
  const reqs = lines.map(parseRequestLine).filter(Boolean)
  if (reqs.length === 0) return missing('no request timing line in the HOME window of this launch')
  const items = reqs.map((r, i) => ({ r, i })).sort((a, b) => b.r.ms - a.r.ms || a.i - b.i).slice(0, SLOWEST).map(({ r }) => r)
  return ok(items[0].ms, { items, window: reqs.length })
}

function backendRows(section) {
  if (!section) {
    const none = missing('no backend log section for this launch')
    return { home_stage_ms: none, page_files_served: none, slow_requests: none }
  }
  return { home_stage_ms: stageRow(section.lines), page_files_served: pageFilesRow(section.lines), slow_requests: slowRequestsRow(section.lines) }
}

// ---- the rows of a pair of logs --------------------------------------------------------------------------------------------
/** { schema, launches: [{ index, pid, rows }] } from the text of a shell log and a backend log (either may be empty). */
export function startRowsOfLogs(shellText, backendText) {
  const shellLaunches = splitShellLaunches(parseShellLog(shellText))
  const sections = pairSections(shellLaunches, splitBackendLaunches(backendText))
  const launches = shellLaunches.map((events, index) => ({
    index, pid: firstOf(events, 'supervise_checked')?.pid ?? null, rows: { ...shellRows(events), ...backendRows(sections[index]) },
  }))
  return { schema: SCHEMA, launches }
}

function readText(file, what, problems) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { problems.push(`${what} not readable: ${e.code ?? e.message}`); return '' }
}

/** The same from two files; an unreadable file is a problem named in `problems`, and its rows read missing. */
export function startRowsOfFiles(shellFile, backendFile) {
  const problems = []
  const shell = readText(shellFile, 'shell log', problems)
  const backend = readText(backendFile, 'backend log', problems)
  return { ...startRowsOfLogs(shell, backend), problems }
}

const sameTree = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/**
 * The import row stamped with whether it timed the backend this launch ran: 'same' when the tree importtime.py imported is the
 * backend folder of `terminal` (the tree the launch used), 'other' when it is another tree, 'unknown' when the row names none.
 * An 'other' row is a figure of another backend and is never reported as this build's.
 */
export function stampImportBackend(row, terminal) {
  if (row?.status !== 'ok') return row
  const backend = typeof row.tree !== 'string' ? 'unknown' : sameTree(row.tree, path.join(terminal, 'backend')) ? 'same' : 'other'
  return { ...row, backend, launchTerminal: terminal }
}

export const IMPORT_FILE = path.join('importtime', 'import-time.json')

/** Writes the run set's import row to <outDir>/importtime/import-time.json, where startRowsOfRecord looks for it. Returns the file. */
export function writeImportRow(outDir, row) {
  const file = path.join(outDir, IMPORT_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(row, null, 1)}
`)
  return file
}

/** The run set's import row beside a record file, or null when none was taken; an unreadable file is named in `problems`. */
function importRowBesideRecord(recordFile, problems) {
  if (typeof recordFile !== 'string') return null
  const file = path.join(path.dirname(recordFile), IMPORT_FILE)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { problems.push(`import row file ${IMPORT_FILE} unreadable: ${String(e.message ?? e).slice(0, 120)}`); return null }
}

/**
 * The start rows of one run record: its own `startRows` field when it has one, else (smoke build only) read back after the launch from
 * the run folder the record names: <run>/state/logs/backend.log and <run>/config/logs/shell.log, with the run set's import row from
 * <record folder>/importtime/import-time.json (see writeImportRow) stamped against this harness's backend tree. The measure build's
 * state folder is the lab's own, shared by every launch, so it is never read. Null when the record has no source for the rows.
 */
export function startRowsOfRecord(record) {
  if (record.startRows && Array.isArray(record.startRows.launches)) return record.startRows
  if (record.build !== 'smoke' || typeof record.stateFolder !== 'string') return null
  const run = path.dirname(record.stateFolder)
  const rows = startRowsOfFiles(path.join(run, 'config', 'logs', 'shell.log'), path.join(record.stateFolder, 'logs', 'backend.log'))
  const importRow = importRowBesideRecord(record.file, rows.problems)
  return importRow ? { ...rows, import: stampImportBackend(importRow, TERMINAL) } : rows
}

// ---- the summary over launches, and the report lines -----------------------------------------------------------------------
const PER_LAUNCH = START_ROWS.filter((r) => r.scope === 'launch').map((r) => r.id)

function cell(rowsList) {
  const read = rowsList.filter((r) => r && r.status === 'ok' && isNum(r.value))
  return { n: read.length, missing: rowsList.length - read.length, median: median(read.map((r) => r.value)) }
}

/** The median per row over every launch of every startRows object (one per counted record), with how many launches read nothing. */
export function summariseStartRows(list) {
  const launches = list.flatMap((s) => s.launches ?? [])
  const rows = Object.fromEntries(PER_LAUNCH.map((id) => [id, cell(launches.map((l) => l.rows[id]))]))
  rows.page_files_served.firstLoad = median(launches.map((l) => l.rows.page_files_served).filter((r) => r?.status === 'ok').map((r) => r.firstLoad))
  const imports = list.map((s) => s.import ?? null)
  const ownImports = imports.filter((r) => r?.backend !== 'other') // an import timed in another backend tree is not this build's figure
  rows.import_time_ms = { ...cell(ownImports), otherBackend: imports.length - ownImports.length, trees: [...new Set((imports.some((r) => r?.backend === 'other') && ownImports.length === 0 ? imports : ownImports).map((r) => r?.tree).filter(Boolean))] }
  rows.modules_without_bytecode = cell(ownImports.map((r) => r?.bytecode ?? null))
  const items = launches.flatMap((l) => l.rows.slow_requests?.items ?? [])
  const slowest = items.map((r, i) => ({ r, i })).sort((a, b) => b.r.ms - a.r.ms || a.i - b.i).slice(0, SLOWEST).map(({ r }) => r)
  const importProvisional = list.some((s) => s.import?.provisional === true) // the import was timed on a loaded machine (cpuLoadPct > 10)
  return { launches: launches.length, records: list.length, rows, slowest, importProvisional }
}

const fmt = (v) => String(round1(v))

function importText(def, c) {
  const trees = c.trees?.length ? `tree ${c.trees.join(', ')}` : ''
  if (c.n === 0) return c.otherBackend > 0 ? `${def.short} other backend${trees ? ` (${trees})` : ''}` : `${def.short} missing`
  const notes = [trees, c.otherBackend > 0 ? `${c.otherBackend} of ${c.n + c.otherBackend + c.missing} record(s) timed another backend` : '', c.missing > 0 ? `${c.missing} record(s) missing` : ''].filter(Boolean)
  return `${def.short} ${fmt(c.median)} ms${notes.length ? ` (${notes.join('; ')})` : ''}`
}

/** The HOME stage runs a different task list from the base build's (the base includes runs), so its figure is shown with that caveat. */
const STAGE_NOTE = 'task list differs: base build includes runs'

function rowText(def, c, noun) {
  if (def.id === 'import_time_ms' && (c.trees?.length || c.otherBackend > 0)) return importText(def, c)
  if (c.n === 0) return `${def.short} missing`
  const unit = def.unit === 'ms' ? ' ms' : ''
  const partial = c.missing > 0 ? ` (${c.missing} of ${c.n + c.missing} ${noun} missing)` : ''
  const first = isNum(c.firstLoad) && c.firstLoad !== c.median ? ` (${fmt(c.firstLoad)} on the first page load)` : ''
  const note = def.id === 'home_stage_ms' ? ` (${STAGE_NOTE})` : ''
  return `${def.short} ${fmt(c.median)}${unit}${first}${note}${partial}`
}

/** The informational lines of one build's summary: the rows in one line, the slowest requests in a second when any were read. */
export function startRowLines(summary, build, info) {
  const parts = START_ROWS.map((def) => {
    if (def.id === 'slow_requests') return summary.rows.slow_requests.n === 0 ? 'slowest HOME requests missing' : `slowest HOME request ${fmt(Math.max(...summary.slowest.map((r) => r.ms)))} ms`
    return rowText(def, summary.rows[def.id], def.scope === 'launch' ? 'launch(es)' : 'record(s)')
  })
  const provisional = summary.basis === 'provisional' || summary.importProvisional === true
  const counts = summary.basis ? `; basis ${summary.basis}: ${summary.accepted ?? 0} accepted and ${summary.provisional ?? 0} provisional record(s) with start rows` : ''
  const lines = [`${info}: start-up rows${provisional ? ' PROVISIONAL' : ''}, ${build} build, median of ${summary.launches} launch(es): ${parts.join(', ')}${counts}`]
  if (summary.slowest.length > 0) {
    const items = summary.slowest.map((r) => `${r.method ? `${r.method} ` : ''}${r.path} ${fmt(r.ms)} ms`)
    lines.push(`${info}: slowest HOME requests, ${build} build: ${items.join(', ')}`)
  }
  return lines
}

// ---- the in-process import time (importtime.py) ----------------------------------------------------------------------------
const insideRepo = (dir, repo) => {
  const rel = path.relative(path.resolve(repo).toLowerCase(), path.resolve(dir).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * The command that times the import in a child interpreter, as the shell starts the backend (-E -s -X utf8), with the bytecode cache and
 * the scratch state folder under `runDir`, NQT_JOBS=off. A run folder inside the repository is refused: nothing may be written there.
 */
export function importTimeCommand({ python = PY, runDir, repo = TERMINAL }) {
  if (insideRepo(runDir, repo)) throw new Error(`the run folder ${runDir} is inside the repository; the import timing writes bytecode and state there`)
  const pycachePrefix = path.join(runDir, 'pycache')
  const scratch = path.join(runDir, 'state')
  const args = ['-E', '-s', '-X', 'utf8', '-X', `pycache_prefix=${pycachePrefix}`, IMPORT_SCRIPT, '--scratch', scratch]
  return { python, args, env: { NQT_JOBS: 'off' }, pycachePrefix, scratch }
}

/** Which backend tree and interpreter a run timed: the folder holding nq_terminal, sys.executable, the Python version and the flags. */
function importIdentity(r) {
  const file = typeof r?.nq_terminal_file === 'string' ? r.nq_terminal_file : null
  return {
    tree: file ? path.dirname(path.dirname(file)) : null,
    executable: r?.executable ?? null,
    pythonVersion: typeof r?.python === 'string' ? r.python.split(' ')[0] : null,
    flags: r?.flags ?? null,
  }
}

/** The import row from the runs' outputs: the first run fills the bytecode cache and is reported apart; the rest give the median. */
export function summariseImportRuns(results, { cpuLoadPct = null } = {}) {
  if (!Array.isArray(results) || results.length < 2) return missing('needs a warm-up run and at least one measured run')
  const [warm, ...measured] = results
  const totals = measured.map((r) => r?.import_total_s)
  if (!totals.every(isNum)) return missing('a measured run did not report import_total_s')
  const bc = measured.at(-1)?.bytecode
  const names = bc ? [...(bc.missing ?? []), ...(bc.stale ?? [])] : null
  const bytecode = names ? ok(names.length, { names, checked: bc.checked ?? null }) : missing('importtime.py reported no bytecode check')
  return ok(Math.round(median(totals) * 1000), {
    runs: measured.length, warmup: isNum(warm?.import_total_s) ? Math.round(warm.import_total_s * 1000) : null,
    modulesLoaded: measured.at(-1).modules_loaded ?? null, ...importIdentity(measured.at(-1)), bytecode, cpuLoadPct, provisional: isNum(cpuLoadPct) && cpuLoadPct > 10,
  })
}

/** Runs importtime.py `runs` times (one warm-up plus the measured ones) and returns the summary row. Starts only the interpreter. */
export function runImportTime({ python = PY, runDir, runs = 4, cpuLoadPct = null, timeoutMs = 120_000 }) {
  const cmd = importTimeCommand({ python, runDir })
  fs.mkdirSync(cmd.scratch, { recursive: true }) // importtime.py writes no file; the scratch folder is made here
  const results = []
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(cmd.python, cmd.args, { env: { ...process.env, ...cmd.env }, encoding: 'utf8', windowsHide: true, timeout: timeoutMs })
    if (r.status !== 0) return missing(`importtime.py run ${i + 1} exited ${r.status}: ${String(r.stderr).trim().slice(-300)}`)
    try { results.push(JSON.parse(String(r.stdout).trim().split(/\r?\n/).at(-1))) } catch { return missing(`importtime.py run ${i + 1} printed no readable result`) }
  }
  return summariseImportRuns(results, { cpuLoadPct })
}

// node startrows.mjs SHELL_LOG BACKEND_LOG: the per-launch rows of two logs as JSON (a merge-time reading of an existing run folder).
// node startrows.mjs import-time OUTDIR [CPU_LOAD_PCT]: the run set's import row (starts only the lab interpreter, bytecode and scratch
// state under OUTDIR/importtime), written to OUTDIR/importtime/import-time.json for the records of OUTDIR.
if (isMainModule(import.meta.url)) {
  const [first, second, third] = process.argv.slice(2)
  if (first === 'import-time') {
    if (!second) { console.error('usage: node startrows.mjs import-time OUTDIR [CPU_LOAD_PCT]'); process.exit(2) }
    const load = third === undefined ? null : Number(third)
    const row = runImportTime({ runDir: path.join(second, 'importtime'), cpuLoadPct: Number.isFinite(load) ? load : null })
    console.log(writeImportRow(second, row))
    process.exit(row.status === 'ok' ? 0 : 1)
  }
  if (!first || !second) { console.error('usage: node startrows.mjs SHELL_LOG BACKEND_LOG | import-time OUTDIR [CPU_LOAD_PCT]'); process.exit(2) }
  const s = startRowsOfFiles(first, second)
  console.log(JSON.stringify({ ...s, summary: summariseStartRows([s]) }, null, 1))
}
