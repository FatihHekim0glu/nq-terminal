// The Rust job of .github/workflows/ci.yml (0.3.1, test-infra). Born failing: the workflow had one job and no Rust step.
// The job runs `cargo fmt --check` on windows-latest. Clippy and the unit tests are NOT in it, because the crate has never
// been built on the hosted MSVC host and this PC cannot check it (docs/desktop/ci.md records the reason); a clippy or test
// step may be added only with -D warnings and with that note updated. The rules of the whole workflow are checked as text
// so the hosted runner needs no YAML library; the YAML parse itself runs where the lab's interpreter has PyYAML.
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

test('ci.yml parses as YAML, keeps the read-only token, and has a Rust job on windows-latest', (t) => {
  const doc = parsed()
  if (!doc) return t.skip('no interpreter with PyYAML here')
  assert.deepEqual(doc.permissions, { contents: 'read' })
  assert.ok(doc.jobs.windows, 'the web job is still there')
  const rust = doc.jobs.rust
  assert.ok(rust, 'a job named rust')
  assert.equal(rust['runs-on'], 'windows-latest')
  assert.equal(rust.permissions, undefined, 'no job widens the token')
  assert.ok(Number.isInteger(rust['timeout-minutes']) && rust['timeout-minutes'] <= 30)
  for (const job of Object.values(doc.jobs)) assert.equal(job.permissions, undefined)
})

test('every action of every job is pinned by its full commit SHA, and the workflow reads no secret', () => {
  const uses = [...WORKFLOW.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1])
  assert.ok(uses.length >= 4, 'the workflow uses actions')
  for (const ref of uses) {
    const [name, sha] = ref.split('@')
    assert.match(sha ?? '', SHA, `${name} is pinned by a full commit SHA, not a tag`)
  }
  assert.doesNotMatch(WORKFLOW, /secrets\./)
  assert.doesNotMatch(WORKFLOW, /GITHUB_TOKEN|id-token|write-all/)
})

/** The text of the rust job: from its key to the end of the file (it is the last job). */
const rustJob = () => {
  const at = WORKFLOW.indexOf('\n  rust:')
  assert.ok(at > 0, 'a job named rust')
  return WORKFLOW.slice(at)
}

test('the Rust job installs the pinned toolchain from rust-toolchain.toml and runs cargo fmt --check in the crate', () => {
  const job = rustJob()
  assert.match(job, /runs-on: windows-latest/)
  assert.match(job, /path: terminal\b/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /working-directory: terminal\/desktop\/src-tauri/)
  assert.match(job, /rust-toolchain\.toml/, 'the channel is read from the pin, not repeated')
  assert.match(job, /rustup toolchain install \$channel .*--component rustfmt/)
  assert.match(job, /cargo fmt --check/)
  assert.match(job, /LASTEXITCODE -ne 0/, 'a failed install stops the job with its own message')
})

test('clippy and the unit tests are not in the workflow, and the doc says why and when they join', () => {
  assert.doesNotMatch(WORKFLOW, /cargo (clippy|test|build)/)
  assert.match(DOC, /## The Rust job/)
  assert.match(DOC, /cargo fmt --check/)
  assert.match(DOC, /clippy -D warnings/)
  assert.match(DOC, /never (been )?built on the (hosted )?MSVC/i, 'the reason is written down')
  assert.match(DOC, /REL-07/)
})

test('cargo fmt --check passes on the crate with the pinned toolchain (the local half of the CI step)', (t) => {
  const cargo = 'D:\\dev\\cargo\\bin\\cargo.exe'
  if (!fs.existsSync(cargo)) return t.skip('no toolchain under D:\\dev here')
  const env = { ...process.env, RUSTUP_HOME: 'D:\\dev\\rustup', CARGO_HOME: 'D:\\dev\\cargo', PATH: `D:\\dev\\cargo\\bin;${process.env.PATH}` }
  const r = spawnSync(cargo, ['fmt', '--check'], { cwd: CRATE, env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 2000))
})
