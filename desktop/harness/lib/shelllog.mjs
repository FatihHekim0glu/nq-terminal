// The shell's own log (`<config>/logs/shell.log`, one JSON object per line, `t` in milliseconds since the Unix epoch;
// crash.rs). The measure build has no debugging port, so its process-level rows are read from these timestamps:
//   start             the shell's setup began (its record says which build it is)
//   supervise_thread_began    the supervise loop thread's first line (it starts before the window is built, startup.md 7.2)
//   supervise_create_process  the job and pipes are made; CreateProcessW is next
//   supervise_spawned the backend's launcher was created in its job (spawn offset: this less the start line)
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

// A run folder can serve more than one launch (ab.mjs usual phase, a first-launch rerun), so its shell.log holds several. The shell's
// clock and the harness's are one machine's, but t0 is read just before the spawn: a start line a little before it still counts.
const LAUNCH_SLACK_MS = 1000

/** The events of the one launch that began at `t0`: from its first `start` line (at or after t0 less the slack) up to the next
 *  `start`. With no such start line, only the events at or after t0 less the slack, so an earlier launch is never read as this one. */
export function launchEvents(events, t0) {
  if (typeof t0 !== 'number' || !Number.isFinite(t0)) return events
  const from = t0 - LAUNCH_SLACK_MS
  const begin = events.findIndex((e) => e.event === 'start' && typeof e.t === 'number' && e.t >= from)
  if (begin < 0) return events.filter((e) => typeof e.t === 'number' && e.t >= from)
  const next = events.findIndex((e, i) => i > begin && e.event === 'start')
  return events.slice(begin, next < 0 ? events.length : next)
}

/** Milliseconds from `t0` (epoch ms at spawn) to each milestone; null for a milestone the log does not hold. */
export function milestones(events, t0) {
  events = launchEvents(events, t0)
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
    ...spawnMilestones(events, at),
    startMs: at(start), splashLoadMs: at(splash), backendPageMs: at(backendPage), backendReadyMs: at(checked), homePaintedMs: at(painted),
    homePaintedSinceWatchMs: painted?.since_watch_start_ms ?? null, devtoolsPort: port?.port ?? null,
    engineSettings: keys ? { accelerator_keys: keys.accelerator_keys ?? null, zoom_control: keys.zoom_control ?? null, devtools: keys.devtools ?? null, zoom_factor: keys.zoom_factor ?? null } : null,
    build: start ? { smoke: !!start.smoke, measure: !!start.measure, identifier: start.identifier ?? null } : null,
    controllerVisible: first(events, 'controller_visible') !== null, screen2: first(events, 'smoke_screen2')?.shown ?? null, problems,
  }
}

/** The spawn lines (startup.md 7.2): when the supervise thread began, the line before CreateProcessW, the spawn, and the spawn
 *  offset (supervise_spawned less the start line, both on the shell's clock); null for a line the log does not hold, never 0. */
export function spawnMilestones(events, at) {
  const start = first(events, 'start')
  const spawned = first(events, 'supervise_spawned')
  const offset = start && spawned && typeof start.t === 'number' && typeof spawned.t === 'number' ? spawned.t - start.t : null
  return { superviseThreadBeganMs: at(first(events, 'supervise_thread_began')), createProcessMs: at(first(events, 'supervise_create_process')), spawnedMs: at(spawned), spawnOffsetMs: offset }
}

const ENGINE_OFF_FIELDS =['devtools', 'accelerator_keys', 'zoom_control']

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
