// The real-lab guard of the measure build (plan decision 11): a listener on 8765, a live backend.lock or a queued or running
// job means no launch and a pending record; after a launch the shell log, jobs.json, backtests/output and the lock are checked.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { snapshotLab, precheckProblems, postcheckProblems, guardsMeasure, launchBlock } from '../lib/lab-guard.mjs'
import { launchRun } from '../lib/launch-run.mjs'
import { isMainTree } from '../lib/paths.mjs'
import { classifyRun } from '../lib/slot.mjs'
import { STATUSES } from '../lib/record.mjs'

const quiet = { listeners: () => [], lockState: () => 'absent' }

function lab({ jobs = [], output = ['a/x.csv'], lock = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h-guard-'))
  const state = path.join(root, 'terminal', 'state')
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(path.join(state, 'jobs.json'), JSON.stringify({ version: 1, jobs }))
  if (lock) fs.writeFileSync(path.join(state, 'backend.lock'), '{}')
  for (const f of output) { const p = path.join(root, 'backtests', 'output', f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'data') }
  return { root, state, done: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test('only the measure build with real data is guarded', () => {
  assert.equal(guardsMeasure('measure', true), true)
  assert.equal(guardsMeasure('measure', false), false)
  assert.equal(guardsMeasure('smoke', true), false)
})

test('a quiet lab has no problem and the snapshot records the jobs hash and the output listing', () => {
  const l = lab()
  try {
    const snap = snapshotLab(l.root, quiet)
    assert.deepEqual(precheckProblems(snap), [])
    assert.match(snap.jobsSha256, /^[0-9a-f]{64}$/)
    assert.equal(snap.jobsActive, 0)
    assert.equal(snap.outputListing.length, 1)
  } finally { l.done() }
})

test('a fake listener on 8765 blocks the launch', () => {
  const l = lab()
  try {
    const problems = precheckProblems(snapshotLab(l.root, { ...quiet, listeners: () => [46084] }))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /8765.*46084/)
  } finally { l.done() }
})

test('a fake live lock blocks the launch, a stale lock file does not', () => {
  const l = lab({ lock: true })
  try {
    assert.match(precheckProblems(snapshotLab(l.root, { ...quiet, lockState: () => 'live' })).join(), /backend\.lock/)
    assert.deepEqual(precheckProblems(snapshotLab(l.root, { ...quiet, lockState: () => 'present-not-held' })), [])
  } finally { l.done() }
})

test('a fake queued or running job blocks the launch, finished jobs do not', () => {
  for (const state of ['queued', 'running']) {
    const l = lab({ jobs: [{ id: 'j1', state: 'done' }, { id: 'j2', state }] })
    try {
      const snap = snapshotLab(l.root, quiet)
      assert.equal(snap.jobsActive, 1)
      assert.match(precheckProblems(snap).join(), /job/)
    } finally { l.done() }
  }
  const l = lab({ jobs: [{ id: 'j1', state: 'done' }, { id: 'j2', state: 'error' }] })
  try { assert.deepEqual(precheckProblems(snapshotLab(l.root, quiet)), []) } finally { l.done() }
})

test('an unreadable jobs.json cannot prove the queue empty and blocks the launch', () => {
  const l = lab()
  try {
    fs.writeFileSync(path.join(l.state, 'jobs.json'), '{ nope')
    assert.match(precheckProblems(snapshotLab(l.root, quiet)).join(), /jobs\.json/)
  } finally { l.done() }
})

const spawned = [{ event: 'start' }, { event: 'supervise_spawned' }, { event: 'supervise_checked' }]

test('a clean run passes the post-check', () => {
  const l = lab()
  try {
    const snap = snapshotLab(l.root, quiet)
    assert.deepEqual(postcheckProblems(snap, snapshotLab(l.root, quiet), spawned), [])
  } finally { l.done() }
})

test('an attach, a missing spawn, a changed jobs.json, a new output file and a surviving lock each fail the post-check', () => {
  const l = lab()
  try {
    const before = snapshotLab(l.root, quiet)
    assert.match(postcheckProblems(before, before, [...spawned, { event: 'supervise_attached' }]).join(), /attach/)
    assert.match(postcheckProblems(before, before, [{ event: 'start' }]).join(), /supervise_spawned/)
    fs.writeFileSync(path.join(l.state, 'jobs.json'), JSON.stringify({ version: 1, jobs: [{ id: 'n', state: 'error' }] }))
    fs.writeFileSync(path.join(l.root, 'backtests', 'output', 'new.csv'), 'x')
    const after = snapshotLab(l.root, { ...quiet, lockState: () => 'live' })
    const text = postcheckProblems(before, after, spawned).join('\n')
    assert.match(text, /jobs\.json changed/)
    assert.match(text, /backtests\/output/)
    assert.match(text, /backend\.lock/)
  } finally { l.done() }
})

test('a pending run is its own status and is never counted', () => {
  assert.ok(STATUSES.includes('pending'))
  assert.equal(classifyRun('accepted', { pending: ['8765 is listening'], rows: {} }), 'pending')
})

test('launchBlock names the problems only for a guarded launch', () => {
  const l = lab({ jobs: [{ id: 'q', state: 'queued' }] })
  try {
    assert.equal(launchBlock('smoke', true, l.root, quiet), null)
    assert.equal(launchBlock('measure', false, l.root, quiet), null)
    const block = launchBlock('measure', true, l.root, quiet)
    assert.match(block.problems.join(), /job/)
    assert.equal(block.summary.jobsActive, 1)
  } finally { l.done() }
})

test('launchRun on the real lab with a fake listener on 8765 starts nothing and returns pending', async (t) => {
  if (!isMainTree()) return t.skip('real-data launches run from the main tree only')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-guard-run-'))
  try {
    const exe = path.join(dir, 'fake-measure.exe')
    fs.writeFileSync(exe, 'not an executable: a spawn would fail the test')
    const r = await launchRun({ build: 'measure', exe, runDir: path.join(dir, 'run'), o: { realData: true, labProbes: { listeners: () => [46084], lockState: () => 'absent' } } })
    assert.match(r.pending.join(), /8765/)
    assert.equal(r.rootPid, undefined)
    assert.equal(classifyRun('accepted', r, ['backend_ready']), 'pending')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
