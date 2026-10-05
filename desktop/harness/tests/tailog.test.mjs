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

test('the tail finds READY and the proof in a log that appears after it started, in order and in epoch ms', { skip: !fs.existsSync(PY) && 'the lab interpreter is not here' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-tailog-'))
  const log = path.join(dir, 'logs', 'backend.log')
  try {
    const tail = startTail(log, 30)
    await sleep(400)
    fs.mkdirSync(path.dirname(log), { recursive: true })
    const before = Date.now()
    fs.writeFileSync(log, 'INFO: Started server process [1]\n')
    await sleep(150)
    fs.appendFileSync(log, 'NQT-READY {"port": 1}\n')
    await sleep(150)
    fs.appendFileSync(log, '127.0.0.1 - "GET /api/desktop/proof?nonce=ab HTTP/1.1" 200\n')
    await sleep(300)
    const after = Date.now()
    const doc = await tail.stop()
    assert.ok(doc, 'the tail printed its document')
    assert.equal(doc.seen.started.length, 1)
    assert.equal(doc.seen.ready.length, 1)
    assert.equal(doc.seen.proof.length, 1)
    const [ready] = doc.seen.ready
    const [proof] = doc.seen.proof
    assert.ok(ready >= before && proof <= after + 50, `${before} ${ready} ${proof} ${after}`)
    assert.ok(proof - ready > 100 && proof - ready < 400, `READY to proof ${proof - ready} ms for appends 150 ms apart`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a log that never appears gives an empty document at once when stopped, not a hang', { skip: !fs.existsSync(PY) && 'the lab interpreter is not here' }, async () => {
  const tail = startTail(path.join(os.tmpdir(), 'nqt-no-such-dir', 'backend.log'), 30)
  await sleep(300)
  const doc = await tail.stop()
  assert.deepEqual(doc.seen, {})
  assert.equal(doc.firstOpenMs, null)
})
