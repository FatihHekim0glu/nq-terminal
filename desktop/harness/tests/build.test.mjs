import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { identifyBytes, resolveBuild, candidateExes } from '../lib/build.mjs'

const exe = (...strings) => Buffer.from(`MZ\0\0${strings.join('\0')}\0\0`, 'latin1')

test('the smoke exe is the one that carries the attach switch, the measure exe the measure folder name', () => {
  assert.equal(identifyBytes(exe('nq-lab-terminal', '--attach-url', '--fixture')), 'smoke')
  assert.equal(identifyBytes(exe('nq-lab-terminal', 'NQT_MEASURE_DIR')), 'measure')
  assert.equal(identifyBytes(exe('nq-lab-terminal', 'dev.nqlab.terminal')), 'release')
  assert.equal(identifyBytes(exe('--attach-url', 'NQT_MEASURE_DIR')), 'mixed')
  assert.equal(identifyBytes(exe('something else')), 'unknown')
})

test('a launch refuses an exe of the wrong build (born failing)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-build-'))
  try {
    const m = path.join(dir, 'measure.exe')
    fs.writeFileSync(m, exe('nq-lab-terminal', 'NQT_MEASURE_DIR'))
    assert.throws(() => resolveBuild('smoke', m), /measure build, not smoke/)
    assert.equal(resolveBuild('measure', m), m)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the newest exe of the asked kind is found under a targets folder; none is an error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h-targets-'))
  try {
    const put = (name, bytes, mtime) => { const d = path.join(root, name, 'release'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'nq-lab-terminal.exe'); fs.writeFileSync(f, bytes); fs.utimesSync(f, mtime, mtime); return f }
    const old = put('a', exe('--attach-url'), new Date(2026, 0, 1))
    const fresh = put('b', exe('--attach-url'), new Date(2026, 5, 1))
    put('c', exe('NQT_MEASURE_DIR'), new Date(2026, 8, 1))
    assert.equal(resolveBuild('smoke', null, root), fresh)
    assert.deepEqual(candidateExes(root).length, 3)
    assert.notEqual(old, fresh)
    assert.throws(() => resolveBuild('smoke', null, path.join(root, 'nothing')), /no smoke exe/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
