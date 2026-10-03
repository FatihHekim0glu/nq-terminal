// The provenance stamp of every record and artefact (plan summary, "Provenance"): HEAD, the sha256 of `git diff HEAD`
// and the sha256 of the sorted untracked file list with their contents. A record whose stamp differs from the tree
// being released is refused by the release check.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { TERMINAL } from './paths.mjs'

export const UNTRACKED_RULE = 'sha256 over, for each name of git ls-files --others --exclude-standard sorted bytewise: the name, a newline, the file bytes'
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

function git(terminal, args) {
  return execFileSync('git', ['-C', terminal, ...args], { windowsHide: true, maxBuffer: 1 << 30 })
}

export function untrackedDigest(terminal, names) {
  const h = crypto.createHash('sha256')
  for (const name of [...names].sort()) {
    h.update(Buffer.from(`${name}\n`, 'utf8'))
    try { h.update(fs.readFileSync(path.join(terminal, name))) } catch { h.update(Buffer.from('<unreadable>')) }
  }
  return h.digest('hex')
}

/** The stamp of a tree, or a stamp with `error` when git cannot be read (a record is then marked unstamped). */
export function provenance(terminal = TERMINAL) {
  try {
    const head = git(terminal, ['rev-parse', 'HEAD']).toString().trim()
    const diff = sha(git(terminal, ['diff', 'HEAD']))
    const names = git(terminal, ['ls-files', '--others', '--exclude-standard']).toString().split('\n').map((s) => s.trim()).filter(Boolean)
    const dist = path.join(terminal, 'web', 'dist', 'index.html')
    return { head, diffSha256: diff, untrackedSha256: untrackedDigest(terminal, names), untrackedCount: names.length, untrackedRule: UNTRACKED_RULE,
      distIndexSha256: fs.existsSync(dist) ? sha(fs.readFileSync(dist)) : null, terminal, node: process.version }
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 200), terminal, node: process.version }
  }
}

export const sameStamp = (a, b) => !!a && !!b && !a.error && !b.error && a.head === b.head && a.diffSha256 === b.diffSha256 && a.untrackedSha256 === b.untrackedSha256

/** Free space on C: in MB, read before and after a run (the C: stop rule counts a run's own writes only). */
export function cFreeMB() {
  try { const s = fs.statfsSync('C:\\'); return Math.round((s.bavail * s.bsize) / 1048576) } catch { return null }
}
