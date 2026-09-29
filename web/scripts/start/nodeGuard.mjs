// Node version guard for ./start.sh (scripts/start.mjs).
//
// This file runs on the old Node it exists to catch, so it is plain ES2020 with Node built-ins only: no
// TypeScript, no dependency. web/package.json engines is the single source of the required major
// (web/.nvmrc must agree; nodeGuard.test.ts checks it). Under Node 20, pnpm and vitest stop with
// ERR_UNKNOWN_BUILTIN_MODULE node:sqlite, which says nothing about the real cause; this turns that into a
// plain sentence, or into a switch to an installed Node that is new enough.
//
// The switch only ever looks at a fixed list of local locations and runs `node --version` on them. It never
// reads file contents and never installs anything.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const RANGE = /^>=\s*(\d+)$/
const VERSION = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/
const DEFAULT_REQUIRED = 24

/** The required Node major from an engines object. Only ">=N" is understood; anything else throws. */
export function requiredMajor(engines) {
  const range = engines && typeof engines.node === 'string' ? engines.node.trim() : ''
  const match = RANGE.exec(range)
  if (match === null) {
    const shown = engines && engines.node !== undefined ? JSON.stringify(engines.node) : 'nothing'
    throw new Error(`web/package.json engines.node must look like ">=24"; found ${shown}`)
  }
  return Number(match[1])
}

function stripV(version) {
  return String(version).trim().replace(/^v/, '')
}

function parseVersion(text) {
  const match = VERSION.exec(text)
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2] || 0), patch: Number(match[3] || 0) }
}

/** { ok, found, required } for a version string such as process.version ("v20.20.2"). */
export function checkNode(version, engines) {
  const required = requiredMajor(engines)
  const found = stripV(version)
  const parsed = parseVersion(found)
  return { ok: parsed !== null && parsed.major >= required, found, required }
}

function versionKey(name) {
  const parsed = parseVersion(name.replace(/^\D+/, ''))
  return parsed === null ? [-1, 0, 0] : [parsed.major, parsed.minor, parsed.patch]
}

function newestFirst(a, b) {
  const x = versionKey(a)
  const y = versionKey(b)
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return y[i] - x[i]
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function versionedFolders(list, dir, pattern) {
  let names
  try {
    names = list(dir)
  } catch {
    return []
  }
  return names.filter((name) => pattern.test(name)).sort(newestFirst)
}

/**
 * Where an installed Node may live, in the sequence they are tried. Only paths that exist are returned (a
 * missing folder is skipped); nothing is read except folder listings. The `exists` and `list` arguments are
 * for tests.
 */
export function nodeCandidates({ home, platform, env, required = DEFAULT_REQUIRED, exists = existsSync, list = readdirSync }) {
  const out = []
  const add = (candidate) => {
    if (candidate && !out.includes(candidate) && exists(candidate)) out.push(candidate)
  }
  add(env.NQT_NODE)
  if (env.NVM_BIN) add(path.posix.join(env.NVM_BIN, 'node'))
  if (platform === 'win32') return out
  const share = path.posix.join(home, '.local', 'share')
  for (const name of versionedFolders(list, share, /^node-v\d/)) add(path.posix.join(share, name, 'bin', 'node'))
  const nvm = path.posix.join(home, '.nvm', 'versions', 'node')
  for (const name of versionedFolders(list, nvm, /^v\d/)) add(path.posix.join(nvm, name, 'bin', 'node'))
  add(path.posix.join(home, '.volta', 'bin', 'node'))
  add(`/opt/homebrew/opt/node@${required}/bin/node`)
  add(`/usr/local/opt/node@${required}/bin/node`)
  add('/usr/bin/node')
  add('/usr/local/bin/node')
  return out
}

/**
 * The candidate with the highest major that meets `required`, as { path, version }; the first of equal
 * majors wins. `probe(path)` returns the output of `<path> --version`, or null when it cannot run. A probe
 * that throws counts as a miss.
 */
export function pickCandidate(paths, probe, required) {
  let best = null
  let bestMajor = -1
  for (const candidate of paths) {
    let output
    try {
      output = probe(candidate)
    } catch {
      continue
    }
    if (typeof output !== 'string') continue
    const version = stripV(output)
    const parsed = parseVersion(version)
    if (parsed === null || parsed.major < required) continue
    if (parsed.major > bestMajor) {
      best = { path: candidate, version }
      bestMajor = parsed.major
    }
  }
  return best
}

/** One line for the switch, printed before the launcher runs under the other Node. */
export function switchNotice(found, picked) {
  return `start: Node ${found} is too old for this terminal; using Node ${picked.version} at ${picked.path}`
}

/** The plain refusal: ASCII, no dashes. */
export function refusalText({ found, required }) {
  return (
    `Node ${found} is too old: this terminal needs Node ${required} or later (web/package.json engines; web/.nvmrc). ` +
    'Under an older Node, pnpm and vitest stop with ERR_UNKNOWN_BUILTIN_MODULE node:sqlite. ' +
    `Install Node ${required} (for example with nvm: nvm install ${required}), ` +
    `or set NQT_NODE to a Node ${required} binary and run ./start.sh again.`
  )
}
