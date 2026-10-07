// The backend log tail: it starts before the log exists, shares delete with the shell's own appends, time-stamps the lines that matter
// and hands them back as one JSON document when its stdin closes. Live test with the lab interpreter, on a log under the OS temp folder.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startTail, parseTail } from '../lib/tailog.mjs'
import { PY } from '../lib/paths.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('parseTail reads the document and refuses anything else', () => {
  assert.deepEqual(parseTail('{"seen":{"ready":[1]}}'), { seen: { ready: [1] } })
  assert.equal(parseTail(''), null)
  assert.equal(parseTail('not json'), null)
})

// One run of the scenario with the log appearing `leadMs` after the tail was spawned. The writer notes its own clock at each append.
async function appearAfterStart(leadMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-tailog-'))
  const log = path.join(dir, 'logs', 'backend.log')
  try {
    const tail = startTail(log, 30)
    await sleep(leadMs)
    fs.mkdirSync(path.dirname(log), { recursive: true })
    const startedAt = Date.now()
    fs.writeFileSync(log, 'INFO: Started server process [1]\n')
    await sleep(150)
    const readyAt = Date.now()
    fs.appendFileSync(log, 'NQT-READY {"port": 1}\n')
    await sleep(150)
    const proofAt = Date.now()
    fs.appendFileSync(log, '127.0.0.1 - "GET /api/desktop/proof?nonce=ab HTTP/1.1" 200\n')
    await sleep(300)
    const doc = await tail.stop()
    return { doc, startedAt, readyAt, proofAt, after: Date.now() }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// A tail that was still starting its interpreter when the first line landed reads every line in one pass and stamps them together,
// which says nothing about the stamps. So the timing is judged only on a run where the tail had opened the log before READY was
// written; a late start is retried with a longer lead (a loaded machine can take over a second to start a Python process).
const ARM_LEADS_MS = [400, 1500, 4000]
const CLOCK_SLACK_MS = 50
const LAG_SLACK_MS = 1000
const GAP_SLACK_MS = 250

test('the tail finds READY and the proof in a log that appears after it started, in order and in epoch ms', { skip: !fs.existsSync(PY) && 'the lab interpreter is not here' }, async () => {
  let run = null
  for (const lead of ARM_LEADS_MS) {
    const attempt = await appearAfterStart(lead)
    assert.ok(attempt.doc, 'the tail printed its document')
    assert.equal(attempt.doc.seen.started.length, 1)
    assert.equal(attempt.doc.seen.ready.length, 1)
    assert.equal(attempt.doc.seen.proof.length, 1)
    run = attempt
    if (attempt.doc.firstOpenMs !== null && attempt.doc.firstOpenMs < attempt.readyAt) break
  }
  assert.ok(run.doc.firstOpenMs < run.readyAt, `the tail was not running before READY even with a ${ARM_LEADS_MS.at(-1)} ms lead (opened ${run.doc.firstOpenMs}, READY written ${run.readyAt})`)
  const [ready] = run.doc.seen.ready
  const [proof] = run.doc.seen.proof
  assert.ok(ready >= run.readyAt - CLOCK_SLACK_MS, `READY stamped ${ready} before it was written ${run.readyAt}`)
  assert.ok(proof >= run.proofAt - CLOCK_SLACK_MS, `proof stamped ${proof} before it was written ${run.proofAt}`)
  assert.ok(proof <= run.after + LAG_SLACK_MS, `proof stamped ${proof} long after the run ended ${run.after}`)
  const writerGap = run.proofAt - run.readyAt
  assert.ok(Math.abs(proof - ready - writerGap) <= GAP_SLACK_MS, `READY to proof ${proof - ready} ms for appends ${writerGap} ms apart`)
})

test('a log that never appears gives an empty document at once when stopped, not a hang', { skip: !fs.existsSync(PY) && 'the lab interpreter is not here' }, async () => {
  const tail = startTail(path.join(os.tmpdir(), 'nqt-no-such-dir', 'backend.log'), 30)
  await sleep(300)
  const doc = await tail.stop()
  assert.deepEqual(doc.seen, {})
  assert.equal(doc.firstOpenMs, null)
})
