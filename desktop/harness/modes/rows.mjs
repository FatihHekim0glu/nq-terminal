// The G2 rows on a build: `run.mjs --build smoke|measure|both --rows all|id,id --runs 3`. Each slot is one launch behind the
// CPU gate, watched by the global window and foreground watch, written as one raw record with every figure carrying its build,
// method, CPU load and provenance stamp. Slots of the two builds interleave (smoke, measure, smoke, measure) so a drifting
// machine shows in both. Medians of 3 are taken by report.mjs from the raw files, never here.
import path from 'node:path'
import { resolveBuild } from '../lib/build.mjs'
import { readCpu } from '../lib/gate.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { figure, writeRecord } from '../lib/record.mjs'
import { ROWS, rowById, rowsForLaunch } from '../lib/rows.mjs'
import { launchRun } from '../lib/launch-run.mjs'
import { reproduceGate, harnessDigest } from '../lib/harness.mjs'
import { isMainTree } from '../lib/paths.mjs'
import { cFreeMB } from '../lib/provenance.mjs'

/** The row ids a launch of `build` is asked for: `all`, or a comma list checked against the build's own rows. */
export function selectRows(build, spec, realData) {
  const available = rowsForLaunch(build, { realData }).map((r) => r.id)
  if (spec === 'all') return available
  const wanted = String(spec).split(',').map((s) => s.trim()).filter(Boolean)
  for (const id of wanted) if (!rowById(id)) throw new Error(`no row ${id}; rows: ${ROWS.map((r) => r.id).join(', ')}`)
  const missing = wanted.filter((id) => !available.includes(id))
  if (missing.length) throw new Error(`rows not available on the ${build} build${realData ? '' : ' without --real-data'}: ${missing.join(', ')}`)
  return wanted
}

const PAGE_ROWS = new Set(['warm_home', 'eq_warm', 'reg_warm', 'grid_open', 'gip_pan_zoom_p95', 'keystroke_p95'])

export function figuresOf(build, result, gate, provenance) {
  return Object.entries(result.rows ?? {}).map(([id, value]) => {
    const row = rowById(id)
    const method = id === 'cold_home' ? `${row?.method[build]} [read as: ${result.coldHomeMethod}]` : id === 'splash_painted' ? `${row?.method[build]} [read as: ${result.splashMethod}]` : row?.method[build]
    return figure({ row: id, build, value: value, unit: row?.unit, method, cpuLoadPct: gate?.avgPct, provenance, extra: { dataKind: result.dataKind } })
  })
}

function refuseUnsound(dry, realData, builds) {
  if (dry) return
  if (!isMainTree()) throw new Error('measurements run from the main tree only (this tree is not the lab\'s terminal folder): use --dry here')
  if (builds.includes('measure') && !realData) throw new Error('the measure build runs the real backend: pass --real-data for an accepted run')
}

export async function run({ args, outDir, provenance }) {
  const dry = args.flag('dry')
  const realData = args.flag('real-data')
  const which = args.opt('build', 'smoke')
  const builds = which === 'both' ? ['smoke', 'measure'] : [which]
  if (builds.some((b) => !['smoke', 'measure'].includes(b))) throw new Error('--build smoke|measure|both')
  refuseUnsound(dry, realData, builds)
  const runs = Number(args.opt('runs', dry ? 1 : 3))
  const warmup = Number(args.opt('warmup', dry ? 0 : 1))
  const gateSeconds = Number(args.opt('gate-seconds', dry ? 5 : 60))
  const limitPct = Number(args.opt('cpu-limit', 10))
  const provisionalAfter = Number(args.opt('provisional-after', args.opt('max-rejects', 5)))
  const gate = reproduceGate()
  if (!dry && !gate.ok && !args.flag('allow-unreproduced')) throw new Error(`${gate.why} (or pass --allow-unreproduced; every figure is then labelled UNREPRODUCED)`)
  const exes = Object.fromEntries(builds.map((b) => [b, resolveBuild(b, args.opt(`${b}-exe`, args.opt('exe', null)))]))
  const meta = { provenance, harnessDigest: harnessDigest(), unreproduced: !gate.ok, cFreeMBBefore: cFreeMB() }
  const kinds = [...Array(warmup).fill('warmup'), ...Array(runs).fill(dry ? 'dry' : 'measure')]
  const outcomes = []
  for (const [i, kind] of kinds.entries()) {
    for (const build of builds) outcomes.push(await slotsFor({ build, exe: exes[build], slot: i + 1, kind, args, outDir, meta, realData, gateSeconds, limitPct, provisionalAfter, rows: selectRows(build, args.opt('rows', 'all'), realData) }))
  }
  const flat = outcomes.flat()
  const summary = { dry, builds, exes, realData, outcomes: flat.map((o) => ({ build: o.build, slot: o.slot, attempt: o.attempt, status: o.status })), cFreeMBAfter: cFreeMB() }
  writeRecord(outDir, 'rows-summary', { mode: 'rows', ...summary })
  return { ...summary, status: flat.every((o) => o.status === 'dry') ? 'dry' : 'mixed', result: flat.at(-1)?.result }
}

async function slotsFor(ctx) {
  const { build, exe, slot, kind, args, outDir, meta, realData, rows } = ctx
  const pageRows = rows.some((id) => PAGE_ROWS.has(id))
  const done = []
  for (let attempt = 1, rejects = 0; ; attempt++) {
    const runDir = path.join(outDir, 'launch', `${build}-s${slot}-a${attempt}`)
    const out = await executeSlot({ mode: 'rows', build, slot, attempt, kind, outDir, gateSeconds: ctx.gateSeconds, limitPct: ctx.limitPct, gateFn: readCpu, rejectsSoFar: rejects, provisionalAfter: ctx.provisionalAfter, meta, expected: rows,
      runFn: async ({ gate }) => { const r = await launchRun({ build, exe, runDir, o: { realData, pageRows, homeTimeoutMs: Number(args.opt('home-timeout-ms', 90_000)) } }); return { ...r, figures: figuresOf(build, r, gate, meta.provenance) } } })
    done.push({ build, slot, attempt, status: out.status, result: out.result })
    console.log(JSON.stringify({ build, slot, attempt, kind, status: out.status, gateAvgPct: out.gate?.avgPct, rows: out.result?.rows, windows: out.result?.watch?.newWindows.length, fg: out.result?.watch?.foregroundChanges.length, fatal: out.result?.fatal?.slice(0, 160) }))
    if (out.status !== 'rejected') return done.at(-1)
    rejects += 1
  }
}
