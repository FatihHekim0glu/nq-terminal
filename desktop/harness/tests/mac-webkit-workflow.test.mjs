// .github/workflows/mac-webkit.yml (V04 D7.1 and D7.2, G1 items 1 and 2): the JavaScriptCore goldens and the WebKit runs on a
// hosted macos-26 runner. It keeps the rules of docs/desktop/ci.md: every action pinned by a full commit SHA, a read-only
// token with no write scope anywhere, no step that hides a failure, Node only (no Python on the runner), every figure labelled
// demo and PROVISIONAL, and a trigger that lets the first run happen on the wave branch: a schedule or dispatch trigger runs only
// from the default branch (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
// so the push trigger limited to the workflow's own path is what makes a first run possible.
// The workflow is read as text and never run here (there is no macOS on this PC; actionlint checks its syntax). Every guard has
// a case that feeds it the broken state: no push path, a write permission, an unpinned action, a Linux runner, a Python step.
// Born failing: the workflow did not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FILE = path.join(TERMINAL, '.github', 'workflows', 'mac-webkit.yml')
const TEXT = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : ''

const RUNNER = 'macos-26'
const BUN_VERSION = '1.3.9'
const JOBS = ['jsc-golden', 'webkit-offline', 'webkit-selftest']
const PUSH_PATHS = ['.github/workflows/mac-webkit.yml']
const COMMANDS = [
  'bun web/scripts/jscGolden.mjs',
  'bun build web/scripts/jscGolden.mjs',
  'pnpm install --frozen-lockfile',
  'pnpm exec playwright install webkit',
  'pnpm exec playwright test -c playwright.offline.config.ts --project=offline-webkit --project=offline-webkit-demo',
  'pnpm build:selftest',
]

// ---- reading the text: no YAML library, the file keeps a plain layout ----

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

/** The text without its full-line comments, so a note that names a permission or a tool is not read as one. */
const code = (text) => text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')
const topPermissions = (text) => (blockUnder(text, 'permissions', 0) ?? []).map((l) => l.trim()).filter(Boolean)
const jobPermissions = (block) => (blockUnder(block, 'permissions', 4) ?? []).map((l) => l.trim()).filter(Boolean)
const usesLines = (text) => text.split(/\r?\n/).filter((l) => /^\s*(-\s+)?uses:/.test(l)).map((l) => l.replace(/^\s*(-\s+)?uses:\s*/, ''))
const stepsOf = (block) => block.split(/\r?\n(?= {6}- )/).filter((s) => s.trim() !== '')

/** The commands the steps run: the lines of every `run:` (one-line or block), with comments left out. */
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

// ---- the guards: each returns a list of problems, empty when the text is fine ----

function checkPins(text) {
  return usesLines(text).filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} +# v\d+(\.\d+)*\s*$/.test(u)).map((u) => `action not pinned by a full SHA with its release in a comment: ${u}`)
}

/** No write scope anywhere: the top-level block is exactly `contents: read` and no job opens a permissions block of its own. */
function checkPermissions(text) {
  const problems = []
  const top = topPermissions(text)
  if (top.join('|') !== 'contents: read') problems.push(`top-level permissions must be exactly "contents: read", found: ${top.join(', ') || 'none'}`)
  for (const [name, block] of Object.entries(jobBlocks(text))) {
    if (blockUnder(block, 'permissions', 4) !== null) problems.push(`job ${name} sets its own permissions (${jobPermissions(block).join(', ') || 'empty'}); none is needed`)
  }
  if (/(:\s*write\b|write-all)/.test(code(text))) problems.push('a write permission is named in the workflow')
  return problems
}

function checkTriggers(text) {
  const problems = []
  const on = blockUnder(text, 'on', 0) ?? []
  const has = (key) => on.some((l) => l.startsWith(`  ${key}:`))
  for (const key of ['schedule', 'workflow_dispatch', 'push']) if (!has(key)) problems.push(`missing trigger: ${key}`)
  if (has('pull_request_target')) problems.push('pull_request_target is not allowed')
  const push = blockUnder(on.join('\n'), 'push', 2) ?? []
  const paths = (blockUnder(push.join('\n'), 'paths', 4) ?? []).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  if (push.length > 0 && paths.length === 0) problems.push('push trigger has no paths filter')
  for (const p of PUSH_PATHS) if (!paths.includes(p)) problems.push(`push trigger lacks the path ${p}`)
  if (paths.join('|') !== PUSH_PATHS.join('|') && paths.length > 0) problems.push(`push trigger paths are ${paths.join(', ')}, expected only ${PUSH_PATHS.join(', ')}`)
  return problems
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

function checkRunners(text) {
  const problems = []
  const jobs = jobBlocks(text)
  for (const name of JOBS) if (!(name in jobs)) problems.push(`missing job: ${name}`)
  for (const [name, block] of Object.entries(jobs)) {
    const runner = /^ {4}runs-on: (.+)$/m.exec(block)?.[1]?.trim()
    if (runner !== RUNNER) problems.push(`job ${name} runs on ${runner ?? 'nothing'}, expected ${RUNNER}`)
  }
  return problems
}

/** Node only: no Python, pip or uv on the runner (04_roadmap.md:111). */
function checkNoPython(text) {
  const problems = []
  const body = code(text)
  if (/setup-python|setup-uv/.test(body)) problems.push('a Python or uv setup action is used')
  for (const line of runLines(text)) {
    if (/(^|[\s;&|(])(python3?|pip3?|uv|uvx|pytest|ruff)(\s|$)/.test(line)) problems.push(`a Python tool is run: ${line}`)
  }
  return problems
}

function checkBun(text) {
  const problems = []
  const uses = usesLines(text).filter((u) => u.startsWith('oven-sh/setup-bun@'))
  if (uses.length === 0) problems.push('Bun is not set up (oven-sh/setup-bun)')
  const versions = [...code(text).matchAll(/^\s*bun-version:\s*(\S+)\s*$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, ''))
  if (versions.length === 0 || versions.some((v) => v !== BUN_VERSION)) problems.push(`Bun must be pinned to exactly ${BUN_VERSION}, found: ${versions.join(', ') || 'none'}`)
  return problems
}

function checkCommands(text) {
  const commands = runLines(text)
  return COMMANDS.filter((cmd) => !commands.some((l) => l === cmd || l.startsWith(`${cmd} `))).map((cmd) => `no step runs: ${cmd}`)
}

/** Every figure the run prints is labelled demo and PROVISIONAL, and the Bun fallback is said out loud. */
function checkLabels(text) {
  const problems = []
  if (!/PROVISIONAL/.test(text)) problems.push('the figures are not labelled PROVISIONAL')
  if (!/\bdemo\b/.test(text)) problems.push('the figures are not labelled demo')
  if (!/FALLBACK/.test(text)) problems.push('the Bun fallback (no jsc shell on the runner) is not named')
  return problems
}

/**
 * The contract with the self-test page (web/src/selftest): the report's state words, the page's base path, the click it waits for
 * and its own judge. The first version of this job waited for `done === true`, a flag the page never sets, so on a hosted runner it
 * would have timed out after 120 s with nothing to read.
 */
function checkSelftestContract(text) {
  const job = jobBlocks(text)['webkit-selftest'] ?? ''
  const problems = []
  if (!/__selftest\?\.state === 'done'/.test(job)) problems.push("the self-test job does not wait for window.__selftest.state === 'done'")
  if (!/'awaiting-gesture'/.test(job)) problems.push('the self-test job does not handle the awaiting-gesture state')
  if (!/getByRole\('button', \{ name: 'Run the clipboard and export probes' \}\)\.click\(\)/.test(job)) problems.push('the self-test job does not click the page button')
  if (!/const BASE = '\/__selftest\/'/.test(job) || !/base: BASE/.test(job)) problems.push('the self-test job does not serve the page under /__selftest/')
  if (!/judgeReport\(report\)/.test(job)) problems.push("the self-test job does not judge the report with the page's own judgeReport")
  return problems
}

const ALL_GUARDS = [checkPins, checkPermissions, checkTriggers, checkHygiene, checkRunners, checkNoPython, checkBun, checkCommands, checkLabels, checkSelftestContract]
const problemsOf = (text) => ALL_GUARDS.flatMap((guard) => guard(text))
const expectProblem = (guard, text, pattern) => {
  const problems = guard(text)
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got: ${JSON.stringify(problems)}`)
}

// ---- the real workflow ----

test('the workflow file exists and every guard passes on it', () => {
  assert.ok(TEXT !== '', `${FILE} is missing`)
  assert.deepEqual(problemsOf(TEXT), [])
})

test('it has the three jobs, all on macos-26, and the top-level token is read-only', () => {
  assert.deepEqual(Object.keys(jobBlocks(TEXT)), JOBS)
  assert.deepEqual(topPermissions(TEXT), ['contents: read'])
})

test('it runs on dispatch, weekly and on a push to its own path only', () => {
  const on = (blockUnder(TEXT, 'on', 0) ?? []).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ''))
  assert.deepEqual(on, ['schedule', 'workflow_dispatch', 'push'])
  assert.match(TEXT, /cron: '\d+ \d+ \* \* \d'/, 'a weekly cron')
})

test('the goldens run under Bun on macOS in every case, and under jsc when the runner has one', () => {
  const jsc = jobBlocks(TEXT)['jsc-golden']
  assert.match(jsc, /bun web\/scripts\/jscGolden\.mjs/)
  assert.match(jsc, /steps\.jsc\.outputs\.path != ''/, 'the jsc step runs only when the shell was found')
  assert.match(jsc, /grep -q '\^jsc-golden: 4 of 4 '/, 'a jsc run that prints nothing is a failure')
  assert.ok(!/pnpm install/.test(jsc), 'the goldens need no dependency (the quant files import only each other)')
})

test('the self-test step reads window.__selftest under WebKit and fails the job when it is missing or not ok', () => {
  const selftest = jobBlocks(TEXT)['webkit-selftest']
  assert.match(selftest, /window\.__selftest/)
  assert.match(selftest, /webkit\.launch\(\)/)
  assert.match(selftest, /process\.exit\(1\)|process\.exitCode = 1/)
})

test("the self-test job speaks the page's words: its states, its button and its base path exist in web/src/selftest", () => {
  const read = (file) => fs.readFileSync(path.join(TERMINAL, 'web', 'src', 'selftest', file), 'utf8')
  assert.match(read('report.ts'), /'awaiting-gesture' \| 'done'/, 'the report states')
  assert.match(read('SelfTestApp.tsx'), /Run the clipboard and export probes/, 'the button the job clicks')
  assert.match(fs.readFileSync(path.join(TERMINAL, 'web', 'vite.config.ts'), 'utf8'), /SELFTEST_BASE = '\/__selftest\/'/, 'the base path of the build')
  assert.deepEqual(checkSelftestContract(TEXT), [])
})

test('born failing: a self-test job that waits for a flag the page does not set, or serves the page at the root, is refused', () => {
  const oldWait = TEXT.replace(/window\.__selftest\?\.state === 'done'/, "(window.__selftest.done === true || window.__selftest.status === 'done')")
  assert.notEqual(oldWait, TEXT)
  expectProblem(checkSelftestContract, oldWait, /state === 'done'/)
  expectProblem(checkSelftestContract, TEXT.replaceAll('awaiting-gesture', 'waiting'), /awaiting-gesture/)
  expectProblem(checkSelftestContract, TEXT.replace('Run the clipboard and export probes', 'Run'), /click the page button/)
  expectProblem(checkSelftestContract, TEXT.replace("const BASE = '/__selftest/'", "const BASE = '/'"), /\/__selftest\//)
  expectProblem(checkSelftestContract, TEXT.replace('judgeReport(report)', 'report.ok'), /judgeReport/)
})

// ---- born failing: each guard sees the broken state ----

test('born failing: a workflow without the push-path trigger is refused', () => {
  const broken = TEXT.replace(/^ {2}push:\n {4}paths:\n(?: {6}- .+\n)+/m, '')
  assert.notEqual(broken, TEXT, 'the case must change the text')
  expectProblem(checkTriggers, broken, /missing trigger: push/)
})

test('born failing: a push trigger with no paths filter, or with an extra path, is refused', () => {
  const bare = TEXT.replace(/^ {2}push:\n {4}paths:\n(?: {6}- .+\n)+/m, '  push:\n')
  expectProblem(checkTriggers, bare, /no paths filter/)
  const wide = TEXT.replace(/^( {6}- \.github\/workflows\/mac-webkit\.yml\n)/m, '$1      - web/src/quant/**\n')
  assert.notEqual(wide, TEXT)
  expectProblem(checkTriggers, wide, /expected only/)
})

test('born failing: a missing schedule or dispatch trigger, or pull_request_target, is refused', () => {
  expectProblem(checkTriggers, TEXT.replace(/^ {2}schedule:\n {4}- cron: .+\n/m, ''), /missing trigger: schedule/)
  expectProblem(checkTriggers, TEXT.replace(/^ {2}workflow_dispatch:\n/m, ''), /missing trigger: workflow_dispatch/)
  expectProblem(checkTriggers, TEXT.replace(/^on:\n/m, 'on:\n  pull_request_target:\n'), /pull_request_target/)
})

test('born failing: a write permission at the top, in a job, or anywhere in the text is refused', () => {
  expectProblem(checkPermissions, TEXT.replace('contents: read', 'contents: write'), /top-level permissions/)
  expectProblem(checkPermissions, TEXT.replace('contents: read', 'contents: read\n  id-token: write'), /top-level permissions/)
  const job = TEXT.replace(/^(  jsc-golden:\n)/m, '$1    permissions:\n      contents: write\n')
  assert.notEqual(job, TEXT)
  expectProblem(checkPermissions, job, /job jsc-golden sets its own permissions/)
  expectProblem(checkPermissions, `${TEXT}\n      - run: echo "pull-requests: write"\n`, /write permission is named/)
})

test('born failing: an action pinned by a tag or a branch, or with no release comment, is refused', () => {
  expectProblem(checkPins, TEXT.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7'), /not pinned/)
  expectProblem(checkPins, TEXT.replace(/oven-sh\/setup-bun@[0-9a-f]{40}/, 'oven-sh/setup-bun@main'), /not pinned/)
  expectProblem(checkPins, TEXT.replace(/(actions\/setup-node@[0-9a-f]{40}) +# v[\d.]+/, '$1'), /not pinned/)
})

test('born failing: a Linux or Windows runner, or a missing job, is refused', () => {
  expectProblem(checkRunners, TEXT.replace(/runs-on: macos-26/, 'runs-on: ubuntu-24.04'), /expected macos-26/)
  expectProblem(checkRunners, TEXT.replace(/runs-on: macos-26/, 'runs-on: macos-latest'), /expected macos-26/)
  expectProblem(checkRunners, TEXT.replace(/^ {2}webkit-offline:\n/m, '  renamed:\n'), /missing job: webkit-offline/)
})

test('born failing: Python on the runner, as an action or a command, is refused', () => {
  expectProblem(checkNoPython, TEXT.replace(/^(\s+)- name: Check out/m, '$1- uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0\n$1- name: Check out'), /Python or uv setup/)
  expectProblem(checkNoPython, `${TEXT}\n        run: python3 -m pytest\n`, /Python tool is run/)
  expectProblem(checkNoPython, `${TEXT}\n        run: uv run pytest\n`, /Python tool is run/)
})

test('born failing: a hidden failure, a missing timeout or a checkout that keeps the token is refused', () => {
  expectProblem(checkHygiene, TEXT.replace(/^( {4}timeout-minutes: \d+)$/m, '$1\n    continue-on-error: true'), /continue-on-error/)
  expectProblem(checkHygiene, TEXT.replace(/bun web\/scripts\/jscGolden\.mjs \|/, 'bun web/scripts/jscGolden.mjs || true |'), /\|\| true/)
  expectProblem(checkHygiene, TEXT.replace(/^ {4}timeout-minutes: \d+\n/m, ''), /no timeout-minutes/)
  expectProblem(checkHygiene, TEXT.replace(/ +persist-credentials: false\n/, ''), /keeps the token/)
  expectProblem(checkHygiene, `${TEXT}\n        run: echo \${{ github.event.head_commit.message }}\n`, /script injection/)
})

test('born failing: Bun left unpinned or at another version is refused', () => {
  expectProblem(checkBun, TEXT.replace(`bun-version: ${BUN_VERSION}`, 'bun-version: latest'), /pinned to exactly/)
  expectProblem(checkBun, TEXT.replace(`bun-version: ${BUN_VERSION}`, 'bun-version: 1.3.x'), /pinned to exactly/)
  expectProblem(checkBun, TEXT.replace(/^\s*bun-version: .+\n/m, ''), /pinned to exactly/)
})

test('born failing: a missing golden, offline or self-test command is refused', () => {
  expectProblem(checkCommands, TEXT.replaceAll('pnpm exec playwright install webkit', 'pnpm exec playwright install chromium'), /playwright install webkit/)
  expectProblem(checkCommands, TEXT.replace(/--project=offline-webkit-demo/, ''), /offline-webkit-demo/)
  expectProblem(checkCommands, TEXT.replace('run: pnpm build:selftest', 'run: pnpm build'), /build:selftest/)
  expectProblem(checkCommands, TEXT.replace(/bun web\/scripts\/jscGolden\.mjs \|/, 'node web/scripts/jscGolden.mjs |'), /bun web\/scripts\/jscGolden\.mjs/)
})

test('born failing: figures with no demo or PROVISIONAL label, or no named fallback, are refused', () => {
  expectProblem(checkLabels, TEXT.replaceAll('PROVISIONAL', 'final'), /PROVISIONAL/)
  expectProblem(checkLabels, TEXT.replaceAll(/\bdemo\b/g, 'sample'), /labelled demo/)
  expectProblem(checkLabels, TEXT.replaceAll('FALLBACK', 'note'), /fallback/)
})

test('the guards are quiet on a clean copy of themselves (a guard that always complains would pass every case above)', () => {
  for (const guard of ALL_GUARDS) assert.deepEqual(guard(TEXT), [], guard.name)
})
