// CDP driver for the spike. Targets: tauri (hidden Tauri window, WebView2 154) or edge (msedge --headless=new).
// Node 24, no dependencies. Usage: node drive.mjs <tauri|edge> <runIndex> <outDir> [exePath]
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [target, runIdx, outDir, exeArg] = process.argv.slice(2)
const APP = 'http://127.0.0.1:8791/'
const PORT = target === 'tauri' ? 9333 : 9334
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const PROBE = fs.readFileSync(path.join(HERE, 'home-probe.js'), 'utf8')
const EXE = exeArg ?? 'D:\\dev\\spikes\\tauri-shell\\src-tauri\\target\\release\\nq-shell.exe'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const LINES = (process.env.NQ_LINES ?? 'LEDG|OOS|NQ GP 1d|volmanaged_v0 EQ|LIVE|27F MON|REG|HOME').split('|')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = path.join('D:\\dev\\spikes\\prof', `${target}-${runIdx}`)
fs.rmSync(prof, { recursive: true, force: true })
fs.mkdirSync(prof, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
const spikeLog = path.join(outDir, `${target}-${runIdx}.milestones.txt`)
fs.rmSync(spikeLog, { force: true })

function mem(rootPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'mem.ps1'), '-RootPid', String(rootPid)], { encoding: 'utf8' })
  return JSON.parse(out)
}

async function jsonList() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() } catch { return [] }
}

class Cdp {
  constructor(wsUrl) { this.id = 0; this.pending = new Map(); this.ws = new WebSocket(wsUrl) }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res; this.ws.onerror = rej
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data)
        if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

const result = { target, run: Number(runIdx), startedAtIso: new Date().toISOString(), load: {} }
result.load.cpuBefore = mem(process.pid).cpuTotalPct
const t0 = Date.now()
let child
if (target === 'tauri') {
  child = spawn(EXE, [], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NQ_URL: APP, NQ_HIDDEN: '1', NQ_INIT_JS: path.join(HERE, 'home-probe.js'), NQ_SPIKE_LOG: spikeLog,
      WEBVIEW2_USER_DATA_FOLDER: prof,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding` },
  })
} else {
  child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
}
result.rootPid = child.pid
let cdp
try {
  let page
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const list = await jsonList()
    page = list.find((t) => t.type === 'page' && (target === 'tauri' ? t.url.startsWith(APP) : true))
    if (page) break
    await sleep(20)
  }
  if (!page) throw new Error('no page target')
  result.tCdpReadyMs = Date.now() - t0
  cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  if (target === 'edge') {
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: APP })
  }
  const waitFor = async (expr, ms, step = 20) => {
    const end = Date.now() + ms
    while (Date.now() < end) { try { if (await cdp.eval(expr)) return true } catch { /* page navigating */ } await sleep(step) }
    return false
  }
  const gotReady = await waitFor(`performance.getEntriesByName('nqt:home-ready').length>0 || performance.getEntriesByName('nqt:home-ready:timer').length>0`, 60_000)
  result.homeReady = gotReady
  const homeInfo = await cdp.eval(`(() => { const g = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? e.startTime : null };
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { origin: performance.timeOrigin, frame: g('nqt:home-frame'), ready: g('nqt:home-ready'), settled: g('nqt:home-settled'),
      frameT: g('nqt:home-frame:timer'), readyT: g('nqt:home-ready:timer'), fcp: fcp ? fcp.startTime : null,
      vis: document.visibilityState, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight, uaString: navigator.uaString } })()`)
  await waitFor(`performance.getEntriesByName('nqt:home-settled').length>0 || performance.getEntriesByName('nqt:home-settled:timer').length>0`, 20_000)
  result.home = await cdp.eval(`(() => { const g = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? e.startTime : null };
    return { origin: performance.timeOrigin, frame: g('nqt:home-frame'), ready: g('nqt:home-ready'), settled: g('nqt:home-settled'),
      frameT: g('nqt:home-frame:timer'), readyT: g('nqt:home-ready:timer'), settledT: g('nqt:home-settled:timer'),
      fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? null,
      vis: document.visibilityState, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight, uaString: navigator.uaString } })()`)
  const rd = result.home.ready ?? result.home.readyT
  result.coldStartToHomeReadyMs = Math.round(result.home.origin + rd - t0)
  result.navStartAfterSpawnMs = Math.round(result.home.origin - t0)
  if (fs.existsSync(spikeLog)) result.milestones = Object.fromEntries(fs.readFileSync(spikeLog, 'utf8').trim().split('\n').map((l) => { const [k, v] = l.split(' '); return [k, Number(v) - t0] }))
  await sleep(2500)
  result.memOpen = mem(child.pid)

  // five-plus heavy screens through the keyboard grammar (Ctrl+K, line, Enter)
  result.screens = []
  for (const line of LINES) {
    const t1 = Date.now()
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
    const focused = await waitFor(`(() => { const a = document.activeElement; return a && (a.getAttribute('role')==='combobox') })()`, 3000)
    if (!focused) { result.screens.push({ line, error: 'command line not focused' }); continue }
    await cdp.send('Input.insertText', { text: line })
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    const titled = line === 'HOME'
      ? await waitFor(`document.querySelectorAll('[data-nqt-title]').length>=4`, 8000)
      : await waitFor(`document.querySelectorAll('[data-nqt-title=${JSON.stringify(line)}]').length===1`, 5000)
    const settled = titled && await waitFor(`document.querySelector('p.ws-empty')===null && document.querySelector('[aria-busy="true"]')===null`, 25_000)
    const ms = Date.now() - t1
    const dom = await cdp.eval(`({ panels: document.querySelectorAll('[data-nqt-title]').length, nodes: document.getElementsByTagName('*').length, canvases: document.getElementsByTagName('canvas').length, heap: performance.memory ? performance.memory.usedJSHeapSize : null })`)
    await sleep(1500)
    const m = mem(child.pid)
    result.screens.push({ line, titled, settled, ms, ...dom, memPrivMB: Math.round(m.wsPrivate / 1048576), memWsMB: Math.round(m.ws / 1048576), nproc: m.n })
  }
  await sleep(3000)
  result.memAfter = mem(child.pid)
  result.load.cpuAfter = result.memAfter.cpuTotalPct
  result.errors = await cdp.eval(`window.__nqErrors ?? null`)
} catch (e) {
  result.fatal = String(e && e.stack || e)
} finally {
  try { cdp?.ws.close() } catch { /* ignore */ }
  // close everything this run started: kill the root's tree (taskkill only touches that tree)
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
}
fs.writeFileSync(path.join(outDir, `${target}-${runIdx}.json`), JSON.stringify(result, null, 1))
const mb = (b) => (b / 1048576).toFixed(0)
console.log(JSON.stringify({ target, run: runIdx, ready: result.homeReady, coldStartToHomeReadyMs: result.coldStartToHomeReadyMs, memOpenPrivMB: result.memOpen && mb(result.memOpen.wsPrivate), memAfterPrivMB: result.memAfter && mb(result.memAfter.wsPrivate), screens: (result.screens || []).map((s) => `${s.line}:${s.settled ? s.ms : 'x'}`), fatal: result.fatal }))
