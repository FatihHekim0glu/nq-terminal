// OOS, LIVE and JRNL E2E (TASKS 7.3; UI_SPEC 7 "OOS" and "LIVE and JRNL"; look spec 7.10 and 7.11).
// Runs against the fixture-mode backend (playwright.config.ts): its access log holds 16 reads by several
// callers, two of them sealed; its live folder holds the book journal (one plumbing close row on
// 2026-10-02 among its performance rows), the book's PLUMBING_DELAYED journal and a preflight journal.
//
// Two groups:
// - "screens" open the gallery entries /__gallery/OosScreen and /__gallery/LiveScreen (the screens in
//   their real panel chrome), so they run before and after the screens join the workspace;
// - "workspace" opens the screens with `OOS <GO>`, `LIVE <GO>` and `JRNL <GO>`, once the merge step has
//   registered them (src/screens/oos/index.ts and src/screens/live/index.ts say where).
// Every test checks axe WCAG 2.2 AA, no console errors and GET-only same-origin requests.
//
// The kill switch test adds a file named KILL-e2e-live-spec to the FIXTURE live folder
// (backend/tests/fixtures/live), never the project's live/, and removes it in `finally`.
import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectGalleryClean, openGallery, watchGallery } from './gallery.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_LIVE = path.resolve(WEB_DIR, '..', 'backend', 'tests', 'fixtures', 'live')
const KILL_FILE = path.join(FIXTURE_LIVE, 'KILL-e2e-live-spec')
const BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'
const BOOK = 'volmanaged_paper_journal.jsonl'
const POLL_WAIT_MS = 10_000
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const

interface OosEntry {
  readonly caller: string
  readonly start_epoch_s: number | null
  readonly end_epoch_s: number | null
  readonly is_sealed: boolean
}

interface OosLog {
  readonly entries: OosEntry[]
  readonly terminal_reads: number
  readonly sealed_reads: number
  readonly total: number
  readonly counts_by_caller: Record<string, number>
}

interface Performance {
  readonly journal: string
  readonly date: (string | null)[]
  readonly plumbing_rows_skipped: number
}

interface JournalPage {
  readonly items: { readonly plumbing: boolean; readonly data: Record<string, unknown> }[]
  readonly total: number
}

async function apiJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBe(true)
  return (await response.json()) as T
}

const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const guardStrip = (scope: Page | Locator): Locator => scope.getByRole('list', { name: 'Guards and environment' })

/** The live parts whose text follows the wall clock or file times, masked in screenshots. */
const liveMasks = (page: Page): Locator[] => [
  page.locator('.countdown'),
  page.locator('[data-key="journalAge"], [data-key="logAge"]'),
]

test.describe('screens (gallery entries)', () => {
  test('OOS: counts, openings card CLOSED, entries newest first', async ({ page }) => {
    const watch = await watchGallery(page)
    const log = await apiJson<OosLog>(page, '/api/audit/oos-log?limit=5000')
    const main = await openGallery(page, 'OosScreen')
    const counts = main.getByRole('group', { name: 'Access log counts' })
    await expect(counts).toContainText(`Terminal reads ${log.terminal_reads}`)
    await expect(counts).toContainText(`Sealed reads ${log.sealed_reads}`)
    await expect(counts).toContainText(`Log lines ${log.total}`)
    const card = main.getByRole('region', { name: 'Sealed window openings' })
    await expect(card).toContainText('opened 2026-09-26 by user')
    await expect(card).toContainText('CLOSED')
    await expect(card).toContainText('[SPENT]')
    const grid = main.getByRole('grid', { name: 'Gate access log entries, newest first' })
    await expect(grid.getByRole('row').nth(1)).toBeVisible()
    await expect(grid).toContainText('SEALED READ')
    await expectGalleryClean(page, watch)
  })

  test('OOS timeline: swimlanes by caller with the fence, sealed reads counted', async ({ page }) => {
    const watch = await watchGallery(page)
    const log = await apiJson<OosLog>(page, '/api/audit/oos-log?limit=5000')
    const drawn = log.entries.filter((e) => e.start_epoch_s !== null && e.end_epoch_s !== null && e.end_epoch_s >= e.start_epoch_s)
    const lanes = new Set(drawn.map((e) => e.caller)).size
    const sealed = drawn.filter((e) => e.is_sealed).length
    const main = await openGallery(page, 'OosScreen')
    await main.getByRole('button', { name: 'Timeline', exact: true }).click()
    const chart = main.getByRole('img', { name: /OOS gate reads by caller/ })
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`${drawn.length} reads by ${lanes} callers.*${sealed} sealed reads past the fence`))
    await expect(main.locator('[aria-busy="true"]')).toHaveCount(0)
    await expectGalleryClean(page, watch)
  })

  test('LIVE: target against actual holds performance rows only; plumbing rows hatched in JRNL', async ({ page }) => {
    const watch = await watchGallery(page)
    const perf = await apiJson<Performance>(page, '/api/live/performance')
    const closes = await apiJson<JournalPage>(page, `/api/live/journal?file=${encodeURIComponent(BOOK)}&type=close&limit=5000`)
    const plumbingDates = closes.items.filter((r) => r.plumbing).map((r) => String(r.data.date))
    expect(plumbingDates.length).toBeGreaterThan(0)
    for (const d of plumbingDates) expect(perf.date).not.toContain(d)
    await openGallery(page, 'LiveScreen')
    const live = panel(page, 'LIVE')
    // The chart's accessible name is its data summary: series, point count and date range.
    const chart = live.getByRole('img', { name: /Target \(ct\)/ })
    await expect(chart).toBeVisible()
    const summary = (await chart.getAttribute('aria-label')) ?? ''
    expect(summary).toContain(`from ${perf.date[0]}`)
    for (const d of plumbingDates) expect(summary).not.toContain(d)
    const recon = live.getByRole('table', { name: 'Reconciliation, performance rows only' })
    await expect(recon.getByRole('row')).toHaveCount(perf.date.length + 1)
    for (const d of plumbingDates) await expect(recon).not.toContainText(d)
    await expect(live).toContainText(`Plumbing rows dropped from this view: ${perf.plumbing_rows_skipped}.`)
    const jrnl = panel(page, 'JRNL')
    const rows = jrnl.locator('tr.plumbing-row')
    await expect(rows.first()).toBeVisible()
    const n = await rows.count()
    for (let i = 0; i < n; i += 1) await expect(rows.nth(i)).toContainText(BANNER)
    await expectGalleryClean(page, watch)
  })

  test('LIVE: the kill switch state follows the file in fixture mode', async ({ page }) => {
    const watch = await watchGallery(page)
    try {
      await openGallery(page, 'LiveScreen')
      const guards = guardStrip(panel(page, 'LIVE'))
      await expect(guards).toContainText('KILL [off]')
      fs.writeFileSync(KILL_FILE, '', { encoding: 'utf-8' })
      await expect(guards).toContainText('KILL [on]', { timeout: POLL_WAIT_MS })
      fs.rmSync(KILL_FILE, { force: true })
      await expect(guards).toContainText('KILL [off]', { timeout: POLL_WAIT_MS })
    } finally {
      fs.rmSync(KILL_FILE, { force: true })
    }
    await expectGalleryClean(page, watch)
  })

  test('LIVE and JRNL: empty states name the expected file', async ({ page }) => {
    const watch = await watchGallery(page)
    const expectedFiles = [BOOK, 'volmanaged_paper_journal.PLUMBING_DELAYED.jsonl']
    const status = await apiJson<Record<string, unknown>>(page, '/api/live/status')
    const empty = {
      ...status,
      journals: [],
      exposure_summary: null,
      last_close: null,
      halted: null,
      expected: expectedFiles.map((name) => ({ name, path: `live/logs/${name}`, present: false, empty_state: `no journal yet: live/logs/${name}` })),
    }
    const perf = await apiJson<Record<string, unknown>>(page, '/api/live/performance')
    const blank = { ...perf, present: false, empty_state: `no journal yet: live/logs/${BOOK}`, plumbing_rows_skipped: 0,
      t: [], line_no: [], date: [], contract: [], target: [], expected: [], actual: [], reconciled_ok: [], exposure: [], slippage_ticks: [], sent: [], refused: [], error: [], halted: [] }
    await page.route('**/api/live/status', (route) => route.fulfill({ json: empty }))
    await page.route('**/api/live/performance**', (route) => route.fulfill({ json: blank }))
    await openGallery(page, 'LiveScreen')
    await expect(panel(page, 'LIVE')).toContainText(`no journal yet: live/logs/${BOOK}`)
    await expect(panel(page, 'JRNL')).toContainText(expectedFiles.map((n) => `no journal yet: live/logs/${n}`).join('; '))
    await expectGalleryClean(page, watch)
  })

  for (const size of SIZES) {
    test(`screenshots ${size.width}x${size.height}`, async ({ page }) => {
      await openGallery(page, 'OosScreen', size)
      await expect(page.getByRole('grid', { name: 'Gate access log entries, newest first' }).getByRole('row').nth(1)).toBeVisible()
      await expect(page.getByRole('region', { name: 'Sealed window openings' })).toContainText('CLOSED')
      await expect(page).toHaveScreenshot(`oos-${size.width}x${size.height}.png`)
      await openGallery(page, 'LiveScreen', size)
      await expect(guardStrip(panel(page, 'LIVE'))).toBeVisible()
      await expect(panel(page, 'LIVE').getByRole('img', { name: /Target \(ct\)/ })).toBeVisible()
      await expect(panel(page, 'JRNL').locator('tr.plumbing-row').first()).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
      await expect(page).toHaveScreenshot(`live-${size.width}x${size.height}.png`, { mask: liveMasks(page) })
    })
  }
})

test.describe('workspace', () => {
  const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })

  async function run(page: Page, line: string): Promise<void> {
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    await page.keyboard.press('Control+k')
    await commandLine(page).fill(line)
    await commandLine(page).press('Enter')
  }

  test('OOS <GO> opens the gate access log', async ({ page }) => {
    const watch = await watchGallery(page)
    await run(page, 'OOS')
    const oos = panel(page, 'OOS')
    await expect(oos.getByRole('toolbar', { name: /Gate access log/ })).toBeVisible()
    await expect(oos.getByRole('region', { name: 'Sealed window openings' })).toContainText('CLOSED')
    await expect(oos.getByRole('grid', { name: 'Gate access log entries, newest first' })).toBeVisible()
    await expectGalleryClean(page, watch)
  })

  test('LIVE <GO> opens the paper book above its journals', async ({ page }) => {
    const watch = await watchGallery(page)
    await run(page, 'LIVE')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(2)
    await expect(guardStrip(panel(page, 'LIVE'))).toContainText('KILL [off]')
    await expect(panel(page, 'JRNL').locator('tr.plumbing-row').first()).toContainText(BANNER)
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await expectGalleryClean(page, watch)
  })

  test('JRNL <GO> filters by file through the API', async ({ page }) => {
    const watch = await watchGallery(page)
    await run(page, 'JRNL')
    const jrnl = panel(page, 'JRNL')
    await jrnl.getByRole('combobox', { name: 'File' }).click()
    await page.getByRole('option', { name: BOOK, exact: true }).click()
    await expect.poll(() => watch.requests.some((r) => r.url().includes(`file=${encodeURIComponent(BOOK)}`))).toBe(true)
    await expectGalleryClean(page, watch)
  })
})
