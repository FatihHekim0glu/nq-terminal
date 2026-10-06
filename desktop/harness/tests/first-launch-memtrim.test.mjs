// The first-launch mode records the memtrim state like the rows mode, so its idle readings do not fall back to the raw working-set
// drop (born failing: modes/first-launch.mjs had no --memtrim option and called figuresOf without the state).
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { run } from '../modes/first-launch.mjs'
import { makeArgs } from '../run.mjs'

/** Run the mode with every outside effect faked; returns what the slot was given, what the launch saw and what the figures say. */
async function firstLaunch(argv, env) {
  const seen = { envDuringLaunch: undefined, slot: null }
  const deps = {
    resolveBuild: () => 'D:\dev\targets\fake\smoke.exe',
    launchRun: async () => { seen.envDuringLaunch = process.env.NQT_MEMTRIM; return { rows: { idle_mem_home: 380, backend_ready: 900 }, dataKind: 'fixture', idleTrim: { seen: true, capped: false, waitedMs: 66000 } } },
    executeSlot: async (slot) => { seen.slot = slot; const result = await slot.runFn({ gate: { avgPct: 2 } }); seen.result = result; return { status: 'dry', result } },
  }
  const prior = process.env.NQT_MEMTRIM
  if (env === undefined) delete process.env.NQT_MEMTRIM
  else process.env.NQT_MEMTRIM = env
  try {
    await run({ args: makeArgs(['--first-launch', '--dry', ...argv]), outDir: path.join(os.tmpdir(), 'nqt-first-launch-test'), provenance: { head: 'abc' } }, deps)
    seen.envAfter = process.env.NQT_MEMTRIM
  } finally {
    if (prior === undefined) delete process.env.NQT_MEMTRIM
    else process.env.NQT_MEMTRIM = prior
  }
  return seen
}

test('--memtrim off reaches the launch as NQT_MEMTRIM=0, is recorded on the slot and on every figure, and the environment is restored', async () => {
  const seen = await firstLaunch(['--memtrim', 'off'], undefined)
  assert.equal(seen.envDuringLaunch, '0')
  assert.equal(seen.slot.meta.memtrim, 'off')
  assert.ok(seen.result.figures.length > 0)
  for (const f of seen.result.figures) assert.equal(f.memtrim, 'off')
  const idle = seen.result.figures.find((f) => f.row === 'idle_mem_home')
  assert.equal(idle.trimSeen, false, 'with the trim off, the raw fall is not a trim')
  assert.equal(seen.envAfter, undefined)
})

test('no option records the inherited state: on when NQT_MEMTRIM is unset, off when it is 0', async () => {
  const onSeen = await firstLaunch([], undefined)
  assert.equal(onSeen.slot.meta.memtrim, 'on')
  for (const f of onSeen.result.figures) assert.equal(f.memtrim, 'on')
  const offSeen = await firstLaunch([], '0')
  assert.equal(offSeen.slot.meta.memtrim, 'off')
})

test('a bad --memtrim value is refused', async () => {
  await assert.rejects(() => firstLaunch(['--memtrim', 'maybe'], undefined), /--memtrim/)
})
