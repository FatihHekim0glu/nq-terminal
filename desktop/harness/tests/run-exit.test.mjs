// Born-failing checks for the exit code of run.mjs (run: node --test tests).
import test from 'node:test'
import assert from 'node:assert/strict'
import { exitCodeOf } from '../run.mjs'

test('a passing selftest result (an empty list of failed sections) exits 0', () => {
  assert.equal(exitCodeOf({ results: {}, failed: [] }), 0)
})

test('a failing selftest result (a list of failed section names) exits 1', () => {
  assert.equal(exitCodeOf({ results: {}, failed: ['spin'] }), 1)
})

test('parity and soak style booleans keep their meaning', () => {
  assert.equal(exitCodeOf({ failed: false }), 0)
  assert.equal(exitCodeOf({ failed: true }), 1)
})

test('a mode that returns nothing, or no failed field, exits 0', () => {
  assert.equal(exitCodeOf(undefined), 0)
  assert.equal(exitCodeOf(null), 0)
  assert.equal(exitCodeOf({}), 0)
})
