// The local T8 run (03 section 16, `webview2-drift.yml` stand-in): the smoke build's `--attach-url` switch pointed at the offline
// demo server (the gallery build behind `vite preview`, the demo API over HTTP, no Python, no backend, no handshake), so this
// run tests the engine and the page, not the auth. The harness records the WebView2 runtime version (the engine's own product
// string over the debugging protocol and the machine-wide `pv` registry value), then hands the attached shell to the desktop
// Playwright project: NQT_DESKTOP_ATTACH_CDP and NQT_DESKTOP_ATTACH_URL name the shell the project must attach to instead of
// launching its own (web/e2e/desktop/attach.ts and setup.ts honour both; only the specs 05-selftest and 10-walk run then). One Playwright run at a time on this
// machine: the harness refuses to start one while another playwright or vitest process is alive. A dry run stops after the
// page has loaded in the shell and never starts Playwright.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { resolveBuild } from '../lib/build.mjs'
import { openSmoke } from '../lib/launch-run.mjs'
import { executeSlot } from '../lib/slot.mjs'
import { readCpu } from '../lib/gate.mjs'
import { healthOk, spawnHidden, killPid } from '../lib/proc.mjs'
import { sleep } from '../lib/cdp.mjs'
import { stopOwned } from '../lib/stop.mjs'
import { treeIdentity } from '../lib/mem.mjs'
import { PORTS, TERMINAL, PY, launchEnv } from '../lib/paths.mjs'
import { writeRecord } from '../lib/record.mjs'

const WEBVIEW2_CLIENT = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
const REG_KEYS = [`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`, `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`]

/** The machine's WebView2 runtime version from the registry, or null. */
export function registryWebView2Version() {
  for (const key of REG_KEYS) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'pv'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      const m = /pv\s+REG_SZ\s+([0-9.]+)/.exec(out)
      if (m) return m[1]
    } catch { /* try the next key */ }
  }
  return null
}

/** Another Playwright or vitest browser run on this machine (command lines under any folder), as process ids. */
export function otherTestRuns() {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'playwright|vitest' -and $_.Name -match 'node|chrome|msedge|headless' } | ForEach-Object { $_.ProcessId }"
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    return out.split(/\s+/).filter(Boolean).map(Number)
  } catch { return [] }
}

const vite = (web, args, env) => spawnHidden(process.execPath, [path.join(web, 'node_modules', 'vite', 'bin', 'vite.js'), ...args], { cwd: web, env: { VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })

function build(web, dist) {
  return new Promise((res, rej) => {
    const c = vite(web, ['build', '--mode', 'gallery', '--outDir', dist, '--emptyOutDir'], {})
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.stdout.on('data', () => {})
    c.once('exit', (code) => (code === 0 ? res() : rej(new Error(`vite build failed (${code}): ${err.slice(-400)}`))))
  })
}

/** The offline demo server: gallery build into `dist` (outside node_modules), then `vite preview` on the T8 port with the demo API on. */
export async function startDemoServer(dist, port = PORTS.t8Demo) {
  const web = path.join(TERMINAL, 'web')
  if (await healthOk(port)) throw new Error(`port ${port} already answers; not started by this harness`)
  await build(web, dist)
  const child = vite(web, ['preview', '--mode', 'gallery', '--config', 'e2e/offline/vite.offline.config.ts', '--outDir', dist, '--port', String(port), '--strictPort'], { NQT_OFFLINE_API: 'on' })
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {})
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error('the demo server exited early')
    if (await healthOk(port)) return { child, port }
    await sleep(200)
  }
  killPid(child.pid)
  throw new Error('the demo server never answered')
}

async function stopDemoServer(server) {
  let tree = []
  try { tree = treeIdentity(server.child.pid) } catch { /* the root stands alone */ }
  return stopOwned(server.child, tree, { names: new Set(['node.exe']) })
}

/** The Playwright command and its working folder: pnpm must run from the web folder, which this pnpm requires for its workspace file. */
export function playwrightSpawn(args) {
  return { cmd: args.opt('playwright-cmd', 'corepack pnpm e2e:desktop'), cwd: path.join(TERMINAL, 'web') }
}

function runPlaywright(args, env) {
  const { cmd, cwd } = playwrightSpawn(args)
  return new Promise((res) => {
    const c = spawn(cmd, [], { cwd, windowsHide: true, env: launchEnv(process.env, env), stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    let out = ''
    c.stdout.on('data', (d) => { out += d }); c.stderr.on('data', (d) => { out += d })
    c.once('exit', (code) => res({ code, tail: out.slice(-2000) }))
  })
}

export async function run({ args, outDir, provenance }) {
  const dry = args.flag('dry')
  const others = otherTestRuns()
  if (!dry && others.length) throw new Error(`another Playwright or vitest run is alive (pids ${others.join(', ')}); one at a time on this machine`)
  const exe = resolveBuild('smoke', args.opt('exe', null))
  const dist = path.join(outDir, 'gallery')
  const server = await startDemoServer(dist)
  const url = `http://127.0.0.1:${server.port}/`
  let out
  try {
    out = await executeSlot({ mode: 't8', build: 'smoke', slot: 1, attempt: 1, kind: dry ? 'dry' : 'measure', outDir, gateSeconds: dry ? 5 : 60, limitPct: Number(args.opt('cpu-limit', 10)), gateFn: readCpu, provisionalAfter: 1, meta: { provenance, attachUrl: url }, expected: [],
      runFn: async () => {
        const session = await openSmoke({ exe, runDir: path.join(outDir, 'launch', 't8'), o: { attachUrl: url, pageRows: false } })
        const result = session.result
        try {
          if (!session.cdp) throw new Error(result.fatal ?? 'no debugging session')
          result.webview2 = { product: result.browser, registryPv: registryWebView2Version() }
          result.pageUrl = await session.cdp.eval('location.href')
          if (!dry && args.flag('playwright')) result.playwright = await runPlaywright(args, { NQT_DESKTOP_ATTACH_CDP: String(session.port), NQT_DESKTOP_ATTACH_URL: url })
        } catch (e) { result.fatal = String((e && e.stack) || e).slice(0, 800) } finally { await session.close() }
        return result
      } })
  } finally { await stopDemoServer(server) }
  writeRecord(outDir, 't8-summary', { mode: 't8', dry, status: out.status, webview2: out.result?.webview2 ?? null, playwrightExit: out.result?.playwright?.code ?? null })
  console.log(JSON.stringify({ mode: 't8', status: out.status, webview2: out.result?.webview2, page: out.result?.pageUrl, playwright: out.result?.playwright?.code, windows: out.result?.watch?.newWindows.length }))
  return out
}
