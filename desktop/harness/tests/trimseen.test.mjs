// trimSeen must mean the backend's own trim ran. With NQT_MEMTRIM=0 the backend's working set still falls after start-up (the HOME
// prewarm releases what it imported), and that fall cleared the drop threshold, so trimSeen read true with the trim off.
// Born failing: figuresOf wrote idleTrim.seen (a working-set drop) as trimSeen whatever the memtrim state, and the report ignored it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { trimEvidence, trimRan } from '../lib/idle-trim.mjs'
import { figuresOf } from '../modes/rows.mjs'
import { buildReport, informationalLines } from '../report.mjs'

// Backend working set (MB) read every 5 s from HOME ready, shaped like the idle series of a fixture-backed smoke launch: the prewarm's
// peak, then the backend's own release of start-up garbage. The series is the same shape with the trim on and off on purpose: the
// series alone cannot tell a trim from a release, which is why the memtrim field decides.
const at = (...mbs) => mbs.map((backendMB, i) => ({ tMs: i * 5000, backendMB }))
const RELEASE_SERIES = at(425, 431, 402, 330, 322, 321)

const idleResult = () => {
  const ev = trimEvidence(RELEASE_SERIES)
  return { rows: { idle_mem_home: 321 }, dataKind: 'fixture', idleTrim: { checked: true, seen: ev.seen, capped: false, waitedMs: 70_000, settledMB: ev.settledMB, series: RELEASE_SERIES } }
}
const idleFigure = (memtrim) => figuresOf('smoke', idleResult(), { avgPct: 3 }, { head: 'abc' }, memtrim).find((f) => f.row === 'idle_mem_home')

test('the recorded release series clears the drop threshold, so the series alone proves nothing', () => {
  assert.equal(trimEvidence(RELEASE_SERIES).seen, true)
})

test('trimSeen is false with the trim off, even though the working set dropped', () => {
  const f = idleFigure('off')
  assert.equal(f.trimSeen, false)
  assert.equal(f.trimDropSeen, true, 'the raw drop stays recorded, under its own name')
  assert.equal(f.memtrim, 'off')
})

test('trimSeen is true with the trim on and the drop seen', () => {
  const f = idleFigure('on')
  assert.equal(f.trimSeen, true)
  assert.equal(f.trimDropSeen, true)
})

test('trimSeen is false with the trim on when no drop was seen (the trim did not show)', () => {
  const flat = { ...idleResult(), idleTrim: { checked: true, seen: false, capped: true, waitedMs: 120_000 } }
  assert.equal(figuresOf('smoke', flat, null, null, 'on').find((f) => f.row === 'idle_mem_home').trimSeen, false)
})

test('an unread series (null) stays null with the trim on, and false with it off', () => {
  assert.equal(trimRan('on', null), null)
  assert.equal(trimRan('off', null), false, 'with the trim off nothing ran, read or not')
  assert.equal(trimRan('on', true), true)
  assert.equal(trimRan('on', false), false)
})

test('a caller that gives no memtrim state keeps the drop as its trimSeen (older callers)', () => {
  assert.equal(trimRan(undefined, true), true)
  assert.equal(trimRan(undefined, false), false)
})

// The report reads the memtrim field: a record written before the fix (trimSeen true beside memtrim off) is read as not seen.
const record = (n, memtrim, trimSeen) => ({
  schema: 'd5-run-1', status: 'accepted', build: 'smoke', mode: 'rows', file: `r${n}.json`, rows: { idle_mem_home: 321 },
  figures: [{ row: 'idle_mem_home', build: 'smoke', value: 321, unit: 'MB', method: 'm', cpuLoadPct: 2, stamp: { head: 'abc' }, memtrim, trimSeen, trimCapped: false, trimWaitedMs: 70_000 }],
})

test('the report recomputes trimSeen from memtrim: old records with the trim off read as not seen', () => {
  const records = [record(1, 'off', true), record(2, 'off', true), record(3, 'on', true)]
  const { idleTrim } = buildReport(records)
  assert.deepEqual(idleTrim.smoke.off, { n: 2, trimSeen: 0, capped: 0 })
  assert.deepEqual(idleTrim.smoke.on, { n: 1, trimSeen: 1, capped: 0 })
})

test('the report prints the trim state beside the idle figure', () => {
  const lines = informationalLines([record(1, 'off', true), record(2, 'on', true)])
  assert.ok(lines.some((l) => /trim ran in 0 of 1/.test(l) && /memtrim off/.test(l)), lines.join('\n'))
  assert.ok(lines.some((l) => /trim ran in 1 of 1/.test(l) && /memtrim on/.test(l)), lines.join('\n'))
})
