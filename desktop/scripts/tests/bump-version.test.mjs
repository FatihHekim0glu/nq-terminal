// Tests for desktop/scripts/bump-version.ps1 (AUD-2): one command moves every place the build's version lives, and
// the places agree afterwards. Every run is on a copy of the managed files under D:/dev/tmp, never on the real tree
// (the real tree is only read, with -List and -DryRun).
//
//   node --test desktop/scripts/tests/bump-version.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../bump-version.ps1', import.meta.url))
const TERMINAL = path.resolve(path.dirname(SCRIPT), '..', '..')
const SCRATCH = process.env.NQT_TEST_TMP || 'D:/dev/tmp/bump-version-tests'
const NEW = '9.8.7'
const created = []

function powershell(args) {
  const out = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], { encoding: 'utf8', windowsHide: true })
  return { status: out.status, text: out.stdout + out.stderr }
}

function listManaged(root) {
  const result = powershell(['-List', '-Root', root])
  assert.equal(result.status, 0, result.text)
  return result.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function copyTree(name) {
  const dir = path.join(SCRATCH, `${name}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  created.push(dir)
  for (const rel of listManaged(TERMINAL)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.copyFileSync(path.join(TERMINAL, rel), path.join(dir, rel))
  }
  return dir
}

after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }) })

const read = (root, rel) => fs.readFileSync(path.join(root, rel))
const snapshot = (root) => Object.fromEntries(listManaged(root).map((rel) => [rel, read(root, rel).toString('latin1')]))
const lines = (text) => text.split('\n')
const changedLines = (before, after) => {
  const a = lines(before)
  const b = lines(after)
  assert.equal(a.length, b.length, 'a bump never adds or removes a line')
  return a.map((line, i) => (line === b[i] ? null : [line, b[i]])).filter(Boolean)
}

function versionsIn(root) {
  const json = (rel) => JSON.parse(read(root, rel).toString('utf8')).version
  const toml = read(root, 'desktop/src-tauri/Cargo.toml').toString('utf8').match(/^\[package\][^[]*?^version = "([^"]+)"/ms)[1]
  const lock = read(root, 'desktop/src-tauri/Cargo.lock').toString('utf8').match(/^name = "nq-lab-terminal"\r?\nversion = "([^"]+)"/m)[1]
  const py = read(root, 'backend/nq_terminal/__init__.py').toString('utf8').match(/^__version__ = "([^"]+)"/m)[1]
  return {
    'tauri.conf.json': json('desktop/src-tauri/tauri.conf.json'),
    'tauri.measure.conf.json': json('desktop/src-tauri/tauri.measure.conf.json'),
    'tauri.smoke.conf.json': json('desktop/src-tauri/tauri.smoke.conf.json'),
    'Cargo.toml': toml,
    'Cargo.lock': lock,
    __init__: py,
    'openapi.json': JSON.parse(read(root, 'contract/openapi.json').toString('utf8')).info.version,
  }
}

test('the managed list names every place of the version', () => {
  const managed = listManaged(TERMINAL)
  for (const rel of [
    'desktop/src-tauri/tauri.conf.json',
    'desktop/src-tauri/tauri.measure.conf.json',
    'desktop/src-tauri/tauri.smoke.conf.json',
    'desktop/src-tauri/Cargo.toml',
    'desktop/src-tauri/Cargo.lock',
    'backend/nq_terminal/__init__.py',
    'contract/openapi.json',
    'desktop/scripts/build-release.ps1',
    'desktop/scripts/install-test.ps1',
    'scripts/release_check.ps1',
    'web/src/api/openapi.sha256',
    'web/src/api/schema.d.ts',
  ]) assert.ok(managed.includes(rel), `${rel} is managed`)
})

test('a dry run on the real tree finds every place in agreement and writes nothing', () => {
  const before = snapshot(TERMINAL)
  const result = powershell(['-Version', NEW, '-DryRun', '-Root', TERMINAL])
  assert.equal(result.status, 0, result.text)
  assert.match(result.text, /dry run, \d+\.\d+\.\d+ -> 9\.8\.7, nothing written/)
  assert.deepEqual(snapshot(TERMINAL), before)
})

test('a run on a copy leaves every place at the new version', () => {
  const root = copyTree('agree')
  const before = snapshot(root)
  const result = powershell(['-Version', NEW, '-Root', root])
  assert.equal(result.status, 0, result.text)
  const versions = versionsIn(root)
  assert.deepEqual(Object.values(versions), Object.values(versions).map(() => NEW), JSON.stringify(versions))
  for (const rel of ['desktop/scripts/build-release.ps1', 'desktop/scripts/install-test.ps1', 'scripts/release_check.ps1']) {
    const head = read(root, rel).toString('utf8').split(/^(?:\[CmdletBinding|param\()/m)[0]
    assert.ok(head.includes(NEW), `${rel} header names ${NEW}`)
    assert.ok(!/\b0\.1\.\d\b/.test(head), `${rel} header names no older version`)
  }
  // Only version text moved: the same number of lines, and each changed line differs from before by the version alone.
  const after = snapshot(root)
  for (const [rel, text] of Object.entries(after)) {
    if (rel.endsWith('openapi.sha256') || rel.endsWith('schema.d.ts')) continue
    for (const [was, now] of changedLines(before[rel], text)) {
      const masked = (line) => line.replace(/\d+\.\d+\.\d+/g, 'V')
      assert.equal(masked(now), masked(was), `${rel}: ${was} -> ${now}`)
      assert.ok(now.includes(NEW), `${rel}: ${now}`)
    }
  }
  assert.equal(changedLines(before['desktop/src-tauri/Cargo.lock'], after['desktop/src-tauri/Cargo.lock']).length, 1, 'one Cargo.lock line')
})

test('the derived api files carry the hash gen-api.mjs would write for the new contract', () => {
  const root = copyTree('hash')
  assert.equal(powershell(['-Version', NEW, '-Root', root]).status, 0)
  const contract = read(root, 'contract/openapi.json').toString('utf8').replace(/\r\n/g, '\n')
  const want = crypto.createHash('sha256').update(contract, 'utf8').digest('hex')
  assert.equal(read(root, 'web/src/api/openapi.sha256').toString('utf8'), `${want}\n`)
  assert.equal(read(root, 'web/src/api/schema.d.ts').toString('utf8').split('\n')[0], `// contract sha256: ${want}`)
})

test('bumping and bumping back restores every byte', () => {
  const root = copyTree('roundtrip')
  const before = snapshot(root)
  const old = versionsIn(root)['tauri.conf.json']
  assert.equal(powershell(['-Version', NEW, '-Root', root]).status, 0)
  assert.notDeepEqual(snapshot(root), before)
  assert.equal(powershell(['-Version', old, '-Root', root]).status, 0)
  assert.deepEqual(snapshot(root), before)
})

test('bumping to the version already in place changes nothing', () => {
  const root = copyTree('same')
  const before = snapshot(root)
  const result = powershell(['-Version', versionsIn(root)['tauri.conf.json'], '-Root', root])
  assert.equal(result.status, 0, result.text)
  assert.match(result.text, /nothing to do/)
  assert.deepEqual(snapshot(root), before)
})

test('a place that disagrees stops the run and nothing is written', () => {
  const root = copyTree('disagree')
  const toml = path.join(root, 'desktop/src-tauri/Cargo.toml')
  fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8').replace(/^version = "[^"]+"/m, 'version = "0.0.9"'))
  const before = snapshot(root)
  const result = powershell(['-Version', NEW, '-Root', root])
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /Cargo\.toml: says 0\.0\.9/)
  assert.deepEqual(snapshot(root), before)
})

test('a stale script comment and a missing file also stop the run', () => {
  const stale = copyTree('stale')
  const script = path.join(stale, 'desktop/scripts/install-test.ps1')
  fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace(/release\\\d+\.\d+\.\d+/, 'release\\0.0.9'))
  const staleResult = powershell(['-Version', NEW, '-Root', stale])
  assert.notEqual(staleResult.status, 0, staleResult.text)
  assert.match(staleResult.text, /install-test\.ps1: says 0\.0\.9/)

  const missing = copyTree('missing')
  fs.rmSync(path.join(missing, 'backend/nq_terminal/__init__.py'))
  const missingResult = powershell(['-Version', NEW, '-Root', missing])
  assert.notEqual(missingResult.status, 0, missingResult.text)
  assert.match(missingResult.text, /__init__\.py: the file is missing/)
})

test('CRLF files keep their line endings and a version that is not X.Y.Z is refused', () => {
  const root = copyTree('crlf')
  const toml = path.join(root, 'desktop/src-tauri/Cargo.toml')
  fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8').replace(/\r?\n/g, '\r\n'))
  assert.equal(powershell(['-Version', NEW, '-Root', root]).status, 0)
  const text = fs.readFileSync(toml, 'utf8')
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'still CRLF only')
  assert.equal(versionsIn(root)['Cargo.toml'], NEW)
  assert.notEqual(powershell(['-Version', '1.2', '-Root', root]).status, 0)
  assert.notEqual(powershell(['-Version', 'v1.2.3', '-Root', root]).status, 0)
})
