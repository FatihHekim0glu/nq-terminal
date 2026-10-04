// The soak summary: the row stays the largest sample; the start-up peak, the settled maximum, the first sample's time, the
// private-bytes range and the first and last breakdown are added beside it (born failing: those fields were absent).
import test from 'node:test'
import assert from 'node:assert/strict'
import { summariseSoak, SETTLED_FROM_S } from '../modes/soak.mjs'

const s = (atS, wsPrivateMB, extra = {}) => ({ atS, wsPrivateMB, ...extra })
const SYNTH = [s(5, 1577), s(300, 1463), s(1200, 1290), s(3000, 700)]

test('summary: the row is still the largest sample, and the start-up peak and settled maximum sit beside it', () => {
  const r = summariseSoak(SYNTH)
  assert.equal(r.maxMB, 1577)
  assert.equal(r.startupPeakMB, 1577)
  assert.equal(r.settledMaxMB, 1290)
  assert.equal(r.firstSampleAtS, 5)
  assert.equal(r.lastMB, 700)
  assert.equal(r.n, 4)
  assert.equal(SETTLED_FROM_S, 900)
})

test('summary: the settled window starts at 900 s inclusive, and is null when no sample reaches it', () => {
  assert.equal(summariseSoak([s(5, 800), s(900, 600), s(1200, 500)]).settledMaxMB, 600)
  assert.equal(summariseSoak([s(5, 800), s(300, 700)]).settledMaxMB, null)
})

test('summary: the first sample is the first in time order that has a reading', () => {
  const r = summariseSoak([s(7, null), s(11, 900), s(300, 800)])
  assert.equal(r.firstSampleAtS, 11)
  assert.equal(r.startupPeakMB, 900)
})

test('summary: private bytes minimum and maximum come from the samples that have them', () => {
  const r = summariseSoak([s(5, 1, { privateBytesMB: 2100 }), s(300, 1, { privateBytesMB: 1900 }), s(600, 1)])
  assert.equal(r.privateBytesMinMB, 1900)
  assert.equal(r.privateBytesMaxMB, 2100)
  assert.equal(summariseSoak(SYNTH).privateBytesMinMB, null)
})

test('summary: the breakdown at the first and last sample is kept with its time', () => {
  const b1 = { backendMB: 900, uiTreeMB: 180, shellMB: 4, perType: { renderer: 90 } }
  const b2 = { backendMB: 400, uiTreeMB: 190, shellMB: 4, perType: { renderer: 95 } }
  const r = summariseSoak([s(5, 1100, { breakdown: b1 }), s(300, 900), s(600, 600, { breakdown: b2 })])
  assert.deepEqual(r.breakdown, { first: { atS: 5, ...b1 }, last: { atS: 600, ...b2 } })
  assert.equal(summariseSoak(SYNTH).breakdown, null)
})

test('summary: an empty series has null for every figure and keeps its old fields', () => {
  const r = summariseSoak([])
  assert.deepEqual([r.n, r.maxMB, r.lastMB, r.slopeMBPerHour], [0, null, null, null])
  assert.equal(r.startupPeakMB, null)
  assert.equal(r.settledMaxMB, null)
  assert.equal(r.firstSampleAtS, null)
})

test('summary: the old fields keep their meaning', () => {
  const r = summariseSoak([s(0, 100), s(3600, 200)])
  assert.equal(r.slopeMBPerHour, 100)
})

// A failed breakdown read leaves a trace (born failing: breakdownOf swallowed it and the summary could not tell).
test('breakdownOf reports the reason of a failed read and gives null', async () => {
  const { breakdownOf } = await import('../modes/soak.mjs')
  const seen = []
  assert.equal(breakdownOf(7, (m) => seen.push(m), () => { throw new Error('mem.ps1 gave malformed JSON') }), null)
  assert.deepEqual(seen, ['mem.ps1 gave malformed JSON'])
  assert.deepEqual(breakdownOf(7, () => {}, () => ({ backendMB: 1, uiTreeMB: 2, shellMB: 3, perType: { renderer: 2 }, totalMB: 6 })), { backendMB: 1, uiTreeMB: 2, shellMB: 3, perType: { renderer: 2 } })
})

test('summary: failed breakdown reads are counted with the first reason, and absent when none failed', () => {
  const r = summariseSoak([s(5, 900, { breakdownError: 'timeout' }), s(300, 800, { breakdownError: 'other' }), s(600, 700, { breakdown: { backendMB: 1, uiTreeMB: 2, shellMB: 3, perType: {} } })])
  assert.equal(r.breakdownFailures, 2)
  assert.equal(r.breakdownError, 'timeout')
  assert.equal('breakdownFailures' in summariseSoak(SYNTH), false)
})
