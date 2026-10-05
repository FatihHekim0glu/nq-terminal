// The measurement harness of the Windows shell (04 D5.1; 03 sections 15.4 and 18). Node built-ins only; output under D:\dev\d5\runs.
//
//   node run.mjs --build smoke|measure|both [--rows all|id,id] [--runs 3] [--warmup 1] [--real-data] [--dry]
//       the G2 rows on a build (the launch prelude, the CPU gate, the window watch, one raw record per run); W5B, quiet window
//   node run.mjs --mode reproduce [--runs 3] [--dry]            the W0B Tauri-spike figures, reproduced before anything new
//   node run.mjs --mode minimise-sim [--hold-seconds 1800]      controller hidden for 30 to 60 minutes with LIVE streaming, then back
//   node run.mjs --mode minimise-real [--hold-seconds 1800]     real minimise and restore on screen 2 behind the guard
//   node run.mjs --first-launch [--build measure|smoke]         the first launch after a reboot: one command for the owner
//   node run.mjs --mode t8 [--playwright]                       smoke --attach-url on the offline demo server, WebView2 version recorded
//   node run.mjs --mode soak [--hours 8] [--real-data]          the all-day soak at the shipped caps, sampled every 5 minutes
//   node run.mjs --mode installer [--installer FILE]            the installer size row
//   node run.mjs --mode parity [--runs 1] [--settle-s 6] [--shell-port N --plain-port N]     the fixture backend started as the shell starts it and the plain way (8792, 8791): fails above 5 MB or on a thread count
//   node run.mjs --mode selftest                                the live self-tests (planted spin, planted window, PATH, DRY runs)
//   node report.mjs DIR [--check]                               medians, verdicts and the read-back check of every figure
//
// --dry takes one unmeasured run per mode (no gate enforced, no counted figure). --out DIR names the output folder.
// Every launch: hidden window, the global window and foreground watch, and a PATH without D:\dev\mingw and D:\dev\cargo.
// The smoke exe and the measure exe are found under D:\dev\targets (the newest of each kind) or named with --exe, --smoke-exe, --measure-exe.
import { newRunFolder } from './lib/paths.mjs'
import { provenance as readProvenance, cFreeMB } from './lib/provenance.mjs'

export function makeArgs(argv) {
  return { flag: (n) => argv.includes(`--${n}`), opt: (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d } }
}

const MODES = {
  rows: () => import('./modes/rows.mjs'),
  reproduce: () => import('./modes/reproduce.mjs'),
  'minimise-sim': () => import('./modes/minimise.mjs'),
  'minimise-real': () => import('./modes/minimise.mjs'),
  'first-launch': () => import('./modes/first-launch.mjs'),
  t8: () => import('./modes/t8.mjs'),
  soak: () => import('./modes/soak.mjs'),
  installer: () => import('./modes/installer.mjs'),
  selftest: () => import('./modes/selftest.mjs'),
  parity: () => import('./modes/parity.mjs'),
}

export function modeOf(args) {
  if (args.flag('first-launch')) return 'first-launch'
  const m = args.opt('mode', null)
  if (m) return m
  if (args.flag('build')) return 'rows'
  return null
}

// A mode reports failure as a boolean (parity, soak) or as the list of failed section names (selftest, empty on success).
export function exitCodeOf(out) {
  const failed = out?.failed
  return (Array.isArray(failed) ? failed.length > 0 : Boolean(failed)) ? 1 : 0
}

async function main() {
  const args = makeArgs(process.argv.slice(2))
  const mode = modeOf(args)
  if (!mode || !MODES[mode]) {
    console.error(`usage: node run.mjs --build smoke|measure|both | --mode ${Object.keys(MODES).filter((m) => m !== 'rows').join('|')} | --first-launch  (see the header of run.mjs)`)
    process.exit(2)
  }
  const outDir = args.opt('out', null) ?? newRunFolder(mode + (args.flag('dry') ? '-dry' : ''))
  const provenance = readProvenance()
  const cBefore = cFreeMB()
  console.log(`output ${outDir}`)
  const mod = await MODES[mode]()
  const result = await mod.run({ args, outDir, provenance, mode })
  const cAfter = cFreeMB()
  if (cBefore !== null && cAfter !== null && cBefore - cAfter >= 100) console.log(`note: C: free space fell by ${cBefore - cAfter} MB during the run (recorded; other programs write there too)`)
  return result
}

import { fileURLToPath } from 'node:url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((out) => process.exit(exitCodeOf(out)), (e) => { console.error(e); process.exit(1) })
}
