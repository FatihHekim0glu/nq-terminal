// Chart controls and legends at the 320 CSS px reflow width (WCAG 1.4.10; UI_SPEC section 9). The
// LineStack range row, Log and the Table toggle each stay whole inside the chart with no two
// overlapping, and CandleChart's legends stay inside the plot instead of running off its clipped edge.
import { expect, test, type Locator } from '@playwright/test'
import { openGallery } from './gallery.ts'

const NARROW = { width: 320, height: 640 }

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

async function boxOf(el: Locator): Promise<Box> {
  const box = await el.boundingBox()
  if (!box) throw new Error('element has no box')
  return box
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (inner: Box, outer: Box) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5

test('LineStack: every range button, Log and Table stay whole and apart at 320 px', async ({ page }) => {
  const main = await openGallery(page, 'LineStack', NARROW)
  const stack = main.locator('.linestack').first()
  const frame = await boxOf(stack)
  const buttons = stack.getByRole('button')
  const names = await buttons.allTextContents()
  expect(names).toEqual(expect.arrayContaining(['1D', 'Max', 'Log', 'Table']))
  const boxes: Box[] = []
  for (let i = 0; i < names.length; i += 1) boxes.push(await boxOf(buttons.nth(i)))
  boxes.forEach((b, i) => expect(inside(b, frame), `${names[i]} is cut off: ${JSON.stringify(b)}`).toBe(true))
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      expect(overlaps(boxes[i]!, boxes[j]!), `${names[i]} overlaps ${names[j]}`).toBe(false)
    }
  }
  // The chart itself sits below the controls rather than under them.
  const figure = await boxOf(stack.getByRole('img'))
  for (const [i, b] of boxes.entries()) expect(overlaps(b, figure), `${names[i]} covers the chart`).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('CandleChart: the legends stay inside the plot at 320 px', async ({ page }) => {
  const main = await openGallery(page, 'CandleChart', NARROW)
  const plot = await boxOf(main.locator('.candle-plot').first())
  const legends = main.locator('.candle-plot .chart-legend')
  expect(await legends.count()).toBeGreaterThan(0)
  for (let i = 0; i < (await legends.count()); i += 1) {
    const legend = legends.nth(i)
    expect(inside(await boxOf(legend), plot), `legend ${i} runs past the plot`).toBe(true)
    // Nothing is clipped inside the legend either: every row's text fits or ends in an ellipsis.
    const clipped = await legend.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('.chart-legend-name, .chart-legend-value')].filter(
        (c) => c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).textOverflow !== 'ellipsis',
      ).length,
    )
    expect(clipped, `legend ${i} cuts text without an ellipsis`).toBe(0)
  }
})
