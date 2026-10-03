// The harness's own identity and the reproduction gate. "Before anything new, the harness must reproduce the W0B
// Tauri-spike figures within noise" (04 D5.1): the reproduce mode writes a verdict bound to the digest of the harness
// code, and every non-dry measurement checks it. A run taken without it is labelled UNREPRODUCED, never silently counted.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HARNESS_DIR, RUNS_ROOT } from './paths.mjs'

const SOURCE = /\.(mjs|js|py|ps1|json)$/

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* files(p) } else if (SOURCE.test(e.name)) yield p
  }
}

/** sha256 over the harness's source files (names relative to the harness folder, then bytes). */
export function harnessDigest(dir = HARNESS_DIR) {
  const h = crypto.createHash('sha256')
  for (const f of files(dir)) { h.update(path.relative(dir, f).replace(/\\/g, '/') + '\n'); h.update(fs.readFileSync(f)) }
  return h.digest('hex')
}

export const reproduceVerdictFile = (root = RUNS_ROOT) => path.join(root, 'reproduce-verdict.json')

export function writeReproduceVerdict(verdict, root = RUNS_ROOT) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(reproduceVerdictFile(root), JSON.stringify({ ...verdict, harnessDigest: harnessDigest(), writtenAtIso: new Date().toISOString() }, null, 1) + '\n', 'utf8')
}

/** { ok, why }: the verdict exists, says reproduced, was not a dry run, and was written by this very harness code. */
export function reproduceGate(root = RUNS_ROOT, digest = harnessDigest()) {
  let v
  try { v = JSON.parse(fs.readFileSync(reproduceVerdictFile(root), 'utf8')) } catch { return { ok: false, why: 'no reproduction verdict; run: node run.mjs --mode reproduce' } }
  if (v.dry) return { ok: false, why: 'the reproduction verdict is from a dry run' }
  if (v.reproduced !== true) return { ok: false, why: 'the last reproduction did not reproduce the W0B figures' }
  if (v.harnessDigest !== digest) return { ok: false, why: 'the harness code changed since the reproduction; reproduce again' }
  return { ok: true, why: null, verdict: v }
}
