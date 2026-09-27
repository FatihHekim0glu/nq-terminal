// LineStack in the component gallery (TASKS 5.1): screenshots at both sizes, axe and GET only, the
// fence at 2022-01-01, no line across a gap, the keyboard crosshair and its readout, range buttons,
// the table view, crosshair sync by link group, and 250,000 points drawn in under 100 ms.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryAxeClean, expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'

const ENTRY = 'LineStack'
const FENCE_TIME = Date.UTC(2022, 0, 1) / 1000
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000
const RENDER_BUDGET_MS = 100

interface PaneGeometry {
  readonly plot: readonly [number, number, number, number]
  readonly xRange: readonly [number, number]
  readonly fenceX: number | null
}

async function paneGeometry(pane: Locator): Promise<PaneGeometry> {
  const [plot, xRange, fenceX] = await Promise.all([pane.getAttribute('data-plot'), pane.getAttribute('data-x-range'), pane.getAttribute('data-fence-x')])
  const nums = (s: string | null) => (s ?? '').split(',').map(Number)
  return {
    plot: nums(plot) as unknown as PaneGeometry['plot'],
    xRange: nums(xRange) as unknown as PaneGeometry['xRange'],
    fenceX: fenceX === null || fenceX === '' ? null : Number(fenceX),
  }
}

/** The x in the pane's CSS pixels of a time, from the geometry LineStack writes on each draw. */
function xOf(g: PaneGeometry, t: number): number {
  const [left, , width] = g.plot
  return left + ((t - g.xRange[0]) / (g.xRange[1] - g.xRange[0])) * width
}

/** Every pixel of one canvas column inside the plot, as [r, g, b] triples. */
async function column(pane: Locator, x: number, g: PaneGeometry): Promise<number[][]> {
  const [, top, , height] = g.plot
  return pane.locator('canvas').evaluate(
    (canvas: HTMLCanvasElement, a: { x: number; top: number; height: number }) => {
      const ratio = canvas.width / canvas.getBoundingClientRect().width
      const img = canvas.getContext('2d')!.getImageData(Math.round(a.x * ratio), Math.round(a.top * ratio), 1, Math.round(a.height * ratio))
      const out: number[][] = []
      for (let i = 0; i < img.data.length; i += 4) out.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
      return out
    },
    { x, top, height },
  )
}

const isWhite = ([r, g, b]: number[]) => r! > 240 && g! > 240 && b! > 240
const isArea = ([r, g, b]: number[]) => r === 3 && g === 29 && b === 56
const isAmber = ([r, g, b]: number[]) => r === 255 && g === 160 && b === 40

test('LineStack screenshots at 1920x1080 and 1366x768', async ({ page }) => {
  await screenshotGallery(page, ENTRY)
})

test('LineStack.linked screenshots at 1920x1080 and 1366x768', async ({ page }) => {
  await screenshotGallery(page, 'LineStack.linked')
})

test('LineStack is one role="img" with a data summary, axe clean, GET only', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, ENTRY)
  const img = main.getByRole('img')
  await expect(img).toHaveCount(1)
  await expect(img).toHaveAttribute('aria-label', /^Strategy: \d+ points from 2010-01-04 to 2021-12-31; .*max drawdown -\d+\.\d% \(fixture, compounded\)\. Underwater: /)
  await expect(main.locator('[data-chart-lib="uplot"] canvas')).toHaveCount(3)
  await expect(main.locator('.chart-legend')).toHaveCount(3)
  await expectGalleryClean(page, watch)
})

test('the fence is drawn at 2022-01-01 on every pane, labelled once', async ({ page }) => {
  const main = await openGallery(page, ENTRY)
  for (const id of ['eq', 'dd', 'rr']) {
    const pane = main.locator(`[data-pane="${id}"]`)
    const g = await paneGeometry(pane)
    // The view ends at the fence plus about 2.5% of padding, so the fence sits inside the plot.
    expect(g.xRange[1], id).toBeCloseTo(FENCE_TIME + (FENCE_TIME - utc('2010-01-04')) * 0.025, 0)
    expect(g.fenceX, id).not.toBeNull()
    expect(g.fenceX!, id).toBeLessThan(g.plot[2] - 10)
    expect(g.plot[0] + g.fenceX!, id).toBeCloseTo(xOf(g, FENCE_TIME), 1)
    // The dashed amber line: amber pixels down the fence column, none a few pixels to its left.
    const at = await column(pane, g.plot[0] + Math.round(g.fenceX!), g)
    expect(at.filter(isAmber).length, id).toBeGreaterThan(at.length / 3)
    const beside = await column(pane, g.plot[0] + Math.round(g.fenceX!) - 40, g)
    expect(beside.filter(isAmber).length, id).toBeLessThan(at.filter(isAmber).length / 4)
  }
})

test('no line and no area crosses the missing fortnight of March 2020', async ({ page }) => {
  const main = await openGallery(page, ENTRY)
  const pane = main.locator('[data-pane="eq"]')
  const g = await paneGeometry(pane)
  // Born failing: the probe finds the white line and the area where the data exists.
  const before = await column(pane, Math.round(xOf(g, utc('2020-03-05'))), g)
  expect(before.some(isWhite)).toBe(true)
  expect(before.some(isArea)).toBe(true)
  const gap = await column(pane, Math.round(xOf(g, utc('2020-03-20') + 43_200)), g)
  expect(gap.some(isWhite)).toBe(false)
  expect(gap.some(isArea)).toBe(false)
})

test('arrow keys move the crosshair and its readout; Home and End jump to the ends', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, ENTRY)
  const img = main.getByRole('img')
  const readout = main.getByRole('status')
  await img.focus()
  await expect(img).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(readout).toHaveText(/^2010-01-04: Strategy 1\.00, Same-exposure BH 1\.00, Underwater 0\.0%, Sharpe 63 --, Sharpe 252 --$/)
  await page.keyboard.press('ArrowRight')
  await expect(readout).toHaveText(/^2010-01-05: /)
  for (const id of ['eq', 'dd', 'rr']) await expect(main.locator(`[data-pane="${id}"] .u-cursor-x`)).not.toHaveClass(/u-off/)
  await page.keyboard.press('End')
  await expect(readout).toHaveText(/^2021-12-31: /)
  await page.keyboard.press('ArrowLeft')
  await expect(readout).toHaveText(/^2021-12-30: /)
  await page.keyboard.press('Home')
  await expect(readout).toHaveText(/^2010-01-04: /)
  expect(watch.errors).toEqual([])
})

test('range buttons and + and - set the window; the table view is a real table', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, ENTRY)
  const eq = main.locator('[data-pane="eq"]')
  await main.getByRole('button', { name: '1Y', exact: true }).click()
  await expect(main.getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(eq).toHaveAttribute('data-x-range', new RegExp(`^${utc('2020-12-31')},`))
  await main.getByRole('img').focus()
  await page.keyboard.press('+')
  await expect(main.getByRole('button', { pressed: true })).toHaveCount(0)
  const zoomed = await paneGeometry(eq)
  expect(zoomed.xRange[1] - zoomed.xRange[0]).toBeCloseTo(((FENCE_TIME - utc('2020-12-31')) / 2) * 1.025, 0)
  await main.getByRole('button', { name: 'Max', exact: true }).click()
  await expect(eq).toHaveAttribute('data-x-range', new RegExp(`^${utc('2010-01-04')},`))
  await expectGalleryClean(page, watch)
  await main.getByRole('img').focus()
  await page.keyboard.press('t')
  const table = main.getByRole('table')
  await expect(table.locator('caption')).toHaveText('Fixture equity with drawdown and rolling Sharpe, month-end values')
  await expect(table.getByRole('columnheader')).toHaveText(['Date', 'Strategy', 'Same-exposure BH', 'Underwater', 'Sharpe 63', 'Sharpe 252'])
  await expect(table.getByRole('row')).toHaveCount(145)
  // The scrolling table is a Tab stop on its own (no panel roving focus in the gallery).
  await expectGalleryAxeClean(page)
  expect(watch.errors).toEqual([])
})

test('the Log toggle redraws the equity pane on a log scale', async ({ page }) => {
  const main = await openGallery(page, ENTRY)
  const log = main.getByRole('button', { name: 'Log', exact: true })
  await log.click()
  await expect(log).toHaveAttribute('aria-pressed', 'true')
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(main.locator('[data-pane="eq"]')).toHaveAttribute('data-fence-x', /\d/)
})

async function hover(page: Page, target: Locator, fx = 0.5): Promise<void> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('no box')
  await page.mouse.move(box.x + box.width * fx, box.y + box.height / 2, { steps: 4 })
}

test('link group A shares one crosshair; an unlinked stack keeps its own', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, 'LineStack.linked')
  const cell = (link: string, n: number) => main.locator(`section[data-link="${link}"]`).nth(n)
  const cursor = (section: Locator) => section.locator('[data-pane="eq"] .u-cursor-x')
  await hover(page, cell('A', 0).locator('[data-pane="eq"] .u-over'))
  await expect(cursor(cell('A', 1))).not.toHaveClass(/u-off/)
  await expect(cell('A', 1).locator('[data-pane="dd"] .u-cursor-x')).not.toHaveClass(/u-off/)
  await expect(cursor(cell('-', 0))).toHaveClass(/u-off/)
  await page.mouse.move(0, 0)
  await expect(cursor(cell('A', 1))).toHaveClass(/u-off/)
  // The keyboard crosshair publishes to the group too.
  await cell('A', 1).getByRole('img').focus()
  await page.keyboard.press('End')
  await expect(cursor(cell('A', 0))).not.toHaveClass(/u-off/)
  await expect(cursor(cell('-', 0))).toHaveClass(/u-off/)
  await expectGalleryClean(page, watch)
})

test('250,000 points per pane are drawn in under 100 ms', async ({ page }) => {
  const watch = await watchGallery(page)
  const main = await openGallery(page, 'LineStack.perf')
  const status = main.getByTestId('render-ms')
  await expect(status).toHaveAttribute('data-render-ms', /\d/)
  // Two rebuilds through the Log toggle, each a full build of both panes.
  const log = main.getByRole('button', { name: 'Log', exact: true })
  await log.click()
  await expect(status).toHaveAttribute('data-render-ms', /^[\d.]+,[\d.]+$/)
  await log.click()
  await expect(status).toHaveAttribute('data-render-ms', /^[\d.]+,[\d.]+,[\d.]+$/)
  const runs = ((await status.getAttribute('data-render-ms')) ?? '').split(',').map(Number)
  test.info().annotations.push({ type: 'render-ms', description: runs.join(', ') })
  expect(await main.getByRole('img').getAttribute('aria-label')).toMatch(/^Strategy: 250000 points from 2019-01-02 00:00 to /)
  for (const ms of runs) expect(ms, `render times ${runs.join(', ')} ms`).toBeLessThan(RENDER_BUDGET_MS)
  await expectGalleryAxeClean(page)
  expect(watch.errors).toEqual([])
})
