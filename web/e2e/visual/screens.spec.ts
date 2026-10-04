// Visual and accessibility pass on every P0 screen (TASKS 8.2; UI_SPEC section 9; look spec sections 7
// and 8). For each screen at 1920x1080 and 1366x768, in the workspace against the fixture-mode backend:
// 1. every chart has a data summary (role="img" named with numbers) and a table view: each drawn canvas
//    sits in a ChartA11y figure, each figure has its Table toggle, and each toggle gives a table whose
//    caption names its region, with column headers and at least one row, shown whole (it does not
//    scroll inside the chart's box, so the panel body, the panel's one Tab stop, scrolls it);
// 2. axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) is clean at rest, with the command dropdown
//    open, and with the dropdown open over every chart in its table view;
// 3. a screenshot baseline is taken with the command dropdown open (frozen clock, reduced motion; the
//    gate-read counters, which depend on the specs run before, are masked);
// 4. no console error, no CSP report, and every request a same-origin GET.
// In-cell sparklines (MON 2Day, the quote header) are not charts: they are hidden from assistive
// technology and carry the same values in words beside them, which the audit checks instead.
// RR on the fixture hypothesis draws no chart (its 39 sessions are shorter than the rolling windows),
// so RR is also checked on a fixture run whose series is long enough.
// The offline run (playwright.offline.config.ts) drives OFFLINE_SCREENS against the demo dataset instead of SCREENS:
// a screen the demo cannot draw carries an `offlineSkip` reason naming the body it lacks and is skipped by name,
// never dropped, and no assertion below is relaxed for either target.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MASK_COLOR, expectGalleryClean, watchGallery } from '../gallery.ts'
import { OFFLINE } from '../target.ts'
import { expectWatchSegment } from '../watchReady.ts'
import {
  auditCharts,
  axeViolations,
  closeDropdown,
  openDropdown,
  openScreen,
  OFFLINE_SCREENS,
  SCREENS,
  showEveryTable,
  VIEWPORTS,
  type ScreenCase,
  type Viewport,
} from './screens.ts'

const TABLE_TOGGLE = 'Table'
// A summary names the data: it carries at least one figure (a count, a date, a value).
const SUMMARY = /\d/

test.describe.configure({ timeout: 180_000 })

const SCREENS_UNDER_TEST: readonly ScreenCase[] = OFFLINE ? OFFLINE_SCREENS : SCREENS

async function checkCharts(page: Page, screen: ScreenCase): Promise<void> {
  const audit = await auditCharts(page, TABLE_TOGGLE)
  expect(audit.bareCanvases, 'every drawn canvas is inside a named chart figure').toEqual([])
  expect(audit.bareGraphics, 'every in-cell graphic is hidden with its values in words beside it').toEqual([])
  expect(audit.withoutToggle, 'every chart has its Table toggle').toBe(0)
  expect(audit.summaries.length, 'charts on screen').toBe(screen.charts)
  for (const summary of audit.summaries) expect(summary, 'chart summary').toMatch(SUMMARY)
}

async function checkTables(page: Page, charts: number): Promise<void> {
  const tables = await showEveryTable(page)
  expect(tables, 'one table view per chart').toHaveLength(charts)
  for (const t of tables) {
    expect(t.caption.length, 'table caption').toBeGreaterThan(0)
    expect(t.name, 'the table region is named by its caption').toBe(t.caption)
    expect(t.headers, `${t.caption}: column headers`).toBeGreaterThan(0)
    expect(t.rows, `${t.caption}: rows`).toBeGreaterThan(0)
    expect(t.clipped, `${t.caption}: shown whole, the panel body scrolls it`).toBe(false)
  }
}

// The fixture backend counts gate reads over the whole E2E run, so these texts depend on which specs
// ran before this one: the status line's `Gate reads N` (and the segments after it, which it moves) and
// the GP footer's served years and reads. The live stream line's last event time and row count follow the wall
// clock and the stream's timing (TASKS 9.2). They are masked; every other pixel is compared.
function runCounters(page: Page): Locator[] {
  const status = page.getByRole('contentinfo')
  return [
    status.locator('.seg').filter({ hasText: 'Gate reads' }), status.locator('.seg.flag'), page.locator('.gp-footer'),
    page.locator('[data-key="stream-lastEvent"], [data-key="stream-rows"]'),
  ]
}

function sizeName(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}`
}

for (const viewport of VIEWPORTS) {
  test.describe(`every screen at ${sizeName(viewport)}`, () => {
    for (const screen of SCREENS_UNDER_TEST) {
      test(`${screen.name}: charts, axe at rest, with the dropdown open and in table view; baseline`, async ({ page }) => {
        test.skip(OFFLINE && screen.offlineSkip !== undefined, screen.offlineSkip)
        const watch = await watchGallery(page)
        await openScreen(page, screen, viewport)
        // LIVE and JRNL: the stream line reads the same on every run once the stream is open (TASKS 9.2).
        for (const line of await page.getByRole('group', { name: 'Live stream state' }).all()) {
          await expect(line.getByRole('status')).toHaveText('live, server events', { timeout: 15_000 })
        }
        await checkCharts(page, screen)
        const charts = (await auditCharts(page, TABLE_TOGGLE)).summaries.length
        expect(await axeViolations(page), 'axe at rest').toEqual([])

        await expectWatchSegment(page)
        await openDropdown(page)
        await page.mouse.move(0, 0)
        await expect(page).toHaveScreenshot(`${screen.name}-dropdown-${sizeName(viewport)}.png`, { mask: runCounters(page), maskColor: MASK_COLOR })
        expect(await axeViolations(page), 'axe with the command dropdown open').toEqual([])
        await closeDropdown(page)

        await checkTables(page, charts)
        await openDropdown(page)
        expect(await axeViolations(page), 'axe in table view with the dropdown open').toEqual([])
        await expectGalleryClean(page, watch)
      })
    }
  })
}
