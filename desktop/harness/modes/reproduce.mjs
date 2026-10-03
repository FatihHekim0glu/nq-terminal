// Reproduction of the W0B Tauri-spike figures (04 D5.1: "before measuring anything new"). The spike shell
// (D:\dev\spikes\tauri-shell) is launched the way the T2 harness launched it, against the fixture backend on the T2 port, and
// the three figures of the T2 result are read again: whole-tree private memory at HOME, after the heavy set, and launch to
// HOME ready. Each must be within 10% of the W0B median or inside its min to max range (stats.withinNoise). The verdict is
// bound to the digest of the harness code (harness.mjs); a dry run writes a verdict that never opens the gate.
import fs from 'node:fs'
import path from 'node:path'
import { attach, findPage, sleep } from '../lib/cdp.mjs'
import { startFixtureBackend, warmHomeApi, sessionCookie, launchLink, backendReadyOnce } from '../lib/backend.mjs'
import { startWatch, stopWatch } from '../lib/winwatch.mjs'
import { stopOwned } from '../lib/stop.mjs'
import { OWN_NAMES, mergeRecorded } from '../lib/survivors.mjs'
import { spawnHidden } from '../lib/proc.mjs'
import { memTree } from '../lib/mem.mjs'
import { identityRows } from '../lib/shell.mjs'
import { readCpu } from '../lib/gate.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { writeRecord, figure } from '../lib/record.mjs'
import { PORTS, HARNESS_DIR } from '../lib/paths.mjs'
import { median, range, withinNoise, round } from '../lib/stats.mjs'
import { fillsBody } from '../lib/fills.mjs'
import { heavyErrors } from '../lib/heavy.mjs'
import { runLine, HOME_INFO, homeReadyMs, waitHomeReady, idleHealth } from '../lib/page-rows.mjs'
import { pivot } from '../lib/pagejs.mjs'
import { writeReproduceVerdict } from '../lib/harness.mjs'

export const TAURI_SPIKE_EXE = 'D:\\dev\\spikes\\tauri-shell\\src-tauri\\target\\release\\nq-shell.exe'
const RUN_FILLS = 'nt_dtsmom_v0_fixture_ts1'
const RUN_EQ = 'nt_volmanaged_v0_fixture_m1'
const SWITCHES = '--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding'
const MB = 1048576
const REFERENCE = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'reference', 'w0b-tauri.json'), 'utf8'))

/** The heavy set of bench_browser.run_once, step for step: the 8,411-fill pivot, uPlot, ECharts, lightweight-charts, six docked panels. */
async function heavySet(c) {
  const steps = [{ step: 'RUN open', ...(await runLine(c, `${RUN_FILLS} RUN`)) }]
  const p = await c.eval(pivot(RUN_FILLS), { awaitPromise: true, timeoutMs: 90_000 })
  steps.push({ step: '1 Perspective pivot, 8411 fills', domMs: p.total, pivot: p })
  for (const [name, line] of [['2 uPlot (RR)', `${RUN_EQ} RR`], ['3 ECharts (CORR)', '27F CORR'], ['4 lightweight-charts (GIP)', 'NQ GIP 2011-01-20']]) steps.push({ step: name, line, ...(await runLine(c, line)) })
  const t0 = Date.now()
  const dock = []
  for (const line of ['NQ DES', 'MT', 'RUNS', 'OOS', 'LIVE', 'volmanaged_v0 DES']) {
    try { const r = await runLine(c, line, true); dock.push({ line, domMs: r.domMs, paintMs: r.paintMs, panels: r.panels }) } catch (e) { dock.push({ line, error: String(e.message).slice(0, 400) }) }
  }
  steps.push({ step: '5 dockview, 6 extra panels', wall_ms: Date.now() - t0, panels: dock })
  return steps
}

/** One launch of the spike shell: HOME ready, memory at HOME, the heavy set, memory again. */
export async function runSpikeOnce({ runId, outDir, stateDir, backendPort = PORTS.fixtureBackend, cdpPort = PORTS.tauriSpikeCdp, heavy = true }) {
  const profile = path.join(outDir, 'prof', runId)
  fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true })
  const milestones = path.join(outDir, `${runId}.milestones.txt`)
  const url = `http://127.0.0.1:${backendPort}/`
  // Behind the D2 token the spike opens the launch page, which redeems a one-time code and leaves for the terminal: one extra hop
  // that the W0B run (taken before D2) did not have. The code is minted just before the spawn (it lives 60 s).
  const env = { NQ_URL: await launchLink(backendPort, stateDir), NQ_HIDDEN: '1', NQ_INIT_JS: path.join(HARNESS_DIR, 'lib', 'probe.js'), NQ_SPIKE_LOG: milestones, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} ${SWITCHES}` }
  const result = { shell: 'tauri-spike', profile, rows: {} }
  const t0 = Date.now()
  const child = spawnHidden(TAURI_SPIKE_EXE, [], { env })
  result.rootPid = child.pid
  let tree = []
  let cdp
  try {
    const page = await findPage(cdpPort, url, 60_000)
    if (!page) throw new Error(child.exitCode !== null ? `spike exited early with code ${child.exitCode}` : 'no page target')
    ;({ cdp } = await attach(cdpPort, url, 5000))
    await cdp.send('Runtime.enable')
    result.homeReady = await waitHomeReady(cdp, 60_000)
    result.home = await cdp.eval(HOME_INFO)
    const rd = homeReadyMs(result.home)
    result.homeReadyMs = rd === null ? null : Math.round(result.home.origin + rd - t0)
    result.breakdown = { navStartAfterSpawnMs: Math.round(result.home.origin - t0), readySinceNavMs: rd === null ? null : Math.round(rd * 10) / 10, frameMs: Math.round((result.home.frame ?? result.home.frameT ?? NaN) * 10) / 10 }
    result.idleHealth = await idleHealth(cdp)
    result.memOpen = memTree(child.pid)
    tree = mergeRecorded(identityRows(result.memOpen))
    if (heavy) await heavyAndMemory(cdp, child, result)
    result.tree = tree = mergeRecorded(tree, identityRows(result.memAfter ?? {}))
  } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 1200) } finally {
    try { cdp?.close() } catch { /* ignore */ }
    const stopped = await stopOwned(child, tree, { names: OWN_NAMES })
    result.survivors = stopped.survivors
  }
  result.rows = { memHomeMB: result.memOpen ? round(result.memOpen.wsPrivate / MB, 1) : null, memHeavyMB: result.memAfter && result.heavyErrors?.length === 0 ? round(result.memAfter.wsPrivate / MB, 1) : null, homeReadyMs: result.homeReadyMs ?? null }
  return result
}

async function heavyAndMemory(cdp, child, result) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] })
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  cdp.addRule(`/api/runs/${RUN_FILLS}/fills`, 'Request', async (p) => ({ body: fillsBody(p.request.url) }))
  await cdp.enableRules()
  result.steps = await heavySet(cdp)
  result.heavyErrors = heavyErrors(result.steps)
  await sleep(3000)
  result.memAfter = memTree(child.pid)
}

/** The verdict: each figure's median over the counted runs against the W0B reference, within noise or not. */
export function judgeBreakdown(runs, reference = REFERENCE.breakdown) {
  const out = {}
  for (const [name, ref] of Object.entries(reference ?? {})) {
    const values = runs.map((r) => r.breakdown?.[name]).filter((v) => typeof v === 'number' && Number.isFinite(v))
    const m = median(values)
    out[name] = { n: values.length, median: m, reference: ref.median, within: m !== null && withinNoise(m, ref), deltaMs: m === null ? null : round(m - ref.median, 1) }
  }
  return out
}

export function judgeReproduction(runs, reference = REFERENCE.figures) {
  const out = {}
  for (const [name, ref] of Object.entries(reference)) {
    const values = runs.map((r) => r.rows?.[name]).filter((v) => typeof v === 'number')
    const m = median(values)
    out[name] = { n: values.length, ...range(values), reference: ref, within: m !== null && withinNoise(m, ref), deltaPct: m === null ? null : round(((m - ref.median) / ref.median) * 100, 1) }
  }
  return out
}

/** The real backend alone (the W0B baseline method), watched: informational, since D1 changed the figure it is compared with. */
async function standaloneBackendReady(n, outDir) {
  const w = await startWatch(path.join(outDir, 'backend-ready.watch.jsonl'))
  const readings = []
  let watch
  try { for (let i = 0; i < n; i++) readings.push(await backendReadyOnce(PORTS.realBackend)) } finally { watch = await stopWatch(w) }
  const values = readings.map((r) => r.readyMs).filter((v) => typeof v === 'number')
  const ref = REFERENCE.informational?.backendReadyMs
  return { values, median: median(values), reference: ref?.median ?? null, deltaPct: values.length && ref ? round(((median(values) - ref.median) / ref.median) * 100, 1) : null,
    survivors: readings.flatMap((r) => r.survivors ?? []).length, windows: watch.newWindows.length, foregroundChanges: watch.foregroundChanges.length, fatal: readings.map((r) => r.fatal).filter(Boolean) }
}

export async function run({ args, outDir, provenance }) {
  const dry = args.flag('dry')
  const runs = Number(args.opt('runs', dry ? 1 : 3))
  const warmup = Number(args.opt('warmup', dry ? 0 : 1))
  const gateSeconds = Number(args.opt('gate-seconds', dry ? 5 : 60))
  const limitPct = Number(args.opt('cpu-limit', 10))
  const maxRejects = Number(args.opt('max-rejects', 5))
  if (!fs.existsSync(TAURI_SPIKE_EXE)) throw new Error(`the spike shell is not at ${TAURI_SPIKE_EXE}`)
  const backend = await startFixtureBackend(PORTS.fixtureBackend, path.join(outDir, 'backend'))
  const { stateDir } = backend
  const counted = []
  try {
    await warmHomeApi(PORTS.fixtureBackend, await sessionCookie(PORTS.fixtureBackend, stateDir))
    const kinds = [...Array(warmup).fill('warmup'), ...Array(runs).fill(dry ? 'dry' : 'measure')]
    for (const [i, kind] of kinds.entries()) {
      for (let attempt = 1, rejects = 0; ; attempt++) {
        const out = await executeSlot({ mode: 'reproduce', build: 'tauri-spike', slot: i + 1, attempt, kind, outDir, gateSeconds, limitPct, gateFn: readCpu, rejectsSoFar: rejects, provisionalAfter: maxRejects,
          meta: { provenance }, expected: ['memHomeMB', 'memHeavyMB', 'homeReadyMs'], runFn: ({ gate }) => runSpikeOnce({ runId: `s${i + 1}a${attempt}`, outDir, stateDir }).then((r) => ({ ...r, figures: figuresOf(r, gate, provenance) })) })
        console.log(JSON.stringify({ slot: i + 1, attempt, kind, status: out.status, rows: out.result?.rows, windows: out.result?.watch?.newWindows.length }))
        if (['accepted', 'dry'].includes(out.status)) counted.push(out.result)
        if (out.status !== 'rejected') break
        rejects += 1
      }
    }
  } finally { await stopOwned(backend.child); fs.rmSync(stateDir, { recursive: true, force: true }) }
  const verdict = judgeReproduction(counted)
  const reproduced = counted.length > 0 && Object.values(verdict).every((v) => v.within)
  const breakdown = judgeBreakdown(counted)
  const informational = { backendReadyStandalone: await standaloneBackendReady(dry ? 1 : runs, outDir) }
  const body = { dry, reproduced, runsCounted: counted.length, verdict, breakdown, informational, note: REFERENCE.note, provenance }
  writeRecord(outDir, 'reproduce-verdict', { mode: 'reproduce', ...body })
  writeReproduceVerdict(body)
  console.log(JSON.stringify({ reproduced, dry, within: Object.fromEntries(Object.entries(verdict).map(([k, v]) => [k, [v.median, v.within]])), breakdown }))
  return body
}

function figuresOf(r, gate, provenance) {
  const units = { memHomeMB: 'MB', memHeavyMB: 'MB', homeReadyMs: 'ms' }
  return Object.entries(r.rows).filter(([, v]) => v !== null).map(([row, value]) => figure({ row, build: 'tauri-spike', value, unit: units[row], method: 'T2 harness method: performance counters / spawn to HOME ready mark', cpuLoadPct: gate?.avgPct, provenance }))
}
