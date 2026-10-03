// Stage 1 numbers (roadmap D3.4, 02 sections 4 and 4.1, 03 section 18): backend ready, the cold-HOME launch, the eight
// cached routes at the browser caps and at the desktop caps, and EQ and REG on real data. Run by the merge of the wave,
// alone, in a quiet window; README.md in this folder says what each figure is and how to read the records.
//
//   node measure_stage1.mjs [--dry] [--only ready,home,routes,screens] [--out DIR] [--port 8797] [--runs 3]
//                           [--screen-runs 5] [--screen-modes browser,desktop] [--gate-seconds 60] [--limit-pct 10]
//                           [--max-rejects 2] [--libs DIR] [--tmp DIR] [--quiet-window (the owner named this window)]
//                           [--home fresh,disk]
//
// First-launch mode: `--only home --home fresh` takes the cold HOME on an empty state folder alone (the launch T3 is
// read on, 02 section 4.1 item 3); `--home disk` takes the usual launch alone (a state folder an earlier launch filled).
//
// Each group runs behind the window watch (any new visible window or change of foreground fails it), each run behind the
// CPU gate (a reading over the limit rejects the attempt and the record is kept; after --max-rejects readings the run is
// taken anyway and labelled PROVISIONAL: the script never waits for ever and never loosens a threshold).
// The real backend is started on --port (never 8765) with its own temporary NQT_STATE_DIR and NQT_JOBS=off; every spawn is
// hidden and stopped by identity (pid and creation time); browsers are headless; Python only as the venv python.exe by
// module or script; everything is written under D:\dev. The four research files are hashed before and after, and the gate
// log may only grow by lines of caller "terminal" inside the fence. The helpers (CPU gate, window watch, identity-checked
// stop, slot policy) are the machine-local tools of the T2 harness in D:\dev\spikes\t2\lib (--libs).
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const LAB = 'C:\\Users\\Fatih Hekimoglu\\nq-lab'
const TERMINAL = `${LAB}\\terminal`
const PY = `${LAB}\\.venv\\Scripts\\python.exe`
const RESULTS = `${LAB}\\results`
const OOS_LOG = `${RESULTS}\\oos_access_log.jsonl`
const RESEARCH_FILES = ['ledger.csv', 'registry.csv', 'oos_openings.json']
const LOOPBACK = '127.0.0.1'
const REAL_PORT = 8765
const GROUPS = ['ready', 'home', 'routes', 'screens']
const FENCE_END = '2022-01-01 00:00:00+00:00'
const READY_CEILING_MS = 2500 // T3, 02 section 9
const READY_TARGET_MS = 1500
const HOME_TARGET_MS = 4500 // 02 section 4.1
const HOME_CAP_MS = 6000 // 02 section 4.1: the cold-HOME ceiling is never above this
// 02 section 4.1 item 3, decided (DEC1, 3 October 2026, the decision the owner delegated): the cold-HOME cap holds on every
// launch, and the launch it is read on is the worst one, the very first launch after an install with an empty state folder.
const HOME_READING = 'first-launch'
const HOME_READING_RATIFIED = true
const HOME_USUAL_MEDIAN_W3B_MS = 3757 // the usual launch median recorded at W3B: the DEC1 exit criterion is not slower than this, so it is the no-regression line
const HOME_USUAL_CEILING_W3B_MS = 4508 // the noise allowance (3,757 ms x 1.2), reported beside the verdict and never the gate
const HOME_MODES = ['fresh', 'disk']
const ROUTE_TARGET_MS = 100
const ROUTE_CEILING_MS = 300
const SCREEN_TARGET_MS = 1000
const SCREEN_CEILING_MS = 1500
const BLANKED = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C']
const STRIPPED = ['NQT_JOBS', 'NQT_PREWARM', 'NQT_DESKTOP', 'NQT_STDIN_CONTROL', 'NQT_CACHE_BYTES', 'NQT_FIXTURE_DIR', 'NQT_DEV', 'NQT_STATE_DIR', 'NQT_FIXTURE_JOBS']
const GRID = '[role="grid"]:not([aria-rowcount="1"])'
const KEY_FIGURES = 'ul[aria-label="Tear sheet key figures"] .kpi-value, ul[aria-label^="Key figures for "] .kpi-value'
// What each HOME panel shows once its data is in (restated from web/e2e/perf/pages.ts HOME_READY).
const HOME_PANELS = [['NQ GP 1d', ['[role="img"][aria-label^="NQ1 Index: "]']], ['27F MON', [GRID]], ['volmanaged_v0 EQ', [KEY_FIGURES, '[role="img"]']], ['REG', [GRID]]]
const SCREENS = [{ line: 'volmanaged_v0 EQ', ready: [KEY_FIGURES, '[role="img"]'] }, { line: 'REG', ready: [GRID] }]
// A clean headless context at the size and look of the project's own runs (web/playwright.config.ts).
const CONTEXT_OPTIONS = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' }

// ---------------------------------------------------------------- small pure helpers (checked by --dry)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const pad = (n) => String(n).padStart(2, '0')
const iso = () => new Date().toISOString()

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return null
  return n % 2 === 1 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2)
}

/** 02 section 4.1: the median of the cold launches plus 20%, never above 6 s. */
export function homeCeilingMs(medianMs) {
  return medianMs === null ? null : Math.min(HOME_CAP_MS, Math.round(medianMs * 1.2))
}

/** HMAC-SHA256 keyed by the token's raw bytes over `kind|nonce|port|pid` (backend desktop/handshake.py `mac`). */
export function mac(token, kind, nonce, port, pid) {
  return crypto.createHmac('sha256', Buffer.from(token, 'hex')).update(`${kind}|${nonce}|${port}|${pid}`, 'ascii').digest('hex')
}

/** Whether a READY payload carries the proof the token holder would give for this nonce. */
export function readyProofHolds(payload, token, nonce) {
  if (typeof payload?.proof !== 'string' || !/^[0-9a-f]{64}$/.test(payload.proof)) return false
  const expected = Buffer.from(mac(token, 'ready', nonce, payload.port, payload.pid), 'hex')
  const given = Buffer.from(payload.proof, 'hex')
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

/** Whether `after` is `before` plus whole lines of caller "terminal" whose windows end inside the fence. */
export function gateLogGrewCleanly(beforeText, afterText) {
  if (!afterText.startsWith(beforeText)) return { clean: false, added: 0, reason: 'the log no longer starts with its earlier bytes' }
  const lines = afterText.slice(beforeText.length).split('\n').filter(Boolean)
  const bad = lines.filter((line) => {
    try {
      const entry = JSON.parse(line)
      return entry.caller !== 'terminal' || !(String(entry.end) <= FENCE_END)
    } catch {
      return true
    }
  })
  return { clean: bad.length === 0, added: lines.length, badLines: bad.length }
}

// ---------------------------------------------------------------- configuration

export function readConfig(argv) {
  const opt = (name, fallback) => (argv.includes(`--${name}`) && argv[argv.indexOf(`--${name}`) + 1] !== undefined ? argv[argv.indexOf(`--${name}`) + 1] : fallback)
  const list = (name, fallback) => opt(name, fallback).split(',').filter(Boolean)
  const config = {
    dry: argv.includes('--dry'), port: Number(opt('port', 8797)), out: opt('out', 'D:/dev/spikes/w3b/stage1'), tmp: opt('tmp', 'D:/dev/tmp'),
    libs: opt('libs', 'D:/dev/spikes/t2/lib'), runs: Number(opt('runs', 3)), screenRuns: Number(opt('screen-runs', 5)), gateSeconds: Number(opt('gate-seconds', 60)),
    limitPct: Number(opt('limit-pct', 10)), maxRejects: Number(opt('max-rejects', 2)), only: list('only', GROUPS.join(',')), screenModes: list('screen-modes', 'browser,desktop'), quietWindow: argv.includes('--quiet-window'),
    homeModes: list('home', HOME_MODES.join(',')),
  }
  const problems = []
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || config.port === REAL_PORT) problems.push(`--port must be a spare port from 1024 to 65535, not ${REAL_PORT}`)
  for (const name of ['out', 'tmp', 'libs']) if (!/^[dD]:[\\/]dev[\\/]/.test(config[name])) problems.push(`--${name} must be under D:/dev, got ${config[name]}`)
  for (const name of ['runs', 'screenRuns', 'maxRejects']) if (!Number.isInteger(config[name]) || config[name] < 1) problems.push(`--${name} must be a whole number of at least 1`)
  if (!(config.gateSeconds >= 0)) problems.push('--gate-seconds must be 0 or more')
  if (config.only.some((group) => !GROUPS.includes(group)) || config.screenModes.some((mode) => !['browser', 'desktop'].includes(mode))) problems.push('--only or --screen-modes names something unknown')
  if (config.homeModes.length === 0 || config.homeModes.some((mode) => !HOME_MODES.includes(mode))) problems.push(`--home takes ${HOME_MODES.join(' and or ')}`)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return config
}

const CFG = readConfig(process.argv.slice(2))
const BASE = `http://${LOOPBACK}:${CFG.port}`
let L = null // the T2 helpers, loaded by loadHelpers
let RUN_DIR = ''

async function loadHelpers(dir) {
  const load = (name) => import(pathToFileURL(path.join(dir, name)).href)
  const [gate, slot, watch, mem, stop, cdp] = await Promise.all(['gate.mjs', 'readygate.mjs', 'winwatch.mjs', 'mem.mjs', 'stop.mjs', 'cdp.mjs'].map(load))
  return { readCpu: gate.readCpu, runSlotGated: slot.runSlotGated, startWatch: watch.startWatch, stopWatch: watch.stopWatch, treeIdentity: mem.treeIdentity, stopOwned: stop.stopOwned }
}

// ---------------------------------------------------------------- records, machine facts, provenance

const saveJson = (name, value) => fs.writeFileSync(path.join(RUN_DIR, name), `${JSON.stringify(value, null, 1)}\n`)
const say = (value) => console.log(JSON.stringify(value))
const freeMb = (drive) => Math.round((fs.statfsSync(`${drive}\\`).bavail * fs.statfsSync(`${drive}\\`).bsize) / 2 ** 20)
const temps = []
const makeTemp = (label) => temps[temps.push(fs.mkdtempSync(path.join(CFG.tmp, `nqt-s1-${label}-`))) - 1]
const listFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map(String)

function cpuTotals() {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
  }
  return { idle, total }
}

const busyPct = (a, b) => (b.total - a.total > 0 ? Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 1000) / 10 : 0)

/** Samples the machine's CPU once a second until the returned function is called; it returns the average and the peak. */
function sampleCpu() {
  const first = cpuTotals()
  let previous = first
  const samples = []
  const timer = setInterval(() => {
    const now = cpuTotals()
    samples.push(busyPct(previous, now))
    previous = now
  }, 1000)
  return () => {
    clearInterval(timer)
    return { avgPct: busyPct(first, cpuTotals()), maxPct: samples.length ? Math.max(...samples) : 0, seconds: samples.length }
  }
}

function provenance() {
  const git = (...args) => execFileSync('git', ['-C', TERMINAL, ...args], { windowsHide: true, maxBuffer: 1 << 28 })
  const names = git('ls-files', '--others', '--exclude-standard').toString('utf8').split('\n').filter(Boolean).sort()
  const untracked = crypto.createHash('sha256')
  for (const name of names) untracked.update(`${name}\0`).update(fs.readFileSync(path.join(TERMINAL, name))).update('\0')
  return { head: git('rev-parse', 'HEAD').toString('utf8').trim(), diffSha256: sha(git('diff', 'HEAD')), untrackedSha256: untracked.digest('hex'), untrackedFiles: names.length }
}

function stateListing() {
  const folder = path.join(TERMINAL, 'state')
  if (!fs.existsSync(folder)) return {}
  return Object.fromEntries(listFiles(folder).map((name) => [name, fs.statSync(path.join(folder, name)).mtimeMs]))
}

function researchSnapshot() {
  const text = fs.readFileSync(OOS_LOG, 'utf8')
  return { text, hashes: RESEARCH_FILES.map((name) => sha(fs.readFileSync(path.join(RESULTS, name)))), logLines: text.split('\n').filter(Boolean).length }
}

function researchVerdict(before) {
  const after = researchSnapshot()
  return { filesUnchanged: after.hashes.every((hash, i) => hash === before.hashes[i]), gateLog: gateLogGrewCleanly(before.text, after.text), logLinesBefore: before.logLines, logLinesAfter: after.logLines }
}

function machineFacts() {
  return { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model.trim() ?? null, totalMemMb: Math.round(os.totalmem() / 2 ** 20), freeMemMb: Math.round(os.freemem() / 2 ** 20), cFreeMb: freeMb('C:'), dFreeMb: freeMb('D:'), node: process.version }
}

// ---------------------------------------------------------------- the backend under test

const ALLOW_LIST_CODE = 'import json; from nq_terminal.desktop.envlist import backend_env; print(json.dumps(backend_env()))'

/**
 * The environment of the backend under test: the allow list of desktop/envlist.py (what the shell and smoke_real.ps1 pass),
 * built by the venv Python from this script's own NQT_* values. No name of the parent environment that the list does not
 * name (an API key, a token, a stray switch) reaches the backend.
 */
export function backendEnv(mode, stateDir, parent = process.env) {
  const env = { ...parent }
  for (const name of Object.keys(env)) if (STRIPPED.includes(name.toUpperCase())) delete env[name]
  for (const name of BLANKED) env[name] = ''
  Object.assign(env, { NQT_PORT: String(CFG.port), NQT_STATE_DIR: stateDir, NQT_JOBS: 'off' })
  if (mode === 'desktop') env.NQT_DESKTOP = '1'
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = (env[pathKey] ?? '').split(';').filter((part) => !/^[dD]:\\dev\\(mingw|cargo)/.test(part)).join(';') // no build tools on the PATH of anything launched
  const printed = execFileSync(PY, ['-X', 'utf8', '-c', ALLOW_LIST_CODE], { cwd: `${TERMINAL}\\backend`, env, windowsHide: true, encoding: 'utf8' })
  const lines = printed.split('\n').filter(Boolean)
  return JSON.parse(lines[lines.length - 1])
}

async function proofAnswers(port) {
  try {
    const answer = await fetch(`http://${LOOPBACK}:${port}/api/desktop/proof?nonce=${'0'.repeat(64)}`, { signal: AbortSignal.timeout(2000) })
    await answer.arrayBuffer()
    return answer.status === 200
  } catch {
    return false
  }
}

/** The NQT-READY line of a desktop-mode backend, verified against the token and nonce that were written on its stdin. */
function waitForReadyLine(child, token, nonce, tee = -1) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no NQT-READY line in 60 s')), 60_000)
    child.once('exit', (code) => reject(new Error(`the backend exited (${code}) before it was ready`)))
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (tee >= 0) fs.writeSync(tee, `${line}\n`)
      if (!line.startsWith('NQT-READY ')) return
      clearTimeout(timer)
      const payload = JSON.parse(line.slice('NQT-READY '.length))
      if (readyProofHolds(payload, token, nonce)) resolve(payload)
      else reject(new Error('the NQT-READY proof does not verify against the token and nonce'))
    })
  })
}

async function pollProof(child, started) {
  const end = performance.now() + 60_000
  while (performance.now() < end) {
    if (child.exitCode !== null) throw new Error(`the backend exited (${child.exitCode}) before it was ready`)
    if (await proofAnswers(CFG.port)) return Math.round(performance.now() - started)
    await sleep(10)
  }
  throw new Error('no answer from the proof route in 60 s')
}

/** Starts the real backend on CFG.port in `mode` ('browser': the launchers' door, 'desktop': as the shell starts it, TOKEN and NONCE on stdin). */
async function startBackend({ mode, stateDir, label }) {
  if (await proofAnswers(CFG.port)) throw new Error(`port ${CFG.port} already answers; not started by this script`)
  const desktop = mode === 'desktop'
  const log = fs.openSync(path.join(RUN_DIR, `${label}.err.log`), 'w')
  const tee = desktop ? fs.openSync(path.join(RUN_DIR, `${label}.out.log`), 'w') : -1
  const [token, nonce] = [crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')]
  const started = performance.now()
  const child = spawn(PY, ['-E', '-s', '-X', 'utf8', '-m', 'nq_terminal'], {
    cwd: `${TERMINAL}\\backend`, env: backendEnv(mode, stateDir), windowsHide: true, stdio: [desktop ? 'pipe' : 'ignore', desktop ? 'pipe' : log, log],
  })
  const proc = { child, mode, stateDir, handshake: null, token }
  try {
    if (desktop) {
      child.stdin.write(`TOKEN ${token}\nNONCE ${nonce}\n`)
      proc.handshake = await waitForReadyLine(child, token, nonce, tee)
    } else {
      proc.readyMs = await pollProof(child, started)
      proc.token = JSON.parse(fs.readFileSync(path.join(stateDir, 'backend.lock'), 'utf8')).token
    }
    proc.readyMs ??= Math.round(performance.now() - started)
  } catch (error) {
    await stopBackend(proc)
    throw error
  }
  return proc
}

/** Stops one backend by identity: stdin closed first in desktop mode (the watchdog), then only processes proved to be ours. */
async function stopBackend(proc) {
  const tree = proc.child.exitCode === null ? L.treeIdentity(proc.child.pid) : []
  if (proc.mode === 'desktop' && proc.child.exitCode === null) {
    proc.child.stdin?.end()
    await Promise.race([new Promise((resolve) => proc.child.once('exit', resolve)), sleep(6000)])
  }
  const stopped = await L.stopOwned(proc.child, tree, { wait: () => sleep(1000) })
  return { survivors: stopped.survivors.length, killed: stopped.killed.length, portStillAnswers: await proofAnswers(CFG.port) }
}

/** The session the shell buys: the token and the page's origin give a cookie. */
async function shellSession(proc) {
  const answer = await fetch(`${BASE}/api/session`, { headers: { authorization: `NQT ${proc.token}`, 'x-nqt-origin': BASE } })
  const pair = (answer.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  const at = pair.indexOf('=')
  if (!answer.ok || at < 1) throw new Error(`the backend refused a session (HTTP ${answer.status})`)
  return { name: pair.slice(0, at), value: pair.slice(at + 1), header: pair, cookie: { name: pair.slice(0, at), value: pair.slice(at + 1), domain: LOOPBACK, path: '/api', httpOnly: true, sameSite: 'Strict', secure: false } }
}

async function timedGet(session, url) {
  const started = performance.now()
  const answer = await fetch(BASE + url, { headers: { cookie: session.header }, signal: AbortSignal.timeout(300_000) })
  const body = Buffer.from(await answer.arrayBuffer())
  return { url, status: answer.status, ms: Math.round(performance.now() - started), bytes: body.length, sha: sha(body), body }
}

const slim = ({ body, ...rest }) => rest

// ---------------------------------------------------------------- the CPU gate and the slot policy

async function gateReading() {
  if (CFG.gateSeconds === 0) return { startedAtIso: iso(), seconds: 0, avgPct: null, maxPct: null, limitPct: CFG.limitPct, enforced: false, pass: true, samples: [] }
  return L.readCpu(CFG.gateSeconds, { limitPct: CFG.limitPct, enforce: true })
}

/** `count` runs of `runOne(slot)` (it returns `{ headline: { ms }, ... }`), each behind the gate; PROVISIONAL after the last rejected reading. */
async function runSeries(name, count, runOne) {
  const slots = []
  for (let slot = 1; slot <= count; slot++) {
    slots.push(await L.runSlotGated({
      slot, maxRejects: CFG.maxRejects, gateFn: gateReading,
      onReject: (s, attempt, gate) => {
        saveJson(`${name}-${pad(s)}-a${attempt}-rejected.json`, { schema: 'stage1-1', series: name, slot: s, attempt, status: 'rejected', reason: `average CPU ${gate.avgPct}% over ${gate.seconds} s is above ${CFG.limitPct}%`, gate })
        say({ series: name, slot: s, attempt, status: 'rejected', avgPct: gate.avgPct })
      },
      runFn: async (s, gate, status) => {
        const stopCpu = sampleCpu()
        const outcome = await runOne(s).catch((error) => { stopCpu(); throw error })
        const record = { schema: 'stage1-1', series: name, slot: s, status, label: status === 'provisional' ? 'PROVISIONAL' : 'ACCEPTED', startedAtIso: iso(), gate, cpuDuringRun: stopCpu(), ...outcome }
        saveJson(`${name}-${pad(s)}.json`, record)
        say({ series: name, slot: s, status, gateAvgPct: gate.avgPct, cpuDuringAvgPct: record.cpuDuringRun.avgPct, ...outcome.headline })
        return record
      },
    }))
  }
  const values = slots.map((slot) => slot.record.headline.ms)
  const accepted = slots.filter((slot) => slot.status === 'accepted').length
  return {
    series: name, valuesMs: values, medianMs: median(values), minMs: Math.min(...values), maxMs: Math.max(...values), acceptedRuns: accepted, provisionalRuns: slots.length - accepted,
    rejectedReadings: slots.reduce((total, slot) => total + slot.attempts - 1, 0), label: accepted === slots.length ? 'ACCEPTED' : 'PROVISIONAL', records: slots.map((slot) => slot.record),
  }
}

// ---------------------------------------------------------------- group: ready

async function readyRun(mode, slot) {
  const stateDir = makeTemp(`ready-${mode}`)
  const proc = await startBackend({ mode, stateDir, label: `ready-${mode}-${pad(slot)}` })
  try {
    const first = await timedGet(await shellSession(proc), '/api/health')
    const health = JSON.parse(first.body.toString('utf8'))
    const handshake = proc.handshake && { mode: proc.handshake.mode, dist: proc.handshake.dist, contract: proc.handshake.contract, port: proc.handshake.port }
    return { mode, headline: { ms: proc.readyMs }, firstHealthWithSessionMs: first.ms, health: { dist: health.dist, portFixed: health.port_fixed, contract: health.contract }, handshake }
  } finally {
    // The backend first: it holds backend.lock open, and Windows refuses to delete a file that is open (EPERM), which
    // would also have skipped the stop and hidden the error that brought us here.
    const stop = await stopBackend(proc)
    fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 })
    say({ ready: mode, stop })
  }
}

const groupReady = async () => ({
  browser: await runSeries('ready-browser', CFG.runs, (slot) => readyRun('browser', slot)),
  desktop: await runSeries('ready-desktop', CFG.runs, (slot) => readyRun('desktop', slot)),
})

// ---------------------------------------------------------------- group: home (the cold launch)

const twoFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))))

/** Nothing loading and, for each `[title, selectors]` of `panels`, the panel there with its data; then two frames painted. */
async function waitSettled(page, panels = []) {
  await page.waitForFunction((wanted) => {
    if (document.querySelector('p.ws-empty') || document.querySelector('[aria-busy="true"]')) return false
    return wanted.every(([title, ready]) => {
      const panel = document.querySelector(`[data-nqt-title="${title}"]`)
      return panel !== null && ready.every((selector) => panel.querySelector(selector) !== null)
    })
  }, panels, { timeout: 120_000, polling: 'raf' })
  await twoFrames(page)
}

/** One cold launch: the clock starts before the backend is spawned and stops when the four HOME panels have settled. */
async function homeRun(browser, stateDir, label) {
  const context = await browser.newContext(CONTEXT_OPTIONS)
  const page = await context.newPage() // the window exists before the backend does, as the shell's splash does
  const finished = []
  const errors = []
  let clockEpochMs = null // the wall clock when the launch clock started, so each request is placed on the launch's own time line
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('requestfinished', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    const timing = request.timing()
    finished.push({ path: `${url.pathname}${url.search}`.slice(0, 100), endMs: Math.round(timing.responseEnd), ...requestOnClock(timing, clockEpochMs) })
  })
  clockEpochMs = Date.now()
  const started = performance.now()
  let proc = null
  try {
    proc = await startBackend({ mode: 'desktop', stateDir, label })
    const afterBackend = performance.now()
    await context.addCookies([(await shellSession(proc)).cookie])
    const afterSession = performance.now()
    await page.goto(`${BASE}/`, { waitUntil: 'commit' })
    await waitSettled(page, HOME_PANELS)
    const done = performance.now()
    return {
      headline: { ms: Math.round(done - started) }, backendReadyMs: Math.round(afterBackend - started), sessionMs: Math.round(afterSession - afterBackend), pageMs: Math.round(done - afterSession),
      dist: proc.handshake.dist, slowestApi: [...finished].sort((a, b) => b.endMs - a.endMs).slice(0, 6), pageErrors: errors, stateFilesAfter: listFiles(stateDir),
      apiTimeline: [...finished].sort((a, b) => (a.startOnClockMs ?? 0) - (b.startOnClockMs ?? 0)), // diagnosis only: the headline is unchanged
    }
  } finally {
    await context.close()
    if (proc !== null) say({ label, stop: await stopBackend(proc) })
  }
}

/** Where a request sat on the launch's clock: Playwright's `startTime` is wall-clock milliseconds, its other fields are relative to it. */
export function requestOnClock(timing, clockEpochMs) {
  if (clockEpochMs === null || !(timing?.startTime > 0)) return {}
  const startOnClockMs = Math.round(timing.startTime - clockEpochMs)
  return { startOnClockMs, endOnClockMs: timing.responseEnd >= 0 ? Math.round(startOnClockMs + timing.responseEnd) : null }
}

async function homeFresh(browser) {
  return runSeries('home-fresh', CFG.runs, (slot) => homeRun(browser, makeTemp(`home-fresh-${slot}`), `home-fresh-${pad(slot)}`))
}

async function homeDisk(browser) {
  const diskState = makeTemp('home-disk')
  const prime = await homeRun(browser, diskState, 'home-disk-prime') // not counted: it fills the state folder as a first use does
  saveJson('home-disk-prime.json', { schema: 'stage1-1', series: 'home-disk-prime', note: 'not counted: fills the state folder the counted launches then find', ...prime })
  return { disk: await runSeries('home-disk', CFG.runs, () => homeRun(browser, diskState, 'home-disk')), primeMs: prime.headline.ms }
}

async function groupHome(chromium) {
  const browser = await chromium.launch({ headless: true })
  try {
    const fresh = CFG.homeModes.includes('fresh') ? await homeFresh(browser) : undefined
    const usual = CFG.homeModes.includes('disk') ? await homeDisk(browser) : {}
    return { ...(fresh ? { fresh } : {}), ...usual }
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------- group: routes (the eight cached routes)

function routeTable(runIds) {
  const nt = runIds.filter((id) => id.startsWith('nt_'))
  return {
    compare: `/api/runs/compare?ids=${nt.slice(0, 2).join(',')}`, ledger: '/api/ledger', two_day: '/api/market/two-day', hypothesis_bootstrap: '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1',
    run_bootstrap: `/api/analytics/run/${nt[0]}/bootstrap`, deflated: '/api/analytics/deflated', seasonality: '/api/seasonality/instrument/NQ', spa: '/api/analytics/spa',
  }
}

async function runIds(session) {
  const body = JSON.parse((await timedGet(session, '/api/runs')).body.toString('utf8'))
  return (Array.isArray(body) ? body : (body.runs ?? body.items ?? [])).map((run) => run.run_id ?? run.id).filter(Boolean)
}

/** Per route: a cold call and three repeats; then three passes over all eight in turn (every entry has to stay cached together). */
async function callEveryRoute(session, routes) {
  const perRoute = {}
  for (const [name, url] of Object.entries(routes)) {
    const calls = []
    for (let i = 0; i < 4; i++) calls.push(await timedGet(session, url))
    perRoute[name] = { url, cold: slim(calls[0]), repeats: calls.slice(1).map(slim), repeatsByteEqual: calls.every((call) => call.sha === calls[0].sha && call.status === calls[0].status) }
  }
  const passes = []
  for (let pass = 1; pass <= 3; pass++) {
    const times = {}
    for (const [name, url] of Object.entries(routes)) times[name] = (await timedGet(session, url)).ms
    passes.push(times)
  }
  return { perRoute, passes }
}

/** The second process on the same state folder: the two routes on the disk allow list come back from disk, the rest recompute. */
async function callAfterRestart(mode, routes, stateDir, perRoute) {
  const second = await startBackend({ mode, stateDir, label: `routes-${mode}-restart` })
  try {
    const session = await shellSession(second)
    const restart = {}
    for (const [name, url] of Object.entries(routes)) {
      const call = await timedGet(session, url)
      restart[name] = { ...slim(call), sameBodyAsFirstProcess: call.sha === perRoute[name].cold.sha }
    }
    return { readyMs: second.readyMs, restart }
  } finally {
    await stopBackend(second)
  }
}

function routeVerdict({ perRoute, passes }) {
  const times = [...Object.values(perRoute).flatMap((route) => route.repeats.map((call) => call.ms)), ...passes.flatMap((pass) => Object.values(pass))]
  const worst = Math.max(...times)
  return { repeatCalls: times.length, worstRepeatMs: worst, targetMs: ROUTE_TARGET_MS, ceilingMs: ROUTE_CEILING_MS, withinTarget: worst <= ROUTE_TARGET_MS, withinCeiling: worst <= ROUTE_CEILING_MS }
}

async function routesRun(mode) {
  const stateDir = makeTemp(`routes-${mode}`)
  const first = await startBackend({ mode, stateDir, label: `routes-${mode}-first` })
  let result
  let routes
  try {
    const session = await shellSession(first)
    routes = routeTable(await runIds(session))
    result = await callEveryRoute(session, routes)
  } finally {
    say({ routes: mode, stop: await stopBackend(first) })
  }
  const verdict = routeVerdict(result)
  const restart = await callAfterRestart(mode, routes, stateDir, result.perRoute)
  const stateFilesAfter = listFiles(stateDir)
  fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 })
  return { mode, headline: { ms: verdict.worstRepeatMs }, ...result, verdict, restart, stateFilesAfter, prewarm: mode === 'desktop' ? 'on (NQT_DESKTOP=1 starts it, so cold figures are taken with it in flight)' : 'off' }
}

async function groupRoutes() {
  const browser = await runSeries('routes-browser-caps', 1, () => routesRun('browser'))
  const desktop = await runSeries('routes-desktop-caps', 1, () => routesRun('desktop'))
  const [a, b] = [browser.records[0].perRoute, desktop.records[0].perRoute]
  return { browser, desktop, sameColdBodyAcrossCaps: Object.fromEntries(Object.keys(a).map((name) => [name, a[name].cold.sha === b[name].cold.sha])) }
}

// ---------------------------------------------------------------- group: screens (EQ and REG on real data)

/** Times Enter (the W1B unit) or Shift+Enter (a new panel) on `screen.line` until every panel of that screen shows its data and nothing is loading. */
async function timeOpen(page, screen, key) {
  const command = page.getByRole('combobox', { name: 'Command line' })
  await page.keyboard.press('Control+k')
  await command.fill(screen.line)
  const before = await page.locator(`[data-nqt-title="${screen.line}"]`).count()
  const started = Date.now()
  await command.press(key)
  const expected = before + (key === 'Enter' ? 0 : 1)
  try {
    await page.waitForFunction(({ title, ready, count }) => {
      const all = [...document.querySelectorAll(`[data-nqt-title="${title}"]`)]
      if (all.length < count || document.querySelector('p.ws-empty') || document.querySelector('[aria-busy="true"]')) return false
      return all.every((panel) => ready.every((selector) => panel.querySelector(selector) !== null))
    }, { title: screen.line, ready: screen.ready, count: expected }, { timeout: 60_000, polling: 'raf' })
  } catch (error) {
    // Say what the page was showing, so a timeout is a finding and not a mystery.
    const state = await page.evaluate((title) => ({
      panels: document.querySelectorAll(`[data-nqt-title="${title}"]`).length, empty: document.querySelector('p.ws-empty') !== null,
      busy: [...document.querySelectorAll('[aria-busy="true"]')].map((el) => el.closest('[data-nqt-title]')?.getAttribute('data-nqt-title') ?? el.tagName).slice(0, 8),
      message: document.querySelector('.msg-line')?.textContent ?? null,
    }), screen.line).catch(() => null)
    throw new Error(`${screen.line} ${key}: not settled in 60 s (expected ${expected} panels; page: ${JSON.stringify(state)}): ${String(error.message ?? error).split('\n')[0]}`)
  }
  await twoFrames(page)
  return Date.now() - started
}

/** One page load, then both units: the W1B unit (Enter, the screen HOME already holds) and a new panel (Shift+Enter, one more). */
async function openBoth(browser, session, screen) {
  const context = await browser.newContext(CONTEXT_OPTIONS)
  try {
    await context.addCookies([session.cookie])
    // A screen is timed from the same HOME every time: the workspace store is answered 404 (as by an older backend), so the
    // panel one open adds is not saved there and met by the next, which opens in a fresh context. (The HOME series keeps
    // the store: its backends have a state folder of their own, and the cost of the store's reads is part of a launch.)
    await context.route('**/api/workspaces/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"not found"}' }))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`${BASE}/`, { waitUntil: 'load' })
    await page.getByRole('combobox', { name: 'Command line' }).waitFor({ timeout: 60_000 })
    await page.locator('p.ws-empty').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined)
    const legacyMs = await timeOpen(page, screen, 'Enter')
    await waitSettled(page)
    return { legacyMs, newPanelMs: await timeOpen(page, screen, 'Shift+Enter'), errors }
  } finally {
    await context.close()
  }
}

/**
 * The judged figure of a screen is the Enter unit (the W1B unit, the one the 1 s target and the W0B baseline use, d1_numbers.md): a fresh
 * context asks the backend for the screen's data. The new-panel unit (Shift+Enter right after Enter on the same page) repeats the query keys the
 * page's own cache (30 s staleTime) already holds, so it makes no backend request and is a render time: it is recorded, never judged.
 */
export function screenVerdict(enterMs, newPanelMs) {
  const [enter, panel] = [median(enterMs), median(newPanelMs)]
  return {
    medianLegacyMs: enter, medianNewPanelMs: panel, judgedUnit: 'enter', enterWithinTarget: enter <= SCREEN_TARGET_MS, enterWithinCeiling: enter <= SCREEN_CEILING_MS,
    worstEnterMs: Math.max(...enterMs), newPanelJudged: false,
  }
}

async function screensRun(chromium, mode) {
  const stateDir = makeTemp(`screens-${mode}`)
  const proc = await startBackend({ mode, stateDir, label: `screens-${mode}` })
  const browser = await chromium.launch({ headless: true })
  try {
    const session = await shellSession(proc)
    const screens = {}
    for (const screen of SCREENS) {
      const cold = await openBoth(browser, session, screen) // the first open on this backend primes its caches
      const warm = []
      for (let i = 0; i < CFG.screenRuns; i++) warm.push(await openBoth(browser, session, screen))
      screens[screen.line] = {
        cold: { legacyMs: cold.legacyMs, newPanelMs: cold.newPanelMs }, warmLegacyMs: warm.map((run) => run.legacyMs), warmNewPanelMs: warm.map((run) => run.newPanelMs),
        ...screenVerdict(warm.map((run) => run.legacyMs), warm.map((run) => run.newPanelMs)), targetMs: SCREEN_TARGET_MS, ceilingMs: SCREEN_CEILING_MS, errors: [cold, ...warm].flatMap((run) => run.errors),
      }
    }
    return { mode, headline: { ms: Math.max(...Object.values(screens).map((figures) => figures.medianLegacyMs)) }, screens }
  } finally {
    await browser.close()
    await stopBackend(proc)
    fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 })
  }
}

async function groupScreens(chromium) {
  const byMode = {}
  for (const mode of CFG.screenModes) byMode[mode] = await runSeries(`screens-${mode}`, 1, () => screensRun(chromium, mode))
  return byMode
}

// ---------------------------------------------------------------- the verdicts, the table and the dry run

/** Every measured series in a results object that carries a label (ready, home, routes and the screens of each cap setting). */
function labelledSeries(results) {
  const walk = (node) => (node && typeof node === 'object' && 'label' in node ? [node] : Object.values(node ?? {}).filter((child) => child && typeof child === 'object').flatMap(walk))
  return GROUPS.flatMap((group) => walk(results[group]))
}

const over = (value, limit) => (value === null ? null : value > limit)
const anyTrue = (...flags) => (flags.every((flag) => flag === null) ? null : flags.some((flag) => flag === true))

/**
 * T3 (02 section 9): backend ready above 2.5 s, or cold HOME above its cap of 6 s, on the median.
 * 02 section 4.1 item 3, decided (DEC1): the cap holds on every launch and is read on the worst one, the very first launch
 * after an install (an empty state folder, `home-fresh`). The cold-HOME ceiling is that median plus 20%, never above 6 s.
 * The usual launch (a state folder an earlier launch filled, `home-disk`) is gated too: above the cap T3 fires, and above
 * the ceiling W3B recorded for it (4,508 ms) it is a regression. A run without the first-launch series cannot clear T3
 * (`fires` stays null unless backend ready alone fires it). The verdict is provisional while no owner-named quiet window
 * was used or any series of the run is not ACCEPTED.
 */
export function t3Verdict(results, options = {}) {
  const { readingRatified = HOME_READING_RATIFIED, quietWindow = false } = options
  const ready = [results.ready?.browser?.medianMs, results.ready?.desktop?.medianMs].filter((value) => value != null)
  const homeDisk = results.home?.disk?.medianMs ?? null
  const homeFresh = results.home?.fresh?.medianMs ?? null
  const readyOver = ready.length ? Math.max(...ready) > READY_CEILING_MS : null
  const freshOver = over(homeFresh, HOME_CAP_MS)
  const diskOver = over(homeDisk, HOME_CAP_MS)
  const fires = readyOver === true || freshOver === true || diskOver === true ? true : readyOver === null || freshOver === null ? null : false
  const provisionalReasons = [
    ...(readingRatified ? [] : ['the cold-HOME reading is not ratified']),
    ...(quietWindow ? [] : ['no owner-named quiet window was used']),
    ...(labelledSeries(results).some((entry) => entry.label !== 'ACCEPTED') ? ['a series of the run is PROVISIONAL'] : []),
  ]
  return {
    readyMedianMs: ready.length ? Math.max(...ready) : null, readyOverCeiling: readyOver, homeReading: HOME_READING, homeReadingRatified: readingRatified,
    homeFreshMedianMs: homeFresh, homeCeilingFromFreshMs: homeCeilingMs(homeFresh), firstLaunchOverCap: freshOver, firstLaunchWithinTarget: over(homeFresh, HOME_TARGET_MS) === null ? null : !over(homeFresh, HOME_TARGET_MS),
    homeDiskMedianMs: homeDisk, homeCeilingFromDiskMs: homeCeilingMs(homeDisk), usualLaunchOverCap: diskOver, usualLaunchRegressed: over(homeDisk, HOME_USUAL_MEDIAN_W3B_MS), usualLaunchNoiseCeilingMs: HOME_USUAL_CEILING_W3B_MS, usualLaunchOverNoiseCeiling: over(homeDisk, HOME_USUAL_CEILING_W3B_MS),
    homeOverCap: anyTrue(freshOver, diskOver), fires,
    provisional: provisionalReasons.length > 0, provisionalReasons,
    note: 'the cold-HOME cap is read on the first launch (an empty state folder, the worst case), median plus 20% never above 6 s; the usual launch is gated by the same cap and checked against its W3B ceiling of 4,508 ms',
  }
}

function markdown(results, verdict) {
  const row = (name, runs, median, target, label) => `| ${name} | ${runs} | ${median} | ${target} | ${label} |`
  const series = (name, entry, target) => row(name, entry.valuesMs.join(', '), entry.medianMs, target, entry.label)
  const lines = ['| Measurement | Runs (ms) | Median (ms) | Target (ms) | Label |', '| --- | --- | --- | --- | --- |']
  if (results.ready) lines.push(series('Backend ready, browser mode', results.ready.browser, READY_TARGET_MS), series('Backend ready, desktop mode', results.ready.desktop, READY_TARGET_MS))
  if (results.home?.fresh) lines.push(series('Cold HOME, first launch (gated: T3 reading)', results.home.fresh, HOME_TARGET_MS))
  if (results.home?.disk) lines.push(series('Cold HOME, usual launch', results.home.disk, HOME_TARGET_MS))
  for (const mode of results.routes ? ['browser', 'desktop'] : []) lines.push(row(`Eight routes, worst repeat, ${mode} caps`, results.routes[mode].valuesMs.join(', '), results.routes[mode].medianMs, ROUTE_TARGET_MS, results.routes[mode].label))
  for (const [mode, entry] of Object.entries(results.screens ?? {})) {
    for (const [line, figures] of Object.entries(entry.records?.[0]?.screens ?? {})) {
      lines.push(row(`${line}, warm, Enter unit (judged), ${mode} caps`, figures.warmLegacyMs.join(', '), figures.medianLegacyMs, SCREEN_TARGET_MS, entry.label))
      lines.push(row(`${line}, warm, new panel (render only, not judged), ${mode} caps`, figures.warmNewPanelMs.join(', '), figures.medianNewPanelMs, 'n/a', entry.label))
    }
  }
  return `${lines.join('\n')}\n\nT3 fires: ${verdict.fires}; cold-HOME ceiling from the first launch: ${verdict.homeCeilingFromFreshMs} ms (first launch ${verdict.homeFreshMedianMs} ms, cap ${HOME_CAP_MS} ms, target ${HOME_TARGET_MS} ms); usual launch ${verdict.homeDiskMedianMs} ms (slower than its W3B median of ${HOME_USUAL_MEDIAN_W3B_MS} ms: ${verdict.usualLaunchRegressed}; noise ceiling ${HOME_USUAL_CEILING_W3B_MS} ms exceeded: ${verdict.usualLaunchOverNoiseCeiling}); provisional: ${verdict.provisional}${verdict.provisionalReasons.length ? ` (${verdict.provisionalReasons.join('; ')})` : ''}\n`
}

const refused = (fn) => { try { fn(); return false } catch { return true } }

const T3_SAMPLE = { ready: { browser: { medianMs: 1100, label: 'ACCEPTED' }, desktop: { medianMs: 1100, label: 'ACCEPTED' } }, home: { disk: { medianMs: 3553, label: 'ACCEPTED' }, fresh: { medianMs: 6341, label: 'ACCEPTED' } } }

/** The script's own rules, each beside a case that must fail (a check has to be born failing). */
export function selfChecks() {
  const [token, nonce] = ['ab'.repeat(32), 'cd'.repeat(32)]
  const planted = { FOO_API_KEY: 'planted-secret', NQT_SESSION_TOKEN: 'planted-secret', SOME_PASSWORD: 'planted-secret', STRAY_SWITCH: '1', NQT_DEV: '1', Path: 'C:\\Windows;D:\\dev\\mingw64\\bin;D:\\dev\\cargo\\bin' }
  const desktopEnv = backendEnv('desktop', 'D:\\dev\\tmp\\x', { ...process.env, ...planted })
  const browserEnv = backendEnv('browser', 'D:\\dev\\tmp\\x', { ...process.env, ...planted })
  const payload = { port: 8797, pid: 4242, proof: mac(token, 'ready', nonce, 8797, 4242) }
  const before = '{"caller":"terminal","end":"2021-12-31 00:00:00+00:00"}\n'
  const grew = (line) => gateLogGrewCleanly(before, `${before}${line}\n`).clean
  const withHome = (fresh, disk) => ({ ...T3_SAMPLE, home: { fresh: { medianMs: fresh, label: 'ACCEPTED' }, disk: { medianMs: disk, label: 'ACCEPTED' } } })
  const quiet = { quietWindow: true }
  return [
    ['the cold-HOME reading is the first launch, ratified', HOME_READING === 'first-launch' && HOME_READING_RATIFIED === true && t3Verdict(T3_SAMPLE).homeReading === 'first-launch'],
    ['born failing: a first launch over the 6 s cap fires T3 although the usual launch is under it (the W3B figures)', t3Verdict(T3_SAMPLE, quiet).fires === true && t3Verdict(T3_SAMPLE, quiet).firstLaunchOverCap === true],
    ['a first launch and a usual launch under the cap do not fire T3, and the ceiling is the first launch plus 20%', t3Verdict(withHome(4400, 3600), quiet).fires === false && t3Verdict(withHome(4400, 3600), quiet).homeCeilingFromFreshMs === 5280],
    ['born failing: a usual launch over the cap fires T3 even when the first launch is under it', t3Verdict(withHome(5000, 6100), quiet).fires === true],
    ['born failing: a usual launch slower than its W3B median of 3,757 ms is a regression, whatever the 4,508 ms noise ceiling says', t3Verdict(withHome(5000, 4000), quiet).usualLaunchRegressed === true && t3Verdict(withHome(5000, 4000), quiet).usualLaunchOverNoiseCeiling === false && t3Verdict(withHome(5000, 3700), quiet).usualLaunchRegressed === false && t3Verdict(withHome(5000, 4600), quiet).usualLaunchOverNoiseCeiling === true],
    ['born failing: a run without the first-launch series cannot clear T3', t3Verdict({ ...T3_SAMPLE, home: { disk: { medianMs: 3000, label: 'ACCEPTED' } } }, quiet).fires === null],
    ['the first-launch target of 4.5 s is reported', t3Verdict(withHome(4400, 3600)).firstLaunchWithinTarget === true && t3Verdict(withHome(4600, 3600)).firstLaunchWithinTarget === false],
    ['a ratified reading in a quiet window with accepted series is not provisional', t3Verdict(withHome(4400, 3600), quiet).provisional === false],
    ['born failing: an unratified reading keeps T3 provisional', t3Verdict(withHome(4400, 3600), { ...quiet, readingRatified: false }).provisional === true],
    ['born failing: no named quiet window keeps T3 provisional', t3Verdict(withHome(4400, 3600)).provisional === true],
    ['born failing: a provisional series of any group makes T3 provisional', t3Verdict({ ...withHome(4400, 3600), routes: { desktop: { medianMs: 12, label: 'PROVISIONAL' } } }, quiet).provisional === true],
    ['a request is placed on the launch clock', requestOnClock({ startTime: 1_000_250.4, responseEnd: 99.6 }, 1_000_000).startOnClockMs === 250 && requestOnClock({ startTime: 1_000_250.4, responseEnd: 99.6 }, 1_000_000).endOnClockMs === 350],
    ['born failing: a request without a start time is not placed', Object.keys(requestOnClock({ startTime: -1, responseEnd: 5 }, 1_000_000)).length === 0],
    ['--home takes fresh and disk alone or together', readConfig(['--home', 'fresh']).homeModes.join() === 'fresh' && readConfig([]).homeModes.join() === 'fresh,disk'],
    ['born failing: an unknown --home mode is refused', refused(() => readConfig(['--home', 'warm']))],
    ['median of three', median([3, 1, 2]) === 2], ['cold-HOME ceiling is the median plus 20%', homeCeilingMs(4000) === 4800], ['cold-HOME ceiling is never above 6 s', homeCeilingMs(5500) === HOME_CAP_MS],
    ['a READY proof verifies', readyProofHolds(payload, token, nonce)], ['born failing: a READY proof for another nonce is refused', !readyProofHolds(payload, token, 'ee'.repeat(32))],
    ['born failing: a READY proof with a changed pid is refused', !readyProofHolds({ ...payload, pid: 4243 }, token, nonce)],
    ['a terminal line inside the fence keeps the gate log clean', grew('{"caller":"terminal","end":"2022-01-01 00:00:00+00:00"}')],
    ['born failing: another caller is not clean', !grew('{"caller":"smoke","end":"2021-12-31 00:00:00+00:00"}')],
    ['born failing: a window past the fence is not clean', !grew('{"caller":"terminal","end":"2022-01-02 00:00:00+00:00"}')],
    ['born failing: a log that lost its early bytes is not clean', !gateLogGrewCleanly(before, '{"caller":"terminal"}\n').clean],
    ['born failing: a planted FOO_API_KEY, a secret-shaped NQT_ name and a stray switch do not reach the desktop backend', ['FOO_API_KEY', 'NQT_SESSION_TOKEN', 'SOME_PASSWORD', 'STRAY_SWITCH'].every((name) => !(name in desktopEnv) && !(name in browserEnv))],
    ['the backend environment holds the measured port, the state folder, NQT_JOBS=off and the desktop switch only in desktop mode', desktopEnv.NQT_PORT === String(CFG.port) && desktopEnv.NQT_STATE_DIR === 'D:\\dev\\tmp\\x' && desktopEnv.NQT_JOBS === 'off' && desktopEnv.NQT_DESKTOP === '1' && browserEnv.NQT_DESKTOP === undefined],
    ['born failing: a planted NQT_DEV and build tools on the PATH do not reach the backend', desktopEnv.NQT_DEV === undefined && !/[dD]:\\dev\\(mingw|cargo)/.test(desktopEnv.PATH ?? '')],
    ['born failing: port 8765 is refused', refused(() => readConfig(['--port', '8765']))], ['born failing: output on the system drive is refused', refused(() => readConfig(['--out', 'C:/x']))],
    ...screenChecks(),
  ]
}

/** The screen verdict's rules: the Enter unit (backend bound) is judged, the new panel (served from the page's query cache) is not. */
function screenChecks() {
  const slowEnter = screenVerdict([1226, 1069, 1083, 759, 615], [76, 77, 77, 78, 76])
  const overCeiling = screenVerdict([1600, 1700, 1650], [70, 71, 72])
  const quickEnter = screenVerdict([400, 410, 420], [5000, 5100, 5200])
  return [
    ['born failing: a fast new panel does not pass an Enter unit over the target', slowEnter.judgedUnit === 'enter' && slowEnter.medianLegacyMs === 1069 && slowEnter.enterWithinTarget === false && slowEnter.enterWithinCeiling === true],
    ['born failing: a fast new panel does not pass an Enter unit over the ceiling', overCeiling.enterWithinTarget === false && overCeiling.enterWithinCeiling === false],
    ['born failing: a slow new panel does not fail a fast Enter unit (the new panel is render time only)', quickEnter.enterWithinTarget === true && quickEnter.enterWithinCeiling === true && quickEnter.newPanelJudged === false],
  ]
}

// A page with the four HOME panels, a command line and a Shift+Enter that adds a REG panel after 60 ms: enough for the page steps.
const STAND_IN_PAGE = `<input role="combobox" aria-label="Command line"><div id="w"><div data-nqt-title="NQ GP 1d"><div role="img" aria-label="NQ1 Index: x"></div></div>
<div data-nqt-title="27F MON"><div role="grid" aria-rowcount="5"></div></div><div data-nqt-title="volmanaged_v0 EQ"><ul aria-label="Key figures for x"><li class="kpi-value">1</li></ul><div role="img"></div></div>
<div data-nqt-title="REG"><div role="grid" aria-rowcount="5"></div></div></div><script>document.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey) setTimeout(() => document.getElementById('w').insertAdjacentHTML('beforeend', '<div data-nqt-title="REG"><div role="grid" aria-rowcount="5"></div></div>'), 60) })</script>`

/** The code paths a real run takes that need no real backend: the READY line, a session and a timed GET, a series, and the page steps on a stand-in page. */
async function protocolChecks(chromium) {
  const [token, nonce] = ['12'.repeat(32), '34'.repeat(32)]
  const payload = { v: 1, port: CFG.port, pid: 7, proof: mac(token, 'ready', nonce, CFG.port, 7), dist: 'current', mode: 'desktop', contract: 1 }
  const fake = spawn(process.execPath, ['-e', `console.log('noise'); console.log('NQT-READY ' + ${JSON.stringify(JSON.stringify(payload))})`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const ready = await waitForReadyLine(fake, token, nonce)
  const server = http.createServer((req, res) => {
    if (req.url === '/api/session') res.setHeader('set-cookie', 'nqt_s_8797=abc; HttpOnly; Path=/api')
    res.end('{"ok":true}')
  })
  await new Promise((resolve) => server.listen(CFG.port, LOOPBACK, resolve))
  const session = await shellSession({ token })
  const got = await timedGet(session, '/anything')
  server.close()
  const kept = CFG.gateSeconds
  CFG.gateSeconds = 0
  const series = await runSeries('dry-series', 2, async (slot) => ({ headline: { ms: 100 * slot } }))
  CFG.gateSeconds = kept
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext(CONTEXT_OPTIONS)).newPage()
  await page.setContent(STAND_IN_PAGE)
  await waitSettled(page, HOME_PANELS)
  const [legacyMs, newPanelMs] = [await timeOpen(page, SCREENS[1], 'Enter'), await timeOpen(page, SCREENS[1], 'Shift+Enter')]
  const panels = await page.locator('[data-nqt-title="REG"]').count()
  await browser.close()
  return [
    ['waitForReadyLine reads and verifies a READY line among other output', ready.port === CFG.port], ['shellSession reads the cookie and timedGet hashes a body', session.header === 'nqt_s_8797=abc' && got.status === 200 && got.sha === sha(Buffer.from('{"ok":true}'))],
    ['runSeries writes its records and the median', series.medianMs === 150 && series.label === 'ACCEPTED' && fs.existsSync(path.join(RUN_DIR, 'dry-series-02.json'))],
    ['the page steps time Enter and Shift+Enter on a stand-in page', legacyMs >= 0 && newPanelMs >= 55 && panels === 2],
  ]
}

function resolvePlaywright() {
  try {
    return createRequire(`${TERMINAL}\\web\\package.json`).resolve('@playwright/test')
  } catch {
    return null
  }
}

async function dryRun() {
  const playwright = resolvePlaywright()
  const watch = await L.startWatch(path.join(RUN_DIR, 'dry.watch.jsonl'))
  const gate = await L.readCpu(2, { limitPct: CFG.limitPct, enforce: false })
  const protocol = playwright === null ? [] : await protocolChecks(createRequire(`${TERMINAL}\\web\\package.json`)('@playwright/test').chromium)
  const watched = await L.stopWatch(watch)
  const checks = [...selfChecks(), ...protocol].map(([name, pass]) => ({ name, pass }))
  const files = { python: PY, webDist: `${TERMINAL}\\web\\dist\\index.html`, oosLog: OOS_LOG, playwright }
  const exists = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file !== null && fs.existsSync(file)]))
  const record = {
    schema: 'stage1-dry-1', startedAtIso: iso(), config: CFG, files, exists, portFree: !(await proofAnswers(CFG.port)), checks, cpuTwoSeconds: gate, machine: machineFacts(), provenance: provenance(),
    watch: { clean: watched.clean, newWindows: watched.newWindows.length, foregroundChanges: watched.foregroundChanges.length },
    plan: { ready: ['browser mode', 'desktop mode'], home: CFG.homeModes.map((mode) => (mode === 'fresh' ? 'first launch, empty state folder' : 'usual launch, filled state folder')), routes: ['browser caps', 'desktop caps'], screens: CFG.screenModes, runs: CFG.runs, screenRuns: CFG.screenRuns },
  }
  saveJson('dry-run.json', record)
  const failed = checks.filter((check) => !check.pass).map((check) => check.name)
  say({ dry: true, out: RUN_DIR, checks: checks.length, failed, portFree: record.portFree, watchClean: record.watch.clean, missing: Object.entries(exists).filter(([, ok]) => !ok).map(([key]) => key) })
  return failed.length === 0 && record.portFree && record.watch.clean && Object.values(exists).every(Boolean) ? 0 : 1
}

// ---------------------------------------------------------------- main

async function measure() {
  const { chromium } = createRequire(`${TERMINAL}\\web\\package.json`)('@playwright/test')
  const startedAtIso = iso()
  const before = { research: researchSnapshot(), state: stateListing(), machine: machineFacts(), provenance: provenance() }
  const groups = { ready: groupReady, home: () => groupHome(chromium), routes: groupRoutes, screens: () => groupScreens(chromium) }
  const results = {}
  for (const group of GROUPS.filter((name) => CFG.only.includes(name))) {
    const watch = await L.startWatch(path.join(RUN_DIR, `${group}.watch.jsonl`))
    try {
      results[group] = await groups[group]()
    } catch (error) {
      // A group that fails is a finding, recorded with the others; the run goes on and ends with a failing exit code.
      results[group] = { error: String(error?.message ?? error) }
      say({ group, error: results[group].error })
    } finally {
      results[`${group}Watch`] = await L.stopWatch(watch)
      for (const dir of temps.splice(0)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
        } catch (error) {
          say({ cleanup: 'left in place', dir, reason: String(error.code ?? error) }) // never let a cleanup hide the error of the group
        }
      }
    }
  }
  const verdict = t3Verdict(results, { quietWindow: CFG.quietWindow })
  const after = stateListing()
  const watchClean = Object.entries(results).filter(([key]) => key.endsWith('Watch')).every(([, watched]) => watched.clean)
  const summary = {
    schema: 'stage1-1', startedAtIso, config: CFG, before: { machine: before.machine, provenance: before.provenance }, after: { machine: machineFacts() }, results, t3: verdict, watchClean,
    research: researchVerdict(before.research), terminalStateNewEntries: Object.keys(after).filter((name) => !(name in before.state)),
  }
  saveJson('stage1_results.json', summary)
  fs.writeFileSync(path.join(RUN_DIR, 'stage1_table.md'), markdown(results, verdict))
  say({ done: true, out: RUN_DIR, t3: verdict, watchClean, research: summary.research, newStateEntries: summary.terminalStateNewEntries.length })
  const research = summary.research
  const groupErrors = Object.entries(results).filter(([, value]) => value?.error !== undefined).map(([group]) => group)
  return groupErrors.length === 0 && watchClean && research.filesUnchanged && research.gateLog.clean && summary.terminalStateNewEntries.length === 0 ? 0 : 1
}

async function main() {
  L = await loadHelpers(CFG.libs)
  RUN_DIR = path.join(CFG.out, CFG.dry ? 'dry' : new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(RUN_DIR, { recursive: true })
  fs.mkdirSync(CFG.tmp, { recursive: true })
  return CFG.dry ? dryRun() : measure()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main()
