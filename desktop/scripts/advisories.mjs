// The local stand-in for the weekly advisory job of webview2-drift.yml (04 D5.3; 05 X06 and T9): reads the Tauri
// repository's published security advisories (GET /repos/tauri-apps/tauri/security-advisories, read-only and
// unauthenticated), compares them with the last-seen date in state/desktop/advisories.json (git-ignored) and fails on any
// newer advisory that touches IPC, capabilities or downloads.
//
//   node desktop/scripts/advisories.mjs [--state <file>] [--feed-file <json>] [--last-seen <iso date>] [--ack]
//
//   exit 0  no newer advisory touches IPC, capabilities or downloads (newer unrelated ones are listed)
//   exit 1  at least one does; the last-seen date stays where it was until the owner has patched or reviewed it and
//           runs the command again with --ack
//   exit 2  the feed or the state file could not be read; a check that cannot run never passes
//
// --feed-file reads a saved response instead of calling the API (tests, offline review). --last-seen seeds the run and
// writes nothing. With no state file the baseline is the newest advisory the decision recorded (26 September 2026,
// fixed in 2.11.6; 02 T9), so the first run reports only what came after it. Node built-ins only.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from './main-module.mjs'

const API_URL = 'https://api.github.com/repos/tauri-apps/tauri/security-advisories?per_page=100'
const MAX_PAGES = 5
const FETCH_TIMEOUT_MS = 20_000
export const BASELINE_LAST_SEEN = '2026-09-26T09:40:28Z'
const DEFAULT_STATE = fileURLToPath(new URL('../../state/desktop/advisories.json', import.meta.url))

// Fail closed: a loose match only costs a manual look. These are the words that name the three surfaces of T9.
const SURFACE = new RegExp([
  '\\bipc\\b', 'inter-process', 'capabilit', 'permission', 'access[- ]control', '\\bscopes?\\b', '\\borigins?\\b',
  '\\binvoke', '\\bcommands?\\b', 'download', '\\bchannels?\\b', '\\bacl\\b', 'isolation', 'asset protocol',
  'custom protocol', '\\bfetch\\b',
].join('|'), 'i')

export function touchesIpcCapabilitiesOrDownloads(advisory) {
  return SURFACE.test(`${advisory.summary ?? ''}\n${advisory.description ?? ''}`)
}

function instant(text, what) {
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) throw new Error(`${what} is not a date: ${JSON.stringify(text)}`)
  return ms
}

function describe(advisory) {
  const fixes = (advisory.vulnerabilities ?? []).map((v) => `${v.package?.name ?? '?'} ${v.patched_versions ?? 'no fix listed'}`)
  return {
    id: advisory.ghsa_id, published: advisory.published_at, severity: advisory.severity ?? 'unknown',
    summary: advisory.summary ?? '', patched: (advisory.vulnerabilities ?? []).map((v) => v.patched_versions).filter(Boolean)[0] ?? '',
    fixes: fixes.join('; '), url: advisory.html_url ?? '',
  }
}

// Pure core: which advisories are newer than the last-seen date, and which of those block.
export function checkAdvisories(feed, lastSeen) {
  const seenMs = instant(lastSeen, 'last-seen')
  const live = feed.filter((a) => !a.withdrawn_at)
  const dated = live.map((a) => ({ advisory: a, ms: instant(a.published_at, `published_at of ${a.ghsa_id}`) }))
  const newer = dated.filter((d) => d.ms > seenMs).sort((a, b) => b.ms - a.ms)
  const entries = newer.map((d) => ({ ...describe(d.advisory), blocks: touchesIpcCapabilitiesOrDownloads(d.advisory) }))
  const newest = dated.reduce((best, d) => (best === null || d.ms > best.ms ? d : best), null)
  return {
    ok: entries.every((e) => !e.blocks), newer: entries, blocking: entries.filter((e) => e.blocks),
    informational: entries.filter((e) => !e.blocks), newestPublished: newest ? newest.advisory.published_at : null,
  }
}

export async function fetchAdvisories(fetchImpl = fetch) {
  const all = []
  let url = API_URL
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nq-lab-terminal-advisories' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      const reset = response.headers.get('x-ratelimit-reset')
      throw new Error(`GitHub answered ${response.status}${reset ? ` (rate limit resets at ${new Date(Number(reset) * 1000).toISOString()})` : ''}`)
    }
    const body = await response.json()
    if (!Array.isArray(body)) throw new Error('the advisory feed is not a list')
    all.push(...body)
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null
  }
  return all
}

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return { lastSeen: BASELINE_LAST_SEEN, fromBaseline: true }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  if (typeof state.lastSeen !== 'string') throw new Error('the state file has no lastSeen date')
  return { lastSeen: state.lastSeen, fromBaseline: false }
}

function laterOf(a, b) {
  if (b === null) return a
  return instant(b, 'a published date') > instant(a, 'a published date') ? b : a
}

function writeState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function report(result, lastSeen) {
  const lines = [`advisories: ${result.newer.length} newer than ${lastSeen} (${result.blocking.length} touching IPC, capabilities or downloads)`]
  for (const e of result.blocking) lines.push(`  BLOCKS  ${e.id} ${e.severity} ${e.published}  ${e.summary}  fixed in: ${e.fixes || 'unknown'}  ${e.url}`)
  for (const e of result.informational) lines.push(`  listed  ${e.id} ${e.severity} ${e.published}  ${e.summary}`)
  return lines
}

export async function runCheck({ stateFile = DEFAULT_STATE, fetchAdvisories: load = fetchAdvisories, now = () => new Date(),
  acknowledge = false, lastSeenOverride = null } = {}) {
  let feed
  let state
  try {
    state = lastSeenOverride ? { lastSeen: lastSeenOverride, fromBaseline: false } : readState(stateFile)
    feed = await load()
  } catch (error) {
    return { exitCode: 2, lines: [`advisories: could not run the check: ${error.message}`] }
  }
  let result
  try {
    result = checkAdvisories(feed, state.lastSeen)
  } catch (error) {
    return { exitCode: 2, lines: [`advisories: could not read the feed or the state: ${error.message}`] }
  }
  const lines = report(result, state.lastSeen)
  const advance = acknowledge || result.ok
  if (advance && !lastSeenOverride) {
    const lastSeen = laterOf(state.lastSeen, result.newestPublished)
    writeState(stateFile, { lastSeen, checkedAt: now().toISOString(), acknowledged: acknowledge ? result.newer.map((e) => e.id) : [] })
    lines.push(`advisories: last-seen date is now ${lastSeen}`)
  }
  if (!result.ok && !acknowledge) lines.push('advisories: patch or review, then run again with --ack (T9: patch within 7 days)')
  return { exitCode: result.ok || acknowledge ? 0 : 1, lines }
}

function parseArguments(argv) {
  const options = { acknowledge: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--ack') options.acknowledge = true
    else if (['--state', '--feed-file', '--last-seen'].includes(flag) && i + 1 < argv.length) {
      i += 1
      if (flag === '--state') options.stateFile = path.resolve(argv[i])
      else if (flag === '--feed-file') options.feedFile = path.resolve(argv[i])
      else options.lastSeenOverride = argv[i]
    } else throw new Error(`unknown or incomplete argument ${flag}`)
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(`advisories: ${error.message}`)
    return 2
  }
  const { feedFile, ...rest } = options
  if (feedFile) rest.fetchAdvisories = async () => JSON.parse(fs.readFileSync(feedFile, 'utf8'))
  const { exitCode, lines } = await runCheck(rest)
  console.log(lines.join('\n'))
  return exitCode
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main()
}
