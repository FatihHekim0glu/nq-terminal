// The ECharts set (TASKS 5.3) in the gallery: Heatmap (MRET, CORR, MON), Distribution, BarLadder,
// PScatter and Swimlane. Each entry draws on a canvas from the lazy ECharts chunk, is role="img" with
// its data summary, has a table view reachable from the keyboard, passes axe (WCAG 2.2 AA) with no
// console errors and only same-origin GETs, draws within the time budget, and matches its baselines
// at 1920x1080 and 1366x768.
import { expect, test, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'

interface Entry {
  readonly name: string
  readonly charts: number
  readonly label: RegExp
}

const ENTRIES: readonly Entry[] = [
  { name: 'Heatmap', charts: 1, label: /^Fixture monthly returns \(%\), volmanaged_v0: 13 rows by 12 columns; low -\d+\.\d\d% at \d{4} \w{3}/ },
  { name: 'Heatmap.corr', charts: 1, label: /^Fixture 252-session correlation, 27F: 27 rows by 27 columns; low -0\.\d\d at/ },
  { name: 'Heatmap.mon', charts: 1, label: /^Fixture 27F returns \(%\): 27 rows by 6 columns;/ },
  { name: 'Distribution', charts: 1, label: /^Fixture daily returns \(%\), volmanaged_v0: 3126 returns in \d+ bins .* VaR 95 \d\.\d\d%/ },
  { name: 'BarLadder', charts: 3, label: /^Fixture net R per trade by block, za_v0: 3 bars, 1 positive and 2 negative; high \+0\.16 R \(2018-21\)/ },
  { name: 'PScatter', charts: 1, label: /^Fixture registry p-values: 16 p-values at alpha 0\.05; lowest 0\.0027 \(overnight_v0\); passing: Bonferroni 1, Holm 1, BH 1\./ },
  { name: 'Swimlane', charts: 1, label: /^Fixture gate reads by caller: 2790 reads by 13 callers; windows from 2010-01-01 to 2026-09-01; 2 sealed reads past the fence\./ },
]

/** Draw budget per chart, measured around setOption (EchartsChart's `nqt-echarts-draw:<id>`). */
const DRAW_BUDGET_MS = 150

async function drawTimes(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType('measure')
        .filter((m) => m.name.startsWith('nqt-echarts-draw:'))
        .map((m) => [m.name.slice('nqt-echarts-draw:'.length), Math.round(m.duration * 10) / 10]),
    ),
  )
}

for (const entry of ENTRIES) {
  test(`${entry.name}: drawn from the ECharts chunk, named by its summary, clean under axe`, async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, entry.name)
    const hosts = main.locator('[data-chart-lib="echarts"]')
    await expect(hosts).toHaveCount(entry.charts)
    for (let i = 0; i < entry.charts; i++) await expect(hosts.nth(i).locator('canvas').first()).toBeVisible()
    const figures = main.locator('.chart-a11y-figure[role="img"]')
    await expect(figures).toHaveCount(entry.charts)
    await expect(figures.first()).toHaveAttribute('aria-label', entry.label)
    const scripts = watch.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.startsWith('/assets/echarts-'))
    expect(scripts).toHaveLength(1)
    await expectGalleryClean(page, watch)
  })

  test(`${entry.name}: the table view is reachable from the keyboard and matches axe`, async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, entry.name)
    const toggle = main.getByRole('button', { name: 'Table' }).first()
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const table = main.getByRole('table').first()
    await expect(table).toBeVisible()
    expect(await table.locator('tbody tr').count()).toBeGreaterThan(0)
    await expectGalleryClean(page, watch)
    // T in the table region returns to the chart.
    await main.locator('.chart-a11y-tablewrap').first().focus()
    await page.keyboard.press('t')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(main.locator('.chart-a11y-figure[role="img"]')).toHaveCount(entry.charts)
  })
}

test('every ECharts entry draws within the budget', async ({ page }) => {
  const report: Record<string, number> = {}
  for (const entry of ENTRIES) {
    await openGallery(page, entry.name)
    const times = await drawTimes(page)
    expect(Object.keys(times).length, entry.name).toBe(entry.charts)
    for (const [id, ms] of Object.entries(times)) {
      report[`${entry.name}/${id}`] = ms
      expect(ms, `${entry.name}/${id}`).toBeLessThan(DRAW_BUDGET_MS)
    }
  }
  test.info().annotations.push({ type: 'draw ms', description: JSON.stringify(report) })
  process.stdout.write(`ECharts draw times (ms): ${JSON.stringify(report)}\n`)
})

for (const entry of ENTRIES) {
  test(`${entry.name} screenshots at 1920x1080 and 1366x768`, async ({ page }) => {
    await screenshotGallery(page, entry.name)
  })
}
