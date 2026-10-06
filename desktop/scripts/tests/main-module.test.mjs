// Born-failing tests of the main-module guard (main-module.mjs). The release gate scripts and the harness entry points
// run their main() only when Node started them as the main module. Node gives import.meta.url as the real path (a
// junction such as C:\Users\...\nq-lab -> E:\projects\nq-lab is resolved) while process.argv[1] keeps the path the
// caller typed, and PowerShell's $PSScriptRoot yields the junction path. A plain string comparison therefore never
// matched through the junction: the artefact check, the path scan, dist-scan and pe-info printed nothing and exited 0.
// These tests run every guarded script through a junction to the desktop folder and require it to do its work.
//
//   node --test desktop/scripts/tests/main-module.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { isMainModule } from '../main-module.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = fs.realpathSync(path.join(HERE, '..', '..'))
const SCRATCH = path.join(process.env.NQT_TEST_TMP || 'D:/dev/tmp/main-module-tests', `run-${process.pid}`)
fs.mkdirSync(SCRATCH, { recursive: true })
const LINK = path.join(SCRATCH, 'desktop-link')
fs.symlinkSync(DESKTOP, LINK, 'junction')
after(() => {
  fs.unlinkSync(LINK)
  fs.rmSync(SCRATCH, { recursive: true, force: true })
})

const viaLink = (...parts) => path.join(LINK, ...parts)
const runVia = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: SCRATCH, timeout: 60_000, windowsHide: true })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

test('the junction really points at the desktop folder under another path', () => {
  assert.notEqual(path.resolve(viaLink('scripts', 'artefact-check.mjs')).toLowerCase(), path.join(DESKTOP, 'scripts', 'artefact-check.mjs').toLowerCase())
  assert.equal(fs.realpathSync(viaLink('scripts')).toLowerCase(), path.join(DESKTOP, 'scripts').toLowerCase())
})

test('artefact-check --paths through the junction finds a planted build-machine path (exit 1, finding printed)', () => {
  const planted = path.join(SCRATCH, 'planted.bin')
  fs.writeFileSync(planted, Buffer.from('\0\0panic at D:\\dev\\cargo\\registry\\src\\index\\x\\lib.rs\0', 'latin1'))
  const r = runVia(viaLink('scripts', 'artefact-check.mjs'), ['--paths', planted])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /build-machine path scan FAILED/)
  assert.match(r.out, /planted\.bin/)
})

test('artefact-check --paths through the junction refuses a missing argument (exit 2)', () => {
  const r = runVia(viaLink('scripts', 'artefact-check.mjs'), ['--paths', path.join(SCRATCH, 'no-such-file')])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /usage/)
})

test('artefact-check on a release folder through the junction runs the full check (exit 1 on an empty folder)', () => {
  const empty = path.join(SCRATCH, 'empty-release')
  fs.mkdirSync(empty, { recursive: true })
  const r = runVia(viaLink('scripts', 'artefact-check.mjs'), [empty])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /artefact check FAILED/)
})

test('dist-scan, pe-info and advisories through the junction run their main (exit 2 on a bad argument, with a message)', () => {
  for (const [script, args, pattern] of [
    ['dist-scan.mjs', ['--no-such-flag'], /dist-scan: unknown or incomplete argument/],
    ['pe-info.mjs', [], /usage: node pe-info\.mjs/],
    ['advisories.mjs', ['--no-such-flag'], /advisories: unknown or incomplete argument/],
  ]) {
    const r = runVia(viaLink('scripts', script), args)
    assert.equal(r.code, 2, `${script}: ${r.out}`)
    assert.match(r.out, pattern, script)
  }
})

test('dist-scan through the junction scans a planted private key (exit 1)', () => {
  const dist = path.join(SCRATCH, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(path.join(dist, 'leak.txt'), '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n')
  const r = runVia(viaLink('scripts', 'dist-scan.mjs'), ['--dist', dist])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /FOUND/)
})

test('copy-tokens --check through the junction prints its verdict', () => {
  const r = runVia(viaLink('scripts', 'copy-tokens.mjs'), ['--check'])
  assert.ok(r.out.trim().length > 0, 'copy-tokens printed nothing through the junction')
})

test('the harness run.mjs and report.mjs through the junction run their main (usage, exit 2)', () => {
  const run = runVia(viaLink('harness', 'run.mjs'), [])
  assert.equal(run.code, 2, run.out)
  assert.match(run.out, /usage: node run\.mjs/)
  const report = runVia(viaLink('harness', 'report.mjs'), [])
  assert.equal(report.code, 2, report.out)
  assert.match(report.out, /usage: node report\.mjs/)
})

test('isMainModule: the junction path and the real path both match; another file, no argv and a near name do not', () => {
  const real = path.join(DESKTOP, 'scripts', 'artefact-check.mjs')
  const url = pathToFileURL(real).href
  const quiet = () => {}
  assert.equal(isMainModule(url, { argv1: real, onMismatch: quiet }), true)
  assert.equal(isMainModule(url, { argv1: viaLink('scripts', 'artefact-check.mjs'), onMismatch: quiet }), true)
  assert.equal(isMainModule(url, { argv1: real.toUpperCase(), onMismatch: quiet }), true)
  assert.equal(isMainModule(url, { argv1: path.join(DESKTOP, 'scripts', 'pe-info.mjs'), onMismatch: quiet }), false)
  assert.equal(isMainModule(url, { argv1: undefined, onMismatch: quiet }), false)
})

test('isMainModule reports, and sets exit code 2, when a file of the same name was started but not recognised', () => {
  const real = path.join(DESKTOP, 'scripts', 'artefact-check.mjs')
  const elsewhere = path.join(SCRATCH, 'artefact-check.mjs')
  fs.writeFileSync(elsewhere, '// a different file with the same name\n')
  const seen = []
  assert.equal(isMainModule(pathToFileURL(real).href, { argv1: elsewhere, onMismatch: (line) => seen.push(line) }), false)
  assert.equal(seen.length, 1)
  assert.match(seen[0], /artefact-check\.mjs: started as .* but not recognised as the main module; nothing ran/)
  const before = process.exitCode
  isMainModule(pathToFileURL(real).href, { argv1: elsewhere })
  assert.equal(process.exitCode, 2)
  process.exitCode = before
})

test('every guarded entry point uses isMainModule and none keeps the plain string comparison', () => {
  for (const file of ['scripts/artefact-check.mjs', 'scripts/advisories.mjs', 'scripts/dist-scan.mjs', 'scripts/pe-info.mjs', 'scripts/copy-tokens.mjs', 'harness/run.mjs', 'harness/report.mjs']) {
    const text = fs.readFileSync(path.join(DESKTOP, file), 'utf8')
    assert.ok(/if \(isMainModule\(import\.meta\.url\)\)/.test(text), `${file} does not guard its main with isMainModule`)
    assert.ok(!/=== process\.argv\[1\]|process\.argv\[1\]\) === fileURLToPath/.test(text), `${file} keeps the plain path comparison`)
  }
})
