// Smoke of the in-page demo build under Playwright (roadmap #18, slice 1; project offline-demo of
// playwright.offline.config.ts). `vite build --mode demo` answers /api inside the page (src/demo/boot.tsx), so
// there is no backend and no server-side API behind it: the terminal boots on the demo dataset and the A6 command
// lines settle. Named .offline.ts and not .spec.ts on purpose: playwright.config.ts (the Windows run) has testDir
// './e2e' and would run a *.spec.ts here against the fixture backend, where it fails
// (scripts/playwrightOffline.test.ts).
//
// The page's own fetch is replaced, so Playwright sees no /api request at all: the checks below say exactly that.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openScreen, openTerminal, panel, panels, status, watchFlow, type FlowWatch } from '../flows/support.ts'
import { AXE_TAGS } from '../gallery.ts'

/** The A6 command lines, each with the mnemonic the status line names once the screen is open. */
const A6_LINES: ReadonlyArray<readonly [line: string, code: string]> = [
  ['REG', 'REG'],
  ['MT', 'MT'],
  ['volmanaged_v0 DES', 'DES'],
  ['RUNS', 'RUNS'],
  ['nt_dtsmom_v0_fixture_ts1 RUN', 'RUN'],
  ['volmanaged_v0 EQ', 'EQ'],
  ['volmanaged_v0 DD', 'DD'],
  ['volmanaged_v0 RET', 'RET'],
  ['LEDG', 'LEDG'],
  ['OOS', 'OOS'],
  ['LIVE', 'LIVE'],
  ['JRNL', 'JRNL'],
  ['27F MON', 'MON'],
  ['27F CORR', 'CORR'],
  ['NQ GP', 'GP'],
  ['HELP', 'HELP'],
]

/** An alert inside a panel: a screen that could not show its data. Dockview's own empty live region is outside the panels. */
const alerts = (page: Page) => page.locator('[data-nqt-panel] [role="alert"]')

/** Every request a GET of this page's own origin, none for /api (the demo answers those in the page), no error, no CSP report. */
async function expectDemoClean(page: Page, watch: FlowWatch): Promise<void> {
  const origin = new URL(page.url()).origin
  expect(watch.requests.length).toBeGreaterThan(0)
  const api = watch.requests.filter((r) => {
    const { pathname } = new URL(r.url())
    return pathname === '/api' || pathname.startsWith('/api/')
  })
  expect(api.map((r) => `${r.method()} ${r.url()}`), 'the demo answers /api inside the page').toEqual([])
  const strays = watch.requests.filter((r) => r.method() !== 'GET' || new URL(r.url()).origin !== origin)
  expect(strays.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
  expect(watch.errors).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __nqtCsp: string[] }).__nqtCsp)).toEqual([])
}

test.describe('in-page demo build', () => {
  test('HOME boots on demo data: four panels, no alert, the safety labels, GET only, axe clean', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await expect(panels(page)).toHaveCount(4)
    await expect(alerts(page)).toHaveCount(0)
    // The demo says what it is, twice: the frame strip's flag, and the status line's data source.
    await expect(page.getByRole('group', { name: 'Safety' })).toContainText('DEMO DATA')
    await expect(status(page)).toContainText('FIXTURE DATA')
    await expect(status(page)).toContainText('READ ONLY')
    await expect(status(page)).toContainText('NO ORDER PATH')
    await expectDemoClean(page, watch)
    const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  })

  for (const [line, code] of A6_LINES) {
    test(`${line} settles with no alert`, async ({ page }) => {
      const watch = await watchFlow(page)
      await openTerminal(page)
      await openScreen(page, line, code)
      await expect(alerts(page)).toHaveCount(0)
      await expectDemoClean(page, watch)
    })
  }

  test('LIVE reads its stream as live, server events (the demo event source plays the stream)', async ({ page }) => {
    await openTerminal(page)
    await openScreen(page, 'LIVE', 'LIVE')
    await expect(panel(page, 'LIVE')).toContainText('live, server events')
  })

  test('RET of a hypothesis draws the SV7 Sharpe difference chart, named for what it shows', async ({ page }) => {
    await openTerminal(page)
    await openScreen(page, 'volmanaged_v0 RET', 'RET')
    await expect(page.getByRole('img', { name: /Sharpe difference \(m - BH\)/ })).toHaveCount(1)
  })
})
