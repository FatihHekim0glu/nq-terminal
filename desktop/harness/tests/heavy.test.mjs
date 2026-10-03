// A heavy set with a step or panel error is never a complete reading (the reproduction's memory after the heavy set), and the
// synthetic 8,411 fills keep the API's shape and paging.
import test from 'node:test'
import assert from 'node:assert/strict'
import { heavyErrors, heavyComplete } from '../lib/heavy.mjs'
import { fillsBody, FILLS } from '../lib/fills.mjs'

const okDock = { step: '5 dockview, 6 extra panels', panels: [{ line: 'NQ DES', domMs: 300 }, { line: 'volmanaged_v0 DES', domMs: 50 }] }
const badDock = { step: '5 dockview, 6 extra panels', panels: [{ line: 'NQ DES', domMs: 300 }, { line: 'volmanaged_v0 DES', error: 'js: screen timeout' }] }

test('a complete dock step and a run without a heavy set have no errors', () => {
  assert.deepEqual(heavyErrors([{ step: 'RUN open' }, okDock]), [])
  assert.deepEqual(heavyErrors(undefined), [])
  assert.equal(heavyComplete({ steps: [okDock] }), true)
})

test('the failing panel of a dock step is named (born failing)', () => {
  assert.deepEqual(heavyErrors([okDock, badDock]).map((e) => e.where), ['volmanaged_v0 DES'])
  assert.equal(heavyComplete({ steps: [okDock, badDock] }), false)
})

test('a step that carries an error is reported', () => {
  assert.equal(heavyErrors([{ step: '2 uPlot (RR)', error: 'boom' }]).length, 1)
})

test('the synthetic fills are 8,411 rows in two pages with the API envelope', () => {
  const first = JSON.parse(fillsBody('http://127.0.0.1:1/api/runs/x/fills?offset=0&limit=5000'))
  const second = JSON.parse(fillsBody('http://127.0.0.1:1/api/runs/x/fills?offset=5000&limit=5000'))
  assert.equal(FILLS, 8411)
  assert.equal(first.items.length, 5000)
  assert.equal(second.items.length, 3411)
  assert.equal(first.total, 8411)
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['commission', 'commission_float', 'instrument', 'order_id', 'position_id', 'px', 'qty', 'side', 'tags', 'ts', 'ts_epoch_s'])
})
