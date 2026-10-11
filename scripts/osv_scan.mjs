// Weekly known-vulnerability scan of the three lock files this repository owns, against the public OSV database
// (https://google.github.io/osv.dev/api/). Plain Node 24, no dependency, run by .github/workflows/supply-chain.yml.
//
//   node scripts/osv_scan.mjs [--root DIR] [--fail-on critical|high|moderate|low] [--fail-on-unrated] [--out FILE] [--api URL]
//
// Locks read, relative to the root (default: this repository): web/pnpm-lock.yaml (npm), desktop/src-tauri/Cargo.lock
// (crates.io) and qa/uv.lock (PyPI). What leaves the PC: the ecosystem, the package name and the version of each
// package from a public registry, sent to api.osv.dev, and the ids of advisories asked back. Nothing else. The lab's
// own packages (any name or scope starting with nq) are never sent: they are filtered when the lock is read and
// refused again when a request is built.
//
//   exit 0  no advisory at or above the threshold (default: high)
//   exit 1  at least one package with an advisory at or above the threshold
//   exit 2  the scan could not be completed: a lock is missing or empty, OSV did not answer, or an answer was short
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const OSV_API = 'https://api.osv.dev'
const BATCH_SIZE = 500
const RECORD_CONCURRENCY = 8
const ATTEMPTS = 3
const TIMEOUT_MS = 30_000
const RANKS = { UNRATED: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 }
const LOCKS = [
  { ecosystem: 'npm', file: 'web/pnpm-lock.yaml' },
  { ecosystem: 'crates.io', file: 'desktop/src-tauri/Cargo.lock' },
  { ecosystem: 'PyPI', file: 'qa/uv.lock' },
]
const CRATES_REGISTRIES = ['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/']
const PYPI_REGISTRY = 'https://pypi.org/simple'

class ScanError extends Error {}

// ---- lock file readers: every one keeps registry packages only and returns sorted, unique { name, version } ----

const uniqueSorted = (packages) => {
  const seen = new Map(packages.map((p) => [`${p.name}@${p.version}`, p]))
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** The `packages:` section of a pnpm v9 lock: `  name@version:` keys, with a `resolution:` line below each. */
export function parsePnpmLock(text) {
  const out = []
  let inPackages = false
  let key = null
  const flush = (resolution) => {
    if (!key || !resolution || !/integrity:/.test(resolution) || /tarball:|type: git|repo:/.test(resolution)) return
    const at = key.lastIndexOf('@')
    if (at > 0) out.push({ name: key.slice(0, at), version: key.slice(at + 1) })
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inPackages = /^packages:\s*$/.test(line); key = null; continue }
    if (!inPackages) continue
    const entry = /^ {2}(['"]?)(\S+)\1:\s*$/.exec(line)
    if (entry) { key = entry[2]; continue }
    const resolution = /^ {4}resolution:\s*(.*)$/.exec(line)
    if (resolution) { flush(resolution[1]); key = null }
  }
  return uniqueSorted(out)
}

function tomlPackages(text) {
  return text.split('[[package]]').slice(1).map((block) => ({
    name: /^name = "([^"]+)"/m.exec(block)?.[1],
    version: /^version = "([^"]+)"/m.exec(block)?.[1],
    source: /^source = (.+)$/m.exec(block)?.[1] ?? '',
  })).filter((p) => p.name && p.version)
}

export function parseCargoLock(text) {
  const registry = (source) => CRATES_REGISTRIES.some((r) => source === `"${r}"`)
  return uniqueSorted(tomlPackages(text).filter((p) => registry(p.source)).map(({ name, version }) => ({ name, version })))
}

export function parseUvLock(text) {
  const publicIndex = (source) => source.replace(/\s+/g, ' ') === `{ registry = "${PYPI_REGISTRY}" }`
  return uniqueSorted(tomlPackages(text).filter((p) => publicIndex(p.source)).map(({ name, version }) => ({ name, version })))
}

const READERS = { npm: parsePnpmLock, 'crates.io': parseCargoLock, PyPI: parseUvLock }

// ---- what may leave the PC ----

/** The lab's own packages: any name, or npm scope, that starts with nq. They are not on a public registry. */
export function isLabPackage(name) {
  const bare = String(name).toLowerCase().replace(/^@/, '')
  return bare.startsWith('nq')
}

export function buildBatch(ecosystem, packages) {
  const lab = packages.find((p) => isLabPackage(p.name))
  if (lab) throw new ScanError('refusing to send a lab package to OSV')
  return { queries: packages.map((p) => ({ package: { name: p.name, ecosystem }, version: p.version })) }
}

// ---- severity ----

const CVSS3_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 }, I: { H: 0.56, L: 0.22, N: 0 }, A: { H: 0.56, L: 0.22, N: 0 },
}
const roundUp = (x) => { const n = Math.round(x * 100000); return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10 }

/** The CVSS 3.x base score of a vector string, or null when it is not one. */
export function cvssV3Score(vector) {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null
  const m = Object.fromEntries(vector.split('/').slice(1).map((part) => part.split(':')))
  const w = CVSS3_WEIGHTS
  const changed = m.S === 'C'
  const privilege = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR]
  const parts = [w.AV[m.AV], w.AC[m.AC], privilege, w.UI[m.UI], w.C[m.C], w.I[m.I], w.A[m.A]]
  if (parts.some((p) => p === undefined) || (m.S !== 'U' && m.S !== 'C')) return null
  const iss = 1 - (1 - parts[4]) * (1 - parts[5]) * (1 - parts[6])
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss
  if (impact <= 0) return 0
  const exploit = 8.22 * parts[0] * parts[1] * parts[2] * parts[3]
  return roundUp(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10))
}

const label = (text) => {
  const up = String(text ?? '').toUpperCase()
  const named = up === 'MEDIUM' ? 'MODERATE' : up
  return named in RANKS && named !== 'UNRATED' ? named : null
}
/** CVSS 4.0 is not scored here: a v4 vector counts as HIGH (never silently unrated) unless it names no impact at all. */
const cvssV4Severity = (vector) => {
  if (!/^CVSS:4\.0\/AV:[NALP]\//.test(vector)) return null
  const m = Object.fromEntries(vector.split('/').slice(1).map((part) => part.split(':')))
  return ['VC', 'VI', 'VA', 'SC', 'SI', 'SA'].every((k) => m[k] === 'N') ? 'LOW' : 'HIGH'
}
const fromScore = (s) => (s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MODERATE' : 'LOW')

/** CRITICAL (always, for a malicious-package record), HIGH, MODERATE, LOW, or UNRATED when the record carries no usable rating (many RUSTSEC records). */
export function severityOf(record) {
  // OpenSSF malicious-package records (MAL-*) carry no severity or CVSS, yet a known-malicious dependency must always fail the scan.
  if (/^MAL-/i.test(String(record.id ?? '')) || record.database_specific?.['malicious-packages-origins'] !== undefined) return 'CRITICAL'
  const candidates = [record.database_specific?.severity]
  for (const a of record.affected ?? []) candidates.push(a.database_specific?.severity, a.ecosystem_specific?.severity)
  for (const c of candidates) if (label(c)) return label(c)
  for (const s of record.severity ?? []) {
    const score = cvssV3Score(String(s.score ?? ''))
    if (score !== null) return fromScore(score)
    const v4 = cvssV4Severity(String(s.score ?? ''))
    if (v4) return v4
  }
  return 'UNRATED'
}

// ---- talking to OSV ----

function checkedApi(api) {
  let url
  try { url = new URL(api) } catch { throw new ScanError(`the API address is not a URL: ${api}`) }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new ScanError(`the API address must be https (or a local test server): ${api}`)
  return url.origin
}

function makeClient(fetchImpl, sleep, origin) {
  async function request(pathname, init = {}) {
    let last = 'no attempt'
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const res = await fetchImpl(`${origin}${pathname}`, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), ...init })
        if (res.ok) return await res.json()
        last = `HTTP ${res.status}`
        if (res.status < 500 && res.status !== 429) break
      } catch (error) { last = String(error.message ?? error) }
      if (attempt < ATTEMPTS) await sleep(500 * attempt)
    }
    throw new ScanError(`OSV request ${pathname} failed: ${last}`)
  }
  const post = (pathname, body) => request(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { get: (pathname) => request(pathname), post }
}

async function advisoryIds(client, ecosystem, packages) {
  const hits = new Map()
  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const chunk = packages.slice(i, i + BATCH_SIZE)
    const { queries } = buildBatch(ecosystem, chunk)
    const results = (await client.post('/v1/querybatch', { queries })).results
    if (!Array.isArray(results) || results.length !== chunk.length) {
      throw new ScanError(`OSV returned ${Array.isArray(results) ? results.length : 'no'} results for ${chunk.length} queries`)
    }
    for (let j = 0; j < chunk.length; j += 1) {
      const ids = (results[j].vulns ?? []).map((v) => v.id)
      let token = results[j].next_page_token
      while (token) {
        const page = await client.post('/v1/query', { ...queries[j], page_token: token })
        ids.push(...(page.vulns ?? []).map((v) => v.id))
        token = page.next_page_token
      }
      if (ids.length) hits.set(chunk[j], [...new Set(ids)])
    }
  }
  return hits
}

async function fetchRecords(client, ids) {
  const records = new Map()
  for (let i = 0; i < ids.length; i += RECORD_CONCURRENCY) {
    const slice = ids.slice(i, i + RECORD_CONCURRENCY)
    const got = await Promise.all(slice.map((id) => client.get(`/v1/vulns/${encodeURIComponent(id)}`)))
    slice.forEach((id, k) => records.set(id, got[k]))
  }
  return records
}

// ---- the scan ----

function readLock(root, { ecosystem, file }) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) throw new ScanError(`lock file not found: ${file}`)
  const packages = READERS[ecosystem](fs.readFileSync(full, 'utf8'))
  if (packages.length === 0) throw new ScanError(`no package read from ${file}`)
  const publicPackages = packages.filter((p) => !isLabPackage(p.name))
  return { ecosystem, file, publicPackages, withheld: packages.length - publicPackages.length }
}

export async function scan({ root, api, fetchImpl, sleep }) {
  const client = makeClient(fetchImpl, sleep, checkedApi(api))
  const locks = LOCKS.map((lock) => readLock(root, lock))
  const ecosystems = {}
  const findings = []
  for (const lock of locks) {
    const hits = await advisoryIds(client, lock.ecosystem, lock.publicPackages)
    const records = await fetchRecords(client, [...new Set([...hits.values()].flat())].sort())
    for (const [pkg, ids] of hits) {
      for (const id of ids) {
        const record = records.get(id)
        if (record.withdrawn) continue
        findings.push({ ecosystem: lock.ecosystem, name: pkg.name, version: pkg.version, id, severity: severityOf(record), summary: String(record.summary ?? '').slice(0, 160) })
      }
    }
    ecosystems[lock.ecosystem] = { lock: lock.file, scanned: lock.publicPackages.length, withheld: lock.withheld, advisories: findings.filter((f) => f.ecosystem === lock.ecosystem).length }
  }
  const unrated = findings.filter((f) => f.severity === 'UNRATED').length
  return { generated: new Date().toISOString(), api: checkedApi(api), ecosystems, unrated, findings }
}

const failing = (findings, failOn) => findings.filter((f) => RANKS[f.severity] >= RANKS[failOn] && f.severity !== 'UNRATED')
const unratedGating = (findings, failOnUnrated) => (failOnUnrated ? findings.filter((f) => f.severity === 'UNRATED') : [])

function render(report, failOn, failOnUnrated = false) {
  const lines = ['osv_scan: public package names and versions sent to ' + report.api]
  for (const [eco, e] of Object.entries(report.ecosystems)) {
    lines.push(`${eco}: ${e.scanned} packages scanned, ${e.withheld} lab packages withheld, ${e.advisories} advisories (${e.lock})`)
  }
  const ordered = [...report.findings].sort((a, b) => RANKS[b.severity] - RANKS[a.severity] || a.name.localeCompare(b.name))
  for (const f of ordered) lines.push(`  ${f.ecosystem} ${f.name}@${f.version} ${f.id} [${f.severity}] ${f.summary}`)
  lines.push(`${report.unrated} unrated advisories (${failOnUnrated ? 'gating: --fail-on-unrated' : 'not gating'})`)
  const bad = failing(report.findings, failOn)
  const unratedBad = unratedGating(report.findings, failOnUnrated)
  if (bad.length) lines.push(`FAIL: ${bad.length} advisories at ${failOn.toUpperCase()} or above`)
  if (unratedBad.length) lines.push(`FAIL: ${unratedBad.length} unrated advisories (--fail-on-unrated)`)
  if (!bad.length && !unratedBad.length) lines.push(`ok: no advisory at ${failOn.toUpperCase()} or above${report.unrated ? ` (${report.unrated} unrated, not reviewed)` : ''}`)
  return lines.join('\n')
}

const HELP = `usage: node scripts/osv_scan.mjs [--root DIR] [--fail-on critical|high|moderate|low] [--fail-on-unrated] [--out FILE] [--api URL]
--fail-on-unrated  also exit 1 on an advisory that carries no usable rating (the count is always printed and in the report)
exit 0  no advisory at or above the threshold (default: high)
exit 1  an advisory at or above the threshold
exit 2  the scan could not be completed (lock missing or empty, OSV unreachable, short answer)`

function parseArgs(argv) {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const options = { root: here, failOn: 'high', failOnUnrated: false, out: null, api: OSV_API, help: false }
  const flags = { '--root': 'root', '--fail-on': 'failOn', '--out': 'out', '--api': 'api' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') { options.help = true; continue }
    if (argv[i] === '--fail-on-unrated') { options.failOnUnrated = true; continue }
    if (!(argv[i] in flags) || i + 1 >= argv.length) throw new ScanError(`unknown or incomplete option: ${argv[i]}\n${HELP}`)
    options[flags[argv[i]]] = argv[i + 1]
    i += 1
  }
  options.failOn = options.failOn.toUpperCase() === 'MEDIUM' ? 'MODERATE' : options.failOn.toUpperCase()
  if (!(options.failOn in RANKS) || options.failOn === 'UNRATED') throw new ScanError(`--fail-on must be critical, high, moderate or low\n${HELP}`)
  return options
}

export async function main(argv, io = {}) {
  const { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), stdout = console.log, stderr = console.error } = io
  try {
    const options = parseArgs(argv)
    if (options.help) { stdout(HELP); return 0 }
    const report = await scan({ root: options.root, api: options.api, fetchImpl, sleep })
    if (options.out) fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' })
    stdout(render(report, options.failOn, options.failOnUnrated))
    return failing(report.findings, options.failOn).length || unratedGating(report.findings, options.failOnUnrated).length ? 1 : 0
  } catch (error) {
    if (!(error instanceof ScanError)) stderr(error.stack ?? String(error))
    else stderr(`osv_scan: ${error.message}`)
    return 2
  }
}

// Node resolves import.meta.url through junctions and symlinks but leaves process.argv[1] as typed, so compare real paths.
function isEntryPoint() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2))
}
