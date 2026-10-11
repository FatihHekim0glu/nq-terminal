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

const CHECKS_DIR = path.join(DOCS, 'checks')
// The owner templates this refresh owns: the 2026-10-03 and 2026-10-11 templates and the index.
const OWNED_TEMPLATE = /^(2026-10-03_.+|2026-10-11_.+|README)\.md$/
// A release commit (full or short hash), a 64-character installer hash, or the 0.1.0 release by version.
const STALE_RELEASE_PATTERNS = [/8122c877/, /\b[0-9a-f]{40}\b/, /\b[0-9a-f]{64}\b/, /(?<![\d.])0\.1\.0(?![\d.])/]

test('no owner check template names a release commit, an installer hash or the 0.1.0 release', () => {
  const templates = fs.readdirSync(CHECKS_DIR).filter((name) => OWNED_TEMPLATE.test(name))
  const offenders = templates.flatMap((name) => {
    const text = read(path.join('checks', name))
    return STALE_RELEASE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => `${name} matches ${pattern}`)
  })
  assert.deepEqual(offenders, [])
  assert.equal(templates.length, 18, 'the owner templates are the 13 of 2026-10-03, the four of 2026-10-11 and the index')
})

test('every session step in session_order.json names an existing owner template', () => {
  const order = JSON.parse(read(path.join('checks', 'session_order.json')))
  assert.ok(Array.isArray(order.steps) && order.steps.length > 0, 'session_order.json has no steps')
  for (const step of order.steps) {
    assert.equal(path.basename(step.template), step.template, `${step.id}: template must be a bare file name`)
    assert.ok(fs.existsSync(path.join(CHECKS_DIR, step.template)), `${step.id}: missing template ${step.template}`)
  }
})
