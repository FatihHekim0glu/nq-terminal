// RUNS, RUN and LEDG E2E (TASKS 6.3; UI_SPEC section 7 "RUNS and RUN" and "LEDG"; look spec 7.4 and 7.9).
// Runs against the fixture-mode backend (playwright.config.ts), whose runs are the six fixture runs and
// whose ledger holds nt_overnight_v0_fixture_open:
// - RUNS lists every run with its badges; Sharpe and max drawdown equal GET /api/runs/stats (Basis B);
// - an unbalanced run reads [UNUSABLE: BALANCE] in RUNS and RUN, and RUN draws no equity line for it and
//   never asks for its series;
// - RUN draws Basis B equity and underwater for a usable run, and the ledger copy command is the API's
//   text exactly; Enter on a RUNS row opens RUN for it;
// - LEDG shows the ledger rows with the weekday, the balance in text and the anchor pairs;
// - axe WCAG 2.2 AA clean, no console errors, every request a same-origin GET; screenshots at 1920x1080
//   and 1366x768.
// The first block needs the merge step's registration (RUNS, RUN and LEDG in BUILT_SCREENS); the last
// block checks the same screens through their gallery entries, which need no registration.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MASK_COLOR, expectGalleryAxeClean, watchGallery, type GalleryWatch } from './gallery.ts'

// 14:02:11 ET (look spec 4.10), the frozen status-line time the shell baselines use.
const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const
const DTS = 'nt_dtsmom_v0_fixture_ts1'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'
const LEDGERED = 'nt_overnight_v0_fixture_open'

interface RunSummary {
  readonly run_id: string
  readonly readable: boolean
  readonly balance_ok: boolean | null
  readonly pnl_total: number | null
}
interface CompareStats {
  readonly run_id: string
  readonly sharpe: number | null
  readonly max_drawdown: number | null
}
interface RunDetail {
  readonly ledger_command: { readonly eligible: boolean; readonly command: string | null }
}
interface Panel {
  readonly sharpe: number | null
  readonly n: number
}

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

/** The screens' formats (look spec 3.4): fixed decimals, ASCII minus, never -0, `--` for missing. */
function fixed(v: number | null, decimals: number): string {
  if (v === null || !Number.isFinite(v)) return '--'
  const text = v.toFixed(decimals)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}
const pct = (v: number | null, decimals: number): string => (v === null ? '--' : `${fixed(v * 100, decimals)}%`)
function usd(v: number | null): string {
  if (v === null) return '--'
  const text = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
  return v > 0 ? `+${text}` : text
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.ok(), path).toBe(true)
  return (await response.json()) as T
}

async function settle(page: Page): Promise<void> {
  // The screen chunk loads lazily ("Loading this screen." until then), then its API reads.
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

async function runCommand(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
}

async function openScreen(page: Page, line: string, title: string, size: (typeof SIZES)[number] = SIZES[0]): Promise<Locator> {
  await page.setViewportSize(size)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await runCommand(page, line)
  const target = panel(page, title)
  await expect(target).toBeVisible()
  return target
}

function expectGetOnly(page: Page, watch: GalleryWatch): void {
  const origin = new URL(page.url()).origin
  const bad = watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(origin))
  expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

function rowOf(grid: Locator, runId: string): Locator {
  return grid.locator('tbody tr[role="row"]').filter({ has: grid.page().getByRole('gridcell', { name: runId, exact: true }) })
}

async function compareStats(page: Page, runs: readonly RunSummary[]): Promise<Map<string, CompareStats>> {
  const ids = runs.filter((r) => r.readable).map((r) => r.run_id).join(',')
  const body = await apiJson<CompareStats[]>(page, `/api/runs/stats?ids=${encodeURIComponent(ids)}`)
  return new Map(body.map((s) => [s.run_id, s]))
}

async function expectRunsTable(page: Page, grid: Locator): Promise<void> {
  const runs = await apiJson<RunSummary[]>(page, '/api/runs')
  const stats = await compareStats(page, runs)
  for (const run of runs) {
    const row = rowOf(grid, run.run_id)
    await expect(row, run.run_id).toHaveCount(1)
    await expect(row).toContainText(usd(run.pnl_total))
    const s = stats.get(run.run_id) ?? null
    await expect(row).toContainText(fixed(s?.sharpe ?? null, 2))
    // The API sends a positive depth; the grid shows the fall as a negative number, as the tear sheet does.
    const depth = s?.max_drawdown ?? null
    await expect(row).toContainText(pct(depth === null ? null : -Math.abs(depth), 2))
  }
  const unbalanced = rowOf(grid, UNBALANCED)
  await expect(unbalanced).toContainText('[UNUSABLE: BALANCE]')
  await expect(unbalanced).toContainText('[FAIL]')
  await expect(rowOf(grid, LEDGERED)).toContainText('[LEDGERED]')
}

async function expectUnusableRun(body: Locator, watch: GalleryWatch): Promise<void> {
  await expect(body.getByText('[UNUSABLE: BALANCE]').first()).toBeVisible()
  await expect(body.getByText('No equity line for an unusable run (rule 4).')).toBeVisible()
  await expect(body.locator('canvas')).toHaveCount(0)
  await expect(body.locator('.chart-a11y-figure[role="img"]')).toHaveCount(0)
  expect(watch.requests.filter((r) => /\/panel|\/equity/.test(r.url())).map((r) => r.url())).toEqual([])
}

async function expectUsableRun(page: Page, body: Locator): Promise<void> {
  const detail = await apiJson<RunDetail>(page, `/api/runs/${DTS}`)
  const series = await apiJson<Panel>(page, `/api/analytics/run/${DTS}/panel?freq=D`)
  await expect(body.locator('.chart-a11y-figure[role="img"]').first()).toBeVisible()
  await expect(body.getByTestId('ledger-command')).toHaveText(detail.ledger_command.command ?? '')
  const stats = body.getByRole('table', { name: new RegExp(`Statistics for ${DTS}`) })
  await expect(stats.getByRole('row', { name: /Sharpe \(B, annualised\)/ })).toContainText(fixed(series.sharpe, 2))
  await expect(stats.getByRole('row', { name: /Sessions \(B\)/ })).toContainText(String(series.n))
  await expect(body.getByText(/Basis B, account \(compounded from K\)/)).toBeVisible()
}

test.describe('RUNS, RUN and LEDG in the workspace', () => {
  test('RUNS lists every run with its badges, and Sharpe and max drawdown equal to the API', async ({ page }) => {
    const watch = await watchGallery(page)
    const target = await openScreen(page, 'RUNS', 'RUNS')
    const grid = target.getByRole('grid', { name: /Nautilus runs/ })
    await expect(grid).toBeVisible()
    await expectRunsTable(page, grid)
    await settle(page)
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('Enter on a RUNS row opens RUN for that run', async ({ page }) => {
    const target = await openScreen(page, 'RUNS', 'RUNS')
    const grid = target.getByRole('grid', { name: /Nautilus runs/ })
    const first = (await grid.locator('tbody tr[role="row"]').first().locator('td').nth(1).textContent())?.trim() ?? ''
    expect(first).not.toBe('')
    await grid.focus()
    await page.keyboard.press('Enter')
    await expect(panel(page, `${first} RUN`)).toBeVisible()
  })

  test('an unbalanced run shows [UNUSABLE: BALANCE] and no equity line', async ({ page }) => {
    const watch = await watchGallery(page)
    const target = await openScreen(page, `${UNBALANCED} RUN`, `${UNBALANCED} RUN`)
    await expectUnusableRun(target, watch)
    await settle(page)
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('RUN draws Basis B equity, shows the exact ledger command and lists the trades', async ({ page }) => {
    const watch = await watchGallery(page)
    const target = await openScreen(page, `${DTS} RUN`, `${DTS} RUN`)
    await expectUsableRun(page, target)
    const trades = await apiJson<{ total: number }>(page, `/api/runs/${DTS}/trades?limit=5000`)
    await target.getByRole('tab', { name: '2) Trades' }).click()
    const grid = target.getByRole('grid', { name: new RegExp(`Trades of ${DTS}`) })
    await expect(grid.locator('tbody tr[role="row"]')).toHaveCount(trades.total)
    await settle(page)
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('LEDG shows the ledger rows with the weekday, the balance as text and the anchor pairs', async ({ page }) => {
    const watch = await watchGallery(page)
    const target = await openScreen(page, 'LEDG', 'LEDG')
    const grid = target.getByRole('grid', { name: /Run ledger/ })
    const row = rowOf(grid, LEDGERED)
    await expect(row).toContainText('Sa 2026-09-26')
    await expect(row).toContainText('[OK]')
    await expect(row).toContainText('+617.08')
    await expect(target.getByTestId('ledger-counts')).toHaveText('Rows 1  Balanced 1  Match result.json 1')
    await expect(target.getByRole('table', { name: /Anchor pairs \(0\)/ })).toBeVisible()
    await settle(page)
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  for (const size of SIZES) {
    const shots = [
      { name: 'runs', line: 'RUNS', title: 'RUNS' },
      { name: 'run', line: `${DTS} RUN`, title: `${DTS} RUN` },
      { name: 'ledg', line: 'LEDG', title: 'LEDG' },
    ] as const
    for (const shot of shots) {
      test(`screenshot ${shot.name} ${size.width}x${size.height}`, async ({ page }) => {
        await page.clock.setFixedTime(FROZEN_NOW)
        await openScreen(page, shot.line, shot.title, size)
        await settle(page)
        if (shot.name === 'run') await expect(page.locator('canvas').first()).toBeVisible()
        // RUNS reads its Sharpe and drawdown after the rows: wait until that line is gone.
        await expect(page.getByText('Reading Sharpe and max drawdown.')).toHaveCount(0)
        await settle(page)
        await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
        // The gate read count depends on what ran before in this backend process: masked.
        const gate = page.getByRole('contentinfo').locator('.seg', { hasText: /^Gate reads/ })
        await expect(page).toHaveScreenshot(`${shot.name}-${size.width}x${size.height}.png`, { mask: [gate], maskColor: MASK_COLOR })
      })
    }
  }
})

async function openEntry(page: Page, path: string, size: (typeof SIZES)[number] = SIZES[0]): Promise<Locator> {
  await page.setViewportSize(size)
  await page.goto(path)
  const main = page.locator('main[data-gallery-state]')
  await expect(main).toHaveAttribute('data-gallery-state', 'ready')
  await settle(page)
  return main
}

test.describe('RUNS, RUN and LEDG gallery entries (no registration needed)', () => {
  test('RUNS and LEDG read the fixture backend', async ({ page }) => {
    const watch = await watchGallery(page)
    const runs = await openEntry(page, '/__gallery/RunsScreens')
    await expectRunsTable(page, runs.getByRole('grid', { name: /Nautilus runs/ }))
    await expectGalleryAxeClean(page)
    const ledg = await openEntry(page, '/__gallery/LedgScreen')
    await expect(rowOf(ledg.getByRole('grid', { name: /Run ledger/ }), LEDGERED)).toContainText('[OK]')
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('RUN: no equity line for an unbalanced run; equity and the exact ledger command for a usable one', async ({ page }) => {
    const watch = await watchGallery(page)
    const unusable = await openEntry(page, `/__gallery/RunsScreens?run=${UNBALANCED}`)
    await expectUnusableRun(unusable, watch)
    await expectGalleryAxeClean(page)
    for (const size of SIZES) {
      const usable = await openEntry(page, `/__gallery/RunsScreens?run=${DTS}`, size)
      await expectUsableRun(page, usable)
      await expectGalleryAxeClean(page)
    }
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })
})
