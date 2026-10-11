// The supply-chain and CodeQL workflows keep the rules of docs/desktop/ci.md: every action pinned by a full commit SHA,
// a read-only token, a write scope only where it is needed (CodeQL's one job, security-events), no step that hides a
// failure, and a trigger that lets the first run happen on the wave branch (a schedule or dispatch trigger runs only
// from the default branch, so the push trigger with its paths is what makes a first run possible).
// The workflows are read as text and never run. Every guard has a case that feeds it the broken state: an unpinned
// action, a write permission outside CodeQL's job, a missing push path. Born failing: neither workflow existed.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOWS = path.join(TERMINAL, '.github', 'workflows')
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8')
const SUPPLY = read('supply-chain.yml')
const CODEQL = read('codeql.yml')

const PUSH_PATHS = ['.github/workflows/supply-chain.yml', 'web/pnpm-lock.yaml', 'desktop/src-tauri/Cargo.lock', 'qa/uv.lock']
const CODEQL_LANGUAGES = ['javascript-typescript', 'python', 'actions']
const SUPPLY_COMMANDS = [
  'cargo deny --locked check', 'cargo audit', 'cargo cyclonedx', 'pnpm audit --prod', 'pnpm sbom --sbom-format cyclonedx',
  'pip-audit', 'node scripts/osv_scan.mjs',
]
const ARTIFACTS = ['sbom-npm', 'sbom-cargo', 'sbom-qa', 'osv-report']

// ---- reading the text: no YAML library, the files keep a plain layout ----

/** The jobs under `jobs:`, each as its own block of text. */
function jobBlocks(text) {
  const jobs = {}
  let name = null
  let inJobs = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inJobs = /^jobs:\s*$/.test(line); name = null; continue }
    if (!inJobs) continue
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (head) { name = head[1]; jobs[name] = ''; continue }
    if (name) jobs[name] += `${line}\n`
  }
  return jobs
}

/** The lines of a block that opens with `key:` at the given indent, up to the next line at that indent or less. */
function blockUnder(text, key, indent) {
  const lines = text.split(/\r?\n/)
  const open = lines.findIndex((l) => l === `${' '.repeat(indent)}${key}:` || l.startsWith(`${' '.repeat(indent)}${key}: `))
  if (open < 0) return null
  const body = []
  for (const line of lines.slice(open + 1)) {
    if (line.trim() !== '' && /^ */.exec(line)[0].length <= indent) break
    body.push(line)
  }
  return body
}

/** The text without its full-line comments, so a note that names a permission is not read as one. */
const code = (text) => text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')
const topPermissions = (text) => (blockUnder(text, 'permissions', 0) ?? []).map((l) => l.trim()).filter(Boolean)
const jobPermissions = (block) => (blockUnder(block, 'permissions', 4) ?? []).map((l) => l.trim()).filter(Boolean)
const usesLines = (text) => text.split(/\r?\n/).filter((l) => /^\s*(-\s+)?uses:/.test(l)).map((l) => l.replace(/^\s*(-\s+)?uses:\s*/, ''))
/** The commands the steps run: the lines of every `run:` (one-line or block), with comments and names left out. */
function runLines(text) {
  const lines = code(text).split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const indent = /^ */.exec(lines[i])[0].length
    if (!/^[|>][+-]?$/.test(m[1])) { out.push(m[1].trim()); continue }
    for (const body of lines.slice(i + 1)) {
      if (body.trim() !== '' && /^ */.exec(body)[0].length <= indent) break
      out.push(body.trim())
    }
  }
  return out
}
const stepsOf = (block) => block.split(/\r?\n(?= {6}- )/).filter((s) => s.trim() !== '')

// ---- the guards: each returns a list of problems, empty when the text is fine ----

function checkPins(text) {
  return usesLines(text).filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} +# v\d+(\.\d+)*\s*$/.test(u)).map((u) => `action not pinned by a full SHA with its release in a comment: ${u}`)
}

/** Writes allowed: { job, scopes } names the one job that may hold them, or null when no write is allowed at all. */
function checkPermissions(text, allowed) {
  const problems = []
  const top = topPermissions(text)
  if (top.join('|') !== 'contents: read') problems.push(`top-level permissions must be exactly "contents: read", found: ${top.join(', ') || 'none'}`)
  for (const [name, block] of Object.entries(jobBlocks(text))) {
    for (const line of jobPermissions(block)) {
      if (!/(:\s*write\b|write-all)/.test(line)) continue
      const scope = line.split(':')[0]
      if (!allowed || allowed.job !== name || !allowed.scopes.includes(scope)) problems.push(`write permission outside the allowed job: ${name}: ${line}`)
    }
  }
  const writes = code(text).split(/\r?\n/).filter((l) => /(:\s*write\b|write-all)/.test(l)).length
  const inJobs = Object.values(jobBlocks(text)).reduce((n, b) => n + jobPermissions(b).filter((l) => /(:\s*write\b|write-all)/.test(l)).length, 0)
  if (writes !== inJobs) problems.push('a write permission sits outside a job-level permissions block')
  return problems
}

function checkSupplyTriggers(text) {
  const problems = []
  const on = blockUnder(text, 'on', 0) ?? []
  const has = (key) => on.some((l) => l.startsWith(`  ${key}:`))
  for (const key of ['schedule', 'workflow_dispatch', 'push']) if (!has(key)) problems.push(`missing trigger: ${key}`)
  if (has('pull_request_target')) problems.push('pull_request_target is not allowed')
  const push = blockUnder(on.join('\n'), 'push', 2) ?? []
  const paths = (blockUnder(push.join('\n'), 'paths', 4) ?? []).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  for (const p of PUSH_PATHS) if (!paths.includes(p)) problems.push(`push trigger lacks the path ${p}`)
  if (push.length > 0 && paths.length === 0) problems.push('push trigger has no paths filter')
  return problems
}

function checkCodeqlTriggers(text) {
  const on = blockUnder(text, 'on', 0) ?? []
  const keys = on.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ''))
  return keys.join(',') === 'workflow_dispatch' ? [] : [`CodeQL stays dispatch-only until the owner says go, found triggers: ${keys.join(', ') || 'none'}`]
}

function checkHygiene(text) {
  const problems = []
  if (/continue-on-error/.test(text)) problems.push('continue-on-error hides a failure')
  if (/\|\|\s*true\b/.test(text)) problems.push('"|| true" swallows an exit code')
  if (/\$\{\{\s*github\.(event|head_ref)/.test(text)) problems.push('an event field is used inside the workflow text (script injection)')
  for (const [name, block] of Object.entries(jobBlocks(text))) {
    if (!/^ {4}timeout-minutes: \d+$/m.test(block)) problems.push(`job ${name} has no timeout-minutes`)
    for (const step of stepsOf(block).filter((s) => /uses: actions\/checkout@/.test(s))) {
      if (!/persist-credentials: false/.test(step)) problems.push(`job ${name}: checkout keeps the token (persist-credentials: false is missing)`)
    }
  }
  return problems
}

function checkSupplyJobs(text) {
  const problems = []
  const commands = runLines(text)
  for (const cmd of SUPPLY_COMMANDS) if (!commands.some((l) => l === cmd || l.startsWith(`${cmd} `))) problems.push(`no step runs: ${cmd}`)
  for (const a of ARTIFACTS) if (!new RegExp(`name: ${a}\\s*$`, 'm').test(code(text))) problems.push(`no artefact named ${a} is uploaded`)
  for (const m of text.matchAll(/^\s*tool:\s*(.+)$/gm)) {
    for (const tool of m[1].split(',').map((t) => t.trim())) if (!/^[a-z0-9-]+@\d+\.\d+\.\d+$/.test(tool)) problems.push(`tool not pinned to an exact version: ${tool}`)
  }
  for (const m of text.matchAll(/pip install[^\n]*/g)) if (!/==\d/.test(m[0])) problems.push(`pip install without an exact version: ${m[0]}`)
  if (!/^defaults:\n {2}run:\n {4}shell: bash$/m.test(text)) problems.push('the default shell is not bash (pipefail)')
  for (const block of Object.values(jobBlocks(text))) {
    for (const step of stepsOf(block).filter((s) => /uses: taiki-e\/install-action@/.test(s))) {
      if (!/fallback: none/.test(step)) problems.push('a tool may be built from source (fallback is not none)')
    }
  }
  // The osv-report upload keeps `warn` on purpose (no report exists when the scan itself failed); every SBOM upload must not.
  for (const block of Object.values(jobBlocks(text))) {
    for (const step of stepsOf(code(block)).filter((s) => /uses: actions\/upload-artifact@/.test(s))) {
      const sbom = /^\s+name:\s*(sbom-\S+)\s*$/m.exec(step)
      if (sbom && !/^\s+if-no-files-found: error\s*$/m.test(step)) problems.push(`the upload of ${sbom[1]} may pass with no file (if-no-files-found is not error)`)
    }
  }
  return problems
}

function checkCodeqlJob(text) {
  const problems = []
  const jobs = Object.keys(jobBlocks(text))
  if (jobs.length !== 1) problems.push(`CodeQL has exactly one job, found: ${jobs.join(', ')}`)
  const block = Object.values(jobBlocks(text))[0] ?? ''
  if (jobPermissions(block).join('|') !== 'contents: read|security-events: write') problems.push(`the job's permissions must be contents: read and security-events: write, found: ${jobPermissions(block).join(', ')}`)
  for (const lang of CODEQL_LANGUAGES) if (!text.includes(lang)) problems.push(`language missing: ${lang}`)
  return problems
}

const supplyProblems = (text) => [...checkPins(text), ...checkPermissions(text, null), ...checkSupplyTriggers(text), ...checkHygiene(text), ...checkSupplyJobs(text)]
const codeqlProblems = (text) => [
  ...checkPins(text), ...checkPermissions(text, { job: Object.keys(jobBlocks(text))[0], scopes: ['security-events'] }),
  ...checkCodeqlTriggers(text), ...checkHygiene(text), ...checkCodeqlJob(text),
]
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `the fixture text holds: ${from}`)
  return text.replace(from, to)
}

// ---- the real files ----

test('supply-chain.yml keeps every rule', () => assert.deepEqual(supplyProblems(SUPPLY), []))
test('codeql.yml keeps every rule', () => assert.deepEqual(codeqlProblems(CODEQL), []))

test('every workflow in the folder pins its actions by full SHA', () => {
  const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))
  assert.ok(files.includes('ci.yml') && files.includes('supply-chain.yml') && files.includes('codeql.yml'))
  for (const file of files) assert.deepEqual(checkPins(read(file)), [], file)
})

test('the push trigger names the four paths that make a first run possible on the wave branch', () => {
  const paths = (blockUnder(blockUnder(SUPPLY, 'on', 0).join('\n'), 'push', 2) ?? [])
  for (const p of PUSH_PATHS) assert.ok(paths.some((l) => l.includes(p)), p)
})

test('the weekly schedule is a real cron line', () => {
  assert.match(SUPPLY, /^ {4}- cron: '\d{1,2} \d{1,2} \* \* [0-6]'$/m)
})

test('CodeQL covers the three languages and holds the only write scope of the two files', () => {
  assert.equal(code(SUPPLY).match(/:\s*write\b/g), null, 'supply-chain.yml has no write permission')
  assert.equal(code(CODEQL).match(/security-events: write/g)?.length, 1)
})

// ---- born failing: each guard is fed the broken state ----

test('an unpinned action is flagged (a tag, a branch, a short SHA, a missing release comment)', () => {
  const sha = /@[0-9a-f]{40} # v[\d.]+/.exec(SUPPLY)[0]
  for (const bad of ['@v4', '@main', `@${sha.slice(1, 8)} # v4`, `${sha.slice(0, 41)}`]) {
    assert.ok(checkPins(swap(SUPPLY, sha, bad)).length > 0, `flagged: ${bad}`)
    assert.ok(supplyProblems(swap(SUPPLY, sha, bad)).length > 0)
  }
  assert.ok(checkPins(CODEQL.replace(/@[0-9a-f]{40} # v[\d.]+/, '@v4')).length > 0)
  assert.ok(checkPins('    steps:\n      - uses: ./local-action\n').length > 0, 'a local action is not a pin')
})

test('a write permission outside CodeQL\'s job is flagged', () => {
  const job = (n) => `\n  ${n}:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    permissions:\n      contents: read\n      security-events: write\n    steps:\n      - run: echo\n`
  assert.ok(checkPermissions(`${SUPPLY}${job('extra')}`, null).length > 0, 'supply-chain job with security-events: write')
  assert.ok(checkPermissions(swap(SUPPLY, 'permissions:\n  contents: read', 'permissions:\n  contents: write'), null).length > 0, 'top-level contents: write')
  assert.ok(checkPermissions(swap(SUPPLY, 'permissions:\n  contents: read', 'permissions: write-all'), null).length > 0, 'write-all')
  const topWrite = swap(CODEQL, 'permissions:\n  contents: read', 'permissions:\n  contents: read\n  security-events: write')
  assert.ok(codeqlProblems(topWrite).length > 0, 'security-events: write at the top of CodeQL')
  const wide = swap(CODEQL, '      security-events: write', '      security-events: write\n      contents: write')
  assert.ok(codeqlProblems(wide).length > 0, 'CodeQL job with contents: write')
  assert.ok(codeqlProblems(`${CODEQL}${job('second')}`).length > 0, 'a second job in CodeQL')
})

test('a missing push path or push filter is flagged', () => {
  for (const p of PUSH_PATHS) {
    const broken = SUPPLY.split('\n').filter((l) => l.trim() !== `- ${p}`).join('\n')
    assert.ok(checkSupplyTriggers(broken).some((m) => m.includes(p)), `flagged: ${p}`)
  }
  const noPaths = swap(SUPPLY, 'paths:', 'branches:')
  assert.ok(checkSupplyTriggers(noPaths).length > 0)
  assert.ok(checkSupplyTriggers(swap(SUPPLY, '  schedule:', '  not_schedule:')).length > 0)
  assert.ok(checkSupplyTriggers(swap(SUPPLY, '  workflow_dispatch:', '  not_dispatch:')).length > 0)
})

test('CodeQL on push, pull request or a schedule is flagged', () => {
  for (const extra of ['  push:\n    branches: [main]', '  pull_request:\n    branches: [main]', '  schedule:\n    - cron: \'1 1 * * 1\'']) {
    assert.ok(checkCodeqlTriggers(swap(CODEQL, '  workflow_dispatch:', `  workflow_dispatch:\n${extra}`)).length > 0, extra)
  }
})

test('a hidden failure, a loose tool version or a leaked token is flagged', () => {
  assert.ok(checkHygiene(swap(SUPPLY, 'run: cargo audit', 'continue-on-error: true\n        run: cargo audit')).length > 0)
  assert.ok(checkHygiene(swap(SUPPLY, 'cargo audit', 'cargo audit || true')).length > 0)
  assert.ok(checkHygiene(swap(SUPPLY, 'persist-credentials: false', 'persist-credentials: true')).length > 0)
  assert.ok(checkHygiene(swap(SUPPLY, '    timeout-minutes: ', '    not-timeout: ')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'cargo-deny@0.20.2', 'cargo-deny')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'cargo-deny@0.20.2', 'cargo-deny@latest')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'fallback: none', 'fallback: cargo-binstall')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'pip-audit==', 'pip-audit>=')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'node scripts/osv_scan.mjs', 'echo skipped')).length > 0)
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'name: sbom-qa', 'name: other')).length > 0)
})

/** The workflow with one whole step (its `- name:` line and its body) removed; the comments and job names stay. */
const dropStep = (text, name) => {
  const step = new RegExp(`^ {6}- name: ${name}\\n(?: {8}.*\\n)*`, 'm')
  assert.ok(step.test(text), `the fixture holds the step: ${name}`)
  return text.replace(step, '')
}

test('a deleted audit step is flagged even though a comment and a job name still name the tool', () => {
  const noCargoAudit = dropStep(SUPPLY, 'cargo audit')
  assert.ok(noCargoAudit.includes('cargo audit'), 'the header comment and the job name still say cargo audit')
  assert.ok(checkSupplyJobs(noCargoAudit).includes('no step runs: cargo audit'))
  const noPipAudit = dropStep(SUPPLY, 'pip-audit')
  assert.ok(noPipAudit.includes('pip-audit'), 'the job name and the install step still say pip-audit')
  assert.ok(checkSupplyJobs(noPipAudit).includes('no step runs: pip-audit'))
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'run: cargo audit', 'run: echo cargo audit')).includes('no step runs: cargo audit'), 'an echo is not the command')
  assert.ok(checkSupplyJobs(swap(SUPPLY, '          pip-audit --requirement', '          echo --requirement')).includes('no step runs: pip-audit'), 'the install line is not the audit')
  assert.ok(checkSupplyJobs(swap(SUPPLY, 'run: cargo audit', '# run: cargo audit')).includes('no step runs: cargo audit'), 'a commented-out step runs nothing')
})

test('every sbom upload must fail on a missing file, step by step', () => {
  for (const name of ['sbom-npm', 'sbom-cargo', 'sbom-qa']) {
    const upload = new RegExp(`(name: ${name}\\n(?: {10}.*\\n)*? {10})if-no-files-found: error`)
    assert.ok(upload.test(SUPPLY), `the fixture holds the ${name} upload with error`)
    for (const bad of ['warn', 'ignore']) {
      const problems = checkSupplyJobs(SUPPLY.replace(upload, `$1if-no-files-found: ${bad}`))
      assert.ok(problems.some((m) => m.includes(name)), `${name} with ${bad} is flagged`)
    }
    const dropped = checkSupplyJobs(SUPPLY.replace(upload, `$1retention-days: 90`))
    assert.ok(dropped.some((m) => m.includes(name)), `${name} without the setting is flagged`)
  }
  assert.deepEqual(checkSupplyJobs(SUPPLY), [], 'the osv-report upload keeps warn on purpose')
})

// ---- wiring: the scanner's own tests live in scripts/tests, which the harness glob does not reach ----
// ci.yml belongs to the CI wave, so the osv job of supply-chain.yml runs them before it scans (a scanner whose tests fail
// must not be trusted to say a lock file is clean).

const SCRIPT_GLOB = 'node --test scripts/tests/*.test.mjs'

/** Problems with how the osv job runs the node tests of scripts/tests (osv_scan.test.mjs and any later one). */
function scannerTestProblems(text) {
  const job = code(jobBlocks(text).osv ?? '').split(/\r?\n/).map((l) => l.trim().replaceAll(String.fromCharCode(92), '/'))
  const out = []
  const at = job.findIndex((l) => l === `run: ${SCRIPT_GLOB}`)
  const scan = job.findIndex((l) => l.startsWith('run: node scripts/osv_scan.mjs'))
  if (at < 0) out.push(`no osv step runs "${SCRIPT_GLOB}"`)
  else if (scan >= 0 && at > scan) out.push('the scanner tests run after the scan')
  if (/--exclude|--test-name-pattern|--test-skip-pattern/.test(job.filter((l) => l.includes(SCRIPT_GLOB)).join('\n'))) out.push('a node test of scripts/tests is skipped by name')
  return out
}

test('the osv job runs the node tests of scripts/tests before it scans, so osv_scan.test.mjs runs in CI', () => {
  assert.ok(fs.existsSync(path.join(TERMINAL, 'scripts', 'tests', 'osv_scan.test.mjs')))
  assert.deepEqual(scannerTestProblems(SUPPLY), [])
})

test('an osv job without that step, with the glob narrowed, a test skipped or the order reversed is flagged', () => {
  assert.ok(scannerTestProblems(swap(SUPPLY, SCRIPT_GLOB, 'echo skipped')).length > 0, 'step removed')
  assert.ok(scannerTestProblems(swap(SUPPLY, SCRIPT_GLOB, 'node --test scripts/tests/other.test.mjs')).length > 0, 'glob narrowed')
  assert.ok(scannerTestProblems(swap(SUPPLY, SCRIPT_GLOB, `${SCRIPT_GLOB} --test-skip-pattern=osv`)).length > 0, 'a test skipped')
  const scanLine = 'run: node scripts/osv_scan.mjs --out "$RUNNER_TEMP/osv-report.json"'
  const reversed = swap(swap(SUPPLY, SCRIPT_GLOB, 'echo moved'), scanLine, `${scanLine}
      - name: late
        run: ${SCRIPT_GLOB}`)
  assert.ok(scannerTestProblems(reversed).some((m) => m.includes('after the scan')), 'tests after the scan')
})
