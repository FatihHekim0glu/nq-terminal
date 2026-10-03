// Born-failing checks for the teardown identity guard (run: node --test survivors.test.mjs).
// The guard must never kill a pid whose creation time or image name differs from what was recorded.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { killableSurvivors, OWN_NAMES, SHELL_NAMES } from '../lib/survivors.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const rec = (pid, created, exe = 'msedgewebview2.exe') => ({ pid, created, exe })

test('a recorded process with the same creation time and an owned name is killable', () => {
  const out = killableSurvivors([rec(10, 'T1')], [rec(10, 'T1')])
  assert.deepEqual(out.map((p) => p.pid), [10])
})

test('a reused pid (different creation time) is never killable', () => {
  assert.deepEqual(killableSurvivors([rec(10, 'T1')], [rec(10, 'T2')]), [])
})

test('a pid that now carries a foreign image name is never killable, even with equal creation time', () => {
  assert.deepEqual(killableSurvivors([rec(28992, 'T1', 'electron.exe')], [rec(28992, 'T1', 'python.exe')]), [])
})

test('a recorded foreign image (an adopted orphan) is never killable', () => {
  assert.deepEqual(killableSurvivors([rec(28992, 'T1', 'python.exe')], [rec(28992, 'T1', 'python.exe')]), [])
})

test('a record without a creation time is never killable', () => {
  assert.deepEqual(killableSurvivors([rec(10, null)], [rec(10, null)]), [])
})

test('a recorded pid that is gone is dropped', () => {
  assert.deepEqual(killableSurvivors([rec(10, 'T1')], []), [])
})

test('owned names are exactly the spike shell set and the real shell set', () => {
  assert.deepEqual([...OWN_NAMES].sort(), ['electron.exe', 'msedgewebview2.exe', 'nq-shell.exe'])
  assert.deepEqual([...SHELL_NAMES].sort(), ['msedgewebview2.exe', 'nq-lab-terminal.exe', 'python.exe'])
})

test('the real shell set may kill a recorded backend interpreter, the spike set may not', () => {
  const r = rec(40, 'T1', 'python.exe')
  assert.deepEqual(killableSurvivors([r], [r], SHELL_NAMES).map((p) => p.pid), [40])
  assert.deepEqual(killableSurvivors([r], [r], OWN_NAMES), [])
})

// The tree walk: an orphan whose dead parent's pid was reused by the root must not be adopted.
function walk(script, table, root) {
  const f = path.join('D:/dev/tmp', `walk-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(f, JSON.stringify(table))
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-RootPid', String(root), '-TableJson', f, '-WalkOnly'],
      { encoding: 'utf8', windowsHide: true })
    return JSON.parse(out).map(Number).sort((a, b) => a - b)
  } finally { fs.rmSync(f, { force: true }) }
}
const TABLE = [
  { ProcessId: 100, ParentProcessId: 1, Name: 'electron.exe', Created: '2026-10-02T10:00:00.0000000Z' },
  { ProcessId: 101, ParentProcessId: 100, Name: 'electron.exe', Created: '2026-10-02T10:00:01.0000000Z' },
  { ProcessId: 102, ParentProcessId: 101, Name: 'msedgewebview2.exe', Created: '2026-10-02T10:00:02.0000000Z' },
  { ProcessId: 200, ParentProcessId: 100, Name: 'python.exe', Created: '2026-10-01T08:00:00.0000000Z' }, // orphan of an older holder of pid 100
  { ProcessId: 201, ParentProcessId: 200, Name: 'python.exe', Created: '2026-10-01T08:00:05.0000000Z' }, // its child
]
for (const [label, script] of [['mem.ps1', path.join(HERE, '..', 'lib', 'mem.ps1')]]) {
  test(`${label}: orphan older than its recorded parent is not adopted, real children are`, () => {
    assert.deepEqual(walk(script, TABLE, 100), [100, 101, 102])
  })
}

// Live check against a real process: a harmless idle node child stands in for a pid that was recorded and then reused.
import { spawn } from 'node:child_process'
import { liveIdentity, treeIdentity } from '../lib/mem.mjs'

test('live: a real process is killable only under its true name and creation time; a forged record is not', () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { windowsHide: true, stdio: 'ignore' })
  try {
    const [now] = liveIdentity([child.pid])
    assert.equal(now.pid, child.pid)
    assert.equal(now.exe.toLowerCase(), 'node.exe')
    assert.ok(now.created, 'creation time is read')
    assert.deepEqual(killableSurvivors([now], [now], new Set(['node.exe'])).map((p) => p.pid), [child.pid])
    assert.deepEqual(killableSurvivors([now], [now]), [], 'node.exe is not an owned image')
    assert.deepEqual(killableSurvivors([{ ...now, created: '2000-01-01T00:00:00.0000000Z' }], [now], new Set(['node.exe'])), [], 'forged creation time')
    const tree = treeIdentity(child.pid)
    assert.ok(tree.some((p) => p.pid === child.pid), 'the root is in its own tree')
  } finally { child.kill() }
})
