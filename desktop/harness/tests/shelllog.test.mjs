import test from 'node:test'
import assert from 'node:assert/strict'
import { parseShellLog, milestones, engineSettingsProblems, FAILURE_EVENTS } from '../lib/shelllog.mjs'

const T0 = 1_760_000_000_000
const line = (dt, event, extra = {}) => JSON.stringify({ t: T0 + dt, event, ...extra })
const LOG = [
  line(60, 'start', { smoke: true, measure: false, identifier: 'dev.nqlab.terminal.smoke' }),
  line(90, 'smoke_options', {}),
  line(250, 'page_started', { url: 'http://tauri.localhost/splash.html' }),
  line(310, 'page_finished', { url: 'http://tauri.localhost/splash.html' }),
  line(330, 'devtools_port', { port: 51234 }),
  line(1250, 'supervise_checked', { port: 5000, pid: 4 }),
  line(1300, 'page_finished', { url: 'http://127.0.0.1:5000/' }),
  line(2265, 'home_painted', { since_watch_start_ms: 2200 }),
].join('\n')

test('the milestones are milliseconds from the spawn instant', () => {
  const m = milestones(parseShellLog(LOG), T0)
  assert.equal(m.startMs, 60)
  assert.equal(m.splashLoadMs, 310, 'the first page_finished that is not the backend page')
  assert.equal(m.backendPageMs, 1300)
  assert.equal(m.backendReadyMs, 1250)
  assert.equal(m.homePaintedMs, 2265)
  assert.equal(m.homePaintedSinceWatchMs, 2200)
  assert.equal(m.devtoolsPort, 51234)
  assert.deepEqual(m.build, { smoke: true, measure: false, identifier: 'dev.nqlab.terminal.smoke' })
  assert.deepEqual(m.problems, [])
})

test('a milestone the log does not hold is null, never zero', () => {
  const m = milestones(parseShellLog(line(60, 'start', { smoke: false, measure: true })), T0)
  assert.equal(m.backendReadyMs, null)
  assert.equal(m.homePaintedMs, null)
  assert.equal(m.splashLoadMs, null)
})

test('a torn last line and garbage are skipped', () => {
  const events = parseShellLog(`${line(1, 'start')}\n{"t": 5, "ev\nnot json\n\n`)
  assert.equal(events.length, 1)
})

test('failure events are collected as problems', () => {
  const m = milestones(parseShellLog([line(1, 'start'), line(2, 'supervise_gave_up', { log: 'x' }), line(3, 'download_interrupted'), line(4, 'zoom_failed', { error: 'e' })].join('\n')), T0)
  assert.deepEqual(m.problems.map((p) => p.event), ['supervise_gave_up', 'zoom_failed'])
  assert.ok(FAILURE_EVENTS.has('hung_page_offer'))
})

const KEYS_OFF = { accelerator_keys: false, zoom_control: false, devtools: false, zoom_factor: 1 }

test('the engine settings read-back is part of the milestones', () => {
  const m = milestones(parseShellLog([line(1, 'start'), line(5, 'keys_installed', KEYS_OFF)].join('\n')), T0)
  assert.deepEqual(m.engineSettings, KEYS_OFF)
  assert.equal(milestones(parseShellLog(line(1, 'start')), T0).engineSettings, null)
})

test('a non-smoke build must read back devtools, accelerator keys and zoom control all off', () => {
  const log = (keys) => parseShellLog([line(1, 'start', { smoke: false, measure: true }), ...(keys ? [line(5, 'keys_installed', keys)] : [])].join('\n'))
  assert.deepEqual(engineSettingsProblems(log(KEYS_OFF)), [])
  assert.match(engineSettingsProblems(log(null)).join(), /no keys_installed/)
  for (const field of ['devtools', 'accelerator_keys', 'zoom_control']) {
    assert.match(engineSettingsProblems(log({ ...KEYS_OFF, [field]: true })).join(), new RegExp(field), `${field} on must be reported`)
    assert.match(engineSettingsProblems(log({ ...KEYS_OFF, [field]: null })).join(), new RegExp(field), `${field} unread must be reported`)
  }
})

test('a smoke build is not held to devtools off, a missing start record is a problem', () => {
  const smoke = parseShellLog([line(1, 'start', { smoke: true }), line(5, 'keys_installed', { ...KEYS_OFF, devtools: true })].join('\n'))
  assert.deepEqual(engineSettingsProblems(smoke), [])
  assert.match(engineSettingsProblems([]).join(), /no start/)
})
