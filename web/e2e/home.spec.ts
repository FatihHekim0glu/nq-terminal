// HOME and HELP E2E (TASKS 7.4, look spec 7.1 and 7.12), against the fixture-mode backend:
// - HOME opens the 2x2 grid; panel 3 (`3-EQ [B]`) is the launchpad equity panel, whose tiles equal the
//   API's panel values to the displayed precision, with the tag and the basis and unit in words;
// - link groups retarget across HOME panels: a new panel opened with Shift+Enter joins the focused
//   panel's group, and a command in one panel of the group retargets every panel of it (A and B);
// - HELP opens one function's page from the contents rail and by Number <GO>; its examples run;
// - a HOME panel on its own (Shift+Enter HOME) is the numbered launchpad index;
// - axe is clean with the WCAG 2.2 AA tags, there are no console errors, and every request is a
//   same-origin GET; baselines of panel 3 and a HELP page at 1920x1080 and 1366x768.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }] as const

interface PanelBody {
  readonly context: { readonly name: string }
  readonly on_capital: boolean
  readonly n: number
  readonly sharpe: number | null
  readonly bench_sharpe: number | null
  readonly max_drawdown: number | null
  readonly bench_max_drawdown: number | null
  readonly tag: string
  readonly basis: string
  readonly basis_label: string
  readonly unit: string
  readonly equity_unit: string
  /** The tear sheet's alpha tiles (alpha_annual in % per year, alpha_t), as the panel serves them. */
  readonly alpha: ReadonlyArray<{ readonly key: string; readonly value: number | null }>
}

interface Watch {
  readonly requests: Request[]
  readonly errors: string[]
}

function watch(page: Page): Watch {
  const requests: Request[] = []
  const errors: string[] = []
  page.on('request', (r) => requests.push(r))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { requests, errors }
}

const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })
const panelTitles = (page: Page) => page.getByRole('main', { name: 'Workspace' }).locator('[data-nqt-title]')
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const panelBody = (page: Page, title: string) => page.getByRole('group', { name: `${title} content`, exact: true })
const status = (page: Page) => page.getByRole('contentinfo')

async function titles(page: Page): Promise<(string | null)[]> {
  return panelTitles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-nqt-title')))
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(panelTitles(page)).toHaveCount(HOME_TITLES.length)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function run(page: Page, line: string, newPanel = false): Promise<void> {
  const input = commandLine(page)
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  await input.fill(line)
  await input.press(newPanel ? 'Shift+Enter' : 'Enter')
  await expect(input).toHaveValue('')
}

/** The tile faces the panel must show for an API body (KpiTile's fixed decimals, never "-0"). */
function expectedFaces(p: PanelBody): string[] {
  const fixed = (v: number | null, d: number, suffix = '') => {
    if (v === null) return '--'
    const raw = v.toFixed(d)
    const text = /^-0(\.0+)?$/.test(raw) ? raw.slice(1) : raw
    // KPI tiles group thousands (-50,240.00).
    const [whole = '', frac] = text.split('.')
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${frac === undefined ? grouped : `${grouped}.${frac}`}${suffix}`
  }
  const dd = (v: number | null) => (p.on_capital ? fixed(v === null ? null : v * 100, 1, '%') : fixed(v, 2))
  const alpha = p.alpha.map((a) => {
    if (a.key !== 'alpha_annual') return fixed(a.value, 2)
    const face = fixed(a.value, 2, '%')
    return a.value !== null && Number(a.value.toFixed(2)) > 0 ? `+${face}` : face
  })
  return [fixed(p.sharpe, 2), fixed(p.bench_sharpe, 2), dd(p.max_drawdown), dd(p.bench_max_drawdown), ...alpha, fixed(p.n, 0)]
}

async function apiPanel(page: Page, name: string): Promise<PanelBody> {
  const reply = await page.request.get(`/api/analytics/hypothesis/${name}/panel`)
  expect(reply.status()).toBe(200)
  return (await reply.json()) as PanelBody
}

async function expectTilesMatch(page: Page, title: string, name: string): Promise<void> {
  const body = await apiPanel(page, name)
  const tiles = panel(page, title).getByRole('list', { name: `Key figures for ${name}` })
  await expect(tiles).toBeVisible()
  await expect(tiles.locator('.kpi-value')).toHaveText(expectedFaces(body))
  await expect(tiles.locator('.kpi-tag').first()).toHaveText(body.tag)
  await expect(panel(page, title).getByText(`Basis ${body.basis}, ${body.basis_label}. Returns in ${body.unit}; the equity pane plots ${body.equity_unit}.`)).toBeVisible()
}

async function expectAxeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

function expectSameOriginGets(watched: Watch, baseURL: string): void {
  const origin = new URL(baseURL).origin
  const bad = watched.requests.filter((r) => r.method() !== 'GET' || new URL(r.url()).origin !== origin)
  expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

test.describe('HOME (7.4)', () => {
  test('opens the 2x2 grid; panel 3 shows the equity panel with the API values, tag, basis and unit', async ({ page, baseURL }) => {
    const watched = watch(page)
    await openHome(page)
    expect(await titles(page)).toEqual(HOME_TITLES)
    const eq = panel(page, 'volmanaged_v0 EQ')
    await expect(eq.locator('.ptitle-no')).toHaveText('3-EQ')
    await expect(eq.getByRole('toolbar', { name: 'Equity curve functions' })).toBeVisible()
    await expectTilesMatch(page, 'volmanaged_v0 EQ', 'volmanaged_v0')
    await expect(eq.getByRole('img').first()).toHaveAttribute('aria-label', /volmanaged_v0/)
    await expect(eq.locator('[aria-busy="true"]')).toHaveCount(0)
    const panelReads = watched.requests.filter((r) => new URL(r.url()).pathname === '/api/analytics/hypothesis/volmanaged_v0/panel')
    expect(panelReads.length).toBeGreaterThanOrEqual(1)
    await expectAxeClean(page)
    expectSameOriginGets(watched, baseURL ?? '')
    expect(watched.errors).toEqual([])
  })

  test('link group B retargets across HOME panels: a new B panel follows panel 3', async ({ page }) => {
    await openHome(page)
    await panelBody(page, 'volmanaged_v0 EQ').focus()
    await run(page, 'DD', true)
    expect(await titles(page)).toContain('volmanaged_v0 DD')
    await panelBody(page, 'volmanaged_v0 EQ').focus()
    await run(page, 'overnight_v0 EQ')
    await expect(panel(page, 'overnight_v0 EQ')).toBeVisible()
    await expect(panel(page, 'overnight_v0 DD')).toBeVisible()
    await expect(status(page)).toContainText('B overnight_v0')
    await expectTilesMatch(page, 'overnight_v0 EQ', 'overnight_v0')
    // A one-contract series: the drawdown tiles are in USD, never a percent.
    await expect(panel(page, 'overnight_v0 EQ').locator('.kpi-value').nth(2)).not.toContainText('%')
  })

  test('link group A retargets across HOME panels: GP and a new A panel follow each other', async ({ page }) => {
    await openHome(page)
    await panelBody(page, 'NQ GP 1d').focus()
    await run(page, 'DES', true)
    await expect(panel(page, 'NQ DES')).toBeVisible()
    await panelBody(page, 'NQ GP 1d').focus()
    await run(page, 'ES GP')
    await expect(panel(page, 'ES GP')).toBeVisible()
    await expect(panel(page, 'ES DES')).toBeVisible()
    await expect(status(page)).toContainText('A ES1 Index')
    // MON takes the universe, not an instrument, so it keeps 27F.
    await expect(panel(page, '27F MON')).toBeVisible()
    // Group B is untouched.
    await expect(panel(page, 'volmanaged_v0 EQ')).toBeVisible()
  })

  test('a HOME panel on its own is the numbered launchpad; its links run the HOME lines', async ({ page }) => {
    await openHome(page)
    await panelBody(page, 'REG').focus()
    await run(page, 'HOME', true)
    const launch = panel(page, 'HOME')
    const grid = launch.getByRole('table', { name: 'Launchpad: numbered for <GO>' })
    await expect(grid).toBeVisible()
    await expect(grid.locator('.ix')).toHaveText(['1)', '2)', '3)', '4)', '5)', '6)', '7)', '8)', '9)'])
    await expectAxeClean(page)
    await launch.getByRole('button', { name: 'LIVE <GO>' }).click()
    await expect(panel(page, 'LIVE')).toBeVisible()
  })

  for (const size of SIZES) {
    test(`no number is cut in the HOME monitor at ${size.width}x${size.height} (look spec 4.8)`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHome(page)
      const mon = panel(page, '27F MON')
      await expect(mon.locator('td.num').first()).toBeVisible()
      // A numeric cell or a header shows its whole text: no ellipsis, the grid scrolls instead.
      const cut = await mon.locator('td.num, th').evaluateAll((cells) =>
        cells.filter((c) => c.scrollWidth > c.clientWidth).map((c) => c.textContent ?? ''))
      expect(cut).toEqual([])
    })
  }

  for (const size of SIZES) {
    test(`panel 3 baseline at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHome(page)
      const eq = panel(page, 'volmanaged_v0 EQ')
      await expect(eq.getByRole('list', { name: 'Key figures for volmanaged_v0' })).toBeVisible()
      await expect(eq.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(eq).toHaveScreenshot(`home-eq-${size.width}x${size.height}.png`)
    })
  }
})

test.describe('HELP pages (7.4)', () => {
  test('a contents item opens that function\'s page; an example runs; Back returns to the index', async ({ page, baseURL }) => {
    const watched = watch(page)
    await openHome(page)
    await run(page, 'HELP')
    const help = panel(page, 'HELP')
    await help.getByRole('navigation', { name: 'Help contents' }).getByRole('list', { name: 'Mnemonics' }).getByRole('button', { name: /GP$/ }).first().click()
    const page1 = help.getByRole('region', { name: 'Help for GP' })
    await expect(page1).toBeVisible()
    await expect(page1.getByText('Getting started > Help > Help for GP')).toBeVisible()
    await expect(page1.getByRole('heading', { level: 3 })).toHaveText('GP')
    await expectAxeClean(page)
    await page1.getByRole('button', { name: 'Back to the help index' }).click()
    await expect(help.getByRole('table', { name: 'Mnemonic index, numbered for <GO>' })).toBeVisible()
    expectSameOriginGets(watched, baseURL ?? '')
    expect(watched.errors).toEqual([])
  })

  test('Number <GO> opens topic N; 41 <GO> runs the page\'s first example', async ({ page }) => {
    await openHome(page)
    await run(page, 'HELP')
    // The HELP screen loads as its own chunk; its numbers exist once its index is on screen.
    await expect(panel(page, 'HELP').getByRole('table', { name: 'Mnemonic index, numbered for <GO>' })).toBeVisible()
    await panelBody(page, 'HELP').focus()
    await run(page, '2')
    await expect(panel(page, 'HELP').getByRole('region', { name: 'Help for GP' })).toBeVisible()
    await panelBody(page, 'HELP').focus()
    await run(page, '41')
    // A one-panel screen replaces the focused HELP panel in place (planOpen): the screen label keeps the layout that was loaded.
    await expect(panel(page, 'NQ GP')).toBeVisible()
    await expect(panel(page, 'HELP')).toHaveCount(0)
    await expect(status(page)).toContainText('Screen HELP')
  })

  for (const size of SIZES) {
    test(`HELP page baseline at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHome(page)
      await run(page, 'HELP')
      const help = panel(page, 'HELP')
      await help.getByRole('navigation', { name: 'Help contents' }).getByRole('list', { name: 'Mnemonics' }).getByRole('button', { name: /HOME$/ }).click()
      await expect(help.getByRole('region', { name: 'Help for HOME' })).toBeVisible()
      await expect(help).toHaveScreenshot(`help-home-${size.width}x${size.height}.png`)
    })
  }
})
