import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shellSpec, listState, newState, devToolsFile, MEASURE_DIR_VAR } from '../lib/shell.mjs'
import { selectRows } from '../modes/rows.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h-shell-'))

test('the smoke command line carries the frozen switches, the folders under the run folder and port 0', () => {
  const dir = tmp()
  try {
    const s = shellSpec({ build: 'smoke', exe: 'x.exe', runDir: dir, lab: 'C:\\lab', fixture: true, stateDir: path.join(dir, 'state'), size: '1920x1080' })
    assert.deepEqual(s.args.slice(0, 3), ['--lab', 'C:\\lab', '--fixture'])
    assert.ok(s.args.includes('--webview-data-dir') && s.args.includes(path.join(dir, 'wv')))
    assert.ok(s.args.includes('--config-dir') && s.args.includes(path.join(dir, 'config')))
    assert.deepEqual(s.args.slice(s.args.indexOf('--remote-debugging-port'), s.args.indexOf('--remote-debugging-port') + 2), ['--remote-debugging-port', '0'])
    assert.equal(s.logFile, path.join(dir, 'config', 'logs', 'shell.log'))
    assert.equal(devToolsFile(path.join(dir, 'wv')), path.join(dir, 'wv', 'EBWebView', 'DevToolsActivePort'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the owner port is refused as a debugging port, and attach-url takes no lab and no fixture', () => {
  const dir = tmp()
  try {
    assert.throws(() => shellSpec({ build: 'smoke', exe: 'x', runDir: dir, lab: 'L', debugPort: 8765 }), /8765/)
    const a = shellSpec({ build: 'smoke', exe: 'x', runDir: dir, lab: null, attachUrl: 'http://127.0.0.1:4373/' })
    assert.ok(!a.args.includes('--lab'))
    assert.ok(a.args.includes('--attach-url'))
    assert.throws(() => shellSpec({ build: 'smoke', exe: 'x', runDir: dir, lab: 'L', fixture: true, attachUrl: 'http://127.0.0.1:4373/' }), /exclude each other/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the measure build takes no switch: the run folder goes in NQT_MEASURE_DIR and the lab in its settings file', () => {
  const dir = tmp()
  try {
    const s = shellSpec({ build: 'measure', exe: 'x', runDir: dir, lab: 'D:\\lab' })
    assert.deepEqual(s.args, [])
    assert.equal(s.env[MEASURE_DIR_VAR], dir)
    assert.deepEqual(JSON.parse(fs.readFileSync(s.settingsFile, 'utf8')), { lab: 'D:\\lab' })
    assert.throws(() => shellSpec({ build: 'measure', exe: 'x', runDir: dir, lab: 'L', screen2: true }), /no switch/)
    assert.throws(() => shellSpec({ build: 'release', exe: 'x', runDir: dir, lab: 'L' }), /no launch/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the state check lists new files and folders and excuses only release and desktop', () => {
  const dir = tmp()
  try {
    fs.writeFileSync(path.join(dir, 'old.txt'), 'x')
    const before = listState(dir)
    fs.mkdirSync(path.join(dir, 'cache'))
    fs.writeFileSync(path.join(dir, 'backend.lock'), 'x')
    fs.mkdirSync(path.join(dir, 'release'))
    fs.writeFileSync(path.join(dir, 'release', 'r.txt'), 'x')
    fs.mkdirSync(path.join(dir, 'desktop'))
    fs.writeFileSync(path.join(dir, 'old.txt'), 'changed contents')
    assert.deepEqual(newState(before, listState(dir)).sort(), ['backend.lock', 'cache'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('row selection: all, a list, an unknown id and a row the build cannot read', () => {
  assert.deepEqual(selectRows('measure', 'all', false), ['backend_ready', 'splash_painted', 'cold_home', 'idle_mem_home'])
  assert.ok(selectRows('smoke', 'all', true).includes('eq_warm'))
  assert.ok(!selectRows('smoke', 'all', false).includes('eq_warm'))
  assert.deepEqual(selectRows('smoke', 'grid_open,keystroke_p95', false), ['grid_open', 'keystroke_p95'])
  assert.throws(() => selectRows('smoke', 'nope', false), /no row nope/)
  assert.throws(() => selectRows('measure', 'grid_open', false), /not available on the measure build/)
  assert.throws(() => selectRows('smoke', 'eq_warm', false), /--real-data/)
})
