// The chart focus ring on real pixels (UI_SPEC section 9, WCAG 2.4.7 and 2.4.11): every chart fills
// its role="img" figure with an opaque layer, so the ring must paint above it. For one chart of each
// library, the left edge of the focused figure reads white on screen and black before focus.
import { expect, test, type Page } from '@playwright/test'
import { openGallery } from './gallery.ts'

const ENTRIES = ['LineStack', 'CandleChart', 'Heatmap', 'Distribution'] as const

type Rgb = readonly [number, number, number]

/** Screen pixels at page coordinates, read from a screenshot decoded in a blank page (no CSP). */
async function pixelsAt(page: Page, points: readonly (readonly [number, number])[]): Promise<Rgb[]> {
  const png = (await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })).toString('base64')
  const decoder = await page.context().newPage()
  try {
    return await decoder.evaluate(
      async (a: { png: string; points: readonly (readonly [number, number])[] }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${a.png}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return a.points.map(([x, y]) => {
          const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
          return [d[0]!, d[1]!, d[2]!] as const
        })
      },
      { png, points },
    )
  } finally {
    await decoder.close()
  }
}

const isWhite = ([r, g, b]: Rgb) => r > 240 && g > 240 && b > 240

for (const name of ENTRIES) {
  test(`${name}: the focus ring paints above the chart`, async ({ page }) => {
    const main = await openGallery(page, name)
    const figure = main.locator('.chart-a11y-figure[role="img"]').first()
    const box = await figure.boundingBox()
    if (!box) throw new Error(`${name}: the figure has no box`)
    // One pixel inside the left edge, at a quarter, a half and three quarters of the height.
    const edge = [0.25, 0.5, 0.75].map((f) => [box.x + 1, box.y + box.height * f] as const)
    expect((await pixelsAt(page, edge)).filter(isWhite), 'white before focus').toEqual([])
    await figure.focus()
    await expect(figure).toBeFocused()
    expect(await figure.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    const focused = await pixelsAt(page, edge)
    expect(focused.every(isWhite), `ring pixels ${JSON.stringify(focused)}`).toBe(true)
  })
}
