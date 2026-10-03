// Page drivers for the performance budgets and the real-data smoke run (TASKS 8.3). Each measured step
// writes performance.mark() calls into the page, so a CDP trace (browser.startTracing) holds the times;
// trace.ts reads them back. Shared by budgets.spec.ts (fixture backend) and smoke.real.ts (real files).
import { expect, type Browser, type BrowserContext, type Locator, type Page, type Request, type Response, type TestInfo } from '@playwright/test'
import { isStoreWrite } from '../storeWrites.ts'
import { recordDemoRefusals, withoutDemoRefusals } from '../target.ts'
import { startStoreInContext } from './storeOn.ts'
import { frameStats, judgeFrames, longTasks, markSpanMs, markStartMs, markTs, parseTrace, rendererOf, TRACE_CATEGORIES, type FrameStats } from './trace.ts'

export const FENCE_S = Date.UTC(2022, 0, 1) / 1000
export const FENCE_DATE = '2022-01-01'

/** What each HOME panel shows once its data is in: every selector must match inside the panel. */
export const HOME_READY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['NQ GP 1d', ['[role="img"][aria-label^="NQ1 Index: "]']],
  ['27F MON', ['[role="grid"]:not([aria-rowcount="1"])']],
  ['volmanaged_v0 EQ', ['ul[aria-label^="Key figures for "] .kpi-value', '[role="img"]']],
  ['REG', ['[role="grid"]:not([aria-rowcount="1"])']],
]

export interface Watch {
  readonly requests: Request[]
  readonly responses: Response[]
  /** Console errors (`<text> <url>`) and page errors so far, without the "Failed to load resource" lines of URLs the offline
   *  demo API refused (e2e/target.ts): that is the demo declining, not a page error. Against the fixture backend nothing is dropped. */
  readonly errors: string[]
}

export function watch(page: Page): Watch {
  const raw: string[] = []
  const refused = new Set<string>()
  // `errors` is read when asked, not when heard: the browser may log a failed load before or after its response event reaches us.
  const w: Watch = { requests: [], responses: [], get errors() { return withoutDemoRefusals(raw, refused) } }
  recordDemoRefusals(page, refused)
  page.on('request', (r) => w.requests.push(r))
  page.on('response', (r) => w.responses.push(r))
  page.on('console', (m) => {
    if (m.type() === 'error') raw.push(`${m.text()} ${m.location().url}`)
  })
  page.on('pageerror', (e) => raw.push(String(e)))
  return w
}

/** Every request a same-origin GET, or the workspace store's own PUT (03 section 10.3); nothing else may leave the page. */
export function offOriginOrNotGet(w: Watch, origin: string): string[] {
  return w.requests
    .filter((r) => !isStoreWrite(r.method(), r.url(), origin))
    .filter((r) => r.method() !== 'GET' || new URL(r.url()).origin !== origin)
    .map((r) => `${r.method()} ${r.url()}`)
}

export const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
export const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

export async function paint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** Waits until nothing in the workspace is loading: no screen placeholder and nothing aria-busy. */
export async function settle(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.locator('p.ws-empty')).toHaveCount(0, { timeout })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await paint(page)
}

/** Runs one line in the focused panel; the panel then carries the line as its title. */
export async function runLine(page: Page, line: string): Promise<Locator> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
  await expect(commandLine(page)).toHaveValue('')
  const target = panel(page, line)
  await expect(target).toHaveCount(1)
  return target
}

/** Starts a CDP trace of the whole browser with the budget categories. */
export async function startTrace(browser: Browser, page: Page): Promise<void> {
  await browser.startTracing(page, { categories: [...TRACE_CATEGORIES] })
}

export async function stopTrace(browser: Browser, info: TestInfo, name: string): Promise<ReturnType<typeof parseTrace>> {
  const raw = await browser.stopTracing()
  await info.attach(`${name}.trace.json`, { body: raw, contentType: 'application/json' })
  return parseTrace(raw)
}

/** A fresh context: empty HTTP cache and storage, the project's viewport and locale. It keeps the session cookie the
 * project's global set-up saved (use.storageState), since every /api path is behind the token (03 4.2). */
export async function freshContext(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  const use = info.project.use
  return browser.newContext({
    baseURL: use.baseURL,
    storageState: use.storageState,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
}

/**
 * Marks `nqt:home-frame` once the four HOME panels are laid out and painted, and `nqt:home-ready` once
 * each shows its data (HOME_READY) with no chart still loading and painted. Sparkline cells that load
 * row by row as they scroll into view (MON 2Day) are not part of the first render; `nqt:home-settled`
 * marks the moment nothing at all is busy.
 */
export async function installHomeProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript((ready: ReadonlyArray<readonly [string, readonly string[]]>) => {
    const marked = new Set<string>()
    const markAfterPaint = (name: string) => {
      if (marked.has(name)) return
      marked.add(name)
      requestAnimationFrame(() => requestAnimationFrame(() => performance.mark(name)))
    }
    const panelOk = ([title, selectors]: readonly [string, readonly string[]]) => {
      const p = document.querySelector(`[data-nqt-title="${title}"]`)
      return p !== null && selectors.every((s) => p.querySelector(s) !== null)
    }
    const check = () => {
      if (document.querySelectorAll('[data-nqt-title]').length >= ready.length) markAfterPaint('nqt:home-frame')
      const loading = document.querySelector('p.ws-empty') !== null
      const chartBusy = document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') !== null
      if (!loading && !chartBusy && ready.every(panelOk)) markAfterPaint('nqt:home-ready')
      if (marked.has('nqt:home-ready') && document.querySelector('[aria-busy="true"]') === null) markAfterPaint('nqt:home-settled')
    }
    const observer = new MutationObserver(check)
    const start = () => {
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      check()
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
    else start()
  }, HOME_READY)
}

export interface HomeTiming {
  readonly frameMs: number
  readonly readyMs: number
  readonly settledMs: number
  readonly fcpMs: number | null
  /** The five resources that finished last before ready: `<ms from navigation to response end> <path>`. */
  readonly slowest: readonly string[]
}

/** Why HOME is not ready yet: each panel's missing selectors and whatever is still busy. */
async function homeBlockers(page: Page): Promise<string> {
  return page.evaluate((ready) => {
    const out: string[] = []
    for (const [title, selectors] of ready) {
      const p = document.querySelector(`[data-nqt-title="${title}"]`)
      if (!p) { out.push(`no panel ${title}`); continue }
      const missing = selectors.filter((s) => p.querySelector(s) === null)
      if (missing.length > 0) out.push(`${title} lacks ${missing.join(', ')}`)
    }
    for (const el of Array.from(document.querySelectorAll('[aria-busy="true"]')).slice(0, 5)) {
      out.push(`busy ${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} ${(el.getAttribute('aria-label') ?? '').slice(0, 60)}`)
    }
    if (document.querySelector('p.ws-empty')) out.push('a screen is still loading')
    return out.join('; ') || 'nothing (the mark was not written)'
  }, HOME_READY)
}

async function waitMark(page: Page, name: string, timeout: number): Promise<void> {
  try {
    await page.waitForFunction((n) => performance.getEntriesByName(n).length > 0, name, { timeout })
  } catch (error) {
    throw new Error(`${name} never came: ${await homeBlockers(page).catch(() => 'page gone')}`, { cause: error })
  }
}

/** One cold HOME load in a fresh context, traced; times in ms since navigation start. */
export async function measureHome(browser: Browser, info: TestInfo, label: string, timeout = 30_000): Promise<HomeTiming> {
  const context = await freshContext(browser, info)
  try {
    await installHomeProbe(context)
    // Production starts the workspace store before it boots; the gallery build starts it only on request (src/main.tsx).
    await startStoreInContext(context)
    const page = await context.newPage()
    await startTrace(browser, page)
    let events: ReturnType<typeof parseTrace>
    let slowest: string[] = []
    try {
      await page.goto('/')
      await waitMark(page, 'nqt:home-ready', timeout)
      await waitMark(page, 'nqt:home-settled', timeout).catch(() => undefined)
      slowest = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .map((r) => [r.responseEnd, new URL(r.name).pathname + new URL(r.name).search] as const)
        .sort((a, b) => b[0] - a[0]).slice(0, 5).map(([end, path]) => `${Math.round(end)} ${path.slice(0, 90)}`))
    } finally {
      events = await stopTrace(browser, info, label)
    }
    const fcp = events.find((e) => e.name === 'firstContentfulPaint')
    const nav = events.find((e) => e.name === 'navigationStart' && e.cat.includes('blink.user_timing'))
    let settledMs = Number.NaN
    try {
      settledMs = markStartMs(events, 'nqt:home-settled')
    } catch {
      // Something stayed busy past the wait; the number stays NaN and is reported as such.
    }
    return {
      frameMs: markStartMs(events, 'nqt:home-frame'),
      readyMs: markStartMs(events, 'nqt:home-ready'),
      settledMs,
      fcpMs: fcp && nav ? (fcp.ts - nav.ts) / 1000 : null,
      slowest,
    }
  } finally {
    await context.close()
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

export interface GestureResult {
  readonly stats: FrameStats
  readonly long: number[]
  readonly failures: string[]
}

/**
 * Drives one gesture on a chart, one input event per animation frame, the way a hand on a mouse does:
 * `zoom` sends wheel steps at the chart centre, in then partly out again; `pan` presses, drags right by
 * 2 px a frame and releases. Marks `nqt:<kind>-start` and `nqt:<kind>-end`.
 */
async function drive(chart: Locator, kind: 'zoom' | 'pan', frames: number): Promise<void> {
  await chart.evaluate(async (el, { kind, frames }) => {
    const box = el.getBoundingClientRect()
    const x0 = box.left + box.width * 0.5
    const y = box.top + box.height * 0.4
    const target = document.elementFromPoint(x0, y)
    if (!target) throw new Error('nothing under the chart centre')
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
    const mouse = (type: string, x: number, buttons: number) =>
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons }))
    await frame()
    performance.mark(`nqt:${kind}-start`)
    if (kind === 'pan') mouse('mousedown', x0, 1)
    for (let i = 1; i <= frames; i += 1) {
      if (kind === 'pan') mouse('mousemove', x0 + i * 2, 1)
      // In for the first two thirds, back out for the last third: it ends zoomed in, with room to pan.
      else target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, view: window, clientX: x0, clientY: y, deltaY: i <= (frames * 2) / 3 ? -20 : 20, deltaMode: 0 }))
      await frame()
    }
    if (kind === 'pan') mouse('mouseup', x0 + frames * 2, 0)
    performance.mark(`nqt:${kind}-end`)
  }, { kind, frames })
}

/** A fingerprint of what the chart's canvases show, to prove a gesture moved it. */
export async function canvasPrint(chart: Locator): Promise<string> {
  return chart.evaluate((el) => {
    let h = 0
    for (const c of Array.from(el.querySelectorAll('canvas'))) {
      const url = c.toDataURL()
      for (let i = 0; i < url.length; i += 7) h = (h * 31 + url.charCodeAt(i)) | 0
    }
    return String(h)
  })
}

/** Zoom then pan the chart under a CDP trace; frame statistics per gesture from the trace. */
export async function measurePanZoom(browser: Browser, page: Page, info: TestInfo, chart: Locator, label: string, frames = 120): Promise<Record<'zoom' | 'pan', GestureResult>> {
  await startTrace(browser, page)
  let events: ReturnType<typeof parseTrace>
  try {
    await drive(chart, 'zoom', frames)
    await paint(page)
    await drive(chart, 'pan', frames)
    await paint(page)
  } finally {
    events = await stopTrace(browser, info, label)
  }
  const result = (kind: 'zoom' | 'pan'): GestureResult => {
    const renderer = rendererOf(events, `nqt:${kind}-start`)
    const from = markTs(events, `nqt:${kind}-start`)
    const to = markTs(events, `nqt:${kind}-end`)
    const stats = frameStats(events, renderer, from, to)
    const long = longTasks(events, renderer, from, to)
    return { stats, long, failures: judgeFrames(stats, long) }
  }
  return { zoom: result('zoom'), pan: result('pan') }
}

export interface FillsTiming {
  readonly openMs: number
  readonly sortMs: number
  readonly pageMs: number
  readonly firstPageRows: number
  readonly secondPageRows: number
}

/**
 * On an open RUN panel: 3) Fills (the first page of up to 5,000 rows), a sort on Price, then the next
 * page. Each step runs from the click to the painted grid; the times come from the CDP trace.
 */
export async function measureFills(browser: Browser, page: Page, info: TestInfo, runPanel: Locator, run: string, label: string): Promise<FillsTiming> {
  await startTrace(browser, page)
  let events: ReturnType<typeof parseTrace>
  let rows: { first: number; second: number }
  try {
    rows = await runPanel.evaluate(async (root, run) => {
      const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
      const until = (ok: () => boolean) => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('timed out')) }, 30_000)
        const observer = new MutationObserver(() => {
          if (ok()) { clearTimeout(timer); observer.disconnect(); resolve() }
        })
        observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
        if (ok()) { clearTimeout(timer); observer.disconnect(); resolve() }
      })
      const painted = async (name: string) => { await frame(); await frame(); performance.mark(name) }
      const grid = () => root.querySelector<HTMLElement>(`[role="grid"][aria-label^="Fills of ${run},"]`)
      const bodyRows = () => grid()?.querySelectorAll('tbody tr[aria-rowindex]').length ?? 0
      const click = (el: Element | null | undefined, what: string) => {
        if (!(el instanceof HTMLElement)) throw new Error(`no ${what} to click`)
        el.click()
      }
      const pager = () => root.querySelector('.run-pager')?.textContent ?? ''
      performance.mark('nqt:fills-start')
      click(Array.from(root.querySelectorAll('[role="tab"]')).find((t) => /Fills/.test(t.textContent ?? '')), 'Fills tab')
      await until(() => bodyRows() > 0)
      await painted('nqt:fills-ready')
      const first = Number(grid()?.getAttribute('aria-rowcount') ?? '1') - 1
      const price = () => Array.from(grid()?.querySelectorAll('th') ?? []).find((th) => th.textContent?.startsWith('Price'))
      performance.mark('nqt:sort-start')
      click(price(), 'Price header')
      await until(() => price()?.getAttribute('aria-sort') !== null && price()?.getAttribute('aria-sort') !== undefined)
      await painted('nqt:sort-ready')
      performance.mark('nqt:page-start')
      click(Array.from(root.querySelectorAll('.run-pager button')).find((b) => b.textContent === 'Next page'), 'Next page button')
      await until(() => /^Rows 5001 to/.test(pager()) && bodyRows() > 0 && grid()?.getAttribute('aria-rowcount') !== String(first + 1))
      await painted('nqt:page-ready')
      return { first, second: Number(grid()?.getAttribute('aria-rowcount') ?? '1') - 1 }
    }, run)
  } finally {
    events = await stopTrace(browser, info, label)
  }
  return {
    openMs: markSpanMs(events, 'nqt:fills-start', 'nqt:fills-ready'),
    sortMs: markSpanMs(events, 'nqt:sort-start', 'nqt:sort-ready'),
    pageMs: markSpanMs(events, 'nqt:page-start', 'nqt:page-ready'),
    firstPageRows: rows.first,
    secondPageRows: rows.second,
  }
}

/** Prints one measurement line and keeps it on the test as an annotation. */
export function report(info: TestInfo, name: string, value: unknown): void {
  const text = JSON.stringify(value)
  info.annotations.push({ type: name, description: text })
  process.stdout.write(`perf ${name}: ${text}\n`)
}
