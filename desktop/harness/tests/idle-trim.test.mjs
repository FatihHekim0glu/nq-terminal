// The idle sample is taken on evidence of the backend's quiet trim, not at a fixed offset from HOME ready: foreground requests that
// arrive after first paint (the lazily mounted record watch, lazy chunks, slow real-data panels) push the trim past a fixed wait.
// Born failing: lib/idle-trim.mjs did not exist, and the wait was a fixed 66 s from HOME ready.
import test from 'node:test'
import assert from 'node:assert/strict'
import { trimEvidence, waitForIdleTrim, IDLE_CAP_MS, TRIM_MIN_DROP_MB } from '../lib/idle-trim.mjs'
import { defaultOptions } from '../lib/launch-run.mjs'
import { figuresOf } from '../modes/rows.mjs'

const at = (...mbs) => mbs.map((backendMB, i) => ({ tMs: i * 5000, backendMB }))

test('a drop of the backend working set that then holds is a seen, settled trim', () => {
  const e = trimEvidence(at(420, 425, 270, 268))
  assert.equal(e.seen, true)
  assert.equal(e.settled, true)
  assert.equal(e.peakMB, 425)
  assert.equal(e.settledMB, 268)
})

test('a drop still in progress is not settled', () => {
  const e = trimEvidence(at(420, 300, 200))
  assert.equal(e.seen, true)
  assert.equal(e.settled, false)
})

test('a flat series shows no trim, and a drop below the floor does not count', () => {
  assert.equal(trimEvidence(at(420, 421, 419, 420)).seen, false)
  assert.equal(trimEvidence(at(420, 420 - (TRIM_MIN_DROP_MB - 1), 420 - (TRIM_MIN_DROP_MB - 1))).seen, false)
})

test('a working set that fell and then grew back to the peak is not a trim', () => {
  assert.equal(trimEvidence(at(420, 270, 415, 418)).seen, false)
})

test('too few samples are not evidence', () => {
  assert.equal(trimEvidence(at(420)).seen, false)
  assert.equal(trimEvidence([]).seen, false)
})

/** A fake clock and reader: the backend working set follows a table of (time, MB). */
function rig(table) {
  let now = 0
  const clock = { now: () => now, sleep: async (ms) => { now += ms } }
  const read = async () => { const row = [...table].reverse().find(([t]) => now >= t); return row[1] }
  return { clock, read }
}

test('a trim that fires late (after the old fixed 66 s) is waited for, then the wait ends', async () => {
  const { clock, read } = rig([[0, 430], [78_000, 280]])
  const r = await waitForIdleTrim({ read, ...clock, floorMs: 66_000, capMs: IDLE_CAP_MS, pollMs: 5000 })
  assert.equal(r.seen, true)
  assert.equal(r.capped, false)
  assert.ok(r.waitedMs >= 78_000, `${r.waitedMs}`)
  assert.ok(r.waitedMs < IDLE_CAP_MS)
  assert.equal(r.settledMB, 280)
})

test('a trim that fired before the floor is found from the opening sample and the wait ends at the floor plus settling', async () => {
  const { clock, read } = rig([[0, 430], [40_000, 280]])
  const r = await waitForIdleTrim({ read, ...clock, floorMs: 66_000, capMs: IDLE_CAP_MS, pollMs: 5000 })
  assert.equal(r.seen, true)
  assert.ok(r.waitedMs <= 66_000 + 2 * 5000)
})

test('no trim by the cap ends the wait at the cap, flagged, never silently', async () => {
  const { clock, read } = rig([[0, 430]])
  const r = await waitForIdleTrim({ read, ...clock, floorMs: 66_000, capMs: IDLE_CAP_MS, pollMs: 5000 })
  assert.equal(r.seen, false)
  assert.equal(r.capped, true)
  assert.ok(r.waitedMs >= IDLE_CAP_MS)
  assert.ok(r.series.length > 2)
})

test('an unreadable backend falls back to the floor and says so', async () => {
  const { clock } = rig([[0, 1]])
  const r = await waitForIdleTrim({ read: async () => { throw new Error('no counters') }, ...clock, floorMs: 66_000, capMs: IDLE_CAP_MS, pollMs: 5000 })
  assert.equal(r.checked, false)
  assert.equal(r.seen, null)
  assert.match(r.error, /no counters/)
  assert.equal(r.waitedMs, 66_000)
})

test('a zero floor switches the evidence wait off (tests)', async () => {
  const { clock } = rig([[0, 1]])
  const r = await waitForIdleTrim({ read: async () => { throw new Error('must not read') }, ...clock, floorMs: 0, capMs: IDLE_CAP_MS, pollMs: 5000 })
  assert.equal(r.checked, false)
  assert.equal(r.waitedMs, 0)
})

test('the cap covers the record watch worst case: last request 12 s mount wait + 4 s idle after 66 s, then a 65 s trim and a 5 s poll', () => {
  assert.ok(IDLE_CAP_MS >= (66 + 12 + 4 + 5) * 1000)
  assert.ok(IDLE_CAP_MS > defaultOptions.idleQuietMs)
  assert.equal(defaultOptions.idleCapMs, IDLE_CAP_MS)
})

test('the idle figure records whether a trim was seen before the samples', () => {
  const result = { rows: { idle_mem_home: 380 }, idlePrivateBytesMB: 910, dataKind: 'fixture', idleTrim: { checked: true, seen: true, capped: false, waitedMs: 80_000, settledMB: 280 } }
  const fig = figuresOf('smoke', result, null, null).find((f) => f.row === 'idle_mem_home')
  assert.equal(fig.trimSeen, true)
  assert.equal(fig.trimCapped, false)
  assert.equal(fig.trimWaitedMs, 80_000)
})
