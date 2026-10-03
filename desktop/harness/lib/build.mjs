// Which exe is which build. The smoke exe carries the `--attach-url` switch text, the measure exe the NQT_MEASURE_DIR
// name; the release exe carries neither (04 D4; 03 section 15.4). The harness refuses a launch whose exe is not the build
// it was asked to measure, so a number is never filed under the wrong build.
import fs from 'node:fs'
import path from 'node:path'
import { TARGETS_ROOT } from './paths.mjs'

export function identifyBytes(buffer) {
  const text = buffer.toString('latin1')
  const smoke = text.includes('--attach-url')
  const measure = text.includes('NQT_MEASURE_DIR')
  if (smoke && measure) return 'mixed'
  if (smoke) return 'smoke'
  if (measure) return 'measure'
  return text.includes('nq-lab-terminal') || text.includes('dev.nqlab.terminal') ? 'release' : 'unknown'
}

export function identifyExe(file) {
  try { return identifyBytes(fs.readFileSync(file)) } catch { return 'missing' }
}

/** Every release-profile shell exe under the cargo targets, newest first. */
export function candidateExes(root = TARGETS_ROOT) {
  let dirs = []
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return [] }
  const found = []
  for (const d of dirs) {
    const exe = path.join(root, d.name, 'release', 'nq-lab-terminal.exe')
    try { found.push({ exe, mtimeMs: fs.statSync(exe).mtimeMs }) } catch { /* no exe in this target */ }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).map((f) => f.exe)
}

/**
 * The exe of `kind` ('smoke' | 'measure'): the explicit path when given (verified), else the newest one under D:\dev\targets
 * that identifies as that kind. Throws when none is found or the explicit path is another build.
 */
export function resolveBuild(kind, explicit = null, root = TARGETS_ROOT) {
  if (explicit) {
    const got = identifyExe(explicit)
    if (got !== kind) throw new Error(`${explicit} is a ${got} build, not ${kind}`)
    return explicit
  }
  const hit = candidateExes(root).find((exe) => identifyExe(exe) === kind)
  if (!hit) throw new Error(`no ${kind} exe under ${root}; build it (cargo tauri build, CARGO_TARGET_DIR under ${root}) or pass --exe`)
  return hit
}

export const exeBytes = (file) => { try { return fs.statSync(file).size } catch { return null } }
