import test from 'node:test'
import assert from 'node:assert/strict'
import { extendBars, stepOf, BARS_TARGET } from '../lib/bars.mjs'

const series = (m, step = 60, t0 = 1_300_000_000) => {
  const t = Array.from({ length: m }, (_, i) => t0 + i * step)
  const col = (f) => t.map((_, i) => f(i))
  return { symbol: 'NQ.V.0', timeframe: '1m', bucket: '1m', t, o: col((i) => 100 + i), h: col((i) => 101 + i), l: col((i) => 99 + i), c: col((i) => 100.5 + i), v: col((i) => 10 + i), rolls: [], sessions: { assessed: true }, gate: { ok: 1 } }
}

test('a 390-bar session is tiled out to 20,000 bars with strictly increasing timestamps', () => {
  const body = series(390)
  const out = extendBars(body, BARS_TARGET)
  assert.equal(out.t.length, 20_000)
  for (const c of ['o', 'h', 'l', 'c', 'v']) assert.equal(out[c].length, 20_000)
  for (let i = 1; i < out.t.length; i++) assert.ok(out.t[i] > out.t[i - 1], `t not increasing at ${i}`)
  assert.equal(out.t[0], body.t[0])
  assert.equal(out.o[390], body.o[0], 'the next lap repeats the first bar')
  assert.deepEqual(out.gate, body.gate, 'every other field is the real response')
})

test('the step is the median positive gap', () => {
  assert.equal(stepOf([0, 60, 120, 180, 1000]), 60)
  assert.equal(stepOf([5]), 60)
})

test('a body that is not a bar series, or is already long enough, is left alone', () => {
  assert.equal(extendBars(null), null)
  assert.equal(extendBars({ t: [] }), null)
  assert.equal(extendBars({ t: [1, 2, 3] }), null, 'missing columns')
  assert.equal(extendBars(series(20_000)), null)
  assert.equal(extendBars({ ...series(10), o: [1] }), null, 'a ragged column')
})

test('a failing control: a column of the wrong length would have been returned as is (so the guard is real)', () => {
  const bad = { ...series(10), v: [1, 2] }
  assert.equal(extendBars(bad), null)
})
