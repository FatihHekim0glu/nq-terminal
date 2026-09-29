// Performance budgets (TASKS 8.3), each measured with a CDP trace against the fixture-mode backend of
// playwright.config.ts (the real-data run is smoke.real.ts, started by terminal/scripts/smoke_real.ps1):
// - HOME first render under 1.5 s: from navigation start to the four panels showing their data, painted,
//   in a fresh browser context each time (empty cache); the median of three loads is held to the budget.
//   The budgets run alone on a freshly started backend (`pnpm e2e:perf`), so HOME's API reads are made once,
//   unmeasured, before the loads: a running terminal's backend is warm, and the fixture double builds each
//   series' synthetic bars on first use (seconds in all); before improvement run 3 the other specs ran first and
//   did the same. The browser side stays cold: every measured load is a fresh context with an empty cache;
// - GIP pan and zoom near 60 fps: one wheel step, then one drag step, per animation frame on the intraday
//   chart; frames are the compositor's DrawFrame events in the trace (trace.ts, judgeFrames);
// - an 8,411-fill grid under 500 ms: the RUN 3) Fills tab (first page of 5,000 rows), a sort on Price,
//   and the second page (3,411 rows), each from the click to the painted grid. The fixture runs have 11
//   fills, so /api/runs/<run>/fills is answered in the page with 8,411 synthetic rows in the API's shape;
//   the real run's 8,411 fills are measured by the real-data smoke run.
// Every run also checks there are no console errors and that every request is a same-origin GET.
// The offline project (`pnpm e2e:offline:perf`, one worker) runs the same budgets against the Node-side demo API. Two
// differences, both named: HOME's warm-up is left out (its first read, /api/market/universe?window=22, is refused by the
// demo, which serves the window 252 table only, and the median of three cold loads is what the budget judges), and the
// GIP test is skipped because the demo serves no 1m bars.
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'
import { OFFLINE } from '../target.ts'
import { BUDGETS } from './trace.ts'
import { canvasPrint, measureFills, measureHome, measurePanZoom, median, offOriginOrNotGet, paint, report, runLine, settle, watch } from './pages.ts'

const FIXTURE_RUN = 'nt_dtsmom_v0_fixture_ts1'
const GIP_LINE = 'NQ GIP 2011-01-20'
const HOME_LOADS = 3
const ROOTS = ['ES', 'NQ', 'YM', 'ZT', 'ZF', 'ZN', 'ZB', '6E', '6J', '6B', '6A', '6C', '6S', 'CL', 'NG', 'HO', 'RB', 'GC', 'SI', 'HG', 'ZC', 'ZS', 'ZW', 'ZL', 'ZM', 'LE', 'HE']

interface SyntheticFill {
  readonly ts: string
  readonly ts_epoch_s: number
  readonly instrument: string
  readonly side: 'BUY' | 'SELL'
  readonly qty: number
  readonly px: number
  readonly commission: string
  readonly commission_float: number
  readonly position_id: string
  readonly order_id: string
  readonly tags: string
}

/** 8,411 fills shaped like a dtsmom book's: 27 roots, one rebalance day a month from 2012. */
function syntheticFills(total: number): SyntheticFill[] {
  const first = Date.UTC(2012, 0, 4) / 1000
  return Array.from({ length: total }, (_, i) => {
    const root = ROOTS[i % ROOTS.length] ?? 'NQ'
    const day = first + Math.floor(i / ROOTS.length) * 86_400 * 7
    const qty = 1 + ((i * 37) % 180)
    const cost = qty * 7.5
    return {
      ts: `${new Date(day * 1000).toISOString().slice(0, 19)}.000000000Z`,
      ts_epoch_s: day,
      instrument: `${root}.XCME`,
      side: i % 3 === 0 ? 'SELL' : 'BUY',
      qty,
      px: Math.round((100 + ((i * 7919) % 400_000) / 100) * 100) / 100,
      commission: cost.toFixed(4),
      commission_float: cost,
      position_id: `DtsMom-${String(Math.floor(i / 54)).padStart(3, '0')}-${root}-L1`,
      order_id: `O-${i}`,
      tags: i % 5 === 0 ? 'ROLL' : 'REBAL',
    }
  })
}

async function serveSyntheticFills(page: Page, run: string): Promise<void> {
  const all = syntheticFills(BUDGETS.fillsRows)
  await page.route(`**/api/runs/${run}/fills?*`, async (route: Route) => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const limit = Number(url.searchParams.get('limit') ?? '500')
    const items = all.slice(offset, offset + limit)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, offset, limit, total: all.length }) })
  })
}

/** HOME's API reads once, unmeasured: the universe at both windows, the catalog, RV22 and every MON 2Day cell. */
async function warmBackend(request: APIRequestContext): Promise<void> {
  const get = async (path: string) => expect((await request.get(path)).ok(), path).toBe(true)
  const universe = (await (await request.get('/api/market/universe?window=22')).json()) as { rows: Array<{ symbol: string }> }
  await Promise.all([get('/api/market/universe?window=252'), get('/api/data/catalog'), get('/api/market/rv?symbol=NQ.V.0&window=22')])
  await Promise.all(universe.rows.map((r) => get(`/api/market/two-day?symbols=${r.symbol}`)))
}

test.describe('performance budgets (fixture backend, CDP trace)', () => {
  test.describe.configure({ timeout: 180_000 })

  test('HOME first render is under 1.5 s', async ({ browser, request }, info) => {
    if (!OFFLINE) await warmBackend(request)
    const loads = []
    for (let i = 0; i < HOME_LOADS; i += 1) loads.push(await measureHome(browser, info, `home-${i + 1}`))
    const ready = median(loads.map((l) => l.readyMs))
    report(info, 'home-first-render', { budgetMs: BUDGETS.homeFirstRenderMs, medianReadyMs: Math.round(ready), loads: loads.map((l) => ({ frameMs: Math.round(l.frameMs), readyMs: Math.round(l.readyMs), settledMs: Math.round(l.settledMs), fcpMs: l.fcpMs === null ? null : Math.round(l.fcpMs), slowest: l.slowest })) })
    for (const l of loads) expect(l.frameMs).toBeLessThanOrEqual(l.readyMs)
    expect(ready).toBeLessThan(BUDGETS.homeFirstRenderMs)
  })

  test('GIP pan and zoom run near 60 fps', async ({ browser, page, baseURL }, info) => {
    test.skip(OFFLINE, '1m bars are not in the demo dataset (src/demo/data/market.ts serves daily vendor bars only)')
    const w = watch(page)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
    const gip = await runLine(page, GIP_LINE)
    await settle(page)
    const chart = gip.getByRole('img', { name: /^NQ1 Index: \d+ 1-minute bars/ })
    await expect(chart).toBeVisible()
    const readout = gip.getByRole('status', { name: 'Crosshair readout' })
    const shownBefore = await readout.textContent()
    const before = await canvasPrint(chart)
    const result = await measurePanZoom(browser, page, info, chart, 'gip-pan-zoom')
    await paint(page)
    report(info, 'gip-pan-zoom', { zoom: { ...result.zoom.stats, longTasks: result.zoom.long }, pan: { ...result.pan.stats, longTasks: result.pan.long } })
    // The gestures really moved the chart: fewer bars shown after the zoom, a different picture after both.
    await expect(readout).not.toHaveText(shownBefore ?? '')
    expect(await canvasPrint(chart)).not.toBe(before)
    expect(result.zoom.failures).toEqual([])
    expect(result.pan.failures).toEqual([])
    expect(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, new URL(baseURL ?? '').origin)).toEqual([])
  })

  test('an 8,411-fill grid opens, sorts and pages under 500 ms each', async ({ browser, page, baseURL }, info) => {
    const w = watch(page)
    await serveSyntheticFills(page, FIXTURE_RUN)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
    const run = await runLine(page, `${FIXTURE_RUN} RUN`)
    await settle(page)
    const t = await measureFills(browser, page, info, run, FIXTURE_RUN, 'fills-8411')
    report(info, 'fills-grid', { budgetMs: BUDGETS.fillsGridMs, ...t })
    await expect(run.getByRole('grid', { name: `Fills of ${FIXTURE_RUN}, ${BUDGETS.fillsRows} rows` })).toBeVisible()
    expect(t.firstPageRows + t.secondPageRows).toBe(BUDGETS.fillsRows)
    expect(t.openMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect(t.sortMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect(t.pageMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, new URL(baseURL ?? '').origin)).toEqual([])
  })
})
