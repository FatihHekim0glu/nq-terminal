// The split of a process tree's private working set into backend, WebView2 (by --type) and shell (born failing: classifyTree and
// memTreeBreakdown did not exist). The fixture has the shape of a W5B app-mem record: the shell, the python launcher with its
// interpreter and console host, and the WebView2 browser root with its renderer, GPU, network, storage and crashpad processes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTree, memTreeBreakdown, T4_UI_TREE_MB } from '../lib/mem.mjs'
import { idleBreakdownOf, uiOver350Of } from '../lib/launch-run.mjs'

const MB = 1048576
const WV = 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\msedgewebview2.exe'
const proc = (pid, parent, name, commandLine, mb) => ({ pid, parent, name, commandLine, wsPrivate: mb * MB })

const TREE = [
  proc(100, 1, 'nq-lab-terminal.exe', '"D:\\dev\\w5c\\bin\\nq-lab-terminal.exe"', 4),
  proc(200, 100, 'python.exe', '"C:\\lab\\.venv\\Scripts\\python.exe" -m nq_terminal', 6),
  proc(201, 200, 'python.exe', 'C:\\Python\\python.exe -m nq_terminal', 160),
  proc(202, 200, 'conhost.exe', '\\??\\C:\\Windows\\system32\\conhost.exe 0x4', 1),
  proc(300, 100, 'msedgewebview2.exe', `"${WV}" --embedded-browser-webview=1 --webview-exe-name=nq-lab-terminal.exe`, 36),
  proc(301, 300, 'msedgewebview2.exe', `"${WV}" --type=renderer --lang=en-GB`, 94),
  proc(302, 300, 'msedgewebview2.exe', `"${WV}" --type=gpu-process --gpu-preferences=abc`, 36),
  proc(303, 300, 'msedgewebview2.exe', `"${WV}" --type=utility --utility-sub-type=network.mojom.NetworkService`, 10),
  proc(304, 300, 'msedgewebview2.exe', `"${WV}" --type=utility --utility-sub-type=storage.mojom.StorageService`, 3),
  proc(305, 300, 'msedgewebview2.exe', `"${WV}" --type=crashpad-handler --database=C:\\x`, 2),
]
const TOTAL_MB = 4 + 6 + 160 + 1 + 36 + 94 + 36 + 10 + 3 + 2

test('classifyTree splits a W5B-shaped tree into backend, WebView2 by type and shell, and the parts sum to the tree total', () => {
  const b = classifyTree(TREE)
  assert.equal(b.backendMB, 167)
  assert.equal(b.shellMB, 4)
  assert.equal(b.uiTreeMB, 181)
  assert.deepEqual(b.perType, { browser: 36, renderer: 94, 'gpu-process': 36, 'utility-network': 10, 'utility-storage': 3, crashpad: 2 })
  assert.equal(b.totalMB, TOTAL_MB)
  assert.equal(b.backendMB + b.uiTreeMB + b.shellMB, b.totalMB)
  assert.equal(Object.values(b.perType).reduce((a, v) => a + v, 0), b.uiTreeMB)
})

test('classifyTree sums several renderers into one type and leaves absent types out', () => {
  const b = classifyTree([...TREE, proc(306, 300, 'msedgewebview2.exe', `"${WV}" --type=renderer --extension-process`, 20)])
  assert.equal(b.perType.renderer, 114)
  assert.equal(b.uiTreeMB, 201)
  assert.equal(classifyTree([TREE[0]]).perType.renderer, undefined)
})

test('a WebView2 process whose command line is unknown is counted as unknown, not lost', () => {
  const b = classifyTree([proc(1, 0, 'msedgewebview2.exe', null, 7), proc(2, 0, 'msedgewebview2.exe', `"${WV}" --type=zygote`, 3)])
  assert.deepEqual(b.perType, { unknown: 7, other: 3 })
  assert.equal(b.uiTreeMB, 10)
})

test('image names are matched without case', () => {
  const b = classifyTree([proc(1, 0, 'Python.EXE', '', 5), proc(2, 0, 'MSEdgeWebView2.exe', `"${WV}" --type=renderer`, 8)])
  assert.equal(b.backendMB, 5)
  assert.equal(b.perType.renderer, 8)
})

test('the empty tree, and rounding to one decimal place', () => {
  assert.deepEqual(classifyTree([]), { backendMB: 0, uiTreeMB: 0, shellMB: 0, perType: {}, totalMB: 0 })
  assert.equal(classifyTree([{ pid: 1, parent: 0, name: 'python.exe', commandLine: '', wsPrivate: 1.26 * MB }]).backendMB, 1.3)
})

test('the T4 canvas threshold is 350 MB', () => { assert.equal(T4_UI_TREE_MB, 350) })

test('memTreeBreakdown joins the mem.ps1 rows with their command lines and classifies them', () => {
  const tree = { n: TREE.length, procs: TREE.map((p) => ({ pid: p.pid, name: p.name.replace(/\.exe$/, '#1'), exe: p.name, wsPrivate: p.wsPrivate })) }
  const details = (pids) => TREE.filter((p) => pids.includes(p.pid)).map((p) => ({ pid: p.pid, parent: p.parent, commandLine: p.commandLine }))
  const b = memTreeBreakdown(555, { tree: (root) => { assert.equal(root, 555); return tree }, details })
  assert.equal(b.uiTreeMB, 181)
  assert.equal(b.perType.renderer, 94)
  assert.equal(b.totalMB, TOTAL_MB)
})

test('memTreeBreakdown still answers when the command lines cannot be read', () => {
  const tree = { procs: TREE.map((p) => ({ pid: p.pid, name: p.name, exe: p.name, wsPrivate: p.wsPrivate })) }
  const b = memTreeBreakdown(1, { tree: () => tree, details: () => { throw new Error('no cim') } })
  assert.equal(b.backendMB, 167)
  assert.equal(b.uiTreeMB, 181)
  assert.equal(b.perType.unknown, 181)
})

test('the idle breakdown of a launch has the four fields, and uiOver350 turns on above 350 MB only', () => {
  const read = (uiTreeMB) => () => ({ backendMB: 160, uiTreeMB, shellMB: 4, perType: { renderer: 90 }, totalMB: 164 + uiTreeMB })
  const low = idleBreakdownOf(7, read(181))
  assert.deepEqual(Object.keys(low), ['backendMB', 'uiTreeMB', 'shellMB', 'perType'])
  assert.equal(uiOver350Of(low), false)
  assert.equal(uiOver350Of(idleBreakdownOf(7, read(350))), false)
  assert.equal(uiOver350Of(idleBreakdownOf(7, read(350.1))), true)
})

test('a failed breakdown reading is null, never an error, and gives no uiOver350 verdict', () => {
  assert.equal(idleBreakdownOf(7, () => { throw new Error('no counters') }), null)
  assert.equal(uiOver350Of(null), null)
})

// A failed side reading leaves a trace (born failing: the catch blocks dropped the reason, so "not read" looked like "not over").
test('a failed breakdown reading reports its reason to onError and still gives null', () => {
  const seen = []
  assert.equal(idleBreakdownOf(7, () => { throw new Error('powershell timed out after 60000 ms') }, (m) => seen.push(m)), null)
  assert.deepEqual(seen, ['powershell timed out after 60000 ms'])
})

test('a failed command-line lookup is named on the breakdown, and a good lookup names nothing', () => {
  const tree = { procs: TREE.map((p) => ({ pid: p.pid, name: p.name, exe: p.name, wsPrivate: p.wsPrivate })) }
  const bad = memTreeBreakdown(1, { tree: () => tree, details: () => { throw new Error('cim failed') } })
  assert.equal(bad.commandLineError, 'cim failed')
  assert.equal(idleBreakdownOf(1, () => bad).commandLineError, 'cim failed')
  const details = (pids) => TREE.filter((p) => pids.includes(p.pid)).map((p) => ({ pid: p.pid, parent: p.parent, commandLine: p.commandLine }))
  const good = memTreeBreakdown(1, { tree: () => tree, details })
  assert.equal('commandLineError' in good, false)
  assert.equal('commandLineError' in idleBreakdownOf(1, () => good), false)
})
