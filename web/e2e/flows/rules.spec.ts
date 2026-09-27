// Rule flows (TASKS 8.1; UI_SPEC section 6, honesty labels; ARCHITECTURE section 9, "2022+ leak"):
// the nq-lab project rules as a person meets them while working through the terminal, from the
// command line, against the fixture-mode backend.
// - The fence: every price answer the screens receive stops at 2021-12-31, charts say where the fence
//   is, and a date past it is refused with the gate's own words and no price request.
// - Tags: values read from a registered result are [PRE-REG], values the terminal computes are
//   [POST HOC]; the sealed window is [SPENT]; the dsr field is named the Sharpe difference.
// - Rule 4: an unbalanced run reads [UNUSABLE: BALANCE] wherever it appears and no equity is drawn.
// - Plumbing rows are hatched with the literal banner and never reach a performance view.
// Each flow ends clean (support.ts expectCleanFlow): GET only, no console error, fence held.
import { expect, test, type Page } from '@playwright/test'
import { isPriceEndpoint } from './scan.ts'
import {
  commandLine,
  expectCleanFlow,
  openScreen,
  openTerminal,
  panel,
  PLUMBING_BANNER,
  runLine,
  settle,
  watchFlow,
  type FlowWatch,
} from './support.ts'

const RUN = 'nt_volmanaged_v0_fixture_m1'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'
const BOOK = 'volmanaged_paper_journal.jsonl'
const POST_HOC_NOTE = 'descriptive, in-sample, not a registered test'

interface JournalPage {
  readonly items: ReadonlyArray<{ readonly plumbing: boolean; readonly data: Readonly<Record<string, unknown>> }>
}
interface Performance {
  readonly date: readonly string[]
}

async function apiJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBe(true)
  return (await response.json()) as T
}

const priceRequests = (watch: FlowWatch): string[] =>
  watch.requests.map((r) => new URL(r.url())).filter((u) => isPriceEndpoint(u.pathname)).map((u) => decodeURIComponent(u.href))

test.describe('rule flows', () => {
  test('the fence: GP, GIP, DES, MON and CORR serve nothing past 2021-12-31; a date past it is refused', async ({ page }) => {
    const watch = await watchFlow(page)
    // HOME and GIP each wait for their price answers, so the fence scan reads real bodies. Other
    // screens may answer from the query cache (NQ daily bars are shared by HOME, GP and DES).
    const answered = (path: string) => page.waitForResponse((r) => new URL(r.url()).pathname === path && r.status() === 200)
    await Promise.all([answered('/api/bars'), answered('/api/market/universe'), openTerminal(page)])
    await openScreen(page, 'NQ GP', 'GP')
    const gp = panel(page, 'NQ GP').getByRole('img', { name: /^NQ1 Index/ })
    await expect(gp).toHaveAttribute('aria-label', /The 2022-01-01 fence follows the last bar\./)
    await expect(gp).toHaveAttribute('aria-label', /to 2021-12-3[01];/)
    await Promise.all([answered('/api/bars'), openScreen(page, 'NQ GIP 2019-03-14', 'GIP')])
    await openScreen(page, 'NQ DES', 'DES')
    await openScreen(page, '27F MON', 'MON')
    await openScreen(page, '27F CORR', 'CORR')

    // A date past the fence: the gate's refusal in the panel, and no price request for it.
    const before = priceRequests(watch).length
    await runLine(page, 'NQ GIP 2022-03-14')
    await settle(page)
    const refused = panel(page, 'NQ GIP 2022-03-14')
    await expect(refused).toContainText('leaves the in-sample window')
    await expect(refused.getByRole('img', { name: /^NQ1 Index/ })).toHaveCount(0)
    expect(priceRequests(watch).length).toBe(before)

    // Price reads happened on the way, none of them named a date past the fence, and every answer
    // stopped at it (expectCleanFlow reads each body).
    const prices = priceRequests(watch)
    expect(prices.length).toBeGreaterThan(4)
    // Bodies are read for every price answer that arrived (a request cut short by the next screen has none).
    expect(watch.priceReads.length).toBeGreaterThanOrEqual(3)
    expect(prices.filter((u) => /20(2[2-9]|[3-9]\d)-\d\d-\d\d/.test(u) && !/end=2022-01-01(T00:00:00Z)?(&|$)/.test(u))).toEqual([])
    await expectCleanFlow(page, watch)
  })

  test('tags: [PRE-REG] for registered values, [POST HOC] for computed ones, [SPENT] for the sealed window', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)

    await openScreen(page, 'volmanaged_v0 DES', 'DES')
    const des = panel(page, 'volmanaged_v0 DES')
    await expect(des.getByTestId('des-head')).toContainText('[PRE-REG]')
    await expect(des.getByTestId('des-spent')).toContainText('[SPENT]')
    // Number <GO> opens the Pass checks tab: the screen JSON's dsr field is the Sharpe difference.
    await runLine(page, '2')
    const checks = des.getByRole('table', { name: /Pass checks of volmanaged_v0/ })
    await expect(checks).toBeVisible()
    await expect(checks.getByRole('cell', { name: /^Sharpe difference \(m - BH\)/ }).first()).toBeVisible()
    await expect(checks.getByRole('cell', { name: /^dsr\b/i })).toHaveCount(0)

    await openScreen(page, `${RUN} EQ`, 'EQ')
    const tiles = panel(page, `${RUN} EQ`).getByRole('list', { name: 'Tear sheet key figures' })
    await expect(tiles).toContainText('[POST HOC]')
    await openScreen(page, 'volmanaged_v0 EQ', 'EQ')
    await expect(panel(page, 'volmanaged_v0 EQ')).toContainText('[PRE-REG]')

    for (const [line, code] of [['27F MON', 'MON'], ['27F CORR', 'CORR'], ['NQ GP', 'GP']] as const) {
      await openScreen(page, line, code)
      await expect(panel(page, line), line).toContainText('[POST HOC]')
      await expect(panel(page, line), line).toContainText(POST_HOC_NOTE)
    }

    await openScreen(page, 'OOS', 'OOS')
    const card = panel(page, 'OOS').getByRole('region', { name: 'Sealed window openings' })
    await expect(card).toContainText('CLOSED')
    await expect(card).toContainText('[SPENT]')
    await expectCleanFlow(page, watch)
  })

  test('rule 4: an unbalanced run reads [UNUSABLE: BALANCE] in RUNS and RUN, and no equity is drawn or asked for', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await openScreen(page, 'RUNS', 'RUNS')
    const row = panel(page, 'RUNS').getByRole('row').filter({ hasText: UNBALANCED })
    await expect(row).toContainText('[UNUSABLE: BALANCE]')

    await openScreen(page, `${UNBALANCED} RUN`, 'RUN')
    const run = panel(page, `${UNBALANCED} RUN`)
    await expect(run.getByText('[UNUSABLE: BALANCE]').first()).toBeVisible()
    await expect(run.getByText('No equity line for an unusable run (rule 4).')).toBeVisible()
    await expect(run.locator('.chart-a11y-figure[role="img"]')).toHaveCount(0)
    const asked = watch.requests.map((r) => r.url()).filter((u) => u.includes(UNBALANCED) && /\/equity|\/panel/.test(u))
    expect(asked).toEqual([])
    await expectCleanFlow(page, watch)
  })

  test('rule 4 on the tear sheet: EQ for an unbalanced run reads [UNUSABLE: BALANCE] with no failed request', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await openScreen(page, `${UNBALANCED} EQ`, 'EQ')
    const eq = panel(page, `${UNBALANCED} EQ`)
    await expect(eq.getByRole('alert')).toContainText('[UNUSABLE: BALANCE]')
    await expect(eq.getByRole('img')).toHaveCount(0)
    // The screen knows the run is unusable from GET /api/runs; asking the analytics route for it
    // anyway returns 422, which the browser logs as a console error.
    await expectCleanFlow(page, watch)
  })

  test('plumbing: hatched rows carry the banner in JRNL and LIVE, and never reach the performance view', async ({ page }) => {
    const watch = await watchFlow(page)
    const perf = await apiJson<Performance>(page, '/api/live/performance')
    const closes = await apiJson<JournalPage>(page, `/api/live/journal?file=${encodeURIComponent(BOOK)}&type=close&limit=5000`)
    const plumbingDates = closes.items.filter((r) => r.plumbing).map((r) => String(r.data.date))
    expect(plumbingDates.length).toBeGreaterThan(0)
    await openTerminal(page)
    await openScreen(page, 'LIVE', 'LIVE')

    const jrnl = panel(page, 'JRNL')
    const hatched = jrnl.locator('tr.plumbing-row')
    await expect(hatched.first()).toBeVisible()
    for (let i = 0; i < (await hatched.count()); i += 1) await expect(hatched.nth(i)).toContainText(PLUMBING_BANNER)

    const live = panel(page, 'LIVE')
    const routes = live.getByRole('table', { name: /^Routes: one per journal close row/ })
    await expect(routes.locator('tr.plumbing-row').first()).toContainText(PLUMBING_BANNER)
    const chart = live.getByRole('img', { name: /Target \(ct\)/ })
    const summary = (await chart.getAttribute('aria-label')) ?? ''
    expect(summary).toContain(`from ${perf.date[0]}`)
    const recon = live.getByRole('table', { name: 'Reconciliation, performance rows only' })
    await expect(recon.getByRole('row')).toHaveCount(perf.date.length + 1)
    for (const d of plumbingDates) {
      expect(perf.date).not.toContain(d)
      expect(summary).not.toContain(d)
      await expect(recon).not.toContainText(d)
    }
    await expect(commandLine(page)).toHaveValue('')
    await expectCleanFlow(page, watch)
  })
})
