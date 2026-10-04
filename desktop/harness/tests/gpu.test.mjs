// The GPU reading beside every gated slot (born failing): each slot record carries the GPU utilisation and memory used,
// or says plainly that the reading was unavailable; a failed reading never stops a measurement.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseGpu, readGpu } from '../lib/gpu.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { loadRecords } from '../lib/record.mjs'

const quiet = async () => ({ avgPct: 3, pass: true, seconds: 2, samples: [3, 3] })
const sampleGpu = (n) => async () => ({ available: true, utilPct: n, memUsedMiB: 2045, atIso: '2026-10-04T00:00:00.000Z' })

test('parseGpu reads the utilisation and memory columns, and the busiest card when there are several', () => {
  assert.deepEqual(parseGpu('13, 2045\n'), { available: true, utilPct: 13, memUsedMiB: 2045 })
  assert.deepEqual(parseGpu('4, 100\n97, 11392\n'), { available: true, utilPct: 97, memUsedMiB: 11392 })
})

test('parseGpu refuses output it cannot read instead of inventing a figure', () => {
  assert.equal(parseGpu('').available, false)
  assert.equal(parseGpu('N/A, N/A').available, false)
  assert.equal(parseGpu('garbage').available, false)
})

test('readGpu never throws when nvidia-smi is missing or fails', async () => {
  const none = await readGpu({ run: async () => { throw new Error('spawn nvidia-smi ENOENT') } })
  assert.equal(none.available, false)
  assert.match(none.reason, /ENOENT/)
  const ok = await readGpu({ run: async () => '55, 3000\n' })
  assert.equal(ok.utilPct, 55)
  assert.ok(ok.atIso)
})

test('an accepted slot record carries the GPU reading taken at the gate and after the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-gpu-'))
  try {
    const out = await executeSlot({ mode: 'rows', build: 'smoke', slot: 1, attempt: 1, kind: 'measure', outDir: dir, gateFn: quiet, gpuFn: sampleGpu(97), gateSeconds: 2, limitPct: 10, runFn: async () => ({}) })
    const rec = loadRecords(dir).find((r) => r.file === out.file)
    assert.equal(rec.gpu.atGate.utilPct, 97)
    assert.equal(rec.gpu.afterRun.memUsedMiB, 2045)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a rejected slot record keeps the GPU reading too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-gpu-'))
  try {
    const busy = async () => ({ avgPct: 40, pass: false, seconds: 2, samples: [40, 40] })
    const out = await executeSlot({ mode: 'rows', build: 'smoke', slot: 1, attempt: 1, kind: 'measure', outDir: dir, gateFn: busy, gpuFn: sampleGpu(11), gateSeconds: 2, limitPct: 10, runFn: async () => ({}) })
    assert.equal(out.status, 'rejected')
    assert.equal(loadRecords(dir)[0].gpu.atGate.utilPct, 11)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a GPU reading that fails is recorded as unavailable and the run still counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-gpu-'))
  try {
    const out = await executeSlot({ mode: 'rows', build: 'smoke', slot: 1, attempt: 1, kind: 'measure', outDir: dir, gateFn: quiet, gpuFn: async () => ({ available: false, reason: 'no nvidia-smi' }), gateSeconds: 2, limitPct: 10, runFn: async () => ({}) })
    assert.equal(out.status, 'accepted')
    assert.equal(loadRecords(dir)[0].gpu.atGate.available, false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
