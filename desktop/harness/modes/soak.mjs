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
import { memTree } from '../lib/mem.mjs'
import { figure } from '../lib/record.mjs'
import { MB } from '../lib/rows.mjs'
import { isMainTree } from '../lib/paths.mjs'

export const SOAK_STOP_FILE = 'D:\\dev\\d5\\soak.stop'
export const SAMPLE_EVERY_S = 300
const GIP_DATE = { fixture: '2011-01-20', real: '2019-03-14' }
export const workload = (kind) => ['NQ GP 1d', `NQ GIP ${GIP_DATE[kind]}`, 'volmanaged_v0 EQ', 'REG', '27F MON', '27F CORR', 'LEDG', 'OOS', 'LIVE', 'RUNS', 'MT']

/** Summary of a sample series: the largest, the last, the slope of a straight-line fit (MB per hour) and whether it is still growing. */
export function summariseSoak(samples) {
  const xs = samples.map((s) => s.wsPrivateMB).filter((v) => typeof v === 'number')
  if (xs.length === 0) return { n: 0, maxMB: null, lastMB: null, slopeMBPerHour: null }
  const t = samples.filter((s) => typeof s.wsPrivateMB === 'number').map((s) => s.atS / 3600)
  const n = xs.length
  const mt = t.reduce((a, b) => a + b, 0) / n
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const den = t.reduce((a, b) => a + (b - mt) ** 2, 0)
  const slope = den === 0 ? 0 : t.reduce((a, b, i) => a + (b - mt) * (xs[i] - mx), 0) / den
  return { n, maxMB: Math.max(...xs), lastMB: xs.at(-1), slopeMBPerHour: Math.round(slope * 10) / 10 }
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
            jsHeapMB: Math.round(((await session.cdp.eval('performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null').catch(() => null)) ?? 0) * 10) / 10 })
          if (fs.existsSync(SOAK_STOP_FILE)) { stoppedEarly = true; break }
          const wait = everyS * 1000 - ((Date.now() - t0) % (everyS * 1000))
          await sleep(Math.min(wait, Math.max(0, totalS * 1000 - (Date.now() - t0))))
        }
        result.stoppedEarly = stoppedEarly
      } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 800) } finally { await session.close() }
      result.samples = samples
      result.workloadErrors = errors.slice(0, 50)
      result.soak = summariseSoak(samples)
      result.rows = result.soak.maxMB === null ? {} : { soak_mem: result.soak.maxMB }
      result.homeReady = result.homeReady !== false
      result.figures = result.soak.maxMB === null ? [] : [figure({ row: 'soak_mem', build: 'smoke', value: result.soak.maxMB, unit: 'MB', method: 'soak runner: whole-tree private working set, the largest sample', cpuLoadPct: gate?.avgPct, provenance, extra: { samples: samples.length, hours, partial: result.stoppedEarly || totalS < 8 * 3600 } })]
      return result
    } })
  console.log(JSON.stringify({ mode: 'soak', status: out.status, soak: out.result?.soak, partial: out.result?.stoppedEarly, windows: out.result?.watch?.newWindows.length }))
  return out
}
