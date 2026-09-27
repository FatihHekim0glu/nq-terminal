// MON and CORR E2E (TASKS 7.2; UI_SPEC 7 "MON and CORR"; look spec 7.7 and 7.8). Runs against the
// fixture-mode backend (playwright.config.ts), whose fake serve gives all 27 universe series to 2021-12-31.
// - MON: 27 futures by sector, every value on screen equal to /api/market/universe at the displayed
//   precision, the API's post hoc label verbatim, 19 whole grid rows in a HOME-sized panel;
// - CORR: the matrix in the API's clustered order (read through the chart's table view), the rolling
//   pair panel a LineStack whose last value is the API's, no served point past 2021-12-31;
// - axe WCAG 2.2 AA clean, no console errors, every request a same-origin GET; screenshots at 1920x1080
//   and 1366x768.
// The gallery entries (MonScreen, MonHome, CorrScreen) show each screen in its panel chrome before the
// merge step registers it with the workspace; the "in the workspace" block runs once it is registered.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { AXE_TAGS, expectGalleryClean, openGallery, screenshotGallery, watchGallery, type GalleryWatch } from './gallery.ts'

interface UniverseRow {
  readonly symbol: string
  readonly root: string
  readonly sector: string
  readonly last_close: number | null
  readonly returns: Record<string, number | null>
  readonly vol_normalised: Record<string, number | null>
  readonly realised_vol: number | null
  readonly corr_to_nq: number | null
}

interface Correlation {
  readonly sessions: number | null
  readonly symbols: string[]
  readonly order: number[]
  readonly matrix: (number | null)[][]
}

interface Universe {
  readonly as_of: string
  readonly window: number
  readonly label: string
  readonly basis: string
  readonly horizons: string[]
  readonly rows: UniverseRow[]
  readonly correlation_window: Correlation
  readonly correlation_full: Correlation
  readonly missing: string[]
}

interface PairSeries {
  readonly t: number[]
  readonly date: string[]
  readonly corr: (number | null)[]
}

const FENCE_T = Date.UTC(2022, 0, 1) / 1000
const SECTORS = ['Equity', 'Rates', 'FX', 'Energy', 'Metals', 'Grains', 'Livestock']
const MIN_ROWS = 19
const MISSING = '--'

/** The screens' number formats: fixed decimals, explicit + on signed values, `-0.00` never shown. */
function fixed(v: number, d: number): string {
  const text = v.toFixed(d)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}
function signedText(v: number | null, d: number): string {
  if (v === null || !Number.isFinite(v)) return MISSING
  const text = fixed(v, d)
  return v > 0 && Number(text) !== 0 ? `+${text}` : text
}
const pct = (v: number | null): string => (v === null ? MISSING : `${signedText(v * 100, 2)}%`)
const vol = (v: number | null): string => (v === null ? MISSING : `${fixed(v * 100, 1)}%`)
const root = (symbol: string): string => symbol.split('.')[0] ?? symbol

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.ok(), path).toBe(true)
  return (await response.json()) as T
}

function expectGetOnly(page: Page, watch: GalleryWatch): void {
  const origin = new URL(page.url()).origin
  const bad = watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(origin))
  expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

/** Every data row of the grid as its cell texts, keyed by ticker root (the Number <GO> label). */
async function monCells(grid: Locator): Promise<Map<string, string[]>> {
  const rows = await grid.locator('tbody tr[role="row"]:not(.group-row)').evaluateAll((trs) =>
    trs.map((r) => Array.from(r.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  )
  // Cells: number, ticker, name, last, flag, six horizons, RV, rho, units.
  return new Map(rows.map((cells) => [cells[1] ?? '', cells]))
}

function tickerFor(rowRoot: string, sector: string): string {
  const generic: Record<string, string> = {
    NQ: 'NQ1', ES: 'ES1', YM: 'DM1', ZN: 'TY1', ZB: 'US1', ZT: 'TU1', ZF: 'FV1', '6E': 'EC1', '6J': 'JY1', '6B': 'BP1',
    '6A': 'AD1', '6C': 'CD1', '6S': 'SF1', RB: 'XB1', ZC: 'C 1', ZS: 'S 1', ZW: 'W 1', ZL: 'BO1', ZM: 'SM1', LE: 'LC1', HE: 'LH1',
  }
  const suffix = sector === 'equity' ? 'Index' : sector === 'fx' ? 'Curncy' : 'Comdty'
  return `${generic[rowRoot] ?? `${rowRoot}1`} ${suffix}`
}

async function expectMonMatchesApi(page: Page, scope: Locator): Promise<void> {
  const u = await apiJson<Universe>(page, '/api/market/universe?window=252')
  expect(u.rows).toHaveLength(27)
  expect(u.as_of).toBe('2021-12-31')
  const grid = scope.getByRole('grid', { name: /Futures monitor/ })
  await expect(grid).toBeVisible()
  const sections = await grid.locator('tbody tr.group-row').allTextContents()
  expect(sections.map((s) => s.replace(/^\d+\)\s*/, '').trim())).toEqual(SECTORS)
  const cells = await monCells(grid)
  expect(cells.size).toBe(27)
  for (const row of u.rows) {
    const shown = cells.get(tickerFor(row.root, row.sector))
    expect(shown, row.symbol).toBeDefined()
    const horizons = u.horizons.map((h) => pct(row.returns[h] ?? null))
    expect(shown!.slice(5, 11), row.symbol).toEqual(horizons)
    expect(shown![11], `${row.symbol} RV`).toBe(vol(row.realised_vol))
    expect(shown![12], `${row.symbol} rho`).toBe(signedText(row.corr_to_nq, 2))
  }
  expect(cells.get('NQ1 Index')![3]).toBe(fixed(u.rows.find((r) => r.root === 'NQ')!.last_close!, 2))
  await expect(scope.getByText(u.label, { exact: true }).first()).toBeAttached()
  await expect(scope.getByText(`Basis: ${u.basis}`, { exact: true })).toBeAttached()
}

/** In the workspace: axe over this screen's panel only, no console errors, every request a same-origin GET. */
async function expectPanelClean(page: Page, watch: GalleryWatch, selector: string): Promise<void> {
  const result = await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  expect(watch.errors).toEqual([])
  expectGetOnly(page, watch)
}

async function readyCharts(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

test.describe('MON and CORR (gallery panels)', () => {
  test('MON: 27 futures by sector, every value equal to the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'MonScreen')
    await expectMonMatchesApi(page, main)
    // The vol-normalised view prints the API's sd values.
    const u = await apiJson<Universe>(page, '/api/market/universe?window=252')
    await main.getByRole('checkbox', { name: 'Vol-normalised' }).check()
    const cells = await monCells(main.getByRole('grid', { name: /Futures monitor/ }))
    const nq = u.rows.find((r) => r.root === 'NQ')!
    expect(cells.get('NQ1 Index')!.slice(5, 11)).toEqual(u.horizons.map((h) => signedText(nq.vol_normalised[h] ?? null, 2)))
    await expectGalleryClean(page, watch)
  })

  test('MON: Enter on a row opens its functions, which dim only the panel', async ({ page }) => {
    const main = await openGallery(page, 'MonScreen')
    const grid = main.getByRole('grid', { name: /Futures monitor/ })
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    const dialog = main.getByRole('dialog', { name: 'Functions for NQ1 Index' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('menuitem')).toHaveText(['1) GP Candle chart', '2) GIP Intraday chart', '3) DES Instrument description', '4) CORR Correlation matrix'])
    await expect(dialog.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(grid).toBeFocused()
  })

  test(`MON in a HOME-sized panel shows at least ${MIN_ROWS} whole 20px rows (look spec 7 row budget)`, async ({ page }) => {
    const main = await openGallery(page, 'MonHome')
    // Wait for the rows (the universe loads after the frame): the measure needs at least 20 of them.
    await expect(main.locator('.nqt-panel tbody tr').nth(MIN_ROWS)).toBeAttached()
    const counts = await main.locator('.nqt-panel').evaluate((el) => {
      const body = el.querySelector('.nqt-panel-body') as HTMLElement
      const box = body.getBoundingClientRect()
      const head = body.querySelector('thead')?.getBoundingClientRect()
      const top = head ? head.bottom : box.top
      const rows = Array.from(body.querySelectorAll('tbody tr')).map((r) => r.getBoundingClientRect())
      return {
        whole: rows.filter((r) => r.top >= top - 0.5 && r.bottom <= box.bottom + 0.5).length,
        pitch: rows[1] && rows[0] ? rows[1].top - rows[0].top : 0,
      }
    })
    expect(counts.pitch).toBeCloseTo(20, 0)
    expect(counts.whole).toBeGreaterThanOrEqual(MIN_ROWS)
    // The parameter row folds away in a short panel; its settings stay in 97) Settings.
    await expect(main.locator('.mon-params')).toBeHidden()
    await expect(main.getByRole('button', { name: /97\) Settings/ })).toBeVisible()
  })

  test('CORR: the matrix in the API cluster order and the rolling pair from the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'CorrScreen')
    await readyCharts(page)
    const u = await apiJson<Universe>(page, '/api/market/universe?window=252')
    const block = u.correlation_window
    const labels = block.order.map((i) => root(block.symbols[i]!))
    const matrix = main.getByRole('img', { name: /^27F correlation, last 252 sessions, clustered order: 27 rows by 27 columns/ })
    await expect(matrix).toBeVisible()
    // The table view holds the same numbers, in the same order.
    const figure = main.locator('.corr-matrix')
    await figure.getByRole('button', { name: 'Table' }).click()
    const table = figure.getByRole('table')
    const headers = await table.locator('thead th').allTextContents()
    expect(headers.slice(1).map((h) => h.trim())).toEqual(labels)
    const first = await table.locator('tbody tr').first().locator('td, th').allTextContents()
    const i0 = block.order[0]!
    expect(first.slice(1).map((c) => c.trim())).toEqual(block.order.map((j) => signedText(block.matrix[i0]![j] ?? null, 2).replace(MISSING, '')))
    await figure.getByRole('button', { name: 'Table' }).click()

    const pair = await apiJson<PairSeries>(page, '/api/market/pair-corr?a=NQ.V.0&b=ZN.V.0&window=252')
    expect(pair.t.every((t) => t < FENCE_T)).toBe(true)
    let k = pair.corr.length - 1
    while (k >= 0 && pair.corr[k] === null) k -= 1
    const last = pair.corr[k]!
    await expect(main.getByRole('img', { name: /Rolling correlation NQ vs ZN/ })).toBeVisible()
    await expect(main.getByText(new RegExp(`^Last rolling value ${signedText(last, 2).replace('+', '\\+')} on ${pair.date[k]}`))).toBeVisible()
    // The pair's last value is the matrix entry for the same window (the backend's own check).
    const a = block.symbols.indexOf('NQ.V.0')
    const b = block.symbols.indexOf('ZN.V.0')
    expect(signedText(block.matrix[a]![b] ?? null, 2)).toBe(signedText(last, 2))
    await expect(main.getByText(u.label, { exact: true }).first()).toBeAttached()
    expectGetOnly(page, watch)
    await expectGalleryClean(page, watch)
  })

  test('CORR: the full-sample matrix uses its own cluster order', async ({ page }) => {
    const main = await openGallery(page, 'CorrScreen')
    await readyCharts(page)
    await main.getByRole('button', { name: 'Full sample' }).click()
    await expect(main.getByRole('img', { name: /^27F correlation, full sample to 2021-12-31, clustered order/ })).toBeVisible()
    await main.getByRole('button', { name: 'By sector' }).click()
    await expect(main.getByRole('img', { name: /full sample to 2021-12-31, sector order/ })).toBeVisible()
  })

  test('screenshots of MON and CORR at 1920x1080 and 1366x768', async ({ page }) => {
    // The gate line counts this process's reads, which depend on what ran before: masked.
    const mask = [page.locator('.mkt-gate')]
    await screenshotGallery(page, 'MonScreen', { mask })
    await screenshotGallery(page, 'MonHome', { mask })
    await screenshotGallery(page, 'CorrScreen', { mask, prepare: async (p) => readyCharts(p) })
  })
})

test.describe('MON and CORR in the workspace', () => {
  const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
  const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

  async function run(page: Page, line: string): Promise<void> {
    await page.keyboard.press('Control+k')
    await commandLine(page).fill(line)
    await commandLine(page).press('Enter')
  }

  test('HOME MON shows the API values; Enter then 1 opens GP for the row in that panel', async ({ page }) => {
    const watch = await watchGallery(page)
    await page.goto('/')
    const mon = page.locator('[data-nqt-panel="home-mon"]')
    await expect(mon).toHaveAttribute('data-nqt-title', '27F MON')
    await expect(mon.getByRole('grid', { name: /Futures monitor/ })).toBeVisible()
    await expectMonMatchesApi(page, mon)
    const grid = mon.getByRole('grid', { name: /Futures monitor/ })
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(mon.getByRole('dialog', { name: 'Functions for NQ1 Index' })).toBeVisible()
    await expectPanelClean(page, watch, '[data-nqt-panel="home-mon"]')
    await run(page, '1')
    await expect(mon).toHaveAttribute('data-nqt-title', /^NQ GP/)
    expectGetOnly(page, watch)
  })

  test('HOME keeps 19 whole MON rows in its 2x2 panel', async ({ page }) => {
    await page.goto('/')
    const mon = page.locator('[data-nqt-panel="home-mon"]')
    await expect(mon.getByRole('grid', { name: /Futures monitor/ })).toBeVisible()
    const whole = await mon.evaluate((el) => {
      const body = el.querySelector('.nqt-panel-body') as HTMLElement
      const box = body.getBoundingClientRect()
      const top = body.querySelector('thead')?.getBoundingClientRect().bottom ?? box.top
      return Array.from(body.querySelectorAll('tbody tr'))
        .map((r) => r.getBoundingClientRect())
        .filter((r) => r.top >= top - 0.5 && r.bottom <= box.bottom + 0.5).length
    })
    expect(whole).toBeGreaterThanOrEqual(MIN_ROWS)
  })

  test('27F CORR draws the matrix and the pair panel in its link group', async ({ page }) => {
    const watch = await watchGallery(page)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    await run(page, '27F CORR')
    const corr = panel(page, '27F CORR')
    await expect(corr.getByRole('img', { name: /^27F correlation, last 252 sessions, clustered order/ })).toBeVisible()
    await expect(corr.getByRole('img', { name: /Rolling correlation NQ vs ZN/ })).toBeVisible()
    await readyCharts(page)
    const id = await corr.getAttribute('data-nqt-panel')
    await expectPanelClean(page, watch, `[data-nqt-panel="${id}"]`)
  })
})
