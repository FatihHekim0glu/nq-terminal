// Born-failing checks for the backend teardown (run: node --test stop.test.mjs).
// The backend is stopped by creation-time-checked pids only: never `taskkill /T`, never a bare pid.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { stopOwned, BACKEND_NAMES } from '../lib/stop.mjs'
import { liveIdentity } from '../lib/mem.mjs'

const row = (pid, created, exe = 'python.exe') => ({ pid, created, exe })
const alive = { exitCode: null, signalCode: null, pid: 10 }
const exited = { exitCode: 1, signalCode: null, pid: 10 }
const harness = (liveRows, treeRows = [], killed = []) => ({
  names: BACKEND_NAMES, kill: (p) => { killed.push(p) }, live: () => liveRows, identity: () => treeRows, wait: async () => {}, killed,
})

test('an early-exited root whose pid was reused by a foreign process is never killed', async () => {
  const killed = []
  const out = await stopOwned(exited, [], harness([row(10, 'T9', 'python.exe')], [row(10, 'T9')], killed))
  assert.deepEqual(killed, [])
  assert.deepEqual(out.killed, [])
})

test('an early-exited root with no recorded tree kills nothing and does not read the tree', async () => {
  const killed = []
  let read = 0
  const h = { ...harness([], [], killed), identity: () => { read += 1; return [] } }
  await stopOwned(exited, [], h)
  assert.equal(read, 0)
  assert.deepEqual(killed, [])
})

test('a live root and its child are killed one pid at a time after the tree is read', async () => {
  const killed = []
  const tree = [row(10, 'T1'), row(11, 'T2')]
  const out = await stopOwned(alive, [], harness(tree, tree, killed))
  assert.deepEqual(killed.sort(), [10, 11])
  assert.deepEqual(out.killed.sort(), [10, 11])
})

test('a recorded child whose pid now has a different creation time is not killed', async () => {
  const killed = []
  await stopOwned(alive, [row(11, 'T2')], harness([row(10, 'T1'), row(11, 'T3')], [row(10, 'T1')], killed))
  assert.deepEqual(killed, [10])
})

test('a recorded pid that now carries a foreign image name is not killed', async () => {
  const killed = []
  await stopOwned(alive, [row(11, 'T2')], harness([row(10, 'T1'), row(11, 'T2', 'chrome.exe')], [row(10, 'T1')], killed))
  assert.deepEqual(killed, [10])
})

test('survivors lists recorded identities still alive after the kill pass', async () => {
  const tree = [row(10, 'T1')]
  const out = await stopOwned(alive, [], harness(tree, tree))
  assert.deepEqual(out.survivors.map((p) => p.pid), [10])
})

test('backend images are python.exe only', () => {
  assert.deepEqual([...BACKEND_NAMES], ['python.exe'])
})

test('live: a real child is stopped by identity, and a second stop of the dead pid kills nothing', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { windowsHide: true, stdio: 'ignore' })
  const out = await stopOwned(child, [], { names: new Set(['node.exe']) })
  assert.deepEqual(out.killed, [child.pid])
  assert.deepEqual(liveIdentity([child.pid]).filter((l) => l.created === out.recorded[0].created), [])
  const again = await stopOwned({ exitCode: 1, signalCode: null, pid: child.pid }, out.recorded, { names: new Set(['node.exe']) })
  assert.deepEqual(again.killed, [])
})

test('no teardown path of the harness uses taskkill /T', () => {
  const dirs = ['../lib', '../modes', '..'].map((d) => new URL(d + '/', import.meta.url))
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
      const text = fs.readFileSync(new URL(f, dir), 'utf8')
      assert.ok(!/['"]\/T['"]/.test(text) && !text.includes("'/T'") && !text.includes('"/T"'), f + ' passes /T to taskkill')
      assert.ok(!text.includes('killTree('), f + ' still uses killTree')
    }
  }
})
