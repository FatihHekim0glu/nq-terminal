// Whether a module is the one Node was started with (`node <file>`), shared by the release gate scripts and the harness
// entry points. Node gives import.meta.url as the real path (a junction or symbolic link is resolved), while
// process.argv[1] keeps the path the caller typed: PowerShell's $PSScriptRoot under C:\Users\...\nq-lab, a junction to
// E:\projects\nq-lab, never compared equal as plain strings, so main() never ran and the gate printed nothing and exited 0.
// Both sides are therefore compared as real paths (case-insensitively on Windows). When a file of the same name was
// started but still not recognised, the script says so on stderr and sets exit code 2, so a gate can never pass silently.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MISMATCH_EXIT_CODE = 2

function realPath(file) {
  const resolved = path.resolve(file)
  try {
    return fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

function reportMismatch(line) {
  console.error(line)
  process.exitCode = MISMATCH_EXIT_CODE
}

/**
 * True when `moduleUrl` (pass import.meta.url) is the file Node was started with.
 * `argv1` defaults to process.argv[1]; `onMismatch` receives the line printed when a same-named file was started but not matched.
 */
export function isMainModule(moduleUrl, { argv1 = process.argv[1], onMismatch = reportMismatch } = {}) {
  if (!argv1) return false
  const self = realPath(fileURLToPath(moduleUrl))
  const started = realPath(argv1)
  if (samePath(started, self)) return true
  if (samePath(path.basename(started), path.basename(self))) {
    onMismatch(`${path.basename(self)}: started as ${argv1} but not recognised as the main module; nothing ran (real path ${self})`)
  }
  return false
}
