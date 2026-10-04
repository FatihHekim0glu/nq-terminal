// Raw run records: one JSON file per run (schema 'd5-run-1'), written for every outcome, rejected ones included.
// Every figure in a record carries its build, its method, the CPU load of the gate that preceded the run and the
// provenance stamp, so a number can be traced from the report back to the file it was read from.
import fs from 'node:fs'
import path from 'node:path'

export const SCHEMA = 'd5-run-1'
// accepted: gate passed, window watch clean, every expected row read.  rejected: gate failed, run not executed.
// provisional: gate failed, run executed anyway on request (label PROVISIONAL).  dry: a complete unmeasured run.
// warmup: executed, never counted.  incomplete: a clean run that lacks an expected row.  failed: no HOME.
// window-fail: a new visible window or a foreground change.  abandoned: too many rejections in a row.
// pending: the real-lab guard refused the launch (8765 listening, live lock or active job; lab-guard.mjs), nothing was started.
export const STATUSES = ['accepted', 'provisional', 'rejected', 'dry', 'dry-incomplete', 'warmup', 'incomplete', 'failed', 'window-fail', 'abandoned', 'pending']
export const COUNTED = ['accepted', 'provisional']

export function writeRecord(outDir, name, body) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${name}.json`)
  fs.writeFileSync(file, JSON.stringify({ schema: SCHEMA, ...body }, null, 1) + '\n', { encoding: 'utf8' })
  return file
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.name.endsWith('.json')) yield p
  }
}

export function loadRecords(dir) {
  const out = []
  for (const f of walk(dir)) {
    try {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (r && r.schema === SCHEMA) out.push({ ...r, file: f })
    } catch { /* not a run record */ }
  }
  return out
}

/** A figure with everything a reader needs to trace it: row, build, method, unit, value, CPU load, stamp. */
export function figure({ row, build, value, unit, method, cpuLoadPct, provenance, extra = {} }) {
  return { row, build, method, unit, value, cpuLoadPct: cpuLoadPct ?? null,
    stamp: provenance ? { head: provenance.head ?? null, diffSha256: provenance.diffSha256 ?? null, untrackedSha256: provenance.untrackedSha256 ?? null } : null, ...extra }
}
