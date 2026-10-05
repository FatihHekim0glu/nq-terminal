// AUD-3: check.ps1 fails fast, with a clear message and exit code 3, on a stale or missing web/dist (the misleading failure was
// "HOME never became ready") and on a concurrent build (a lock in the target folder). Born failing: the preflight did not exist.
// The real script is run with -PreflightOnly against throw-away trees under D:\dev\tmp; nothing builds and nothing opens a window.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CHECK = fileURLToPath(new URL('../../scripts/check.ps1', import.meta.url))
const ROOT = 'D:\\dev\\tmp\\check-preflight-tests'
const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CHECK]
const SECOND = 1000

function tree(name, { distAgeS = 600, srcAgeS = 3600, extraSrc = [] } = {}) {
  const dir = path.join(ROOT, `${name}-${process.pid}-${Date.now()}`)
  const web = path.join(dir, 'web')
  fs.mkdirSync(path.join(web, 'src'), { recursive: true })
  fs.mkdirSync(path.join(web, 'dist'), { recursive: true })
  const at = (file, ageS) => { fs.writeFileSync(file, 'x'); const t = new Date(Date.now() - ageS * SECOND); fs.utimesSync(file, t, t) }
  at(path.join(web, 'src', 'App.tsx'), srcAgeS)
  at(path.join(web, 'dist', 'index.html'), distAgeS)
  for (const [rel, ageS] of extraSrc) at(path.join(web, 'src', rel), ageS)
  return { dir, web, target: path.join(dir, 'target'), logs: path.join(dir, 'logs') }
}

const preflight = (t, extra = []) => spawnSync('powershell', [...PS, '-PreflightOnly', '-WebDir', t.web, '-TargetDir', t.target, '-LogRoot', t.logs, ...extra],
  { encoding: 'utf8', windowsHide: true, timeout: 120_000 })

test('a fresh dist passes the preflight and leaves no lock behind', () => {
  const t = tree('fresh')
  const r = preflight(t)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /preflight ok/i)
  assert.equal(fs.existsSync(path.join(t.target, 'check.lock')), false)
})

test('a web/dist older than the newest web/src file fails fast and says how to fix it', () => {
  const t = tree('stale', { distAgeS: 3600, srcAgeS: 60 })
  const r = preflight(t)
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.match(r.stdout, /stale/i)
  assert.match(r.stdout, /App\.tsx/)
  assert.match(r.stdout, /pnpm .*build/)
})

test('a missing web/dist fails fast', () => {
  const t = tree('missing')
  fs.rmSync(path.join(t.web, 'dist'), { recursive: true, force: true })
  const r = preflight(t)
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.match(r.stdout, /missing/i)
})

test('a newer test file does not make the dist stale (tests are not part of the build)', () => {
  const t = tree('testfile', { distAgeS: 3600, srcAgeS: 7200, extraSrc: [['App.test.tsx', 30], ['x.spec.ts', 30]] })
  const r = preflight(t)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('-SkipPreflight bypasses the dist check', () => {
  const t = tree('skip', { distAgeS: 3600, srcAgeS: 60 })
  const r = preflight(t, ['-SkipPreflight'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('a concurrent check.ps1 run on the same target folder fails fast and names the holder', async () => {
  const t = tree('concurrent')
  const first = spawn('powershell', [...PS, '-PreflightOnly', '-PreflightHoldSeconds', '25', '-WebDir', t.web, '-TargetDir', t.target, '-LogRoot', t.logs], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    let out = ''
    first.stdout.on('data', (d) => { out += d })
    const deadline = Date.now() + 60_000
    while (!/holding the lock/i.test(out) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 200))
    assert.match(out, /holding the lock/i, 'the first run took the lock')
    const second = preflight(t)
    assert.equal(second.status, 3, second.stdout + second.stderr)
    assert.match(second.stdout, /another/i)
    assert.match(second.stdout, new RegExp(`pid ${first.pid}|pid \\d+`))
  } finally { first.kill() }
})

test('a lock left behind by a run that died does not block the next one', () => {
  const t = tree('leftover')
  fs.mkdirSync(t.target, { recursive: true })
  fs.writeFileSync(path.join(t.target, 'check.lock'), 'pid 999999 started long ago')
  const r = preflight(t)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('the in-process self-test covers a stale dist, a held cargo lock, a held check lock and a running web build', () => {
  const r = spawnSync('powershell', [...PS, '-PreflightSelfTest'], { encoding: 'utf8', windowsHide: true, timeout: 180_000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const name of ['stale-dist', 'missing-dist', 'fresh-dist', 'test-files-ignored', 'cargo-lock-held', 'check-lock-held', 'web-build-running']) {
    assert.match(r.stdout, new RegExp(`PASS\\s+${name}`), `case ${name}`)
  }
})

test.after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* another run may still hold a file */ } })
