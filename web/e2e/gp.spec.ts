// GP and GIP E2E (TASKS 7.1; UI_SPEC section 7; look spec 7.6 and 8.5). Against the fixture-mode
// backend (synthetic bars through the fake gate, playwright.config.ts):
// - 1m, 5m, 1h and 1d switch, each a new gated read at its own timeframe;
// - vendor and repaired: repaired is offered where the catalog lists it and is requested;
// - a range past the fence shows the gate's refusal text and sends no price request past 2021-12-31;
// - [GATED] and [REPAIRED] for a GIP date the gate rejected and the repair rebuilt;
// - fills overlaid from a run picked in the panel;
// - no served bar after 2021-12-31 in any response; the quote header equals the served bars;
// - axe with the WCAG 2.2 AA tags, no console errors, GET only; screenshots at both sizes.
// The gallery entries (/__gallery/GpScreen and /__gallery/GipScreen) render the screen in real panel
// chrome. The last block drives the workspace through the command line and needs the screens
// registered in src/chrome/WorkspaceScreens.tsx (the merge step).
import { expect, test, type Page, type Response } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery, type GalleryWatch } from './gallery.ts'

const FENCE_S = Date.UTC(2022, 0, 1) / 1000

interface BarsBody {
  readonly timeframe: string
  readonly variant: string
  readonly t: number[]
  readonly o: Array<number | null>
  readonly h: Array<number | null>
  readonly l: Array<number | null>
  readonly c: Array<number | null>
  readonly v: Array<number | null>
}

interface UniverseRow {
  readonly root: string
  readonly last_date: string
  readonly realised_vol: number | null
  readonly returns: Readonly<Record<string, number | null>>
}

const isBars = (r: Response) => new URL(r.url()).pathname === '/api/bars'
const isBarsRequest = (r: { url(): string }) => new URL(r.url()).pathname === '/api/bars'

function barsParam(r: Response, name: string): string | null {
  return new URL(r.url()).searchParams.get(name)
}

/** Every /api/bars request the page made: none may name a date after 2021-12-31. */
function expectNoPriceRequestPastFence(watch: GalleryWatch): void {
  const bars = watch.requests.filter(isBarsRequest).map((r) => r.url())
  expect(bars.length).toBeGreaterThan(0)
  expect(bars.filter((u) => /20(2[2-9]|[3-9]\d)-/.test(decodeURIComponent(u)))).toEqual([])
}

async function servedBars(page: Page, act: () => Promise<unknown>, check: (r: Response) => boolean = () => true): Promise<BarsBody> {
  const [response] = await Promise.all([page.waitForResponse((r) => isBars(r) && check(r)), act()])
  expect(response.status()).toBe(200)
  const body = (await response.json()) as BarsBody
  expect(body.t.every((t) => t < FENCE_S)).toBe(true)
  return body
}

async function chartReady(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** A drawn chart, never an error state, before a screenshot. */
async function chartShown(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: /^NQ1 Index: \d+ / })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

const quote = (page: Page) => page.getByRole('group', { name: 'Quote for NQ1 Index' })
const barSize = (page: Page) => page.getByRole('group', { name: 'Bar size' })

test.describe('GP gallery (fixture backend)', () => {
  test('daily candles: quote equals the served bars, basis shown, clean', async ({ page }) => {
    const watch = await watchGallery(page)
    const universe = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/market/universe')
    const body = await servedBars(page, () => openGallery(page, 'GpScreen'))
    await chartReady(page)
    const last = body.c.at(-1) ?? null
    expect(last).not.toBeNull()
    await expect(quote(page)).toContainText(String((last as number).toFixed(2)))
    await expect(quote(page)).toContainText(new Intl.NumberFormat('en-GB').format(body.v.at(-1) ?? 0))
    // RV22 and the % change are the universe's own values for the same session, at displayed precision.
    const rows = ((await (await universe).json()) as { rows: UniverseRow[] }).rows
    const nq = rows.find((r) => r.root === 'NQ')
    expect(nq?.last_date).toBe(new Date((body.t.at(-1) ?? 0) * 1000).toISOString().slice(0, 10))
    const pct = (nq?.returns['1D'] ?? 0) * 100
    await expect(quote(page)).toContainText(`RV22 ${((nq?.realised_vol ?? 0) * 100).toFixed(1)}%`)
    await expect(quote(page)).toContainText(`${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`)
    await expect(page.getByRole('toolbar', { name: 'Candle chart functions' })).toBeVisible()
    await expect(page.locator('.gp-footer')).toContainText('back-adjusted prices served through the OOS gate; descriptive, in-sample')
    await expect(page.getByRole('img', { name: /NQ1 Index: \d+ daily bars from/ })).toBeVisible()
    await expectGalleryClean(page, watch)
    expectNoPriceRequestPastFence(watch)
  })

  test('1m, 5m, 1h and 1d switch', async ({ page }) => {
    const watch = await watchGallery(page)
    await openGallery(page, 'GpScreen')
    // The chart's accessible name carries the bar step; 1d at the end may come from the query cache.
    const steps = { '1h': '1-hour', '5m': '5-minute', '1m': '1-minute', '1d': 'daily' } as const
    for (const [tf, step] of Object.entries(steps)) {
      await barSize(page).getByRole('button', { name: tf, exact: true }).click()
      await expect(barSize(page).getByRole('button', { name: tf, exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('img', { name: new RegExp(`^NQ1 Index: \\d+ ${step} bars from`) })).toBeVisible()
      await chartReady(page)
    }
    const asked = watch.requests.filter(isBarsRequest).map((r) => new URL(r.url()).searchParams.get('timeframe'))
    expect(new Set(asked)).toEqual(new Set(['1d', '1h', '5m', '1m']))
    await expectGalleryClean(page, watch)
  })

  test('vendor and repaired on 1m', async ({ page }) => {
    await openGallery(page, 'GpScreen')
    await servedBars(page, () => barSize(page).getByRole('button', { name: '1m', exact: true }).click(), (r) => barsParam(r, 'timeframe') === '1m')
    await page.getByRole('combobox', { name: 'Variant' }).click()
    const body = await servedBars(page, () => page.getByRole('option', { name: 'repaired' }).click(), (r) => barsParam(r, 'variant') === 'repaired')
    expect(body.variant).toBe('repaired')
    await expect(page.getByRole('combobox', { name: 'Variant' })).toContainText('repaired')
  })

  test('a range past the fence shows the gate refusal and requests nothing past 2021-12-31', async ({ page }) => {
    const watch = await watchGallery(page)
    await openGallery(page, 'GpScreen')
    const end = page.getByRole('textbox', { name: 'Range end' })
    await end.fill('2022-03-14')
    await end.press('Enter')
    await expect(page.getByText('Gate refused this window.')).toBeVisible()
    await expect(page.locator('.gp-message')).toContainText(
      'leaves the in-sample window [2010-01-01 00:00:00+00:00, 2022-01-01 00:00:00+00:00); straddling windows are refused, not clipped',
    )
    await expect(page.getByRole('img', { name: /NQ1 Index/ })).toHaveCount(0)
    await expectGalleryClean(page, watch)
    expectNoPriceRequestPastFence(watch)
  })

  test('fills overlay from a run picked in the panel', async ({ page }) => {
    await openGallery(page, 'GpScreen')
    await servedBars(page, () => page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'Max', exact: true }).click(), (r) => barsParam(r, 'start') === '2010-01-01')
    await page.getByRole('combobox', { name: 'Fills' }).click()
    await page.getByRole('option', { name: 'nt_volmanaged_v0_fixture_m1' }).click()
    await expect(page.locator('.gp-footer')).toContainText('fills from nt_volmanaged_v0_fixture_m1. Fill prices are contract prices; candles are back-adjusted.')
    await chartReady(page)
    await expect(page.getByRole('img', { name: /NQ1 Index: .* \d+ fills and \d+ rolls? marked/ })).toBeVisible()
  })

  test('screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await screenshotGallery(page, 'GpScreen', {
      prepare: async (p) => {
        await chartShown(p)
        await expect(quote(p)).toContainText(/RV22 \d/)
      },
      // The gate's read count and cache flag depend on what ran before in the same backend.
      mask: [page.locator('.gp-footer')],
    })
  })
})

test.describe('GIP gallery (fixture backend)', () => {
  test('a gated session shows [GATED], its repaired bars [REPAIRED]', async ({ page }) => {
    const watch = await watchGallery(page)
    const body = await servedBars(page, () => openGallery(page, 'GipScreen'))
    expect(body.timeframe).toBe('1m')
    await expect(page.getByRole('toolbar', { name: 'Intraday chart functions' })).toBeVisible()
    const flags = page.getByRole('group', { name: 'Session flags' })
    await expect(flags).toContainText('[GATED]')
    await expect(flags).toContainText('2011-01-20 was rejected by qa.day_gate.')
    await page.getByRole('combobox', { name: 'Variant' }).click()
    await servedBars(page, () => page.getByRole('option', { name: 'repaired' }).click(), (r) => barsParam(r, 'variant') === 'repaired')
    await expect(flags).toContainText('[REPAIRED]')
    await expect(flags).toContainText('2011-01-20 was rebuilt from trades.')
    await chartReady(page)
    await expectGalleryClean(page, watch)
  })

  test('a date past the fence is refused with no bars request', async ({ page }) => {
    const watch = await watchGallery(page)
    await openGallery(page, 'GipScreen')
    const before = watch.requests.filter(isBarsRequest).length
    const date = page.getByRole('textbox', { name: 'Date' })
    await date.fill('2022-03-14')
    await date.press('Enter')
    await expect(page.locator('.gp-message')).toContainText('window [2022-03-13 22:00:00+00:00, 2022-03-14 22:00:00+00:00) leaves the in-sample window')
    expect(watch.requests.filter(isBarsRequest).length).toBe(before)
    expectNoPriceRequestPastFence(watch)
    await expectGalleryClean(page, watch)
  })

  test('screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await screenshotGallery(page, 'GipScreen', { prepare: async (p) => chartShown(p), mask: [page.locator('.gp-footer')] })
  })
})

test.describe('GP and GIP in the workspace (registered screens)', () => {
  const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })

  async function run(page: Page, line: string): Promise<void> {
    await page.keyboard.press('Control+k')
    await commandLine(page).fill(line)
    await commandLine(page).press('Enter')
    await expect(commandLine(page)).toHaveValue('')
  }

  test('HOME panel 1 is the GP screen, not a placeholder', async ({ page }) => {
    await page.goto('/')
    const gp = page.locator('[data-nqt-title="NQ GP 1d"]')
    await expect(gp.locator('[data-screen="GP"]')).toBeVisible()
    await expect(gp.locator('[data-placeholder]')).toHaveCount(0)
    await expect(gp.getByRole('group', { name: 'Quote for NQ1 Index' })).toBeVisible()
  })

  test('NQ GIP 2011-01-20 opens the intraday chart with its [GATED] flag', async ({ page }) => {
    await page.goto('/')
    // The command waits for the HOME layout: a line run before the workspace loads it is replaced by it.
    await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
    await run(page, 'NQ GIP 2011-01-20')
    const panel = page.locator('[data-nqt-title="NQ GIP 2011-01-20"]')
    await expect(panel.locator('[data-screen="GIP"]')).toBeVisible()
    await expect(panel.getByRole('group', { name: 'Session flags' })).toContainText('[GATED]')
  })
})
