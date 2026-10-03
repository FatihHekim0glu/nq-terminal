// The shell's own log (`<config>/logs/shell.log`, one JSON object per line, `t` in milliseconds since the Unix epoch;
// crash.rs). The measure build has no debugging port, so its process-level rows are read from these timestamps:
//   start             the shell's setup began (its record says which build it is)
//   page_finished     a page load finished: the bundled splash first, then the backend's page
//   supervise_checked the backend was spawned, handshaken and proven the shell's own child (backend ready)
//   home_painted      the hung-page watch saw the backend's page paint (500 ms poll; since_watch_start_ms)
//   devtools_port     smoke only: the port the engine wrote to DevToolsActivePort
//   keys_installed    the engine settings as read back from the engine (accelerator_keys, zoom_control, devtools, zoom_factor)
import fs from 'node:fs'

export function parseShellLog(text) {
  return String(text).split('\n').filter((l) => l.trim() !== '').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((e) => e && typeof e.event === 'string')
}

export function readShellLog(file) {
  try { return parseShellLog(fs.readFileSync(file, 'utf8')) } catch { return [] }
}

const isBackendUrl = (u) => typeof u === 'string' && u.startsWith('http://127.0.0.1:')
const first = (events, name, pred = () => true) => events.find((e) => e.event === name && pred(e)) ?? null

export const FAILURE_EVENTS = new Set(['setup_failed', 'run_failed', 'supervise_gave_up', 'hung_page_gave_up', 'hung_page_offer', 'lab_refused', 'lab_missing', 'stale_dist', 'engine_gone', 'stopped_page', 'bridge_script_failed', 'window_hooks_failed', 'devtools_port_missing', 'controller_visible_failed'])

/** Milliseconds from `t0` (epoch ms at spawn) to each milestone; null for a milestone the log does not hold. */
export function milestones(events, t0) {
  const at = (e) => (e && typeof e.t === 'number' ? e.t - t0 : null)
  const start = first(events, 'start')
  const splash = first(events, 'page_finished', (e) => !isBackendUrl(e.url))
  const backendPage = first(events, 'page_finished', (e) => isBackendUrl(e.url))
  const checked = first(events, 'supervise_checked')
  const painted = first(events, 'home_painted')
  const port = first(events, 'devtools_port')
  const keys = first(events, 'keys_installed')
  const problems = events.filter((e) => FAILURE_EVENTS.has(e.event) || /_failed$/.test(e.event)).map((e) => ({ event: e.event, detail: e.error ?? e.why ?? e.url ?? null }))
  return {
    startMs: at(start), splashLoadMs: at(splash), backendPageMs: at(backendPage), backendReadyMs: at(checked), homePaintedMs: at(painted),
    homePaintedSinceWatchMs: painted?.since_watch_start_ms ?? null, devtoolsPort: port?.port ?? null,
    engineSettings: keys ? { accelerator_keys: keys.accelerator_keys ?? null, zoom_control: keys.zoom_control ?? null, devtools: keys.devtools ?? null, zoom_factor: keys.zoom_factor ?? null } : null,
    build: start ? { smoke: !!start.smoke, measure: !!start.measure, identifier: start.identifier ?? null } : null,
    controllerVisible: first(events, 'controller_visible') !== null, screen2: first(events, 'smoke_screen2')?.shown ?? null, problems,
  }
}

const ENGINE_OFF_FIELDS = ['devtools', 'accelerator_keys', 'zoom_control']

/**
 * The runtime check of the release settings (03 section 13.1): outside the smoke build the engine must read back
 * devtools, browser accelerator keys and zoom control all off. A missing record, or a field the shell could not read,
 * is a problem too. The start record's own `devtools` field is a compile-time literal and proves nothing.
 */
export function engineSettingsProblems(events) {
  const start = first(events, 'start')
  if (!start) return ['no start record in the shell log']
  const keys = first(events, 'keys_installed')
  if (start.smoke) return keys ? [] : ['no keys_installed record in the shell log']
  if (!keys) return ['no keys_installed record in the shell log']
  return ENGINE_OFF_FIELDS.filter((f) => keys[f] !== false).map((f) => `keys_installed reads ${f} as ${JSON.stringify(keys[f] ?? null)}, it must be false`)
}

/** Polls the log until `done(milestones)` or the timeout; returns the last milestones and whether it finished. */
export async function waitForMilestone(file, t0, done, ms, { poll = 50, alive = () => true } = {}) {
  const end = Date.now() + ms
  let m = milestones(readShellLog(file), t0)
  while (!done(m) && Date.now() < end && alive()) {
    await new Promise((r) => setTimeout(r, poll))
    m = milestones(readShellLog(file), t0)
  }
  return { milestones: m, reached: done(m) }
}
