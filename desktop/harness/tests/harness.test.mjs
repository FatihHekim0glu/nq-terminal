// The reproduction gate: measurements need a verdict that says reproduced, is not dry and belongs to this harness code.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reproduceGate, writeReproduceVerdict, harnessDigest, reproduceVerdictFile } from '../lib/harness.mjs'
import { judgeReproduction } from '../modes/reproduce.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h-gate-'))

test('no verdict, a dry verdict and a failed verdict each keep the gate shut (born failing)', () => {
  const root = tmp()
  try {
    assert.equal(reproduceGate(root).ok, false)
    writeReproduceVerdict({ reproduced: true, dry: true }, root)
    assert.match(reproduceGate(root).why, /dry/)
    writeReproduceVerdict({ reproduced: false, dry: false }, root)
    assert.match(reproduceGate(root).why, /did not reproduce/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a reproduced verdict opens the gate only for the same harness code', () => {
  const root = tmp()
  try {
    writeReproduceVerdict({ reproduced: true, dry: false }, root)
    assert.equal(reproduceGate(root).ok, true)
    assert.match(reproduceGate(root, 'a-different-digest').why, /harness code changed/)
    const v = JSON.parse(fs.readFileSync(reproduceVerdictFile(root), 'utf8'))
    assert.equal(v.harnessDigest, harnessDigest())
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('judgeReproduction applies 10% or min to max against the W0B reference', () => {
  const ref = { memHomeMB: { median: 164.9, min: 159.7, max: 168.4 }, homeReadyMs: { median: 834.5, min: 814, max: 892 } }
  const ok = judgeReproduction([{ rows: { memHomeMB: 165, homeReadyMs: 850 } }, { rows: { memHomeMB: 170, homeReadyMs: 840 } }, { rows: { memHomeMB: 163, homeReadyMs: 860 } }], ref)
  assert.equal(ok.memHomeMB.within, true)
  assert.equal(ok.homeReadyMs.within, true)
  const slow = judgeReproduction([{ rows: { memHomeMB: 165, homeReadyMs: 1500 } }], ref)
  assert.equal(slow.homeReadyMs.within, false)
  assert.ok(slow.homeReadyMs.deltaPct > 70)
  const none = judgeReproduction([{ rows: {} }], ref)
  assert.equal(none.memHomeMB.within, false)
})
