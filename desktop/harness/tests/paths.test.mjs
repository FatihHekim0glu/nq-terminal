// Born-failing checks for the launch prelude (run: node --test tests).
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanPath, isBuildToolEntry, launchEnv, assertPortAllowed, newRunFolder, PORTS } from '../lib/paths.mjs'

test('a planted MinGW folder on PATH is stripped, whatever its slashes or case', () => {
  const planted = ['C:\\Windows', 'D:\\dev\\mingw\\mingw64\\bin', 'd:/dev/MINGW/mingw64/bin/', 'D:\\dev\\cargo\\bin', 'C:\\Windows\\System32', 'D:\\dev\\mingwish\\bin'].join(';')
  assert.equal(cleanPath(planted), 'C:\\Windows;C:\\Windows\\System32;D:\\dev\\mingwish\\bin')
})

test('a folder that only starts with the same letters is not a build tool folder', () => {
  assert.equal(isBuildToolEntry('D:\\dev\\mingwish'), false)
  assert.equal(isBuildToolEntry('D:\\dev\\mingw'), true)
  assert.equal(isBuildToolEntry('D:\\dev\\cargo\\bin'), true)
})

test('the launch environment has no build tools, no WEBVIEW2_ variable and TEMP on D:', () => {
  const env = launchEnv({ Path: 'C:\\Windows;D:\\dev\\mingw\\mingw64\\bin', WEBVIEW2_USER_DATA_FOLDER: 'X', webview2_foo: '1', KEEP: 'yes', TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp' }, { EXTRA: '1' })
  assert.equal(env.Path, 'C:\\Windows')
  assert.equal(env.KEEP, 'yes')
  assert.equal(env.EXTRA, '1')
  assert.equal(env.TEMP, 'D:\\dev\\tmp')
  assert.equal(env.TMP, 'D:\\dev\\tmp')
  assert.ok(!Object.keys(env).some((k) => k.toUpperCase().startsWith('WEBVIEW2_')))
})

test('the spike reproduction may name WEBVIEW2_ variables through `extra` only', () => {
  const env = launchEnv({ WEBVIEW2_X: 'inherited' }, { WEBVIEW2_USER_DATA_FOLDER: 'D:\\dev\\x' })
  assert.equal(env.WEBVIEW2_X, undefined)
  assert.equal(env.WEBVIEW2_USER_DATA_FOLDER, 'D:\\dev\\x')
})

test('port 8765 is refused, and so is anything that is not a port', () => {
  assert.throws(() => assertPortAllowed(PORTS.owner), /8765/)
  assert.throws(() => assertPortAllowed(70000))
  assert.throws(() => assertPortAllowed(1.5))
  assert.equal(assertPortAllowed(8800), 8800)
  assert.equal(assertPortAllowed(0), 0)
})

test('run output outside D: is refused', () => {
  assert.throws(() => newRunFolder('x', 'C:\\Users\\Owner\\runs'), /D:/)
})

// ---- 0.3.1 part 2: isMainTree compares real paths (the lab sits behind a C: to E: junction) ----
import fs from 'node:fs'
import path from 'node:path'
import { isMainTree } from '../lib/paths.mjs'

const JUNCTION_ROOT = 'D:/dev/tmp/harness-junction-tests'

/** A scratch lab folder with a terminal and a worktree beside it, and a junction to it (the way C:\Users\...\nq-lab reaches E:\projects\nq-lab). */
function plantedLab(name) {
  const base = path.join(JUNCTION_ROOT, `${name}-${process.pid}-${Date.now()}`)
  const real = path.join(base, 'real')
  fs.mkdirSync(path.join(real, 'terminal'), { recursive: true })
  fs.mkdirSync(path.join(real, 'wt031'), { recursive: true })
  const link = path.join(base, 'link')
  fs.symlinkSync(real, link, 'junction')
  return { base, real, link }
}
const unplant = (base) => { fs.rmSync(base, { recursive: true, force: true }) }

test('the main tree reached through a junction is still the main tree (the lab is a C: to E: junction)', () => {
  const { base, real, link } = plantedLab('main')
  try {
    assert.equal(isMainTree(path.join(real, 'terminal'), link), true, 'real terminal path, lab named through the junction')
    assert.equal(isMainTree(path.join(link, 'terminal'), real), true, 'terminal named through the junction, lab by its real path')
    assert.equal(isMainTree(path.join(link, 'terminal'), link), true, 'both through the junction')
  } finally { unplant(base) }
})

test('a worktree beside the main tree is still a worktree, through a junction or not', () => {
  const { base, real, link } = plantedLab('worktree')
  try {
    assert.equal(isMainTree(path.join(real, 'wt031'), link), false)
    assert.equal(isMainTree(path.join(link, 'wt031'), real), false)
    assert.equal(isMainTree(path.join(link, 'wt031'), link), false)
  } finally { unplant(base) }
})

test('the case of the path never matters, and a lab that does not exist yet compares by its typed path', () => {
  const { base, real } = plantedLab('case')
  try {
    assert.equal(isMainTree(path.join(real, 'terminal').toUpperCase(), real), true)
    assert.equal(isMainTree(path.join(base, 'nothing', 'terminal'), path.join(base, 'nothing')), true)
    assert.equal(isMainTree(path.join(base, 'nothing', 'wt'), path.join(base, 'nothing')), false)
  } finally { unplant(base) }
})
