// Phase 8 E2E (TASKS Phase 8; look spec section 7 full templates): the screens that the new API fields
// complete, in the workspace against the fixture-mode backend (playwright.config.ts). Each test checks
// what the screen shows against the API's own answer, then axe WCAG 2.2 AA, no console errors and
// same-origin GET requests only. The numbered actions that save files (98) Export, 98) Report) are
// checked through the browser's download event: the file is made in the page, and no request is sent.
import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import { expectGalleryClean, watchGallery } from './gallery.ts'

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const
const BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

async function apiJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBe(true)
  return (await response.json()) as T
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

async function open(page: Page, line: string, size: (typeof SIZES)[number] = SIZES[0]): Promise<void> {
  await page.setViewportSize(size)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await page.keyboard.press('Control+k')
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
  await settle(page)
}

// The status line polls GET /api/health every 2 s whatever the screen does; a save is checked for any
// other request it might send.
const HEALTH_POLL = '/api/health'

/** Requests after the first `from`, less the health poll, as paths with their query. */
function sentSince(requests: ReadonlyArray<{ url(): string }>, from: number): string[] {
  return requests
    .slice(from)
    .map((r) => new URL(r.url()))
    .filter((u) => u.pathname !== HEALTH_POLL)
    .map((u) => `${u.pathname}${u.search}`)
}

/** Clicks a red-bar button and returns the file the page saved, with its text. */
async function saved(page: Page, button: Locator): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const file = await (download as Download).path()
  return { name: (download as Download).suggestedFilename(), text: fs.readFileSync(file, 'utf8') }
}

interface LiveRoutes {
  readonly routes: ReadonlyArray<{ readonly plumbing: boolean }>
  readonly fills: ReadonlyArray<unknown>
  readonly summary: { readonly routes: number; readonly plumbing_routes: number; readonly plumbing_fills: number }
}

interface OosLog {
  readonly severity_levels: ReadonlyArray<{ readonly level: number; readonly meaning: string }>
  readonly severity_counts: Readonly<Record<string, number>>
}

test.describe('Phase 8: full templates in the workspace', () => {
  for (const size of SIZES) {
    test(`LIVE shows Routes and Fills from /api/live/routes with the footer totals (${size.width}x${size.height})`, async ({ page }) => {
      const watch = await watchGallery(page)
      const body = await apiJson<LiveRoutes>(page, '/api/live/routes')
      await open(page, 'LIVE', size)
      const live = panel(page, 'LIVE')
      const routes = live.getByRole('table', { name: /^Routes: one per journal close row/ })
      await expect(routes.locator('tbody tr')).toHaveCount(body.routes.length)
      await expect(routes.locator('tr.plumbing-row')).toHaveCount(body.routes.filter((r) => r.plumbing).length)
      await expect(routes.locator('tr.plumbing-row').first()).toContainText(BANNER)
      await expect(live.getByRole('table', { name: /^Fills the book counted/ }).locator('tbody tr')).toHaveCount(body.fills.length)
      const foot = live.getByRole('list', { name: 'Routes and fills totals, performance rows only' })
      await expect(foot).toContainText(`Routes ${body.summary.routes}`)
      await expect(foot).toContainText(`${body.summary.plumbing_routes} routes, ${body.summary.plumbing_fills} fills (not counted)`)
      await expectGalleryClean(page, watch)
    })
  }

  test('LIVE in the 1366x768 split shows the whole chart at rest', async ({ page }) => {
    await open(page, 'LIVE', SIZES[1])
    const live = panel(page, 'LIVE')
    const chart = live.getByRole('img', { name: /Target \(ct\)/ })
    await expect(chart).toBeVisible()
    const body = await live.locator('.live-screen').boundingBox()
    const box = await chart.boundingBox()
    expect(body && box).toBeTruthy()
    expect(box!.y + box!.height).toBeLessThanOrEqual(body!.y + body!.height + 1)
  })

  test('OOS draws the R severity column from the API, with the levels and counts', async ({ page }) => {
    const watch = await watchGallery(page)
    const log = await apiJson<OosLog>(page, '/api/audit/oos-log?limit=5000')
    await open(page, 'OOS')
    const oos = panel(page, 'OOS')
    const grid = oos.getByRole('grid', { name: 'Gate access log entries, newest first' })
    await expect(grid.getByRole('columnheader', { name: 'R', exact: true })).toBeVisible()
    const legend = oos.getByRole('list', { name: /Severity levels \(house semantics\)/ })
    for (const level of log.severity_levels) {
      await expect(legend).toContainText(`${level.level} ${level.meaning}: ${log.severity_counts[String(level.level)] ?? 0}`)
    }
    await expect(grid.locator('.oos-sev-4').first()).toBeVisible()
    await expectGalleryClean(page, watch)
  })

  test('EQ on a run with a benchmark draws the performance-difference pane, and 98) Export saves the tab', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, 'smoke_2015_01 EQ')
    const eq = panel(page, 'smoke_2015_01 EQ')
    await expect(eq.getByText(/Lower pane: performance difference/)).toBeVisible()
    await expect(eq.getByRole('img', { name: /^smoke_2015_01: 20 points/ })).toBeVisible()
    // axe first: a click makes the red-bar button the panel's Tab stop.
    await expectGalleryClean(page, watch)
    const before = watch.requests.length
    const file = await saved(page, eq.getByRole('button', { name: /98\) Export/ }))
    expect(file.name).toBe('smoke_2015_01_EQ.csv')
    expect(file.text.split('\r\n')[0]).toBe('date,equity,bench,perf_diff')
    expect(sentSince(watch.requests, before)).toEqual([])
    expect(watch.errors).toEqual([])
  })

  test('RET passes the per-period series; RR lists the volatility extremes in words', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, 'volmanaged_v0 RET')
    await expect(page.getByText(/Left: each period's return/)).toBeVisible()
    await open(page, 'volmanaged_v0 RR')
    await expect(page.getByRole('list', { name: 'Rolling volatility extremes' })).toBeVisible()
    await expectGalleryClean(page, watch)
  })

  test('DES for an instrument: four tabs, the month-code strip, and 98) Report as Markdown', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, 'NQ DES')
    const des = panel(page, 'NQ DES')
    await expect(des.getByRole('tab')).toHaveText(['1) Profile', '2) Coverage', '3) Notes', '4) Contracts (CT)'])
    await expect(des.getByRole('region', { name: 'Contract specifications' })).toContainText('0.25')
    await des.getByRole('tab', { name: '4) Contracts (CT)' }).click()
    const strip = des.getByRole('list', { name: 'Contract months and codes' })
    await expect(strip.getByRole('listitem')).toHaveCount(12)
    await expect(strip.locator('.des-month-on')).toHaveText(['Mar:H listed', 'Jun:M listed', 'Sep:U listed', 'Dec:Z listed'])
    const file = await saved(page, des.getByRole('button', { name: /98\) Report/ }))
    expect(file.name).toBe('NQ_DES.md')
    expect(file.text.startsWith('# NQ1 Index: futures description')).toBe(true)
    await expectGalleryClean(page, watch)
  })

  test('GP on daily bars draws the RV22 pane from /api/market/rv', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, 'NQ GP')
    await expect.poll(() => watch.requests.some((r) => r.url().includes('/api/market/rv?symbol=NQ.V.0&window=22'))).toBe(true)
    const gp = panel(page, 'NQ GP')
    await expect(gp.getByText(/RV22 pane: \[POST HOC\]/)).toBeVisible()
    await expect(gp.getByRole('combobox', { name: 'Instrument' })).toContainText('NQ1 Index')
    await expectGalleryClean(page, watch)
  })

  test('MON draws a 2Day cell per row on screen, one symbol per request', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, '27F MON')
    const mon = panel(page, '27F MON')
    await expect(mon.getByRole('columnheader', { name: /^2Day/ })).toBeVisible()
    await expect(mon.locator('.mon-spark svg').first()).toBeVisible()
    const twoDay = watch.requests.filter((r) => r.url().includes('/api/market/two-day'))
    expect(twoDay.length).toBeGreaterThan(0)
    for (const r of twoDay) expect(decodeURIComponent(new URL(r.url()).searchParams.get('symbols') ?? '')).not.toContain(',')
    await expectGalleryClean(page, watch)
  })

  test('REG shows the tag column and the accepted-amendments block; RUNS 98) Export saves the shown rows', async ({ page }) => {
    const watch = await watchGallery(page)
    await open(page, 'REG')
    const reg = panel(page, 'REG')
    await expect(reg.getByRole('columnheader', { name: 'Tag' })).toBeVisible()
    await expect(reg.getByRole('region', { name: 'Accepted amendments' })).toBeVisible()
    await open(page, 'RUNS')
    const runs = await apiJson<ReadonlyArray<unknown>>(page, '/api/runs')
    const file = await saved(page, panel(page, 'RUNS').getByRole('button', { name: /98\) Export/ }))
    expect(file.name).toBe('runs_all.csv')
    expect(file.text.split('\r\n')).toHaveLength(runs.length + 1)
    await expectGalleryClean(page, watch)
  })
})
