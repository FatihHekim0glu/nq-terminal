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
const STALE_BY_AGE = (pid) => new RegExp(String.raw`stale lock PYTEST\.${pid}\.lock.*older than 2 h`, 'i')
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

test('a lock older than two hours is stale for its age: the wait ignores it and the reason says so', () => {
  // A live pid, so that only the age rule can make this lock stale (a pid that is not running would do it on its own).
  const dir = locksFolder('stale')
  plant(dir, process.pid, 2 * HOUR_MS + 60_000)
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, STALE_BY_AGE(process.pid))
  assert.doesNotMatch(r.stdout, /not running/)
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

// ---- 0.3.1 audit: a locks folder that cannot be read warned only on the Node side; check.ps1 passed it over silently

test('born failing: a locks folder that cannot be read is a NOTE, as in the harness, and the step goes on without waiting', () => {
  const dir = locksFolder('unreadable')
  const notAFolder = path.join(dir, 'file.txt') // a file where the folder should be: listing it fails
  fs.writeFileSync(notAFolder, 'x')
  const r = run(notAFolder, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /NOTE +pytest-lock +cannot read the locks folder .*file\.txt/)
  assert.match(r.stdout, /does not wait/)
  assert.doesNotMatch(r.stdout, /WAIT /)
  assert.match(r.stdout, /PASS .*pytest-wait.*locks folder unreadable, not waited/i, 'the run summary records it')
})

test('a locks folder that is missing stays silent, as in the harness (nothing holds a lock there)', () => {
  const dir = locksFolder('missing')
  const r = run(path.join(dir, 'no-such-folder'), ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /NOTE|WAIT|pytest-wait/)
})

test('an unreadable locks folder warns and does not abort, in both implementations, because pytest also skips a lock it cannot write', () => {
  const harness = fs.readFileSync(fileURLToPath(new URL('../lib/pytestlock.mjs', import.meta.url)), 'utf8')
  for (const [name, text] of [['check.ps1', CHECK_TEXT], ['pytestlock.mjs', harness]]) {
    assert.match(text, /warns and does not abort/, `${name} says why an unreadable folder is only a warning`)
  }
})

// ---- 0.3.1 audit: the stale-by-age test used a pid that is not running, so it proved nothing about the age rule

test('a dead pid with a lock over two hours old is stale for its age first (the age check runs before the pid check)', () => {
  const dir = locksFolder('age-dead')
  const pid = deadPid()
  plant(dir, pid, 2 * HOUR_MS + 60_000)
  const r = run(dir, ['-PytestWaitTimeoutSeconds', '5'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, new RegExp(`stale lock PYTEST\\.${pid}\\.lock.*older than 2 h`, 'i'))
})
