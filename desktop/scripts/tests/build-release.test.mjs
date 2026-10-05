// build-release.ps1 builds the install-test variant (the renamed product the install and upgrade tests use) beside the three builds,
// so that release_check.ps1 -RequireInstall can match a record's installer hash against a setup exe of the release folder.
// The script is read as text; the real build is the release check's.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const script = fs.readFileSync(new URL('../build-release.ps1', import.meta.url), 'utf8')

test('a fourth build, installtest, uses the release feature set and its own overlay', () => {
  const line = script.split(/\r?\n/).find((l) => l.includes("Invoke-Build 'installtest'"))
  assert.ok(line, 'the installtest build is called')
  assert.match(line, /tauri\.installtest\.conf\.json/)
  assert.match(line, /--bundles/)
  assert.doesNotMatch(line, /--features/, 'release features: no measure, no smoke')
  assert.match(line, /Copy-Payload 'installtest' -WithInstaller/)
  assert.match(line, /Test-Bootstrapper 'installtest'/)
})

test('the installtest build runs after the measure build and before the smoke build, each with its own build start', () => {
  const at = (needle) => script.indexOf(needle)
  assert.ok(at("Invoke-Build 'measure'") < at("Invoke-Build 'installtest'") && at("Invoke-Build 'installtest'") < at("Invoke-Build 'smoke'"))
  const between = script.slice(at("Invoke-Build 'measure'"), at("Invoke-Build 'installtest'"))
  assert.match(between, /\$script:BuildStart = Get-Date/)
})

test('the overlay is copied into config/ with the others', () => {
  assert.match(script, /'tauri\.smoke\.conf\.json', 'tauri\.installtest\.conf\.json'/)
})

test('the header lists the fourth build and its outputs', () => {
  const header = script.split('[CmdletBinding()]')[0]
  assert.match(header, /installtest/)
  assert.ok(header.includes('nsis\\release|measure|installtest\\'), 'the nsis outputs name installtest')
})
