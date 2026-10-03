// The slot: gate rejection keeps the record, provisional after the cap, window failures and missing rows are named.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyRun } from '../lib/slot.mjs'
import { loadRecords, writeRecord, STATUSES } from '../lib/record.mjs'

test('a new visible window or a foreground change is a window-fail', () => {
  assert.equal(classifyRun('accepted', { homeReady: true, watch: { clean: false }, rows: { a: 1 } }, ['a']), 'window-fail')
})

test('a run that never reached HOME is failed, or dry-incomplete in a dry run', () => {
  assert.equal(classifyRun('accepted', { homeReady: false, watch: { clean: true } }), 'failed')
  assert.equal(classifyRun('dry', { fatal: 'x', watch: { clean: true } }), 'dry-incomplete')
})

test('a clean run that lacks an expected row is incomplete, never accepted', () => {
  assert.equal(classifyRun('accepted', { homeReady: true, watch: { clean: true }, rows: { a: 1 } }, ['a', 'b']), 'incomplete')
  assert.equal(classifyRun('accepted', { homeReady: true, watch: { clean: true }, rows: { a: 1, b: 2 } }, ['a', 'b']), 'accepted')
  assert.equal(classifyRun('provisional', { homeReady: true, watch: { clean: true }, rows: { a: 1, b: 2 } }, ['a', 'b']), 'provisional')
})

test('records are written and read back with their schema; foreign JSON is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-rec-'))
  try {
    writeRecord(dir, 'one', { status: 'rejected', build: 'smoke', gate: { avgPct: 33 } })
    fs.writeFileSync(path.join(dir, 'other.json'), '{"schema":"x"}')
    fs.writeFileSync(path.join(dir, 'bad.json'), '{')
    const recs = loadRecords(dir)
    assert.equal(recs.length, 1)
    assert.equal(recs[0].gate.avgPct, 33)
    assert.ok(STATUSES.includes(recs[0].status))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
