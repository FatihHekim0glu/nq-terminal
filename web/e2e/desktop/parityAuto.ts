// The automated weekly parity list (04 D6.2; docs/desktop/checks/2026-10-03_weekly-parity.md, state.md 11.1), shared by 80-parity-auto.desktop.ts
// (fixture mode) and parity.app.ts (the real lab, from the main tree by scripts/smoke_real.ps1 -Mode App). Neither starts start.ps1, whose
// launcher default is the owner's port 8765: the app's own backend is the one backend, the app's page is the first door, and the second
// door is a headless Chromium holding the app's own session cookie (read over the debugging protocol, as served-session.ts reads it).
// A row reads figures from the DOM in each door and compares them (compareFigures); rows of way "app" read the app only. Row 13 (JOBS) runs
// on a fixture backend with the fake runner (80-parity-auto.desktop.ts), because every smoke build starts its backend with NQT_JOBS=off.
// Rows 10 to 12 and the real F10 and F11 of row 14 stay with the owner. Nothing here orders, flattens or stops anything on a node: a row
// writes only the workspace store (SAVE, LOAD, FORGET, the look) and, on the fixture, the fake runner's queue.
// The pure part (rows, comparison, gate log, record, output) is in parityRecord.ts, re-exported here, and is tested in
// scripts/playwrightDesktopConfig.test.ts; this module is the browser part: the doors, the figures and the row runners.
import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { apiGet, clearStorage, commandLine, failedAnswers, open, openHome, panel, resetWorkspaceStore, settle, typeLine, watch, type Watch } from './app.ts'
import { BUDGETS } from '../perf/trace.ts'
import { offOriginOrNotGet } from '../perf/pages.ts'
import { GIP_P95_CEILING_MS, PARITY_ROWS, compareFigures, doorOrigin, squash, type ParityMode, type RowResult } from './parityRecord.ts'

export * from './parityRecord.ts'

// ---------------------------------------------------------------------------------------------------------- the browser door

export interface BrowserDoor {
  /** A fresh page of the second door, holding the app's own session; close it when the row is read. */
  readonly newPage: () => Promise<Page>
  readonly close: () => Promise<void>
}

const SESSION_COOKIE_PREFIX = 'nqt_s_'
const DOOR_VIEWPORT = { width: 1920, height: 1080 } as const

/** The app's session cookie, read over the debugging protocol (the cookie is scoped to /api, so a lookup by origin would miss it). */
async function appSessionCookie(app: Page, origin: string) {
  const session = await app.context().newCDPSession(app)
  try {
    const { cookies } = await session.send('Network.getAllCookies')
    const name = `${SESSION_COOKIE_PREFIX}${new URL(origin).port}`
    const found = cookies.find((c) => c.name === name)
    if (found === undefined) throw new Error(`the app page holds no ${name} cookie (${cookies.map((c) => c.name).join(', ') || 'none'})`)
    return found
  } finally {
    await session.detach().catch(() => undefined)
  }
}

type DoorCookie = { name: string; value: string; domain: string; path: string }

async function doorContext(browser: Browser, origin: string, cookie: DoorCookie): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: origin, viewport: DOOR_VIEWPORT, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London',
  })
  await context.addCookies([{ name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, httpOnly: true, secure: false, sameSite: 'Lax' }])
  return context
}

async function openDoor(origin: string, cookie: DoorCookie): Promise<BrowserDoor> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await doorContext(browser, origin, cookie)
    return { newPage: () => context.newPage(), close: () => browser.close() }
  } catch (error) {
    await browser.close().catch(() => undefined)
    throw error
  }
}

/** Opens the headless second door on the app's own backend with the app's own session. */
export async function openBrowserDoor(app: Page, origin: string): Promise<BrowserDoor> {
  const base = doorOrigin(origin)
  return openDoor(base, await appSessionCookie(app, base))
}

/** A headless door on another loopback backend of this run (the jobs fixture), with the NAME=VALUE session cookie it issued. */
export async function openDoorOn(origin: string, cookiePair: string): Promise<BrowserDoor> {
  const [name = '', ...value] = cookiePair.split('=')
  return openDoor(doorOrigin(origin), { name, value: value.join('='), domain: '127.0.0.1', path: '/api' })
}

// ---------------------------------------------------------------------------------------------------------- reading figures

export type Figures = Readonly<Record<string, string>>

/** Runs in the page: the figures a panel shows (key figures, chart summaries, the first rows of grids and tables), keyed by name. */
function figuresInPage(root: Element, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
  root.querySelectorAll('.kpi').forEach((k) => { out[`${prefix} kpi ${clean(k.querySelector('.kpi-label')?.textContent)}`] = clean(k.querySelector('.kpi-line')?.textContent) })
  root.querySelectorAll('[role="img"][aria-label]').forEach((e, i) => { out[`${prefix} chart ${i + 1}`] = clean(e.getAttribute('aria-label')) })
  root.querySelectorAll('[role="grid"]').forEach((g, i) => {
    const name = clean(g.getAttribute('aria-label')) || `grid ${i + 1}`
    out[`${prefix} ${name} rows`] = g.getAttribute('aria-rowcount') ?? ''
    Array.from(g.querySelectorAll('[role="row"]')).filter((r) => r.querySelector('[role="gridcell"]') !== null).slice(0, 3)
      .forEach((r, j) => { out[`${prefix} ${name} row ${j + 1}`] = Array.from(r.querySelectorAll('[role="gridcell"]')).map((c) => clean(c.textContent)).join(' | ') })
  })
  root.querySelectorAll('table.chart-a11y-table').forEach((t, i) => {
    out[`${prefix} table ${i + 1} ${clean(t.querySelector('caption')?.textContent)}`] = Array.from(t.querySelectorAll('tbody tr')).slice(0, 3).map((r) => clean(r.textContent)).join(' | ')
  })
  return out
}

/** The figures of the panel titled `title`. */
export async function figuresOf(page: Page, title: string): Promise<Figures> {
  return panel(page, title).first().evaluate(figuresInPage, title)
}

/** Every panel's problems: an alert on screen, a placeholder screen, a demo flag. */
export async function screenProblems(page: Page, title: string): Promise<string[]> {
  const target = panel(page, title).first()
  const problems: string[] = []
  const alerts = await target.locator('[role="alert"]').allTextContents()
  if (alerts.length > 0) problems.push(`${title}: alert ${alerts.map(squash).join(' | ')}`)
  if (await target.locator('[data-placeholder]').count() > 0) problems.push(`${title}: placeholder screen`)
  if (/DEMO DATA/i.test((await target.textContent()) ?? '')) problems.push(`${title}: a DEMO DATA flag`)
  return problems
}

/** A 412 from the workspace store: both doors write one store, and a write that carries an old version is refused (the page reads again). */
const isStoreConflict = (text: string): boolean => /(^|status of )412\b.*\/api\/workspaces\//.test(text)

/** The clean-flow problems of one door: console errors, failed answers, requests that were not same-origin GETs; store conflicts are counted apart. */
function flowProblems(w: Watch, origin: string): { problems: string[]; conflicts: string[] } {
  const failed = failedAnswers(w)
  const problems = [
    ...w.errors.filter((e) => !isStoreConflict(e)).map((e) => `console error: ${e}`),
    ...failed.filter((a) => !isStoreConflict(a)).map((a) => `failed answer: ${a}`),
    ...offOriginOrNotGet(w, origin).map((r) => `request that was not a same-origin GET: ${r}`),
  ]
  return { problems, conflicts: failed.filter(isStoreConflict) }
}

const conflictNote = (conflicts: readonly string[]): string => {
  const counts = new Map<string, number>()
  for (const c of conflicts.map((a) => a.replace('412 /api/workspaces/', ''))) counts.set(c, (counts.get(c) ?? 0) + 1)
  return conflicts.length === 0 ? '' : `workspace store conflicts (412), not counted as failures: ${[...counts].map(([doc, n]) => `${doc} x${n}`).join(', ')}`
}

export interface ParityContext {
  readonly mode: ParityMode
  readonly origin: string
  readonly app: Page
  readonly door: BrowserDoor
  readonly runDir: string
  readonly lab: string
}

/** A click or a wait that finds nothing fails after this long, so a row ends red instead of waiting for the test's own limit. */
const STEP_TIMEOUT_MS = 60_000

export type DoorName = 'app' | 'browser'
export type DoorReader = (page: Page, door: DoorName) => Promise<Figures>

export const result = (row: number, differences: readonly string[], note = ''): RowResult => ({ row, status: differences.length === 0 ? 'green' : 'red', note, differences })

/** The row's reader in one door, with that door's clean-flow check; a reader that throws is a red row, not a dead run. */
async function readInDoor(page: Page, origin: string, door: DoorName, reader: DoorReader): Promise<{ figures: Figures; problems: string[]; conflicts: string[] }> {
  const w = watch(page)
  page.setDefaultTimeout(STEP_TIMEOUT_MS)
  try {
    const figures = await reader(page, door)
    await quiesce(page)
    const flow = flowProblems(w, origin)
    return { figures, problems: flow.problems.map((p) => `${door}: ${p}`), conflicts: flow.conflicts }
  } catch (error) {
    return { figures: {}, problems: [`${door}: ${firstLine(error)}`], conflicts: [] }
  } finally {
    page.setDefaultTimeout(0)
  }
}

/**
 * Waits until the page has sent what it still holds to the workspace store, through the hook the shell itself calls before it stops
 * the backend. The doors share one store: a change one door sends late carries an old version, and the other door gets a 412.
 */
export async function quiesce(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sync = (window as unknown as Record<string, unknown>).__NQT_STORE_SYNC__
    for (let attempt = 0; typeof sync === 'function' && attempt < 50; attempt += 1) {
      if ((JSON.parse((sync as () => string)()) as { pending: number }).pending === 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }).catch(() => undefined)
}

/** One row read in both doors, one after the other (the doors share one workspace store), and compared. */
export async function compareDoors(ctx: ParityContext, row: number, reader: DoorReader, note = ''): Promise<RowResult> {
  const app = await readInDoor(ctx.app, ctx.origin, 'app', reader)
  const page = await ctx.door.newPage()
  try {
    const browser = await readInDoor(page, ctx.origin, 'browser', reader)
    const same = app.problems.length + browser.problems.length === 0 ? compareFigures(app.figures, browser.figures) : []
    return result(row, [...app.problems, ...browser.problems, ...same], [note, conflictNote([...app.conflicts, ...browser.conflicts])].filter((t) => t !== '').join('; '))
  } finally {
    await page.close().catch(() => undefined)
  }
}

/** One row read in the app only. */
export async function readApp(ctx: ParityContext, row: number, reader: DoorReader, note = ''): Promise<RowResult> {
  const app = await readInDoor(ctx.app, ctx.origin, 'app', reader)
  return result(row, app.problems, [note, conflictNote(app.conflicts)].filter((t) => t !== '').join('; '))
}

/** A page's first load: HOME as a returning viewer sees it, in whichever door. */
export async function homeIn(page: Page): Promise<void> {
  await openHome(page, { dismissed: true })
}

/** Opens each line in turn and returns the figures and problems of the panel it opens. */
async function openAndRead(page: Page, lines: readonly string[]): Promise<Figures> {
  let figures: Figures = {}
  const problems: string[] = []
  for (const line of lines) {
    await open(page, line)
    figures = { ...figures, ...(await figuresOf(page, line)) }
    problems.push(...(await screenProblems(page, line)))
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return figures
}

// ---------------------------------------------------------------------------------------------------------- the rows

export type RowRunner = (ctx: ParityContext) => Promise<RowResult>

const HOME_PANELS = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG'] as const
const GIP_DATE: Readonly<Record<ParityMode, string>> = { fixture: '2011-01-20', real: '2019-03-14' }

export const row1: RowRunner = (ctx) => compareDoors(ctx, 1, async (page) => {
  await homeIn(page)
  const problems: string[] = []
  let figures: Figures = {}
  for (const title of HOME_PANELS) {
    figures = { ...figures, ...(await figuresOf(page, title)) }
    problems.push(...(await screenProblems(page, title)))
  }
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  if (problems.length > 0) throw new Error(problems.join('; '))
  return figures
})

export const row3: RowRunner = (ctx) => compareDoors(ctx, 3, async (page) => {
  await homeIn(page)
  await open(page, 'REG')
  const reg = await figuresOf(page, 'REG')
  await settle(page)
  const mt = await figuresOf(page, 'MT')
  return { ...reg, ...mt }
})

const linesRow = (row: number, lines: readonly string[]): RowRunner => (ctx) => compareDoors(ctx, row, async (page) => {
  await homeIn(page)
  return openAndRead(page, lines)
})

export const row5 = linesRow(5, ['volmanaged_v0 EQ', 'volmanaged_v0 DD', 'volmanaged_v0 RET', 'volmanaged_v0 RR', 'volmanaged_v0 MRET'])
export const row6 = linesRow(6, ['27F MON', '27F CORR'])

/** LEDG and OOS, each as its grid and then in the pivot view (the accessible table of the same rows): the ledger pivot holds every ledger row, and the gate log has reads of the caller terminal. */
export const row7: RowRunner = (ctx) => compareDoors(ctx, 7, async (page) => {
  await homeIn(page)
  let figures: Figures = {}
  const problems: string[] = []
  for (const line of ['LEDG', 'OOS']) {
    const target = await open(page, line)
    figures = { ...figures, ...(await figuresOf(page, line)) }
    problems.push(...(await screenProblems(page, line)))
    await target.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
    const pivot = target.getByRole('grid', { name: /, table$/ })
    await expect(pivot, `${line}: the pivot view`).toBeVisible()
    figures = { ...figures, ...(await figuresOf(page, line)) }
    if (line === 'OOS') {
      const log = JSON.parse((await apiGet(page, '/api/audit/oos-log?caller=terminal&limit=1')).text) as { matched: number }
      if (!(log.matched > 0)) problems.push('the gate log holds no read with caller terminal')
    }
    if (line === 'LEDG') {
      const held = (JSON.parse((await apiGet(page, '/api/ledger')).text) as { rows: unknown[] }).rows.length
      if (rowsOf(await pivot.getAttribute('aria-label')) !== held) problems.push(`the LEDG pivot says ${await pivot.getAttribute('aria-label')}, the ledger holds ${held} rows`)
    }
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return figures
})

export const row8: RowRunner = (ctx) => compareDoors(ctx, 8, async (page) => {
  await homeIn(page)
  const figures: Record<string, string> = {}
  for (const line of ['LIVE', 'JRNL']) {
    const target = await open(page, line)
    const state = target.getByRole('group', { name: 'Live stream state' }).getByRole('status').first()
    await expect(state, `${line}: the stream line`).toHaveText('live, server events', { timeout: 30_000 })
    figures[`${line} stream line`] = squash((await state.textContent()) ?? '')
  }
  return figures
})

export const row9: RowRunner = (ctx) => compareDoors(ctx, 9, async (page) => {
  await homeIn(page)
  const target = await open(page, 'HELP')
  const item = target.locator('.toc-item').first()
  const code = squash((await item.textContent()) ?? '')
  await item.click()
  const topic = target.locator('section.help-topic')
  await expect(topic, 'the topic opens').toBeVisible()
  const text = squash((await topic.textContent()) ?? '')
  return { 'topic item': code, 'topic label': (await topic.getAttribute('aria-label')) ?? '', 'topic heading': squash((await topic.getByRole('heading').first().textContent()) ?? ''), 'topic text': text.slice(0, 300) }
})

// ---- row 2: GP, its table view, and GIP pan and zoom

const TABLE_TOGGLE = 'Table'

/** Runs in the page: how many rows a table view holds, and a checksum of all its text (a thousand bars are one figure, not a thousand lines). */
function tableStats(table: Element): { rows: string; first: string; last: string; checksum: string } {
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim())
  let h = 0
  for (const text of rows) for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0
  return { rows: String(rows.length), first: rows[0] ?? '', last: rows.at(-1) ?? '', checksum: String(h) }
}

/** GP's chart summary and its table view (the T key's view, here by its Table button): the same numbers as the chart. */
async function gpTableFigures(page: Page): Promise<Figures> {
  await homeIn(page)
  const target = await open(page, 'NQ GP 1d')
  const summary = squash((await target.getByRole('img').first().getAttribute('aria-label')) ?? '')
  await target.getByRole('button', { name: TABLE_TOGGLE, exact: true }).click()
  const stats = await target.locator('table.chart-a11y-table').first().evaluate(tableStats)
  await target.getByRole('button', { name: TABLE_TOGGLE, exact: true }).click()
  return { 'GP chart summary': summary, 'GP table rows': stats.rows, 'GP table first row': stats.first, 'GP table last row': stats.last, 'GP table checksum': stats.checksum }
}

const p95 = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(0.95 * (values.length - 1))] ?? 0

const FRAME_SAMPLER = `(() => { const w = window; w.__nqtFrames = []; w.__nqtRun = true; let last = performance.now();
  const tick = (t) => { w.__nqtFrames.push(t - last); last = t; if (w.__nqtRun) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })()`

/** A hash of every canvas in the panel: whether a gesture moved what is drawn. */
const canvasPrint = (target: Locator): Promise<string> => target.evaluate((root) => {
  let h = 0
  for (const cv of Array.from(root.querySelectorAll('canvas'))) { const u = cv.toDataURL(); for (let i = 0; i < u.length; i += 7) h = (h * 31 + u.charCodeAt(i)) | 0 }
  return String(h)
})

async function gesture(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16) }
  await page.mouse.down()
  for (let i = 0; i < 60; i += 1) { await page.mouse.move(cx + i * 2, cy); await page.waitForTimeout(16) }
  await page.mouse.up()
}

/** GIP: wheel zoom then a drag pan on the intraday chart, the frame intervals sampled in the page (the harness measures the same row with a CDP trace). */
async function gipFrames(page: Page, date: string): Promise<{ p95Ms: number; frames: number; moved: boolean }> {
  const target = await open(page, `NQ GIP ${date}`)
  const chart = target.getByRole('img', { name: /^NQ1 Index: \d+ 1-minute bars/ })
  await expect(chart).toBeVisible()
  const box = await chart.boundingBox()
  if (box === null) throw new Error('the GIP chart has no box')
  const before = await canvasPrint(target)
  await page.evaluate(FRAME_SAMPLER)
  await gesture(page, box)
  const intervals = await page.evaluate(() => { const w = window as unknown as { __nqtRun: boolean; __nqtFrames: number[] }; w.__nqtRun = false; return w.__nqtFrames })
  return { p95Ms: p95(intervals), frames: intervals.length, moved: (await canvasPrint(target)) !== before }
}

export const row2: RowRunner = async (ctx) => {
  const tables = await compareDoors(ctx, 2, async (page) => gpTableFigures(page))
  const app = await readApp(ctx, 2, async (page) => {
    await homeIn(page)
    const g = await gipFrames(page, GIP_DATE[ctx.mode])
    const problems = [
      ...(g.moved ? [] : ['the gestures did not move the GIP chart']),
      ...(g.frames >= BUDGETS.panZoom.minFrames ? [] : [`only ${g.frames} frames in the gesture`]),
      ...(g.p95Ms <= GIP_P95_CEILING_MS ? [] : [`GIP frame interval p95 ${g.p95Ms.toFixed(1)} ms is over ${GIP_P95_CEILING_MS} ms`]),
    ]
    if (problems.length > 0) throw new Error(problems.join('; '))
    return { 'GIP frame interval p95 (ms)': g.p95Ms.toFixed(1) }
  })
  const note = `GIP frame p95 judged against the harness ceiling of ${GIP_P95_CEILING_MS} ms; the harness row gip_pan_zoom_p95 stays the measurement`
  return result(2, [...tables.differences, ...app.differences], [note, tables.note, app.note].filter((t) => t !== '').join('; '))
}

// ---- row 14: F1 and F8 to F11 by keys sent over the debugging protocol, as 40-keys does

const SECTOR_KEYS = [['F8', ' Equity'], ['F9', ' Comdty'], ['F10', ' Index'], ['F11', ' Curncy']] as const
const NO_EQUITIES = 'No equities in nq-lab: Equity is accepted but matches nothing.'

interface KeySeen { readonly key: string; readonly prevented: boolean }

async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: KeySeen[] = []
    Object.defineProperty(window, '__nqtKeys', { value: seen, configurable: true })
    window.addEventListener('keydown', (e) => seen.push({ key: e.key, prevented: e.defaultPrevented }))
  })
}

const lastKey = (page: Page): Promise<KeySeen | undefined> => page.evaluate(() => (window as unknown as { __nqtKeys: KeySeen[] }).__nqtKeys.at(-1))
const targets = (page: Page): string[] => page.context().pages().map((p) => p.url()).sort()

/** The engine does nothing of its own with a key: the same pages, no full screen. */
async function engineQuiet(page: Page, before: string[]): Promise<void> {
  expect(targets(page), 'the engine opened or navigated a page').toEqual(before)
  expect(await page.evaluate(() => document.fullscreenElement), 'full screen').toBeNull()
}

async function sectorKey(page: Page, key: string, suffix: string): Promise<void> {
  await homeIn(page)
  await recordKeys(page)
  const before = targets(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('nq1')
  await page.keyboard.press(key)
  expect(await lastKey(page), `${key} as the page saw it`).toEqual({ key, prevented: true })
  await expect(commandLine(page)).toHaveValue(`NQ1${suffix}`)
  await expect(commandLine(page)).toBeFocused()
  if (key === 'F8') await expect(page.locator('.msg-line[role="status"]')).toHaveText(NO_EQUITIES)
  await engineQuiet(page, before)
}

async function helpKey(page: Page): Promise<void> {
  await homeIn(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-nqt-panel]').first().locator(':focus')).toHaveCount(1)
  await recordKeys(page)
  const before = targets(page)
  await page.keyboard.press('F1')
  expect(await lastKey(page), 'F1 as the page saw it').toEqual({ key: 'F1', prevented: true })
  await expect(page.getByRole('listbox', { name: /^GP/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('F1')
  await page.keyboard.press('F1')
  await expect(page.locator('[data-nqt-title="HELP"]')).toHaveCount(1)
  await engineQuiet(page, before)
}

export const row14: RowRunner = (ctx) => readApp(ctx, 14, async (page) => {
  const dialogs: string[] = []
  const onDialog = (d: { message(): string; dismiss(): Promise<void> }): void => { dialogs.push(d.message()); void d.dismiss() }
  page.on('dialog', onDialog)
  try {
    for (const [key, suffix] of SECTOR_KEYS) await sectorKey(page, key, suffix)
    await helpKey(page)
    expect(dialogs, 'a dialog').toEqual([])
  } finally {
    page.off('dialog', onDialog)
  }
  return { keys: 'F1, F8, F9, F10, F11 reached the page and were prevented' }
}, 'real F10 and F11 stay with the owner (keys sent over the debugging protocol skip the host accelerator path)')

// ---- row 15: SAVE and LOAD of a workspace, from one door to the other

const WORKSPACE_NAME = 'parityauto'
const SHOWN = WORKSPACE_NAME.toUpperCase()
const status = (page: Page): Locator => page.locator('.msg-line[role="status"]')
const titlesOn = (page: Page): Promise<string[]> => page.locator('[data-nqt-title]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nqt-title') ?? '').sort())
/** The first lines of an error, without the colour codes Playwright puts in its messages: what failed and what was expected and received. */
export const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '').slice(0, 5).join(' ')

async function line(page: Page, text: string, answer: string): Promise<void> {
  await typeLine(page, text)
  await expect(status(page)).toHaveText(answer)
}

async function saveThenChange(page: Page): Promise<string[]> {
  await homeIn(page)
  const home = await titlesOn(page)
  expect(home, 'HOME opens its four panels').toHaveLength(4)
  await line(page, `SAVE ${WORKSPACE_NAME}`, `Saved ${SHOWN} (4 panels).`)
  await open(page, 'LEDG')
  await open(page, 'OOS')
  expect(await titlesOn(page), 'the layout changed').not.toEqual(home)
  return home
}

export const row15: RowRunner = async (ctx) => {
  const problems: string[] = []
  const page = await ctx.door.newPage()
  const watches = [watch(ctx.app), watch(page)]
  const attempt = async (what: string, step: () => Promise<void>): Promise<void> => step().catch((e: unknown) => { problems.push(`${what}: ${firstLine(e)}`) })
  const loaded = (p: Page): Promise<void> => expect(p.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 60_000 })
  try {
    let home: string[] = []
    await attempt('app SAVE', async () => { home = await saveThenChange(ctx.app) })
    await attempt('app LOAD', () => line(ctx.app, `LOAD ${WORKSPACE_NAME}`, `Loaded ${SHOWN}.`))
    if ((await titlesOn(ctx.app)).join() !== home.join()) problems.push('app: LOAD did not bring the saved layout back')
    await quiesce(ctx.app)
    await page.goto('/')
    await attempt('browser page', () => loaded(page))
    await attempt('browser LOAD', () => line(page, `LOAD ${WORKSPACE_NAME}`, `Loaded ${SHOWN}.`))
    if ((await titlesOn(page)).join() !== home.join()) problems.push('browser: the same workspace did not load in the browser')
    await attempt('browser FORGET', () => line(page, `FORGET ${WORKSPACE_NAME}`, `Forgot ${SHOWN}.`))
    await quiesce(page)
    await ctx.app.reload()
    await attempt('app after FORGET', async () => { await loaded(ctx.app); await line(ctx.app, `LOAD ${WORKSPACE_NAME}`, `No workspace named ${SHOWN}. LOAD lists the saved ones.`) })
  } finally {
    await page.close().catch(() => undefined)
    await resetWorkspaceStore(ctx.app).catch(() => undefined)
  }
  const flows = watches.map((w) => flowProblems(w, ctx.origin))
  return result(15, [...problems, ...flows.flatMap((f) => f.problems)], conflictNote(flows.flatMap((f) => f.conflicts)))
}

// ---- row 16: the amber classic look, in the app and then in the browser

const AMBER = 'amber-classic'

/** Runs in the page: the colours the look gives the page, as computed styles. */
function lookColours(): Record<string, string> {
  const css = (selector: string, prop: string): string => { const el = document.querySelector(selector); return el === null ? 'none' : getComputedStyle(el).getPropertyValue(prop) }
  return { theme: document.documentElement.getAttribute('data-theme') ?? 'standard', 'page background': css('body', 'background-color'), 'page text': css('body', 'color'), 'key figure': css('.kpi-value', 'color'), 'status bar': css('[role="contentinfo"]', 'background-color') }
}

const prefixed = (prefix: string, figures: Record<string, string>): Figures => Object.fromEntries(Object.entries(figures).map(([k, v]) => [`${prefix} ${k}`, v]))

async function amberFigures(page: Page, door: DoorName): Promise<Figures> {
  if (door === 'app') {
    await homeIn(page)
    await page.locator('.frame-btn[aria-label="Options"]').click()
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Amber classic theme' }).click()
    await page.keyboard.press('Escape')
  } else {
    await page.goto('/')
  }
  await page.reload()
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  await expect(page.locator('html')).toHaveAttribute('data-theme', AMBER)
  await settle(page)
  const home = await page.evaluate(lookColours)
  await open(page, 'REG')
  return { ...prefixed('HOME', home), ...prefixed('REG', await page.evaluate(lookColours)) }
}

export const row16: RowRunner = async (ctx) => {
  try {
    return await compareDoors(ctx, 16, amberFigures)
  } finally {
    await clearStorage(ctx.app).catch(() => undefined)
    await ctx.app.reload().catch(() => undefined)
  }
}

// ---- row 4: RUN with the fills pivot

interface RunLine { readonly run_id: string; readonly kind: string; readonly fees_total: number | null; readonly readable: boolean; readonly usable: boolean; readonly is_probe: boolean }
const FILLS_PAGE = 5000
const FILLS_OPEN_MS = 1000
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.01 + 1e-9 * Math.abs(b)
const rowsOf = (label: string | null): number => Number(/(\d[\d,]*) rows/.exec(label ?? '')?.[1]?.replace(/,/g, '') ?? NaN)

/** Every fill of a run from the API: how many, and their commissions added up. */
async function fillsFromApi(page: Page, run: string): Promise<{ total: number; commission: number }> {
  let total = 0
  let commission = 0
  for (let offset = 0; offset === 0 || offset < total; offset += FILLS_PAGE) {
    const answer = await apiGet(page, `/api/runs/${run}/fills?offset=${offset}&limit=${FILLS_PAGE}`)
    if (answer.status !== 200) throw new Error(`fills of ${run}: HTTP ${answer.status}`)
    const body = JSON.parse(answer.text) as { total: number; items: ReadonlyArray<{ commission_float: number }> }
    total = body.total
    commission += body.items.reduce((a, f) => a + f.commission_float, 0)
  }
  return { total, commission }
}

/** The first usable run that has fills (the fixture's own run first, then the books), with its own fees total. */
async function runWithFills(page: Page): Promise<{ run: string; fees: number; total: number; commission: number }> {
  const runs = (JSON.parse((await apiGet(page, '/api/runs')).text) as RunLine[]).filter((r) => r.readable && r.usable && !r.is_probe)
  const rank = (r: RunLine): number => (r.run_id === 'nt_dtsmom_v0_fixture_ts1' ? 0 : r.kind === 'book' ? 1 : 2)
  for (const r of [...runs].sort((a, b) => rank(a) - rank(b))) {
    const fills = await fillsFromApi(page, r.run_id).catch(() => null)
    if (fills !== null && fills.total > 0 && r.fees_total !== null) return { run: r.run_id, fees: r.fees_total, ...fills }
  }
  throw new Error('no run with fills and a fees total')
}

/** Runs in the page: how many rows a grid renders and its Commission column added up (a grid renders every row only when it is short). */
function columnSum(grid: Element, header: string): { rendered: number; sum: number } {
  const heads = Array.from(grid.querySelectorAll('thead th')).map((h) => (h.textContent ?? '').trim())
  const at = heads.findIndex((h) => h.startsWith(header))
  const rows = Array.from(grid.querySelectorAll('tbody tr[aria-rowindex]')).filter((r) => r.querySelector('td[role="gridcell"]') !== null)
  const cells = rows.map((r) => Array.from(r.querySelectorAll('td'))[at]?.textContent ?? '')
  return { rendered: rows.length, sum: cells.reduce((a, t) => a + Number(t.replace(/[^0-9.-]/g, '')), 0) }
}

export const row4: RowRunner = (ctx) => readApp(ctx, 4, async (page) => {
  await homeIn(page)
  const known = await runWithFills(page)
  const run = await open(page, `${known.run} RUN`)
  const problems: string[] = []
  if (!near(known.commission, known.fees)) problems.push(`the fills' commissions add up to ${known.commission}, the run's own fees total is ${known.fees}`)
  const opened = Date.now()
  await run.getByRole('tab', { name: /Fills/ }).click()
  const shows = async (grid: Locator, what: string): Promise<void> => {
    await expect(grid, what).toBeVisible()
    const label = await grid.getAttribute('aria-label')
    if (rowsOf(label) !== known.total) problems.push(`the ${what} says ${label}, the API holds ${known.total} fills`)
  }
  await shows(run.getByRole('grid', { name: new RegExp(`^Fills of ${known.run}, \\d`) }), 'fills grid')
  const openMs = Date.now() - opened
  if (openMs > FILLS_OPEN_MS) problems.push(`the fills grid opened in ${openMs} ms, over ${FILLS_OPEN_MS} ms`)
  await run.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
  const pivot = run.getByRole('grid', { name: new RegExp(`^Fills of ${known.run}, .*table$`) })
  await shows(pivot, 'pivot view')
  const column = await pivot.evaluate(columnSum, 'Commission')
  if (column.rendered === known.total && !near(column.sum, known.fees)) problems.push(`the pivot's Commission column adds up to ${column.sum}, the run's own fees total is ${known.fees}`)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return { fills: String(known.total), commission: String(known.commission), 'pivot column rendered': String(column.rendered) }
}, 'the pivot view shows as its accessible table under reduced motion; the fills and their commissions are checked against the run\'s own totals')

// ---- the rows by number

const RUNNERS: Readonly<Record<number, RowRunner>> = { 1: row1, 2: row2, 3: row3, 4: row4, 5: row5, 6: row6, 7: row7, 8: row8, 9: row9, 14: row14, 15: row15, 16: row16 }

/** One row of the list: the owner's rows are marked, row 13 is skipped on real files, the rest run (`extra` holds a spec's own rows: the fixture spec's row 13). */
export async function runRow(ctx: ParityContext, row: number, extra: Readonly<Record<number, RowRunner>> = {}): Promise<RowResult> {
  const def = PARITY_ROWS.find((r) => r.row === row)
  if (def === undefined) throw new Error(`no row ${row}`)
  if (def.way === 'owner') return { row, status: 'owner', note: `stays with the owner: ${def.owner ?? ''}`, differences: [] }
  if (row === 13 && ctx.mode === 'real') return { row, status: 'skipped', note: 'fixture backend only: the real row writes a run folder under backtests/output', differences: [] }
  const runner = extra[row] ?? RUNNERS[row]
  if (runner === undefined) throw new Error(`no runner for row ${row}`)
  return runner(ctx).catch((error: unknown) => result(row, [`threw: ${firstLine(error)}`]))
}
