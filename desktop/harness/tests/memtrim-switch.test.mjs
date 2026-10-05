// NQT_MEMTRIM must reach the desktop backend, so the owner's off switch and the trim on/off re-measure work (born failing: the shell
// passed only NQT_CACHE_BYTES, and the rows mode had no --memtrim option).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SHELL_PASSED_NQT, shellStart } from '../lib/parity.mjs'
import { figuresOf, memtrimState } from '../modes/rows.mjs'

const OPTS = { lab: 'C:\lab', port: 8792, stateDir: 'D:\dev\tmp\st', fixtureDir: 'C:\lab\fixtures' }

test('the passed NQT_ names are exactly those of supervise_check.rs, and include NQT_MEMTRIM', () => {
  const rust = fs.readFileSync(new URL('../../src-tauri/src/supervise_check.rs', import.meta.url), 'utf8')
  const block = /pub const PASSED_NQT: \[&str; \d+\] = \[([^\]]*)\];/.exec(rust)?.[1] ?? ''
  const names = [...block.matchAll(/"([A-Z_0-9]+)"/g)].map((m) => m[1])
  assert.deepEqual([...SHELL_PASSED_NQT], names)
  assert.ok(names.includes('NQT_MEMTRIM'))
})

test('shell start passes NQT_MEMTRIM=0 on from the parent environment', () => {
  assert.equal(shellStart({ NQT_MEMTRIM: '0' }, OPTS).env.NQT_MEMTRIM, '0')
  assert.equal('NQT_MEMTRIM' in shellStart({}, OPTS).env, false)
})

test('--memtrim off sets NQT_MEMTRIM=0 in the environment the shell inherits, on clears it, and the state is reported', () => {
  const env = {}
  assert.equal(memtrimState('off', env), 'off')
  assert.equal(env.NQT_MEMTRIM, '0')
  assert.equal(memtrimState('on', env), 'on')
  assert.equal('NQT_MEMTRIM' in env, false)
  assert.equal(memtrimState(null, { NQT_MEMTRIM: '0' }), 'off', 'no option reads the inherited value')
  assert.equal(memtrimState(null, {}), 'on')
  assert.throws(() => memtrimState('maybe', {}), /--memtrim/)
})

test('every figure records the trim state when it is given', () => {
  const result = { rows: { idle_mem_home: 380, warm_home: 40 }, dataKind: 'fixture' }
  for (const f of figuresOf('smoke', result, { avgPct: 3 }, { head: 'abc' }, 'off')) assert.equal(f.memtrim, 'off')
  for (const f of figuresOf('smoke', result, { avgPct: 3 }, { head: 'abc' })) assert.equal('memtrim' in f, false)
})
