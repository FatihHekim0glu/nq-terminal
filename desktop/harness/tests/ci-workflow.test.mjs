// The CI workflow runs every release-script test that needs no private lab (born failing: ci.yml ran the node tests by glob and two
// of the PowerShell self-tests, but left out desktop/scripts/tests/install-test.tests.ps1 and upgrade-owner.tests.ps1, the 0.1.2
// release-script tests). The workflow is read as text; nothing here runs it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW = fs.readFileSync(path.join(TERMINAL, '.github', 'workflows', 'ci.yml'), 'utf8')
const SCRIPT_TEST_DIRS = ['desktop/scripts/tests', 'scripts/tests']
/** Release-script tests the hosted runner cannot run, each with its reason. Empty: every one runs. */
const NEEDS_PRIVATE_LAB = {}

/** The steps of the one job: name, shell, working directory and the run text, read without a YAML library. */
function steps(text) {
  const out = []
  let current = null
  let inRun = false
  let runIndent = 0
  for (const line of text.split(/\r?\n/)) {
    const start = /^      - (name|uses): (.*)$/.exec(line)
    if (start) { current = { name: start[1] === 'name' ? start[2] : '', uses: start[1] === 'uses' ? start[2] : '', shell: null, workingDirectory: null, run: '' }; out.push(current); inRun = false; continue }
    if (!current) continue
    const key = /^        (name|uses|shell|working-directory|run): ?(.*)$/.exec(line)
    if (key) {
      inRun = false
      if (key[1] === 'name') current.name = key[2]
      else if (key[1] === 'shell') current.shell = key[2]
      else if (key[1] === 'working-directory') current.workingDirectory = key[2]
      else if (key[1] === 'run') {
        if (/^[|>][+-]?$/.test(key[2])) { inRun = true; runIndent = 0 } else current.run = key[2]
      }
      continue
    }
    if (inRun && line.trim() !== '') {
      if (runIndent === 0) runIndent = /^ */.exec(line)[0].length
      if (/^ */.exec(line)[0].length >= runIndent) current.run += `${line.trim()}\n`
      else inRun = false
    }
  }
  return out
}

const scriptTests = (suffix) => SCRIPT_TEST_DIRS.flatMap((dir) => fs.readdirSync(path.join(TERMINAL, dir)).filter((f) => f.endsWith(suffix)).map((f) => `${dir}/${f}`))
const normal = (s) => s.replace(/[\\]/g, '/')

test('the node release-script tests run by glob, from cmd so Windows PowerShell keeps its own module path', () => {
  const step = steps(WORKFLOW).find((s) => normal(s.run).includes('node --test desktop/scripts/tests/*.test.mjs'))
  assert.ok(step, 'a step runs desktop/scripts/tests/*.test.mjs')
  assert.equal(step.shell, 'cmd')
  assert.ok(scriptTests('.test.mjs').length >= 10, 'the glob has the tests to run')
  assert.doesNotMatch(step.run, /--exclude|--test-name-pattern|--test-skip-pattern/, 'no node test is skipped by name')
})

test('every PowerShell release-script test file is run by a step that fails the job on a non-zero exit', () => {
  const found = scriptTests('.tests.ps1')
  assert.ok(found.length >= 3, `the test files exist (${found.join(', ')})`)
  for (const file of found) {
    if (NEEDS_PRIVATE_LAB[file]) continue
    const step = steps(WORKFLOW).find((s) => normal(s.run).includes(file))
    assert.ok(step, `${file} is run by a step of ci.yml`)
    assert.equal(step.shell, 'powershell', `${file} runs under Windows PowerShell 5.1, the shell the scripts are written for`)
    const line = step.run.split('\n').find((l) => normal(l).includes(file)) ?? ''
    assert.match(line, /powershell -NoProfile -ExecutionPolicy Bypass -File/, `${file} is started as the docs say`)
    const after = step.run.slice(step.run.indexOf(line) + line.length)
    assert.match(after.split('\n').slice(0, 2).join('\n'), /LASTEXITCODE -ne 0\) \{ throw/, `${file}'s exit code is checked`)
  }
})

test('the install-test self-test still runs, and every excluded file names a reason', () => {
  assert.ok(steps(WORKFLOW).some((s) => normal(s.run).includes('desktop/scripts/install-test.ps1 -SelfTest')))
  for (const [file, reason] of Object.entries(NEEDS_PRIVATE_LAB)) {
    assert.ok(fs.existsSync(path.join(TERMINAL, file)), `${file} exists`)
    assert.ok(reason.length > 10, `${file} says why`)
  }
})
