// perf-2: a growing private-bytes series fails the soak even when the working set is flat (born failing: the rule, the summary
// fields, the report line and the idle private-bytes figure did not exist). A trim of the backend working set lowers the counted
// row but not the committed memory, so the private bytes are the leak signal.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEAK_RULE, privateBytesLeakVerdict } from '../lib/rows.mjs'
import { summariseSoak } from '../modes/soak.mjs'
import { buildReport, overCeiling, informationalLines } from '../report.mjs'
import { idlePrivateBytesOf } from '../lib/launch-run.mjs'
import { figuresOf } from '../modes/rows.mjs'

// One sample every 5 minutes for `hours`; the working set is flat, the private bytes follow `pb(hours)`.
const series = (hours, pb, ws = () => 700) => {
  const out = []
  for (let atS = 5; atS <= hours * 3600; atS += atS === 5 ? 295 : 300) out.push({ atS, wsPrivateMB: ws(atS / 3600), privateBytesMB: pb(atS / 3600) })
  return out
}
const noise = (i) => ((i * 7919) % 11) - 5 // deterministic, within +-5 MB
const FLAT = series(8, (h) => 2000 + noise(Math.round(h * 100)))
const GROWING = series(8, (h) => 2000 + 90 * h) // 90 MB an hour, working set flat
const GROWS_ONLY_AT_START = series(8, (h) => (h < 0.25 ? 1200 + 3200 * h : 2000))

test('the rule is named and has its limits in one place', () => {
  assert.equal(LEAK_RULE.settledFromS, 900)
  assert.ok(LEAK_RULE.maxSlopeMBPerHour > 0 && LEAK_RULE.minGrowthMB > 0 && LEAK_RULE.minSamples >= 3 && LEAK_RULE.minSpanS >= 900)
})

test('planted growth in private bytes fails although the working set is flat', () => {
  assert.ok(GROWING.every((s) => s.wsPrivateMB === 700))
  const v = privateBytesLeakVerdict(GROWING)
  assert.equal(v.verdict, 'fail')
  assert.ok(v.slopeMBPerHour > 80 && v.slopeMBPerHour < 100, `slope ${v.slopeMBPerHour}`)
  assert.ok(v.growthMB > 500)
  assert.match(v.reason, /private bytes/i)
})

test('flat private bytes with noise pass', () => {
  const v = privateBytesLeakVerdict(FLAT)
  assert.equal(v.verdict, 'pass')
  assert.ok(Math.abs(v.slopeMBPerHour) < LEAK_RULE.maxSlopeMBPerHour)
})

test('growth that stops before the settled window does not fail', () => {
  assert.equal(privateBytesLeakVerdict(GROWS_ONLY_AT_START).verdict, 'pass')
})

test('too few settled samples, too short a span or no private bytes is not evaluated, never a pass', () => {
  assert.equal(privateBytesLeakVerdict(series(0.3, (h) => 2000 + 900 * h)).verdict, 'not-evaluated')
  assert.equal(privateBytesLeakVerdict(GROWING.map((s) => ({ atS: s.atS, wsPrivateMB: s.wsPrivateMB }))).verdict, 'not-evaluated')
  assert.equal(privateBytesLeakVerdict([]).verdict, 'not-evaluated')
  assert.equal(privateBytesLeakVerdict(series(0.45, (h) => 2000 + 900 * h)).verdict, 'not-evaluated')
})

test('a steep slope over a trivial total growth does not fail (both limits must be crossed)', () => {
  const tiny = [{ atS: 900, privateBytesMB: 2000 }, { atS: 1200, privateBytesMB: 2003 }, { atS: 1500, privateBytesMB: 2006 }, { atS: 1800, privateBytesMB: 2009 }, { atS: 2700, privateBytesMB: 2018 }]
  const v = privateBytesLeakVerdict(tiny)
  assert.ok(v.slopeMBPerHour > LEAK_RULE.maxSlopeMBPerHour)
  assert.ok(v.growthMB < LEAK_RULE.minGrowthMB)
  assert.equal(v.verdict, 'pass')
})

test('the soak summary reports private-bytes growth beside the working set and carries the verdict', () => {
  const r = summariseSoak(GROWING)
  assert.equal(r.leak.verdict, 'fail')
  assert.equal(r.privateBytesSlopeMBPerHour, r.leak.slopeMBPerHour)
  assert.equal(r.maxMB, 700)
  assert.ok(Math.abs(r.slopeMBPerHour) < 1, 'the working set is flat')
  assert.equal(summariseSoak(FLAT).leak.verdict, 'pass')
  assert.equal(summariseSoak([]).leak.verdict, 'not-evaluated')
})

const soakRecord = (samples, extra = {}) => ({ schema: 'd5-run-1', status: 'accepted', mode: 'soak', build: 'smoke', file: 'soak.json', figures: [], rows: {}, samples, soak: summariseSoak(samples), ...extra })

test('the report fails a planted private-bytes growth and passes a flat series', () => {
  const bad = overCeiling(buildReport([soakRecord(GROWING)]))
  assert.ok(bad.some((l) => /private bytes/i.test(l)), bad.join(' | '))
  assert.equal(overCeiling(buildReport([soakRecord(FLAT)])).some((l) => /private bytes/i.test(l)), false)
})

test('the report recomputes the verdict from the raw samples, so a record without the summary still fails', () => {
  const old = soakRecord(GROWING)
  delete old.soak.leak
  assert.ok(overCeiling(buildReport([old])).some((l) => /private bytes/i.test(l)))
})

test('the report prints the private-bytes slope and the verdict beside the soak line', () => {
  const lines = informationalLines([soakRecord(GROWING)]).join('\n')
  assert.match(lines, /private bytes/i)
  assert.match(lines, /fail/i)
})

test('idle: the private bytes of the tree are the median of the samples, in MB to one decimal', () => {
  const MB = 1048576
  assert.equal(idlePrivateBytesOf([{ privateBytes: 900 * MB }, { privateBytes: 920 * MB }, { privateBytes: 910 * MB }]), 910)
  assert.equal(idlePrivateBytesOf([{ privateBytes: 1.25 * MB }]), 1.3)
  assert.equal(idlePrivateBytesOf([]), null)
})

test('the idle row figure carries the private bytes beside the working set', () => {
  const result = { rows: { idle_mem_home: 380, backend_ready: 1200 }, idlePrivateBytesMB: 910, dataKind: 'fixture' }
  const figs = figuresOf('smoke', result, { avgPct: 3 }, { head: 'abc' })
  assert.equal(figs.find((f) => f.row === 'idle_mem_home').privateBytesMB, 910)
  assert.equal('privateBytesMB' in figs.find((f) => f.row === 'backend_ready'), false)
})

test('the idle report line shows private bytes beside the working set', () => {
  const rec = { schema: 'd5-run-1', status: 'accepted', mode: 'rows', build: 'smoke', file: 'a.json', rows: { idle_mem_home: 380 }, figures: [], memSamples: [{ wsPrivateMB: 380, privateBytesMB: 910 }, { wsPrivateMB: 382, privateBytesMB: 912 }] }
  const lines = informationalLines([rec]).join('\n')
  assert.match(lines, /idle private bytes/i)
  assert.match(lines, /911/)
})
