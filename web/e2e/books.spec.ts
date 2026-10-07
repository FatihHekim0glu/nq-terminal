// COST, BLK, EXPO and SEAL as their own screens (TASKS 9.4) in the real app on the fixture backend:
// - BLK and COST for a hypothesis print exactly what DES prints in its ladders' table views, and both
//   equal the screen JSON the API serves;
// - COST for a run equals GET /api/analytics/run/{id}/costs (by instrument and every sensitivity rung);
// - EXPO equals GET /api/analytics/run/{id}/exposure (the means and the newest session), and a run with
//   no snapshots says why;
// - SEAL lists the card's sealed files, spent, and shows a served CSV through the allowlist cell for cell;
// - every screen is axe clean (WCAG 2.2 AA), logs no console error and sends only GETs; each has
//   baselines at 1920x1080 and 1366x768.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { AXE_TAGS, MASK_COLOR } from './gallery.ts'
import { expectWatchSegment } from './watchReady.ts'

const RUN = 'nt_dtsmom_v0_fixture_ts1'
const INTRADAY_RUN = 'nt_overnight_v0_fixture_open'
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }] as const

interface Detail {
  readonly card: { readonly name: string; readonly sealed: string[] }
  readonly des: {
    readonly blocks: Array<{ label: string; value: number | null }>
    readonly cost_ladder: Array<{ ticks_per_side: number; value: number }>
  }
}

interface Watch {
  readonly errors: string[]
  readonly requests: Request[]
}

async function startApp(page: Page): Promise<Watch> {
  const watch: Watch = { errors: [], requests: [] }
  page.on('console', (m) => { if (m.type() === 'error') watch.errors.push(m.text()) })
  page.on('pageerror', (e) => watch.errors.push(String(e)))
  page.on('request', (r) => watch.requests.push(r))
  // A line typed before the command index arrives is refused ("has not loaded yet"), as it should be; under a
  // loaded full run the index can land after the four panels, so the spec waits for it before typing.
  const index = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/commands' && r.ok())
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
  await index
  return watch
}

async function openLine(page: Page, line: string): Promise<Locator> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Command line' })
  await box.fill(line)
  // As in p11.spec.ts: the index response arriving is not the index reaching the page. The <GO> preview shows only once it
  // has, and an Enter pressed in between is refused ("has not loaded yet") and leaves the text in the box.
  await expect(page.locator('.cmd-preview')).toContainText('<GO>')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const panel = page.locator(`[data-nqt-title="${line}"]`)
  await expect(panel).toHaveCount(1)
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0)
  return panel
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.status(), path).toBe(200)
  return (await response.json()) as T
}

/** The screen's number rule (look spec 3.4): two decimals from 1 up, else two significant figures, signed. */
function signedFixed(value: number, values: ReadonlyArray<number | null>): string {
  const largest = values.reduce<number>((m, v) => (typeof v === 'number' ? Math.max(m, Math.abs(v)) : m), 0)
  const d = largest === 0 || largest >= 1 ? 2 : Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(largest))))
  const text = value.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return value > 0 && !/^[0.,]+$/.test(text) ? `+${text}` : text
}

/** Two significant figures below 1, two decimals from 1 up (the DES number rule). */
function sig(value: number): string {
  const a = Math.abs(value)
  const d = a === 0 || a >= 1 ? 2 : Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(a))))
  return value.toFixed(d)
}

const money = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function column(table: Locator, index: number): Promise<string[]> {
  await expect(table.locator('tbody tr').first()).toBeVisible()
  return table.locator('tbody tr').evaluateAll((rows, i) => rows.map((r) => (r.children[i] as HTMLElement | undefined)?.textContent ?? ''), index)
}

/** DES's own table view of one ladder (3) Costs and blocks, then Table), value column. */
async function desLadderValues(page: Page, hypothesis: string, region: string): Promise<string[]> {
  const des = await openLine(page, `${hypothesis} DES`)
  await des.getByRole('tab', { name: '3) Costs and blocks' }).click()
  const box = des.getByRole('region', { name: region, exact: true })
  await box.getByRole('button', { name: /Table/ }).click()
  return column(box.getByRole('table'), 1)
}

async function expectClean(page: Page, watch: Watch): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  expect(watch.errors).toEqual([])
  expect(watch.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

test.describe('BLK and COST for a hypothesis equal DES and the API', () => {
  test('volmanaged_v0 BLK: the blocks as DES prints them, equal to the screen JSON', async ({ page }) => {
    const watch = await startApp(page)
    const detail = await apiJson<Detail>(page, '/api/hypotheses/volmanaged_v0')
    const values = detail.des.blocks.map((b) => b.value)
    const fromDes = await desLadderValues(page, 'volmanaged_v0', 'volmanaged_v0 blocks')
    const blk = await openLine(page, 'volmanaged_v0 BLK')
    const table = blk.getByTestId('blk-table')
    expect(await column(table, 1)).toEqual(detail.des.blocks.map((b) => b.label))
    expect(await column(table, 2)).toEqual(fromDes)
    expect(await column(table, 2)).toEqual(values.map((v) => signedFixed(v ?? Number.NaN, values)))
    expect(await column(table, 0)).toEqual(values.map((_, i) => `${i + 1})`))
    await expect(blk.getByTestId('books-head')).toContainText('[PRE-REG]')
    await expectClean(page, watch)
  })

  test('volmanaged_v0 COST: the cost ladder and break-even as DES prints them, equal to the screen JSON', async ({ page }) => {
    const watch = await startApp(page)
    const detail = await apiJson<Detail>(page, '/api/hypotheses/volmanaged_v0')
    const values = detail.des.cost_ladder.map((r) => r.value)
    const fromDes = await desLadderValues(page, 'volmanaged_v0', 'Cost ladder')
    const des = page.locator('[data-nqt-title="volmanaged_v0 DES"]')
    const breakEven = (await des.getByRole('region', { name: 'Cost ladder', exact: true }).locator('.des-note').allTextContents()).find((t) => /break-even/i.test(t))
    const cost = await openLine(page, 'volmanaged_v0 COST')
    const table = cost.getByTestId('cost-ladder-table')
    expect(await column(table, 2)).toEqual(fromDes)
    expect(await column(table, 2)).toEqual(values.map((v) => signedFixed(v, values)))
    await expect(cost.getByTestId('cost-break-even')).toHaveText(breakEven ?? 'missing')
    await expectClean(page, watch)
  })
})

interface RunCosts {
  readonly waterfall: { readonly net: number; readonly by_instrument: Array<{ instrument: string; sides: number; commissions: number; slippage: number }> }
  readonly sensitivity: { readonly ticks: number[]; readonly net_usd: number[]; readonly run_ticks: number }
}

interface RunExposure {
  readonly available: boolean
  readonly note: string | null
  readonly exposure: { readonly date: string[]; readonly gross: Array<number | null>; readonly net: Array<number | null>; readonly mean_gross: number; readonly mean_net: number } | null
  readonly turnover: { readonly mean_daily: number; readonly annualised: number } | null
}

test.describe('COST and EXPO for a run equal the API', () => {
  test(`${RUN} COST: costs by instrument and every sensitivity rung`, async ({ page }) => {
    const watch = await startApp(page)
    const api = await apiJson<RunCosts>(page, `/api/analytics/run/${RUN}/costs`)
    const cost = await openLine(page, `${RUN} COST`)
    const byInstrument = cost.getByTestId('cost-by-instrument')
    expect(await column(byInstrument, 0)).toEqual(api.waterfall.by_instrument.map((r) => r.instrument))
    expect(await column(byInstrument, 1)).toEqual(api.waterfall.by_instrument.map((r) => r.sides.toLocaleString('en-GB')))
    expect(await column(byInstrument, 2)).toEqual(api.waterfall.by_instrument.map((r) => money(r.commissions)))
    expect(await column(byInstrument, 3)).toEqual(api.waterfall.by_instrument.map((r) => money(r.slippage)))
    const sensitivity = cost.getByTestId('cost-sensitivity')
    expect(await column(sensitivity, 1)).toEqual(api.sensitivity.net_usd.map(money))
    const charged = api.sensitivity.ticks.indexOf(api.sensitivity.run_ticks)
    await expect(sensitivity.locator('tr.charged-row')).toContainText(money(api.waterfall.net))
    expect(api.sensitivity.net_usd[charged]).toBeCloseTo(api.waterfall.net, 6)
    await expectClean(page, watch)
  })

  test(`${RUN} EXPO: the API means and the newest session; an intraday run says why it has none`, async ({ page }) => {
    const watch = await startApp(page)
    const api = await apiJson<RunExposure>(page, `/api/analytics/run/${RUN}/exposure`)
    const expo = await openLine(page, `${RUN} EXPO`)
    const summary = expo.getByTestId('expo-summary')
    await expect(summary.locator('tr[data-row="meanGross"] td')).toHaveText(sig(api.exposure?.mean_gross ?? Number.NaN))
    await expect(summary.locator('tr[data-row="meanNet"] td')).toHaveText(sig(api.exposure?.mean_net ?? Number.NaN))
    await expect(summary.locator('tr[data-row="annualTurnover"] td')).toHaveText(sig(api.turnover?.annualised ?? Number.NaN))
    const grid = expo.getByRole('grid', { name: new RegExp(`^Exposure and turnover of ${RUN} per session`) })
    const newest = (api.exposure?.date.length ?? 0) - 1
    const first = grid.getByRole('row').nth(1)
    await expect(first).toContainText(api.exposure?.date[newest] ?? 'missing')
    await expect(first).toContainText((api.exposure?.gross[newest] ?? Number.NaN).toFixed(4))
    await expectClean(page, watch)

    const none = await apiJson<RunExposure>(page, `/api/analytics/run/${INTRADAY_RUN}/exposure`)
    expect(none.available).toBe(false)
    const intraday = await openLine(page, `${INTRADAY_RUN} EXPO`)
    await expect(intraday.getByText(none.note ?? 'missing').first()).toBeVisible()
    await expect(intraday.getByTestId('expo-summary')).toHaveCount(0)
  })
})

const SPENT = 'spent window, opened 2026-09-26, descriptive only'
const DAILY = {
  name: 'volmanaged_oos_daily', kind: 'csv', label: SPENT, markdown: null, data: null,
  columns: ['date', 'variant', 'c', 'r_m_0'], n_rows: 2,
  values: { date: ['2022-01-03', '2022-01-04'], variant: ['A', 'A'], c: [0.61, 0.62], r_m_0: [0.0012, -0.0031] },
}

test.describe('SEAL', () => {
  test('volmanaged_v0 SEAL: the card files, spent; a served CSV shows cell for cell through the allowlist', async ({ page }) => {
    // The fixture holds no sealed files, so the index and one CSV view are answered in the page, in the
    // API's shape (backend tests cover the allowlist itself).
    await page.route('**/api/sealed', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ name: DAILY.name, kind: 'csv', label: SPENT }]) }))
    await page.route(`**/api/sealed/${DAILY.name}`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(DAILY) }))
    const watch = await startApp(page)
    const detail = await apiJson<Detail>(page, '/api/hypotheses/volmanaged_v0')
    const seal = await openLine(page, 'volmanaged_v0 SEAL')
    const files = seal.getByTestId('seal-files')
    await expect(files.locator('tbody tr')).toHaveCount(detail.card.sealed.length)
    expect(await column(files, 1)).toEqual(detail.card.sealed)
    await expect(seal.getByTestId('seal-spent')).toContainText('[SPENT]')
    await expect(files).toContainText('not served')
    // Number <GO> opens the served file.
    const n = detail.card.sealed.indexOf(DAILY.name) + 1
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Command line' }).fill(String(n))
    await page.keyboard.press('Enter')
    const csv = seal.getByTestId('seal-csv')
    await expect(csv).toBeVisible()
    expect(await csv.locator('thead th').allTextContents()).toEqual(DAILY.columns)
    expect(await column(csv, 3)).toEqual(DAILY.values.r_m_0.map(String))
    await expect(seal.getByTestId('seal-file')).toContainText(SPENT)
    await expectClean(page, watch)
  })
})

const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')

async function settle(page: Page): Promise<void> {
  // The screen chunk loads lazily ("Loading this screen." until then), then its API reads.
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

test.describe('screenshots', () => {
  const shots = [
    { name: 'cost', line: 'volmanaged_v0 COST' },
    { name: 'cost-run', line: `${RUN} COST` },
    { name: 'blk', line: 'volmanaged_v0 BLK' },
    { name: 'expo', line: `${RUN} EXPO` },
    { name: 'seal', line: 'volmanaged_v0 SEAL' },
  ] as const
  for (const size of SIZES) {
    for (const shot of shots) {
      test(`${shot.name} ${size.width}x${size.height}`, async ({ page }) => {
        await page.clock.setFixedTime(FROZEN_NOW)
        await page.setViewportSize(size)
        await startApp(page)
        await openLine(page, shot.line)
        await settle(page)
        await page.mouse.move(0, 0)
        await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
        await expectWatchSegment(page)
        // The gate read count depends on what ran before in this backend process: masked.
        const gate = page.getByRole('contentinfo').locator('.seg', { hasText: /^Gate reads/ })
        await expect(page).toHaveScreenshot(`${shot.name}-${size.width}x${size.height}.png`, { mask: [gate], maskColor: MASK_COLOR })
      })
    }
  }
})
