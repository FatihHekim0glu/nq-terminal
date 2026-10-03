// One launch of the real shell: the command line of each build, the spawn (hidden, clean PATH, no WEBVIEW2_* variable),
// the debugging port of the smoke build, and the teardown that asks the window to close and then ends only processes
// proved to be this run's own (same pid, creation time and image name; never /T, never a bare pid).
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './cdp.mjs'
import { spawnHidden } from './proc.mjs'
import { assertPortAllowed } from './paths.mjs'
import { writeMeasureSettings } from './lab.mjs'
import { stopOwned } from './stop.mjs'
import { SHELL_NAMES } from './survivors.mjs'
import { closeWindows } from './winctl.mjs'
import { treeIdentity } from './mem.mjs'

export const MEASURE_DIR_VAR = 'NQT_MEASURE_DIR'
export const devToolsFile = (wvDir) => path.join(wvDir, 'EBWebView', 'DevToolsActivePort')

/**
 * The command line, environment and folders of one launch. smoke: the frozen switches (04 D4.1); measure: no switch, the run
 * folder in NQT_MEASURE_DIR and the lab in the settings file of its config folder. Every folder is under the run folder (on D:).
 */
export function shellSpec({ build, exe, runDir, lab, fixture = false, stateDir = null, saveDir = null, size = null, zoom = null, screen2 = false, attachUrl = null, debugPort = 0 }) {
  const wv = path.join(runDir, 'wv')
  const cfg = path.join(runDir, 'config')
  const spec = { build, exe, runDir, wvDir: wv, cfgDir: cfg, logFile: path.join(cfg, 'logs', 'shell.log'), args: [], env: {}, lab }
  if (build === 'smoke') {
    assertPortAllowed(debugPort)
    if (attachUrl && fixture) throw new Error('--fixture and --attach-url exclude each other')
    if (!attachUrl) spec.args.push('--lab', lab)
    if (fixture) spec.args.push('--fixture')
    if (attachUrl) spec.args.push('--attach-url', attachUrl)
    spec.args.push('--webview-data-dir', wv, '--config-dir', cfg)
    if (stateDir) spec.args.push('--state-dir', stateDir)
    if (saveDir) spec.args.push('--save-dir', saveDir)
    if (size) spec.args.push('--size', size)
    if (zoom) spec.args.push('--zoom', String(zoom))
    spec.args.push('--remote-debugging-port', String(debugPort))
    if (screen2) spec.args.push('--screen2')
  } else if (build === 'measure') {
    if (attachUrl || fixture || screen2 || size || zoom) throw new Error('the measure build takes no switch')
    spec.env[MEASURE_DIR_VAR] = runDir
    spec.settingsFile = writeMeasureSettings(runDir, lab)
  } else throw new Error(`no launch for build ${build}`)
  fs.mkdirSync(runDir, { recursive: true })
  return spec
}

export function startShell(spec) {
  const out = fs.openSync(path.join(spec.runDir, 'shell.out.log'), 'w')
  const err = fs.openSync(path.join(spec.runDir, 'shell.err.log'), 'w')
  const t0 = Date.now()
  const child = spawnHidden(spec.exe, spec.args, { env: spec.env, stdio: ['ignore', out, err] })
  const run = { child, t0, spawnedAtIso: new Date(t0).toISOString(), exitCode: null }
  child.once('exit', (c) => { run.exitCode = c ?? -1 })
  return run
}

/** The port the engine picked, from the first line of DevToolsActivePort in the profile folder; null when it never came. */
export async function readDevToolsPort(wvDir, ms, alive = () => true) {
  const file = devToolsFile(wvDir)
  const end = Date.now() + ms
  while (Date.now() < end && alive()) {
    try {
      const n = Number(fs.readFileSync(file, 'utf8').split('\n')[0].trim())
      if (Number.isInteger(n) && n > 0) return assertPortAllowed(n)
    } catch { /* not written yet */ }
    await sleep(20)
  }
  return null
}

const identityRows = (mem) => (mem?.procs ?? []).map((p) => ({ pid: p.pid, created: p.created, exe: p.exe }))
export { identityRows }

/**
 * Closes the shell as the owner would (WM_CLOSE to its own windows: the supervisor stops the backend in its grace), then ends
 * only recorded processes that outlived it. Returns what happened, for the record.
 */
export async function teardown(child, recorded = [], { graceMs = 20_000 } = {}) {
  const t = Date.now()
  let closeSent = false
  if (child.exitCode === null) { try { closeSent = closeWindows(child.pid).closed.length > 0 } catch { /* the window helper failed: fall through to the identity kill */ } }
  while (child.exitCode === null && Date.now() - t < graceMs) await sleep(100)
  const closedMs = child.exitCode === null ? null : Date.now() - t
  await sleep(800)
  let rows = recorded
  if (child.exitCode === null) { try { rows = [...recorded, ...treeIdentity(child.pid)] } catch { /* the earlier records stand */ } }
  const stopped = await stopOwned(child, rows, { names: SHELL_NAMES })
  return { closeSent, closedGracefully: closedMs !== null, closedMs, killed: stopped.killed, survivors: stopped.survivors, exitCode: child.exitCode }
}

/** The state folder listing used by the state check: relative name, size and mtime of every entry. */
export function listState(dir) {
  const out = []
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      let st
      try { st = fs.statSync(p) } catch { continue }
      out.push({ name: path.relative(dir, p), size: st.size, mtimeMs: Math.round(st.mtimeMs), dir: e.isDirectory() })
      if (e.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** Entries present after and not before: the "NEW file or folder" the state check fails on (git-ignored release and desktop excepted). */
export function newState(before, after, allowed = ['release', 'desktop']) {
  const had = new Set(before.map((e) => e.name))
  return after.filter((e) => !had.has(e.name) && !allowed.includes(e.name.split(/[\\/]/)[0])).map((e) => e.name)
}
