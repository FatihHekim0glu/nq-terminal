// The CI workflow runs every release-script test that needs no private lab (born failing: ci.yml ran the node tests by glob and two
// of the PowerShell self-tests, but left out desktop/scripts/tests/install-test.tests.ps1 and upgrade-owner.tests.ps1, the 0.1.2
// release-script tests). v0.4 (wave w2b, slice ci-widen) adds the qa, offline-e2e, ruff and perf-trend jobs and the coverage step:
// born failing, none of them existed. The workflow is read as text; nothing here runs it. The rules of the whole file (pins,
// permissions, triggers, continue-on-error, the runner image) are guarded in ci-rust-job.test.mjs.
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
/** The fatal-error rules of ruff (syntax errors, undefined names, bad comparisons): the set that is clean on backend today. */
const RUFF_RULES = 'E9,F63,F7,F82'

/** The steps of every job, in file order: the job, name, id, condition, shell, working directory, run text and continue-on-error, read without a YAML library. */
function steps(text) {
  const out = []
  let current = null
  let job = ''
  let inRun = false
  let runIndent = 0
  for (const line of text.split(/\r?\n/)) {
    const jobKey = /^  ([A-Za-z][\w-]*):\s*$/.exec(line)
    if (jobKey) { job = jobKey[1]; current = null; inRun = false; continue }
    const start = /^      - (name|uses): (.*)$/.exec(line)
    if (start) { current = { job, name: start[1] === 'name' ? start[2] : '', uses: start[1] === 'uses' ? start[2] : '', id: '', if: '', shell: null, workingDirectory: null, continueOnError: null, run: '' }; out.push(current); inRun = false; continue }
    if (!current) continue
    const key = /^        (name|uses|id|if|shell|working-directory|continue-on-error|run): ?(.*)$/.exec(line)
    if (key) {
      inRun = false
      if (key[1] === 'name') current.name = key[2]
      else if (key[1] === 'uses') current.uses = key[2]
      else if (key[1] === 'id') current.id = key[2]
      else if (key[1] === 'if') current.if = key[2]
      else if (key[1] === 'shell') current.shell = key[2]
      else if (key[1] === 'working-directory') current.workingDirectory = key[2]
      else if (key[1] === 'continue-on-error') current.continueOnError = key[2]
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

/** The header lines of one job (runs-on and the like), from its key to its first step. */
function jobHeader(text, key) {
  const at = text.indexOf(`\n  ${key}:\n`)
  if (at < 0) return ''
  const rest = text.slice(at + 1)
  const stepsAt = rest.indexOf('\n    steps:')
  return stepsAt < 0 ? rest : rest.slice(0, stepsAt)
}

const scriptTests = (suffix) => SCRIPT_TEST_DIRS.flatMap((dir) => fs.readdirSync(path.join(TERMINAL, dir)).filter((f) => f.endsWith(suffix)).map((f) => `${dir}/${f}`))
const normal = (s) => s.replace(/[\\]/g, '/')
const inJob = (text, job) => steps(text).filter((s) => s.job === job)
const SHA_PINNED = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}\b/

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

// ---- The jobs added in v0.4. ----

test('the workflow has the web, qa, offline-e2e, ruff, perf-trend and rust jobs, each on a runner image it names', () => {
  const images = { windows: 'windows-2025', qa: 'windows-2025', 'offline-e2e': 'ubuntu-latest', ruff: 'ubuntu-latest', 'perf-trend': 'ubuntu-latest', rust: 'windows-2025' }
  for (const [key, image] of Object.entries(images)) {
    assert.match(jobHeader(WORKFLOW, key), new RegExp(`runs-on: ${image}\\b`), `job ${key} runs on ${image}`)
    assert.ok(inJob(WORKFLOW, key).length >= 2, `job ${key} has steps`)
  }
})

test('every job checks the tree out into a folder named terminal without keeping the token', () => {
  for (const key of ['windows', 'qa', 'offline-e2e', 'ruff', 'perf-trend', 'rust']) {
    const checkout = inJob(WORKFLOW, key).find((s) => s.uses.startsWith('actions/checkout@'))
    assert.ok(checkout, `job ${key} checks out`)
    assert.match(jobBody(WORKFLOW, key), /path: terminal\b[\s\S]*persist-credentials: false/, `job ${key} keeps the folder name and drops the token`)
  }
})

/** The text of one job, from its key to the next job key. */
function jobBody(text, key) {
  const at = text.indexOf(`\n  ${key}:\n`)
  assert.ok(at >= 0, `a job named ${key}`)
  const rest = text.slice(at + 1)
  const next = /\n  [A-Za-z][\w-]*:\s*\r?\n/.exec(rest.slice(1))
  return next ? rest.slice(0, next.index + 1) : rest
}

test('qa runs the reference tests with uv from the lockfile, in the qa project of the terminal folder', () => {
  const all = inJob(WORKFLOW, 'qa')
  const run = all.find((s) => /uv run --frozen pytest\b/.test(s.run))
  assert.ok(run, 'a step runs uv run --frozen pytest')
  assert.equal(run.workingDirectory, 'terminal/qa')
  assert.doesNotMatch(run.run, /--offline|--no-sync/, 'the install is real on a hosted runner')
  const setup = all.find((s) => s.uses.startsWith('astral-sh/setup-uv@'))
  assert.ok(setup, 'uv is set up by a pinned action')
  assert.match(jobBody(WORKFLOW, 'qa'), /version: '?0\.10\.\d+'?/, 'the uv version is pinned (uv_build>=0.10,<0.11 in qa/pyproject.toml)')
  assert.match(jobBody(WORKFLOW, 'qa'), /python-version: '?3\.12'?/, 'qa/pyproject.toml wants Python 3.12')
})

/** The ways the offline end-to-end job breaks its contract: functional projects only, browsers cached and installed. */
function offlineViolations(text) {
  const out = []
  const all = inJob(text, 'offline-e2e')
  const run = all.find((s) => /pnpm e2e:offline(\s|$)/.test(s.run))
  if (!run) return ['no step runs pnpm e2e:offline']
  if (/e2e:offline:perf/.test(run.run)) out.push('the functional run includes the perf project')
  if (/--project/.test(run.run)) out.push('the run picks projects by hand instead of the script')
  if (!/--update-snapshots=all/.test(run.run)) out.push('baselines are git-ignored, so a run without --update-snapshots=all fails every screenshot')
  if (run.workingDirectory !== 'terminal/web') out.push('the run is not in terminal/web')
  if (run.continueOnError !== null) out.push('the run swallows its failure')
  const cache = all.find((s) => s.uses.startsWith('actions/cache@'))
  if (!cache || !/ms-playwright/.test(jobBody(text, 'offline-e2e'))) out.push('the Playwright browsers are not cached')
  const install = all.find((s) => /playwright install\b.*\bchromium\b/.test(s.run))
  if (!install) out.push('no step installs Chromium')
  else if (!/--with-deps/.test(install.run)) out.push('Chromium is installed without its system libraries')
  if (all.indexOf(install) > all.indexOf(run)) out.push('Chromium is installed after the run')
  return out
}

test('offline-e2e runs the functional offline projects on Linux with the browsers cached and installed first', () => {
  assert.deepEqual(offlineViolations(WORKFLOW), [])
  assert.doesNotMatch(inJob(WORKFLOW, 'offline-e2e').map((s) => s.run).join('\n'), /e2e:offline:perf|e2e:offline:baseline/)
})

/** The ways ruff's job breaks its contract: the pinned ruff, the backend, the committed config and no fixes. */
function ruffViolations(text) {
  const run = inJob(text, 'ruff').find((s) => /\bruff@/.test(s.run))
  if (!run) return ['no step runs a pinned ruff']
  const out = []
  if (!/\bruff@\d+\.\d+\.\d+ check\b/.test(run.run)) out.push('ruff is not pinned to an exact version')
  if (!/ check .*\bbackend\s*$/m.test(run.run)) out.push('ruff does not check backend')
  if (!new RegExp(`--select ${RUFF_RULES}\\b`).test(run.run)) out.push('the rule set is not the fatal-error set that is clean today')
  if (/--fix|--isolated|--config|--no-config|--ignore|--exit-zero|--extend-exclude/.test(run.run)) out.push('ruff is changed, loosened or made to pass')
  if (run.workingDirectory !== 'terminal') out.push('ruff does not run from the terminal folder, so backend/ruff.toml is not the config it finds')
  return out
}

test('ruff checks backend with the committed backend/ruff.toml, a pinned version, the clean rule set and no fixes', () => {
  assert.deepEqual(ruffViolations(WORKFLOW), [])
  assert.ok(fs.existsSync(path.join(TERMINAL, 'backend', 'ruff.toml')), 'the config ruff finds exists and is not changed here')
})

/** The ways the trend job breaks its contract: it measures, it warns when a budget goes, and it can never fail the run. */
function trendViolations(text) {
  const out = []
  if (!/^  perf-trend:\s*\r?\n(?:    .*\r?\n)*?    continue-on-error: true\s*$/m.test(text)) out.push('the job is not continue-on-error')
  const all = inJob(text, 'perf-trend')
  const perf = all.find((s) => /pnpm e2e:offline:perf\b/.test(s.run))
  if (!perf) return [...out, 'no step runs pnpm e2e:offline:perf']
  if (!perf.id) out.push('the perf step has no id for the warning step to read')
  if (perf.continueOnError !== 'true') out.push('a failed budget would stop the job before it reports')
  if (!/--workers=1|e2e:offline:perf\b(?!.*--workers=[2-9])/.test(perf.run)) out.push('the budgets must run on one worker')
  const warn = all.find((s) => /::warning\b/.test(s.run))
  if (!warn) out.push('no step writes a warning annotation')
  else if (!new RegExp(`steps\\.${perf.id}\\.outcome == 'failure'`).test(warn.if)) out.push('the warning does not wait for the perf step to fail')
  if (all.some((s) => /::error\b|exit 1/.test(s.run))) out.push('a step of the trend job can raise an error')
  const missed = all.find((s) => /::warning\b/.test(s.run) && new RegExp(`steps\\.${perf.id}\\.outcome == 'failure'`).test(s.if))
  if (missed && !/perf\.log/.test(missed.run)) out.push('the budget warning does not check the log, so a setup or timeout failure is blamed on a budget')
  const setup = all.find((s) => /::warning\b/.test(s.run) && /\bfailure\(\)/.test(s.if))
  if (!setup) out.push('no warning step runs when a setup step failed (failure()), so a broken trend is silent')
  else if (!/did not run/i.test(setup.run)) out.push('the setup warning does not say the trend did not run')
  const summary = all.find((s) => /GITHUB_STEP_SUMMARY/.test(s.run))
  if (!summary) out.push('no step writes the summary')
  else {
    if (!/-f\b[^\n]*perf\.log/.test(summary.run)) out.push('the summary does not handle a missing perf.log')
    if (!/no perf lines/i.test(summary.run)) out.push('the summary does not say when no perf lines were produced')
  }
  return out
}

test('perf-trend runs the offline performance budgets, warns when one is exceeded and never fails the run', () => {
  assert.deepEqual(trendViolations(WORKFLOW), [])
  const perf = inJob(WORKFLOW, 'perf-trend').find((s) => /pnpm e2e:offline:perf\b/.test(s.run))
  assert.equal(perf.shell, 'bash', 'bash with pipefail, so tee does not hide the exit code')
  assert.match(perf.run, /tee\b/, 'the numbers are kept for the summary')
})

/** The ways the coverage steps break their contract (wave w2a adds the pnpm script; until then the step says so and passes). */
function coverageViolations(text) {
  const out = []
  const all = inJob(text, 'windows')
  const names = all.map((s) => s.name)
  const vitest = all.find((s) => s.name === 'Vitest')
  const cov = all.find((s) => /pnpm test:coverage\b/.test(s.run))
  if (!vitest || !cov) return ['no coverage step after vitest']
  if (names.indexOf(cov.name) < names.indexOf(vitest.name) || names.indexOf(cov.name) > names.indexOf('Web build')) out.push('the coverage step is not between vitest and the build')
  if (!/PSObject\.Properties\.Name -contains 'test:coverage'/.test(cov.run)) out.push('the step does not check that the test:coverage script exists')
  if (!/LASTEXITCODE -ne 0\) \{ throw/.test(cov.run)) out.push('the coverage run does not fail the job on a non-zero exit')
  if (cov.continueOnError !== null) out.push('the coverage run swallows its failure')
  if (!cov.id) out.push('the coverage step has no id')
  for (const exclusion of [...vitest.run.matchAll(/--exclude (\S+)/g)].map((m) => m[1])) if (!cov.run.includes(`--exclude ${exclusion}`)) out.push(`the coverage run does not leave out ${exclusion}`)
  if (!cov.run.includes('--testNamePattern "^(?!the banner copy matches the Python constant)"')) out.push('the coverage run does not leave out the banner copy test')
  const upload = all.find((s) => s.uses.startsWith('actions/upload-artifact@') && /coverage/.test(s.name))
  if (!upload) return [...out, 'no step uploads the coverage summary']
  if (upload.continueOnError !== 'true') out.push('a failed upload would fail a run that passed its tests')
  if (!new RegExp(`steps\\.${cov.id}\\.outputs\\.ran == 'true'`).test(upload.if)) out.push('the upload runs when no coverage was taken')
  if (!/coverage-summary\.json/.test(jobBody(text, 'windows'))) out.push('the upload does not name coverage-summary.json')
  return out
}

test('the web job takes a coverage figure after vitest when the script exists and uploads its summary', () => {
  assert.deepEqual(coverageViolations(WORKFLOW), [])
  assert.match(jobBody(WORKFLOW, 'windows'), /::notice\b/, 'a missing script is said out loud, not skipped silently')
})

test('every action added in v0.4 is pinned by a full SHA with its release in a comment', () => {
  for (const key of ['qa', 'offline-e2e', 'ruff', 'perf-trend']) {
    const used = inJob(WORKFLOW, key).filter((s) => s.uses)
    assert.ok(used.length >= 2, `job ${key} uses actions`)
    for (const step of used) {
      assert.match(step.uses, SHA_PINNED, `${key}: ${step.uses}`)
      assert.match(step.uses, /# v\d+\.\d+\.\d+$/, `${key}: ${step.uses} names its release`)
    }
  }
})

// ---- Born failing: each job guard is fed the broken state. ----

const mutate = (text, from, to) => {
  assert.ok(text.includes(from), `the workflow holds ${JSON.stringify(from)}, so the mutation is not vacuous`)
  return text.replace(from, to)
}

test('born failing: an offline run that includes the perf project, skips the browser install or the cache is refused', () => {
  const runLine = /^ {8}run: pnpm e2e:offline .*$/m.exec(WORKFLOW)[0]
  assert.ok(offlineViolations(mutate(WORKFLOW, runLine, '        run: pnpm e2e:offline:perf')).length > 0, 'perf in the gate')
  assert.ok(offlineViolations(mutate(WORKFLOW, runLine, '        run: pnpm e2e:offline --workers=2')).some((v) => v.includes('update-snapshots')), 'missing baselines')
  assert.ok(offlineViolations(mutate(WORKFLOW, 'playwright install --with-deps chromium', 'playwright --version')).some((v) => v.includes('Chromium')), 'no install')
  assert.ok(offlineViolations(mutate(WORKFLOW, '~/.cache/ms-playwright', '~/.cache/nothing')).some((v) => v.includes('cached')), 'no cache')
})

test('born failing: a ruff check that is unpinned, fixes files, loosens the config or skips the backend is refused', () => {
  const runLine = /^ {8}run: uvx ruff@.*$/m.exec(WORKFLOW)[0]
  assert.ok(ruffViolations(mutate(WORKFLOW, runLine, '        run: uvx ruff check backend')).some((v) => v.includes('pinned')), 'unpinned')
  assert.ok(ruffViolations(mutate(WORKFLOW, runLine, `${runLine} --fix`)).some((v) => v.includes('changed')), 'fixes')
  assert.ok(ruffViolations(mutate(WORKFLOW, runLine, `${runLine} --exit-zero`)).some((v) => v.includes('changed')), 'exit zero')
  assert.ok(ruffViolations(mutate(WORKFLOW, runLine, runLine.replace(/ backend$/, ' web'))).some((v) => v.includes('backend')), 'wrong folder')
})

test('born failing: a trend job that can fail the run, or fails without a warning, is refused', () => {
  const withoutJobFlag = WORKFLOW.replace(/(  perf-trend:\n(?: {4}.*\n)*?) {4}continue-on-error: true\n/, '$1')
  assert.notEqual(withoutJobFlag, WORKFLOW, 'the trend job carries continue-on-error')
  assert.ok(trendViolations(withoutJobFlag).some((v) => v.includes('not continue-on-error')), 'job flag off')
  const withoutPerfFlag = WORKFLOW.replace(/(id: perf\n)( {8}continue-on-error: true\n)/, '$1')
  assert.notEqual(withoutPerfFlag, WORKFLOW, 'the perf step carries continue-on-error')
  assert.ok(trendViolations(withoutPerfFlag).some((v) => v.includes('stop the job')), 'step flag off')
  assert.ok(trendViolations(mutate(WORKFLOW, '::warning', '::notice').replaceAll('::warning', '::notice')).some((v) => v.includes('warning')), 'no annotation')
  assert.ok(trendViolations(mutate(WORKFLOW, 'run: pnpm e2e:offline:perf', 'run: pnpm e2e:offline:perf --workers=4')).some((v) => v.includes('one worker')), 'many workers')
  const silentSetup = WORKFLOW.replace(/(Warn when the trend did not run\n {8}if: )\$\{\{ failure\(\) \}\}/, '$1${{ always() }}')
  assert.notEqual(silentSetup, WORKFLOW, 'the setup warning waits on failure()')
  assert.ok(trendViolations(silentSetup).some((v) => v.includes('setup step failed')), 'silent setup failure')
  assert.ok(trendViolations(mutate(WORKFLOW, 'no perf lines were produced', 'done')).some((v) => v.includes('no perf lines')), 'empty summary block')
  assert.ok(trendViolations(mutate(WORKFLOW, '[ -f "$RUNNER_TEMP/perf.log" ]', 'true').replaceAll('[ -f "$RUNNER_TEMP/perf.log" ]', 'true')).some((v) => v.includes('missing perf.log')), 'missing log')
})

test('born failing: a coverage step that fails on a missing script, swallows a failure or uploads nothing is refused', () => {
  assert.ok(coverageViolations(mutate(WORKFLOW, "PSObject.Properties.Name -contains 'test:coverage'", "PSObject.Properties.Name -contains 'test'")).some((v) => v.includes('exists')), 'no script check')
  assert.ok(coverageViolations(mutate(WORKFLOW, '        id: coverage\n', '        id: coverage\n        continue-on-error: true\n')).some((v) => v.includes('swallows')), 'swallowed')
  assert.ok(coverageViolations(mutate(WORKFLOW, "steps.coverage.outputs.ran == 'true'", 'always()')).some((v) => v.includes('no coverage was taken')), 'upload without a figure')
  assert.ok(coverageViolations(mutate(WORKFLOW, '        continue-on-error: true\n        uses: actions/upload-artifact', '        uses: actions/upload-artifact')).some((v) => v.includes('upload')), 'upload fails the run')
  assert.ok(coverageViolations(mutate(WORKFLOW, '--exclude scripts/start/startPs1.test.ts', '--exclude nothing.test.ts')).length > 0, 'the vitest exclusion is not repeated')
})
