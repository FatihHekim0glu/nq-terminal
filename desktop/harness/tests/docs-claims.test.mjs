// Born-failing checks that the owner check does not promise a lab precheck the harness lacks (run: node --test tests).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'desktop')
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8')

test('the pending-measurements check says the harness checks the lab itself, as lab-guard.mjs does', () => {
  const text = read('checks/2026-10-03_pending-measurements.md')
  assert.doesNotMatch(text, /harness does not check any of this/i)
  assert.doesNotMatch(text, /preconditions below are manual/i)
  assert.match(text, /harness checks the lab itself/i)
  assert.match(text, /pending record/i)
})

test('no tracked G2 or check document points to a precheck script that is not in the repository', () => {
  for (const rel of ['g2_windows/results.md', 'checks/2026-10-03_pending-measurements.md']) {
    assert.doesNotMatch(read(rel), /precheck\.ps1/, rel)
  }
})
