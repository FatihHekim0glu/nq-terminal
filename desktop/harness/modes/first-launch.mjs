// First launch after a reboot (04 D5; 02 section 6.3: "including the first launch after a reboot"). One command for the
// owner, run after the reboot: `node desktop\harness\run.mjs --first-launch [--build measure|smoke]`. The window is hidden, the
// global watch runs, and the process-level rows are read exactly as for any other launch. Straight after a boot the machine
// is busy with start-up work, so the CPU gate is waited on for a while (default 10 minutes) and then the launch is taken anyway,
// labelled PROVISIONAL with the load recorded (the record also carries tag FIRST-LAUNCH) (manager decision 2). The record says how long the machine had been up.
import os from 'node:os'
import path from 'node:path'
import { resolveBuild } from '../lib/build.mjs'
import { waitQuiet } from '../lib/gate.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { launchRun } from '../lib/launch-run.mjs'
import { figuresOf, selectRows } from './rows.mjs'
import { isMainTree, LAB } from '../lib/paths.mjs'
import { launchBlock } from '../lib/lab-guard.mjs'
import { writeRecord } from '../lib/record.mjs'

export const BOOT_WINDOW_S = 30 * 60

export async function run({ args, outDir, provenance }) {
  const dry = args.flag('dry')
  const build = args.opt('build', 'measure')
  if (!['smoke', 'measure'].includes(build)) throw new Error('--build smoke|measure')
  if (!dry && !isMainTree()) throw new Error('the first-launch reading runs from the main tree only; use --dry here')
  const realData = !dry
  const uptimeSeconds = Math.round(os.uptime())
  const firstAfterBoot = uptimeSeconds <= BOOT_WINDOW_S
  if (!dry && !firstAfterBoot) console.log(`note: the machine has been up ${Math.round(uptimeSeconds / 60)} minutes; this is not a first launch after a boot, and the record says so`)
  const exe = resolveBuild(build, args.opt('exe', null))
  const block = launchBlock(build, realData, LAB)
  if (block) {
    const body = { mode: 'first-launch', build, slot: 1, attempt: 1, kind: 'measure', tag: 'FIRST-LAUNCH', provenance, uptimeSeconds, firstAfterBoot, status: 'pending', reason: `real lab not quiet: ${block.problems.join('; ')}`, pending: block.problems, labCheck: { before: block.summary } }
    const file = writeRecord(outDir, `first-launch-${build}-s01-a1-measure`, body)
    console.log(JSON.stringify({ mode: 'first-launch', build, status: 'pending', pending: block.problems }))
    return { status: 'pending', file, result: body }
  }
  const quiet = dry ? { quiet: true, readings: [], waitedSeconds: 0 } : await waitQuiet({ gateSeconds: Number(args.opt('gate-seconds', 60)), limitPct: Number(args.opt('cpu-limit', 10)), maxWaitSeconds: Number(args.opt('max-wait-seconds', 600)) })
  const last = quiet.readings.at(-1) ?? { avgPct: null, maxPct: null, seconds: 0, limitPct: 10, enforced: false, pass: true, samples: [] }
  const rows = selectRows(build, 'all', realData)
  const runDir = path.join(outDir, 'launch', `first-launch-${build}`)
  const out = await executeSlot({ mode: 'first-launch', build, slot: 1, attempt: 1, kind: dry ? 'dry' : 'measure', outDir, gateSeconds: 0, limitPct: 10, provisionalAfter: 1, gateFn: async () => last,
    meta: { provenance, tag: 'FIRST-LAUNCH', uptimeSeconds, firstAfterBoot, quietReadings: quiet.readings.map((g) => ({ avgPct: g.avgPct, maxPct: g.maxPct })), waitedSeconds: quiet.waitedSeconds }, expected: rows.filter((id) => !['warm_home', 'eq_warm', 'reg_warm', 'grid_open', 'gip_pan_zoom_p95', 'keystroke_p95'].includes(id)),
    runFn: async ({ gate }) => { const r = await launchRun({ build, exe, runDir, o: { realData, pageRows: false } }); return { ...r, figures: figuresOf(build, r, gate, provenance) } } })
  console.log(JSON.stringify({ mode: 'first-launch', build, status: out.status, uptimeSeconds, firstAfterBoot, quiet: quiet.quiet, rows: out.result?.rows, windows: out.result?.watch?.newWindows.length }))
  return out
}
