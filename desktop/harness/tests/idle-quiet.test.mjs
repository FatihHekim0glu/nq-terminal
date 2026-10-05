// perf-1: the backend trims its working set 60 s after the last foreground request and looks every 5 s, so the idle sample must be
// taken more than 65 s after HOME is ready, or it reads the untrimmed set. Born failing: idleWaitMs and idleQuietMs did not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultOptions, idleWaitMs, BACKEND_QUIET_S, BACKEND_POLL_S } from '../lib/launch-run.mjs'

test('the backend quiet period and poll interval are the ones memtrim.py uses', () => {
  assert.equal(BACKEND_QUIET_S, 60)
  assert.equal(BACKEND_POLL_S, 5)
})

test('the default idle wait is more than the quiet period plus one poll', () => {
  assert.ok(defaultOptions.idleQuietMs > (BACKEND_QUIET_S + BACKEND_POLL_S) * 1000, `${defaultOptions.idleQuietMs} ms`)
  assert.ok(idleWaitMs(defaultOptions) > 65_000)
})

test('a short settle never shortens the quiet wait, and a longer one still wins', () => {
  assert.equal(idleWaitMs({ settleMs: 8000, idleQuietMs: 66_000 }), 66_000)
  assert.equal(idleWaitMs({ settleMs: 90_000, idleQuietMs: 66_000 }), 90_000)
})

test('a test run can switch the quiet wait off with idleQuietMs 0', () => {
  assert.equal(idleWaitMs({ settleMs: 8000, idleQuietMs: 0 }), 8000)
})

test('the constants match backend/nq_terminal/memtrim.py (read from the file, so they cannot drift)', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../../../backend/nq_terminal/memtrim.py', import.meta.url), 'utf8')
  assert.equal(Number(/^QUIET_S = ([\d.]+)/m.exec(src)?.[1]), BACKEND_QUIET_S)
  assert.equal(Number(/^POLL_S = ([\d.]+)/m.exec(src)?.[1]), BACKEND_POLL_S)
})
