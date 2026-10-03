import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { playwrightSpawn } from '../modes/t8.mjs'
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
