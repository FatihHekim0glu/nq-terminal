// The backend now writes its working-set trims and the prewarm's start and end to backend.log (memtrim.py, prewarm.py); the harness reads
// them from there. Born failing: no parser existed. The sample lines are what the backend's own format produces.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseBackendLog, readBackendLog } from '../lib/idle-trim.mjs'

const LOG = [
  'NQT-READY {"port": 51234}',
  '2026-10-05 13:32:41,110 INFO nq_terminal.services.prewarm: prewarm started: 3 tasks, 2 later tasks, 0.01 s after the thread began',
  '2026-10-05 13:32:43,500 INFO nq_terminal.services.prewarm: prewarm finished: 3 of 3 tasks ok in 2.39 s',
  '2026-10-05 13:32:50,250 INFO nq_terminal.memtrim: working set trimmed (after the prewarm later) in 41.7 ms; before 812.4 MB, after 301.2 MB',
  '2026-10-05 13:32:50,300 INFO nq_terminal.services.prewarm: prewarm ended: 9.19 s after the thread began',
  '2026-10-05 13:34:10,000 INFO nq_terminal.memtrim: working set trim skipped (quiet period): a request is in flight',
  '2026-10-05 13:35:12,000 INFO nq_terminal.memtrim: working set trimmed (quiet period) in 12.0 ms; before unavailable, after unavailable',
  '2026-10-05 13:35:13,000 WARNING nq_terminal.memtrim: the working set trim did not trim (quiet period)',
  '',
].join('\n')

test('the trims are read with their reason, time, duration and working set before and after', () => {
  const { trims } = parseBackendLog(LOG)
  assert.equal(trims.length, 2)
  assert.deepEqual({ reason: trims[0].reason, ms: trims[0].ms, beforeMB: trims[0].beforeMB, afterMB: trims[0].afterMB }, { reason: 'after the prewarm later', ms: 41.7, beforeMB: 812.4, afterMB: 301.2 })
  assert.equal(trims[0].at, '2026-10-05 13:32:50,250')
  assert.equal(trims[1].reason, 'quiet period')
  assert.equal(trims[1].beforeMB, null)
  assert.equal(trims[1].afterMB, null)
  assert.ok(trims[1].atMs - trims[0].atMs === (2 * 60 + 21) * 1000 + 750, 'the times are epoch milliseconds of the same clock')
})

test('the prewarm start and end are read, and a skipped trim or a warning is not a trim', () => {
  const log = parseBackendLog(LOG)
  assert.equal(log.prewarmStarted, '2026-10-05 13:32:41,110')
  assert.equal(log.prewarmEnded, '2026-10-05 13:32:50,300')
  assert.equal(log.prewarmSpanMs, 9190)
  assert.equal(log.trims.length, 2)
})

test('a log with no such lines, an empty log and a missing file give nothing, never an error', () => {
  assert.deepEqual(parseBackendLog('NQT-READY {}\nsome line\n'), { trims: [], prewarmStarted: null, prewarmEnded: null, prewarmSpanMs: null })
  assert.deepEqual(parseBackendLog(''), { trims: [], prewarmStarted: null, prewarmEnded: null, prewarmSpanMs: null })
  assert.equal(readBackendLog(path.join(os.tmpdir(), 'nqt-no-such-dir', 'backend.log')), null)
})

test('readBackendLog reads a file from disk, CRLF line endings included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-backend-log-'))
  try {
    const file = path.join(dir, 'backend.log')
    fs.writeFileSync(file, LOG.replaceAll('\n', '\r\n'))
    const log = readBackendLog(file)
    assert.equal(log.trims.length, 2)
    assert.equal(log.prewarmEnded, '2026-10-05 13:32:50,300')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
