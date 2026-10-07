// Born-failing checks for the harness's wait on a live backend pytest session (0.3.1 part 2). A real-data run and a backend
// test session must never overlap, so run.mjs waits while D:\dev\locks\PYTEST.<pid>.lock names a live process, with the rule
// of check.ps1: a lock is stale at once when its pid is not running, and after two hours whatever its pid (pid reuse).
// Every test plants its locks in a scratch folder under D:\dev\tmp; the real locks folder is never read or written.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pytestLocks, waitNoPytestLock, pidAlive, usesRealData, lockDirFromEnv, DEFAULT_LOCK_DIR, PYTEST_LOCK_STALE_MS } from '../lib/pytestlock.mjs'

const RUN = fileURLToPath(new URL('../run.mjs', import.meta.url))
const CHECK_PS1 = fileURLToPath(new URL('../../scripts/check.ps1', import.meta.url))
const ROOT = 'D:/dev/tmp/harness-pytest-wait-tests'
const HOUR_MS = 3600 * 1000

const made = []
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }) })
function scratch(name) {
  const dir = path.join(ROOT, `${name}-${process.pid}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  made.push(dir)
  return dir
}
function plant(dir, pid, ageMs = 0) {
  const file = path.join(dir, `PYTEST.${pid}.lock`)
  fs.writeFileSync(file, JSON.stringify({ pid, started: new Date().toISOString(), argv: [] }))
  const t = new Date(Date.now() - ageMs)
  fs.utimesSync(file, t, t)
  return file
}
// A pid that is certainly dead: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid
const silent = { log: () => {}, sleep: async () => {} }

test('the stale window is two hours, as in check.ps1', () => {
  assert.equal(PYTEST_LOCK_STALE_MS, 2 * HOUR_MS)
})

test('pidAlive: this process is alive and a process that has exited is not', () => {
  assert.equal(pidAlive(process.pid), true)
  assert.equal(pidAlive(deadPid()), false)
})

test('a lock of a live pid is fresh; a lock of a dead pid is stale at once; a lock over two hours old is stale though its pid lives', () => {
  const dir = scratch('classify')
  const dead = deadPid()
  plant(dir, process.pid)
  plant(dir, dead)
  const old = plant(dir, 1, 2 * HOUR_MS + 60_000) // pid 1 is never a live PYTEST session; age alone decides
  fs.writeFileSync(path.join(dir, 'PYTEST.notes.txt'), 'not a lock')
  fs.writeFileSync(path.join(dir, 'QUIET_MEASURE'), 'another lock')
  const { fresh, stale } = pytestLocks(dir)
  assert.deepEqual(fresh.map((l) => l.name), [`PYTEST.${process.pid}.lock`])
  const why = Object.fromEntries(stale.map((l) => [l.name, l.why]))
  assert.match(why[`PYTEST.${dead}.lock`], /not running/)
  assert.match(why[path.basename(old)], /older than 2 h/)
  const livePid = pytestLocks(dir, { now: Date.now() + 3 * HOUR_MS }).stale.map((l) => l.name)
  assert.ok(livePid.includes(`PYTEST.${process.pid}.lock`), 'three hours on, even a live pid is stale (pid reuse)')
})

test('a missing locks folder holds nothing', () => {
  assert.deepEqual(pytestLocks(path.join(ROOT, 'does-not-exist')), { fresh: [], stale: [] })
})

test('with no lock the wait returns at once and reports no wait', async () => {
  const dir = scratch('none')
  const lines = []
  const r = await waitNoPytestLock({ dir, step: 'real-data', log: (l) => lines.push(l), sleep: async () => { throw new Error('must not sleep') } })
  assert.equal(r.waited, false)
  assert.deepEqual(lines, [])
})

test('a dead pid lock is ignored at once, and the harness says so', async () => {
  const dir = scratch('dead')
  const dead = deadPid()
  plant(dir, dead)
  const lines = []
  const r = await waitNoPytestLock({ dir, step: 'real-data', log: (l) => lines.push(l), sleep: async () => { throw new Error('must not sleep') } })
  assert.equal(r.waited, false)
  assert.equal(r.ignored.length, 1)
  assert.match(lines.join('\n'), new RegExp(`ignoring stale lock PYTEST\\.${dead}\\.lock.*not running`, 'i'))
})

test('a live lock holds the wait, names the lock and the poll, and the wait ends when the lock is removed', async () => {
  const dir = scratch('live')
  const lock = plant(dir, process.pid)
  const lines = []
  let polls = 0
  const sleep = async () => { polls += 1; if (polls === 2) fs.rmSync(lock) }
  const r = await waitNoPytestLock({ dir, step: 'first-launch', pollMs: 5, timeoutMs: 60_000, log: (l) => lines.push(l), sleep })
  assert.equal(r.waited, true)
  assert.equal(polls, 2)
  assert.deepEqual(r.names, [`PYTEST.${process.pid}.lock`])
  assert.match(lines.join('\n'), new RegExp(`WAIT .*first-launch.*PYTEST\\.${process.pid}\\.lock`))
  assert.match(lines.join('\n'), /next look in/)
  assert.match(lines[lines.length - 1], /waited \d+ s for PYTEST\./i, 'the wait is reported with its length')
})

test('a lock that is never released fails the wait with the lock named, after the timeout', async () => {
  const dir = scratch('timeout')
  plant(dir, process.pid)
  await assert.rejects(
    waitNoPytestLock({ dir, step: 'real-data', pollMs: 1, timeoutMs: 30, log: () => {} }),
    new RegExp(`PYTEST lock still held after .*PYTEST\\.${process.pid}\\.lock`),
  )
})

test('only real-data runs wait: the flag, or a first launch that is not dry', () => {
  const args = (...flags) => ({ flag: (n) => flags.includes(n) })
  assert.equal(usesRealData(args('real-data')), true)
  assert.equal(usesRealData(args('first-launch')), true)
  assert.equal(usesRealData(args('first-launch', 'dry')), false)
  assert.equal(usesRealData(args()), false)
})

test('the locks folder is NQT_LOCK_DIR when set, else D:/dev/locks (the folder check.ps1 reads)', () => {
  assert.equal(lockDirFromEnv({ NQT_LOCK_DIR: 'X:/locks' }), 'X:/locks')
  assert.equal(lockDirFromEnv({}), 'D:/dev/locks')
  assert.equal(DEFAULT_LOCK_DIR, 'D:/dev/locks')
})

test('the default locks folder is an absolute path and is the folder check.ps1 defaults to', () => {
  assert.equal(path.win32.isAbsolute(DEFAULT_LOCK_DIR), true, `not absolute: ${DEFAULT_LOCK_DIR}`)
  const check = fs.readFileSync(CHECK_PS1, 'utf8')
  const m = check.match(/\$PytestLockDir\s*=.*?else\s*\{\s*'([^']+)'\s*\}/)
  assert.ok(m, 'check.ps1 names its default PYTEST lock folder')
  const norm = (p) => path.win32.normalize(p).toLowerCase()
  assert.equal(norm(DEFAULT_LOCK_DIR), norm(m[1]))
})

test('a locks folder that cannot be read (anything but missing) is reported with a NOTE instead of passing silently', async () => {
  const dir = scratch('unreadable')
  const notAFolder = path.join(dir, 'file.txt')
  fs.writeFileSync(notAFolder, 'x')
  const lines = []
  const r = await waitNoPytestLock({ dir: notAFolder, step: 'real-data', log: (l) => lines.push(l), sleep: async () => { throw new Error('must not sleep') } })
  assert.equal(r.waited, false)
  assert.match(lines.join('\n'), /NOTE .*pytest-lock .*cannot read/i)
  const quiet = []
  await waitNoPytestLock({ dir: path.join(dir, 'missing'), step: 'real-data', log: (l) => quiet.push(l), sleep: async () => {} })
  assert.deepEqual(quiet, [], 'a missing folder (ENOENT) stays silent')
})

test('run.mjs --first-launch waits on a live lock before it starts anything, and fails with the lock named when the wait times out', () => {
  const dir = scratch('run')
  plant(dir, process.pid)
  const env = { ...process.env, NQT_LOCK_DIR: dir, NQT_PYTEST_WAIT_TIMEOUT_S: '2', NQT_PYTEST_WAIT_POLL_S: '1' }
  const r = spawnSync(process.execPath, [RUN, '--first-launch'], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, new RegExp(`WAIT .*PYTEST\\.${process.pid}\\.lock`))
  assert.match(r.stderr, /PYTEST lock still held/)
  assert.doesNotMatch(r.stdout, /^output /m, 'no output folder was made: nothing was started')
})

// ---- 0.3.1 audit: pytest-wait.json was written into an --out folder that may not exist yet

test('born failing: a wait that ignored a stale lock records it in an --out folder that does not exist yet', () => {
  const dir = scratch('out-stale')
  const dead = deadPid()
  plant(dir, dead)
  const installer = path.join(dir, 'x_x64-setup.exe')
  fs.writeFileSync(installer, Buffer.alloc(1024))
  const out = path.join(dir, 'new-folder', 'run-1') // two levels that nobody has created
  const env = { ...process.env, NQT_LOCK_DIR: dir }
  const r = spawnSync(process.execPath, [RUN, '--mode', 'installer', '--real-data', '--dry', '--installer', installer, '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!r.stderr.includes('ENOENT'), r.stderr)
  assert.ok(r.stdout.includes(`ignoring stale lock PYTEST.${dead}.lock`), r.stdout)
  const wait = JSON.parse(fs.readFileSync(path.join(out, 'pytest-wait.json'), 'utf8'))
  assert.equal(wait.waited, false)
  assert.deepEqual(wait.ignored.map((lock) => lock.name), [`PYTEST.${dead}.lock`])
})

test('a run with no lock to wait for or ignore writes no pytest-wait.json', () => {
  const dir = scratch('out-none')
  const installer = path.join(dir, 'x_x64-setup.exe')
  fs.writeFileSync(installer, Buffer.alloc(1024))
  const out = path.join(dir, 'new-folder')
  const env = { ...process.env, NQT_LOCK_DIR: dir }
  const r = spawnSync(process.execPath, [RUN, '--mode', 'installer', '--real-data', '--dry', '--installer', installer, '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!fs.existsSync(path.join(out, 'pytest-wait.json')))
})
