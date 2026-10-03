// One launch of a build and the rows it yields (04 D5.1). Two methods, the same rows:
//  - smoke: the GNU smoke build with a debugging port (port 0, read from DevToolsActivePort), attached over CDP. A page
//    probe is injected before HOME's document exists; process rows come from the shell log, page rows from the page;
//  - measure: the measure build with no debugging port. Start to handshake and to HOME ready come from the shell's own
//    log timestamps; memory from the performance counters of the whole process tree.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attach, sleep } from './cdp.mjs'
import { shellSpec, startShell, readDevToolsPort, teardown, identityRows, listState, newState } from './shell.mjs'
import { readShellLog, milestones, engineSettingsProblems, waitForMilestone } from './shelllog.mjs'
import { memTree } from './mem.mjs'
import { mergeRecorded } from './survivors.mjs'
import { makeLab } from './lab.mjs'
import { isMainTree, LAB, TERMINAL } from './paths.mjs'
import { exeBytes } from './build.mjs'
import { MB } from './rows.mjs'
import { median, round } from './stats.mjs'
import { fillsBody } from './fills.mjs'
import { barsRule, BARS_TARGET } from './bars.mjs'
import { HOME_EXPR, HOME_INFO, homeReadyMs, waitHomeReady, idleHealth, warmHomeReload, warmScreen, pickFillsRun, gridOpen, gipPanZoom, keystrokeToPaint } from './page-rows.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROBE_SOURCE = fs.readFileSync(path.join(here, 'probe.js'), 'utf8')
const FIXTURE_RUN = 'nt_dtsmom_v0_fixture_ts1'
const GIP_DATE = { fixture: '2011-01-20', real: '2019-03-14' }
const FIXTURE_FILLS_PATTERN = `/api/runs/${FIXTURE_RUN}/fills`
const mb = (b) => (typeof b === 'number' ? b / MB : null)

export const defaultOptions = Object.freeze({ homeTimeoutMs: 90_000, settleMs: 8000, memSamples: 3, warmReloads: 3, pageRows: true, size: '1920x1080', realData: false })

/** The lab for the launch: the owner's lab for real data (main tree only), else the lab of a fixture or dataless run. */
export function labFor(runDir, build, { realData }) {
  if (realData) {
    if (!isMainTree()) throw new Error('real-data rows run from the main tree only (this tree is not the lab\'s terminal folder)')
    return { lab: LAB, derived: false, remove() {} }
  }
  return makeLab(runDir, { isolateState: build === 'measure', force: build === 'measure' && !isMainTree() })
}

const round1 = (v) => round(v, 1)

/** The page served by --attach-url (the offline demo): its root has content and its address is the one asked for. */
async function waitRoot(cdp, url, ms) {
  return cdp.waitFor('(() => { const r = document.getElementById("root"); return r !== null && r.childElementCount > 0 && location.href.startsWith(' + JSON.stringify(url) + ') })()', ms, 50)
}

async function installProbe(cdp) {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable').catch(() => {})
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE_SOURCE })
}

/** Splash first-contentful-paint from the spawn instant, when the page is still the bundled splash (not the backend's page). */
async function readSplash(cdp, t0) {
  try {
    const href = await cdp.eval('location.href')
    if (String(href).startsWith('http://127.0.0.1:')) return { ms: null, why: 'attached after the backend page began' }
    await cdp.waitFor(`performance.getEntriesByName('first-contentful-paint').length > 0`, 3000, 25)
    const fcp = await cdp.eval(`(() => { const e = performance.getEntriesByName('first-contentful-paint')[0]; return e ? e.startTime + performance.timeOrigin : null })()`)
    return fcp === null ? { ms: null, why: 'no first-contentful-paint on the splash' } : { ms: round1(fcp - t0), href }
  } catch (e) { return { ms: null, why: String(e.message ?? e).slice(0, 120) } }
}

async function memSamples(pid, n, gapMs) {
  const samples = []
  for (let i = 0; i < n; i++) { if (i > 0) await sleep(gapMs); samples.push(memTree(pid)) }
  return samples
}

const memRow = (samples) => round1(median(samples.map((s) => mb(s.wsPrivate))))

async function smokePageRows(cdp, port, rows, detail, o) {
  const kind = o.realData ? 'real' : 'fixture'
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] })
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const attempt = async (id, fn) => { try { return await fn() } catch (e) { (detail.rowErrors ??= {})[id] = String(e.message ?? e).slice(0, 300); return null } }
  const warm = await attempt('warm_home', async () => { const reads = []; for (let i = 0; i < o.warmReloads; i++) reads.push(await warmHomeReload(cdp)); return reads })
  if (warm) { detail.warmHome = warm.map((w) => w.readyMs); rows.warm_home = round1(median(warm.map((w) => w.readyMs))) }
  if (o.realData) {
    for (const [id, line] of [['eq_warm', 'volmanaged_v0 EQ'], ['reg_warm', 'REG']]) {
      const r = await attempt(id, () => warmScreen(cdp, line)); if (r) { rows[id] = round1(r.ms); (detail.screens ??= {})[id] = r }
    }
  }
  const run = o.realData ? await attempt('grid_open', () => pickFillsRun(cdp)) : FIXTURE_RUN
  const bars = barsRule(BARS_TARGET)
  if (!o.realData) cdp.addRule(FIXTURE_FILLS_PATTERN, 'Request', async (p) => ({ body: fillsBody(p.request.url) }))
  cdp.addRule(bars.match, bars.stage, bars.handle)
  await cdp.enableRules()
  if (run) { const g = await attempt('grid_open', () => gridOpen(cdp, run)); if (g) { rows.grid_open = round1(g.ms); detail.grid = { run, total: g.total, pivotOpenMs: round1(g.pivotOpenMs) } } }
  const gip = await attempt('gip_pan_zoom_p95', () => gipPanZoom(cdp, port, `NQ GIP ${GIP_DATE[kind]}`))
  if (gip) { rows.gip_pan_zoom_p95 = round1(gip.ms); detail.gip = { bars: gip.bars, barsTarget: BARS_TARGET, barsSynthetic: bars.seen.rewritten > 0, baseBars: bars.seen.baseBars, moved: gip.moved, zoom: gip.zoom, pan: gip.pan } }
  await cdp.disableRules()
  const ks = await attempt('keystroke_p95', () => keystrokeToPaint(cdp))
  if (ks) { rows.keystroke_p95 = round1(ks.ms); detail.keystroke = { medianMs: round1(ks.medianMs), n: ks.n } }
}

export async function smokeLaunch(run, spec, result, o) {
  const alive = () => run.exitCode === null
  const port = await readDevToolsPort(spec.wvDir, 60_000, alive)
  if (!port) throw new Error(alive() ? 'no DevToolsActivePort in 60 s' : `the shell exited early with code ${run.exitCode}`)
  result.debugPort = port
  const att = await attach(port, null, 30_000)
  if (!att) throw new Error('no page target')
  const cdp = att.cdp
  result.cdp = cdp
  await installProbe(cdp)
  result.splash = await readSplash(cdp, run.t0)
  const ready = o.attachUrl ? await waitRoot(cdp, o.attachUrl, o.homeTimeoutMs) : await waitHomeReady(cdp, o.homeTimeoutMs)
  result.homeReady = ready
  const probePresent = await cdp.eval('window.__nqtProbe === true').catch(() => false)
  result.lateProbe = !probePresent
  if (!probePresent) await cdp.eval(PROBE_SOURCE).catch(() => {})
  result.home = await cdp.eval(HOME_INFO)
  const rd = homeReadyMs(result.home)
  result.coldHomeMs = rd === null || result.lateProbe ? null : Math.round(result.home.origin + rd - run.t0)
  result.browser = (await cdp.send('Browser.getVersion').catch(() => null))?.product ?? null
  result.idleHealth = await idleHealth(cdp)
  return { cdp, port }
}

async function measureLaunch(run, spec, result, o) {
  const alive = () => run.exitCode === null
  const got = await waitForMilestone(spec.logFile, run.t0, (m) => m.homePaintedMs !== null, o.homeTimeoutMs, { alive })
  result.homeReady = got.reached
  result.milestonesAtReady = got.milestones
  if (!got.reached) throw new Error(alive() ? 'no home_painted in the shell log' : `the shell exited early with code ${run.exitCode}`)
  await sleep(o.settleMs)
}

/**
 * One launch. Returns the record body: rows (id -> number|null), details, the memory samples, the shell log milestones,
 * the teardown outcome. `o`: realData, fixture (smoke only), homeTimeoutMs, settleMs, memSamples, warmReloads, pageRows, size.
 */
export async function launchRun({ build, exe, runDir, o = {} }) {
  const opts = { ...defaultOptions, ...o }
  const labInfo = labFor(runDir, build, opts)
  const stateDir = build === 'smoke' ? path.join(runDir, 'state') : null
  const spec = shellSpec({ build, exe, runDir, lab: labInfo.lab, fixture: build === 'smoke' && !opts.realData, stateDir, size: build === 'smoke' ? opts.size : null })
  const stateWatch = build === 'measure' ? path.join(labInfo.lab, 'terminal', 'state') : stateDir
  const stateBefore = stateWatch ? listState(stateWatch) : []
  const result = { build, exe, exeBytes: exeBytes(exe), terminal: TERMINAL, dataKind: opts.realData ? 'real' : build === 'smoke' ? 'fixture' : 'none', derivedLab: labInfo.derived, rows: {}, detail: {} }
  const run = startShell(spec)
  result.rootPid = run.child.pid
  result.startedAtIso = run.spawnedAtIso
  let treeRows = []
  let session = null
  try {
    session = build === 'smoke' ? await smokeLaunch(run, spec, result, opts) : (await measureLaunch(run, spec, result, opts), null)
    const samples = await memSamples(run.child.pid, opts.memSamples, 2000)
    result.memSamples = samples.map((s) => ({ n: s.n, wsPrivateMB: round1(mb(s.wsPrivate)), privateBytesMB: round1(mb(s.privateBytes)), wsMB: round1(mb(s.ws)), cpuTotalPct: s.cpuTotalPct }))
    treeRows = mergeRecorded(...samples.map(identityRows))
    result.rows.idle_mem_home = memRow(samples)
    result.processCount = samples.at(-1).n
    if (session && opts.pageRows) await smokePageRows(session.cdp, session.port, result.rows, result.detail, opts)
  } catch (e) {
    result.fatal = String((e && e.stack) || e).slice(0, 1200)
  } finally {
    try { result.cdp?.close() } catch { /* ignore */ }
    delete result.cdp
    const events = readShellLog(spec.logFile)
    result.milestones = milestones(events, run.t0)
    result.shellEvents = events.length
    // The installed measure build is the release in all but its logging: its engine settings must read back off (03 section 13.1).
    result.engineProblems = build === 'measure' ? engineSettingsProblems(events) : []
    if (result.engineProblems.length > 0 && !result.fatal) result.fatal = `engine settings: ${result.engineProblems.join('; ')}`
    result.teardown = await teardown(run.child, treeRows)
    result.exitCode = run.exitCode
    fillProcessRows(result)
    if (stateWatch) { result.stateNew = newState(stateBefore, listState(stateWatch)); result.stateFolder = stateWatch }
    labInfo.remove()
  }
  return result
}

/** The process-level rows, from the shell log (both builds) and, for the smoke build, the page probe. */
export function fillProcessRows(result) {
  const m = result.milestones
  const rows = result.rows
  if (m.backendReadyMs !== null) rows.backend_ready = round1(m.backendReadyMs)
  const splash = result.splash?.ms ?? null
  rows.splash_painted = result.build === 'smoke' && splash !== null ? splash : m.splashLoadMs === null ? null : round1(m.splashLoadMs)
  result.splashMethod = result.build === 'smoke' && splash !== null ? 'cdp-fcp' : 'shell-log-page_finished'
  const cold = result.build === 'smoke' ? result.coldHomeMs : m.homePaintedMs
  rows.cold_home = cold === null || cold === undefined ? (m.homePaintedMs === null ? null : round1(m.homePaintedMs)) : round1(cold)
  result.coldHomeMethod = result.build === 'smoke' && result.coldHomeMs !== null && result.coldHomeMs !== undefined ? 'home-ready-mark' : 'shell-log-home_painted'
  for (const [id, v] of Object.entries(rows)) if (typeof v !== 'number' || !Number.isFinite(v)) delete rows[id]
}

export { HOME_EXPR }

/** An open smoke session for the modes that keep the shell alive (minimise, soak, T8): launch, attach, probe, HOME;  tears it down. */
export async function openSmoke({ exe, runDir, o = {} }) {
  const opts = { ...defaultOptions, ...o }
  const labInfo = labFor(runDir, 'smoke', { realData: opts.realData })
  const stateDir = opts.attachUrl ? null : path.join(runDir, 'state')
  const spec = shellSpec({ build: 'smoke', exe, runDir, lab: labInfo.lab, fixture: !opts.realData && !opts.attachUrl, stateDir, size: opts.size, screen2: !!opts.screen2, attachUrl: opts.attachUrl ?? null })
  const result = { build: 'smoke', exe, exeBytes: exeBytes(exe), terminal: TERMINAL, dataKind: opts.attachUrl ? 'demo' : opts.realData ? 'real' : 'fixture', derivedLab: labInfo.derived, rows: {}, detail: {} }
  const run = startShell(spec)
  result.rootPid = run.child.pid
  result.startedAtIso = run.spawnedAtIso
  const session = { run, spec, result, labInfo, treeRows: [], cdp: null, port: null }
  try {
    const s = await smokeLaunch(run, spec, result, opts)
    session.cdp = s.cdp
    session.port = s.port
    session.treeRows = mergeRecorded(identityRows(memTree(run.child.pid)))
  } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 1200) }
  session.close = async () => {
    try { session.cdp?.close() } catch { /* ignore */ }
    delete result.cdp
    result.milestones = milestones(readShellLog(spec.logFile), run.t0)
    result.teardown = await teardown(run.child, session.treeRows)
    result.exitCode = run.exitCode
    labInfo.remove()
    return result
  }
  return session
}
