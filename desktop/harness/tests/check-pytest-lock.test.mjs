// check.ps1 waits while a backend pytest session holds a PYTEST lock before it starts a real-backend smoke step, so a
// real-data run and a test session never overlap (0.3.1, test-infra). Born failing: check.ps1 had no such wait.
// The real script is run with -PytestWaitOnly against a scratch locks folder under D:\dev\tmp; nothing builds, nothing
// opens a window, and the real D:\dev\locks is never read or written.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CHECK = fileURLToPath(new URL('../../scripts/check.ps1', import.meta.url))
const CHECK_TEXT = fs.readFileSync(CHECK, 'utf8')
const ROOT = 'D:\\dev\\tmp\\check-pytest-lock-tests'
const HOUR_MS = 3600 * 1000
const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CHECK]

function locksFolder(name) {
  const dir = path.join(ROOT, `${name}-${process.pid}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function plant(dir, pid, ageMs = 0) {
  const file = path.join(dir, `PYTEST.${pid}.lock`)
  fs.writeFileSync(file, JSON.stringify({ pid, started: new Date().toISOString(), argv: [] }))
  const t = new Date(Date.now() - ageMs)
  fs.utimesSync(file, t, t)
  return file
}
const waitOnly = (dir, extra = []) => ['-PytestWaitOnly', '-PytestLockDir', dir, '-PytestWaitPollSeconds', '1', ...extra]
const run = (dir, extra) => spawnSync('powershell', [...PS, ...waitOnly(dir, extra)], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })

test('with no PYTEST lock the wait returns at once and prints nothing about waiting', () => {
  const dir = locksFolder('none')
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /WAIT/)
})

// A pid that is certainly dead: a child that has already exited (its pid is not reused within the test).
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true })
  return child.pid
}

test('a fresh PYTEST lock holds the wait, names the lock and the poll, and a timeout exits 4', () => {
  const dir = locksFolder('held')
  plant(dir, process.pid) // the pid of a live process: this test run
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '3'])
  assert.equal(r.status, 4, r.stdout + r.stderr)
  assert.match(r.stdout, new RegExp(`WAIT .*PYTEST\\.${process.pid}\\.lock`))
  assert.match(r.stdout, /next look in 1 s/)
  assert.match(r.stdout, /FAIL .*pytest-wait.*still held/i)
})

test('a lock older than two hours is stale: the wait ignores it and says so', () => {
  const dir = locksFolder('stale')
  plant(dir, 4243, 2 * HOUR_MS + 60_000)
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /stale/i)
  assert.doesNotMatch(r.stdout, /WAIT /)
})

test('a fresh lock that names a dead process is stale: the wait ignores it at once and says so (0.3.1)', () => {
  // A session ended by taskkill /F or a job-object kill leaves its lock behind with a recent timestamp.
  const dir = locksFolder('dead')
  const pid = deadPid()
  plant(dir, pid)
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, new RegExp(`stale lock PYTEST\\.${pid}\\.lock.*not running`, 'i'))
  assert.doesNotMatch(r.stdout, /WAIT /)
})

test('a lock older than two hours is stale even when its pid is alive (pid reuse), and the live-pid lock stays held', () => {
  const dir = locksFolder('reused')
  plant(dir, process.pid, 2 * HOUR_MS + 60_000)
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /WAIT /)
})

test('the wait ends when the lock is removed, and the wait is reported with its length', async () => {
  const dir = locksFolder('released')
  const lock = plant(dir, process.pid)
  const child = spawn('powershell', [...PS, ...waitOnly(dir, ['-PytestWaitTimeoutSeconds', '60'])], { windowsHide: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const first = Date.now()
  while (!/WAIT /.test(out) && Date.now() - first < 60_000) await new Promise((r) => setTimeout(r, 200))
  assert.match(out, new RegExp(`WAIT .*PYTEST\\.${process.pid}\\.lock`), 'the script is waiting on the planted lock')
  fs.rmSync(lock)
  const code = await new Promise((resolve) => child.once('exit', resolve))
  assert.equal(code, 0, out)
  assert.match(out, /PASS .*pytest-wait.*waited \d+ s/i)
})

test('every step that starts a backend or the smoke exe waits for the lock first, and the default folder is the locks folder', () => {
  assert.match(CHECK_TEXT, /\[string\]\$PytestLockDir = .*'D:\\dev\\locks'/, 'the default folder is the locks folder')
  for (const step of ["'test-smoke'", "'test-measure'", "'parity'"]) {
    const at = CHECK_TEXT.indexOf(step)
    assert.ok(at > 0, `${step} is a step of check.ps1`)
  }
  for (const guarded of ['test-smoke', 'test-measure', 'parity', 'show-proof']) {
    assert.match(CHECK_TEXT, new RegExp(`Wait-NoPytestLock '${guarded}[^']*'`), `${guarded} waits for the PYTEST lock`)
  }
})
