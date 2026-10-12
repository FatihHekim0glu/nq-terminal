// The shell's MSVC check workflow, .github/workflows/desktop-check.yml (v0.4, wave w2b, slice desktop-check; 04 D4.1 and
// D4.6; REL-07's first half; grade G-03). Born failing: the workflow did not exist, and build.rs linked the combined
// manifest into the integration tests on the GNU host only.
//
// Each rule is a checker over the workflow text that returns its problems, so every guard is also fed a planted broken
// copy and must catch it: a missing feature set, a skip without a reason, a coverage step that can fail the run. The
// workflow is read as text, so the hosted runner needs no YAML library; the YAML parse and actionlint run where this
// PC has them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW_FILE = path.join(TERMINAL, '.github', 'workflows', 'desktop-check.yml')
const CRATE = path.join(TERMINAL, 'desktop', 'src-tauri')
const ACTIONLINT = 'D:\\dev\\tools\\actionlint\\1.7.12\\actionlint.exe'
const SHA = /^[0-9a-f]{40}$/
/** The three feature sets of the shell (desktop/src-tauri/Cargo.toml) and the cargo arguments of each. */
const FEATURE_SETS = {
  release: '',
  smoke: '--no-default-features --features smoke',
  measure: '--no-default-features --features measure',
}
/** Commands whose exit code a PowerShell step must check itself (pwsh reports only the last one's). */
const NATIVE = /^(?:\$\w+\s*=\s*)?(?:&\s*)?(cargo|rustup|rustc|gh|7z|python|pnpm)\b/
const MIN_REASON = 20

const readWorkflow = () => (fs.existsSync(WORKFLOW_FILE) ? fs.readFileSync(WORKFLOW_FILE, 'utf8') : '')

/** The text of one job: from its key (two spaces in, under jobs:) to the next job or the end of the file. */
export function jobBlock(text, name) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `  ${name}:`)
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

/** The job keys under jobs:, in file order. */
export function jobNames(text) {
  const at = text.search(/^jobs:\s*$/m)
  if (at < 0) return []
  return [...text.slice(at).matchAll(/^ {2}([A-Za-z][\w-]*):\s*$/gm)].map((m) => m[1])
}

/** The run: | blocks of a text, each as its lines with the block indent removed. */
export function runBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run: \|\s*$/.exec(lines[i])
    if (!m) continue
    const body = []
    let j = i + 1
    for (; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j++) body.push(lines[j].trim())
    blocks.push(body)
    i = j - 1
  }
  return blocks
}

/** Problems with the feature-set matrix: exactly release, smoke and measure, each linted and tested. */
export function featureSetProblems(text) {
  const problems = []
  const job = jobBlock(text, 'rust')
  if (!job) return ['no job named rust']
  const sets = Object.fromEntries([...job.matchAll(/- set: (\S+)\s*\n\s+features: '?([^'\n]*?)'?\s*$/gm)].map((m) => [m[1], m[2]]))
  for (const [name, args] of Object.entries(FEATURE_SETS)) {
    if (!(name in sets)) problems.push(`missing feature set ${name}`)
    else if (sets[name] !== args) problems.push(`feature set ${name} has '${sets[name]}', not '${args}'`)
  }
  for (const name of Object.keys(sets)) if (!(name in FEATURE_SETS)) problems.push(`unknown feature set ${name}`)
  if (!/FEATURES: \$\{\{ matrix\.features \}\}/.test(job)) problems.push('the matrix features do not reach the steps')
  if (!/cargo clippy --all-targets --locked @features -- -D warnings/.test(job)) problems.push('no clippy -D warnings over the set')
  if (!/cargo test --locked --no-fail-fast @features -- --exact @skips/.test(job)) problems.push('no cargo test --locked over the set with the skip list')
  if (!/fail-fast: false/.test(job)) problems.push('one failing set would cancel the others (fail-fast)')
  // The smoke and measure sets' release-graph tests read crates only the release set builds (ci-hygiene, run 38168877977).
  const fetchAt = job.search(/^ {10}cargo fetch --locked\b/m)
  const testAt = job.search(/cargo test --locked/)
  if (fetchAt < 0 || (testAt >= 0 && fetchAt > testAt)) problems.push('the crates of the lockfile are not fetched before the tests, so a cold cache fails the release-graph tests of the smoke and measure sets')
  return problems
}

/** The entries of the one skip list (workflow env RUNNER_SKIPS), parsed; a malformed line is a problem. */
export function skipEntries(text) {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((l) => /^ {2}RUNNER_SKIPS: \|\s*$/.test(l))
  if (at < 0) return { entries: [], problems: ['no RUNNER_SKIPS list in the workflow env'] }
  const entries = []
  const problems = []
  for (let i = at + 1; i < lines.length && (lines[i].trim() === '' || /^ {4}/.test(lines[i])); i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split('|').map((p) => p.trim())
    const [sets, name, reason] = parts
    if (parts.length !== 3 || !reason) { problems.push(`skip without a reason: ${line}`); continue }
    if (reason.length < MIN_REASON) problems.push(`skip reason too short to say why: ${line}`)
    if (!/^[A-Za-z_][\w:]*$/.test(name ?? '')) problems.push(`skip name is not a test path: ${line}`)
    const known = ['all', ...Object.keys(FEATURE_SETS)]
    for (const set of sets.split(',')) if (!known.includes(set.trim())) problems.push(`skip names unknown set ${set}: ${line}`)
    entries.push({ sets: sets.split(',').map((s) => s.trim()), name, reason })
  }
  return { entries, problems }
}

/** Problems with the skip list: one list, a reason per test, no skip outside it, every name a test of the crate. */
export function skipProblems(text, crateSource) {
  const { entries, problems } = skipEntries(text)
  if ((text.match(/RUNNER_SKIPS:/g) ?? []).length > 1) problems.push('more than one RUNNER_SKIPS list')
  for (const m of text.matchAll(/--skip\b(.*)$/gm)) {
    if (!/^'?,\s*\$\w+/.test(m[1].trim()) && !/^['"]?\s*,/.test(m[1])) problems.push(`a skip outside the list: --skip${m[1]}`)
  }
  // Listing the ignored tests (--list ... --ignored) only counts them; running them would change what the set tests.
  const runsIgnored = text.split('\n').some((l) => /--ignored|--include-ignored/.test(l) && !/--list\b.*--ignored\b/.test(l))
  if (runsIgnored) problems.push('the workflow changes which tests are ignored')
  for (const { name } of entries) {
    const fn = name.split('::').pop()
    if (crateSource && !new RegExp(`\\bfn ${fn}\\s*\\(`).test(crateSource)) problems.push(`skip names no test of the crate: ${name}`)
  }
  return problems
}

/** The tests of tests/int1_seams.rs that start a real backend in the lab's own terminal folder; the runner has none. */
const LAB_TREE_TESTS = [
  'real_backend_store_export_flush_on_close_and_the_next_launch',
  'a_shell_attaches_to_a_real_backend_and_never_stops_it',
]

/**
 * Problems with how the run shows what it did not exercise. A test that prints "SKIPPED:" and returns passes without
 * checking anything, so the lab-tree tests are on the skip list, and the Tests step runs with --nocapture, counts the
 * SKIPPED lines that remain into the run summary, and takes the #[ignore]d tests out of the "listed" figure.
 */
export function selfSkipProblems(text) {
  const problems = []
  const { entries } = skipEntries(text)
  for (const name of LAB_TREE_TESTS) {
    const entry = entries.find((e) => e.name === name)
    if (!entry || !entry.sets.some((s) => s === 'smoke' || s === 'all')) problems.push(`the lab-tree test ${name} is not on the smoke skip list`)
    else if (!/terminal folder/.test(entry.reason)) problems.push(`the skip of ${name} does not say it needs the lab's own terminal folder`)
  }
  const from = text.indexOf('- name: Tests, less the runner skip list')
  const step = from < 0 ? '' : text.slice(from, text.indexOf('\n  supply-chain:', from) < 0 ? undefined : text.indexOf('\n  supply-chain:', from))
  if (!step) return [...problems, 'no Tests step to read']
  if (!/cargo test --locked --no-fail-fast @features -- --exact @skips --nocapture/.test(step)) problems.push('the Tests step does not run with --nocapture, so a printed SKIPPED line is never seen')
  if (!/-match 'SKIPPED/.test(step)) problems.push('the Tests step does not count the SKIPPED lines')
  if (!/-- --list --ignored/.test(step)) problems.push('the listed count still includes the #[ignore]d tests (no --list --ignored)')
  if (!/GITHUB_STEP_SUMMARY[^\n]*self-skipped/.test(step)) problems.push('the run summary does not report the tests that skipped themselves')
  if (!/not the only way/.test(text.slice(0, text.indexOf('RUNNER_SKIPS: |')))) problems.push('the skip list is still described as the only place a test is left out')
  return problems
}

/** Problems with coverage: report-only (its own job, continue-on-error), cargo-llvm-cov pinned, default set, uploaded. */
export function coverageProblems(text) {
  const problems = []
  const job = jobBlock(text, 'coverage')
  if (!job) return ['no job named coverage']
  if (!/^ {4}continue-on-error: true\s*$/m.test(job)) problems.push('the coverage job can fail the run (no job-level continue-on-error: true)')
  for (const name of jobNames(text)) {
    const other = jobBlock(text, name)
    if (name !== 'coverage' && /continue-on-error/.test(other)) problems.push(`continue-on-error outside the coverage job, in ${name}`)
    if (name !== 'coverage' && /llvm-cov/.test(other)) problems.push(`a coverage step in job ${name}, which can fail the run`)
    if (/^ {4}needs:.*\bcoverage\b/m.test(other)) problems.push(`job ${name} waits on coverage`)
  }
  if (/^ {6,}continue-on-error/m.test(job)) problems.push('a step-level continue-on-error in the coverage job')
  if (!/cargo-llvm-cov@\d+\.\d+\.\d+\b/.test(job)) problems.push('cargo-llvm-cov is not pinned to an exact version')
  if (!/cargo llvm-cov --locked/.test(job)) problems.push('no cargo llvm-cov --locked run')
  if (/llvm-cov[^\n]*--(no-default-)?features/.test(job)) problems.push('coverage is not on the default feature set')
  if (!/actions\/upload-artifact@/.test(job)) problems.push('the coverage report is not uploaded')
  // The job is red-but-green by design, so a failure must say so: a last step that runs on failure and annotates.
  const steps = job.split(/^ {6}- name: /m).slice(1)
  const last = steps[steps.length - 1] ?? ''
  if (!/^ {8}if: \$\{\{ failure\(\) \}\}\s*$/m.test(last) || !/::warning title=Rust coverage::the coverage figure was not produced/.test(last)) {
    problems.push('no last step that annotates a warning when the coverage figure was not produced')
  }
  // The skip list is expanded here as in the rust job, with the same stale-name check.
  if (!/is not a test of the \$env:SET set/.test(job) || !/--list --format terse/.test(job)) {
    problems.push('the coverage skip expansion does not check each name is a test of the set')
  }
  return problems
}

/** Problems with the rules every job keeps: triggers, runner, token, pins, checkout, exit codes. */
export function ruleProblems(text) {
  const problems = []
  if (!/^on:\s*\n {2}push:\s*\n {4}branches: \['\*\*'\]\s*\n {2}workflow_dispatch:/m.test(text)) problems.push('not on push to every branch and on dispatch')
  if (/^ {2}(pull_request|schedule|workflow_run)/m.test(text)) problems.push('a trigger beyond push and dispatch')
  if (!/^permissions:\s*\n {2}contents: read\s*$/m.test(text)) problems.push('the token is not read-only')
  if (/^ {4}permissions:/m.test(text)) problems.push('a job widens the token')
  if (/secrets\.|write-all|id-token/.test(text)) problems.push('the workflow reads a secret or asks for a write token')
  for (const name of jobNames(text)) {
    const job = jobBlock(text, name)
    if (!/^ {4}runs-on: windows-2025\s*$/m.test(job)) problems.push(`job ${name} is not on windows-2025`)
    if (!/^ {4}timeout-minutes: \d+\s*$/m.test(job)) problems.push(`job ${name} has no time limit`)
    if (/actions\/checkout@/.test(job) && !/persist-credentials: false/.test(job)) problems.push(`job ${name} keeps the token after checkout`)
  }
  for (const [, ref] of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) {
    const [name, sha] = ref.split('@')
    if (!SHA.test(sha ?? '')) problems.push(`${name} is not pinned by a full commit SHA`)
  }
  for (const block of runBlocks(text)) {
    block.forEach((line, i) => {
      if (!NATIVE.test(line)) return
      const next = block.slice(i + 1).find((l) => l !== '') ?? ''
      if (!/\$LASTEXITCODE -ne 0/.test(next)) problems.push(`exit code not checked after: ${line}`)
    })
  }
  return problems
}

/** Problems with the toolchain, cache, supply-chain and size steps. */
export function stepProblems(text) {
  const problems = []
  const want = [
    [/rust-toolchain\.toml/, 'the channel is not read from rust-toolchain.toml'],
    [/host: x86_64-pc-windows-msvc/, 'nothing proves the MSVC host'],
    [/actions\/cache@[0-9a-f]{40}/, 'the cargo registry is not cached'],
    [/\.cargo[\\/]registry[\\/]index/, 'the cache does not hold the registry index'],
    [/hashFiles\('terminal\/desktop\/src-tauri\/Cargo\.lock'\)/, 'the cache key does not follow Cargo.lock'],
    [/cargo deny --locked check/, 'no cargo deny --locked check'],
    [/cargo audit\b/, 'no cargo audit'],
    [/cargo-deny@\d+\.\d+\.\d+/, 'cargo-deny is not pinned'],
    [/cargo-audit@\d+\.\d+\.\d+/, 'cargo-audit is not pinned'],
    [/cargo build --release --locked --features tauri\/custom-protocol/, 'the release exe is not built the way cargo tauri build makes it'],
    [/releases\/latest/, 'the exe size is not compared with the last release'],
    [/EXE_GROWTH_LIMIT_PCT/, 'the exe size has no growth limit'],
    [/GITHUB_STEP_SUMMARY/, 'nothing is written to the run summary'],
    [/if: matrix\.set == 'smoke'[\s\S]*?pnpm install --frozen-lockfile[\s\S]*?pnpm build/, 'the smoke set has no page build (the shell refuses a lab without web/dist)'],
  ]
  for (const [re, problem] of want) if (!re.test(text)) problems.push(problem)
  return problems
}

/** Every .rs file of the crate, read as one text (to find the tests the skip list names). */
function crateSource() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.rs')) out.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(path.join(CRATE, 'src'))
  walk(path.join(CRATE, 'tests'))
  return out.join('\n')
}

// ---------------------------------------------------------------- the workflow as written

test('desktop-check.yml exists and lints and tests the release, smoke and measure feature sets', () => {
  const text = readWorkflow()
  assert.ok(text, `${WORKFLOW_FILE} exists`)
  assert.deepEqual(featureSetProblems(text), [])
})

test('the skip list is the one place a test is skipped on the runner, with a reason per test', () => {
  const text = readWorkflow()
  assert.ok(text, 'the workflow exists')
  assert.deepEqual(skipProblems(text, crateSource()), [])
})

test('a test that skips itself on the runner is on the skip list or counted in the run summary', () => {
  const text = readWorkflow()
  assert.ok(text, 'the workflow exists')
  assert.deepEqual(selfSkipProblems(text), [])
})

test('born failing: the self-skip guard fails on an unlisted lab-tree test, a blind Tests step and an uncorrected claim', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  const unlisted = text.replace(/^ {4}smoke \| a_shell_attaches_to_a_real_backend_and_never_stops_it[^\n]*\n/m, '')
  assert.notEqual(unlisted, text, 'the plant removed a skip entry')
  assert.ok(selfSkipProblems(unlisted).some((p) => p.includes('a_shell_attaches_to_a_real_backend_and_never_stops_it is not on the smoke skip list')))
  assert.ok(selfSkipProblems(text.replace('@skips --nocapture', '@skips')).some((p) => p.includes('--nocapture')))
  assert.ok(selfSkipProblems(text.replaceAll('-- --list --ignored', '-- --list')).some((p) => p.includes('#[ignore]d')))
  assert.ok(selfSkipProblems(text.replace('self-skipped', 'skipped')).some((p) => p.includes('run summary')))
  assert.ok(selfSkipProblems(text.replace('not the only way', 'the only way')).some((p) => p.includes('only place')))
  // Running the ignored tests is still refused; only listing them is allowed.
  assert.ok(skipProblems(text.replace('--exact @skips --nocapture', '--exact @skips --ignored'), crateSource()).length > 0)
})

test('the Rust coverage job is report-only, pinned, on the default set and uploaded', () => {
  const text = readWorkflow()
  assert.ok(text, 'the workflow exists')
  assert.deepEqual(coverageProblems(text), [])
})

test('the workflow keeps the rules: triggers, windows-2025, read-only token, SHA pins, checked exit codes', () => {
  const text = readWorkflow()
  assert.ok(text, 'the workflow exists')
  assert.deepEqual(ruleProblems(text), [])
  assert.deepEqual(stepProblems(text), [])
})

test('build.rs links the combined manifest into the tests on MSVC as well as on GNU', () => {
  const build = fs.readFileSync(path.join(CRATE, 'build.rs'), 'utf8')
  assert.match(build, /libresource\.a/, 'the GNU resource archive')
  assert.match(build, /resource\.lib/, 'the MSVC resource (embed-resource names it resource.lib)')
  assert.match(build, /rustc-link-arg-tests=\{\}/, 'handed to the tests')
  assert.match(build, /if gnu && let Err\(e\) = shadow_mingw_default_manifest\(\)/, 'the -B shadow stays GNU only')
})

// ---------------------------------------------------------------- born failing: planted broken copies

test('born failing: the pin test fails on a missing feature set', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  const noSmoke = text.replace(/\n\s+- set: smoke\s*\n\s+features: [^\n]*/, '')
  assert.notEqual(noSmoke, text, 'the plant removed the smoke set')
  assert.ok(featureSetProblems(noSmoke).includes('missing feature set smoke'))
  const wrongMeasure = text.replace('--features measure', '--features smoke')
  assert.ok(featureSetProblems(wrongMeasure).some((p) => p.startsWith('feature set measure')))
  const noClippyGate = text.replace('-- -D warnings', '')
  assert.ok(featureSetProblems(noClippyGate).includes('no clippy -D warnings over the set'))
  const fetchProblem = (t) => featureSetProblems(t).some((p) => p.startsWith('the crates of the lockfile are not fetched'))
  const noFetch = text.replace(/^ {10}cargo fetch --locked[^\n]*\n/m, '')
  assert.notEqual(noFetch, text, 'the plant removed the fetch')
  assert.ok(fetchProblem(noFetch))
  const lateFetch = noFetch.replace(/^( {10}cargo test --locked --no-fail-fast[^\n]*\n)/m, '$1          cargo fetch --locked\n')
  assert.notEqual(lateFetch, noFetch, 'the plant moved the fetch after the tests')
  assert.ok(fetchProblem(lateFetch))
})

test('born failing: the skip guard fails on a skip without a reason, a stray skip and a stale name', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  const plant = (line) => text.replace(/^( {2}RUNNER_SKIPS: \|\s*\n)/m, `$1    ${line}\n`)
  const source = crateSource()
  assert.ok(skipProblems(plant('smoke | a_test_with_no_reason |'), source).some((p) => p.startsWith('skip without a reason')))
  assert.ok(skipProblems(plant('smoke | a_test_with_no_reason'), source).some((p) => p.startsWith('skip without a reason')))
  assert.ok(skipProblems(plant('smoke | x | short'), source).some((p) => p.startsWith('skip reason too short')))
  assert.ok(skipProblems(plant('nightly | x | a reason long enough to read'), source).some((p) => p.startsWith('skip names unknown set')))
  const stale = plant('all | no_such_test_in_the_crate | a reason long enough to read')
  assert.ok(skipProblems(stale, source).includes('skip names no test of the crate: no_such_test_in_the_crate'))
  const stray = text.replace('cargo test --locked --no-fail-fast @features -- --exact @skips', 'cargo test --locked --no-fail-fast @features -- --exact @skips --skip hidden_window')
  assert.ok(skipProblems(stray, source).some((p) => p.startsWith('a skip outside the list')))
  assert.ok(skipProblems(text.replace('--exact @skips', '--exact @skips --include-ignored'), source).length > 0)
})

test('born failing: the coverage guard fails on a coverage step that can fail the run', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  const strict = text.replace(/^ {4}continue-on-error: true\s*$/m, '    continue-on-error: false')
  assert.ok(coverageProblems(strict).some((p) => p.startsWith('the coverage job can fail the run')))
  const gone = text.replace(/^ {4}continue-on-error: true\s*\n/m, '')
  assert.ok(coverageProblems(gone).some((p) => p.startsWith('the coverage job can fail the run')))
  const inRust = text.replace('cargo clippy --all-targets', 'cargo llvm-cov --locked\n          cargo clippy --all-targets')
  assert.ok(coverageProblems(inRust).includes('a coverage step in job rust, which can fail the run'))
  const unpinned = text.replace(/cargo-llvm-cov@\d+\.\d+\.\d+/, 'cargo-llvm-cov')
  assert.ok(coverageProblems(unpinned).includes('cargo-llvm-cov is not pinned to an exact version'))
})

test('born failing: the coverage guard fails without a failure annotation and without the stale-skip check', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  const noWarn = text.replace(/^ {8}if: \$\{\{ failure\(\) \}\}\s*\n/m, '')
  assert.ok(coverageProblems(noWarn).some((p) => p.startsWith('no last step that annotates')))
  const quiet = text.replace('::warning title=Rust coverage::', '::notice title=Rust coverage::')
  assert.ok(coverageProblems(quiet).some((p) => p.startsWith('no last step that annotates')))
  const stale = text.replace(/is not a test of the \$env:SET set/g, 'is fine')
  assert.ok(coverageProblems(stale).includes('the coverage skip expansion does not check each name is a test of the set'))
})

test('born failing: the rule guard fails on a tag pin, a widened token, an unchecked exit code and another runner', (t) => {
  const text = readWorkflow()
  if (!text) return t.skip('no workflow to plant into yet')
  assert.ok(ruleProblems(text.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7')).some((p) => p.includes('not pinned')))
  assert.ok(ruleProblems(text.replace('  contents: read', '  contents: write')).includes('the token is not read-only'))
  assert.ok(ruleProblems(text.replace(/(cargo deny --locked check\s*\n)\s*if \(\$LASTEXITCODE[^\n]*\n/, '$1')).some((p) => p.startsWith('exit code not checked')))
  assert.ok(ruleProblems(text.replace('runs-on: windows-2025', 'runs-on: windows-latest')).some((p) => p.endsWith('is not on windows-2025')))
  assert.ok(ruleProblems(text.replace("branches: ['**']", 'branches: [main]')).includes('not on push to every branch and on dispatch'))
})

// ---------------------------------------------------------------- tools of this PC, when present

/** The lab's interpreter, when this machine has one with PyYAML (a hosted runner does not). */
function pythonWithYaml() {
  const lab = process.env.NQT_LAB ?? path.join(process.env.USERPROFILE ?? '', 'nq-lab')
  const py = path.join(lab, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(py)) return null
  const probe = spawnSync(py, ['-I', '-c', 'import yaml'], { encoding: 'utf8', windowsHide: true })
  return probe.status === 0 ? py : null
}

test('desktop-check.yml parses as YAML with the jobs and matrix the text checks read', (t) => {
  const py = pythonWithYaml()
  if (!py) return t.skip('no interpreter with PyYAML here')
  assert.ok(fs.existsSync(WORKFLOW_FILE), 'the workflow exists')
  const code = 'import json,sys,yaml\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))'
  const r = spawnSync(py, ['-I', '-c', code, WORKFLOW_FILE], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stderr)
  const doc = JSON.parse(r.stdout)
  assert.deepEqual(doc.permissions, { contents: 'read' })
  const sets = doc.jobs.rust.strategy.matrix.include.map((e) => [e.set, e.features])
  assert.deepEqual(Object.fromEntries(sets), FEATURE_SETS)
  for (const [name, job] of Object.entries(doc.jobs)) {
    assert.equal(job['runs-on'], 'windows-2025', name)
    assert.equal(job['continue-on-error'], name === 'coverage' ? true : undefined, name)
  }
})

test('actionlint passes over desktop-check.yml', (t) => {
  if (!fs.existsSync(ACTIONLINT)) return t.skip('no actionlint 1.7.12 here')
  assert.ok(fs.existsSync(WORKFLOW_FILE), 'the workflow exists')
  const r = spawnSync(ACTIONLINT, ['-no-color', WORKFLOW_FILE], { cwd: TERMINAL, encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 4000))
})
