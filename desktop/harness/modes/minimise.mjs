// Minimise and restore with the stream live (04 D5.1; 03 section 15.4; 02 section 6.3).
//  - minimise-sim: no window may be shown, so the controller is hidden and shown again (put_IsVisible false, then true) by one
//    of three drivers tried in turn (see `drivers`). The page must then really report hidden (born-failing check: a driver that
//    does not hide it is named ineffective, never counted). With LIVE open and streaming for the hold (30 to 60 minutes), the
//    stream must be back in stream mode, not polling, within 30 s of the restore.
//  - minimise-real: the optional real minimise and restore on screen 2 only (SW_SHOWMINNOACTIVE and SW_SHOWNOACTIVATE) behind
//    the screen-2 guard: the shell shows itself with --screen2, every show command is refused unless the frame is inside the
//    second monitor's work area, and the foreground window must never change. The watch expects that one window and nothing else.
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from '../lib/cdp.mjs'
import { openSmoke } from '../lib/launch-run.mjs'
import { resolveBuild } from '../lib/build.mjs'
import { runLine } from '../lib/page-rows.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { readCpu } from '../lib/gate.mjs'
import { figure } from '../lib/record.mjs'
import { memTree } from '../lib/mem.mjs'
import { monitors, foreground, mainWindow, sizeMessage, guardedShow, windowsOf } from '../lib/winctl.mjs'
import { guardFrame, screen2Allow, frameOf } from '../lib/screen2.mjs'
import { MB, CHECKS } from '../lib/rows.mjs'

export const STREAM_LINE = 'live, server events'
export const STREAM_BACK_CEILING_MS = CHECKS.minimise_sim_stream_back_ms.ceiling
const STREAM_EXPR = `(() => { const g = Array.from(document.querySelectorAll('[role="group"]')).find((e) => e.getAttribute('aria-label') === 'Live stream state'); const s = g && g.querySelector('[role="status"]'); return s ? s.textContent.trim() : null })()`
const VIS_EXPR = 'document.visibilityState'

async function streamText(cdp) { try { return await cdp.eval(STREAM_EXPR) } catch { return null } }

/** Waits for the stream line to read "live, server events"; returns the milliseconds it took, or null. */
export async function waitStream(cdp, ms) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if ((await streamText(cdp)) === STREAM_LINE) return Date.now() - t
    await sleep(250)
  }
  return null
}

async function waitVisibility(cdp, want, ms) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if ((await cdp.eval(VIS_EXPR).catch(() => null)) === want) return Date.now() - t
    await sleep(100)
  }
  return null
}

/** The hold: sample the page and the tree every `everyS` seconds while hidden or minimised. */
async function hold(cdp, pid, holdS, everyS) {
  const samples = []
  const end = Date.now() + holdS * 1000
  while (Date.now() < end) {
    await sleep(Math.min(everyS * 1000, Math.max(0, end - Date.now())))
    let mem = null
    try { mem = Math.round(memTree(pid).wsPrivate / MB * 10) / 10 } catch { /* keep sampling */ }
    samples.push({ atS: Math.round((Date.now() - (end - holdS * 1000)) / 1000), visibility: await cdp.eval(VIS_EXPR).catch(() => null), stream: await streamText(cdp), wsPrivateMB: mem })
  }
  return samples
}

async function openLive(session, result) {
  const cdp = session.cdp
  await runLine(cdp, 'LIVE')
  result.streamUpMs = await waitStream(cdp, 30_000)
  if (result.streamUpMs === null) throw new Error(`LIVE never showed "${STREAM_LINE}" (last: ${JSON.stringify(await streamText(cdp))})`)
}

/**
 * The ways to hide and show the WebView2 controller without showing a window, in the order they are tried. Each is judged by its
 * effect: the page must really report hidden within 3 s, or the driver is named ineffective and the next one is tried.
 *  - controller-file: the shell's smoke build reads smoke-visibility.txt in its config folder (hidden or visible) and calls put_IsVisible. The hook does
 *    not exist in the shell yet (smoke.rs would need it; the merge step decides); this driver is ready for it.
 *  - wm-size: a WM_SIZE minimised message to the shell's hidden window. Tried on 3 October: the engine does not react to it.
 *  - page-override: the page's own visibility is overridden over CDP (visibilityState and hidden, then a visibilitychange event).
 *    It exercises the page's visibility logic (stream to polling and back) but NOT the engine's throttling of a hidden view, so a run
 *    that needed it is labelled engineLevel false and does not count as the engine-level proof.
 */
function drivers(session) {
  const pid = session.run.child.pid
  const file = path.join(session.spec.cfgDir, 'smoke-visibility.txt')
  const win = () => mainWindow(pid)
  return [
    { name: 'controller-file', engineLevel: true, hide: async () => fs.writeFileSync(file, 'hidden'), show: async () => fs.writeFileSync(file, 'visible') },
    { name: 'wm-size', engineLevel: true, hide: async () => sizeMessage(pid, win().hwnd, 'minimized'), show: async () => sizeMessage(pid, win().hwnd, 'restored') },
    { name: 'page-override', engineLevel: false,
      hide: async () => session.cdp.eval(PAGE_HIDE),
      show: async () => session.cdp.eval(PAGE_SHOW) },
  ]
}

const PAGE_HIDE = `(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })()`
const PAGE_SHOW = `(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })()`

async function pickDriver(session, result) {
  result.driversTried = []
  for (const d of drivers(session)) {
    let hidden = null
    try { await d.hide(); hidden = await waitVisibility(session.cdp, 'hidden', 3000) } catch (e) { result.driversTried.push({ name: d.name, error: String(e.message ?? e).slice(0, 120) }); continue }
    result.driversTried.push({ name: d.name, hidden: hidden !== null })
    if (hidden !== null) { result.hiddenAfterMs = hidden; return d }
    try { await d.show() } catch { /* the next driver starts from a visible page */ }
    await waitVisibility(session.cdp, 'visible', 3000)
  }
  return null
}

async function simulated(session, result, holdS, everyS) {
  const driver = await pickDriver(session, result)
  if (!driver) { result.driverEffective = false; throw new Error('no driver could hide the page') }
  result.driver = driver.name
  result.engineLevel = driver.engineLevel
  result.driverEffective = true
  result.holdSamples = await hold(session.cdp, session.run.child.pid, holdS, everyS)
  const t = Date.now()
  await driver.show()
  result.visibleAfterMs = await waitVisibility(session.cdp, 'visible', 5000)
  result.streamBackMs = await waitStream(session.cdp, 60_000)
  result.restoredAtMs = Date.now() - t
}

async function real(session, result, holdS, everyS) {
  const pid = session.run.child.pid
  const table = monitors()
  result.monitors = table
  const fgBefore = foreground()
  const win = mainWindow(pid)
  if (!win) throw new Error('no top-level window of the shell')
  const frame = frameOf(win)
  const g = guardFrame(frame, table)
  result.frameBefore = frame
  result.guardBefore = g
  if (!g.ok) throw new Error(`the shell window is not on screen 2: ${g.reason}`)
  guardedShow(pid, win.hwnd, 'minimise', { table })
  await sleep(500)
  result.iconicAfterMinimise = windowsOf(pid).find((w) => w.hwnd === win.hwnd)?.iconic ?? null
  result.hiddenAfterMs = await waitVisibility(session.cdp, 'hidden', 5000)
  result.holdSamples = await hold(session.cdp, pid, holdS, everyS)
  const t = Date.now()
  guardedShow(pid, win.hwnd, 'restore', { table, lastFrame: frame })
  result.visibleAfterMs = await waitVisibility(session.cdp, 'visible', 5000)
  result.streamBackMs = await waitStream(session.cdp, 60_000)
  result.restoredAtMs = Date.now() - t
  const after = mainWindow(pid)
  result.frameAfter = after ? frameOf(after) : null
  result.iconicAfterRestore = after?.iconic ?? null
  result.guardAfter = result.frameAfter ? guardFrame(result.frameAfter, table) : { ok: false, reason: 'no window after the restore' }
  const fgAfter = foreground()
  result.foreground = { before: fgBefore, after: fgAfter, unchanged: fgBefore.hwnd === fgAfter.hwnd }
}

const verdictOf = (result, realMode) => {
  const problems = []
  if (result.fatal) problems.push(`fatal: ${result.fatal.slice(0, 160)}`)
  if (result.driverEffective === false) problems.push('simulated-minimise driver ineffective')
  // A real minimise is judged on the stream and the window, not on visibilityState: whether the engine reports hidden for a
  // minimised window is an observation (the smoke build forces the controller visible), recorded as hiddenAfterMs.
  if (!realMode && result.hiddenAfterMs === null) problems.push('the page never became hidden')
  if (result.visibleAfterMs === null) problems.push('the page did not become visible again')
  if (result.streamBackMs === null || result.streamBackMs === undefined) problems.push('the stream did not come back in stream mode')
  else if (result.streamBackMs > STREAM_BACK_CEILING_MS) problems.push(`stream back after ${result.streamBackMs} ms (ceiling ${STREAM_BACK_CEILING_MS})`)
  if (realMode && result.guardAfter && !result.guardAfter.ok) problems.push(`after the restore: ${result.guardAfter.reason}`)
  if (realMode && result.foreground && !result.foreground.unchanged) problems.push('the foreground window changed')
  if (realMode && result.iconicAfterMinimise !== true) problems.push('the window did not minimise')
  if (realMode && result.iconicAfterRestore !== false) problems.push('the window did not restore')
  return problems
}

export async function run({ args, outDir, provenance, mode }) {
  const realMode = mode === 'minimise-real'
  const dry = args.flag('dry')
  const holdS = Number(args.opt('hold-seconds', dry ? 12 : 1800))
  const everyS = Number(args.opt('sample-seconds', dry ? 4 : 60))
  const exe = resolveBuild('smoke', args.opt('exe', null))
  const runDir = path.join(outDir, 'launch', mode)
  const allowFor = (r) => (realMode ? screen2Allow([r?.rootPid], r?.monitors ?? monitors()) : undefined)
  const out = await executeSlot({ mode, build: 'smoke', slot: 1, attempt: 1, kind: dry ? 'dry' : 'measure', outDir, gateSeconds: dry ? 5 : 60, limitPct: Number(args.opt('cpu-limit', 10)), gateFn: readCpu, provisionalAfter: 1,
    meta: { provenance, holdSeconds: holdS }, allowFor, expected: [],
    runFn: async ({ gate }) => {
      const session = await openSmoke({ exe, runDir, o: { realData: args.flag('real-data'), screen2: realMode, size: realMode ? '1024x800' : '1920x1080' } })
      const result = session.result
      try {
        if (!session.cdp) throw new Error(result.fatal ?? 'no debugging session')
        await openLive(session, result)
        await (realMode ? real : simulated)(session, result, holdS, everyS)
      } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 800) } finally { await session.close() }
      result.problems = verdictOf(result, realMode)
      result.passed = result.problems.length === 0
      result.homeReady = result.homeReady !== false
      const checkId = realMode ? 'minimise_real_stream_back_ms' : 'minimise_sim_stream_back_ms'
      result.rows = result.streamBackMs == null ? {} : { [checkId]: result.streamBackMs }
      result.figures = result.streamBackMs == null ? [] : [figure({ row: checkId, build: 'smoke', value: result.streamBackMs, unit: 'ms', method: realMode ? 'real minimise and restore on screen 2' : `controller hidden then shown by driver ${result.driver} (${result.engineLevel ? 'engine level' : 'page level only: not the engine-level proof'})`, cpuLoadPct: gate?.avgPct, provenance, extra: { driver: result.driver ?? null, engineLevel: result.engineLevel ?? null } })]
      return result
    } })
  console.log(JSON.stringify({ mode, status: out.status, passed: out.result?.passed, problems: out.result?.problems, windows: out.result?.watch?.newWindows.length, allowed: out.result?.watch?.allowed.length, fg: out.result?.watch?.foregroundChanges.length }))
  return out
}
