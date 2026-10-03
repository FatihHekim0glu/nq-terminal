// The page-internal rows, read over the debugging protocol of the smoke build: HOME marks, a command line run, the
// grid of 8,411 fills, the GIP pan and zoom trace and the keystroke to paint reading. The page-side scripts are the
// ones of the T2 harness and of web/e2e/perf/pages.ts (the same selectors and the same marks), so a number here is the
// number the browser budgets read.
import { sleep, browserVersion } from './cdp.mjs'
import { waitScreen, pivot } from './pagejs.mjs'
import { waitDockPanel } from './dockwait.mjs'
import { recordTrace, gestureStats } from './trace.mjs'
import { p95, median } from './stats.mjs'

export const HOME_EXPR = (name) => `performance.getEntriesByName('${name}').length>0 || performance.getEntriesByName('${name}:timer').length>0`
export const HOME_INFO = `(() => { const g = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? e.startTime : null };
  return { origin: performance.timeOrigin, frame: g('nqt:home-frame'), ready: g('nqt:home-ready'), settled: g('nqt:home-settled'),
    frameDom: g('nqt:home-frame-dom'), readyDom: g('nqt:home-ready-dom'), frameT: g('nqt:home-frame:timer'), readyT: g('nqt:home-ready:timer'), settledT: g('nqt:home-settled:timer'),
    fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? null,
    vis: document.visibilityState, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight, ua: navigator.userAgent, href: location.href,
    health: window.__t2Health ? { raf: window.__t2Health.raf, ticks: window.__t2Health.ticks, ms: performance.now() - window.__t2Health.t0 } : null } })()`

/** HOME ready, since navigation start (the mark, or its 400 ms timer fallback when frames do not come). */
export const homeReadyMs = (h) => h.ready ?? h.readyT ?? null

export async function waitHomeReady(c, ms) {
  const ready = await c.waitFor(HOME_EXPR('nqt:home-ready'), ms)
  if (ready) await c.waitFor(HOME_EXPR('nqt:home-settled'), 20_000)
  return ready
}

/** Idle frame and timer rates for `seconds`: a page that is hidden or starved shows here (the controller route of W0A P0). */
export async function idleHealth(c, seconds = 2.5) {
  const h0 = await c.eval('window.__t2Health ? { raf: window.__t2Health.raf, ticks: window.__t2Health.ticks, at: performance.now() } : null')
  await sleep(seconds * 1000)
  const h1 = await c.eval('window.__t2Health ? { raf: window.__t2Health.raf, ticks: window.__t2Health.ticks, at: performance.now(), vis: document.visibilityState } : null')
  if (!h0 || !h1) return null
  const dt = h1.at - h0.at
  return { seconds: dt / 1000, rafPerSec: Math.round(((h1.raf - h0.raf) / dt) * 10000) / 10, ticksPerSec: Math.round(((h1.ticks - h0.ticks) / dt) * 10000) / 10, vis: h1.vis }
}

/** A warm HOME: the page reloads against a backend whose caches are full; the figure is the ready mark since navigation start. */
export async function warmHomeReload(c, ms = 60_000) {
  await c.send('Page.reload', { ignoreCache: true })
  await sleep(300)
  const ready = await waitHomeReady(c, ms)
  const h = await c.eval(HOME_INFO)
  return { ready, readyMs: ready ? homeReadyMs(h) : null, info: h }
}

export async function runLine(c, line, shift = false) {
  const wait = shift ? waitDockPanel : waitScreen
  await c.key('k', 'KeyK', 75, { modifiers: 2 })
  if (!(await c.waitFor(`document.activeElement && document.activeElement.getAttribute('role') === 'combobox'`, 8000, 50))) throw new Error('command line not focused for ' + line)
  await c.send('Input.insertText', { text: line })
  await c.eval('window.__t0 = null')
  await c.key('Enter', 'Enter', 13, { modifiers: shift ? 8 : 0, text: '\r' })
  return c.eval(wait(line), { awaitPromise: true, timeoutMs: 60_000 })
}

/** A screen's open time, warm: the same line twice; the second reading is the figure (the first fills the backend's caches). */
export async function warmScreen(c, line) {
  const first = await runLine(c, line)
  const second = await runLine(c, line)
  return { firstMs: first.paintMs ?? first.domMs, ms: second.paintMs ?? second.domMs, domMs: second.domMs, panels: second.panels }
}

/** The run with exactly 8,411 fills (the real-data run), found through the API with the page's own session. */
export async function pickFillsRun(c, rows = 8411) {
  return c.eval(`(async () => {
    const get = async (p) => (await fetch(p)).json();
    const runs = (await get('/api/runs')).filter((r) => r.readable && r.usable && !r.is_probe && r.kind === 'book');
    for (const r of runs) { const p = await get('/api/runs/' + r.run_id + '/fills?limit=1'); if (p.total === ${rows}) return r.run_id }
    return '' })()`, { awaitPromise: true, timeoutMs: 120_000 })
}

/** Grid open at 8,411 fills: RUN open, then the Fills tab click to the painted grid (the pivot step's first stage). */
export async function gridOpen(c, run) {
  const open = await runLine(c, `${run} RUN`)
  const p = await c.eval(pivot(run), { awaitPromise: true, timeoutMs: 90_000 })
  return { ms: p.fillsGridMs, pivotOpenMs: p.pivotOpenMs, total: p.total, runOpenMs: open.paintMs ?? open.domMs, detail: p }
}

const DRIVE = `(async (kind, frames, panelTitle) => {
  const panel = document.querySelector('[data-nqt-title="' + panelTitle + '"]');
  const chart = Array.from(panel.querySelectorAll('[role="img"]')).find((e) => /1-minute bars/.test(e.getAttribute('aria-label') || ''));
  if (!chart) throw new Error('no 1-minute chart in ' + panelTitle);
  const box = chart.getBoundingClientRect(); const x0 = box.left + box.width * 0.5; const y = box.top + box.height * 0.4;
  const target = document.elementFromPoint(x0, y); if (!target) throw new Error('nothing under the chart centre');
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const mouse = (type, x, buttons) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons }));
  await frame(); performance.mark('nqt:' + kind + '-start');
  if (kind === 'pan') mouse('mousedown', x0, 1);
  for (let i = 1; i <= frames; i += 1) {
    if (kind === 'pan') mouse('mousemove', x0 + i * 2, 1);
    else target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, view: window, clientX: x0, clientY: y, deltaY: i <= (frames * 2) / 3 ? -20 : 20, deltaMode: 0 }));
    await frame();
  }
  if (kind === 'pan') mouse('mouseup', x0 + frames * 2, 0);
  performance.mark('nqt:' + kind + '-end');
})`

const PAINT = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))`
const CANVAS_PRINT = (title) => `(() => { const panel = document.querySelector('[data-nqt-title="${title}"]'); let h = 0;
  for (const cv of Array.from(panel.querySelectorAll('canvas'))) { const u = cv.toDataURL(); for (let i = 0; i < u.length; i += 7) h = (h * 31 + u.charCodeAt(i)) | 0 } return String(h) })()`
const BAR_COUNT = (title) => `(() => { const p = document.querySelector('[data-nqt-title="${title}"]'); const e = Array.from(p.querySelectorAll('[role="img"]')).find((x) => /1-minute bars/.test(x.getAttribute('aria-label') || ''));
  const m = e && /(\\d[\\d,]*) 1-minute bars/.exec(e.getAttribute('aria-label')); return m ? Number(m[1].replace(/,/g, '')) : null })()`

/** Zoom then pan the GIP chart under a CDP trace. The row value is the worse of the two gestures' p95 frame interval. */
export async function gipPanZoom(c, port, line, { frames = 120 } = {}) {
  const opened = await runLine(c, line)
  const bars = await c.eval(BAR_COUNT(line))
  const before = await c.eval(CANVAS_PRINT(line))
  const version = await browserVersion(port)
  if (!version?.webSocketDebuggerUrl) throw new Error('no browser target to trace')
  const drive = (kind) => c.eval(`${DRIVE}(${JSON.stringify(kind)}, ${frames}, ${JSON.stringify(line)})`, { awaitPromise: true, timeoutMs: 60_000 })
  const events = await recordTrace(version.webSocketDebuggerUrl, async () => {
    await drive('zoom'); await c.eval(PAINT, { awaitPromise: true })
    await drive('pan'); await c.eval(PAINT, { awaitPromise: true })
  })
  const zoom = gestureStats(events, 'zoom')
  const pan = gestureStats(events, 'pan')
  const after = await c.eval(CANVAS_PRINT(line))
  return { ms: Math.max(zoom.p95Ms, pan.p95Ms), zoom, pan, bars, moved: before !== after, openMs: opened.paintMs ?? opened.domMs }
}

const KEY_RECORDER = `(() => { window.__ks = []; if (window.__ksOn) return; window.__ksOn = true;
  document.addEventListener('keydown', (e) => { if (e.key.length !== 1) return; const t0 = e.timeStamp;
    requestAnimationFrame(() => requestAnimationFrame(() => window.__ks.push(performance.now() - t0))) }, true) })()`

export function charKey(ch) {
  if (ch === ' ') return { key: ' ', code: 'Space', vk: 32 }
  if (/[a-z]/i.test(ch)) return { key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0) }
  if (/[0-9]/.test(ch)) return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0) }
  throw new Error(`no key mapping for ${JSON.stringify(ch)}`)
}

/**
 * Keystroke to paint on the command line: Ctrl+K, then `count` typed characters 150 ms apart, each timed from its keydown
 * to the second animation frame after it (a double requestAnimationFrame, the same paint test the screens use; it reads
 * at most one frame late). The first `warm` readings are dropped. The row value is the p95.
 */
export async function keystrokeToPaint(c, { count = 80, warm = 5, text = 'NQ GP 1d', pauseMs = 150 } = {}) {
  await c.eval(KEY_RECORDER)
  await c.key('k', 'KeyK', 75, { modifiers: 2 })
  if (!(await c.waitFor(`document.activeElement && document.activeElement.getAttribute('role') === 'combobox'`, 8000, 50))) throw new Error('command line not focused')
  for (let i = 0; i < count; i++) {
    const { key, code, vk } = charKey(text[i % text.length])
    await c.key(key, code, vk, { text: key })
    await sleep(pauseMs)
    if ((i + 1) % text.length === 0) { for (let b = 0; b < text.length; b++) await c.key('Backspace', 'Backspace', 8) }
  }
  await sleep(300)
  const all = await c.eval('window.__ks')
  const kept = all.slice(warm)
  await c.key('Escape', 'Escape', 27)
  return { ms: p95(kept), medianMs: median(kept), n: kept.length, samples: kept.map((v) => Math.round(v * 10) / 10) }
}
