// Born-failing tests for the scope claims of desktop/scripts/check.ps1 (03 section 16: desktop-check.yml; 04 D4.1, D5.3, D5.4).
// The script is read as text: its web group, its neutral default folders and the named open items in desktop/README.md.
// Run: node --test desktop/scripts/tests
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
const check = read('../check.ps1')
const readme = read('../../README.md')

test('the default target and log folders carry no wave name', () => {
  const targetDefault = /\[string\]\$TargetDir = '([^']+)'/.exec(check)?.[1]
  const logDefault = /\[string\]\$LogRoot = '([^']+)'/.exec(check)?.[1]
  assert.ok(targetDefault && logDefault, 'both defaults are declared')
  assert.doesNotMatch(targetDefault, /\bw\d[a-z]?\b|w\d[a-z]?(-|$)/i)
  assert.doesNotMatch(logDefault, /\bw\d[a-z]?\b|w\d[a-z]?(-|$)/i)
  assert.doesNotMatch(check.split('[CmdletBinding()]')[0], /targets\w\d/i, 'the usage line shows no wave folder')
})

test('a -Web switch adds the web group of desktop-check.yml', () => {
  assert.match(check, /\[switch\]\$Web\b/)
  for (const step of ['web-test-types', 'web-vitest', 'web-test-e2e-types', 'web-e2e-offline']) {
    assert.ok(check.includes(`'${step}'`), `step ${step} is declared`)
  }
  for (const script of ['test:types', 'test', 'test:e2e-types', 'e2e:offline']) {
    assert.match(check, new RegExp(`'${script.replace(':', ':')}'`), `pnpm script ${script} is run`)
  }
})

test('the offline Playwright step never overlaps another Playwright or vitest run', () => {
  assert.match(check, /function Wait-NoBrowserRun/)
  assert.match(check, /playwright\|vitest/)
})

test('the header states what check.ps1 leaves to other lists', () => {
  const header = check.split('[CmdletBinding()]')[0]
  assert.doesNotMatch(header, /every check the crate must pass, in one run/)
  assert.match(header, /-Web/)
  assert.match(header, /BASELINE/)
})

test('the README names the three workflow files as open items and the -Web group', () => {
  for (const name of ['desktop-check.yml', 'webview2-drift.yml', 'desktop-release.yml']) {
    assert.ok(readme.includes(name), `${name} is named`)
  }
  assert.match(readme, /MSVC/)
  assert.match(readme, /check\.ps1 -Web/)
  assert.doesNotMatch(readme, /w4a-check/)
})

test('every pnpm step runs from the web folder (from the terminal folder this pnpm refuses the workspace file)', () => {
  const step = /function Step-Pnpm[\s\S]*?\n}\n/.exec(check)?.[0] ?? ''
  assert.ok(step.includes("'pnpm'"), 'Step-Pnpm calls pnpm')
  assert.match(step, /-WorkDir \$web\b/)
  assert.doesNotMatch(step, /-WorkDir \$Terminal/)
})

test('the release-script tests, the owner upgrade tests and the start-path parity run are steps of check.ps1', () => {
  for (const step of ['install-test-tests', 'upgrade-owner-tests', 'parity']) assert.ok(check.includes(`'${step}'`), `step ${step} is declared`)
  assert.match(check, /install-test\.tests\.ps1/)
  assert.match(check, /upgrade-owner\.tests\.ps1/)
  assert.match(check, /--mode['", ]+parity/)
})
