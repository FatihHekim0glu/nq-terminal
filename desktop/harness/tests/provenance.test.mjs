import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { untrackedDigest, sameStamp, provenance } from '../lib/provenance.mjs'
import { TERMINAL } from '../lib/paths.mjs'

test('the untracked digest changes with a name or with contents, and not with the listing order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-prov-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two')
    const base = untrackedDigest(dir, ['a.txt', 'b.txt'])
    assert.equal(untrackedDigest(dir, ['b.txt', 'a.txt']), base)
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two!')
    assert.notEqual(untrackedDigest(dir, ['a.txt', 'b.txt']), base)
    assert.notEqual(untrackedDigest(dir, ['a.txt']), base)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('stamps are the same only when head, diff and untracked digests all match', () => {
  const s = { head: 'h', diffSha256: 'd', untrackedSha256: 'u' }
  assert.equal(sameStamp(s, { ...s }), true)
  assert.equal(sameStamp(s, { ...s, diffSha256: 'x' }), false)
  assert.equal(sameStamp(s, { ...s, untrackedSha256: 'x' }), false)
  assert.equal(sameStamp(s, { ...s, error: 'git' }), false)
  assert.equal(sameStamp(s, null), false)
})

test('the stamp of this tree is readable and carries head and both digests', () => {
  const p = provenance(TERMINAL)
  assert.equal(p.error, undefined, p.error)
  assert.match(p.head, /^[0-9a-f]{40}$/)
  assert.match(p.diffSha256, /^[0-9a-f]{64}$/)
  assert.match(p.untrackedSha256, /^[0-9a-f]{64}$/)
})
