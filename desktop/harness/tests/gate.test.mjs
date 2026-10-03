// The CPU gate (born failing): a planted spin must be rejected. The live spin is in modes/selftest.mjs; here the counters are injected.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readCpu, pctBusy, totals, waitQuiet } from '../lib/gate.mjs'

const fake = (busyFraction) => { let t = 0; let idle = 0; return () => { t += 1000; idle += 1000 * (1 - busyFraction); return { idle, total: t } } }
const noWait = async () => {}

test('a planted spin (95% busy) is rejected by the gate', async () => {
  const g = await readCpu(5, { limitPct: 10, read: fake(0.95), wait: noWait })
  assert.equal(g.pass, false)
  assert.ok(g.avgPct > 90)
  assert.equal(g.samples.length, 5)
})

test('a quiet machine (3% busy) passes, and the limit is inclusive', async () => {
  const quiet = await readCpu(5, { limitPct: 10, read: fake(0.03), wait: noWait })
  assert.equal(quiet.pass, true)
  const edge = await readCpu(5, { limitPct: 10, read: fake(0.1), wait: noWait })
  assert.equal(edge.pass, true)
})

test('one busy second does not fail an otherwise quiet minute (the rule is the average)', async () => {
  let i = 0
  let idle = 0
  let total = 0
  const read = () => { i += 1; total += 1000; idle += i === 3 ? 0 : 1000; return { idle, total } }
  const g = await readCpu(30, { limitPct: 10, read, wait: noWait })
  assert.equal(g.maxPct, 100)
  assert.equal(g.pass, true)
})

test('pctBusy of identical readings is 0 and the real counters are readable', () => {
  assert.equal(pctBusy({ idle: 5, total: 10 }, { idle: 5, total: 10 }), 0)
  const t = totals()
  assert.ok(t.total > 0)
})

test('waitQuiet stops waiting after the maximum and says the machine never went quiet', async () => {
  const g = async () => ({ avgPct: 40, pass: false, seconds: 60 })
  const out = await waitQuiet({ gateSeconds: 60, maxWaitSeconds: 180, gate: g })
  assert.equal(out.quiet, false)
  assert.equal(out.readings.length, 3)
  const quick = await waitQuiet({ gateSeconds: 60, maxWaitSeconds: 600, gate: async () => ({ avgPct: 2, pass: true, seconds: 60 }) })
  assert.equal(quick.quiet, true)
  assert.equal(quick.readings.length, 1)
})
