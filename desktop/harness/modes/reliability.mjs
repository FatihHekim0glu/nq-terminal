// The launch-reliability mode: `run.mjs --mode reliability --smoke-exe FILE [--runs 30] [--real-data] [--hold-ms 4000] [--proof-limit-ms 2000]`.
// N hidden launches of one smoke exe, one after the other, each with a fresh temporary state folder, through the harness's own launch
// path (shellSpec, startShell, teardown and the global window watch). Per launch: the shell log events and a 1 ms tail of the backend's
// log, so spawn to READY, READY to the first identity proof, and the outcome (checked or refused) are read. The run reports the refusals
// and the READY-to-proof distribution (lib/reliability.mjs) and fails (exit 1) on any refusal, any launch without an outcome, a window
// the watch did not allow, or a survivor after teardown.
//
// Why it exists: the shell gives the backend's first identity proof LINK_TIMEOUT (2 s in 0.2.0) with no retry, and the HOME prewarm
// starts a few ms before NQT-READY; a slow first proof (a Defender rescan, a cold file cache) ends on stopped.html#unverified. About one
// start in 240 did, so a useful run is a few hundred launches; the distribution shows the margin before the first refusal.
//
// --real-data runs the real backend (the one with the prewarm and scipy, main tree only); without it the fixture backend runs, which
// has no prewarm, so its proof times say nothing about the race. --dry is one launch, anywhere. Nothing is written outside --out.
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from '../lib/cdp.mjs'
import { identifyExe, resolveBuild } from '../lib/build.mjs'
import { shellSpec, startShell, teardown } from '../lib/shell.mjs'
import { startWatch, stopWatch } from '../lib/winwatch.mjs'
import { readShellLog } from '../lib/shelllog.mjs'
import { treeIdentity } from '../lib/mem.mjs'
import { labFor } from '../lib/launch-run.mjs'
import { isMainTree } from '../lib/paths.mjs'
import { writeRecord } from '../lib/record.mjs'
import { startTail } from '../lib/tailog.mjs'
import { TERMINAL_EVENTS, PROOF_LIMIT_MS, launchTimes, summariseLaunches, reliabilityLines } from '../lib/reliability.mjs'

/** The owner's marker that a records run is in progress: no launch starts while it exists. */
export const RECORDS_LOCK = 'D:/dev/locks/RECORDS_RUNNING'
const DEFAULT_RUNS = 30
const DEFAULT_HOLD_MS = 4000
const START_TIMEOUT_MS = 45_000
const PAUSE_BETWEEN_MS = 3000
const SIZE = '1920x1080'
const errText = (e) => String((e && e.message) ?? e).slice(0, 200)

/** The options of a run, validated. deps (identify, resolve, isMainTree) are injected in tests. */
export function reliabilityOptions(args, { identify = identifyExe, resolve = resolveBuild, isMainTree: mainTree = isMainTree } = {}) {
  const dry = args.flag('dry')
  const runs = dry ? 1 : Number(args.opt('runs', DEFAULT_RUNS))
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive whole number')
  const holdMs = Number(args.opt('hold-ms', DEFAULT_HOLD_MS))
  const proofLimitMs = Number(args.opt('proof-limit-ms', PROOF_LIMIT_MS))
  if (!(holdMs >= 0) || !(proofLimitMs > 0)) throw new Error('--hold-ms must be 0 or more and --proof-limit-ms above 0')
  const named = args.opt('smoke-exe', args.opt('exe', null))
  let exe
  if (named) {
    const kind = identify(named)
    if (kind !== 'smoke') throw new Error(`${named} is a ${kind} build, not smoke`)
    exe = named
  } else exe = resolve('smoke', null)
  if (!dry && !mainTree()) throw new Error('a reliability run measures from the main tree only (this tree is not the lab\'s terminal folder): use --dry here')
  return { exe, runs, holdMs, proofLimitMs, realData: args.flag('real-data'), dry }
}

async function waitEnd(logFile, run) {
  const began = Date.now()
  while (Date.now() - began < START_TIMEOUT_MS && run.exitCode === null) {
    const ended = readShellLog(logFile).find((e) => TERMINAL_EVENTS.has(e.event))
    if (ended) return ended
    await sleep(25)
  }
  return null
}

/** One launch: the shell, a backend log tail and the window watch beside it; returns the record body. */
async function oneLaunch({ o, i, outDir }) {
  const runDir = path.join(outDir, 'launch', String(i).padStart(3, '0'))
  const stateDir = path.join(runDir, 'state')
  const labInfo = labFor(runDir, 'smoke', { realData: o.realData })
  const spec = shellSpec({ build: 'smoke', exe: o.exe, runDir, lab: labInfo.lab, fixture: !o.realData, stateDir, size: SIZE })
  const rec = { i, exe: o.exe, runDir, dataKind: o.realData ? 'real' : 'fixture' }
  const watch = await startWatch(path.join(runDir, 'watch.jsonl'))
  const tail = startTail(path.join(stateDir, 'logs', 'backend.log'), 90)
  let run = null
  try {
    await sleep(300)
    run = startShell(spec)
    rec.startedAtIso = run.spawnedAtIso
    await waitEnd(spec.logFile, run)
    await sleep(o.holdMs)
    let recorded = []
    try { if (run.exitCode === null) recorded = treeIdentity(run.child.pid) } catch (e) { rec.identityError = errText(e) }
    rec.teardown = await teardown(run.child, recorded)
  } finally {
    rec.tailDoc = await tail.stop()
    rec.watch = await stopWatch(watch, { rootPid: run?.child.pid ?? null })
    labInfo.remove()
  }
  const events = readShellLog(spec.logFile)
  const times = launchTimes(events, rec.tailDoc)
  const watchOk = rec.watch.clean && rec.watch.newWindows.length === 0 && rec.watch.foregroundChanges.length === 0
  return { ...rec, ...times, tailError: rec.tailDoc ? null : 'no backend log tail', watchClean: watchOk, survivors: rec.teardown?.survivors?.length ?? null,
    logRefused: events.some((e) => e.event === 'backend_log_refused'), shellEvents: events.filter((e) => /^supervise_|^page_|stale_dist|^home_painted/.test(e.event)).map((e) => ({ event: e.event, t: e.t, code: e.code })) }
}

/** What stops the run early (before the next launch), or null. */
export function stopReason(rec) {
  if (!rec.watchClean) return 'the window watch was not clean'
  if (rec.survivors > 0) return `${rec.survivors} process(es) survived teardown`
  if (rec.logRefused) return 'the backend log was refused'
  return null
}

export async function run({ args, outDir, provenance }) {
  const o = reliabilityOptions(args)
  if (fs.existsSync(RECORDS_LOCK)) throw new Error(`${RECORDS_LOCK} is present; not launching`)
  const launches = []
  let stopped = null
  for (let i = 1; i <= o.runs; i++) {
    if (fs.existsSync(RECORDS_LOCK)) { stopped = `${RECORDS_LOCK} appeared`; break }
    const rec = await oneLaunch({ o, i, outDir })
    const { watch, teardown: td, tailDoc, ...slim } = rec
    launches.push(slim)
    writeRecord(outDir, `reliability-${String(i).padStart(3, '0')}`, { mode: 'reliability', build: 'smoke', status: o.dry ? 'dry' : 'accepted', provenance, ...slim, watchSummary: { clean: watch.clean, notes: watch.notes.length }, teardownSummary: td, tail: tailDoc })
    console.log(JSON.stringify({ i, outcome: rec.outcome, ...rec.ms, watchClean: rec.watchClean, survivors: rec.survivors }))
    stopped = stopReason(rec)
    if (stopped) break
    if (i < o.runs) await sleep(PAUSE_BETWEEN_MS)
  }
  const summary = summariseLaunches(launches, { proofLimitMs: o.proofLimitMs })
  const failed = summary.failed || stopped !== null || launches.length < o.runs
  writeRecord(outDir, 'reliability-summary', { mode: 'reliability', build: 'smoke', status: o.dry ? 'dry' : 'accepted', provenance, exe: o.exe, dataKind: o.realData ? 'real' : 'fixture', requested: o.runs, stoppedEarly: stopped, summary })
  for (const line of reliabilityLines(summary)) console.log(line)
  if (stopped) console.log(`stopped early: ${stopped}`)
  return { failed, summary, stoppedEarly: stopped }
}
