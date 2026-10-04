// One measurement slot: the CPU gate, the window watch around the run, and the raw record written to disk.
// A gate reading above the limit rejects the attempt (the run does not start, the record is kept); after
// `provisionalAfter` rejections the run is taken anyway and labelled PROVISIONAL (manager decision 2: never wait for ever).
import path from 'node:path'
import { writeRecord } from './record.mjs'
import { readGpu } from './gpu.mjs'
import { startWatch, stopWatch } from './winwatch.mjs'

export async function watchedRun(runFn, watchFile, allowFor = () => undefined) {
  const w = await startWatch(watchFile)
  let result
  try { result = await runFn() } finally { result = { ...(result ?? {}), watch: await stopWatch(w, { allow: allowFor(result), rootPid: result?.rootPid ?? null }) } }
  return result
}

/** The status of an executed run. okStatus is what a clean complete run earns: 'accepted', 'provisional' or 'dry'. */
export function classifyRun(okStatus, r, expected = []) {
  if (r.pending?.length > 0) return 'pending'
  if (r.watch?.clean === false) return 'window-fail'
  const missing = expected.filter((id) => r.rows?.[id] === undefined || r.rows[id] === null)
  const reached = r.homeReady !== false && !r.fatal
  if (!reached) return okStatus === 'dry' ? 'dry-incomplete' : 'failed'
  if (missing.length > 0) return okStatus === 'dry' ? 'dry-incomplete' : 'incomplete'
  return okStatus
}

/**
 * kind: 'measure' | 'dry' | 'warmup'. runFn({ gate }) runs the launch and returns the record body. gateFn(seconds, {limitPct, enforce}) reads the CPU; gpuFn() reads the GPU (utilisation, memory), once after the gate and once after the run. Options: gateSeconds, limitPct,
 * provisionalAfter, rejectsSoFar, expected (row ids a complete run holds), allowFor(result) (the screen-2 mode's expected window).
 */
export async function executeSlot({ mode, build, slot, attempt, kind, outDir, runFn, gateFn, gpuFn = readGpu, gateSeconds = 60, limitPct = 10, provisionalAfter = null, rejectsSoFar = 0, expected = [], allowFor, meta = {} }) {
  const name = `${mode}-${build}-s${String(slot).padStart(2, '0')}-a${attempt}-${kind}`
  const base = { mode, build, slot, attempt, kind, ...meta }
  const watchFile = path.join(outDir, `${name}.watch.jsonl`)
  if (kind === 'warmup') {
    const r = await watchedRun(() => runFn({ gate: null }), watchFile, allowFor)
    return { status: 'warmup', file: writeRecord(outDir, name, { ...base, status: 'warmup', ...r }), result: r }
  }
  const gate = await gateFn(gateSeconds, { limitPct, enforce: kind === 'measure' })
  const gpuAtGate = await gpuFn()
  if (kind === 'measure' && !gate.pass) {
    const forced = provisionalAfter !== null && rejectsSoFar + 1 >= provisionalAfter
    if (!forced) {
      const file = writeRecord(outDir, name, { ...base, status: 'rejected', reason: `average CPU ${gate.avgPct}% over ${gate.seconds} s is above ${limitPct}%`, gate, gpu: { atGate: gpuAtGate } })
      return { status: 'rejected', file, gate }
    }
    const r = await watchedRun(() => runFn({ gate }), watchFile, allowFor)
    const gpu = { atGate: gpuAtGate, afterRun: await gpuFn() }
    const status = classifyRun('provisional', r, expected)
    const label = status === 'provisional' ? 'PROVISIONAL' : undefined
    return { status, file: writeRecord(outDir, name, { ...base, status, label, reason: `gate average ${gate.avgPct}% above ${limitPct}%; run anyway after ${rejectsSoFar + 1} rejected`, gate, gpu, ...r }), gate, result: r }
  }
  const r = await watchedRun(() => runFn({ gate }), watchFile, allowFor)
  const gpu = { atGate: gpuAtGate, afterRun: await gpuFn() }
  const status = classifyRun(kind === 'dry' ? 'dry' : 'accepted', r, expected)
  return { status, file: writeRecord(outDir, name, { ...base, status, gate, gpu, ...r }), gate, result: r }
}
