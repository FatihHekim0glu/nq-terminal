// The two workflows of the drift-release slice (04 D5.3 and D5.4; grade G-19 and G-22; owner decision O20):
// .github/workflows/webview2-drift.yml (weekly WebView2 and Tauri advisory watch) and
// .github/workflows/desktop-release.yml (a dispatch-only MSVC build of the release feature set).
//
// The rules are read from the workflow text, so the hosted runner needs no YAML library. Every guard is also fed a broken
// copy of the real file (a write permission outside its gate, a tag trigger, a missing --locked, no push-path trigger, an
// untrusted expression in a script) and must name it: a guard that cannot fail proves nothing. Two steps of the drift
// workflow are also run for real, under PowerShell, because their logic (what counts as a new major runtime) lives in the
// workflow itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TERMINAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOWS = path.join(TERMINAL, '.github', 'workflows')
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8')
const DRIFT = read('webview2-drift.yml')
const RELEASE = read('desktop-release.yml')
const SHA = /^[0-9a-f]{40}$/
/** The ref the attestation is bound to: a dispatch from any other branch runs that branch's own copy of the workflow and must not be signed. */
const ATTEST_REF_GATE = /github\.ref == 'refs\/heads\/main'/

/** The only jobs that may hold a write permission, the scopes they may hold, the variable that gates them and the actions they may use. */
const DRIFT_WRITE_RULES = {
  issues: { scopes: ['issues'], gate: "vars.NQT_DRIFT_ISSUES == 'on'", alsoRequired: ["needs.drift.result == 'failure'", "github.event_name != 'push'"], actions: [] },
}
const RELEASE_WRITE_RULES = {
  attest: {
    scopes: ['attestations', 'id-token'],
    gate: "vars.NQT_ATTEST == 'on'",
    actions: ['actions/download-artifact', 'actions/attest-build-provenance'],
  },
}

// ---- a reader for the subset of YAML these files use (2-space indent, steps that start with "- name:") -----------------

const indentOf = (line) => /^ */.exec(line)[0].length

/** The jobs of a workflow: key and the lines below it. */
export function splitJobs(text) {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (at < 0) return []
  const jobs = []
  let current = null
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) { if (current) current.lines.push(line); continue }
    if (indentOf(line) === 0) break
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (header) { current = { key: header[1], lines: [] }; jobs.push(current); continue }
    if (current) current.lines.push(line)
  }
  return jobs
}

/** The lines under a header at `indent` (deeper than it), up to the next line at or above it. */
function childLines(lines, headerAt, indent) {
  const out = []
  for (const line of lines.slice(headerAt + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) { out.push(line); continue }
    if (indentOf(line) <= indent) break
    out.push(line)
  }
  return out
}

const fieldOf = (job, key) => {
  const line = job.lines.find((l) => new RegExp(`^    ${key}:`).test(l))
  return line === undefined ? null : line.replace(new RegExp(`^    ${key}:\\s*`), '').trim()
}

/** A permissions block as { scope: level }; a scalar ("write-all", "{}") comes back as { '*': value }. */
function permissionsAt(lines, indent) {
  const at = lines.findIndex((l) => new RegExp(`^ {${indent}}permissions:`).test(l))
  if (at < 0) return null
  const rest = lines[at].replace(/^\s*permissions:\s*/, '').trim()
  if (rest !== '') return { '*': rest }
  const map = {}
  for (const line of childLines(lines, at, indent)) {
    const m = /^\s+([A-Za-z-]+):\s*(\w+)\s*(#.*)?$/.exec(line)
    if (m) map[m[1]] = m[2]
  }
  return map
}

/** The workflow's own permissions (the block before `jobs:`), or null. */
function workflowPermissions(text) {
  const lines = text.split(/\r?\n/)
  const end = lines.findIndex((l) => /^jobs:/.test(l))
  return permissionsAt(lines.slice(0, end < 0 ? lines.length : end), 0)
}

/** The steps of a job: name, id, uses, shell, if, with, env and the run text (the block, each line trimmed). */
export function stepsOf(job) {
  const lines = job.lines
  const at = lines.findIndex((l) => /^    steps:\s*$/.test(l))
  if (at < 0) return []
  const out = []
  let current = null
  let section = null
  let runIndent = 0
  for (const line of childLines(lines, at, 4)) {
    const start = /^      - (name|uses): ?(.*)$/.exec(line)
    if (start) {
      current = { name: '', id: null, uses: null, shell: null, if: null, workingDirectory: null, with: {}, env: {}, run: '' }
      current[start[1]] = start[2]
      out.push(current)
      section = null
      continue
    }
    if (!current) continue
    if (section === 'run') {
      if (line.trim() === '') { current.run += '\n'; continue }
      if (runIndent === 0) runIndent = indentOf(line)
      if (indentOf(line) >= runIndent) { current.run += `${line.slice(runIndent)}\n`; continue }
      section = null
    }
    const key = /^        ([A-Za-z-]+):\s?(.*)$/.exec(line)
    if (key) {
      const [, name, value] = key
      section = null
      if (name === 'run') {
        if (/^[|>][+-]?$/.test(value)) { section = 'run'; runIndent = 0 } else current.run = `${value}\n`
      } else if (name === 'with' || name === 'env') section = name
      else if (name === 'name') current.name = value
      else if (name === 'working-directory') current.workingDirectory = value
      else if (name in current) current[name] = value
      continue
    }
    const entry = /^          ([A-Za-z0-9_-]+):\s?(.*)$/.exec(line)
    if (entry && (section === 'with' || section === 'env')) current[section][entry[1]] = entry[2]
  }
  return out
}

/** The event names under `on:` and the lines of each. */
export function triggersOf(text) {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((l) => /^on:\s*$/.test(l))
  if (at < 0) return {}
  const events = {}
  const body = childLines(lines, at, 0)
  body.forEach((line, i) => {
    const m = /^  ([a-z_]+):\s*(.*)$/.exec(line)
    if (m) events[m[1]] = { inline: m[2], lines: childLines(body, i, 2) }
  })
  return events
}

const allSteps = (text) => splitJobs(text).flatMap((job) => stepsOf(job).map((step) => ({ job: job.key, ...step })))

// ---- the guards, as functions of the workflow text -----------------------------------------------------------------------------

/** The `if:` of a write job is an AND of conditions: the gate and every required one are whole terms, and no `||` or `!` can defeat them. */
export function gateProblems(key, expression, rule) {
  const body = expression.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim()
  const terms = body.split('&&').map((t) => t.trim())
  const out = []
  if (/\|\||!(?!=)|[()]/.test(body.replace(/\b(always|success|failure|cancelled)\(\)/g, ''))) out.push(`job ${key} weakens the gate ${rule.gate}: its if is \`${body}\` (no ||, ! or grouping may sit beside the gate)`)
  for (const need of [rule.gate, ...(rule.alsoRequired ?? [])]) {
    if (!terms.includes(need)) out.push(`job ${key} holds a write permission without the gate ${need}`)
  }
  return out
}

/** Write permissions and where they sit: the workflow must be read-only, and a write job must be the gated one and nothing else. */
export function permissionProblems(text, rules) {
  const out = []
  const top = workflowPermissions(text)
  if (!top || Object.keys(top).length !== 1 || top.contents !== 'read') out.push(`the workflow permissions are ${JSON.stringify(top)}, not exactly { contents: read }`)
  for (const job of splitJobs(text)) {
    const own = permissionsAt(job.lines, 4)
    const writes = Object.entries(own ?? {}).filter(([scope, level]) => level === 'write' || level === 'write-all' || scope === '*' && level !== '{}' && level !== 'read-all')
    if (writes.length === 0) continue
    const rule = rules[job.key]
    if (!rule) { out.push(`job ${job.key} holds a write permission (${writes.map(([s, l]) => `${s}: ${l}`).join(', ')}) but is not a gated write job`); continue }
    const scopes = writes.map(([scope]) => scope).sort()
    if (JSON.stringify(scopes) !== JSON.stringify([...rule.scopes].sort())) out.push(`job ${job.key} holds write scopes ${scopes.join(', ')}, allowed ${rule.scopes.join(', ')}`)
    out.push(...gateProblems(job.key, fieldOf(job, 'if') ?? '', rule))
    for (const step of stepsOf(job)) {
      if (step.uses && !rule.actions.some((a) => step.uses.startsWith(`${a}@`))) out.push(`write job ${job.key} uses ${step.uses}, which is not on its list`)
    }
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (!splitJobs(text).some((j) => j.key === key)) out.push(`the gated job ${key} is missing (the gate ${rule.gate} guards nothing)`)
  }
  return out
}

/** Every action pinned by a full commit SHA, every checkout without a kept token, no secret, no continue-on-error. */
export function supplyProblems(text) {
  const out = []
  for (const step of allSteps(text)) {
    if (!step.uses) continue
    const [action, ref] = step.uses.replace(/\s+#.*$/, '').split('@')
    if (!SHA.test(ref ?? '')) out.push(`${step.job}: ${action} is not pinned by a full commit SHA (${ref})`)
    if (!/#\s*v\d/.test(step.uses)) out.push(`${step.job}: ${action} has no release in a trailing comment`)
    if (action === 'actions/checkout' && step.with['persist-credentials'] !== 'false') out.push(`${step.job}: checkout keeps the token`)
  }
  if (/secrets\./.test(text)) out.push('the workflow reads a secret')
  if (/continue-on-error/.test(text)) out.push('continue-on-error: a failed step would pass')
  return out
}

/** Nothing of the caller's is pasted into a script: a run block holds no ${{ expression }}, so no input can become code. */
export function injectionProblems(text) {
  return allSteps(text).filter((s) => s.run.includes('${{')).map((s) => `${s.job}: step "${s.name}" pastes an expression into its script`)
}

/** The release workflow runs on dispatch and on nothing else. */
export function releaseTriggerProblems(text) {
  const events = Object.keys(triggersOf(text))
  return JSON.stringify(events) === JSON.stringify(['workflow_dispatch']) ? [] : [`the release workflow has the triggers ${events.join(', ') || 'none'}, not only workflow_dispatch`]
}

/** Weekly, on dispatch, and on a push that touches this file alone. */
export function driftTriggerProblems(text, ownPath) {
  const out = []
  const events = triggersOf(text)
  if (JSON.stringify(Object.keys(events).sort()) !== JSON.stringify(['push', 'schedule', 'workflow_dispatch'])) out.push(`the triggers are ${Object.keys(events).join(', ') || 'none'}, not push, schedule and workflow_dispatch`)
  const push = events.push?.lines.join('\n') ?? ''
  const paths = [...push.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((m) => m[1])
  if (!/^\s+paths:/m.test(push)) out.push('no push trigger with a paths filter, so the first run cannot happen on the wave branch')
  else if (JSON.stringify(paths) !== JSON.stringify([ownPath])) out.push(`the push paths are ${paths.join(', ')}, not only ${ownPath}`)
  if (/^\s+(tags|tags-ignore|branches-ignore):/m.test(push)) out.push('the push trigger filters tags or ignores branches')
  const cron = /cron:\s*['"]([^'"]+)['"]/.exec(events.schedule?.lines.join('\n') ?? '')
  const weekdays = cron ? (cron[1].trim().split(/\s+/)[4] ?? '') : ''
  if (!cron) out.push('no cron schedule')
  else if (!weekdays.includes(',') && !/[-*]/.test(weekdays)) out.push(`the cron '${cron[1]}' names one weekday: the saved state (a cache entry) is evicted after seven days, so it must be read at least twice a week`)
  return out
}

const CARGO_LOCKED = /\bcargo\s+(tauri\s+build|install|tree|build|check|test|clippy|fetch|metadata)\b/
/** Every cargo command that resolves dependencies says --locked; and the workflow has at least one. */
export function lockedProblems(text) {
  const out = []
  let seen = 0
  for (const step of allSteps(text)) {
    for (const line of step.run.split('\n')) {
      if (!CARGO_LOCKED.test(line) || /\bthrow\b/.test(line)) continue
      seen += 1
      if (!/--locked\b/.test(line)) out.push(`${step.job}: "${line.trim()}" has no --locked`)
    }
  }
  if (seen === 0) out.push('no cargo command resolves dependencies, so --locked is never checked')
  return out
}

// ---- the real files satisfy the guards -----------------------------------------------------------------------------------------

test('webview2-drift.yml: read-only workflow token; the one write job is the issue opener, gated by NQT_DRIFT_ISSUES', () => {
  assert.deepEqual(permissionProblems(DRIFT, DRIFT_WRITE_RULES), [])
  const issues = splitJobs(DRIFT).find((j) => j.key === 'issues')
  assert.deepEqual(permissionsAt(issues.lines, 4), { issues: 'write' })
  assert.deepEqual(gateProblems('issues', fieldOf(issues, 'if'), DRIFT_WRITE_RULES.issues), [], 'a branch push never opens an issue')
})

test('desktop-release.yml: read-only workflow token; the one write job is the attestation, gated by NQT_ATTEST', () => {
  assert.deepEqual(permissionProblems(RELEASE, RELEASE_WRITE_RULES), [])
  const attest = splitJobs(RELEASE).find((j) => j.key === 'attest')
  assert.deepEqual(permissionsAt(attest.lines, 4), { attestations: 'write', contents: 'read', 'id-token': 'write' })
  assert.match(fieldOf(attest, 'needs') ?? '', /build/, 'the attestation follows the build')
})

test('desktop-release.yml: the attest job is tied to the main branch, so a dispatch from another branch is never signed', () => {
  const attest = splitJobs(RELEASE).find((j) => j.key === 'attest')
  assert.match(fieldOf(attest, 'if') ?? '', ATTEST_REF_GATE, 'the attest job needs github.ref == refs/heads/main in its if')
})

test('desktop-release.yml runs on dispatch only (no tag, no push, no schedule until an MSVC release is accepted, O20)', () => {
  assert.deepEqual(releaseTriggerProblems(RELEASE), [])
})

test('webview2-drift.yml runs weekly, on dispatch and on a push to its own path (the wave branch gets a first run)', () => {
  assert.deepEqual(driftTriggerProblems(DRIFT, '.github/workflows/webview2-drift.yml'), [])
})

test('desktop-release.yml builds with --locked everywhere', () => {
  assert.deepEqual(lockedProblems(RELEASE), [])
})

test('both workflows: actions pinned by commit SHA, no secrets, no continue-on-error, no expression pasted into a script', () => {
  for (const [name, text] of [['webview2-drift.yml', DRIFT], ['desktop-release.yml', RELEASE]]) {
    assert.deepEqual(supplyProblems(text), [], name)
    assert.deepEqual(injectionProblems(text), [], name)
  }
})

test('both workflows run on windows-2025 with a time limit on every job, and cancel nothing mid-build', () => {
  for (const [name, text] of [['webview2-drift.yml', DRIFT], ['desktop-release.yml', RELEASE]]) {
    for (const job of splitJobs(text)) {
      assert.equal(fieldOf(job, 'runs-on'), 'windows-2025', `${name} ${job.key}`)
    }
    for (const job of splitJobs(text)) assert.match(fieldOf(job, 'timeout-minutes') ?? '', /^\d+$/, `${name} ${job.key} has a time limit`)
    assert.match(text, /cancel-in-progress: false/, `${name} never cancels a run mid-way`)
  }
})

// ---- what the drift workflow does ------------------------------------------------------------------------------------------------

const driftSteps = () => stepsOf(splitJobs(DRIFT).find((j) => j.key === 'drift'))
const stepById = (id) => driftSteps().find((s) => s.id === id)

test('the drift job reads the runner runtime, compares it with the last run, and runs the advisory check on a feed read with the job token', () => {
  const text = driftSteps().map((s) => `${s.uses ?? ''}\n${s.run}`).join('\n')
  assert.match(text, /F3017226-FE2A-4295-8BDF-00C3A9A7E4C5/, 'the WebView2 runtime client key')
  assert.match(text, /desktop\/scripts\/advisories\.mjs/)
  assert.match(text, /--feed-file/, 'the feed is read through gh with the job token, not anonymously')
  assert.match(text, /--state/, 'the last-seen advisory date lives in the carried state')
  const restore = driftSteps().find((s) => (s.uses ?? '').startsWith('actions/cache/restore@'))
  const save = driftSteps().find((s) => (s.uses ?? '').startsWith('actions/cache/save@'))
  assert.ok(restore && save, 'the state is restored and saved')
  assert.equal(save.if, '${{ success() }}', 'the state moves on only after a clean run (a drift stays red until it is accepted)')
  const names = driftSteps().map((s) => s.name)
  assert.ok(names.indexOf(restore.name) < names.indexOf(stepById('webview2').name), 'the state is restored before it is read')
  assert.ok(names.indexOf(stepById('advisories').name) < names.indexOf(save.name), 'the state is saved after both checks')
})

test('the advisory step runs even when the runtime check failed, so one run reports both', () => {
  assert.match(stepById('advisories').if ?? '', /!cancelled\(\)/)
})

test('the issue job opens an issue through the job token, with the run link, and reads nothing of the checkout', () => {
  const issues = splitJobs(DRIFT).find((j) => j.key === 'issues')
  const steps = stepsOf(issues)
  assert.ok(steps.some((s) => /gh issue create/.test(s.run)))
  assert.ok(steps.every((s) => !s.uses), 'the write job uses no action at all')
  assert.match(fieldOf(issues, 'if'), /needs\.drift\.result == 'failure'/)
})

// ---- what the release workflow does ----------------------------------------------------------------------------------------------

test('the release build: MSVC release feature set, NSIS, artefact check, checksums, an uploaded artefact, no release and no signing', () => {
  const build = stepsOf(splitJobs(RELEASE).find((j) => j.key === 'build'))
  const text = build.map((s) => `${s.uses ?? ''}\n${s.run}`).join('\n')
  assert.match(text, /cargo tauri build --bundles nsis -- --locked/)
  assert.doesNotMatch(text, /--features|--no-default-features/, 'the release feature set is the default one')
  assert.match(text, /cargo tree -e features --locked/, 'the feature tree is read before the build')
  assert.match(text, /\(smoke\|measure\)/, 'and refuses a smoke or measure feature')
  assert.match(text, /desktop\/scripts\/artefact-check\.mjs/)
  assert.match(text, /SHA256SUMS/)
  assert.match(text, /webview2-bootstrapper\.ps1/, 'the embedded bootstrapper is verified, as build-release.ps1 does')
  assert.match(text, /--remap-path-prefix/, 'the runner paths are kept out of the binaries')
  assert.ok(build.some((s) => (s.uses ?? '').startsWith('actions/upload-artifact@')))
  assert.equal(build.find((s) => (s.uses ?? '').startsWith('actions/upload-artifact@')).with['if-no-files-found'], 'error')
  assert.doesNotMatch(RELEASE, /gh release|action-gh-release|signtool|Set-AuthenticodeSignature|certificate/i, 'no GitHub release and no signing')
  assert.doesNotMatch(RELEASE, /actions\/cache/, 'a release build restores no cache')
})

test('every build step names its exit code check (a native command that fails stops the job)', () => {
  for (const step of stepsOf(splitJobs(RELEASE).find((j) => j.key === 'build'))) {
    const natives = step.run.split('\n').filter((l) => /^\s*(cargo|rustup|node|powershell|rustc)\b/.test(l))
    for (const line of natives) {
      const at = step.run.indexOf(line)
      const after = step.run.slice(at + line.length).split('\n').slice(0, 3).join('\n')
      assert.match(after, /LASTEXITCODE -ne 0/, `step "${step.name}": the exit code of "${line.trim()}" is read`)
    }
  }
})

// ---- born failing: each guard names the broken copy -----------------------------------------------------------------------------

test('born failing: a write permission outside the gated jobs is named', () => {
  const widenedTop = RELEASE.replace('permissions:\n  contents: read', 'permissions:\n  contents: write')
  assert.notEqual(widenedTop, RELEASE)
  assert.ok(permissionProblems(widenedTop, RELEASE_WRITE_RULES).some((p) => /not exactly/.test(p)))
  const buildJob = RELEASE.replace(/(  build:\n(?:.*\n)*?    runs-on: windows-2025\n)/, '$1    permissions:\n      contents: read\n      id-token: write\n')
  assert.notEqual(buildJob, RELEASE)
  assert.ok(permissionProblems(buildJob, RELEASE_WRITE_RULES).some((p) => /job build holds a write permission/.test(p)))
  const writeAll = DRIFT.replace(/(  drift:\n(?:.*\n)*?    runs-on: windows-2025\n)/, '$1    permissions: write-all\n')
  assert.notEqual(writeAll, DRIFT)
  assert.ok(permissionProblems(writeAll, DRIFT_WRITE_RULES).some((p) => /job drift holds a write permission/.test(p)))
})

test('born failing: a gated write job without its variable gate, with an extra scope or with an extra action is named', () => {
  const ungated = RELEASE.replace(/vars\.NQT_ATTEST == 'on'/g, 'true')
  assert.ok(permissionProblems(ungated, RELEASE_WRITE_RULES).some((p) => /without the gate/.test(p)))
  const extraScope = DRIFT.replace('      issues: write', '      issues: write\n      pull-requests: write')
  assert.notEqual(extraScope, DRIFT)
  assert.ok(permissionProblems(extraScope, DRIFT_WRITE_RULES).some((p) => /write scopes/.test(p)))
  const extraAction = DRIFT.replace(/(  issues:\n(?:.*\n)*?    steps:\n)/, '$1      - name: Check out\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n')
  assert.notEqual(extraAction, DRIFT)
  assert.ok(permissionProblems(extraAction, DRIFT_WRITE_RULES).some((p) => /not on its list/.test(p)))
})

test('born failing: an `||` that defeats a gate, a negation, or a dropped push exclusion is named', () => {
  const orTrue = RELEASE.replace("github.ref == 'refs/heads/main' }}", "github.ref == 'refs/heads/main' || true }}")
  assert.notEqual(orTrue, RELEASE)
  assert.ok(permissionProblems(orTrue, RELEASE_WRITE_RULES).some((p) => /weakens the gate/.test(p) && /attest/.test(p)))
  const reordered = DRIFT.replace("&& vars.NQT_DRIFT_ISSUES == 'on' && github.event_name != 'push' }}", "&& github.event_name != 'push' || vars.NQT_DRIFT_ISSUES == 'on' }}")
  assert.notEqual(reordered, DRIFT)
  assert.ok(permissionProblems(reordered, DRIFT_WRITE_RULES).some((p) => /weakens the gate/.test(p) && /issues/.test(p)))
  const negated = RELEASE.replace("${{ vars.NQT_ATTEST == 'on' &&", "${{ !(vars.NQT_ATTEST != 'on') &&")
  assert.notEqual(negated, RELEASE)
  assert.ok(permissionProblems(negated, RELEASE_WRITE_RULES).length > 0)
  const noPushExclusion = DRIFT.replace(" && github.event_name != 'push' }}", ' }}')
  assert.notEqual(noPushExclusion, DRIFT)
  assert.ok(permissionProblems(noPushExclusion, DRIFT_WRITE_RULES).some((p) => /github\.event_name != 'push'/.test(p)))
  const wrongEquals = RELEASE.replace("vars.NQT_ATTEST == 'on'", "vars.NQT_ATTEST == 'on' == true")
  assert.ok(permissionProblems(wrongEquals, RELEASE_WRITE_RULES).length > 0)
})

test('born failing: an attest job without the main-branch ref condition is named', () => {
  const unbound = RELEASE.replace(/ && github\.ref == 'refs\/heads\/main'/g, '')
  assert.notEqual(unbound, RELEASE)
  const attest = splitJobs(unbound).find((j) => j.key === 'attest')
  assert.doesNotMatch(fieldOf(attest, 'if') ?? '', ATTEST_REF_GATE)
})

test('born failing: a tag trigger on the release workflow is named', () => {
  const tagged = RELEASE.replace(/^on:\n/m, "on:\n  push:\n    tags: ['desktop-v*']\n")
  assert.notEqual(tagged, RELEASE)
  assert.ok(releaseTriggerProblems(tagged).length > 0)
  assert.ok(releaseTriggerProblems(RELEASE.replace(/^on:\n/m, 'on:\n  release:\n    types: [created]\n')).length > 0)
})

test('born failing: a missing --locked is named, and so is a workflow with no cargo command at all', () => {
  assert.ok(lockedProblems(RELEASE.replace('cargo tauri build --bundles nsis -- --locked', 'cargo tauri build --bundles nsis')).some((p) => /no --locked/.test(p)))
  assert.ok(lockedProblems(RELEASE.replace(/cargo install tauri-cli(.*?) --locked/, 'cargo install tauri-cli$1')).some((p) => /no --locked/.test(p)))
  assert.ok(lockedProblems(RELEASE.replace(/cargo /g, 'cargo-not ')).some((p) => /never checked/.test(p)))
})

test('born failing: a drift workflow without its own push-path trigger is named', () => {
  const own = '.github/workflows/webview2-drift.yml'
  const noPush = DRIFT.replace(/  push:\n    paths:\n      - .*\n/, '')
  assert.notEqual(noPush, DRIFT)
  assert.ok(driftTriggerProblems(noPush, own).length > 0)
  const noPaths = DRIFT.replace(/  push:\n    paths:\n      - .*\n/, '  push:\n    branches: [main]\n')
  assert.ok(driftTriggerProblems(noPaths, own).some((p) => /paths filter/.test(p)))
  const wide = DRIFT.replace(/(  push:\n    paths:\n      - .*\n)/, '$1      - desktop/**\n')
  assert.ok(driftTriggerProblems(wide, own).some((p) => /not only/.test(p)))
  assert.ok(driftTriggerProblems(DRIFT.replace(/  schedule:\n.*\n/, ''), own).length > 0)
})

test('born failing: an unpinned action, a secret, a kept checkout token and an expression in a script are named', () => {
  assert.ok(supplyProblems(DRIFT.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7')).some((p) => /not pinned/.test(p)))
  assert.ok(supplyProblems(RELEASE.replace('persist-credentials: false', 'persist-credentials: true')).some((p) => /keeps the token/.test(p)))
  assert.ok(supplyProblems(`${RELEASE}\n# GH_TOKEN: \${{ secrets.PAT }}\n`).some((p) => /secret/.test(p)))
  assert.ok(supplyProblems(DRIFT.replace(/(\n    steps:\n)/, '$1      - name: Hold on\n        continue-on-error: true\n        run: echo\n')).some((p) => /continue-on-error/.test(p)))
  const pasted = DRIFT.replace('Write-Host "drift' , 'Write-Host "${{ github.event.inputs.accept }} drift')
  const withExpression = pasted === DRIFT ? DRIFT.replace(/(\n        run: \|\n)/, '$1          Write-Host "${{ github.head_ref }}"\n') : pasted
  assert.ok(injectionProblems(withExpression).length > 0)
})

// ---- the two steps whose logic lives in the workflow, run for real under PowerShell ----------------------------------------------

function powershell() {
  for (const exe of ['pwsh', 'powershell']) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { windowsHide: true })
    if (probe.status === 0) return exe
  }
  return null
}
const SHELL = process.platform === 'win32' ? powershell() : null

const compare = (t) => {
  if (!SHELL) { t.skip('no PowerShell on this machine'); return null }
  const step = stepById('compare')
  assert.ok(step, 'the drift job has a step with the id compare')
  return step
}
const FLOOR_MAJOR = 154
const seed = (dir, version) => {
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'state', 'webview2.json'), JSON.stringify({ version, source: 'webview2-hklm' }))
}
/** Runs the compare step against a state seeded with `previous` (or none). */
function compareRun(step, { previous, current, accept = '', event = '', floor = FLOOR_MAJOR }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-seed-'))
  if (previous) seed(dir, previous)
  return runStepIn(step, dir, { NQT_CURRENT: current, NQT_SOURCE: 'webview2-hklm', NQT_ACCEPT: accept, GITHUB_EVENT_NAME: event, NQT_FLOOR_MAJOR: floor === null ? '' : String(floor) })
}
function runStepIn(step, dir, env) {
  const script = path.join(dir, 'step.ps1')
  fs.writeFileSync(script, step.run, 'utf8')
  const files = { GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), GITHUB_OUTPUT: path.join(dir, 'output.txt'), NQT_STATE_DIR: path.join(dir, 'state'), NQT_FLOOR_MAJOR: String(FLOOR_MAJOR) }
  for (const f of [files.GITHUB_STEP_SUMMARY, files.GITHUB_OUTPUT]) fs.writeFileSync(f, '')
  const r = spawnSync(SHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...files, ...env }, timeout: 60_000 })
  const stateFile = path.join(files.NQT_STATE_DIR, 'webview2.json')
  return {
    code: r.status, text: `${r.stdout}${r.stderr}`, summary: fs.readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8'),
    state: fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null,
  }
}

test('compare step: the first run records the runtime and passes', (t) => {
  const step = compare(t)
  if (!step) return
  const r = compareRun(step, { previous: null, current: '154.0.4258.62' })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.state.version, '154.0.4258.62')
  assert.match(r.summary, /first run/i)
})

test('born failing: a scheduled run with no recorded baseline warns that the state was lost (cache evicted) instead of recording one silently', (t) => {
  const step = compare(t)
  if (!step) return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-seed-'))
  const scheduled = runStepIn(step, dir, { NQT_CURRENT: '154.0.4258.62', NQT_SOURCE: 'webview2-hklm', NQT_ACCEPT: '', GITHUB_EVENT_NAME: 'schedule' })
  assert.equal(scheduled.code, 0, scheduled.text)
  assert.match(scheduled.text, /::warning[^\r\n]*baseline/i,'a scheduled run that finds no state says so in an annotation')
  const pushed = runStepIn(step, fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-seed-')), { NQT_CURRENT: '154.0.4258.62', NQT_SOURCE: 'webview2-hklm', NQT_ACCEPT: '', GITHUB_EVENT_NAME: 'push' })
  assert.equal(pushed.code, 0, pushed.text)
  assert.doesNotMatch(pushed.text, /::warning/, 'the first run on a branch is expected to record a baseline')
})

test('compare step: a build inside the same major is noted, recorded and passes', (t) => {
  const step = compare(t)
  if (!step) return
  const r = compareRun(step, { previous: '154.0.4258.62', current: '154.0.4300.10' })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.state.version, '154.0.4300.10')
  assert.match(r.summary, /same major/i)
})

test('born failing: compare step fails on a new major runtime and leaves the recorded version alone', (t) => {
  const step = compare(t)
  if (!step) return
  const r = compareRun(step, { previous: '154.0.4258.62', current: '155.0.100.1' })
  assert.notEqual(r.code, 0, 'a new major must fail the run')
  assert.equal(r.state.version, '154.0.4258.62', 'the state does not move until the drift is accepted')
  assert.match(r.summary, /new major/i)
})

test('compare step: a dispatch with accept moves the recorded version past a new major and passes', (t) => {
  const step = compare(t)
  if (!step) return
  const r = compareRun(step, { previous: '154.0.4258.62', current: '155.0.100.1', accept: 'true' })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.state.version, '155.0.100.1')
})

test('compare step: a version that is not four numbers fails closed', (t) => {
  const step = compare(t)
  if (!step) return
  assert.notEqual(compareRun(step, { previous: null, current: 'not-a-version' }).code, 0)
  assert.notEqual(compareRun(step, { previous: null, current: '' }).code, 0)
})

test('born failing: a scheduled, pushed or dispatched run with no saved state fails on a major above the committed floor and records nothing', (t) => {
  const step = compare(t)
  if (!step) return
  for (const event of ['schedule', 'push', 'workflow_dispatch']) {
    const r = compareRun(step, { previous: null, current: '155.0.100.1', event })
    assert.notEqual(r.code, 0, `${event}: a new major over the floor must fail even with no saved state`)
    assert.equal(r.state, null, `${event}: nothing is recorded while the drift is unaccepted`)
    assert.match(r.summary, /new major/i)
  }
  const accepted = compareRun(step, { previous: null, current: '155.0.100.1', event: 'workflow_dispatch', accept: 'true' })
  assert.equal(accepted.code, 0, accepted.text)
  assert.equal(accepted.state.version, '155.0.100.1')
})

test('born failing: a floor that is missing, empty, not a number or below 1 fails closed', (t) => {
  const step = compare(t)
  if (!step) return
  for (const floor of [null, 'abc', '0', '-3']) {
    const r = compareRun(step, { previous: null, current: '154.0.4258.62', accept: 'true', event: 'push', floor })
    assert.notEqual(r.code, 0, `floor '${floor}' must stop the run`)
    assert.equal(r.state, null)
  }
})

test('compare step: a saved state older than the floor does not outvote it, and a raised floor is accepted', (t) => {
  const step = compare(t)
  if (!step) return
  assert.notEqual(compareRun(step, { previous: '153.0.1.1', current: '155.0.100.1' }).code, 0, 'the floor (154) is the baseline, not the older state')
  assert.equal(compareRun(step, { previous: '153.0.1.1', current: '154.0.9.9' }).code, 0)
  assert.equal(compareRun(step, { previous: null, current: '155.0.100.1', floor: 155 }).code, 0, 'a floor raised after a review accepts that major')
})

test('the floor is a whole-number literal in the compare step, so a change to it is a reviewed change in a commit', () => {
  const step = stepById('compare')
  assert.match(String(step.env?.NQT_FLOOR_MAJOR ?? ''), /^[1-9]\d*$/, 'NQT_FLOOR_MAJOR is a literal major of 1 or more')
  assert.ok(!/\$\{\{/.test(String(step.env?.NQT_FLOOR_MAJOR ?? '')), 'the floor is not an expression')
})

test('born failing: a drift schedule that names one weekday is named', () => {
  assert.deepEqual(driftTriggerProblems(DRIFT, '.github/workflows/webview2-drift.yml'), [])
  const weekly = DRIFT.replace(/cron: '17 6 \* \* 1,4'/, "cron: '17 6 * * 1'")
  assert.notEqual(weekly, DRIFT)
  assert.ok(driftTriggerProblems(weekly, '.github/workflows/webview2-drift.yml').some((p) => /one weekday/.test(p)))
})

test('runtime step: reports a four-number version and its source on this machine, or fails closed saying why', (t) => {
  if (!SHELL) return t.skip('no PowerShell on this machine')
  const step = stepById('webview2')
  assert.ok(step, 'the drift job has a step with the id webview2')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqt-rt-'))
  const r = runStepIn(step, dir, {})
  if (r.code !== 0) {
    assert.match(r.text, /no WebView2/i, 'a machine without a runtime fails with a reason')
    return t.skip('this machine has neither a WebView2 runtime nor Edge')
  }
  const output = fs.readFileSync(path.join(dir, 'output.txt'), 'utf8')
  assert.match(output, /^version=\d+\.\d+\.\d+\.\d+$/m)
  assert.match(output, /^source=(webview2-hklm|webview2-hkcu|edge-stable-hklm)$/m)
})

// ---- actionlint, where this machine has it ---------------------------------------------------------------------------------------

test('actionlint finds nothing in either workflow (skipped where it is not installed)', (t) => {
  const candidates = [process.env.ACTIONLINT, 'D:/dev/tools/actionlint/1.7.12/actionlint.exe', 'D:/dev/tools/actionlint.exe'].filter(Boolean)
  const exe = candidates.find((c) => fs.existsSync(c))
  if (!exe) return t.skip('actionlint is not installed here')
  const r = spawnSync(exe, [path.join(WORKFLOWS, 'webview2-drift.yml'), path.join(WORKFLOWS, 'desktop-release.yml')], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
})
