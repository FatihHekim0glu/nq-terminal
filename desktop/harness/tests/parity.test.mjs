// perf-5: the fixture backend started the way the shell starts it and the plain way must match in private working set (within
// 5 MB) and in thread count (born failing: lib/parity.mjs did not exist). Pure functions only; the live mode is run by hand.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PARITY, SHELL_BASE_ENV, SHELL_ARGS, FIXTURE_MODULE, shellStart, plainStart, compareParity, pickInterpreter, summariseRuns } from '../lib/parity.mjs'

const PARENT = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows;C:\\x', USERPROFILE: 'C:\\Users\\a', TEMP: 'C:\\t', PYTHONPATH: 'C:\\evil', NQT_FOO: '1', IB_HOST: 'h', NQT_CACHE_BYTES: '1000', WEBVIEW2_X: 'y', SECRET_TOKEN: 's', VIRTUAL_ENV: 'v', NUMBER_OF_PROCESSORS: '32' }
const OPTS = { lab: 'C:\\lab', port: 8792, stateDir: 'D:\\dev\\tmp\\st', fixtureDir: 'C:\\lab\\terminal\\backend\\tests\\fixtures' }

test('the BASE_ENV names are exactly those of supervise_check.rs', () => {
  const rust = fs.readFileSync(new URL('../../src-tauri/src/supervise_check.rs', import.meta.url), 'utf8')
  const block = /pub const BASE_ENV: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rust)?.[1] ?? ''
  const names = [...block.matchAll(/"([A-Z_0-9]+)"/g)].map((m) => m[1])
  assert.ok(names.length >= 19)
  assert.deepEqual([...SHELL_BASE_ENV], names)
  const args = /pub const SPAWN_ARGS: \[&str; \d+\] = \[([^\]]*)\];/.exec(rust)?.[1] ?? ''
  assert.deepEqual([...SHELL_ARGS], [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
  assert.equal(FIXTURE_MODULE, /FIXTURE_MODULE: &str = "([^"]+)"/.exec(rust)?.[1])
})

test('the ports are the two spare ones and never 8765', () => {
  assert.deepEqual([PARITY.plainPort, PARITY.shellPort], [8791, 8792])
  assert.equal(PARITY.maxWsDeltaMB, 5)
})

test('shell start: the flags and an environment built from nothing', () => {
  const s = shellStart(PARENT, OPTS)
  assert.deepEqual(s.args, ['-E', '-s', '-X', 'utf8', '-X', 'faulthandler', '-m', 'nq_terminal.desktop.fixture_main'])
  const names = Object.keys(s.env)
  assert.deepEqual(names, [...names].sort(), 'sorted')
  for (const gone of ['PYTHONPATH', 'NQT_FOO', 'IB_HOST', 'WEBVIEW2_X', 'SECRET_TOKEN', 'VIRTUAL_ENV']) assert.equal(gone in s.env, false, gone)
  assert.equal(s.env.NQT_CACHE_BYTES, '1000')
  assert.equal(s.env.NUMBER_OF_PROCESSORS, '32')
  assert.equal(s.env.NQT_DESKTOP, '1')
  assert.equal(s.env.NQT_PORT, '8792')
  assert.equal(s.env.PYTHONUTF8, '1')
  assert.equal(s.env.PYTHONIOENCODING, 'utf-8')
  assert.equal(s.env.NQT_JOBS, 'off')
  assert.equal(s.env.NQT_STATE_DIR, OPTS.stateDir)
  assert.equal(s.env.NQT_FIXTURE_DIR, OPTS.fixtureDir)
  assert.ok(s.env.PATH.startsWith('C:\\lab\\.venv\\Scripts;C:\\Windows'))
  assert.equal(s.python, 'C:\\lab\\.venv\\Scripts\\python.exe')
})

test('plain start: no interpreter flags, the whole parent environment minus Python, NQT_, venv and WebView2 names', () => {
  const p = plainStart(PARENT, { ...OPTS, port: 8791 })
  assert.deepEqual(p.args, ['-m', 'nq_terminal.desktop.fixture_main'])
  assert.equal(p.env.NQT_PORT, '8791')
  assert.equal(p.env.NQT_STDIN_CONTROL, '1')
  assert.equal('NQT_DESKTOP' in p.env, false)
  assert.equal(p.env.IB_HOST, 'h', 'the plain way keeps the rest of the parent environment')
  for (const gone of ['PYTHONPATH', 'NQT_FOO', 'WEBVIEW2_X', 'VIRTUAL_ENV']) assert.equal(gone in p.env, false, gone)
  assert.equal(p.env.NQT_JOBS, 'off')
  assert.equal(p.env.NQT_FIXTURE_DIR, OPTS.fixtureDir)
})

test('a start on 8765 is refused', () => {
  assert.throws(() => shellStart(PARENT, { ...OPTS, port: 8765 }), /8765/)
  assert.throws(() => plainStart(PARENT, { ...OPTS, port: 8765 }), /8765/)
})

const row = (wsPrivateMB, threads, privateBytesMB = 209) => ({ wsPrivateMB, threads, privateBytesMB })

test('parity passes when the private working sets differ by 5 MB or less and the thread counts match', () => {
  assert.equal(compareParity(row(134.4, 11), row(134.6, 11)).pass, true)
  assert.equal(compareParity(row(130, 11), row(135, 11)).pass, true, 'exactly 5 MB is within')
  assert.equal(compareParity(row(135, 11), row(130, 11)).pass, true)
})

test('parity fails on a working-set difference above 5 MB, either way round', () => {
  const a = compareParity(row(95.3, 10), row(134.4, 10))
  assert.equal(a.pass, false)
  assert.ok(Math.abs(Math.abs(a.wsDeltaMB) - 39.1) < 0.05)
  assert.match(a.problems.join(' '), /private working set/)
  assert.equal(compareParity(row(140, 11), row(134.9, 11)).pass, false)
})

test('parity fails when the thread counts differ, even with equal memory', () => {
  const r = compareParity(row(134, 11), row(134, 12))
  assert.equal(r.pass, false)
  assert.match(r.problems.join(' '), /thread/)
})

test('parity never passes on a missing or non-numeric reading', () => {
  assert.equal(compareParity(null, row(134, 11)).pass, false)
  assert.equal(compareParity(row(134, 11), { wsPrivateMB: NaN, threads: 11 }).pass, false)
  assert.equal(compareParity(row(134, 11), { wsPrivateMB: 134, threads: undefined }).pass, false)
})

test('the tolerance can be tightened by the caller', () => {
  assert.equal(compareParity(row(130, 11), row(133, 11), { maxWsDeltaMB: 2 }).pass, false)
})

test('the interpreter is the python process with the largest private working set (the venv launcher is small)', () => {
  const MB = 1048576
  const procs = [{ pid: 1, exe: 'python.exe', wsPrivate: 6 * MB }, { pid: 2, exe: 'python.exe', wsPrivate: 134 * MB, privateBytes: 209 * MB }, { pid: 3, exe: 'conhost.exe', wsPrivate: 900 * MB }]
  assert.equal(pickInterpreter(procs).pid, 2)
  assert.equal(pickInterpreter([{ pid: 3, exe: 'conhost.exe', wsPrivate: 1 }]), null)
  assert.equal(pickInterpreter([]), null)
})

test('several runs are reduced to the median of each figure, and differing thread counts are kept apart', () => {
  const s = summariseRuns([row(134, 11), row(140, 11), row(135, 11)])
  assert.equal(s.wsPrivateMB, 135)
  assert.equal(s.threads, 11)
  assert.equal(s.threadsStable, true)
  const t = summariseRuns([row(134, 11), row(134, 12), row(134, 11)])
  assert.equal(t.threads, 11)
  assert.equal(t.threadsStable, false)
})

test('plain start runs the memory trim thread too, as the shell start does in desktop mode (NQT_MEMTRIM=1)', () => {
  // memtrim.py starts its quiet thread for NQT_DESKTOP=1 or NQT_MEMTRIM=1. The plain start drops NQT_DESKTOP, so without this the shell side
  // always holds one more thread than the plain side and the thread-count comparison fails for a reason that is by design.
  const shell = shellStart(PARENT, OPTS)
  const plain = plainStart(PARENT, { ...OPTS, port: 8791 })
  assert.equal(shell.env.NQT_DESKTOP, '1')
  assert.equal(plain.env.NQT_MEMTRIM, '1')
  assert.equal('NQT_MEMTRIM' in shell.env, false, 'the shell side leaves the switch to desktop mode')
})
