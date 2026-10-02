// Shared steps for the Phase 8 visual and accessibility pass (TASKS 8.2). Every P0 screen is opened in
// the workspace against the fixture-mode backend (playwright.config.ts) at 1920x1080 and 1366x768, and:
// - every chart is audited: each drawn canvas sits inside a ChartA11y figure (role="img") whose name is
//   a data summary, and each figure has a Table toggle that swaps it for a real table with a caption,
//   column headers and rows (UI_SPEC section 9, "Every canvas chart");
// - axe runs with the WCAG 2.2 AA tags at rest, with the command dropdown open, and with every chart in
//   its table view while the dropdown is open;
// - a screenshot baseline is taken with the command dropdown open.
// SCREENS is the Windows run's list (the fixture-mode backend). OFFLINE_SCREENS, at the end, is the offline run's
// (playwright.offline.config.ts, the Node-side demo API): the same screens under the demo's own ids and counts, the
// screens of roadmap waves 1 to 11, and a named skip where the demo dataset lacks a body.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'
import { AXE_TAGS } from '../gallery.ts'

export interface Viewport {
  readonly width: number
  readonly height: number
}

export const VIEWPORTS: readonly Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]

// 14:02:11 ET (look spec 4.10), the frozen status-line time the other baselines use.
export const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')

/** What the command dropdown is opened with: the suggestion list the shell spec also checks. */
export const DROPDOWN_QUERY = 'RE'

export interface ScreenCase {
  /** Baseline name and test title. */
  readonly name: string
  /** The command line that opens the screen; null for HOME, which the app opens on load. */
  readonly line: string | null
  /** The mnemonic the status line names once the screen is open. */
  readonly code: string
  /** The charts the screen draws with the fixture data (the audit checks the count, so it is never empty). From P1
   *  the counts include the P1 figures: the cone (EQ), the QQ plot (RET), the BR4 scatter (RR), the DSR ladder (MT, and
   *  REG through its MT panel) and a run's trade paths (MAE, MFE, holding times); a hypothesis RET also draws its SV7
   *  Sharpe difference ladder. */
  readonly charts: number
  /** A second step once `line` has opened the screen: typed into the command line (a Number <GO> to a numbered tab), and
   *  the tab panel it names must then be on screen. Read by the offline entries only; SCREENS has none. */
  readonly then?: ScreenStep
  /** Offline only: why the demo dataset cannot show this screen (the body it lacks). The case is skipped with this reason. */
  readonly offlineSkip?: string
  /** Offline only: drives the screen's own parameter fields to the request the demo dataset holds, after the line (and `then`)
   *  has opened it. SCREENS has none. */
  readonly prepare?: (page: Page) => Promise<void>
}

/** The line that follows a screen's own line, e.g. `92` for REG's Evidence tab. */
export interface ScreenStep {
  /** The line typed after the screen is open. */
  readonly line: string
  /** The accessible name of the tab panel that must be on screen once the line has run. */
  readonly tabpanel: string
  /** Done before the line is typed, on the screen as it opened (e.g. marking runs for the compare tab). */
  readonly before?: (page: Page) => Promise<void>
}

const HYP = 'volmanaged_v0'
const RUN = 'nt_volmanaged_v0_fixture_m1'

/** Every P0 screen (src/chrome/WorkspaceScreens.tsx BUILT_SCREENS), with both DES and tear variants. */
export const SCREENS: readonly ScreenCase[] = [
  { name: 'HOME', line: null, code: 'HOME', charts: 2 },
  { name: 'GP', line: 'NQ GP', code: 'GP', charts: 1 },
  { name: 'GIP', line: 'NQ GIP 2019-03-14', code: 'GIP', charts: 1 },
  { name: 'MON', line: '27F MON', code: 'MON', charts: 0 },
  { name: 'CORR', line: '27F CORR', code: 'CORR', charts: 2 },
  { name: 'OOS', line: 'OOS', code: 'OOS', charts: 0 },
  { name: 'LIVE', line: 'LIVE', code: 'LIVE', charts: 1 },
  { name: 'JRNL', line: 'JRNL', code: 'JRNL', charts: 0 },
  { name: 'DES-hypothesis', line: `${HYP} DES`, code: 'DES', charts: 1 },
  { name: 'DES-instrument', line: 'NQ DES', code: 'DES', charts: 1 },
  { name: 'REG', line: 'REG', code: 'REG', charts: 2 },
  { name: 'MT', line: 'MT', code: 'MT', charts: 2 },
  { name: 'RUNS', line: 'RUNS', code: 'RUNS', charts: 0 },
  { name: 'RUN', line: `${RUN} RUN`, code: 'RUN', charts: 1 },
  { name: 'LEDG', line: 'LEDG', code: 'LEDG', charts: 0 },
  // 4 charts: the fixture serve's bars sit on another price basis than the run's fills, so TA2 is refused (no MAE or MFE chart).
  { name: 'EQ-run', line: 'smoke_2015_01 EQ', code: 'EQ', charts: 4 },
  { name: 'EQ', line: `${HYP} EQ`, code: 'EQ', charts: 2 },
  { name: 'DD', line: `${HYP} DD`, code: 'DD', charts: 1 },
  { name: 'RET', line: `${HYP} RET`, code: 'RET', charts: 3 },
  // P2 (RG2): RR also draws the trend regime, the NQ close against its mean with the regime strip (one more LineStack).
  { name: 'RR', line: `${HYP} RR`, code: 'RR', charts: 2 },
  { name: 'RR-run', line: 'nt_dtsmom_v0_fixture_ts1 RR', code: 'RR', charts: 5 },
  { name: 'MRET', line: `${HYP} MRET`, code: 'MRET', charts: 2 },
  { name: 'HELP', line: 'HELP', code: 'HELP', charts: 0 },
]

// ---------------------------------------------------------------- the offline run (playwright.offline.config.ts)

/** Marks runs for RUNS' compare basket: a click on the row's name cell makes it the active cell, Space marks it. */
async function markRuns(page: Page, runs: readonly string[]): Promise<void> {
  const grid = page.getByRole('grid', { name: /Nautilus runs/ })
  for (const run of runs) {
    await grid.getByRole('row').filter({ hasText: run }).getByRole('gridcell').nth(1).click()
    await page.keyboard.press('Space')
  }
}

/** Picks an option of one of a screen's dropdown fields, as a person does, and waits for the field to show it. */
async function pickOption(page: Page, code: string, field: string, option: string): Promise<void> {
  const combobox = page.locator(`[data-screen="${code}"]`).getByRole('combobox', { name: field, exact: true })
  await combobox.click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(combobox).toContainText(option)
}

/** The lines that differ from SCREENS because the demo holds the body under another id (src/demo/data). */
const OFFLINE_LINES: Readonly<Record<string, string>> = {
  // The trades, fills and log tables of a run are held for nt_dtsmom_v0_fixture_ts1 only (runs.ts RUN_TRADES, RUN_FILLS, RUN_LOGS); the
  // records of the other runs show without their tables, and the run chart (analytics.ts PANELS) is held for the dtsmom run.
  RUN: 'nt_dtsmom_v0_fixture_ts1 RUN',
  // Run analytics are held for nt_volmanaged_v0_fixture_m1 and smoke_2015_01 only (analytics.ts ANALYTICS, RUN_EXTENDED), not for the dtsmom book,
  // so RR opens the sized volmanaged run. Its run record is held (runs.ts RUN_DETAILS), which the tear sheet reads first.
  'RR-run': 'nt_volmanaged_v0_fixture_m1 RR',
}

/** The chart counts that differ from SCREENS; each names the demo body that draws the difference. */
const OFFLINE_CHART_COUNTS: Readonly<Record<string, number>> = {
  // Two more than the fixture: the tracking chart of the paper book (analytics.ts PAPER_TRACKING, populated) and the LV6 expectation
  // cone (the volmanaged_v0 SV6 bootstrap, HYP_BOOTSTRAP, with the volmanaged run's analytics, RUN_ANALYTICS).
  LIVE: 3,
  // smoke_2015_01 draws its equity chart only. The demo holds its run record and analytics but no trades, costs, exposure or extended body
  // for it (analytics.ts TRADES, COSTS, EXPOSURE and EXTENDED hold the volmanaged and za runs), so its run books say so instead of drawing.
  'EQ-run': 1,
  // The volmanaged run's RR draws its net P&L against slippage ladder, its exposure and turnover pane and its weekday ladder (3). The
  // fixture's dtsmom RR draws 4; the demo holds no excursions or trade paths for the volmanaged run (analytics.ts EXCURSION_VIEWS, TRADE_PATH_VIEWS).
  'RR-run': 3,
  // RG2's trend regime is not in the demo dataset (routes.ts answers its two paths "not in the demo dataset"), so the hypothesis RR
  // keeps the one chart it drew before P2 and the trend card says so.
  RR: 1,
}

/**
 * Screens of SCREENS the demo dataset cannot show, each with the body it lacks (the case is skipped by name, never dropped).
 * Empty since the demo holds the run records of the two runs that have analytics (runs.ts RUN_DETAILS): EQ-run and RR-run draw.
 */
const OFFLINE_SKIPS: Readonly<Record<string, string>> = {}

/**
 * The screens of SCREENS the offline run drives, without GIP (1m bars are not in the demo dataset: market.ts serves daily
 * vendor bars only), under the demo's own lines, counts and skips.
 */
const OFFLINE_BASE: readonly ScreenCase[] = SCREENS.filter((screen) => screen.name !== 'GIP').map((screen) => ({
  ...screen,
  line: OFFLINE_LINES[screen.name] ?? screen.line,
  charts: OFFLINE_CHART_COUNTS[screen.name] ?? screen.charts,
  ...(OFFLINE_SKIPS[screen.name] === undefined ? {} : { offlineSkip: OFFLINE_SKIPS[screen.name] }),
}))

/**
 * Every screen the offline run drives: OFFLINE_BASE, the four P1 screens, and the numbered tabs of roadmap waves 1 to 11.
 * Counts were pinned from the first offline run against the demo build; a case that cannot be drawn from the demo
 * dataset carries `offlineSkip` and is skipped by name in screens.spec.ts.
 */
export const OFFLINE_SCREENS: readonly ScreenCase[] = [
  ...OFFLINE_BASE,
  // The NQ cone (p1.ts volCone, seeded by vconeTestData) draws one chart.
  { name: 'VCONE', line: 'NQ VCONE', code: 'VCONE', charts: 1 },
  // The demo holds NQ.V.0 seasonality for 2020 to 2021 only (p1.ts, seas/seasTestData.ts); the screen opens on 2010 to 2021, so From is set to 2020 and To stays 2021.
  // Once served, the Month tab draws its one bar ladder (mean monthly return by calendar month).
  { name: 'SEAS', line: 'NQ SEAS', code: 'SEAS', charts: 1, prepare: (page) => pickOption(page, 'SEAS', 'From', '2020') },
  // The demo holds the NQ FOMC daily study at 2 sessions before and 2 after only (p1.ts, evt/fixtures.ts); the screen opens on 5 and 5.
  // Once served, the screen draws its one event path chart (the mean path with its band).
  {
    name: 'EVT', line: 'NQ EVT', code: 'EVT', charts: 1,
    prepare: async (page) => {
      await pickOption(page, 'EVT', 'Before', '2 sessions')
      await pickOption(page, 'EVT', 'After', '2 sessions')
    },
  },
  // The NQ and CL rows and the paper schedule (p1.ts ROLL_CALENDAR) are tables and a strip: no chart.
  { name: 'ROLL', line: 'NQ ROLL', code: 'ROLL', charts: 0 },
  // DES tab 5 (robustness): volmanaged_v0 carries its whole screen file in the demo (research.ts withScreen, VOLMANAGED_SCREEN),
  // so the tab draws its seven charts.
  { name: 'DES-robustness', line: `${HYP} DES`, code: 'DES', charts: 7, then: { line: '5', tabpanel: 'Robustness' } },
  // REG 92 to 94 (91 is the default board, REG above). The MT panel beside REG keeps its two charts under every view: 92 adds
  // none, 93 adds the cost survival board (a card per registry row; only the five DES cards of research.ts have a curve) and 94
  // adds the SV3a effect map.
  { name: 'REG-evidence', line: 'REG', code: 'REG', charts: 2, then: { line: '92', tabpanel: '92) Evidence' } },
  { name: 'REG-costs', line: 'REG', code: 'REG', charts: 3, then: { line: '93', tabpanel: '93) Cost survival' } },
  { name: 'REG-map', line: 'REG', code: 'REG', charts: 3, then: { line: '94', tabpanel: '94) Effect map' } },
  // MT 86 draws the replication of the sealed confirmations (research.ts CONFIRMATIONS). MT 87 draws the served correlation
  // heatmap of the captured effective number of trials (research.ts DEFLATED carries effective_n, EFFECTIVE_N_REAL).
  { name: 'MT-replication', line: 'MT', code: 'MT', charts: 1, then: { line: '86', tabpanel: '86) Replication' } },
  { name: 'MT-trials', line: 'MT', code: 'MT', charts: 1, then: { line: '87', tabpanel: '87) Effective trials' } },
  // RUNS 90 compare: the two runs of the demo with a Basis B body, rebased on one chart (compare.ts DEMO_COMPARE_RUNS).
  {
    name: 'RUNS-compare', line: 'RUNS', code: 'RUNS', charts: 1,
    then: { line: '90', tabpanel: '90) Compare 2', before: (page) => markRuns(page, ['nt_dtsmom_v0_fixture_ts1', 'nt_volmanaged_v0_fixture_m1']) },
  },
]

export const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const message = (page: Page): Locator => page.locator('.msg-line[role="status"]')

/** The lazy screen chunks, their API reads and the chart libraries have all finished; fonts loaded. */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByText('Loading this screen.')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('p.ws-empty')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** Runs a screen's second step (see ScreenStep) and waits for the tab panel it names. */
async function runStep(page: Page, step: ScreenStep): Promise<void> {
  await settle(page)
  await step.before?.(page)
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(step.line)
  await commandLine(page).press('Enter')
  await expect(commandLine(page)).toHaveValue('')
  await expect(message(page), step.line).not.toHaveAttribute('data-tone', 'error')
  await expect(page.getByRole('tabpanel', { name: step.tabpanel, exact: true })).toBeVisible()
}

/** Loads the app at the given size with a frozen clock and opens the screen from the command line. */
export async function openScreen(page: Page, screen: ScreenCase, viewport: Viewport): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  if (screen.line !== null) {
    await page.keyboard.press('Control+k')
    await expect(commandLine(page)).toBeFocused()
    await commandLine(page).fill(screen.line)
    await commandLine(page).press('Enter')
    await expect(commandLine(page)).toHaveValue('')
    await expect(message(page), screen.line).not.toHaveAttribute('data-tone', 'error')
  }
  if (screen.then !== undefined) await runStep(page, screen.then)
  if (screen.prepare !== undefined) {
    await settle(page)
    await screen.prepare(page)
  }
  await expect(page.getByRole('contentinfo')).toContainText(`Screen ${screen.code}`)
  await settle(page)
  // A screen can settle before its chart chunk mounts; wait for the charts it is known to draw.
  await expect.poll(() => page.locator('.chart-a11y').count(), { message: `${screen.name}: charts`, timeout: 20_000 })
    .toBeGreaterThanOrEqual(screen.charts)
  await settle(page)
  await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
}

/** Focuses the command line and types the query, so the suggestion dropdown is open. */
export async function openDropdown(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(DROPDOWN_QUERY)
  await expect(commandLine(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
}

/** Empties the command line and leaves it, so the dropdown closes. */
export async function closeDropdown(page: Page): Promise<void> {
  await commandLine(page).fill('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/** axe with the WCAG 2.2 AA tags; each violation reads `rule (impact): targets`. */
export async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

export interface ChartAudit {
  /** Drawn canvases that no ChartA11y figure names, by panel title. */
  readonly bareCanvases: readonly string[]
  /** The accessible name of every chart figure on screen. */
  readonly summaries: readonly string[]
  /** Figures without a `Table` toggle in their own bar. */
  readonly withoutToggle: number
  /** Graphics outside a chart (in-cell sparklines) that are not hidden from assistive technology with text beside them. */
  readonly bareGraphics: readonly string[]
}

/** Reads every chart and graphic on the page (see ChartAudit). */
export async function auditCharts(page: Page, toggleLabel: string): Promise<ChartAudit> {
  return page.evaluate((label) => {
    const panelOf = (el: Element): string => el.closest('[data-nqt-title]')?.getAttribute('data-nqt-title') ?? '(no panel)'
    const drawn = (el: Element): boolean => el.getClientRects().length > 0
    const bareCanvases = Array.from(document.querySelectorAll('canvas'))
      .filter((c) => drawn(c) && !c.closest('.chart-a11y-figure[role="img"]'))
      .map(panelOf)
    const figures = Array.from(document.querySelectorAll('.chart-a11y-figure'))
    const summaries = figures.map((f) => f.getAttribute('aria-label') ?? '')
    const withoutToggle = figures.filter((f) => {
      const toggle = f.closest('.chart-a11y')?.querySelector(':scope > .chart-a11y-bar > button.chart-a11y-toggle')
      return toggle?.textContent !== label || !toggle.hasAttribute('aria-pressed')
    }).length
    const bareGraphics = Array.from(document.querySelectorAll('svg'))
      .filter((s) => drawn(s) && !s.closest('.chart-a11y-figure'))
      .filter((s) => s.getAttribute('aria-hidden') !== 'true' || (s.parentElement?.textContent ?? '').trim() === '')
      .map(panelOf)
    return { bareCanvases, summaries, withoutToggle, bareGraphics }
  }, toggleLabel)
}

export interface TableCheck {
  readonly caption: string
  readonly name: string
  readonly headers: number
  readonly rows: number
  /** The table is cut off by its box (the box scrolls or clips instead of growing). */
  readonly clipped: boolean
}

/** Turns every chart on screen into its table view and reads each table back. */
export async function showEveryTable(page: Page): Promise<TableCheck[]> {
  const toggles = page.locator('.chart-a11y:visible > .chart-a11y-bar > button.chart-a11y-toggle')
  const count = await toggles.count()
  for (let i = 0; i < count; i += 1) {
    const toggle = toggles.nth(i)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.locator('.chart-a11y-figure')).toHaveCount(0)
  return page.locator('.chart-a11y-tablewrap[role="region"]').evaluateAll((regions) => regions.map((r) => ({
    caption: (r.querySelector('table > caption')?.textContent ?? '').trim(),
    name: r.getAttribute('aria-label') ?? '',
    headers: r.querySelectorAll('thead th[scope="col"]').length,
    rows: r.querySelectorAll('tbody tr').length,
    clipped: r.getBoundingClientRect().height + 1 < (r.querySelector('table')?.getBoundingClientRect().height ?? 0),
  })))
}
