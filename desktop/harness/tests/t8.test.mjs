import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { playwrightSpawn, testRunPids } from '../modes/t8.mjs'
import { TERMINAL } from '../lib/paths.mjs'

const argsWith = (opts = {}) => ({ opt: (name, fallback) => (name in opts ? opts[name] : fallback), flag: () => false })

test('the default Playwright command runs pnpm from the web folder (from the terminal folder this pnpm refuses the workspace file)', () => {
  const s = playwrightSpawn(argsWith())
  assert.match(s.cmd, /pnpm\b.*e2e:desktop/)
  assert.equal(s.cwd, path.join(TERMINAL, 'web'))
})

test('an operator-supplied Playwright command is kept and also runs from the web folder', () => {
  const s = playwrightSpawn(argsWith({ 'playwright-cmd': 'pnpm e2e:desktop --grep walk' }))
  assert.equal(s.cmd, 'pnpm e2e:desktop --grep walk')
  assert.equal(s.cwd, path.join(TERMINAL, 'web'))
})

test('the default command carries no --dir (from the web folder it would point at web/web)', () => {
  assert.doesNotMatch(playwrightSpawn(argsWith()).cmd, /--dir/)
})

test('the check for another test run never counts the harness itself or its parents (its own --playwright flag matches the pattern)', () => {
  const rows = [
    { pid: 100, ppid: 1, name: 'node.exe', cmd: 'node run.mjs --mode t8 --playwright' }, // this harness
    { pid: 90, ppid: 1, name: 'node.exe', cmd: 'node wrapper.mjs --playwright' }, // its parent
    { pid: 200, ppid: 1, name: 'node.exe', cmd: 'node node_modules/@playwright/test/cli.js test' }, // a real run
    { pid: 300, ppid: 200, name: 'chrome.exe', cmd: 'chrome --headless --remote-debugging-pipe playwright' },
    { pid: 400, ppid: 1, name: 'node.exe', cmd: 'node vitest.mjs run' },
    { pid: 500, ppid: 1, name: 'node.exe', cmd: 'node unrelated.js' },
  ]
  rows.find((r) => r.pid === 100).ppid = 90
  assert.deepEqual(testRunPids(rows, 100), [200, 300, 400])
})
