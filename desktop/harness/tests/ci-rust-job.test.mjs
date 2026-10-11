// The shape of .github/workflows/ci.yml and its Rust job (0.3.1, test-infra; widened in v0.4, wave w2b, slice ci-widen).
// Born failing in 0.3.1: the workflow had one job and no Rust step. Born failing in v0.4: it ran on main and pull requests
// only, on a moving runner image, with no qa, offline end-to-end, ruff or trend job.
//
// The rules of the whole workflow are guards, each fed the broken state it must refuse (a tag where a SHA belongs, a write
// permission, a branch filter that drops release/**, a continue-on-error on a test step, a runner image that moves). They
// read the file as text, so the hosted runner needs no YAML library; the YAML parse itself runs where the lab's interpreter
// has PyYAML. The Rust job runs `cargo fmt --check` on windows-2025. Clippy, the unit tests and the MSVC build are NOT in
// this workflow: desktop-check.yml carries them (docs/desktop/ci.md says why and where).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW_FILE = path.join(TERMINAL, '.github', 'workflows', 'ci.yml')
const WORKFLOW = fs.readFileSync(WORKFLOW_FILE, 'utf8')
const DOC = fs.readFileSync(path.join(TERMINAL, 'docs', 'desktop', 'ci.md'), 'utf8')
const CRATE = path.join(TERMINAL, 'desktop', 'src-tauri')
const SHA = /^[0-9a-f]{40}$/
const WINDOWS_IMAGE = 'windows-2025'
/** Branch names a push must reach: the trunk, a release branch, the desktop and feature families and a wave branch. */
const SAMPLE_BRANCHES = ['main', 'release/0.3.3', 'release/0.4.0', 'desktop/shell', 'feat/a/b', 'v04/w2b-ci-msvc']
/** The one job that may swallow a failure, because it only reports (a trend, never a gate). */
const REPORT_ONLY_JOB = 'perf-trend'
/** The action whose step may swallow a failure: losing an upload must not fail a run that passed its tests. */
const UPLOAD_ACTION = 'actions/upload-artifact'

/** The lab's interpreter, when this machine has one with PyYAML (a hosted runner does not). */
function pythonWithYaml() {
  const lab = process.env.NQT_LAB ?? path.join(process.env.USERPROFILE ?? '', 'nq-lab')
  const py = path.join(lab, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(py)) return null
  const probe = spawnSync(py, ['-I', '-c', 'import yaml'], { encoding: 'utf8', windowsHide: true })
  return probe.status === 0 ? py : null
}

function parsed() {
  const py = pythonWithYaml()
  if (!py) return null
  const code = 'import json,sys,yaml\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))'
  const r = spawnSync(py, ['-I', '-c', code, WORKFLOW_FILE], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

function applyStepField(step, key, value) {
  if (key === 'name') step.name = value
  else if (key === 'uses') step.uses = value
  else if (key === 'id') step.id = value
  else if (key === 'if') step.if = value
  else if (key === 'shell') step.shell = value
  else if (key === 'continue-on-error') step.continueOnError = value
  else if (key === 'run') step.run = value
}

function applyJobField(job, key, value) {
  if (key === 'runs-on') job.runsOn = value
  else if (key === 'continue-on-error') job.continueOnError = value
  else if (key === 'permissions') job.permissions = true
  else if (key === 'timeout-minutes') job.timeout = Number(value)
}

/** The jobs of a workflow read by indentation: job keys at 2 spaces, job fields at 4, steps at 6 and their fields at 8. */
function jobsOf(text) {
  const jobs = {}
  let job = null
  let step = null
  let inJobs = false
  let inRun = false
  let runIndent = 0
  const openRun = () => { if (step && /^[|>][+-]?$/.test(step.run)) { inRun = true; runIndent = 0; step.run = '' } }
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inJobs = /^jobs:\s*$/.test(line); job = null; step = null; continue }
    if (!inJobs) continue
    const jobKey = /^  ([A-Za-z][\w-]*):\s*$/.exec(line)
    if (jobKey) { job = { key: jobKey[1], runsOn: '', continueOnError: null, permissions: false, timeout: NaN, steps: [] }; jobs[job.key] = job; step = null; inRun = false; continue }
    if (!job) continue
    const field = /^    ([\w-]+):\s*(.*)$/.exec(line)
    if (field) { inRun = false; step = null; applyJobField(job, field[1], field[2]); continue }
    const start = /^      - ([\w-]+):\s*(.*)$/.exec(line)
    if (start) {
      step = { name: '', uses: '', id: '', if: '', shell: '', continueOnError: null, run: '' }
      job.steps.push(step)
      inRun = false
      applyStepField(step, start[1], start[2])
      openRun()
      continue
    }
    const key = /^        ([\w-]+):\s*(.*)$/.exec(line)
    if (key && step) { inRun = false; applyStepField(step, key[1], key[2]); openRun(); continue }
    if (inRun && step && line.trim() !== '') {
      if (runIndent === 0) runIndent = /^ */.exec(line)[0].length
      if (/^ */.exec(line)[0].length >= runIndent) step.run += `${line.trim()}\n`
      else inRun = false
    }
  }
  return jobs
}

// ---- The guards. Each returns the list of ways a workflow text breaks the rule; empty when it keeps it. ----

/** Every `uses:` must name an action at a full 40-character commit SHA. A tag, a branch or a local path is refused. */
function pinViolations(text) {
  const out = []
  for (const m of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) {
    const [name, sha] = m[1].split('@')
    if (!SHA.test(sha ?? '')) out.push(`${name} is not pinned by a full commit SHA`)
  }
  return out
}

/** The token is read-only: the top-level block is exactly contents: read, no job has a permissions block, nothing says write. */
function permissionViolations(text) {
  const out = []
  const top = /^permissions:[ \t]*(\S*)[ \t]*\r?\n((?:[ \t]+\S.*\r?\n?)*)/m.exec(text)
  const entries = top ? top[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
  if (!top || top[1] !== '' || entries.length !== 1 || entries[0] !== 'contents: read') out.push(`the top-level permissions are not exactly "contents: read" (${top ? `${top[1]} ${entries.join(', ')}` : 'none'})`)
  for (const job of Object.values(jobsOf(text))) if (job.permissions) out.push(`job ${job.key} sets its own permissions`)
  if (/:\s*write\b|write-all/.test(text)) out.push('a write permission is named')
  return out
}

/** One glob of a branch filter against a branch name: * stays inside a path segment, ** crosses them. */
function branchMatches(glob, name) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${re}$`).test(name)
}

/** The `on:` block: a push reaches every sample branch, pull requests to main stay, and the workflow can be run by hand. */
function triggerViolations(text) {
  const out = []
  const on = /^on:\s*\r?\n((?:[ \t]+\S.*\r?\n|[ \t]*\r?\n)+)/m.exec(text)
  if (!on) return ['no on: block']
  const block = on[1]
  const push = /^  push:\s*\r?\n((?:    .*\r?\n?)*)/m.exec(block)
  if (!push) out.push('no push trigger')
  else {
    const filter = /^    branches:\s*\[(.*)\]\s*$/m.exec(push[1])
    const globs = filter ? filter[1].split(',').map((g) => g.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null
    if (globs) for (const b of SAMPLE_BRANCHES) if (!globs.some((g) => branchMatches(g, b))) out.push(`a push to ${b} does not run CI`)
  }
  if (!/^  pull_request:\s*\r?\n    branches:\s*\[\s*main\s*\]/m.test(block)) out.push('pull requests to main no longer run CI')
  if (!/^  workflow_dispatch:/m.test(block)) out.push('no workflow_dispatch trigger')
  return out
}

/** No test may swallow a failure: continue-on-error is allowed on an upload step and in the report-only job, and nowhere else. */
function swallowViolations(text) {
  const out = []
  for (const job of Object.values(jobsOf(text))) {
    if (job.continueOnError !== null && job.key !== REPORT_ONLY_JOB) out.push(`job ${job.key} has continue-on-error`)
    for (const step of job.steps) {
      const label = `${job.key} / ${step.name || step.uses}`
      if (step.continueOnError !== null && job.key !== REPORT_ONLY_JOB && !step.uses.startsWith(UPLOAD_ACTION)) out.push(`${label} has continue-on-error`)
      if (/\|\|\s*true\b/.test(step.run)) out.push(`${label} swallows an exit code with || true`)
    }
  }
  return out
}

/** Every Windows job runs on the pinned image, never the moving windows-latest label. */
function imageViolations(text) {
  const out = []
  for (const job of Object.values(jobsOf(text))) {
    if (/^windows-/.test(job.runsOn) && job.runsOn !== WINDOWS_IMAGE) out.push(`job ${job.key} runs on ${job.runsOn}, not ${WINDOWS_IMAGE}`)
  }
  return out
}

/** The workflow text with one exact string replaced; the replacement must have changed something or the mutation is vacuous. */
function mutate(text, from, to) {
  assert.ok(text.includes(from), `the workflow holds ${JSON.stringify(from)}, so the mutation is not vacuous`)
  return text.replace(from, to)
}

// ---- The workflow as it is. ----

test('ci.yml parses as YAML, keeps the read-only token, and has a Rust job on the pinned Windows image', (t) => {
  const doc = parsed()
  if (!doc) return t.skip('no interpreter with PyYAML here')
  assert.deepEqual(doc.permissions, { contents: 'read' })
  assert.ok(doc.jobs.windows, 'the web job is still there')
  const rust = doc.jobs.rust
  assert.ok(rust, 'a job named rust')
  assert.equal(rust['runs-on'], WINDOWS_IMAGE)
  assert.equal(rust.permissions, undefined, 'no job widens the token')
  assert.ok(Number.isInteger(rust['timeout-minutes']) && rust['timeout-minutes'] <= 30)
  for (const job of Object.values(doc.jobs)) assert.equal(job.permissions, undefined)
  const on = doc.on ?? doc.true // PyYAML reads the key `on` as the boolean true
  assert.ok(on && 'workflow_dispatch' in on, 'the workflow can be run by hand')
  assert.deepEqual(on.pull_request.branches, ['main'])
  assert.deepEqual(on.push.branches, ['**'])
})

test('every action of every job is pinned by its full commit SHA, and the workflow reads no secret', () => {
  assert.ok([...WORKFLOW.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].length >= 10, 'the workflow uses actions')
  assert.deepEqual(pinViolations(WORKFLOW), [])
  assert.doesNotMatch(WORKFLOW, /secrets\./)
  assert.doesNotMatch(WORKFLOW, /GITHUB_TOKEN|id-token|write-all/)
})

test('the token is read-only and no job widens it', () => {
  assert.deepEqual(permissionViolations(WORKFLOW), [])
})

test('a push to any branch runs CI, pull requests to main still do, and the workflow can be run by hand', () => {
  assert.deepEqual(triggerViolations(WORKFLOW), [])
})

test('only an upload step and the report-only trend job may swallow a failure; no test does', () => {
  assert.deepEqual(swallowViolations(WORKFLOW), [])
  const trend = jobsOf(WORKFLOW)[REPORT_ONLY_JOB]
  assert.ok(trend, `a job named ${REPORT_ONLY_JOB}`)
  assert.equal(trend.continueOnError, 'true', 'the trend job can never fail the run')
})

test('every Windows job runs on windows-2025, the image the migration plan names', () => {
  assert.deepEqual(imageViolations(WORKFLOW), [])
  assert.doesNotMatch(WORKFLOW, /windows-latest/)
  const windowsJobs = Object.values(jobsOf(WORKFLOW)).filter((j) => /^windows-/.test(j.runsOn))
  assert.ok(windowsJobs.length >= 3, 'the web, qa and rust jobs run on Windows')
})

test('every job has a timeout and a concurrency group cancels the run a newer push supersedes', () => {
  for (const job of Object.values(jobsOf(WORKFLOW))) assert.ok(Number.isInteger(job.timeout) && job.timeout <= 30, `${job.key} has a timeout of at most 30 minutes`)
  assert.match(WORKFLOW, /concurrency:\s*\r?\n\s+group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*\r?\n\s+cancel-in-progress: true/)
})

// ---- Born failing: each guard is fed the broken state. ----

test('born failing: an action pinned by a tag, a branch or a short SHA fails the pin guard', () => {
  const pinned = /actions\/checkout@[0-9a-f]{40}/.exec(WORKFLOW)[0]
  assert.deepEqual(pinViolations(WORKFLOW), [])
  assert.ok(pinViolations(mutate(WORKFLOW, pinned, 'actions/checkout@v7')).length > 0, 'a tag')
  assert.ok(pinViolations(mutate(WORKFLOW, pinned, 'actions/checkout@main')).length > 0, 'a branch')
  assert.ok(pinViolations(mutate(WORKFLOW, pinned, 'actions/checkout@3d3c42e')).length > 0, 'a short SHA')
  assert.ok(pinViolations(`${WORKFLOW}\n      - uses: ./local-action\n`).length > 0, 'a local action')
})

test('born failing: a write permission, a widened token or a job permissions block fails the permission guard', () => {
  assert.deepEqual(permissionViolations(WORKFLOW), [])
  assert.ok(permissionViolations(mutate(WORKFLOW, 'contents: read', 'contents: write')).length > 0, 'contents: write')
  assert.ok(permissionViolations(mutate(WORKFLOW, 'contents: read', 'contents: read\n  id-token: write')).length > 0, 'a second permission')
  assert.ok(permissionViolations(mutate(WORKFLOW, '    timeout-minutes: 15', '    timeout-minutes: 15\n    permissions:\n      contents: read')).length > 0, 'a job block')
  assert.ok(permissionViolations(mutate(WORKFLOW, 'permissions:\n  contents: read', 'permissions: write-all')).length > 0, 'write-all')
})

test('born failing: a branch filter that drops release/**, or any trigger that goes, fails the trigger guard', () => {
  assert.deepEqual(triggerViolations(WORKFLOW), [])
  const pushLine = /^    branches: \[.*\]$/m.exec(WORKFLOW)[0]
  assert.ok(triggerViolations(mutate(WORKFLOW, pushLine, '    branches: [main]')).some((v) => v.includes('release/0.3.3')), 'main alone')
  assert.ok(triggerViolations(mutate(WORKFLOW, pushLine, "    branches: [main, 'desktop/**', 'feat/**']")).some((v) => v.includes('release/0.4.0')), 'release/** left out')
  assert.ok(triggerViolations(mutate(WORKFLOW, pushLine, "    branches: ['*']")).some((v) => v.includes('release/0.3.3')), 'a single star stops at the slash')
  assert.ok(triggerViolations(mutate(WORKFLOW, '  workflow_dispatch:', '  schedule:')).some((v) => v.includes('workflow_dispatch')), 'no manual run')
  assert.ok(triggerViolations(mutate(WORKFLOW, '  pull_request:\n    branches: [main]', '  pull_request:\n    branches: [release]')).some((v) => v.includes('pull requests')), 'pull requests')
})

test('born failing: a continue-on-error on a test step, on a job other than the trend job, or an || true fails the swallow guard', () => {
  assert.deepEqual(swallowViolations(WORKFLOW), [])
  const vitest = '      - name: Vitest\n'
  assert.ok(swallowViolations(mutate(WORKFLOW, vitest, `${vitest}        continue-on-error: true\n`)).some((v) => v.includes('Vitest')), 'the vitest step')
  const qa = '\n  qa:\n'
  assert.ok(swallowViolations(mutate(WORKFLOW, qa, `${qa}    continue-on-error: true\n`)).some((v) => v.includes('job qa')), 'the qa job')
  assert.ok(swallowViolations(mutate(WORKFLOW, 'run: pnpm build\n', 'run: pnpm build || true\n')).some((v) => v.includes('|| true')), 'an exit code')
  assert.ok(swallowViolations(mutate(WORKFLOW, '      - name: Web build\n', '      - name: Web build\n        continue-on-error: true\n')).length > 0, 'the build step')
})

test('born failing: a Windows job on windows-latest fails the image guard', () => {
  assert.deepEqual(imageViolations(WORKFLOW), [])
  assert.ok(imageViolations(mutate(WORKFLOW, `runs-on: ${WINDOWS_IMAGE}`, 'runs-on: windows-latest')).length > 0)
  assert.ok(imageViolations(mutate(WORKFLOW, `runs-on: ${WINDOWS_IMAGE}`, 'runs-on: windows-2022')).length > 0)
})

// ---- The Rust job. ----

/** The text of the rust job: from its key to the next job key, or the end of the file. */
const rustJob = () => {
  const at = WORKFLOW.indexOf('\n  rust:')
  assert.ok(at > 0, 'a job named rust')
  const rest = WORKFLOW.slice(at + 1)
  const next = /\n  [A-Za-z][\w-]*:\s*\r?\n/.exec(rest.slice(1))
  return next ? rest.slice(0, next.index + 1) : rest
}

test('the Rust job installs the pinned toolchain from rust-toolchain.toml and runs cargo fmt --check in the crate', () => {
  const job = rustJob()
  assert.match(job, new RegExp(`runs-on: ${WINDOWS_IMAGE}`))
  assert.match(job, /path: terminal\b/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /working-directory: terminal\/desktop\/src-tauri/)
  assert.match(job, /rust-toolchain\.toml/, 'the channel is read from the pin, not repeated')
  assert.match(job, /rustup toolchain install \$channel .*--component rustfmt/)
  assert.match(job, /cargo fmt --check/)
  assert.match(job, /LASTEXITCODE -ne 0/, 'a failed install stops the job with its own message')
})

test('clippy, the unit tests and the build are not in ci.yml, and the doc says where they run and why they were late', () => {
  assert.doesNotMatch(WORKFLOW, /cargo (clippy|test|build|llvm-cov|deny|audit)/)
  assert.match(DOC, /## The Rust job/)
  assert.match(DOC, /cargo fmt --check/)
  assert.match(DOC, /clippy -D warnings/)
  assert.match(DOC, /desktop-check\.yml/, 'the doc names the workflow that carries them')
  assert.match(DOC, /never (been )?built on the (hosted )?MSVC/i, 'the reason they were late is written down')
  assert.match(DOC, /REL-07/)
})

test('the doc no longer says the workflow has never run on a hosted runner, and names every job', () => {
  assert.doesNotMatch(DOC, /has not yet run on a hosted runner/)
  for (const job of Object.keys(jobsOf(WORKFLOW))) assert.ok(DOC.includes(`\`${job}\``), `docs/desktop/ci.md names the job ${job}`)
  assert.match(DOC, /windows-2025/)
  assert.doesNotMatch(DOC, /on `windows-latest`/)
})

test('cargo fmt --check passes on the crate with the pinned toolchain (the local half of the CI step)', (t) => {
  const cargo = 'D:\\dev\\cargo\\bin\\cargo.exe'
  if (!fs.existsSync(cargo)) return t.skip('no toolchain under D:\\dev here')
  const env = { ...process.env, RUSTUP_HOME: 'D:\\dev\\rustup', CARGO_HOME: 'D:\\dev\\cargo', PATH: `D:\\dev\\cargo\\bin;${process.env.PATH}` }
  const r = spawnSync(cargo, ['fmt', '--check'], { cwd: CRATE, env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 2000))
})
