import test from 'node:test'
import assert from 'node:assert/strict'
import { verdictOf } from '../modes/minimise.mjs'

const clean = { driverEffective: true, hiddenAfterMs: 120, visibleAfterMs: 90, streamBackMs: 0 }

test('a simulated minimise that only overrode the page visibility is not a pass (the engine was never hidden)', () => {
  const problems = verdictOf({ ...clean, driver: 'page-override', engineLevel: false }, false)
  assert.ok(problems.some((p) => /not tested|engine/i.test(p)), JSON.stringify(problems))
})

test('a simulated minimise driven at engine level passes when the stream comes back in time', () => {
  assert.deepEqual(verdictOf({ ...clean, driver: 'controller-file', engineLevel: true }, false), [])
})

test('the real minimise is judged on the window and the stream, not on the driver level', () => {
  const problems = verdictOf({ ...clean, guardAfter: { ok: true }, foreground: { unchanged: true }, iconicAfterMinimise: true, iconicAfterRestore: false }, true)
  assert.deepEqual(problems, [])
})
