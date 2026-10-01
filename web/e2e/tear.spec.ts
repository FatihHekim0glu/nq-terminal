// Analytics tear sheet E2E (TASKS 6.4; UI_SPEC 7 "Analytics tear sheet"; look spec 7.5). Runs against
// the fixture-mode backend (playwright.config.ts). The gallery entries /__gallery/TearSheet.run,
// .hypothesis and .unusable render the screen in a panel on real fixture responses:
// - every KPI tile equals the API value at the displayed precision and names its basis and unit;
// - the five tabs switch the red-bar title and draw their charts; DD, RET and MRET values match the API;
// - a run's trade panels appear only because it has trades; costs and exposure follow the API;
// - a hypothesis shows its stored alpha as [PRE-REG] and asks for no run books;
// - an unusable run reads [UNUSABLE: BALANCE] and draws nothing;
// - axe WCAG 2.2 AA clean, no console errors, every request a same-origin GET, no price request;
// - screenshots at 1920x1080 and 1366x768.
// The last test opens EQ from the command line in the workspace, once the screen is registered there.
// A check row (a check inside another spec, no return series of its own) reaches an empty state that links
// to its parent's tear sheet on every tab, never an endless load.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'
import { dismissOrientation } from './orientation.ts'

// The bare HOME frame is measured here: start as a viewer who has dismissed the first-run orientation line (e2e/orientation.ts).
test.beforeEach(async ({ page }) => {
  await dismissOrientation(page)
})

const RUN = 'nt_za_v0_fixture_a'
const HYP = 'volmanaged_v0'

interface Kpi {
  readonly key: string
  readonly label: string
  readonly value: number | null
  readonly unit: string
  readonly basis: 'A' | 'B'
  readonly tag: string
}

interface Analytics {
  readonly basis: 'A' | 'B'
  readonly basis_label: string
  readonly kpis: Kpi[]
  readonly drawdown: { unit: string; max_drawdown: number | null }
  readonly drawdown_table: Array<{ depth: number; trough: string }>
  readonly distribution: { stats: { n: number; skew: number | null } }
  readonly validity: { psr: { at_zero: number | null } }
  readonly monthly: { years: number[] }
}

interface Trades {
  readonly stats: { n: number; win_rate: number | null; total_pnl: number | null }
}

interface Costs {
  readonly waterfall: { net: number }
}

// The screen's display rule (src/screens/tear/tearFormat.ts, tearKpis.ts), restated here on purpose:
// a unit starting with "fraction" shows as a percentage; PSR has 3 decimals, MinTRL 0, the rest 2;
// returns and alpha carry an explicit +.
const DECIMALS: Readonly<Record<string, number>> = { psr_0: 3, min_trl: 0 }
const SIGNED = new Set(['total_return', 'cagr', 'alpha_annual'])

function fixed(v: number, d: number): string {
  const text = v.toFixed(d)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

function kpiFace(k: Kpi): string {
  if (k.value === null) return '--'
  const pct = /^fraction\b/.test(k.unit)
  const text = fixed(pct ? k.value * 100 : k.value, DECIMALS[k.key] ?? 2)
  const plus = SIGNED.has(k.key) && Number(text) > 0 ? '+' : ''
  // KPI tiles group thousands (MinTRL 1,234 sessions).
  const [whole = '', frac] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${plus}${frac === undefined ? grouped : `${grouped}.${frac}`}${pct || k.unit.startsWith('%') ? '%' : ''}`
}

const pct2 = (v: number): string => `${fixed(v * 100, 2)}%`
const usd = (v: number): string => `${v > 0 ? '+' : ''}${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} USD`

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.ok(), path).toBe(true)
  return (await response.json()) as T
}

const tile = (main: Locator, label: string): Locator =>
  main.locator('.kpi-tile').filter({ has: main.page().locator('.kpi-label', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }) })

async function settle(main: Locator): Promise<void> {
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function openTab(main: Locator, label: string, title: string): Promise<void> {
  await main.getByRole('tab', { name: label }).click()
  await expect(main.getByRole('toolbar', { name: `${title} functions` })).toBeVisible()
  await settle(main)
}

test.describe('tear sheet of a run', () => {
  test('KPI tiles equal the API and name their basis and unit', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.run')
    await settle(main)
    const api = await apiJson<Analytics>(page, `/api/analytics/run/${RUN}?freq=D`)
    await expect(main.getByRole('list', { name: 'Tear sheet key figures' }).getByRole('listitem')).toHaveCount(api.kpis.length)
    for (const k of api.kpis) {
      await expect(tile(main, k.label).locator('.kpi-value'), k.key).toHaveText(kpiFace(k))
      await expect(tile(main, k.label).locator('.kpi-tag'), k.key).toHaveText(k.tag)
    }
    const sharpe = tile(main, 'Sharpe')
    await sharpe.click()
    await expect(main.locator('.kpi-pop')).toContainText(`Basis ${api.basis}`)
    await expect(main.locator('.kpi-pop')).toContainText(api.kpis.find((k) => k.key === 'sharpe')!.unit)
    await page.keyboard.press('Escape')
    await expect(main.getByText(api.basis_label, { exact: false }).first()).toBeVisible()
    await expectGalleryClean(page, watch)
    expect(watch.requests.filter((r) => r.url().includes('/api/bars'))).toEqual([])
  })

  test('the five tabs switch the title and draw values equal to the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.run')
    await settle(main)
    const api = await apiJson<Analytics>(page, `/api/analytics/run/${RUN}?freq=D`)
    await expect(main.getByRole('toolbar', { name: 'Performance: equity curve functions' })).toBeVisible()
    await expect(main.getByRole('img').first()).toBeVisible()

    await openTab(main, '2) Drawdown', 'Performance: drawdown')
    const dd = main.getByRole('table', { name: /Top drawdowns/ })
    await expect(dd.locator('tbody tr').first().locator('td').nth(4)).toHaveText(pct2(api.drawdown_table[0]!.depth))
    await expect(dd.locator('tbody tr').first().locator('td').nth(2)).toHaveText(api.drawdown_table[0]!.trough)

    await openTab(main, '3) Returns', 'Performance: returns and risk')
    const stats = main.getByRole('table', { name: 'Return statistics' })
    await expect(stats.getByRole('row', { name: /^Observations/ }).locator('td')).toHaveText(new Intl.NumberFormat('en-GB').format(api.distribution.stats.n))
    await expect(stats.getByRole('row', { name: /^PSR \(0\)/ }).locator('td')).toHaveText(fixed(api.validity.psr.at_zero!, 3))
    await expect(stats.getByRole('row', { name: /^Skew/ }).locator('td')).toHaveText(fixed(api.distribution.stats.skew!, 2))

    await openTab(main, '4) Rolling', 'Performance: rolling statistics')
    await expect(main.getByRole('img', { name: /^Sharpe 63 sessions/ })).toBeVisible()

    await openTab(main, '5) Monthly', 'Performance: monthly returns')
    await expect(main.getByRole('img', { name: /monthly returns/ })).toBeVisible()
    await expect(main.getByRole('img', { name: /house addition/ })).toBeVisible()
    // A click on a tab makes that tab the panel's one Tab stop; the scrolling body stays reachable
    // with the arrow keys (roving tabindex), which axe cannot see. Return the stop to the body, as a
    // click in it does, before the scan.
    await main.locator('.tear-basis').first().click()
    await expect(main.getByRole('group', { name: `${RUN} EQ content` })).toHaveAttribute('tabindex', '0')
    await expectGalleryClean(page, watch)
  })

  test('trade, cost and exposure panels follow the API', async ({ page }) => {
    const main = await openGallery(page, 'TearSheet.run')
    await settle(main)
    const trades = await apiJson<Trades>(page, `/api/analytics/run/${RUN}/trades`)
    const costs = await apiJson<Costs>(page, `/api/analytics/run/${RUN}/costs`)
    expect(trades.stats.n).toBeGreaterThan(0)
    const books = main.getByRole('region', { name: `Run books of ${RUN}` })
    const stats = books.getByRole('table', { name: 'Trade statistics' })
    await expect(stats.getByRole('row', { name: /^Trades/ }).locator('td')).toHaveText(String(trades.stats.n))
    await expect(stats.getByRole('row', { name: /^Win rate/ }).locator('td')).toHaveText(pct2(trades.stats.win_rate!))
    await expect(stats.getByRole('row', { name: /^Total P&L/ }).locator('td')).toHaveText(usd(trades.stats.total_pnl!))
    const waterfall = books.getByRole('table', { name: /Cost waterfall/ })
    await expect(waterfall.getByRole('row', { name: /^net/ }).locator('td')).toHaveText(
      new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(costs.waterfall.net),
    )
    await expect(books.getByText(/no mark to market snapshots/)).toBeVisible()
  })

  test('screenshots at both sizes', async ({ page }) => {
    await screenshotGallery(page, 'TearSheet.run', { prepare: async (_p, main) => settle(main) })
  })

  // The hypothesis entry's strategy and benchmark run within a pixel of each other for most of the curve.
  for (const entry of ['TearSheet.run', 'TearSheet.hypothesis']) {
    test(`born failing: ${entry} draws the white strategy line over the benchmark, clear of the legend`, async ({ page }) => {
      const main = await openGallery(page, entry)
      await settle(main)
      const pane = main.locator('[data-pane="equity"]').first()
      const plot = ((await pane.getAttribute('data-plot')) ?? '').split(',').map(Number)
      const legend = await pane.locator('.chart-legend').boundingBox()
      const box = await pane.boundingBox()
      expect(plot).toHaveLength(4)
      expect(legend).not.toBeNull()
      const [left, top, width, height] = plot as [number, number, number, number]
      const probe = await pane.locator('canvas').first().evaluate(
        (canvas: HTMLCanvasElement, a: { left: number; top: number; width: number; height: number; legendRight: number; legendBottom: number }) => {
          const ratio = canvas.width / canvas.getBoundingClientRect().width
          const ctx = canvas.getContext('2d')!
          // The data ends where the 2.5% right padding starts.
          const x0 = Math.round((a.left + 2) * ratio)
          const x1 = Math.round((a.left + a.width / 1.025 - 2) * ratio)
          const y0 = Math.round(a.top * ratio)
          const rows = Math.round(a.height * ratio)
          const img = ctx.getImageData(x0, y0, x1 - x0, rows)
          const cols = x1 - x0
          let withWhite = 0
          let whiteUnderLegend = 0
          for (let c = 0; c < cols; c += 1) {
            let found = false
            for (let r = 0; r < rows; r += 1) {
              const i = (r * cols + c) * 4
              // Mostly white and mostly opaque: a 1.5px line always covers one pixel row by at least 75%. The canvas is
              // transparent, so a window shading painted in white at a low alpha (the stress spans) is not the line.
              if (Math.min(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!) >= 160 && img.data[i + 3]! >= 191) {
                found = true
                const x = (x0 + c) / ratio
                const y = (y0 + r) / ratio
                // The range keeps a 2px gap under the legend.
                if (x < a.legendRight && y < a.legendBottom + 2) whiteUnderLegend += 1
              }
            }
            if (found) withWhite += 1
          }
          return { cols, withWhite, whiteUnderLegend }
        },
        { left, top, width, height, legendRight: legend!.x + legend!.width - box!.x, legendBottom: legend!.y + legend!.height - box!.y },
      )
      expect(probe.withWhite / probe.cols).toBeGreaterThanOrEqual(0.9)
      expect(probe.whiteUnderLegend).toBe(0)
    })
  }
})

test.describe('tear sheet of a hypothesis', () => {
  test('shows the stored alpha as [PRE-REG] at 1 tick and asks for no run books', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.hypothesis')
    await settle(main)
    const api = await apiJson<Analytics>(page, `/api/analytics/hypothesis/${HYP}?cost=1`)
    for (const k of api.kpis) await expect(tile(main, k.label).locator('.kpi-value'), k.key).toHaveText(kpiFace(k))
    const alpha = api.kpis.find((k) => k.key === 'alpha_annual')!
    await expect(tile(main, alpha.label).locator('.kpi-tag')).toHaveText(alpha.tag)
    await expect(main.getByRole('combobox', { name: 'Cost' })).toContainText('1 tick per side')
    expect(watch.requests.some((r) => /\/analytics\/run\//.test(r.url()))).toBe(false)
    await expectGalleryClean(page, watch)
  })
})

test.describe('RR on a series shorter than its window', () => {
  test('each pane states the window and the series length instead of a scale', async ({ page }) => {
    const main = await openGallery(page, 'TearSheet.hypothesis')
    await settle(main)
    const api = await apiJson<{ n: number }>(page, `/api/analytics/hypothesis/${HYP}?cost=1`)
    await openTab(main, '4) Rolling', 'Performance: rolling statistics')
    for (const pane of ['Rolling Sharpe', 'Rolling volatility']) {
      await expect(main.getByRole('region', { name: pane })).toContainText(`Needs 63 sessions; this series has ${api.n}.`)
    }
    await expect(main.getByRole('img', { name: /^Sharpe 63 sessions/ })).toHaveCount(0)
  })
})

test.describe('tear sheet of an unusable run', () => {
  test('reads [UNUSABLE: BALANCE] and draws nothing', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.unusable')
    await settle(main)
    await expect(main.getByRole('alert')).toContainText('[UNUSABLE: BALANCE]')
    await expect(main.getByRole('img')).toHaveCount(0)
    // The 422 is the expected answer for an unusable run; the browser logs it as a failed resource.
    const errors = watch.errors.filter((e) => !/status of 422/.test(e))
    expect(errors).toEqual([])
    watch.errors.length = 0
    await expectGalleryClean(page, watch)
  })
})

test.describe('in the workspace', () => {
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    test(`every tab fits its panel body with no scrollbar at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size)
      await page.goto('/')
      await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
      for (const code of ['EQ', 'DD', 'RET', 'RR', 'MRET']) {
        await page.keyboard.press('Control+k')
        const line = page.getByRole('combobox', { name: 'Command line' })
        await line.fill(`${HYP} ${code}`)
        await line.press('Enter')
        const panel = page.locator(`[data-nqt-title="${HYP} ${code}"]`).filter({ visible: true })
        await expect(panel.getByRole('list', { name: 'Tear sheet key figures' })).toBeVisible()
        await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0)
        const body = await panel.locator('.nqt-panel-body').evaluate((b) => {
          const view = b.querySelector('.tear-screen') as HTMLElement | null
          return { sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth, view: view?.offsetHeight ?? Number.NaN }
        })
        expect(body.sw, `${code} width`).toBeLessThanOrEqual(body.cw)
        // The tab view is exactly one screen of the body. A hypothesis has no run books; EQ, RET and RR have their
        // P1 cards below the view in the body's scroll (UI_SPEC, P1 views on screen), DD and MRET have none.
        // DD draws one lane row per drawn episode with a floor of its own (tear.css, G10), so in a short panel its view
        // may be taller than the body; it then scrolls as one piece and never overflows onto anything below it.
        if (code !== 'DD') expect(body.view, `${code} view height`).toBeLessThanOrEqual(body.ch)
        if (code === 'DD' || code === 'MRET') expect(body.sh, `${code} height`).toBeLessThanOrEqual(Math.max(body.ch, body.view))
        else await expect(panel.getByRole('region', { name: `Extended analytics for ${HYP}` })).toBeAttached()
      }
    })
  }

  test('EQ opens from the command line and a tab opens its own function', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    await page.keyboard.press('Control+k')
    const line = page.getByRole('combobox', { name: 'Command line' })
    await line.fill(`${RUN} EQ`)
    await line.press('Enter')
    const panel = page.locator(`[data-nqt-title="${RUN} EQ"]`)
    await expect(panel.getByRole('list', { name: 'Tear sheet key figures' })).toBeVisible()
    await panel.getByRole('tab', { name: '3) Returns' }).click()
    await expect(page.locator(`[data-nqt-title="${RUN} RET"]`).getByRole('table', { name: 'Return statistics' })).toBeVisible()
  })
})

// Real-data smoke run: EQ on the registry's check row za_v0_C3_gao_momentum stayed on "Loading the tear
// sheet." for over 60 s. The fixture registry has no check row (its spec would have to be a fixture file
// too), so the command index and that one card are served here in the real card's shape: a 200 with
// tag check, spec za_v0 and no recorded series costs.
test.describe('tear sheet of a check row', () => {
  const CHECK = 'za_v0_C3_gao_momentum'
  const PARENT = 'za_v0'

  async function serveCheckRow(page: Page): Promise<void> {
    const detail = await apiJson<{ card: Record<string, unknown> }>(page, `/api/hypotheses/${HYP}`)
    const card = {
      ...detail.card, name: CHECK, registered: false, tag: 'check', spec: PARENT, verdict: `check inside ${PARENT} (no own pass bar)`,
      verdict_badge: 'CHECK', verdict_note: `check inside ${PARENT} (no own pass bar)`, series_kind: null, series_costs: [], nautilus_runs: [],
    }
    await page.route('**/api/commands', async (route) => {
      const response = await route.fetch()
      const index = (await response.json()) as { hypotheses: string[] }
      await route.fulfill({ response, json: { ...index, hypotheses: [...index.hypotheses, PARENT, CHECK] } })
    })
    await page.route(`**/api/hypotheses/${CHECK}`, (route) => route.fulfill({ json: { ...detail, card } }))
  }

  test('every tab says there is no series within seconds and links to the parent tear sheet', async ({ page }) => {
    const watch = await watchGallery(page)
    await serveCheckRow(page)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    const line = page.getByRole('combobox', { name: 'Command line' })
    for (const code of ['EQ', 'DD', 'RET', 'RR', 'MRET']) {
      await page.keyboard.press('Control+k')
      await line.fill(`${CHECK} ${code}`)
      await line.press('Enter')
      const panel = page.locator(`[data-nqt-title="${CHECK} ${code}"]`).filter({ visible: true })
      const status = panel.getByRole('status').filter({ hasText: `No return series: this row is a check inside ${PARENT}.` })
      await expect(status, code).toBeVisible({ timeout: 5_000 })
      await expect(status).toContainText(`Open ${PARENT}'s tear sheet:`)
      await expect(panel.locator('[aria-busy="true"]'), code).toHaveCount(0)
      await expect(panel.getByRole('alert'), code).toHaveCount(0)
      await expect(panel.getByRole('button', { name: `${PARENT} ${code} <GO>` })).toBeVisible()
    }
    // HOME's own first-load read of its default hypothesis panel can land after the first command is typed, so it is
    // not a request of the check row; any other read under /api/analytics/ would be.
    const homeOwnRead = `/api/analytics/hypothesis/${HYP}/panel`
    const analytics = watch.requests.map((r) => new URL(r.url())).filter((u) => u.pathname.startsWith('/api/analytics/') && u.pathname !== homeOwnRead)
    expect(analytics.map((u) => u.pathname)).toEqual([])
    await expectGalleryClean(page, watch)
    const last = page.locator(`[data-nqt-title="${CHECK} MRET"]`).filter({ visible: true })
    await last.getByRole('button', { name: `${PARENT} MRET <GO>` }).click()
    await expect(page.locator(`[data-nqt-title="${PARENT} MRET"]`).filter({ visible: true })).toHaveCount(1)
  })
})
