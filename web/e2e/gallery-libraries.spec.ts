// Gallery foundation (TASKS Phase 5 stage A): the gallery index and the ChartLibraries entry, which
// loads uPlot, lightweight-charts and ECharts through their lazy chunks under the backend's CSP, and
// syncs the crosshair of the uPlot and lightweight-charts charts in link group A. Also the helper
// that stage B specs use (e2e/gallery.ts).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'

const ENTRY = 'ChartLibraries'

async function hoverCentre(page: Page, target: Locator, dx = 0): Promise<void> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('target has no box')
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 4 })
}

test('the gallery index lists the entries', async ({ page }) => {
  const watch = await watchGallery(page)
  await page.goto('/__gallery')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('link', { name: ENTRY })).toHaveAttribute('href', `/__gallery/${ENTRY}`)
  await expectGalleryClean(page, watch)
})

test('an unknown entry says so', async ({ page }) => {
  await page.goto('/__gallery/NoSuchEntry')
  await expect(page.locator('main')).toHaveAttribute('data-gallery-state', 'missing')
  await expect(page.getByRole('alert')).toHaveText('No gallery entry named NoSuchEntry.')
})

test('each chart library loads lazily, themed and accessible', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, ENTRY)
  for (const lib of ['uplot', 'lightweight-charts', 'echarts']) {
    await expect(main.locator(`[data-chart-lib="${lib}"] canvas`).first(), lib).toBeVisible()
  }
  // Every chart is role="img" with a data summary, and has a table view (ChartA11y).
  const figures = main.locator('.chart-a11y-figure[role="img"]')
  await expect(figures).toHaveCount(3)
  await expect(figures.nth(0)).toHaveAttribute('aria-label', /Fixture equity: 260 points from 2021-06-01/)
  // Each library came from its own chunk, fetched after the shell.
  const scripts = watch.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.endsWith('.js'))
  for (const lib of ['uplot', 'lightweight-charts', 'echarts']) {
    expect(scripts.filter((p) => p.startsWith(`/assets/${lib}-`)), lib).toHaveLength(1)
  }
  await expectGalleryClean(page, watch)
})

test('link group A shares one crosshair across uPlot and lightweight-charts', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, ENTRY)
  const readout = main.getByTestId('sync-readout')
  const uplotOver = main.locator('[data-chart-lib="uplot"] .u-over')
  const uplotCursor = main.locator('[data-chart-lib="uplot"] .u-cursor-x')
  const lwc = main.locator('[data-chart-lib="lightweight-charts"]')
  await expect(readout).toHaveText('Link group A crosshair: none')

  // uPlot publishes its own moves to the bus.
  await hoverCentre(page, uplotOver)
  await expect(readout).toHaveText(/Link group A crosshair: \d{4}-\d{2}-\d{2}/)
  const fromUplot = await readout.textContent()

  // lightweight-charts publishes too, and uPlot's cursor follows it.
  await page.mouse.move(0, 0)
  await expect(uplotCursor).toHaveClass(/u-off/)
  await hoverCentre(page, lwc, -40)
  await expect(readout).toHaveText(/Link group A crosshair: \d{4}-\d{2}-\d{2}/)
  await expect(readout).not.toHaveText(fromUplot ?? '')
  await expect(uplotCursor).not.toHaveClass(/u-off/)

  // Leaving the chart clears the group, and uPlot's cursor hides.
  await page.mouse.move(0, 0)
  await expect(readout).toHaveText('Link group A crosshair: none')
  await expect(uplotCursor).toHaveClass(/u-off/)
  expect(watch.errors).toEqual([])
})

test('ChartLibraries screenshots at 1920x1080 and 1366x768', async ({ page }) => {
  await screenshotGallery(page, ENTRY)
})
