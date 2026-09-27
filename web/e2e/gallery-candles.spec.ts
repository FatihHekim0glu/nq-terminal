// CandleChart in the component gallery (TASKS 5.2): the daily GP-style chart and the intraday pair
// in link group A, screenshots at 1920x1080 and 1366x768, axe with the WCAG 2.2 AA tags, the
// keyboard path (readout T O H L C V, Left and Right, Home and End, + and - zoom, T table view), the
// crosshair following across linked charts, and the render and zoom timings on 4,000 bars.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'

const DAILY = 'CandleChart'
const INTRADAY = 'CandleChart.intraday'
const PERF = 'CandleChart.perf'

/** Render budget for 4,000 bars (mount to second painted frame), and the zoom frame budget (30 fps floor; target 60). */
const RENDER_BUDGET_MS = 1000
const ZOOM_FRAME_BUDGET_MS = 34

const readoutOf = (scope: Locator) => scope.getByRole('status', { name: 'Crosshair readout' })

async function shownBars(readout: Locator): Promise<number> {
  const m = /(\d+) of (\d+) bars shown/.exec((await readout.textContent()) ?? '')
  if (!m) throw new Error('no zoom state in the readout')
  return Number(m[1])
}

test('daily candles load lazily, themed, with a summary, legend and attribution', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, DAILY)
  const figure = main.getByRole('img')
  await expect(figure).toHaveAttribute('aria-label', /^NQ1 Index: 260 daily bars from 2021-01-04 to 2021-12-31; last close [\d.]+; .*6 fills and 4 rolls marked\. The 2022-01-01 fence follows the last bar\.$/)
  await expect(main.locator('[data-chart-lib="lightweight-charts"] canvas').first()).toBeVisible()
  await expect(main.getByText('NQ1 Index - Last price')).toBeVisible()
  await expect(main.getByText('NQ1 Index - Volume')).toBeVisible()
  // The TradingView attribution stays on screen but out of the tab order and the accessibility tree.
  const logo = main.locator('a#tv-attr-logo')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('inert', '')
  await expect(logo).toHaveAttribute('aria-hidden', 'true')
  const scripts = watch.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.startsWith('/assets/lightweight-charts-'))
  expect(scripts).toHaveLength(1)
  await expectGalleryClean(page, watch)
})

test('keyboard: the readout shows T O H L C V and follows Left, Right, Home and End', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, DAILY)
  const figure = main.getByRole('img')
  const readout = readoutOf(main)
  await expect(readout).toHaveText(/^T 2021-12-31O [\d.]+H [\d.]+L [\d.]+C [\d.]+V [\d,]+RV22 [\d.]+%/)
  await figure.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(readout).toHaveText(/^T 2021-12-31/)
  await page.keyboard.press('ArrowLeft')
  await expect(readout).toHaveText(/^T 2021-12-30/)
  await page.keyboard.press('Home')
  await expect(readout).toHaveText(/^T 2021-01-04/)
  await page.keyboard.press('ArrowRight')
  await expect(readout).toHaveText(/^T 2021-01-05/)
  await page.keyboard.press('End')
  await expect(readout).toHaveText(/^T 2021-12-31/)
  // Focus stayed on the chart: the keys were the chart's, not the page's.
  await expect(figure).toBeFocused()
  expect(watch.errors).toEqual([])
})

test('keyboard: + and - zoom, T opens the table view', async ({ page }) => {
  const main = await openGallery(page, DAILY)
  const figure = main.getByRole('img')
  const readout = readoutOf(main)
  await expect(readout).toHaveText(/260 of 260 bars shown/)
  await figure.focus()
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect(readout).not.toHaveText(/260 of 260 bars shown/)
  await expect.poll(() => shownBars(readout)).toBeLessThan(260 * 0.7)
  const zoomed = await shownBars(readout)
  await page.keyboard.press('-')
  await expect.poll(() => shownBars(readout)).toBeGreaterThan(zoomed)
  await page.keyboard.press('t')
  const table = main.getByRole('region', { name: 'NQ1 Index bars' })
  await expect(table.getByRole('row')).toHaveCount(261)
  await expect(table.getByRole('columnheader')).toHaveText(['Time', 'Open', 'High', 'Low', 'Close', 'Volume', 'RV22', 'Events'])
  await expect(table.getByRole('cell', { name: /^Roll, gap -18\.25 pts \(-0\.14%\)$/ })).toHaveCount(1)
  // T again: the chart is drawn afresh in its new host.
  await page.keyboard.press('t')
  await expect(main.locator('[data-chart-lib="lightweight-charts"] canvas').first()).toBeVisible()
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(main.locator('a#tv-attr-logo')).toHaveAttribute('inert', '')
})

async function hoverAt(page: Page, target: Locator, fx: number): Promise<void> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('target has no box')
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.3, { steps: 3 })
}

test('link group A: a keyboard or pointer crosshair on one chart moves the other', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, INTRADAY)
  const five = main.getByTestId('five')
  const hour = main.getByTestId('hour')
  await five.getByRole('img').focus()
  await page.keyboard.press('End')
  await expect(readoutOf(five)).toHaveText(/^T 2021-03-12 15:55/)
  await expect(readoutOf(hour)).toHaveText(/^T 2021-03-12 15:30/)
  await page.keyboard.press('Home')
  await expect(readoutOf(five)).toHaveText(/^T 2021-03-08 09:30/)
  await expect(readoutOf(hour)).toHaveText(/^T 2021-03-08 09:30/)
  // The other way round, with the pointer on the hourly chart.
  await hoverAt(page, hour.locator('.candle-host'), 0.5)
  await expect(readoutOf(five)).not.toHaveText(/^T 2021-03-08 09:30/)
  await expect(readoutOf(five)).toHaveText(/^T 2021-03-1\d \d\d:\d\d/)
  await expectGalleryClean(page, watch)
})

test('performance: 4,000 bars render and zoom within budget', async ({ page }) => {
  const main = await openGallery(page, PERF)
  const out = main.getByTestId('render-ms')
  await expect(out).toHaveAttribute('data-ms', /\d/)
  const renderMs = Number(await out.getAttribute('data-ms'))
  await expect(main.getByRole('img')).toHaveAttribute('aria-label', /: 4000 1-minute bars/)
  const figure = main.getByRole('img')
  await figure.focus()
  // One zoom step per frame, alternating in and out, for 60 frames: the mean frame time.
  const zoomFrameMs = await figure.evaluate(async (el) => {
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
    await frame()
    const start = performance.now()
    const steps = 60
    for (let i = 0; i < steps; i += 1) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 === 0 ? '+' : '-', bubbles: true, cancelable: true }))
      await frame()
    }
    return (performance.now() - start) / steps
  })
  test.info().annotations.push(
    { type: 'render-ms', description: renderMs.toFixed(1) },
    { type: 'zoom-frame-ms', description: zoomFrameMs.toFixed(2) },
  )
  console.log(`CandleChart 4000 bars: render ${renderMs.toFixed(1)} ms, zoom frame ${zoomFrameMs.toFixed(2)} ms`)
  expect(renderMs).toBeLessThan(RENDER_BUDGET_MS)
  expect(zoomFrameMs).toBeLessThan(ZOOM_FRAME_BUDGET_MS)
})

test('CandleChart screenshots at 1920x1080 and 1366x768', async ({ page }) => {
  await screenshotGallery(page, DAILY)
})

test('CandleChart intraday screenshots at 1920x1080 and 1366x768', async ({ page }) => {
  await screenshotGallery(page, INTRADAY)
})
