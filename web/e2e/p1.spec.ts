// P1 analytics on screen (TASKS Phase 10 shown in the look): against the fixture-mode backend
// (playwright.config.ts). On the tear sheet gallery entries (TearSheet.hypothesis is volmanaged_v0, TearSheet.run
// is nt_za_v0_fixture_a) every P1 value equals the API at the displayed precision:
// - EQ: SV5 bootstrap intervals and the SV6 cone ("resampled history, not a forecast");
// - RET: PF7 to PF9 tiles, RK3 (the normal VaR greyed outside the domain), RD4 on the whole series, the RD3
//   QQ plot, and the RK5 stress windows as a panel of their own with no p-value;
// - RR: RL3 and RL4, BR3, BR4 with BR1's line, RG1 with Welch t and no p-value;
// - a run's trade paths: TA2 MAE and MFE, TA4 holding times, TA5 streaks and the runs test;
// then SV3 on REG (the DSR column), MT (the table) and DES (the line). Every panel is [POST HOC]; axe WCAG 2.2
// AA clean, no console errors, same-origin GETs only, no price request from the browser. Screenshots of the
// P1 section at both sizes.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MASK_COLOR, expectGalleryAxeClean, expectGalleryClean, openGallery, watchGallery, type GalleryWatch } from './gallery.ts'

const HYP = 'volmanaged_v0'
const RUN = 'nt_za_v0_fixture_a'
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const

interface Interval { statistic: string; label: string; unit: string; point: number | null; lo: number | null; hi: number | null }
interface Bootstrap { reps: number; seed: number; intervals: Interval[]; cone: { label: string; horizon: number } }
interface Kpi { key: string; label: string; value: number | null; tag: string }
interface CfLevel { level: string; value: number | null; historical: number | null; in_domain: boolean }
interface StressRow { label: string; peak: string; trough: string; covered_from: string | null; covered_to: string | null; spent: boolean }
interface Extended {
  ratios: Kpi[]
  cornish_fisher_var: { unit: string; levels: CfLevel[] }
  jarque_bera: { p: number | null }
  capture: { up: number | null; down: number | null } | null
  rolling_relative: { full_beta: number | null } | null
  stress: { rows: StressRow[]; spent_note: string | null }
  regimes: { welch_t: number | null } | null
}
interface Paths { streaks: { runs_test: { p: number | null } }; holding: { counts: number[] } }
interface Deflated {
  n_trials: number
  variance_null: number | null
  n_note: string
  rows: Array<{ name: string; dsr: number | null; dsr_null: number | null }>
}

// The screens' number rule (src/format/decimal.ts): fixed decimals, half away from zero, ASCII minus.
const fixed = (v: number, d: number): string => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(v).replace('−', '-')
// A DSR as the screens print it (deflatedModel.formatDsr): below 1e-6 as "< 0.000001", below 0.001 to 6 places.
const dsrText = (v: number | null): string => (v === null ? '--' : v < 1e-6 ? '< 0.000001' : fixed(v, v < 1e-3 ? 6 : 3))
const signed = (v: number, d: number): string => (v > 0 && Number(fixed(v, d)) !== 0 ? `+${fixed(v, d)}` : fixed(v, d))
const pctSigned = (v: number): string => `${signed(v * 100, 2)}%`
const pValue = (p: number): string => (p < 1e-4 ? '<0.0001' : p.toFixed(4))

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.ok(), path).toBe(true)
  return (await response.json()) as T
}

async function settle(scope: Locator): Promise<void> {
  await expect(scope.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function openTab(main: Locator, label: string): Promise<Locator> {
  await main.getByRole('tab', { name: label }).click()
  const section = main.getByRole('region', { name: /^Extended analytics for / })
  await expect(section).toBeVisible()
  await settle(main)
  return section
}

function noPriceRequest(watch: GalleryWatch): void {
  expect(watch.requests.filter((r) => /\/api\/(bars|market)\b/.test(r.url())).map((r) => r.url())).toEqual([])
}

test.describe('tear sheet P1 views', () => {
  test('EQ: bootstrap intervals and the cone equal the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.hypothesis')
    const boot = await apiJson<Bootstrap>(page, `/api/analytics/hypothesis/${HYP}/bootstrap?cost=1`)
    const section = main.getByRole('region', { name: `Extended analytics for ${HYP}` })
    await settle(section)
    await expect(section).toContainText(`${new Intl.NumberFormat('en-GB').format(boot.reps)} replications, seed ${boot.seed}`)
    const sharpe = boot.intervals.find((i) => i.statistic === 'sharpe')!
    const row = section.getByRole('rowheader', { name: 'Sharpe', exact: true }).locator('xpath=..')
    await expect(row).toContainText(`${signed(sharpe.lo!, 2)} to ${signed(sharpe.hi!, 2)}`)
    const cagr = boot.intervals.find((i) => i.statistic === 'cagr')!
    await expect(section.getByRole('rowheader', { name: 'CAGR', exact: true }).locator('xpath=..')).toContainText(`${pctSigned(cagr.lo!)} to ${pctSigned(cagr.hi!)}`)
    const cone = section.getByRole('img', { name: /resampled paths: resampled history, not a forecast/ })
    await expect(cone).toBeVisible()
    await expect(cone).toHaveAttribute('aria-label', new RegExp(`${boot.cone.horizon} steps`))
    await expect(section.getByText('[POST HOC]').first()).toBeVisible()
    await expectGalleryClean(page, watch)
    noPriceRequest(watch)
  })

  test('RET: ratios, Cornish-Fisher VaR, Jarque-Bera, QQ and the stress panel equal the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.hypothesis')
    const ext = await apiJson<Extended>(page, `/api/analytics/hypothesis/${HYP}/extended?cost=1`)
    const section = await openTab(main, '3) Returns')
    for (const k of ext.ratios) {
      const tile = section.locator('.kpi-tile').filter({ has: page.locator('.kpi-label', { hasText: k.label }) })
      await expect(tile.locator('.kpi-value'), k.key).toHaveText(k.value === null ? '--' : fixed(k.value, 2))
    }
    const cf = section.getByRole('table', { name: /Normal and Cornish-Fisher VaR by level/ })
    for (const l of ext.cornish_fisher_var.levels) {
      const r = cf.getByRole('rowheader', { name: `${l.level}%` }).locator('xpath=..')
      await expect(r).toContainText(`${fixed(l.value! * 100, 2)}%`)
      await expect(r).toContainText(`${fixed(l.historical! * 100, 2)}%`)
      await expect(r).toContainText(l.in_domain ? 'Cornish-Fisher' : 'historical: Cornish-Fisher not defined here')
      // Outside the domain the shown value is the historical VaR (RK1), never the normal one.
      if (!l.in_domain) expect(l.value).toBe(l.historical)
    }
    await expect(section.getByRole('table', { name: 'Jarque-Bera on the whole series' })).toContainText(pValue(ext.jarque_bera.p!))
    await expect(section.getByRole('img', { name: new RegExp(`^${HYP} QQ plot`) })).toBeVisible()
    const stress = section.getByRole('table', { name: 'Frozen stress windows, peak to trough of NQ buy and hold' })
    await expect(stress.locator('tbody tr')).toHaveCount(ext.stress.rows.length)
    for (const s of ext.stress.rows) {
      await expect(stress).toContainText(`${s.peak} to ${s.trough}`)
      if (s.covered_from && s.covered_to) await expect(stress).toContainText(`${s.covered_from} to ${s.covered_to}`)
    }
    if (ext.stress.spent_note) await expect(section).toContainText(ext.stress.spent_note)
    await expect(stress).not.toContainText(/p-value/)
    await expectGalleryClean(page, watch)
    noPriceRequest(watch)
  })

  test('RR: rolling beta and correlation, capture, scatter and regimes equal the API, no p-value on the regimes', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.hypothesis')
    const ext = await apiJson<Extended>(page, `/api/analytics/hypothesis/${HYP}/extended?cost=1`)
    const section = await openTab(main, '4) Rolling')
    await expect(section).toContainText(`Full sample: beta ${fixed(ext.rolling_relative!.full_beta!, 3)}`)
    const capture = section.getByRole('table', { name: 'Up and down capture, annualised geometric' })
    await expect(capture.getByRole('rowheader', { name: 'Up capture' }).locator('xpath=..')).toContainText(fixed(ext.capture!.up!, 3))
    await expect(capture.getByRole('rowheader', { name: 'Down capture' }).locator('xpath=..')).toContainText(fixed(ext.capture!.down!, 3))
    await expect(section.getByRole('img', { name: new RegExp(`^${HYP} against its benchmark: .*OLS \\(BR1\\) slope`) })).toBeVisible()
    await expect(section).toContainText('No p-value: a fixed split, still [POST HOC].')
    await expectGalleryClean(page, watch)
    noPriceRequest(watch)
  })

  test('a run: trade paths (TA2 refused on another price basis, holding times, streaks and the runs test) equal the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'TearSheet.run')
    const paths = await apiJson<Paths>(page, `/api/analytics/run/${RUN}/trade-paths`)
    const exc = await apiJson<{ available: boolean; note: string | null; off_basis: number; basis_checked: number }>(page, `/api/analytics/run/${RUN}/excursions`)
    const card = main.locator('.tear-card-paths')
    await expect(card).toBeVisible()
    await settle(card)
    // The fixture serve's synthetic bars sit near 2480 and the run's fills near 5790: the API refuses TA2 with the
    // counts (it once drew MAE of thousands of points) and the card says so instead of drawing (the MAE and MFE
    // charts over on-basis bars are covered by the unit tests).
    expect(exc.available).toBe(false)
    expect(exc.off_basis).toBe(exc.basis_checked)
    await expect(card).toContainText(exc.note!)
    await expect(card.getByRole('img', { name: new RegExp(`^${RUN} MAE against the final result`) })).toHaveCount(0)
    await expect(card.getByRole('img', { name: new RegExp(`^${RUN} holding time`) })).toBeVisible()
    const streaks = card.getByRole('table', { name: 'Streaks and the runs test on the whole trade list' })
    await expect(streaks.getByRole('rowheader', { name: 'Runs test p (whole list)' }).locator('xpath=..')).toContainText(pValue(paths.streaks.runs_test.p!))
    await expectGalleryClean(page, watch)
    // TA2 reads the run's 1-minute bars in the backend, through the gate as caller terminal; the browser asks for none.
    noPriceRequest(watch)
  })

  // One baseline per card: a section taller than the panel would be clipped by the panel's own scroll.
  for (const size of SIZES) {
    test(`P1 card screenshots ${size.width}x${size.height}`, async ({ page }) => {
      const main = await openGallery(page, 'TearSheet.hypothesis', size)
      for (const [tab, name] of [['1) Equity', 'eq'], ['3) Returns', 'ret'], ['4) Rolling', 'rr']] as const) {
        const section = tab === '1) Equity' ? main.getByRole('region', { name: `Extended analytics for ${HYP}` }) : await openTab(main, tab)
        await settle(section)
        const cards = section.locator('.tear-card')
        const n = await cards.count()
        expect(n).toBeGreaterThan(0)
        for (let i = 0; i < n; i += 1) {
          const card = cards.nth(i)
          await card.scrollIntoViewIfNeeded()
          await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
          await expect(card).toHaveScreenshot(`p1-${name}-${i + 1}-${size.width}x${size.height}.png`, { maskColor: MASK_COLOR })
        }
      }
    })
  }
})

test.describe('SV3 on REG, MT and DES', () => {
  const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
  const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

  async function run(page: Page, line: string): Promise<void> {
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    await page.keyboard.press('Control+k')
    await commandLine(page).fill(line)
    await commandLine(page).press('Enter')
  }

  test('REG shows each trial DSR equal to the API and MT the full table, [POST HOC], no verdict', async ({ page }) => {
    const watch = await watchGallery(page)
    const view = await apiJson<Deflated>(page, '/api/analytics/deflated')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await run(page, 'REG')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(2)
    const reg = panel(page, 'REG')
    const grid = reg.getByRole('grid', { name: /Registry board/ })
    await expect(grid).toBeVisible()
    await settle(page.locator('body'))
    const compactHeads = (await grid.locator('thead th').allTextContents()).map((h) => h.trim())
    const mt = panel(page, 'MT')
    const section = mt.getByRole('region', { name: 'Deflated Sharpe over the registered hypotheses' })
    await section.scrollIntoViewIfNeeded()
    await expect(section).toContainText(`N ${view.n_trials} registered trials`)
    await expect(section).toContainText('[POST HOC]')
    await expect(section).not.toContainText(/\[(PASS|FAIL)\]/)
    const table = section.getByRole('table', { name: /^Deflated Sharpe by registered trial/ })
    for (const r of view.rows) {
      const row = table.getByRole('rowheader', { name: r.name }).locator('xpath=..')
      await expect(row).toContainText(dsrText(r.dsr))
      await expect(row).toContainText(dsrText(r.dsr_null))
    }
    await expect(section).toContainText(`Under the null variance V0 ${fixed(view.variance_null!, 6)}`)
    await expect(section).toContainText(view.n_note)
    // REG's column is the DSR under V0. Beside MT each panel is narrower than the full column set, so REG shows
    // its compact columns, which have no DSR (born failing: this check used to run only if the column happened to
    // be there, and at this layout it never was). Maximised, REG shows every column: check each row there.
    expect(compactHeads).not.toContain('DSR')
    expect(compactHeads).not.toContain('DSR V0')
    await reg.getByRole('button', { name: 'Maximise panel' }).click()
    await expect(grid.locator('thead th', { hasText: 'DSR V0' })).toHaveCount(1)
    const heads = (await grid.locator('thead th').allTextContents()).map((h) => h.trim())
    expect(heads).not.toContain('DSR')
    const at = heads.indexOf('DSR V0')
    expect(at).toBeGreaterThan(0)
    for (const r of view.rows) {
      const row = grid.locator('tbody tr[role="row"]').filter({ hasText: r.name }).first()
      await expect(row.locator('td').nth(at)).toHaveText(dsrText(r.dsr_null))
    }
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expect(watch.requests.filter((r) => r.method() !== 'GET')).toEqual([])
  })

  test('DES shows the hypothesis DSR against SR0 from the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const view = await apiJson<Deflated>(page, '/api/analytics/deflated')
    const main = await openGallery(page, 'DesHypothesis')
    const row = view.rows.find((r) => r.name === 'overnight_v0')!
    const line = main.locator('.nqt-card-pair', { has: page.locator('dt', { hasText: 'Deflated Sharpe [POST HOC]' }) })
    // DEFLATED.desLine (G06): the own-period SR0 and its annualised twin come first, then both DSRs, then N.
    await expect(line).toContainText(`DSR ${dsrText(row.dsr)} under V, ${dsrText(row.dsr_null)} under V0; N ${view.n_trials}`)
    await expectGalleryClean(page, watch)
  })
})
