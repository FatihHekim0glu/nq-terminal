// DES E2E (TASKS 6.2; UI_SPEC sections 6 and 7 "DES"; look spec 7.3 and 8.5). Against the fixture-mode
// backend (playwright.config.ts), whose registry holds overnight_v0 (PASS) and volmanaged_v0 (FAIL, with
// sealed files):
// - every registered hypothesis opens, with its pass bar verbatim from the spec;
// - the registered values on screen equal the API's to the displayed precision;
// - volmanaged_v0's dsr check reads "Sharpe difference (m - BH)";
// - the blocks and the cost ladder equal the JSON (the charts' table views);
// - the [SPENT] in-sample against sealed strip shows where a hypothesis has sealed files;
// - axe with the WCAG 2.2 AA tags, no console errors, GET only and no price request; screenshots at both
//   sizes.
// The gallery entries (/__gallery/DesHypothesis, DesSealed, DesInstrument) render the screen in real panel
// chrome. The last block drives the workspace through the command line and needs DES registered in
// src/chrome/WorkspaceScreens.tsx (the merge step). The rebal_v1_confirm [SPENT] view needs a sealed
// confirmation, which the fixture folder does not hold; src/screens/des/DesScreen.test.tsx covers it on
// the real API answers.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery, type GalleryWatch } from './gallery.ts'

const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')
const DSR_LABEL = 'Sharpe difference (m - BH)'

interface PassCheck {
  readonly name: string
  readonly passed: boolean | null
}

interface Card {
  readonly name: string
  readonly registered: boolean
  readonly verdict_badge: string
  readonly n: number | null
  readonly p: number | null
  readonly bh_q: number | null
  readonly bonferroni_p: number | null
  readonly spec_sha256: string
  readonly sealed: string[]
  readonly pass_checks: PassCheck[]
}

interface Detail {
  readonly card: Card
  readonly spec: { readonly pass_bar?: unknown } | null
  readonly des: {
    readonly blocks: Array<{ label: string; value: number | null }>
    readonly cost_ladder: Array<{ ticks_per_side: number; value: number }>
  }
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.status(), path).toBe(200)
  return (await response.json()) as T
}

function passBarText(detail: Detail): string {
  const bar = detail.spec?.pass_bar
  return typeof bar === 'string' ? bar : JSON.stringify(bar, null, 2)
}

/** The screen's number rule: two decimals from 1 up, else two significant figures. */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

function decimalsFor(values: ReadonlyArray<number | null>): number {
  const largest = values.reduce<number>((m, v) => (typeof v === 'number' ? Math.max(m, Math.abs(v)) : m), 0)
  if (largest === 0 || largest >= 1) return 2
  return Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(largest))))
}

async function chartsReady(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

function expectNoPriceRequest(watch: GalleryWatch): void {
  expect(watch.requests.filter((r) => new URL(r.url()).pathname === '/api/bars').map((r) => r.url())).toEqual([])
}

const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name })

test.describe('DES gallery (fixture backend)', () => {
  test('overnight_v0: registration line, pass bar verbatim and values equal to the API', async ({ page }) => {
    const watch = await watchGallery(page)
    await page.clock.setFixedTime(FROZEN_NOW)
    const main = await openGallery(page, 'DesHypothesis')
    const detail = await apiJson<Detail>(page, '/api/hypotheses/overnight_v0')
    await expect(main.getByRole('heading', { name: 'overnight_v0', level: 3 })).toBeVisible()
    const head = main.getByTestId('des-head')
    await expect(head).toContainText(`[${detail.card.verdict_badge}]`)
    await expect(head).toContainText('[PRE-REG]')
    await expect(head).toContainText(`spec ${detail.card.spec_sha256.slice(0, 4)}...${detail.card.spec_sha256.slice(-4)}`)
    expect(await main.getByTestId('des-passbar').textContent()).toBe(passBarText(detail))
    const kpis = main.getByRole('list', { name: 'Registered test values' })
    // Counts group thousands on every tile (2,825), as on the grids and text lines.
    await expect(kpis.getByRole('button', { name: /^n / })).toContainText(String(detail.card.n).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    await expect(kpis.getByRole('button', { name: /^p / })).toContainText(fixed(detail.card.p ?? Number.NaN, 4))
    await expect(kpis.getByRole('button', { name: /^BH q / })).toContainText(fixed(detail.card.bh_q ?? Number.NaN, 4))
    const ladder = main.getByRole('region', { name: 'Cost ladder' })
    const d = decimalsFor(detail.des.cost_ladder.map((r) => r.value))
    for (const rung of detail.des.cost_ladder) await expect(ladder).toContainText(`${rung.value > 0 ? '+' : ''}${fixed(rung.value, d)}`)
    await chartsReady(page)
    await expectGalleryClean(page, watch)
    expectNoPriceRequest(watch)
  })

  test('volmanaged_v0: the dsr check is the Sharpe difference, and the [SPENT] strip shows', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'DesSealed')
    const detail = await apiJson<Detail>(page, '/api/hypotheses/volmanaged_v0')
    const strip = main.getByTestId('des-spent')
    await expect(strip).toContainText('[SPENT]')
    for (const name of detail.card.sealed) await expect(strip).toContainText(name)
    await tab(page, '2) Pass checks').click()
    const checks = main.getByRole('table', { name: /Pass checks of volmanaged_v0/ })
    await expect(checks.getByRole('row')).toHaveCount(detail.card.pass_checks.length + 1)
    await expect(checks.getByRole('cell', { name: `${DSR_LABEL} 2tick > 0` })).toBeVisible()
    await expectGalleryClean(page, watch)
  })

  test('volmanaged_v0: blocks and cost ladder equal the JSON in the table views', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'DesSealed')
    const detail = await apiJson<Detail>(page, '/api/hypotheses/volmanaged_v0')
    await tab(page, '3) Costs and blocks').click()
    await chartsReady(page)
    for (const [box, values] of [
      ['Cost ladder', detail.des.cost_ladder.map((r) => r.value)],
      ['volmanaged_v0 blocks', detail.des.blocks.map((b) => b.value)],
    ] as const) {
      const region = main.getByRole('region', { name: box, exact: true })
      await region.getByRole('button', { name: /Table/ }).click()
      const d = decimalsFor(values)
      for (const v of values) await expect(region.getByRole('table')).toContainText(fixed(v ?? Number.NaN, d).replace(/^-/, ''))
    }
    await expectGalleryClean(page, watch)
    expectNoPriceRequest(watch)
  })

  test('NQ1 Index: the instrument description lists the served series, the quote header and a daily chart to the fence', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'DesInstrument')
    await expect(main.getByRole('heading', { name: 'NQ1 Index', level: 3 })).toBeVisible()
    // Phase 8: the page is four tabs from GET /api/instruments/NQ; the served series are on 2) Coverage.
    await expect(main.getByRole('region', { name: 'Contract specifications' })).toBeVisible()
    await chartsReady(page)
    await expect(main.getByRole('img', { name: /^NQ1 Index/ })).toBeVisible()
    await expect(page.locator('.quote-line').first()).toContainText('NQ1 Index')
    await expectGalleryClean(page, watch)
    await main.getByRole('tab', { name: '2) Coverage' }).click()
    await expect(main.getByRole('table', { name: /Processed price series of NQ1 Index/ })).toBeVisible()
    // One read of daily vendor bars through the gate, ending at the fence: nothing after 2021-12-31.
    const bars = watch.requests.filter((r) => new URL(r.url()).pathname === '/api/bars').map((r) => new URL(r.url()))
    expect(bars.length).toBeGreaterThan(0)
    for (const url of bars) {
      expect(url.searchParams.get('timeframe')).toBe('1d')
      expect(url.searchParams.get('end')).toBeNull()
      expect(decodeURIComponent(url.search)).not.toMatch(/20(2[2-9]|[3-9]\d)-/)
    }
  })

  test('screenshots at 1920x1080 and 1366x768', async ({ page }) => {
    await page.clock.setFixedTime(FROZEN_NOW)
    await screenshotGallery(page, 'DesHypothesis', { prepare: async (p) => chartsReady(p) })
    await screenshotGallery(page, 'DesSealed', { prepare: async (p) => chartsReady(p) })
  })
})

test.describe('DES in the workspace (registered screen)', () => {
  const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })

  async function run(page: Page, line: string): Promise<void> {
    await page.keyboard.press('Control+k')
    await commandLine(page).fill(line)
    await commandLine(page).press('Enter')
    await expect(commandLine(page)).toHaveValue('')
  }

  test('every registered hypothesis opens DES with its pass bar verbatim', async ({ page }) => {
    const watch = await watchGallery(page)
    await page.goto('/')
    // Commands wait for the HOME layout: a line run before the workspace loads it is replaced by it.
    await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
    const cards = await apiJson<Card[]>(page, '/api/hypotheses')
    const registered = cards.filter((c) => c.registered)
    expect(registered.length).toBeGreaterThan(0)
    for (const card of registered) {
      await run(page, `${card.name} DES`)
      const panel = page.locator(`[data-nqt-title="${card.name} DES"]`)
      await expect(panel.getByRole('heading', { name: card.name, level: 3 })).toBeVisible()
      await expect(panel.locator('[data-placeholder]')).toHaveCount(0)
      const detail = await apiJson<Detail>(page, `/api/hypotheses/${card.name}`)
      expect(await panel.getByTestId('des-passbar').textContent()).toBe(passBarText(detail))
    }
    await expectGalleryClean(page, watch)
    expectNoPriceRequest(watch)
  })
})
