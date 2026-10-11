// Tests of scripts/osv_scan.mjs, the weekly known-vulnerability scan of the three lock files. Nothing here uses the
// network: every OSV answer is a fixture served by an injected fetch, or by a local server on a free port.
// Born failing: the script did not exist, and the guards below (a planted vulnerable version is reported, a lab package
// name never leaves the PC) each have a case that feeds the broken state. docs/desktop/v04/w2a-supply-chain__supply-chain.md
// records the mutation run that proves the two guards fail when their code is removed.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildBatch, cvssV3Score, isLabPackage, main, parseCargoLock, parsePnpmLock, parseUvLock, severityOf,
} from '../osv_scan.mjs'

const SCRIPT = fileURLToPath(new URL('../osv_scan.mjs', import.meta.url))

const PNPM_LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      nq-private-ui:
        specifier: 1.0.0
        version: 1.0.0

packages:

  '@scope/pkg@2.3.4':
    resolution: {integrity: sha512-aaa}

  '@nq/internal@1.0.0':
    resolution: {integrity: sha512-bbb}

  nq-private-ui@1.0.0:
    resolution: {integrity: sha512-ccc}

  source-map-js@1.2.1:
    resolution: {integrity: sha512-ddd}
    engines: {node: '>=0.10.0'}

  from-tarball@1.0.0:
    resolution: {tarball: https://example.com/from-tarball-1.0.0.tgz}

  from-git@1.0.0:
    resolution: {commit: abc123, repo: https://github.com/example/from-git.git, type: git}

snapshots:

  source-map-js@1.2.1: {}
`

const CARGO_LOCK = `version = 4

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "nq-shell"
version = "0.3.3"
dependencies = ["serde"]

[[package]]
name = "from-git"
version = "0.1.0"
source = "git+https://github.com/example/from-git?rev=abc#abc"

[[package]]
name = "sparse-crate"
version = "2.0.0"
source = "sparse+https://index.crates.io/"
`

const UV_LOCK = `version = 1
revision = 3

[[package]]
name = "nq-terminal-qa"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "pytest"
version = "9.0.2"
source = { registry = "https://pypi.org/simple" }
sdist = { url = "https://files.pythonhosted.org/x.tar.gz", hash = "sha256:00" }

[[package]]
name = "private-index-pkg"
version = "1.0.0"
source = { registry = "https://pypi.example.com/simple" }

[[package]]
name = "nq-helper"
version = "2.0.0"
source = { registry = "https://pypi.org/simple" }
`

/** An OSV stand-in: `vulns` maps "name@version" to ids, `records` maps an id to its record. Every request is kept. */
function fakeOsv({ vulns = {}, records = {}, status = 200, pages = {} } = {}) {
  const calls = []
  const reply = (body, code = 200) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body })
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method: init.method ?? 'GET', body, raw: init.body ?? '' })
    if (status !== 200) return reply({}, status)
    const u = new URL(url)
    if (u.pathname === '/v1/querybatch') {
      return reply({ results: body.queries.map((q) => {
        const key = `${q.package.name}@${q.version}`
        const first = (pages[key] ?? [vulns[key] ?? []])[0]
        const out = { vulns: first.map((id) => ({ id })) }
        if (pages[key] && pages[key].length > 1) out.next_page_token = 'p2'
        return out
      }) })
    }
    if (u.pathname === '/v1/query') {
      const key = `${body.package.name}@${body.version}`
      const rest = pages[key].slice(1)
      return reply({ vulns: rest.flat().map((id) => ({ id })) })
    }
    const id = decodeURIComponent(u.pathname.replace('/v1/vulns/', ''))
    return records[id] ? reply(records[id]) : reply({}, 404)
  }
  return { fetchImpl, calls }
}

const sleep = async () => {}
const HIGH_RECORD = { id: 'GHSA-high', summary: 'planted high', database_specific: { severity: 'HIGH' } }
const MODERATE_RECORD = { id: 'GHSA-mod', summary: 'planted moderate', database_specific: { severity: 'MODERATE' } }

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osv-scan-'))
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  return root
}
const FULL_TREE = () => makeTree({
  'web/pnpm-lock.yaml': PNPM_LOCK,
  'desktop/src-tauri/Cargo.lock': CARGO_LOCK,
  'qa/uv.lock': UV_LOCK,
})

async function run(argv, osv, extra = {}) {
  const out = []
  const err = []
  const code = await main(argv, { fetchImpl: osv.fetchImpl, sleep, stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...extra })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

test('pnpm lock: registry packages only, scoped names kept, tarball and git entries left out', () => {
  const names = parsePnpmLock(PNPM_LOCK).map((p) => `${p.name}@${p.version}`)
  assert.deepEqual(names, ['@nq/internal@1.0.0', '@scope/pkg@2.3.4', 'nq-private-ui@1.0.0', 'source-map-js@1.2.1'])
})

test('cargo lock: crates.io registry packages only (a path crate and a git crate are left out)', () => {
  const names = parseCargoLock(CARGO_LOCK).map((p) => `${p.name}@${p.version}`)
  assert.deepEqual(names, ['serde@1.0.200', 'sparse-crate@2.0.0'])
})

test('uv lock: the public index only (an editable project and a private index are left out)', () => {
  const names = parseUvLock(UV_LOCK).map((p) => `${p.name}@${p.version}`)
  assert.deepEqual(names, ['nq-helper@2.0.0', 'pytest@9.0.2'])
})

test('lab package names are recognised, public ones are not', () => {
  for (const name of ['nq-lab', 'nq_terminal', 'NQ-Terminal-QA', '@nq/internal', '@nq-lab/ui', 'nqueens']) assert.equal(isLabPackage(name), true, name)
  for (const name of ['pytest', 'source-map-js', '@scope/pkg', 'anq-tools', '@tailwindcss/vite']) assert.equal(isLabPackage(name), false, name)
})

test('a request never carries a lab package name: building one with it is refused', () => {
  assert.throws(() => buildBatch('PyPI', [{ name: 'nq-helper', version: '2.0.0' }]), /lab package/i)
  const body = buildBatch('PyPI', [{ name: 'pytest', version: '9.0.2' }])
  assert.deepEqual(body, { queries: [{ package: { name: 'pytest', ecosystem: 'PyPI' }, version: '9.0.2' }] })
})

test('severity: a label wins, a CVSS 3 vector is scored, anything else is unrated', () => {
  assert.equal(severityOf({ database_specific: { severity: 'HIGH' } }), 'HIGH')
  assert.equal(severityOf({ database_specific: { severity: 'medium' } }), 'MODERATE')
  assert.equal(severityOf({ affected: [{ ecosystem_specific: { severity: 'critical' } }] }), 'CRITICAL')
  assert.equal(severityOf({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] }), 'CRITICAL')
  assert.equal(severityOf({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L' }] }), 'MODERATE')
  assert.equal(severityOf({ summary: 'unmaintained' }), 'UNRATED')
  assert.equal(cvssV3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H'), 7.5)
  assert.equal(cvssV3Score('not a vector'), null)
})

test('a planted vulnerable version is reported and fails the scan', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['GHSA-high'] }, records: { 'GHSA-high': HIGH_RECORD } })
  const { code, out } = await run(['--root', root], osv)
  assert.equal(code, 1)
  assert.match(out, /source-map-js@1\.2\.1/)
  assert.match(out, /GHSA-high/)
  assert.match(out, /HIGH/)
})

const MAL_RECORD = { id: 'MAL-2024-1000', summary: 'Malicious code in custom-solutions (npm)', database_specific: { 'malicious-packages-origins': [{ source: 'ossf-package-analysis' }] } }

test('severity: a malicious-package record (MAL-*, or carrying malicious-packages-origins) is CRITICAL even with no rating', () => {
  assert.equal(severityOf(MAL_RECORD), 'CRITICAL')
  assert.equal(severityOf({ id: 'MAL-2023-100', summary: 'Malicious code' }), 'CRITICAL')
  assert.equal(severityOf({ id: 'GHSA-x', database_specific: { 'malicious-packages-origins': [] } }), 'CRITICAL')
  assert.equal(severityOf({ id: 'GHSA-x', summary: 'unmaintained' }), 'UNRATED')
})

test('a known-malicious package with no severity field fails the scan, whatever --fail-on says', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['MAL-2024-1000'] }, records: { 'MAL-2024-1000': MAL_RECORD } })
  const high = await run(['--root', root], osv)
  assert.equal(high.code, 1)
  assert.match(high.out, /MAL-2024-1000/)
  assert.match(high.out, /CRITICAL/)
  assert.equal((await run(['--root', root, '--fail-on', 'critical'], osv)).code, 1)
})

test('a moderate advisory is listed but does not fail; a clean tree passes', async () => {
  const root = FULL_TREE()
  const moderate = await run(['--root', root], fakeOsv({ vulns: { 'pytest@9.0.2': ['GHSA-mod'] }, records: { 'GHSA-mod': MODERATE_RECORD } }))
  assert.equal(moderate.code, 0)
  assert.match(moderate.out, /pytest@9\.0\.2/)
  assert.match(moderate.out, /MODERATE/)
  const clean = await run(['--root', root], fakeOsv())
  assert.equal(clean.code, 0)
  assert.match(clean.out, /no advisory at HIGH or above/i)
})

test('--fail-on moderate also fails on a moderate advisory', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({ vulns: { 'pytest@9.0.2': ['GHSA-mod'] }, records: { 'GHSA-mod': MODERATE_RECORD } })
  assert.equal((await run(['--root', root, '--fail-on', 'moderate'], osv)).code, 1)
})

test('a withdrawn advisory is ignored', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['GHSA-high'] }, records: { 'GHSA-high': { ...HIGH_RECORD, withdrawn: '2026-10-01T00:00:00Z' } } })
  assert.equal((await run(['--root', root], osv)).code, 0)
})

test('an nq* name never leaves the PC: no request holds one, the report counts them and names none', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv()
  const outFile = path.join(root, 'report.json')
  const { code } = await run(['--root', root, '--out', outFile], osv)
  assert.equal(code, 0)
  assert.ok(osv.calls.length > 0, 'the scan did send its public packages')
  for (const call of osv.calls) {
    assert.doesNotMatch(`${call.url} ${call.raw}`, /nq/i, `request ${call.url} carries a lab name`)
  }
  const sent = osv.calls.filter((c) => c.body).flatMap((c) => c.body.queries.map((q) => q.package.name))
  assert.ok(sent.includes('source-map-js') && sent.includes('serde') && sent.includes('pytest'))
  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  assert.equal(report.ecosystems.npm.withheld, 2)
  assert.equal(report.ecosystems.PyPI.withheld, 1)
  assert.doesNotMatch(JSON.stringify(report), /nq/i)
})

test('only names, versions and the ecosystem are sent', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv()
  await run(['--root', root], osv)
  for (const call of osv.calls.filter((c) => c.body)) {
    assert.deepEqual(Object.keys(call.body), ['queries'])
    for (const q of call.body.queries) {
      assert.deepEqual(Object.keys(q).sort(), ['package', 'version'])
      assert.deepEqual(Object.keys(q.package).sort(), ['ecosystem', 'name'])
    }
  }
  assert.ok(osv.calls.every((c) => new URL(c.url).origin === 'https://api.osv.dev'))
})

test('a second page of advisories for one package is followed', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({
    pages: { 'pytest@9.0.2': [['GHSA-mod'], ['GHSA-high']] },
    records: { 'GHSA-mod': MODERATE_RECORD, 'GHSA-high': HIGH_RECORD },
  })
  const { code, out } = await run(['--root', root], osv)
  assert.equal(code, 1)
  assert.match(out, /GHSA-high/)
})

test('a server error is retried, then fails the scan with exit 2 instead of passing', async () => {
  const root = FULL_TREE()
  const osv = fakeOsv({ status: 503 })
  const { code, err } = await run(['--root', root], osv)
  assert.equal(code, 2)
  assert.match(err, /503/)
  assert.ok(osv.calls.length >= 3, 'retried')
})

test('a short answer from the server fails the scan', async () => {
  const root = FULL_TREE()
  const short = { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) }
  const { code, err } = await run(['--root', root], short)
  assert.equal(code, 2)
  assert.match(err, /results/i)
})

test('a lock file that is missing, or that parses to no package, fails the scan', async () => {
  const missing = makeTree({ 'web/pnpm-lock.yaml': PNPM_LOCK, 'qa/uv.lock': UV_LOCK })
  const a = await run(['--root', missing], fakeOsv())
  assert.equal(a.code, 2)
  assert.match(a.err, /Cargo\.lock/)
  const empty = makeTree({ 'web/pnpm-lock.yaml': 'lockfileVersion: 9\n', 'desktop/src-tauri/Cargo.lock': CARGO_LOCK, 'qa/uv.lock': UV_LOCK })
  const b = await run(['--root', empty], fakeOsv())
  assert.equal(b.code, 2)
  assert.match(b.err, /no package/i)
})

test('an API address that is not https (or a local test server) is refused', async () => {
  const root = FULL_TREE()
  const { code, err } = await run(['--root', root, '--api', 'http://api.osv.dev'], fakeOsv())
  assert.equal(code, 2)
  assert.match(err, /https/)
})

test('the script runs as a command against a local server and exits with the verdict', async () => {
  const root = FULL_TREE()
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v1/querybatch') {
        const queries = JSON.parse(body).queries
        res.end(JSON.stringify({ results: queries.map((q) => ({ vulns: q.package.name === 'serde' ? [{ id: 'GHSA-high' }] : [] })) }))
      } else if (req.url === '/v1/vulns/GHSA-high') res.end(JSON.stringify(HIGH_RECORD))
      else { res.statusCode = 404; res.end('{}') }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const api = `http://127.0.0.1:${server.address().port}`
    const result = await runCommand([SCRIPT, '--root', root, '--api', api])
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /serde@1\.0\.200/)
  } finally {
    server.close()
  }
})

function runCommand(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

test('the real lock files of this tree parse to packages and name no lab package in a request', () => {
  const terminal = path.resolve(path.dirname(SCRIPT), '..')
  const read = (rel) => fs.readFileSync(path.join(terminal, rel), 'utf8')
  const sets = {
    npm: parsePnpmLock(read('web/pnpm-lock.yaml')),
    'crates.io': parseCargoLock(read('desktop/src-tauri/Cargo.lock')),
    PyPI: parseUvLock(read('qa/uv.lock')),
  }
  for (const [eco, packages] of Object.entries(sets)) {
    assert.ok(packages.length >= 5, `${eco} parsed to ${packages.length} packages`)
    const body = buildBatch(eco, packages.filter((p) => !isLabPackage(p.name)))
    assert.doesNotMatch(JSON.stringify(body), /"name":"nq/i)
  }
  assert.ok(sets.npm.some((p) => p.name === 'vitest'))
  assert.ok(sets['crates.io'].some((p) => p.name === 'serde'))
  assert.ok(sets.PyPI.some((p) => p.name === 'pytest'))
})

test('--help names the verdict codes and exits 0', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /exit 0.*exit 1.*exit 2/is)
})

test('--help through a junction to the scripts folder still prints and exits 0, never a silent no-op', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osv-junction-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const link = path.join(dir, 'jn')
  try {
    fs.symlinkSync(path.dirname(SCRIPT), link, 'junction')
  } catch (error) {
    t.skip(`cannot create a junction or symlink here: ${error.code}`)
    return
  }
  const r = spawnSync(process.execPath, [path.join(link, 'osv_scan.mjs'), '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /exit 0.*exit 1.*exit 2/is)
})

// ---- unrated advisories: counted, shown beside the verdict, optionally gating; a CVSS 4.0 vector is never unrated ----

const V4_VECTOR = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'
const V4_RECORD = { id: 'GHSA-v4', summary: 'rated only with CVSS 4', severity: [{ type: 'CVSS_V4', score: V4_VECTOR }] }
const UNRATED_RECORD = { id: 'RUSTSEC-0000-0001', summary: 'unmaintained, no rating' }

test('severity: a CVSS 4.0 vector alone is treated as HIGH, never unrated; a label still wins over it', () => {
  assert.equal(severityOf(V4_RECORD), 'HIGH')
  assert.equal(severityOf({ database_specific: { severity: 'LOW' }, severity: V4_RECORD.severity }), 'LOW')
  assert.equal(severityOf({ severity: [{ type: 'CVSS_V4', score: 'garbage' }] }), 'UNRATED')
})

test('an advisory rated only with a CVSS 4.0 vector fails the default scan', async () => {
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['GHSA-v4'] }, records: { 'GHSA-v4': V4_RECORD } })
  const { code, out } = await run(['--root', FULL_TREE()], osv)
  assert.equal(code, 1)
  assert.match(out, /GHSA-v4 \[HIGH\]/)
})

test('unrated advisories are counted in the output line, the closing line and the JSON report, and do not gate by default', async () => {
  const root = FULL_TREE()
  const outFile = path.join(root, 'report.json')
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['RUSTSEC-0000-0001'] }, records: { 'RUSTSEC-0000-0001': UNRATED_RECORD } })
  const { code, out } = await run(['--root', root, '--out', outFile], osv)
  assert.equal(code, 0)
  assert.match(out, /1 unrated advisories \(not gating\)/)
  assert.match(out, /ok: no advisory at HIGH or above \(1 unrated, not reviewed\)/)
  assert.equal(JSON.parse(fs.readFileSync(outFile, 'utf8')).unrated, 1)
})

test('a clean scan reports 0 unrated advisories', async () => {
  const outFile = path.join(FULL_TREE(), 'report.json')
  const root = path.dirname(outFile)
  const { code, out } = await run(['--root', root, '--out', outFile], fakeOsv())
  assert.equal(code, 0)
  assert.match(out, /0 unrated advisories \(not gating\)/)
  assert.equal(JSON.parse(fs.readFileSync(outFile, 'utf8')).unrated, 0)
})

test('--fail-on-unrated turns an unrated advisory into exit 1 and says so on the closing line', async () => {
  const osv = fakeOsv({ vulns: { 'source-map-js@1.2.1': ['RUSTSEC-0000-0001'] }, records: { 'RUSTSEC-0000-0001': UNRATED_RECORD } })
  const { code, out } = await run(['--root', FULL_TREE(), '--fail-on-unrated'], osv)
  assert.equal(code, 1)
  assert.match(out, /1 unrated advisories \(gating: --fail-on-unrated\)/)
  assert.match(out, /FAIL: 1 unrated advisories/)
  const clean = await run(['--root', FULL_TREE(), '--fail-on-unrated'], fakeOsv())
  assert.equal(clean.code, 0)
})

test('the scanner and its test keep LF line endings like the rest of the tree (born failing: both were written with CRLF)', () => {
  const carriageReturn = String.fromCharCode(13)
  for (const file of [SCRIPT, fileURLToPath(import.meta.url)]) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes(carriageReturn), `${path.basename(file)} has no carriage return`)
  }
})
