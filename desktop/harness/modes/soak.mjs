// The all-day soak at the shipped caps (04 D5 exit table: whole app, soak, target 1.0 GB, ceiling 1.5 GB). The smoke build is
// launched with no cache setting of its own, so the backend runs at the desktop caps it ships with (512 MiB for bars, 128 MiB for
// files; settings.py under NQT_DESKTOP=1). A workload round opens the spike's screens in turn so the caches fill the way a day's
// use fills them; the whole-tree private working set is sampled every 5 minutes (--interval-s for a dry run), and the row is the
// largest sample. The run ends after --hours, or when the file D:\dev\d5\soak.stop appears (an early, labelled-partial stop).
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from '../lib/cdp.mjs'
import { openSmoke } from '../lib/launch-run.mjs'
import { resolveBuild } from '../lib/build.mjs'
import { runLine, waitHomeReady } from '../lib/page-rows.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { memTree, memTreeBreakdown, errorText, SETTLED_FROM_S } from '../lib/mem.mjs'
import { figure } from '../lib/record.mjs'
import { MB, privateBytesLeakVerdict } from '../lib/rows.mjs'
import { isMainTree } from '../lib/paths.mjs'

export const SOAK_STOP_FILE = 'D:\\dev\\d5\\soak.stop'
export const SAMPLE_EVERY_S = 300
const GIP_DATE = { fixture: '2011-01-20', real: '2019-03-14' }
export const workload = (kind) => ['NQ GP 1d', `NQ GIP ${GIP_DATE[kind]}`, 'volmanaged_v0 EQ', 'REG', '27F MON', '27F CORR', 'LEDG', 'OOS', 'LIVE', 'RUNS', 'MT']

export { SETTLED_FROM_S }

/**
 * Summary of a sample series. maxMB is the soak row (the largest sample) and its meaning does not change. Beside it, as
 * information only: firstSampleAtS and startupPeakMB (the first sample with a reading), settledMaxMB (the largest sample
 * from SETTLED_FROM_S, null when there is none), the range of the private bytes and the breakdown (backend, UI tree, shell)
 * at the first and last sample that carries one, and the private-bytes verdict (leak: the rule of lib/rows.mjs, with its slope and growth), which
 * passes or fails the soak on its own so that a working-set trim cannot hide a leak (breakdownFailures and breakdownError, the first reason, only when a read failed). Also the last sample and the slope of a straight-line fit (MB per hour).
 */
export function summariseSoak(samples) {
  const have = samples.filter((s) => typeof s.wsPrivateMB === 'number')
  const leak = privateBytesLeakVerdict(samples)
  const empty = { n: 0, maxMB: null, lastMB: null, slopeMBPerHour: null, firstSampleAtS: null, startupPeakMB: null, settledMaxMB: null, privateBytesMinMB: null, privateBytesMaxMB: null, breakdown: null, privateBytesSlopeMBPerHour: null, privateBytesGrowthMB: null, leak }
  if (have.length === 0) return empty
  const xs = have.map((s) => s.wsPrivateMB)
  const t = have.map((s) => s.atS / 3600)
  const n = xs.length
  const mt = t.reduce((a, b) => a + b, 0) / n
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const den = t.reduce((a, b) => a + (b - mt) ** 2, 0)
  const slope = den === 0 ? 0 : t.reduce((a, b, i) => a + (b - mt) * (xs[i] - mx), 0) / den
  const settled = have.filter((s) => s.atS >= SETTLED_FROM_S).map((s) => s.wsPrivateMB)
  const pb = samples.map((s) => s.privateBytesMB).filter((v) => typeof v === 'number')
  const withBreakdown = samples.filter((s) => s.breakdown)
  const at = (s) => ({ atS: s.atS, ...s.breakdown })
  const failed = samples.filter((s) => s.breakdownError)
  return { n, maxMB: Math.max(...xs), lastMB: xs.at(-1), slopeMBPerHour: Math.round(slope * 10) / 10,
    firstSampleAtS: have[0].atS, startupPeakMB: have[0].wsPrivateMB, settledMaxMB: settled.length ? Math.max(...settled) : null,
    privateBytesMinMB: pb.length ? Math.min(...pb) : null, privateBytesMaxMB: pb.length ? Math.max(...pb) : null,
    privateBytesSlopeMBPerHour: leak.slopeMBPerHour, privateBytesGrowthMB: leak.growthMB, leak,
    breakdown: withBreakdown.length ? { first: at(withBreakdown[0]), last: at(withBreakdown.at(-1)) } : null,
    ...(failed.length ? { breakdownFailures: failed.length, breakdownError: failed[0].breakdownError } : {}) }
}

/** The breakdown of the tree for one sample, or null: it is information, and a failed read must not end the soak. The reason goes to onError. */
export function breakdownOf(pid, onError = () => {}, read = memTreeBreakdown) {
  try { const { backendMB, uiTreeMB, shellMB, perType } = read(pid); return { backendMB, uiTreeMB, shellMB, perType } } catch (e) { onError(errorText(e)); return null }
}

/** The breakdown fields of one sample: the breakdown, or the reason it was not read (also written to stderr). */
function sampleBreakdown(pid) {
  let breakdownError = null
  const breakdown = breakdownOf(pid, (why) => { breakdownError = why; console.error(`soak breakdown not read: ${why}`) })
  return breakdownError === null ? { breakdown } : { breakdown, breakdownError }
}

async function round(cdp, kind, errors) {
  for (const line of workload(kind)) {
    try { await runLine(cdp, line) } catch (e) { errors.push({ line, error: String(e.message ?? e).slice(0, 200) }) }
  }
}

export async function run({ args, outDir, provenance }) {
  const dry = args.flag('dry')
  const realData = !dry && args.flag('real-data')
  if (!dry && !isMainTree()) throw new Error('the soak runs from the main tree only; use --dry here')
  const hours = Number(args.opt('hours', dry ? 0 : 8))
  const everyS = Number(args.opt('interval-s', dry ? 6 : SAMPLE_EVERY_S))
  const totalS = dry ? Number(args.opt('seconds', 14)) : hours * 3600
  const exe = resolveBuild('smoke', args.opt('exe', null))
  const kind = realData ? 'real' : 'fixture'
  const out = await executeSlot({ mode: 'soak', build: 'smoke', slot: 1, attempt: 1, kind: dry ? 'dry' : 'measure', outDir, gateSeconds: 0, provisionalAfter: 1, gateFn: async () => ({ avgPct: null, maxPct: null, seconds: 0, limitPct: 10, enforced: false, pass: true, samples: [] }),
    meta: { provenance, hours, everyS, shippedCaps: true }, expected: [],
    runFn: async ({ gate }) => {
      const session = await openSmoke({ exe, runDir: path.join(outDir, 'launch', 'soak'), o: { realData, pageRows: false } })
      const result = session.result
      const samples = []
      const errors = []
      try {
        if (!session.cdp) throw new Error(result.fatal ?? 'no debugging session')
        await waitHomeReady(session.cdp, 90_000)
        const t0 = Date.now()
        let stoppedEarly = false
        while ((Date.now() - t0) / 1000 < totalS) {
          await round(session.cdp, kind, errors)
          const m = memTree(session.run.child.pid)
          samples.push({ atS: Math.round((Date.now() - t0) / 1000), wsPrivateMB: Math.round((m.wsPrivate / MB) * 10) / 10, privateBytesMB: Math.round((m.privateBytes / MB) * 10) / 10, processes: m.n,
            jsHeapMB: Math.round(((await session.cdp.eval('performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null').catch(() => null)) ?? 0) * 10) / 10,
            ...sampleBreakdown(session.run.child.pid) })
          if (fs.existsSync(SOAK_STOP_FILE)) { stoppedEarly = true; break }
          const wait = everyS * 1000 - ((Date.now() - t0) % (everyS * 1000))
          await sleep(Math.min(wait, Math.max(0, totalS * 1000 - (Date.now() - t0))))
        }
        result.stoppedEarly = stoppedEarly
      } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 800) } finally { await session.close() }
      result.samples = samples
      result.workloadErrors = errors.slice(0, 50)
      result.soak = summariseSoak(samples)
      result.leak = result.soak.leak
      result.rows = result.soak.maxMB === null ? {} : { soak_mem: result.soak.maxMB }
      result.homeReady = result.homeReady !== false
      result.figures = result.soak.maxMB === null ? [] : [figure({ row: 'soak_mem', build: 'smoke', value: result.soak.maxMB, unit: 'MB', method: 'soak runner: whole-tree private working set, the largest sample', cpuLoadPct: gate?.avgPct, provenance, extra: { privateBytesMaxMB: result.soak.privateBytesMaxMB, privateBytesSlopeMBPerHour: result.soak.privateBytesSlopeMBPerHour, leak: result.soak.leak.verdict, samples: samples.length, hours, partial: result.stoppedEarly || totalS < 8 * 3600, startupPeakMB: result.soak.startupPeakMB, settledMaxMB: result.soak.settledMaxMB } })]
      return result
    } })
  const leakFailed = out.result?.leak?.verdict === 'fail'
  if (leakFailed) console.error(`soak FAILED: ${out.result.leak.reason}`)
  console.log(JSON.stringify({ mode: 'soak', status: out.status, leak: out.result?.leak?.verdict, soak: out.result?.soak, partial: out.result?.stoppedEarly, windows: out.result?.watch?.newWindows.length }))
  return { ...out, failed: leakFailed }
}
