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
