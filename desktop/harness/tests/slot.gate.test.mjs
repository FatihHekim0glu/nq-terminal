// A gate reading above the limit rejects the attempt: the run does not start and the record is kept (born failing).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeSlot } from '../lib/slot.mjs'
import { readCpu } from '../lib/gate.mjs'
import { loadRecords } from '../lib/record.mjs'

test('a planted spin makes the slot rejected, keeps the record and never runs the launch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-slot-'))
  let launched = false
  try {
    const busy = (() => { let t = 0; let idle = 0; return () => { t += 1000; idle += 50; return { idle, total: t } } })()
    const gateFn = (s, o) => readCpu(2, { ...o, read: busy, wait: async () => {} })
    const out = await executeSlot({ mode: 'rows', build: 'smoke', slot: 1, attempt: 1, kind: 'measure', outDir: dir, gateFn, gateSeconds: 2, limitPct: 10, runFn: async () => { launched = true; return {} } })
    assert.equal(out.status, 'rejected')
    assert.equal(launched, false)
    const recs = loadRecords(dir)
    assert.equal(recs.length, 1)
    assert.equal(recs[0].status, 'rejected')
    assert.match(recs[0].reason, /above 10%/)
    assert.ok(recs[0].gate.avgPct > 90)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
