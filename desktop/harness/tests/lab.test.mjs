// The derived lab: junctions to the terminal under test, never to its state, and a removal that cannot follow a junction.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeLab, dropLab, writeMeasureSettings } from '../lib/lab.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h-lab-'))
  const real = path.join(root, 'real')
  const terminal = path.join(root, 'terminal')
  fs.mkdirSync(path.join(real, '.venv', 'Scripts'), { recursive: true })
  fs.mkdirSync(path.join(real, '.venv', 'Lib', 'site-packages'), { recursive: true })
  fs.writeFileSync(path.join(real, '.venv', 'Scripts', 'python.exe'), 'launcher')
  fs.writeFileSync(path.join(real, '.venv', 'pyvenv.cfg'), 'home = x')
  fs.mkdirSync(path.join(real, 'src', 'nq_lab', '__pycache__'), { recursive: true })
  fs.writeFileSync(path.join(real, 'src', 'nq_lab', 'config.py'), 'ROOT = 1')
  fs.writeFileSync(path.join(real, 'src', 'nq_lab', '__pycache__', 'x.pyc'), 'junk')
  for (const d of ['backend', 'web', 'state', 'node_modules']) { fs.mkdirSync(path.join(terminal, d), { recursive: true }); fs.writeFileSync(path.join(terminal, d, 'keep.txt'), d) }
  fs.mkdirSync(path.join(terminal, 'backend', 'nq_terminal', '__pycache__'), { recursive: true })
  fs.writeFileSync(path.join(terminal, 'backend', 'nq_terminal', '__main__.py'), 'print(1)')
  fs.writeFileSync(path.join(terminal, 'backend', 'nq_terminal', '__pycache__', 'x.pyc'), 'junk')
  return { root, real, terminal, run: path.join(root, 'run') }
}

test('an isolated derived lab links every folder of the terminal except state, and copies the research sources', () => {
  const f = fixture()
  try {
    const lab = makeLab(f.run, { terminal: f.terminal, real: f.real, isolateState: true })
    assert.equal(lab.derived, true)
    const t = path.join(lab.lab, 'terminal')
    assert.ok(fs.existsSync(path.join(t, 'backend', 'nq_terminal', '__main__.py')), 'the backend package is a copy in the lab')
    assert.ok(!fs.lstatSync(path.join(t, 'backend')).isSymbolicLink(), 'the backend folder is not a link: its state folder follows its own location')
    assert.ok(!fs.existsSync(path.join(t, 'backend', 'nq_terminal', '__pycache__')))
    assert.ok(fs.existsSync(path.join(t, 'web', 'keep.txt')))
    assert.ok(!fs.existsSync(path.join(t, 'state')), 'the state folder is never linked')
    assert.ok(!fs.existsSync(path.join(t, 'node_modules')))
    assert.ok(fs.existsSync(path.join(lab.lab, 'src', 'nq_lab', 'config.py')))
    assert.ok(!fs.existsSync(path.join(lab.lab, 'src', 'nq_lab', '__pycache__')))
    assert.match(fs.readFileSync(path.join(lab.lab, '.venv', 'Lib', 'site-packages', 'nqt_derived.pth'), 'utf8'), /site\.addsitedir/)
    fs.writeFileSync(path.join(t, 'new-state-file.txt'), 'in the lab folder only')
    lab.remove()
    assert.ok(!fs.existsSync(lab.lab), 'the derived lab is gone')
    for (const d of ['backend', 'web', 'state', 'node_modules']) assert.ok(fs.existsSync(path.join(f.terminal, d, 'keep.txt')), `${d} of the real terminal survives the removal`)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('a single junction lab points terminal at the tree itself', () => {
  const f = fixture()
  try {
    const lab = makeLab(f.run, { terminal: f.terminal, real: f.real, force: true })
    assert.ok(fs.existsSync(path.join(lab.lab, 'terminal', 'state', 'keep.txt')))
    dropLab(lab.lab)
    assert.ok(fs.existsSync(path.join(f.terminal, 'state', 'keep.txt')))
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('the measure build settings file names the lab', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h-set-'))
  try {
    const file = writeMeasureSettings(dir, 'D:\\dev\\x\\lab')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { lab: 'D:\\dev\\x\\lab' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a lab with a junction that was not removed is never deleted recursively (the guard refuses)', () => {
  const f = fixture()
  try {
    const lab = path.join(f.run, 'lab')
    fs.mkdirSync(path.join(lab, 'deep'), { recursive: true })
    fs.symlinkSync(f.terminal, path.join(lab, 'deep', 'inner'), 'junction')
    assert.equal(dropLab(lab), false)
    assert.ok(fs.existsSync(path.join(lab, 'deep')), 'the folder holding the junction is still there')
    assert.ok(fs.existsSync(path.join(f.terminal, 'backend', 'keep.txt')), 'the target of the junction is untouched')
    fs.rmdirSync(path.join(lab, 'deep', 'inner'))
    assert.equal(dropLab(lab), true, 'once the junction is gone the lab is removed')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})
