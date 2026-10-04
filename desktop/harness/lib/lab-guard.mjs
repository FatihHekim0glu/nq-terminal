// The real-lab guard of the measure build (plan decision 11, W5B prechecks). The measure build runs the lab's own backend on
// <lab>/terminal/state with the job queue on, so before it launches with real data, and after it, this module reads (read only):
//  - a listener on 8765 (the owner's terminal: the shell would otherwise attach to it once it holds the lock),
//  - backend.lock, live when an open for delete fails,
//  - jobs.json: its sha256 and any queued or running job (a starting backend runs the queued jobs on the real queue),
//  - the file list of backtests/output.
// Any of the first three means no launch: the rows are recorded as pending. After a launch the shell log must show a spawn and no
// attach, jobs.json must hash the same, backtests/output must list the same files and the lock must be gone.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { PORTS } from './paths.mjs'

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const ACTIVE_STATES = new Set(['queued', 'running'])

const ps = (script) => execFileSync('powershell.exe', [...POWERSHELL, script], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })

/** The two probes that need the operating system; tests replace them. */
export const osProbes = {
  /** Pids listening on the port. */
  listeners(port) {
    const out = ps(`Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }`)
    return out.split(/\s+/).filter(Boolean).map(Number)
  },
  /** 'absent', 'present-not-held' or 'live' (an open that allows delete failed, as precheck of the lab does it). */
  lockState(file) {
    if (!fs.existsSync(file)) return 'absent'
    const out = ps(`try { $f = [System.IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'ReadWrite', 'Delete'); $f.Close(); 'present-not-held' } catch [System.IO.FileNotFoundException] { 'absent' } catch { 'live' }`)
    return out.trim() || 'live'
  },
}

/** Only the measure build with real data runs on the owner's real state folder and queue. */
export const guardsMeasure = (build, realData) => build === 'measure' && realData === true

function listOutput(dir) {
  const out = []
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { let size = -1; try { size = fs.statSync(p).size } catch { /* gone */ } out.push(`${path.relative(dir, p).split(path.sep).join("/")}|${size}`) }
    }
  }
  walk(dir)
  return out.sort()
}

function readJobs(file) {
  let text
  try { text = fs.readFileSync(file) } catch (e) { return e.code === 'ENOENT' ? { sha: null, active: 0, error: null } : { sha: null, active: null, error: `jobs.json cannot be read (${e.code ?? 'error'})` } }
  const sha = crypto.createHash('sha256').update(text).digest('hex')
  try {
    const doc = JSON.parse(text.toString('utf8'))
    const jobs = Array.isArray(doc?.jobs) ? doc.jobs : null
    if (jobs === null) return { sha, active: null, error: 'jobs.json has no job list' }
    return { sha, active: jobs.filter((j) => ACTIVE_STATES.has(j?.state)).length, error: null }
  } catch { return { sha, active: null, error: 'jobs.json is not valid JSON' } }
}

const attempt = (fn, fallback, errors, what) => { try { return fn() } catch (e) { errors.push(`${what}: ${String(e.message ?? e).slice(0, 120)}`); return fallback } }

/** What the lab looks like now: read only. A probe that fails is recorded and counts as a problem, never as quiet. */
export function snapshotLab(lab, probes = osProbes) {
  const state = path.join(lab, 'terminal', 'state')
  const probeErrors = []
  const jobs = readJobs(path.join(state, 'jobs.json'))
  return {
    atIso: new Date().toISOString(),
    port8765Pids: attempt(() => probes.listeners(PORTS.owner), [], probeErrors, 'listener probe'),
    lockState: attempt(() => probes.lockState(path.join(state, 'backend.lock')), 'unknown', probeErrors, 'lock probe'),
    jobsSha256: jobs.sha, jobsActive: jobs.active, jobsError: jobs.error,
    outputListing: listOutput(path.join(lab, 'backtests', 'output')),
    probeErrors,
  }
}

/** Why the measure build must not launch on this lab now; empty when it may. */
export function precheckProblems(snap) {
  const out = []
  if (snap.port8765Pids.length > 0) out.push(`port ${PORTS.owner} is listening (pid ${snap.port8765Pids.join(', ')}): the owner's terminal is live`)
  if (snap.lockState === 'live') out.push('backend.lock is live: another backend holds the lab')
  if (snap.jobsError) out.push(snap.jobsError)
  else if (snap.jobsActive > 0) out.push(`${snap.jobsActive} queued or running job in jobs.json: a starting backend would run the queue`)
  for (const e of snap.probeErrors) out.push(`could not read the lab (${e})`)
  return out
}

/** What a measure launch on the real lab must not have changed or done, from the shell log and two snapshots. */
export function postcheckProblems(before, after, events) {
  const out = []
  const seen = (name) => events.some((e) => e.event === name)
  if (!seen('supervise_spawned')) out.push('the shell log has no supervise_spawned: this run did not spawn its own backend')
  if (seen('supervise_attached')) out.push('the shell log has supervise_attached: the shell attached to a backend it did not start')
  if (before.jobsSha256 !== after.jobsSha256) out.push(`jobs.json changed (${before.jobsSha256 ?? 'absent'} to ${after.jobsSha256 ?? 'absent'})`)
  const had = new Set(before.outputListing)
  const added = after.outputListing.filter((f) => !had.has(f))
  const kept = new Set(after.outputListing)
  const gone = before.outputListing.filter((f) => !kept.has(f))
  if (added.length || gone.length) out.push(`backtests/output changed (${added.length} added, ${gone.length} removed)`)
  if (after.lockState !== 'absent') out.push(`backend.lock is ${after.lockState} after the exit`)
  for (const e of after.probeErrors) out.push(`could not read the lab (${e})`)
  return out
}

/** The few fields of a snapshot worth keeping in a record (the output listing is kept as a count). */
export const snapshotSummary = (s) => ({ atIso: s.atIso, port8765Pids: s.port8765Pids, lockState: s.lockState, jobsSha256: s.jobsSha256, jobsActive: s.jobsActive, outputFiles: s.outputListing.length, probeErrors: s.probeErrors })

/** The modes' front check, before a gate wait or a slot: null when the launch may go, else { problems, summary } to record as pending. */
export function launchBlock(build, realData, lab, probes = osProbes) {
  if (!guardsMeasure(build, realData)) return null
  const snap = snapshotLab(lab, probes)
  const problems = precheckProblems(snap)
  return problems.length > 0 ? { problems, summary: snapshotSummary(snap) } : null
}
