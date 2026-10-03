// The live self-tests of the harness (the unit tests are `node --test tests`). Each section is one claim, and each guard is
// shown to fail on the broken state before it is trusted:
//   spin      a planted spin on every core is rejected by the CPU gate (born failing); an idle control reads below the limit
//   screen2   the guard refuses a primary-monitor rectangle against the real monitor table and accepts one inside screen 2
//   planted   a window planted on screen 2 (and an owned popup) is seen by the global watch; with nothing planted it stays clean
//   path      a planted MinGW folder on PATH is stripped before a child starts
//   dry-*     one DRY run of each mode against the smoke build (fixture backend through the shell) with 0 new visible windows;
//             the screen-2 mode instead asserts its frame lies inside the screen-2 work area and the foreground never changed
//   node run.mjs --mode selftest [--only spin,screen2,planted,path] [--dry-modes] [--dry-only rows-smoke,...]
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readCpu } from '../lib/gate.mjs'
import { sleep } from '../lib/cdp.mjs'
import { killPid, spawnHidden } from '../lib/proc.mjs'
import { startWatch, stopWatch } from '../lib/winwatch.mjs'
import { monitors } from '../lib/winctl.mjs'
import { guardFrame, screen2Of } from '../lib/screen2.mjs'
import { PY, launchEnv } from '../lib/paths.mjs'
import { writeRecord } from '../lib/record.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLANT = path.join(HERE, '..', 'lib', 'plantwin.py')

async function spin() {
  const spinners = Array.from({ length: os.cpus().length }, () => spawn(process.execPath, ['-e', 'while(true){}'], { windowsHide: true, stdio: 'ignore' }))
  try {
    await sleep(500)
    const planted = await readCpu(5, { limitPct: 10, enforce: true })
    if (planted.pass) return { ok: false, detail: `the gate accepted a planted spin at ${planted.avgPct}%` }
    return { ok: true, detail: { plantedAvgPct: planted.avgPct, limit: 10 } }
  } finally { for (const s of spinners) killPid(s.pid) }
}

async function control() {
  await sleep(1500)
  const g = await readCpu(5, { limitPct: 10, enforce: true })
  return { ok: g.pass, detail: { controlAvgPct: g.avgPct, note: g.pass ? 'quiet' : 'the machine is busy; the control is informational' }, informational: true }
}

function screen2Live() {
  const table = monitors()
  const primary = table.find((m) => m.primary)
  if (!primary) return { ok: false, detail: 'no primary monitor in the table' }
  const [l, t, r, b] = primary.work
  const refused = guardFrame([l + 50, t + 50, Math.min(r - 50, l + 1100), Math.min(b - 50, t + 800)], table)
  if (refused.ok) return { ok: false, detail: 'the guard accepted a primary-monitor rectangle' }
  const second = screen2Of(table)
  if (!second) return { ok: true, detail: { primaryRefused: refused.reason, screen2: 'absent: the acceptance half was not exercised', monitors: table.length } }
  const [sl, st] = second.work
  const accepted = guardFrame([sl + 10, st + 10, sl + 600, st + 500], table)
  return { ok: accepted.ok, detail: { primaryRefused: refused.reason, screen2Accepted: accepted.ok, work: second.work } }
}

async function planted() {
  const runPlant = (...extra) => new Promise((res) => { const c = spawn(PY, ['-E', '-s', '-X', 'utf8', PLANT, ...extra], { windowsHide: true, stdio: 'ignore', env: launchEnv() }); c.once('exit', res) })
  const dir = fs.mkdtempSync(path.join('D:\\dev\\tmp', 'selftest-watch-'))
  const out = {}
  try {
    for (const [name, extra] of [['none', null], ['planted', []], ['owned', ['--owned']]]) {
      const w = await startWatch(path.join(dir, `watch-${name}.jsonl`))
      if (extra) await runPlant(...extra); else await sleep(1500)
      out[name] = await stopWatch(w)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  const ok = out.none.clean && out.planted.newWindows.length >= 1 && out.owned.newWindows.length >= 1
  return { ok, detail: { none: { clean: out.none.clean, windows: out.none.newWindows.length }, planted: out.planted.newWindows.length, ownedPopup: out.owned.newWindows.length } }
}

async function pathStrip() {
  const saved = process.env.PATH
  process.env.PATH = `C:\\Windows;D:\\dev\\mingw\\mingw64\\bin;D:\\dev\\cargo\\bin;${saved}`
  try {
    const got = await new Promise((res) => {
      const c = spawnHidden(process.execPath, ['-e', 'process.stdout.write(process.env.PATH)'], { stdio: ['ignore', 'pipe', 'ignore'] })
      let s = ''
      c.stdout.on('data', (d) => { s += d })
      c.once('exit', () => res(s))
    })
    const bad = got.split(';').filter((p) => /^d:\\dev\\(mingw|cargo)/i.test(p))
    return { ok: bad.length === 0 && got.length > 0, detail: { strippedChildPathEntries: got.split(';').length, leftBuildTools: bad } }
  } finally { process.env.PATH = saved }
}

const DRY_SECTIONS = {
  'rows-smoke': (a) => ['./rows.mjs', ['--build', 'smoke', '--dry', ...a]],
  'rows-measure': (a) => ['./rows.mjs', ['--build', 'measure', '--dry', ...a]],
  reproduce: (a) => ['./reproduce.mjs', ['--mode', 'reproduce', '--dry', ...a]],
  'minimise-sim': (a) => ['./minimise.mjs', ['--mode', 'minimise-sim', '--dry', ...a]],
  'minimise-real': (a) => ['./minimise.mjs', ['--mode', 'minimise-real', '--dry', ...a]],
  'first-launch': (a) => ['./first-launch.mjs', ['--first-launch', '--build', 'measure', '--dry', ...a]],
  t8: (a) => ['./t8.mjs', ['--mode', 't8', '--dry', ...a]],
  soak: (a) => ['./soak.mjs', ['--mode', 'soak', '--dry', ...a]],
  installer: (a) => ['./installer.mjs', ['--mode', 'installer', '--dry', ...a]],
}

/** Whether a mode's returned outcome is a clean DRY: status dry (or the mode's own verdict), no new window, no foreground change. */
export function dryVerdict(name, out) {
  const r = out?.result ?? out ?? {}
  const watch = r.watch
  if (name === 'installer') return { ok: !!out?.file, detail: { bytes: out?.bytes } }
  if (name === 'reproduce') return { ok: out?.runsCounted === 1 && Object.values(out.verdict ?? {}).every((v) => v.n === 1), detail: { reproduced: out?.reproduced, verdict: out?.verdict } }
  const status = out?.status
  const windowsOk = !!watch && watch.clean === true
  const real = name === 'minimise-real'
  const extra = real ? { allowed: watch?.allowed?.length ?? 0, guardAfter: r.guardAfter?.ok, foregroundUnchanged: r.foreground?.unchanged } : {}
  const modeOk = name.startsWith('minimise') ? r.passed === true : true
  return { ok: status === 'dry' && windowsOk && modeOk && (!real || (r.guardAfter?.ok === true && r.foreground?.unchanged === true)), detail: { status, newWindows: watch?.newWindows?.length, foregroundChanges: watch?.foregroundChanges?.length, notes: watch?.notes?.length, problems: r.problems, fatal: r.fatal?.slice(0, 200), rows: r.rows, ...extra } }
}

async function dry(name, outDir, provenance) {
  const { makeArgs } = await import('../run.mjs')
  const extra = []
  let fake = null
  if (name === 'installer') { fake = path.join('D:\\dev\\tmp', `selftest-${process.pid}_x64-setup.exe`); fs.writeFileSync(fake, Buffer.alloc(1_000_000, 1)); extra.push('--installer', fake) }
  const [file, argv] = DRY_SECTIONS[name](extra)
  const mod = await import(file)
  const sub = path.join(outDir, `dry-${name}`)
  fs.mkdirSync(sub, { recursive: true })
  try { return dryVerdict(name, await mod.run({ args: makeArgs(argv), outDir: sub, provenance, mode: argv[1] === '--mode' ? argv[2] : name })) } finally { if (fake) fs.rmSync(fake, { force: true }) }
}

export async function run({ args, outDir, provenance }) {
  const only = args.opt('only', null)?.split(',') ?? null
  const live = { spin, control, screen2: screen2Live, planted, path: pathStrip }
  const results = {}
  const want = (n) => !only || only.includes(n)
  for (const [name, fn] of Object.entries(live)) {
    if (!want(name) && !(name === 'control' && want('spin'))) continue
    try { results[name] = await fn() } catch (e) { results[name] = { ok: false, detail: String(e.message ?? e).slice(0, 300) } }
    console.log(JSON.stringify({ section: name, ...results[name] }))
  }
  const dryNames = args.opt('dry-only', null)?.split(',') ?? (args.flag('dry-modes') ? Object.keys(DRY_SECTIONS) : [])
  for (const name of dryNames) {
    if (!DRY_SECTIONS[name]) { results[`dry-${name}`] = { ok: false, detail: 'no such section' }; continue }
    try { results[`dry-${name}`] = await dry(name, outDir, provenance) } catch (e) { results[`dry-${name}`] = { ok: false, detail: String(e.stack ?? e).slice(0, 600) } }
    console.log(JSON.stringify({ section: `dry-${name}`, ...results[`dry-${name}`] }))
  }
  const failed = Object.entries(results).filter(([n, r]) => !r.ok && !r.informational).map(([n]) => n)
  writeRecord(outDir, 'selftest', { mode: 'selftest', status: failed.length ? 'failed' : 'dry', results, failed })
  console.log(JSON.stringify({ selftest: failed.length === 0 ? 'ok' : 'FAILED', failed }))
  if (failed.length) process.exitCode = 1
  return { results, failed }
}
