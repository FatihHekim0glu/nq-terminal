// Whether a module is the one Node was started with (`node <file>`), for the web scripts that run themselves
// (buildStamp.mjs, bundleCheck.ts, src/api/codegen/gen-api.mjs). Node gives import.meta.url as the real path (a junction
// or link is resolved) while process.argv[1] keeps the path the caller typed, so under C:\Users\...\nq-lab, a junction to
// E:\projects\nq-lab, the plain string comparison never matched and the script exited 0 without doing anything. Both sides
// are compared as real paths, case-insensitively on Windows. A same-named file that is started but still not recognised is
// reported on stderr and sets exit code 2, so a build step can never pass silently. (desktop/scripts/main-module.mjs is the
// same check for the desktop scripts; the web folder keeps its own copy so it builds without the desktop folder.)
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MISMATCH_EXIT_CODE = 2

function realPath(file) {
  const resolved = path.resolve(file)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

function reportMismatch(line) {
  process.stderr.write(`${line}\n`)
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
