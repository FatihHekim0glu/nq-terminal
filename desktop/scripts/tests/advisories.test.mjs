// Born-failing tests for desktop/scripts/advisories.mjs (04 D5.3, 05 X06 and T9). Run: node --test desktop/scripts/tests
// The advisory lists below are trimmed copies of what GET /repos/tauri-apps/tauri/security-advisories returned on
// 3 October 2026; no test touches the network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BASELINE_LAST_SEEN, checkAdvisories, runCheck, touchesIpcCapabilitiesOrDownloads } from '../advisories.mjs'

const SCRIPT = fileURLToPath(new URL('../advisories.mjs', import.meta.url))

const FETCH_ADVISORY = {
  ghsa_id: 'GHSA-w28w-mhc8-qvjv', summary: 'Improper Tauri IPC Access Control for Fetch Command', severity: 'high',
  description: 'The fetch command was reachable from a page the capability did not name.',
  published_at: '2026-09-26T09:40:28Z', withdrawn_at: null, html_url: 'https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv',
  vulnerabilities: [{ package: { name: 'tauri' }, vulnerable_version_range: '>= 2.0.0, <= 2.11.5', patched_versions: '>= 2.11.6' }],
}
const ORIGIN_ADVISORY = {
  ghsa_id: 'GHSA-7gmj-67g7-phm9', summary: 'Origin Confusion Allows Remote Pages to Invoke Local-Only IPC Commands', severity: 'medium',
  description: 'A remote page could invoke commands meant for the local origin.',
  published_at: '2026-05-06T13:17:49Z', withdrawn_at: null, html_url: 'https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9',
  vulnerabilities: [{ package: { name: 'tauri' }, vulnerable_version_range: '>=2.0, <=2.11.0', patched_versions: '>=2.11.1' }],
}
const UNRELATED_ADVISORY = {
  ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'Terminal escape sequences are printed unescaped by the build log', severity: 'low',
  description: 'The build log echoes a package name without cleaning it.',
  published_at: '2026-09-30T08:00:00Z', withdrawn_at: null, html_url: 'https://example.invalid/aaaa',
  vulnerabilities: [{ package: { name: 'tauri-cli' }, vulnerable_version_range: '< 2.12.0', patched_versions: '>= 2.12.0' }],
}
const WITHDRAWN = { ...FETCH_ADVISORY, ghsa_id: 'GHSA-xxxx-xxxx-xxxx', published_at: '2026-10-01T00:00:00Z', withdrawn_at: '2026-10-02T00:00:00Z' }
const FEED = [FETCH_ADVISORY, ORIGIN_ADVISORY]

function tempState() {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'advisories-test-'))
  return { dir, file: path.join(dir, 'state', 'desktop', 'advisories.json') }
}

test('seeded with an older last-seen date, the newer IPC advisory is reported and the run fails (born failing)', () => {
  const result = checkAdvisories(FEED, '2026-05-07T00:00:00Z')
  assert.equal(result.ok, false)
  assert.deepEqual(result.blocking.map((a) => a.id), ['GHSA-w28w-mhc8-qvjv'])
  assert.equal(result.blocking[0].patched, '>= 2.11.6')
})

test('a seed older than both advisories reports both, newest first', () => {
  const result = checkAdvisories(FEED, '2022-01-01T00:00:00Z')
  assert.deepEqual(result.blocking.map((a) => a.id), ['GHSA-w28w-mhc8-qvjv', 'GHSA-7gmj-67g7-phm9'])
})

test('an advisory published at or before the last-seen date is not new', () => {
  assert.equal(checkAdvisories(FEED, '2026-09-26T09:40:28Z').ok, true)
  assert.equal(checkAdvisories(FEED, '2026-10-03T00:00:00Z').newer.length, 0)
})

test('a newer advisory that touches none of IPC, capabilities or downloads is listed but does not fail', () => {
  const result = checkAdvisories([UNRELATED_ADVISORY, ...FEED], '2026-09-26T09:40:28Z')
  assert.equal(result.ok, true)
  assert.deepEqual(result.informational.map((a) => a.id), ['GHSA-aaaa-bbbb-cccc'])
  assert.equal(result.blocking.length, 0)
})

test('the classifier fails closed on the words that name the three surfaces', () => {
  for (const text of ['IPC bypass', 'capability scope bypass', 'a permission file is ignored', 'path traversal in the download handler',
    'asset protocol reads outside the scope', 'iframe origin check', 'invoke key leak']) {
    assert.equal(touchesIpcCapabilitiesOrDownloads({ summary: text, description: '' }), true, text)
  }
  assert.equal(touchesIpcCapabilitiesOrDownloads({ summary: 'Colour of the log output', description: 'cosmetic' }), false)
})

test('a withdrawn advisory is ignored', () => {
  assert.equal(checkAdvisories([WITHDRAWN], '2026-01-01T00:00:00Z').newer.length, 0)
})

test('an unparseable date in the feed or the state fails loudly instead of passing', () => {
  assert.throws(() => checkAdvisories([{ ...FETCH_ADVISORY, published_at: 'soon' }], '2026-01-01T00:00:00Z'), /published_at/)
  assert.throws(() => checkAdvisories(FEED, 'yesterday'), /last-seen/)
})

test('with no state file the baseline is the newest advisory the decision recorded, so only later ones are new', async () => {
  const { dir, file } = tempState()
  assert.equal(BASELINE_LAST_SEEN, '2026-09-26T09:40:28Z')
  const quiet = await runCheck({ stateFile: file, fetchAdvisories: async () => FEED, now: () => new Date('2026-10-03T12:00:00Z') })
  assert.equal(quiet.exitCode, 0)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.lastSeen, '2026-09-26T09:40:28Z')
  assert.equal(saved.checkedAt, '2026-10-03T12:00:00.000Z')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a state file with an older date makes the run fail and leaves the date alone until the owner acknowledges', async () => {
  const { dir, file } = tempState()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ lastSeen: '2026-05-06T13:17:49Z' }))
  const failed = await runCheck({ stateFile: file, fetchAdvisories: async () => FEED })
  assert.equal(failed.exitCode, 1)
  assert.match(failed.lines.join('\n'), /GHSA-w28w-mhc8-qvjv/)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastSeen, '2026-05-06T13:17:49Z')
  const again = await runCheck({ stateFile: file, fetchAdvisories: async () => FEED })
  assert.equal(again.exitCode, 1)
  const acknowledged = await runCheck({ stateFile: file, fetchAdvisories: async () => FEED, acknowledge: true })
  assert.equal(acknowledged.exitCode, 0)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastSeen, '2026-09-26T09:40:28Z')
  assert.equal((await runCheck({ stateFile: file, fetchAdvisories: async () => FEED })).exitCode, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a passing run moves the last-seen date to the newest advisory, informational ones included', async () => {
  const { dir, file } = tempState()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ lastSeen: '2026-09-26T09:40:28Z' }))
  const result = await runCheck({ stateFile: file, fetchAdvisories: async () => [UNRELATED_ADVISORY, ...FEED] })
  assert.equal(result.exitCode, 0)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastSeen, '2026-09-30T08:00:00Z')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('--last-seen seeds the run without writing the state file', async () => {
  const { dir, file } = tempState()
  const seeded = await runCheck({ stateFile: file, lastSeenOverride: '2026-01-01T00:00:00Z', fetchAdvisories: async () => FEED })
  assert.equal(seeded.exitCode, 1)
  assert.equal(fs.existsSync(file), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a failed fetch exits 2 and never passes silently', async () => {
  const { dir, file } = tempState()
  const result = await runCheck({ stateFile: file, fetchAdvisories: async () => { throw new Error('rate limited') } })
  assert.equal(result.exitCode, 2)
  assert.match(result.lines.join('\n'), /rate limited/)
  assert.equal(fs.existsSync(file), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a corrupt state file exits 2', async () => {
  const { dir, file } = tempState()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{not json')
  const result = await runCheck({ stateFile: file, fetchAdvisories: async () => FEED })
  assert.equal(result.exitCode, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the command line reads a feed file, honours --last-seen and exits non-zero on the newer advisory', () => {
  const { dir, file } = tempState()
  const feed = path.join(dir, 'feed.json')
  fs.writeFileSync(feed, JSON.stringify(FEED))
  const run = spawnSync(process.execPath, [SCRIPT, '--feed-file', feed, '--state', file, '--last-seen', '2026-01-01T00:00:00Z'],
    { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 1)
  assert.match(run.stdout, /GHSA-w28w-mhc8-qvjv/)
  const quiet = spawnSync(process.execPath, [SCRIPT, '--feed-file', feed, '--state', file], { encoding: 'utf8', windowsHide: true })
  assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr)
  fs.rmSync(dir, { recursive: true, force: true })
})
