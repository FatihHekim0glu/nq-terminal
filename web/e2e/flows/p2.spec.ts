// The P2 surfaces in the real app on the fixture backend (TASKS Phase 12; PRD U3), each opened as a person does,
// from the command line and the keys:
//   MT 88) Family test (SV8), the RET and RR cards (RK4, PF11, BR5, RG2), a run's capacity (EX5), ROLL 2) Market's
//   term structure (MV6), the LIVE IB panel over a fake snapshot (the fixture backend has no TWS: it answers
//   "disabled", and the other states are served to the page by the test), the JOBS queue against the fake runner
//   (NQT_FIXTURE_JOBS=fake: a stand-in script, never the real run_base) and the amber classic theme.
// Every flow runs at 1920x1080 and 1366x768 where it draws, with axe (wcag2a to wcag22aa) clean, no console error,
// no CSP report, and every request a same-origin GET (the JOBS flow sends exactly the queue's POST and DELETE, each
// with X-NQT: 1). Screenshot baselines are taken with the masked areas painted black.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MASK_COLOR } from '../gallery.ts'
import { expectWatchSegment } from '../watchReady.ts'
import { axeViolations, FROZEN_NOW, VIEWPORTS, type Viewport } from '../visual/screens.ts'
import { expectCleanFlow, openScreen, openTerminal, runLine, settle, status, watchFlow } from './support.ts'

const HYP = 'volmanaged_v0'
const RUN = 'nt_volmanaged_v0_fixture_m1'

test.describe.configure({ timeout: 180_000 })

const size = (v: Viewport): string => `${v.width}x${v.height}`

/** The areas that follow the run's history or the wall clock: the gate-read counters and the stream line. */
function counters(page: Page): Locator[] {
  const bar = page.getByRole('contentinfo')
  return [bar.locator('.seg').filter({ hasText: 'Gate reads' }), bar.locator('.seg.flag'), page.locator('.gp-footer'), page.locator('[data-key="stream-lastEvent"], [data-key="stream-rows"]')]
}

async function start(page: Page, viewport: Viewport) {
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.setViewportSize(viewport)
  const watch = await watchFlow(page)
  await openTerminal(page)
  return watch
}

async function shot(page: Page, name: string, viewport: Viewport, also: Locator[] = []): Promise<void> {
  await expectWatchSegment(page)
  await page.mouse.move(0, 0)
  await expect(page).toHaveScreenshot(`p2-${name}-${size(viewport)}.png`, { mask: [...counters(page), ...also], maskColor: MASK_COLOR })
}

/** The JOBS table and log: the queue is one backend's, shared by the specs running beside this one, and its times are the server's. */
function jobsDynamic(page: Page): Locator[] {
  return [page.locator('.jobs-screen table'), page.locator('.jobs-log')]
}

const heading = (scope: Locator | Page, title: string): Locator =>
  scope.getByRole('heading').filter({ hasText: title })

for (const viewport of VIEWPORTS) {
  test.describe(`P2 surfaces at ${size(viewport)}`, () => {
    test('MT 88) Family test: one GET once it is open, the SPA words, the members and the effective number, axe clean', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, 'MT', 'MT')
      expect(watch.requests.filter((r) => r.url().includes('/api/analytics/spa'))).toHaveLength(0)
      await runLine(page, '88')
      const panel = page.getByRole('tabpanel', { name: '88) Family test', exact: true })
      await expect(panel).toBeVisible()
      const region = panel.getByRole('region', { name: /^Family test over the pre-registered NQ hypotheses/ })
      await expect(region).toBeVisible()
      await expect(region).toContainText('[POST HOC]')
      await expect(region).toContainText('SPA p-values (non-studentised, arch form): consistent')
      await expect(region).toContainText('StepM at family-wise size')
      // One member table against cash (the primary row) and one against NQ buy and hold (the second, labelled row).
      await expect(region.getByRole('table')).toHaveCount(2)
      await expect(region.getByRole('table', { name: /against cash/ })).toBeVisible()
      await expect(region.getByRole('table', { name: /against NQ buy and hold/ })).toBeVisible()
      await settle(page)
      expect(watch.requests.filter((r) => r.url().includes('/api/analytics/spa'))).toHaveLength(1)
      expect(await axeViolations(page), 'axe').toEqual([])
      await shot(page, 'mt-88', viewport)
      await expectCleanFlow(page, watch)
    })

    test('RET and RR: the risk extras, the Treynor ratio and the trend regime, each from its own read', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, `${HYP} RET`, 'RET')
      await expect(heading(page, 'Ulcer index and recovery factor (PF11)')).toBeVisible()
      await expect(heading(page, 'Modified expected shortfall (RK4)')).toBeVisible()
      expect(await axeViolations(page), 'RET axe').toEqual([])
      await shot(page, 'ret', viewport)
      await openScreen(page, `${HYP} RR`, 'RR')
      await expect(heading(page, 'Treynor ratio (BR5)')).toBeVisible()
      await expect(heading(page, 'Trend regime (RG2)')).toBeVisible()
      expect(await axeViolations(page), 'RR axe').toEqual([])
      await shot(page, 'rr', viewport)
      const urls = watch.requests.map((r) => new URL(r.url()).pathname + new URL(r.url()).search)
      expect(urls).toContain(`/api/analytics/hypothesis/${HYP}/risk-extras?cost=1`)
      expect(urls).toContain(`/api/analytics/hypothesis/${HYP}/trend-regime?cost=1`)
      await expectCleanFlow(page, watch)
    })

    test('a run: the capacity card closes its books on the tear sheet and on EXPO', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, `${RUN} RR`, 'RR')
      await expect(heading(page, 'Capacity (EX5)')).toBeVisible()
      expect(await axeViolations(page), 'RR run axe').toEqual([])
      await openScreen(page, `${RUN} EXPO`, 'EXPO')
      await expect(heading(page, 'Capacity (EX5)')).toBeVisible()
      expect(await axeViolations(page), 'EXPO axe').toEqual([])
      await shot(page, 'expo-capacity', viewport)
      const urls = watch.requests.map((r) => new URL(r.url()).pathname)
      expect(urls).toContain(`/api/analytics/run/${RUN}/capacity`)
      await expectCleanFlow(page, watch)
    })

    test('ROLL 2) Market: the term structure of the picked market, read only once the market view is open', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, 'NQ ROLL', 'ROLL')
      expect(watch.requests.filter((r) => r.url().includes('/term-structure/'))).toHaveLength(0)
      await runLine(page, '2')
      await expect(heading(page, 'NQ term structure (MV6)')).toBeVisible()
      await settle(page)
      expect(watch.requests.filter((r) => r.url().includes('/api/market/term-structure/NQ'))).toHaveLength(1)
      expect(await axeViolations(page), 'axe').toEqual([])
      await shot(page, 'roll-term', viewport)
      await expectCleanFlow(page, watch)
    })
  })
}

// ---------------------------------------------------------------- LIVE: the IB snapshot over fake bodies

/** The page clock is frozen at FROZEN_NOW (start), so a snapshot is fresh when it was read just before it. */
const JUST_READ = new Date(FROZEN_NOW.getTime() - 2_000)

function snapshot(over: Record<string, unknown> = {}, readAt = JUST_READ): Record<string, unknown> {
  const account = 'DU*******'
  return {
    state: 'ok', message: 'Read 2 positions, 1 working order and 1 execution from TWS.', read_only: true, order_path: 'none', client_id: 95,
    accounts_masked: [account], server_time_utc: readAt.toISOString(), fetched_at_utc: readAt.toISOString(), cached: false, age_s: 0, cache_seconds: 5,
    incomplete: [], truncated: false, notes: [],
    summary: [{ account_masked: account, tag: 'NetLiquidation', value: '1000482.55', number: 1000482.55, currency: 'USD' }],
    positions: [
      { account_masked: account, symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT', exchange: 'CME', currency: 'USD', expiry: '20261218', quantity: 6, average_cost: 41250.5 },
      { account_masked: account, symbol: 'MES', local_symbol: 'MESZ6', sec_type: 'FUT', exchange: 'CME', currency: 'USD', expiry: '20261218', quantity: -2, average_cost: 6020.25 },
    ],
    open_orders: [{ order_id: 17, perm_id: 9001, client_id: 11, account_masked: account, symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT', action: 'SELL', order_type: 'LMT', quantity: 6, limit_price: 21900.25, stop_price: null, tif: 'DAY', status: 'Submitted', filled: 0, remaining: 6 }],
    executions: [{ exec_id: '0001f4e8.6501a2b3.01.01', time: '20261001 09:59:31 US/Eastern', account_masked: account, symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT', exchange: 'CME', side: 'BOT', shares: 6, price: 21850.5, cumulative_quantity: 6, average_price: 21850.5, order_id: 16, perm_id: 9000, client_id: 11 }],
    ...over,
  }
}

async function serveSnapshot(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route('**/api/ib/snapshot', (route) => route.fulfill({ json: body }))
}

const ibRegion = (page: Page): Locator => page.getByRole('region', { name: 'IB account snapshot (read only)' })

for (const viewport of VIEWPORTS) {
  test.describe(`LIVE IB snapshot at ${size(viewport)}`, () => {
    test('the fixture backend has no TWS: the panel says the snapshot is off, with no table and no control', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      const region = ibRegion(page)
      await expect(region).toContainText('IB snapshot off (NQT_IB_READONLY not set)')
      await expect(region.getByRole('table')).toHaveCount(0)
      await expect(region.locator('button, a, input, select, form')).toHaveCount(0)
      await expect(status(page)).toContainText('TWS not monitored')
      expect(await axeViolations(page), 'axe').toEqual([])
      await expectCleanFlow(page, watch)
    })

    test('a fresh fake snapshot: masked account, positions, open orders (view only), executions; the status line follows', async ({ page }) => {
      await serveSnapshot(page, snapshot())
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      const region = ibRegion(page)
      await expect(region).toContainText('READ ONLY')
      await expect(region.getByRole('table', { name: 'IB positions' })).toBeVisible()
      await expect(region.getByRole('heading', { name: 'Open orders (view only)' })).toBeVisible()
      await expect(region.getByRole('table', { name: 'IB executions today' })).toContainText('BOT')
      await expect(region).toContainText('DU*******')
      await expect(region).toContainText('1,000,482.55 USD')
      await expect(region.locator('button, a, input, select, form')).toHaveCount(0)
      await expect(status(page)).toContainText('TWS read-only snapshot')
      await region.scrollIntoViewIfNeeded()
      expect(await axeViolations(page), 'axe').toEqual([])
      await shot(page, 'live-ib', viewport)
      await expectCleanFlow(page, watch)
    })

    test('a snapshot read ten minutes ago is STALE in words, keeps its values and leaves the status line at not monitored', async ({ page }) => {
      // A cached body ten minutes old: the server's own `age_s` is what the panel trusts, not a clock comparison.
      await serveSnapshot(page, snapshot({ cached: true, age_s: 600 }, new Date(FROZEN_NOW.getTime() - 10 * 60_000)))
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      const region = ibRegion(page)
      await expect(region).toContainText('STALE: last read')
      await expect(region.getByRole('table', { name: 'IB positions' })).toBeVisible()
      await expect(status(page)).toContainText('TWS not monitored')
      expect(await axeViolations(page), 'axe').toEqual([])
      await expectCleanFlow(page, watch)
    })

    const none = { positions: [], open_orders: [], executions: [], summary: [], accounts_masked: [], fetched_at_utc: null, server_time_utc: null }

    test('TWS not reachable is said in words, with no table and the status line at not monitored', async ({ page }) => {
      await serveSnapshot(page, snapshot({ state: 'unavailable', message: 'No TWS or IB Gateway answered on 127.0.0.1:7497 in time.', ...none }))
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      await expect(ibRegion(page)).toContainText('TWS not reachable')
      await expect(ibRegion(page)).toContainText('No TWS or IB Gateway answered')
      await expect(ibRegion(page).getByRole('table')).toHaveCount(0)
      await expect(status(page)).toContainText('TWS not monitored')
      expect(await axeViolations(page), 'axe').toEqual([])
      await expectCleanFlow(page, watch)
    })

    test('a refused read (a live port, a live account) is said in words, with no table', async ({ page }) => {
      await serveSnapshot(page, snapshot({ state: 'refused', message: 'The read was stopped before any request: the port 7496 is a live port.', ...none }))
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      await expect(ibRegion(page)).toContainText('IB snapshot refused')
      await expect(ibRegion(page)).toContainText('the port 7496 is a live port')
      await expect(ibRegion(page).getByRole('table')).toHaveCount(0)
      expect(await axeViolations(page), 'axe').toEqual([])
      await expectCleanFlow(page, watch)
    })
  })
}

// ---------------------------------------------------------------- JOBS: the queue against the fake runner

const jobsPanel = (page: Page): Locator => page.locator('[data-screen="JOBS"], .jobs-screen').first()
const runIdField = (page: Page): Locator => page.getByRole('textbox', { name: 'Run id', exact: true })
const rowOf = (page: Page, runId: string): Locator => page.getByRole('row').filter({ hasText: runId })

async function queueRun(page: Page, runId: string): Promise<void> {
  await runIdField(page).fill(runId)
  await page.getByRole('button', { name: 'Queue run' }).click()
  await expect(rowOf(page, runId)).toBeVisible()
}

for (const viewport of VIEWPORTS) {
  test.describe(`JOBS at ${size(viewport)}`, () => {
    test('queue a run, watch it finish, queue a slow one, read its log and stop it after one confirmation', async ({ page }) => {
      const watch = await start(page, viewport)
      // Both viewports run against one backend and its one queue, so each takes run ids of its own.
      const ok = `t_e2e_${viewport.width}_ok`
      const slow = `t_e2e_${viewport.width}_slow`
      await openScreen(page, 'JOBS', 'JOBS')
      await expect(page.getByRole('heading', { name: 'Queue a backtest' }).or(page.getByText('Queue a backtest').first())).toBeVisible()
      await expect(page.getByText('In-sample backtests only')).toBeVisible()
      expect(await axeViolations(page), 'axe on the empty queue').toEqual([])

      await queueRun(page, ok)
      await expect(rowOf(page, ok)).toContainText(/OK/, { timeout: 30_000 })
      await expect(rowOf(page, ok).getByRole('button', { name: `Stop the job ${ok}` })).toHaveCount(0)

      await queueRun(page, slow)
      await expect(rowOf(page, slow)).toContainText(/RUNNING/, { timeout: 30_000 })
      await rowOf(page, slow).getByRole('button', { name: `View log for ${slow}` }).click()
      const log = page.getByRole('region', { name: `Log tail of ${slow}` })
      // the log keeps the last 100 lines, so the stand-in's later 'working' lines are what shows
      await expect(log).toContainText('working', { timeout: 30_000 })
      expect(await axeViolations(page), 'axe with a running job and its log').toEqual([])
      await shot(page, 'jobs-running', viewport, jobsDynamic(page))

      // Stop asks once; the safe answer takes the focus, so Enter keeps the job.
      await rowOf(page, slow).getByRole('button', { name: `Stop the job ${slow}` }).click()
      await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(rowOf(page, slow)).toContainText(/RUNNING/)
      await rowOf(page, slow).getByRole('button', { name: `Stop the job ${slow}` }).click()
      await page.getByRole('button', { name: 'Yes, stop it' }).click()
      await expect(rowOf(page, slow)).toContainText(/STOPPED/, { timeout: 30_000 })
      expect(await axeViolations(page), 'axe after the stop').toEqual([])
      await expect(status(page)).toContainText('NO ORDER PATH')

      const writes = watch.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${new URL(r.url()).pathname.replace(/j_[0-9a-f]{12}/, '<job>')}`)
      expect(writes).toEqual(['POST /api/jobs', 'POST /api/jobs', 'DELETE /api/jobs/<job>'])
      await expectCleanFlow(page, watch, { jobWrites: true })
      await expect(jobsPanel(page)).toBeVisible()
    })

    test('a bad draft is refused on the page: every problem named, one alert, and no request is sent', async ({ page }) => {
      const watch = await start(page, viewport)
      await openScreen(page, 'JOBS', 'JOBS')
      await runIdField(page).fill('bad run id')
      await page.getByRole('textbox', { name: /^Parameters/ }).fill('{not json')
      await page.getByRole('button', { name: 'Queue run' }).click()
      await expect(page.getByRole('alert').first()).toContainText('Fix 2 problems')
      await expect(runIdField(page)).toHaveAttribute('aria-invalid', 'true')
      expect(await axeViolations(page), 'axe with errors showing').toEqual([])
      expect(watch.requests.filter((r) => r.method() !== 'GET')).toEqual([])
      await expectCleanFlow(page, watch)
    })
  })
}

// ---------------------------------------------------------------- the amber classic theme

/** The frame strip's Options button; the panels' title bars have Options buttons of their own. */
const frameOptions = (page: Page): Locator => page.locator('.frame-btn[aria-label="Options"]')

async function chooseTheme(page: Page, name: string): Promise<void> {
  await frameOptions(page).click()
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name }).click()
  await page.keyboard.press('Escape')
}

for (const viewport of VIEWPORTS) {
  test.describe(`amber classic theme at ${size(viewport)}`, () => {
    test('chosen from Options with the keyboard, kept across a reload, axe clean on HOME, REG, JOBS and the open menu in both looks', async ({ page }) => {
      const watch = await start(page, viewport)
      for (const look of ['standard', 'amber-classic'] as const) {
        if (look === 'amber-classic') {
          // Options is a button: Enter opens it, the group follows in Tab order, Space presses a toggle.
          await frameOptions(page).focus()
          await page.keyboard.press('Enter')
          const group = page.getByRole('group', { name: 'Theme' })
          await expect(group).toBeVisible()
          await group.getByRole('button', { name: 'Amber classic theme' }).focus()
          await page.keyboard.press('Space')
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic')
          await expect(group.getByRole('button', { name: 'Amber classic theme' })).toHaveAttribute('aria-pressed', 'true')
          expect(await axeViolations(page), 'axe with the Options menu open in amber classic').toEqual([])
          await page.keyboard.press('Escape')
          await page.reload()
          await expect(page.getByRole('contentinfo')).toContainText('KILL off')
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic')
        } else {
          await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
        }
        expect(await axeViolations(page), `axe on HOME, ${look}`).toEqual([])
        await shot(page, `home-${look}`, viewport)
        for (const [line, code] of [['REG', 'REG'], ['JOBS', 'JOBS']] as const) {
          await openScreen(page, line, code)
          expect(await axeViolations(page), `axe on ${code}, ${look}`).toEqual([])
          await shot(page, `${code.toLowerCase()}-${look}`, viewport, code === 'JOBS' ? jobsDynamic(page) : [])
        }
        await runLine(page, 'HOME')
        await settle(page)
      }
      // back to the standard look from the same menu
      await chooseTheme(page, 'Standard theme')
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
      await expect(frameOptions(page)).toBeVisible()
      await expectCleanFlow(page, watch)
    })
  })
}
